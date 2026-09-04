export interface GatewayRouteConfig {
    id: string
    prefix: string
    serviceName: string
    fallbackUrl: string
    enabled: boolean
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
