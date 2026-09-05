import {
    BadGatewayException,
    HttpException,
    Injectable,
    Logger,
    OnApplicationBootstrap,
    ServiceUnavailableException,
    UnauthorizedException
} from '@nestjs/common'
import { createApiResponse } from '@wlisfes/chat-web-base-schema/response'
import { NacosService } from '@wlisfes/chat-web-base-schema/nacos'
import type { IncomingMessage } from 'node:http'
import type { Request, Response } from 'express'
import { ServiceConfigService } from '@/modules/config/config.service'
import type { GatewayAuthOptions } from '@/modules/gateway/gateway.interface'

export interface GatewayAuthPrincipal {
    uid: string
    sessionId: string
}

type GatewayRequest = Request | IncomingMessage

interface AuthResponseEnvelope {
    code?: unknown
    message?: unknown
    data?: unknown
}

/** 网关入口认证服务；通过独立内部认证协议校验用户令牌，不依赖业务 Feign 客户端。 */
@Injectable()
export class GatewayAuthService implements OnApplicationBootstrap {
    private readonly logger = new Logger(GatewayAuthService.name)

    constructor(
        private readonly serviceConfig: ServiceConfigService,
        private readonly nacosService: NacosService
    ) {}

    /** 在网关启动时校验已启用的认证配置，避免首个请求才暴露配置错误。 */
    onApplicationBootstrap(): void {
        const options = this.serviceConfig.getGatewayAuthOptions()
        if (!options.enabled) {
            this.logger.warn('网关入口认证未启用；请在 Nacos gateway.auth.enabled 中明确开启')
            return
        }
        this.logger.log(`网关入口认证已启用：认证服务=${options.serviceName}，内省超时=${options.timeoutMs}ms`)
    }

    /** 校验 HTTP 或 WebSocket 升级请求；公开路径和非网关业务路径直接放行。 */
    public async authenticate(request: GatewayRequest): Promise<GatewayAuthPrincipal | undefined> {
        const options = this.serviceConfig.getGatewayAuthOptions()
        if (!options.enabled || request.method === 'OPTIONS') return undefined

        const path = this.getPath(request)
        if (!this.shouldAuthenticate(path, options)) return undefined

        const authorization = this.getHeader(request, 'authorization')
        const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)
        if (!match) throw new UnauthorizedException('缺少 Bearer 访问令牌')

        const principal = await this.introspect(match[1], options, this.getHeader(request, 'x-request-id'))
        if ('header' in request && typeof request.header === 'function') {
            const expressRequest = request as Request & { user?: GatewayAuthPrincipal }
            expressRequest.user = principal
        }
        return principal
    }

    /** 将认证异常转换为网关统一响应；不会把上游内部错误原文返回给客户端。 */
    public writeError(response: Response, error: unknown): void {
        const status = error instanceof HttpException ? error.getStatus() : 503
        const message = error instanceof HttpException && status < 500 ? error.message : '网关认证服务暂不可用'
        response.status(status).json(createApiResponse(null, { code: status, message }))
    }

    private async introspect(token: string, options: GatewayAuthOptions, requestId?: string): Promise<GatewayAuthPrincipal> {
        const serviceUrl = await this.nacosService.resolveService(options.serviceName, options.fallbackUrl)
        const endpoint = new URL(options.introspectionPath, `${serviceUrl.replace(/\/+$/, '')}/`)
        let response: globalThis.Response
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'x-service-token': options.serviceToken,
                    ...(requestId ? { 'x-request-id': requestId } : {})
                },
                body: JSON.stringify({ token }),
                signal: AbortSignal.timeout(options.timeoutMs)
            })
        } catch (error) {
            this.logger.warn(`Account 认证服务请求失败：${error instanceof Error ? error.message : String(error)}`)
            throw new ServiceUnavailableException('账号认证服务暂不可用')
        }

        let envelope: AuthResponseEnvelope
        try {
            envelope = (await response.json()) as AuthResponseEnvelope
        } catch {
            throw new BadGatewayException('账号认证服务返回了无效响应')
        }

        const code = typeof envelope.code === 'number' ? envelope.code : response.status
        const message = typeof envelope.message === 'string' && envelope.message.trim() ? envelope.message : '访问令牌无效'
        if (response.status === 401 || response.status === 403 || code === 401 || code === 403) {
            throw new UnauthorizedException(message)
        }
        if (!response.ok || code !== 200) {
            throw new BadGatewayException('账号认证服务返回异常')
        }

        if (!this.isPrincipal(envelope.data)) {
            throw new BadGatewayException('账号认证服务返回了无效身份主体')
        }
        return envelope.data
    }

    private shouldAuthenticate(path: string, options: GatewayAuthOptions): boolean {
        if (!path.startsWith('/api/')) return false
        const hasRoute = this.serviceConfig.getGatewayRoutes().some(route => path === route.prefix || path.startsWith(`${route.prefix}/`))
        if (!hasRoute) return false
        if (options.publicPaths.some(publicPath => this.isPublicPath(path, publicPath))) return false
        if (/^\/api\/[^/]+\/health(?:\/.*)?$/.test(path)) return false
        if (/^\/api\/[^/]+\/api\/swagger(?:-json)?$/.test(path)) return false
        return true
    }

    private isPublicPath(path: string, publicPath: string): boolean {
        return this.matchesPathPrefix(path, publicPath) || this.matchesPathPrefix(path, this.getPublicPathAlias(publicPath))
    }

    private matchesPathPrefix(path: string, publicPath?: string): boolean {
        return Boolean(publicPath) && (path === publicPath || path.startsWith(`${publicPath}/`))
    }

    private getPublicPathAlias(publicPath: string): string | undefined {
        const accountAuthPrefix = '/api/account/auth/'
        const authPrefix = '/api/auth/'

        if (publicPath.startsWith(accountAuthPrefix)) {
            return `${authPrefix}${publicPath.slice(accountAuthPrefix.length)}`
        }
        if (publicPath.startsWith(authPrefix)) {
            return `${accountAuthPrefix}${publicPath.slice(authPrefix.length)}`
        }
        return undefined
    }

    private getPath(request: GatewayRequest): string {
        const originalUrl = 'originalUrl' in request && typeof request.originalUrl === 'string' ? request.originalUrl : request.url
        return new URL(originalUrl || '/', 'http://gateway.local').pathname
    }

    private getHeader(request: GatewayRequest, name: string): string | undefined {
        if ('header' in request && typeof request.header === 'function') return request.header(name) ?? undefined
        const value = request.headers[name.toLowerCase()]
        return Array.isArray(value) ? value[0] : value
    }

    private isPrincipal(value: unknown): value is GatewayAuthPrincipal {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const principal = value as Partial<GatewayAuthPrincipal>
        return (
            typeof principal.uid === 'string' &&
            principal.uid.length > 0 &&
            typeof principal.sessionId === 'string' &&
            principal.sessionId.length > 0
        )
    }
}
