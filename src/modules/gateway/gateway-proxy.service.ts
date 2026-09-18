import type { ClientRequest, IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { GATEWAY_PRINCIPAL_HEADER } from '@wlisfes/chat-web-base-schema/auth'
import type { AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import {
    BUSINESS_CODE_HEADER,
    isBusinessSuccessStatus,
    parseBusinessStatusCode,
    parseJsonBusinessCode
} from '@wlisfes/chat-web-base-schema/logging'
import { createApiResponse } from '@wlisfes/chat-web-base-schema/response'
import { resolveRequestId } from '@wlisfes/chat-web-base-schema/request-context'
import type { Express, Request, RequestHandler, Response } from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import type { RequestHandler as ProxyRequestHandler } from 'http-proxy-middleware'
import { ServiceConfigService } from '@/modules/config/config.service'
import { GatewayRouteConfig } from '@/modules/gateway/gateway.interface'
import { shouldLogGatewayRequestPath } from '@/modules/gateway/gateway-request-logging.middleware'
import { NacosService } from '@wlisfes/chat-web-base-schema/nacos'
import { GatewayAuthService } from '@/modules/auth/gateway-auth.service'

type UpgradeableProxy = ProxyRequestHandler & {
    upgrade: (request: Request, socket: Socket, head: Buffer) => void
}

function parseGatewayInstanceFlag(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value !== 0
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true' || normalized === '1') {
            return true
        }
        if (normalized === 'false' || normalized === '0') {
            return false
        }
    }
    return fallback
}

export function isRoutableNacosInstance(instance: { healthy?: unknown; enabled?: unknown; weight?: unknown }): boolean {
    const weight = instance.weight === undefined || instance.weight === null || instance.weight === '' ? 1 : Number(instance.weight)
    return (
        parseGatewayInstanceFlag(instance.healthy, true) &&
        parseGatewayInstanceFlag(instance.enabled, true) &&
        Number.isFinite(weight) &&
        weight > 0
    )
}

export function removeDownstreamCorsHeaders(proxyResponse: Pick<IncomingMessage, 'headers'>): void {
    for (const headerName of Object.keys(proxyResponse.headers)) {
        if (headerName.toLowerCase().startsWith('access-control-')) {
            delete proxyResponse.headers[headerName]
        }
    }
}

const MAX_GATEWAY_BUSINESS_BODY_PEEK = 4096

/** 优先读取业务码响应头，HTTP 非 200 次之，最后回退响应体 code。 */
export function resolveGatewayBusinessStatusCode(
    headers: IncomingMessage['headers'] | Record<string, unknown>,
    httpStatus = 200,
    bodyText?: string
): number {
    const headerCode = parseBusinessStatusCode(headers[BUSINESS_CODE_HEADER])
    if (headerCode !== undefined) return headerCode
    if (httpStatus !== 200) return httpStatus
    return parseJsonBusinessCode(bodyText ?? '') ?? httpStatus
}

function observeProxyBusinessStatusCode(proxyResponse: IncomingMessage, onCode: (code: number) => void): void {
    const httpStatus = proxyResponse.statusCode ?? 200
    const headerCode = parseBusinessStatusCode(proxyResponse.headers[BUSINESS_CODE_HEADER])
    if (headerCode !== undefined) {
        onCode(headerCode)
        return
    }
    if (httpStatus !== 200) {
        proxyResponse.headers[BUSINESS_CODE_HEADER] = String(httpStatus)
        onCode(httpStatus)
        return
    }

    let text = ''
    let settled = false
    const finish = () => {
        if (settled) return
        settled = true
        onCode(parseJsonBusinessCode(text) ?? httpStatus)
    }

    proxyResponse.on('data', (chunk: Buffer | string) => {
        if (settled) return
        if (text.length < MAX_GATEWAY_BUSINESS_BODY_PEEK) {
            text += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
            if (text.length > MAX_GATEWAY_BUSINESS_BODY_PEEK) text = text.slice(0, MAX_GATEWAY_BUSINESS_BODY_PEEK)
        }
        const code = parseJsonBusinessCode(text)
        if (code !== undefined) {
            settled = true
            onCode(code)
        }
    })
    proxyResponse.on('end', finish)
    proxyResponse.on('aborted', finish)
    proxyResponse.on('error', finish)
}

