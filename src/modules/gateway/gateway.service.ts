import { Injectable } from '@nestjs/common'
import { GatewayProxyService } from '@/modules/gateway/gateway-proxy.service'
import { NacosService } from '@/modules/nacos/nacos.service'

@Injectable()
export class GatewayService {
    constructor(
        private readonly proxyService: GatewayProxyService,
        private readonly nacosService: NacosService
    ) {}

    getInfo() {
        return {
            name: 'chat-web-gateway-service',
            description: 'Chat Web 微服务统一 API 网关',
            swagger: '/api/swagger',
            health: '/health',
            routes: this.proxyService.getRoutes().map(route => ({
                id: route.id,
                path: `${route.prefix}/**`,
                serviceName: route.serviceName
            }))
        }
    }

    getHealth() {
        const discovery = this.nacosService.getStatus()
        return {
            status: 'UP',
            timestamp: new Date().toISOString(),
            discovery,
            routes: this.proxyService.getRoutes().map(route => {
                const healthyInstances = this.nacosService.getHealthyInstanceCount(route.serviceName)
                return {
                    id: route.id,
                    serviceName: route.serviceName,
                    healthyInstances,
                    source: healthyInstances > 0 ? 'nacos' : 'fallback'
                }
            })
        }
    }
}
