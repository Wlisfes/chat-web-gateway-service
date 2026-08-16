export interface GatewayRouteConfig {
    id: string
    prefix: string
    serviceName: string
    fallbackUrl: string
    enabled: boolean
}
