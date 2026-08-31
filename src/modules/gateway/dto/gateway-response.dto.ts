import { ApiProperty } from '@nestjs/swagger'

export class DocumentationRedirectResponseDto {
    @ApiProperty({ description: 'Knife4j 文档地址', example: '/doc.html' })
    url: string
}

export class GatewayRouteInfoResponseDto {
    @ApiProperty({ description: '路由 ID', example: 'account-service' })
    id: string

    @ApiProperty({ description: '公开路由路径', example: '/api/account/**' })
    path: string

    @ApiProperty({ description: 'Nacos 服务名称', example: 'chat-web-account-service' })
    serviceName: string
}

export class GatewayInfoResponseDto {
    @ApiProperty({ description: '网关服务名称', example: 'chat-web-gateway-service' })
    name: string

    @ApiProperty({ description: '网关说明', example: 'Chat Web 微服务统一 API 网关' })
    description: string

    @ApiProperty({ description: 'Knife4j 文档地址', example: '/doc.html' })
    documentation: string

    @ApiProperty({ description: 'OpenAPI JSON 地址', example: '/api/swagger-json' })
    openapi: string

    @ApiProperty({ description: '健康检查地址', example: '/health' })
    health: string

    @ApiProperty({ description: '已配置的服务路由', type: [GatewayRouteInfoResponseDto] })
    routes: GatewayRouteInfoResponseDto[]
}

export class NacosStatusResponseDto {
    @ApiProperty({ description: '是否启用 Nacos 配置中心', example: true })
    configEnabled: boolean

    @ApiProperty({ description: 'Nacos 配置是否加载完成', example: true })
    configLoaded: boolean

    @ApiProperty({ description: '是否启用 Nacos 服务发现', example: true })
    discoveryEnabled: boolean

    @ApiProperty({ description: '是否连接 Nacos', example: true })
    connected: boolean

    @ApiProperty({ description: '网关是否已注册到 Nacos', example: true })
    registered: boolean

    @ApiProperty({ description: '配置中心异常原因', required: false, example: '配置加载超时' })
    configError?: string

    @ApiProperty({ description: '服务发现异常原因', required: false, example: '服务发现连接超时' })
    discoveryError?: string
}

export class GatewayRouteHealthResponseDto {
    @ApiProperty({ description: '路由 ID', example: 'account-service' })
    id: string

    @ApiProperty({ description: 'Nacos 服务名称', example: 'chat-web-account-service' })
    serviceName: string

    @ApiProperty({ description: '健康实例数量', example: 1 })
    healthyInstances: number

    @ApiProperty({ description: '路由目标来源', enum: ['nacos', 'fallback'], example: 'nacos' })
    source: 'nacos' | 'fallback'
}

export class GatewayLivenessResponseDto {
    @ApiProperty({ description: '网关状态', enum: ['UP'], example: 'UP' })
    status: 'UP'

    @ApiProperty({ description: '检查时间', example: '2026-08-23T04:00:00.000Z' })
    timestamp: string
}

export class GatewayHealthResponseDto extends GatewayLivenessResponseDto {
    @ApiProperty({ description: 'Nacos 状态', type: NacosStatusResponseDto })
    discovery: NacosStatusResponseDto

    @ApiProperty({ description: '各服务路由健康状态', type: [GatewayRouteHealthResponseDto] })
    routes: GatewayRouteHealthResponseDto[]
}
