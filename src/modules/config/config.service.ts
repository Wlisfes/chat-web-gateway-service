import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
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
import { GatewayRouteConfig } from '@/modules/gateway/gateway.interface'

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
        return getPort(process.env.PORT ?? this.configService.get('server.port'), 8080, 'server.port')
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

    getTrustProxy(): boolean {
        return getBoolean(this.configService.get('gateway.trustProxy') ?? this.configService.get('TRUST_PROXY'), false)
    }
}
