export interface GatewayRouteConfig {
    id: string
    prefix: string
    serviceName: string
    fallbackUrl: string
    enabled: boolean
    /**
     * 转发到下游时是否剥离路由前缀。
     *
     * 面向客户端的 `/api/<服务名>` 路由需要剥离，下游按自身业务路径接收；服务间的
     * `/feign/<服务名>` 路由不剥离，下游继承的共享 Feign 客户端路由本身就带该前缀。
     */
    stripPrefix: boolean
}

/**
 * 网关入口认证配置。
 *
 * 内省目标优先取 `id: auth` 的路由，未配置时回退到 `id: account` 仅用于灰度回滚；
 * 正常生产配置必须使用 `/api/auth` 路由指向独立鉴权服务。
 */
export interface GatewayAuthOptions {
    enabled: boolean
    serviceName: string
    fallbackUrl: string
    introspectionPath: string
    timeoutMs: number
    serviceToken: string
    publicPaths: string[]
}
