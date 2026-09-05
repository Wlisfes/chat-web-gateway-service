import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import type { AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { getGatewayPrincipalMaxAge, getGatewayPrincipalSecret, signGatewayPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import {
    applyGatewayRouteEnvironmentOverrides,
    getBoolean,
    getCorsOptions,
    getFallbackGatewayRoutes,
    getNonNegativeInteger,
    getPort,
    getPositiveInteger,
    parseGatewayRoutes
} from '@/config/environment'
import { GatewayAuthOptions, GatewayRouteConfig } from '@/modules/gateway/gateway.interface'

@Injectable()
export class ServiceConfigService {
    constructor(private readonly configService: ConfigService) {}

    getGatewayRoutes(): GatewayRouteConfig[] {
        const routes = this.configService.get<unknown>('gateway.routes')
        const configuredRoutes = routes === undefined ? getFallbackGatewayRoutes(process.env) : parseGatewayRoutes(routes)
        return applyGatewayRouteEnvironmentOverrides(configuredRoutes, process.env)
    }

    getCorsOptions(): CorsOptions {
        return getCorsOptions(
            this.configService.get('gateway.cors.allowedOrigins') ?? this.configService.get('CORS_ORIGINS'),
            this.configService.get('gateway.cors.credentials') ?? this.configService.get('CORS_CREDENTIALS')
        )
    }

    getServerPort(): number {
        return getPort(process.env.PORT ?? this.configService.get('server.port'), 5000, 'server.port')
    }

    getProxyTimeout(): number {
        return getPositiveInteger(
            this.configService.get('gateway.proxy.timeoutMs') ?? this.configService.get('GATEWAY_PROXY_TIMEOUT_MS'),
            30_000,
            'gateway.proxy.timeoutMs'
        )
    }

    getRateLimitMax(): number {
        return getNonNegativeInteger(
            this.configService.get('gateway.rateLimit.max') ?? this.configService.get('RATE_LIMIT_MAX'),
            300,
            'gateway.rateLimit.max'
        )
    }

    getRateLimitWindowMs(): number {
        return getPositiveInteger(
            this.configService.get('gateway.rateLimit.windowMs') ?? this.configService.get('RATE_LIMIT_WINDOW_MS'),
            60_000,
            'gateway.rateLimit.windowMs'
        )
    }

    /** 签发下发给业务服务的身份上下文；密钥缺失时直接抛出，避免明文身份被下游信任。 */
    signPrincipal(principal: AuthPrincipal): string {
        return signGatewayPrincipal(principal, getGatewayPrincipalSecret(this.configService))
    }

    /** 校验身份上下文签名配置，供启动期自检使用。 */
    assertPrincipalConfigured(): void {
        getGatewayPrincipalSecret(this.configService)
        getGatewayPrincipalMaxAge(this.configService)
    }

    getTrustProxy(): boolean {
        return getBoolean(this.configService.get('gateway.trustProxy') ?? this.configService.get('TRUST_PROXY'), false)
    }

    /** 读取网关入口认证配置；未显式关闭时默认启用并要求完整服务凭据。 */
    getGatewayAuthOptions(): GatewayAuthOptions {
        const configured = this.configService.get<unknown>('gateway.auth')
        if (configured !== undefined && (!configured || typeof configured !== 'object' || Array.isArray(configured))) {
            throw new Error('gateway.auth 必须是对象')
        }
        const auth =
            configured && typeof configured === 'object' && !Array.isArray(configured) ? (configured as Record<string, unknown>) : {}
        const enabled = getBoolean(auth.enabled, true)
        // 认证目标优先使用鉴权服务路由；未迁移完成时回退到账号服务路由。
        const routes = this.getGatewayRoutes()
        const authRoute = routes.find(route => route.id === 'auth') ?? routes.find(route => route.id === 'account')
        if (enabled && !authRoute) {
            throw new Error('网关入口认证需要配置 auth 或 account 路由')
        }

        const publicPathsValue = auth.publicPaths
        const publicPaths = publicPathsValue === undefined ? getDefaultPublicPaths() : parsePublicPaths(publicPathsValue)
        const introspectionPath = readRequiredPath(
            auth.introspectionPath,
            '/internal/auth/token/introspect',
            'gateway.auth.introspectionPath'
        )
        const timeoutMs = getPositiveInteger(auth.timeoutMs, 3000, 'gateway.auth.timeoutMs')
        const serviceToken = enabled
            ? readRequiredString(this.configService.get<unknown>('feign.service_token'), 'feign.service_token')
            : ''

        return {
            enabled,
            serviceName: authRoute?.serviceName ?? 'chat-web-auth-service',
            fallbackUrl: authRoute?.fallbackUrl ?? 'http://127.0.0.1:5050',
            introspectionPath,
            timeoutMs,
            serviceToken,
            publicPaths
        }
    }
}

function getDefaultPublicPaths(): string[] {
    return [
        '/health',
        '/health/live',
        '/health/ready',
        '/doc.html',
        '/services.json',
        '/api/swagger',
        '/api/swagger-json',
        '/api/account/auth/codex/write',
        '/api/account/auth/token/login'
    ]
}

function parsePublicPaths(value: unknown): string[] {
    if (!Array.isArray(value)) throw new Error('gateway.auth.publicPaths 必须是字符串数组')
    return value.map((item, index) => readRequiredPath(item, '', `gateway.auth.publicPaths[${index}]`))
}

function readRequiredString(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`)
    return value.trim()
}

function readRequiredPath(value: unknown, fallback: string, name: string): string {
    const normalized = value === undefined ? fallback : readRequiredString(value, name)
    if (!normalized.startsWith('/') || normalized.includes('?') || normalized.includes('#')) {
        throw new Error(`${name} 必须是以 / 开头且不包含查询参数或锚点的路径`)
    }
    return normalized === '/' ? normalized : normalized.replace(/\/+$/, '')
}
