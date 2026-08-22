import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import { GatewayRouteConfig } from '@/modules/gateway/gateway.interface'

export function validateEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
    parsePort(environment.PORT, 3999, 'PORT')
    parsePort(environment.NACOS_REGISTER_PORT ?? environment.PORT, 3999, 'NACOS_REGISTER_PORT')
    parsePositiveInteger(environment.GATEWAY_PROXY_TIMEOUT_MS, 30_000, 'GATEWAY_PROXY_TIMEOUT_MS')
    parseNonNegativeInteger(environment.RATE_LIMIT_MAX, 300, 'RATE_LIMIT_MAX')
    parsePositiveInteger(environment.RATE_LIMIT_WINDOW_MS, 60_000, 'RATE_LIMIT_WINDOW_MS')
    parseCorsOrigins(environment.CORS_ORIGINS, ['*'], 'CORS_ORIGINS')
    getBoolean(environment.CORS_CREDENTIALS, false)

    const accountServiceUrl = readString(environment.ACCOUNT_SERVICE_URL, 'http://127.0.0.1:3000')
    normalizeHttpUrl(accountServiceUrl, 'ACCOUNT_SERVICE_URL')
    const financeServiceUrl = readString(environment.FINANCE_SERVICE_URL, 'http://127.0.0.1:3010')
    normalizeHttpUrl(financeServiceUrl, 'FINANCE_SERVICE_URL')

    return environment
}

export function validateRemoteConfig(config: Record<string, unknown>): void {
    const server = getOptionalRecord(config.server, 'server')
    if (server?.port !== undefined) {
        parsePort(server.port, 3999, 'server.port')
    }

    const gateway = getOptionalRecord(config.gateway, 'gateway')
    if (gateway) {
        const cors = getOptionalRecord(gateway.cors, 'gateway.cors')
        if (cors) {
            const origins = parseCorsOrigins(cors.allowedOrigins, [], 'gateway.cors.allowedOrigins')
            const credentials = getBoolean(cors.credentials, false)
            if (origins.includes('*') && credentials) {
                throw new Error('gateway.cors.allowedOrigins 包含 * 时不能启用 credentials')
            }
        }

        if (gateway.routes !== undefined) {
            parseGatewayRoutes(gateway.routes)
        }

        if (gateway.trustProxy !== undefined) {
            getBoolean(gateway.trustProxy, false)
        }
        const proxy = getOptionalRecord(gateway.proxy, 'gateway.proxy')
        if (proxy?.timeoutMs !== undefined) {
            parsePositiveInteger(proxy.timeoutMs, 30_000, 'gateway.proxy.timeoutMs')
        }
        const rateLimit = getOptionalRecord(gateway.rateLimit, 'gateway.rateLimit')
        if (rateLimit) {
            if (rateLimit.max !== undefined) {
                parseNonNegativeInteger(rateLimit.max, 300, 'gateway.rateLimit.max')
            }
            if (rateLimit.windowMs !== undefined) {
                parsePositiveInteger(rateLimit.windowMs, 60_000, 'gateway.rateLimit.windowMs')
            }
        }
    }

    const nacos = getOptionalRecord(config.nacos, 'nacos')
    const discovery = getOptionalRecord(nacos?.discovery, 'nacos.discovery')
    if (discovery) {
        getBoolean(discovery.enabled, true)
        getBoolean(discovery.required, false)
        if (discovery.group !== undefined) {
            getRequiredString(discovery.group, 'nacos.discovery.group')
        }
    }
    const registration = getOptionalRecord(nacos?.registration, 'nacos.registration')
    if (registration) {
        getBoolean(registration.enabled, true)
        if (registration.serviceName !== undefined) {
            getRequiredString(registration.serviceName, 'nacos.registration.serviceName')
        }
    }
}

export function getPort(value: unknown, fallback: number, name: string): number {
    return parsePort(value, fallback, name)
}

export function getPositiveInteger(value: unknown, fallback: number, name: string): number {
    return parsePositiveInteger(value, fallback, name)
}

export function getNonNegativeInteger(value: unknown, fallback: number, name: string): number {
    return parseNonNegativeInteger(value, fallback, name)
}

export function getBoolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') {
        return fallback
    }

    if (typeof value === 'boolean') {
        return value
    }

    const normalized = String(value).trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false
    }

    throw new Error(`无效的布尔配置值：${String(value)}`)
}

export function getString(value: unknown, fallback: string): string {
    return readString(value, fallback)
}

export function getCorsOptions(originsValue: unknown, credentialsValue: unknown): CorsOptions {
    const configuredOrigins = parseCorsOrigins(originsValue, ['*'], '跨域白名单')
    const allowAllOrigins = configuredOrigins.includes('*')
    const credentials = getBoolean(credentialsValue, false)

    if (allowAllOrigins && credentials) {
        throw new Error('跨域白名单包含 * 时不能启用 credentials')
    }

    return {
        origin: allowAllOrigins ? true : configuredOrigins,
        credentials,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-Id', 'X-Requested-With'],
        exposedHeaders: ['X-Request-Id']
    }
}

