import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { GatewayProxyService } from '@/modules/gateway/gateway-proxy.service'
import { NacosService } from '@wlisfes/chat-web-base-schema/nacos'

@Injectable()
export class GatewayService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(GatewayService.name)
    private refreshQueue: Promise<void> = Promise.resolve()
    private removeConfigListener?: () => void
    constructor(
        private readonly proxyService: GatewayProxyService,
        private readonly nacosService: NacosService
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        await this.refreshRoutes()
        this.removeConfigListener = this.nacosService.onConfigChange(() => {
            void this.refreshRoutes().catch(() => undefined)
        })
    }

    onModuleDestroy(): void {
        this.removeConfigListener?.()
    }

    private refreshRoutes(): Promise<void> {
        const refresh = this.refreshQueue.then(() =>
            this.nacosService.refreshSubscriptions(this.proxyService.getRoutes().map(route => route.serviceName))
        )
        this.refreshQueue = refresh.catch(error => {
            this.logger.error(`刷新 Nacos 网关路由订阅失败：${error instanceof Error ? error.message : String(error)}`)
        })
        return refresh
    }

    getInfo() {
        return {
            name: 'chat-web-gateway-service',
            description: 'Chat Web 微服务统一 API 网关',
            documentation: '/doc.html',
            openapi: '/api/swagger-json',
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
