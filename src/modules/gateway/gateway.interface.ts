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

/** 网关入口认证配置；认证服务地址仍通过 Account 路由和 Nacos 服务发现解析。 */
export interface GatewayAuthOptions {
    enabled: boolean
    accountServiceName: string
    accountFallbackUrl: string
    introspectionPath: string
    timeoutMs: number
    serviceToken: string
    publicPaths: string[]
}
