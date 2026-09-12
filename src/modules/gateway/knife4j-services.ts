import type { GatewayRouteConfig } from '@/modules/gateway/gateway.interface'

export interface Knife4jServiceDocument {
    name: string
    url: string
    swaggerVersion: '3.0.0'
    location: string
    servicePath?: string
}

/**
 * 生成 Knife4j 聚合文档列表。
 *
 * `/feign/**` 仅供服务间调用，不作为一套独立业务文档展示；相同服务存在多个公开路由时也只保留第一份。
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
            location: `${route.prefix}/api/swagger`,
            servicePath: route.prefix
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