@Injectable()
export class GatewayProxyService {
    private readonly logger = new Logger(GatewayProxyService.name)
    private readonly startedAt = new WeakMap<Request, number>()
    private readonly matchedRoutes = new WeakMap<Request, GatewayRouteConfig>()
    private readonly unavailableRequests = new WeakSet<Request>()
    private proxy?: UpgradeableProxy
    private mounted = false
    private upgradeAttached = false

    constructor(
        private readonly serviceConfig: ServiceConfigService,
        private readonly nacosService: NacosService,
        @Optional() private readonly authService?: GatewayAuthService
    ) {}

    mount(application: Express): void {
        if (this.mounted) {
            return
        }
        this.mounted = true

        const handler: RequestHandler = (request: Request, response: Response, next) => {
            if (!this.proxy) {
                response.setHeader(BUSINESS_CODE_HEADER, '503')
                response.status(200).json(createApiResponse(null, { code: 503, message: '网关配置正在初始化' }))
                return
            }
            void this.proxy(request, response, next)
        }

        // `/api/**` 是客户端入口，`/feign/**` 是服务间入口；后者不对公网暴露，由反向代理只放行 `/api/**` 保证。
        application.use('/api', handler)
        application.use('/feign', handler)
        this.logger.log('已挂载 Nacos 动态网关路由：/api/** 与 /feign/**')
    }

    initialize(): void {
        if (this.proxy) {
            return
        }

        const timeout = this.serviceConfig.getProxyTimeout()
        this.proxy = createProxyMiddleware<Request, Response>({
            target: 'http://127.0.0.1',
            pathFilter: (_pathname, request) => {
                const route = this.findRoute(request)
                if (route) {
                    this.matchedRoutes.set(request, route)
                }
                return Boolean(route)
            },
            router: async request => {
                const route = this.getMatchedRoute(request)
                if (!route.fallbackEnabled && typeof this.nacosService.getAllInstances === 'function') {
                    // 订阅回调可能存在短暂延迟；无后备地址的路由每次转发前读取一次
                    // Nacos 实例列表，避免本地缓存继续命中已在控制台下线的实例。
                    try {
                        const instances = await this.nacosService.getAllInstances(route.serviceName, false)
                        const hasHealthyInstance = instances.some(instance => isRoutableNacosInstance(instance))
                        if (!hasHealthyInstance) {
                            this.unavailableRequests.add(request)
                            return 'http://127.0.0.1:1'
                        }
                    } catch {
                        this.unavailableRequests.add(request)
                        return 'http://127.0.0.1:1'
                    }
                }
                // 后备地址必须显式开启；默认传空地址，让 Nacos 无实例时快速失败并返回 503，
                // 防止控制台下线实例后网关绕过服务发现继续请求固定目标。
                return this.nacosService.resolveService(route.serviceName, route.fallbackEnabled ? route.fallbackUrl : '').catch(error => {
                    this.unavailableRequests.add(request)
                    this.logger.warn(
                        `${request.method} ${request.originalUrl || request.url} -> ${route.serviceName}：${
                            error instanceof Error ? error.message : String(error)
                        }`
                    )
                    // Force the proxy error path so the response keeps the gateway's
                    // established JSON envelope instead of becoming an Express 500.
                    return 'http://127.0.0.1:1'
                })
            },
            pathRewrite: (_path, request) => this.getDownstreamPath(request, this.getMatchedRoute(request)),
            changeOrigin: true,
            xfwd: true,
            ws: true,
            secure: true,
            proxyTimeout: timeout,
            timeout,
            on: {
                proxyReq: (proxyRequest, request) => {
                    const route = this.getMatchedRoute(request)
                    this.startedAt.set(request, Date.now())
                    this.setProxyHeaders(proxyRequest, route, request)
                },
                proxyReqWs: (proxyRequest, request) => {
                    this.setProxyHeaders(proxyRequest, this.getMatchedRoute(request as Request))
                },
                proxyRes: (proxyResponse, request) => {
                    removeDownstreamCorsHeaders(proxyResponse)
                    if (!shouldLogGatewayRequestPath(request.originalUrl || request.url)) return
                    const route = this.getMatchedRoute(request)
                    const duration = Date.now() - (this.startedAt.get(request) ?? Date.now())
                    observeProxyBusinessStatusCode(proxyResponse, statusCode => {
                        const message = `${request.method} ${request.originalUrl} -> ${route.serviceName} ${statusCode} ${duration}ms`
                        if (isBusinessSuccessStatus(statusCode)) this.logger.log(message)
                        else this.logger.error(message)
                    })
                },
                error: (error, request, response) => {
                    const route = this.matchedRoutes.get(request as Request) ?? this.findRoute(request as Request)
                    const requestUrl = request.originalUrl || request.url || ''
                    const resolutionFailed = this.unavailableRequests.has(request as Request)
                    this.unavailableRequests.delete(request as Request)
                    if (shouldLogGatewayRequestPath(requestUrl) && !resolutionFailed) {
                        this.logger.error(
                            `${request.method ?? 'UPGRADE'} ${requestUrl} -> ${route?.serviceName ?? 'unknown'}：${error.message}`
                        )
                    }

                    if ('writeHead' in response && 'end' in response) {
                        if (response.headersSent) {
                            response.end()
                            return
                        }
                        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', [BUSINESS_CODE_HEADER]: '503' })
                        response.end(
                            JSON.stringify(createApiResponse(null, { code: 503, message: `服务 ${route?.id ?? 'unknown'} 暂时不可用` }))
                        )
                        return
                    }

                    response.destroy(error)
                }
            }
        }) as UpgradeableProxy

        this.logger.log(`网关代理配置已初始化：timeout=${timeout}ms`)
    }

