import type { GatewayRouteConfig } from '@/modules/gateway/gateway.interface'

export interface Knife4jServiceDocument {
    name: string
    url: string
    swaggerVersion: '3.0.0'
    location: string
}

/** 网关转发下游 OpenAPI 时保留的绝对路径前缀；这些路径不能再套 /api/{service}。 */
const GATEWAY_ABSOLUTE_OPENAPI_PREFIXES = ['/feign/', '/internal/']

/**
 * 生成 Knife4j 聚合文档列表。
 *
 * `/feign/**` 仅供服务间调用，不作为一套独立业务文档展示；相同服务存在多个公开路由时也只保留第一份。
 * 不设置 servicePath：公开接口的 `/api/{service}` 前缀在转发 swagger-json 时写入 paths，
 * 避免 Knife4j 把 `/feign/**`、`/internal/**` 再拼成 `/api/auth/feign/...`。
 */
export function createKnife4jServices(routes: GatewayRouteConfig[]): Knife4jServiceDocument[] {
    const serviceNames = new Set<string>()
    const publicServices = routes
        .filter(route => route.enabled && route.prefix.startsWith('/api/'))
        // Auth 服务曾保留 `/api/account/auth` 兼容入口，仅用于旧版登录请求，
        // 该入口不提供独立文档；聚合文档必须使用规范的 `/api/auth` 路由。
        .filter(route => !(route.serviceName === 'chat-web-auth-service' && route.prefix === '/api/account/auth'))
        .filter(route => {
            if (serviceNames.has(route.serviceName)) return false
            serviceNames.add(route.serviceName)
            return true
        })
        .map(route => ({
            name: route.serviceName,
            url: `${route.prefix}/api/swagger-json`,
            swaggerVersion: '3.0.0' as const,
            location: `${route.prefix}/api/swagger`
        }))

    return [
        {
            name: '网关服务',
            url: '/api/swagger-json',
            swaggerVersion: '3.0.0',
            location: '/api/swagger'
        },
        ...publicServices
    ]
}

/** 判断是否为需要改写 paths 的下游 OpenAPI JSON。 */
export function isGatewayOpenApiJsonPath(pathname: string, apiPrefix: string): boolean {
    return pathname === `${apiPrefix}/api/swagger-json`
}

/**
 * 把下游 OpenAPI 路径改写成网关入口路径。
 *
 * `/feign/**` 与 `/internal/**` 在网关上已是绝对路径，保持原样；其余业务路径补上 `/api/{service}`。
 */
export function rewriteGatewaySwaggerPath(path: string, apiPrefix: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`
    if (GATEWAY_ABSOLUTE_OPENAPI_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
        return normalized
    }
    if (normalized === apiPrefix || normalized.startsWith(`${apiPrefix}/`)) {
        return normalized
    }
    if (normalized === '/') {
        return apiPrefix
    }
    return `${apiPrefix}${normalized}`
}

/** 改写下游 OpenAPI 文档，供 Knife4j 按网关真实入口试调。 */
export function rewriteGatewaySwaggerDocument(document: Record<string, unknown>, apiPrefix: string): Record<string, unknown> {
    const paths = document.paths
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
        return { ...document, servers: [{ url: '/' }] }
    }
    const rewrittenPaths: Record<string, unknown> = {}
    for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
        rewrittenPaths[rewriteGatewaySwaggerPath(path, apiPrefix)] = item
    }
    return {
        ...document,
        paths: rewrittenPaths,
        servers: [{ url: '/' }]
    }
}