export function getFallbackGatewayRoutes(environment: Record<string, unknown>): GatewayRouteConfig[] {
    return [
        {
            id: 'account',
            prefix: '/api/account',
            serviceName: readString(environment.ACCOUNT_SERVICE_NAME, 'chat-web-account-service'),
            fallbackUrl: normalizeHttpUrl(readString(environment.ACCOUNT_SERVICE_URL, 'http://127.0.0.1:3000'), 'ACCOUNT_SERVICE_URL'),
            enabled: true
        },
        {
            id: 'finance',
            prefix: '/api/finance',
            serviceName: readString(environment.FINANCE_SERVICE_NAME, 'chat-web-finance-service'),
            fallbackUrl: normalizeHttpUrl(readString(environment.FINANCE_SERVICE_URL, 'http://127.0.0.1:3010'), 'FINANCE_SERVICE_URL'),
            enabled: true
        }
    ]
}

export function parseGatewayRoutes(value: unknown): GatewayRouteConfig[] {
    if (!Array.isArray(value)) {
        throw new Error('gateway.routes 必须是数组')
    }

    const routes = value.map((item, index) => {
        const path = `gateway.routes[${index}]`
        const route = getRecord(item, path)
        const id = getRequiredString(route.id, `${path}.id`)
        const prefix = normalizeRoutePrefix(getRequiredString(route.prefix, `${path}.prefix`), `${path}.prefix`)
        const serviceName = getRequiredString(route.serviceName, `${path}.serviceName`)
        const fallbackUrl = normalizeHttpUrl(getRequiredString(route.fallbackUrl, `${path}.fallbackUrl`), `${path}.fallbackUrl`)

        if (!/^[a-z][a-z0-9-]*$/.test(id)) {
            throw new Error(`${path}.id 只能使用小写字母、数字和连字符，并且必须以字母开头`)
        }

        return {
            id,
            prefix,
            serviceName,
            fallbackUrl,
            enabled: getBoolean(route.enabled, true)
        }
    })

    assertUnique(
        routes.map(route => route.id),
        'gateway.routes.id'
    )
    assertUnique(
        routes.map(route => route.prefix),
        'gateway.routes.prefix'
    )
    return routes.filter(route => route.enabled).sort((left, right) => right.prefix.length - left.prefix.length)
}

export function applyGatewayRouteEnvironmentOverrides(
    routes: GatewayRouteConfig[],
    environment: Record<string, unknown>
): GatewayRouteConfig[] {
    return routes.map(route => {
        const environmentKey = `${route.id.replace(/-/g, '_').toUpperCase()}_SERVICE_URL`
        const configuredUrl = environment[environmentKey]
        return configuredUrl === undefined
            ? route
            : {
                  ...route,
                  fallbackUrl: normalizeHttpUrl(getRequiredString(configuredUrl, environmentKey), environmentKey)
              }
    })
}

function parseCorsOrigins(value: unknown, fallback: string[], name: string): string[] {
    let origins: string[]
    if (value === undefined || value === null) {
        origins = fallback
    } else if (Array.isArray(value)) {
        origins = value.map((item, index) => getRequiredString(item, `${name}[${index}]`))
    } else if (typeof value === 'string') {
        origins = value
            .split(',')
            .map(origin => origin.trim())
            .filter(Boolean)
    } else {
        throw new Error(`${name} 必须是字符串或字符串数组`)
    }

    const uniqueOrigins = [...new Set(origins)]
    for (const origin of uniqueOrigins) {
        if (origin === '*') {
            continue
        }
        const normalized = normalizeHttpUrl(origin, name)
        if (normalized !== origin) {
            throw new Error(`${name} 中的域名必须使用标准 Origin 格式：${origin}`)
        }
    }
    return uniqueOrigins
}

function readString(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
        return fallback
    }
    const normalized = value.trim()
    return normalized || fallback
}

function getRequiredString(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name} 必须是非空字符串`)
    }
    return value.trim()
}

function getRecord(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} 必须是对象`)
    }
    return value as Record<string, unknown>
}

function getOptionalRecord(value: unknown, name: string): Record<string, unknown> | undefined {
    return value === undefined || value === null ? undefined : getRecord(value, name)
}

function parsePort(value: unknown, fallback: number, name: string): number {
    const port = parsePositiveInteger(value, fallback, name)
    if (port > 65_535) {
        throw new Error(`${name} 必须位于 1 到 65535 之间`)
    }
    return port
}

function parsePositiveInteger(value: unknown, fallback: number, name: string): number {
    const parsed = value === undefined || value === null || value === '' ? fallback : Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${name} 必须是正整数`)
    }
    return parsed
}

function parseNonNegativeInteger(value: unknown, fallback: number, name: string): number {
    const parsed = value === undefined || value === null || value === '' ? fallback : Number(value)
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} 必须是非负整数`)
    }
    return parsed
}

function normalizeRoutePrefix(value: string, name: string): string {
    if (!/^\/api\/[a-z0-9][a-z0-9/-]*$/.test(value) || value.endsWith('/')) {
        throw new Error(`${name} 必须包含服务名称前缀，并使用以 /api/ 开头且不以 / 结尾的小写路径`)
    }
    return value
}

function normalizeHttpUrl(value: string, name: string): string {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new Error(`${name} 必须是有效的 HTTP 地址`)
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`${name} 只支持 http 或 https 协议`)
    }
    if (url.pathname !== '/' || url.search || url.hash) {
        throw new Error(`${name} 只能配置服务根地址，不能包含路径、查询参数或锚点`)
    }

    return url.origin
}

function assertUnique(values: string[], name: string): void {
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
    if (duplicates.length > 0) {
        throw new Error(`${name} 不能重复：${[...new Set(duplicates)].join(', ')}`)
    }
}