    attachWebSocketServer(server: Server): void {
        if (this.upgradeAttached) {
            return
        }
        this.upgradeAttached = true

        server.on('upgrade', (request, socket, head) => {
            if (!this.proxy) {
                socket.destroy()
                return
            }

            const proxyRequest = request as Request
            const route = this.findRoute(proxyRequest)
            if (!route) {
                socket.destroy()
                return
            }

            this.matchedRoutes.set(proxyRequest, route)
            request.headers['x-request-id'] = resolveRequestId(request.headers['x-request-id'])
            const authenticate = this.authService?.authenticate(proxyRequest) ?? Promise.resolve(undefined)
            void authenticate.then(() => this.proxy?.upgrade(proxyRequest, socket as Socket, head)).catch(() => socket.destroy())
        })
    }

    getRoutes(): GatewayRouteConfig[] {
        return this.serviceConfig.getGatewayRoutes().map(route => ({ ...route }))
    }

    private findRoute(request: Request): GatewayRouteConfig | undefined {
        const pathname = new URL(request.originalUrl || request.url || '/', 'http://gateway.local').pathname
        return this.serviceConfig.getGatewayRoutes().find(route => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`))
    }

    private getMatchedRoute(request: Request): GatewayRouteConfig {
        const route = this.matchedRoutes.get(request) ?? this.findRoute(request)
        if (!route) {
            throw new Error(`未找到网关路由：${request.originalUrl || request.url}`)
        }
        this.matchedRoutes.set(request, route)
        return route
    }

    private getDownstreamPath(request: Request, route: GatewayRouteConfig): string {
        const requestUrl = new URL(request.originalUrl || request.url || '/', 'http://gateway.local')
        const pathname = route.stripPrefix ? requestUrl.pathname.slice(route.prefix.length) || '/' : requestUrl.pathname
        return `${pathname}${requestUrl.search}`
    }

    private setProxyHeaders(proxyRequest: ClientRequest, route: GatewayRouteConfig, request?: Request): void {
        proxyRequest.setHeader('x-gateway-service', 'chat-web-gateway-service')
        proxyRequest.setHeader('x-forwarded-prefix', route.prefix)

        // 认证通过的请求下发签名身份上下文，业务服务只做本地验签，不再远程内省。
        const principal = (request as (Request & { user?: AuthPrincipal }) | undefined)?.user
        if (principal) {
            proxyRequest.setHeader(GATEWAY_PRINCIPAL_HEADER, this.serviceConfig.signPrincipal(principal))
        }
    }
}
