import { networkInterfaces } from 'node:os'
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Host, NacosConfigClient, NacosNamingClient } from 'nacos'
import { getBoolean, getPort, getString, validateRemoteConfig } from '@/config/environment'
import { ServiceConfigService } from '@/modules/config/config.service'
import { NacosRegisteredInstance, NacosStatus } from '@/modules/nacos/nacos.interface'

// 与账号服务保持一致，避免额外引入只用于类型声明的依赖。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

type ClosableNacosNamingClient = NacosNamingClient & {
    close: () => Promise<void>
}

@Injectable()
export class NacosService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NacosService.name)
    private readonly hosts = new Map<string, Host[]>()
    private readonly namingListeners = new Map<string, (hosts: Host[]) => void>()
    private readonly remoteConfigKeys = new Set<string>()
    private readonly cursors = new Map<string, number>()
    private namingClient?: ClosableNacosNamingClient
    private configClient?: NacosConfigClient
    private configListener?: (content: string) => void
    private registeredInstance?: NacosRegisteredInstance
    private currentConfigContent?: string
    private configLoaded = false
    private connected = false
    private registered = false
    private configError?: string
    private discoveryError?: string

    constructor(
        private readonly configService: ConfigService,
        private readonly serviceConfig: ServiceConfigService
    ) {}

    async onModuleInit(): Promise<void> {
        await this.initializeRemoteConfig()
        await this.initializeDiscovery()
    }

    async onModuleDestroy(): Promise<void> {
        if (this.configClient && this.configListener) {
            this.configClient.unSubscribe(this.getConfigSubscription(), this.configListener)
        }

        if (this.namingClient) {
            for (const [serviceName, listener] of this.namingListeners) {
                this.namingClient.unSubscribe({ serviceName, groupName: this.getGroup() }, listener)
            }

            if (this.registeredInstance) {
                try {
                    await this.namingClient.deregisterInstance(
                        this.getGatewayServiceName(),
                        {
                            instanceId: '',
                            healthy: true,
                            enabled: true,
                            ...this.registeredInstance
                        },
                        this.getGroup()
                    )
                } catch (error) {
                    this.logger.warn(`注销 Nacos 网关实例失败：${this.getErrorMessage(error)}`)
                }
            }

            await this.namingClient.close()
        }

        this.configClient?.close()
    }

    async resolveService(serviceName: string, fallbackUrl: string): Promise<string> {
        if (this.namingClient && this.connected) {
            try {
                let healthyHosts = this.getHealthyHosts(serviceName)
                if (!this.hosts.has(serviceName)) {
                    const hosts = await this.namingClient.getAllInstances(serviceName, this.getGroup(), '', true)
                    this.setHosts(serviceName, hosts)
                    healthyHosts = this.getHealthyHosts(serviceName)
                }

                if (healthyHosts.length > 0) {
                    const cursor = this.cursors.get(serviceName) ?? 0
                    const host = healthyHosts[cursor % healthyHosts.length]
                    this.cursors.set(serviceName, cursor + 1)
                    return this.toTargetUrl(host)
                }
            } catch (error) {
                this.logger.warn(`查询服务 ${serviceName} 失败，使用后备地址：${this.getErrorMessage(error)}`)
            }
        }

        return fallbackUrl
    }

    getStatus(): NacosStatus {
        return {
            configEnabled: this.isConfigEnabled(),
            configLoaded: this.configLoaded,
            discoveryEnabled: this.isDiscoveryEnabled(),
            connected: this.connected,
            registered: this.registered,
            ...(this.configError ? { configError: this.configError } : {}),
            ...(this.discoveryError ? { discoveryError: this.discoveryError } : {})
        }
    }

    getHealthyInstanceCount(serviceName: string): number {
        return this.getHealthyHosts(serviceName).length
    }

    private async initializeRemoteConfig(): Promise<void> {
        if (!this.isConfigEnabled()) {
            this.logger.warn('Nacos 配置中心已关闭，将使用环境变量后备配置')
            return
        }

        try {
            this.configClient = new NacosConfigClient({
                serverAddr: this.configService.get<string>('NACOS_SERVER', '127.0.0.1:8848'),
                namespace: this.configService.get<string>('NACOS_NAMESPACE', 'public'),
                username: this.configService.get<string>('NACOS_USERNAME') || undefined,
                password: this.configService.get<string>('NACOS_PASSWORD') || undefined,
                requestTimeout: 5000
            })

            const subscription = this.getConfigSubscription()
            const content = await this.configClient.getConfig(subscription.dataId, subscription.group)
            this.applyRemoteConfig(content, '已加载')

            this.configListener = nextContent => {
                try {
                    if (!this.applyRemoteConfig(nextContent, '已更新')) {
                        return
                    }
                    void this.refreshRouteSubscriptions().catch(error => {
                        this.logger.error(`刷新服务订阅失败：${this.getErrorMessage(error)}`)
                    })
                } catch (error) {
                    this.logger.error(`无效的 Nacos 网关配置更新已被拒绝：${this.getErrorMessage(error)}`)
                }
            }
            this.configClient.subscribe(subscription, this.configListener)
            this.configLoaded = true
        } catch (error) {
            this.configError = this.getErrorMessage(error)
            this.logger.error(`加载 Nacos 网关配置失败：${this.configError}`)
            if (getBoolean(this.configService.get('NACOS_CONFIG_REQUIRED'), true)) {
                throw error
            }
            this.logger.warn('Nacos 配置非必需，网关将继续使用环境变量后备配置')
        }
    }

    private async initializeDiscovery(): Promise<void> {
        if (!this.isDiscoveryEnabled()) {
            this.logger.warn('Nacos 服务发现已关闭，将使用各服务的后备地址')
            return
        }

        try {
            this.namingClient = new NacosNamingClient({
                logger: this.createNacosClientLogger(),
                serverList: this.configService.get<string>('NACOS_SERVER', '127.0.0.1:8848'),
                namespace: this.configService.get<string>('NACOS_NAMESPACE', 'public'),
                username: this.configService.get<string>('NACOS_USERNAME') || undefined,
                password: this.configService.get<string>('NACOS_PASSWORD') || undefined
            }) as ClosableNacosNamingClient
            await this.namingClient.ready()
            this.connected = true

            await this.refreshRouteSubscriptions()
            await this.registerGateway()
            this.logger.log('已连接 Nacos 服务发现')
        } catch (error) {
            this.discoveryError = this.getErrorMessage(error)
            this.connected = false
            this.logger.error(`连接 Nacos 服务发现失败：${this.discoveryError}`)

            if (
                getBoolean(this.configService.get('nacos.discovery.required') ?? this.configService.get('NACOS_DISCOVERY_REQUIRED'), false)
            ) {
                throw error
            }
            this.logger.warn('Nacos 服务发现非必需，网关将继续使用服务后备地址')
        }
    }

    private applyRemoteConfig(content: string, action: '已加载' | '已更新'): boolean {
        if (!content?.trim()) {
            const subscription = this.getConfigSubscription()
            throw new Error(`Nacos 配置为空或不存在：dataId=${subscription.dataId}, group=${subscription.group}`)
        }
        if (content === this.currentConfigContent) {
            return false
        }

        const parsed = yaml.load(content)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Nacos 配置根节点必须是 YAML 对象')
        }

        const config = parsed as Record<string, unknown>
        validateRemoteConfig(config)

        for (const key of this.remoteConfigKeys) {
            if (!(key in config)) {
                this.configService.set(key, undefined)
            }
        }
        for (const [key, value] of Object.entries(config)) {
            this.configService.set(key, value)
        }

        this.remoteConfigKeys.clear()
        Object.keys(config).forEach(key => this.remoteConfigKeys.add(key))
        this.currentConfigContent = content
        this.configError = undefined

        const subscription = this.getConfigSubscription()
        this.logger.log(`Nacos 网关配置${action}：dataId=${subscription.dataId}, group=${subscription.group}`)
        return true
    }

    private async refreshRouteSubscriptions(): Promise<void> {
        if (!this.namingClient) {
            return
        }

        const serviceNames = new Set(this.serviceConfig.getGatewayRoutes().map(route => route.serviceName))
        for (const [serviceName, listener] of this.namingListeners) {
            if (serviceNames.has(serviceName)) {
                continue
            }
            this.namingClient.unSubscribe({ serviceName, groupName: this.getGroup() }, listener)
            this.namingListeners.delete(serviceName)
            this.hosts.delete(serviceName)
            this.cursors.delete(serviceName)
        }

        for (const serviceName of serviceNames) {
            if (this.namingListeners.has(serviceName)) {
                continue
            }

            const initialHosts = await this.namingClient.getAllInstances(serviceName, this.getGroup(), '', true)
            this.setHosts(serviceName, initialHosts)
            const listener = (hosts: Host[]) => this.setHosts(serviceName, hosts)
            this.namingListeners.set(serviceName, listener)
            this.namingClient.subscribe({ serviceName, groupName: this.getGroup() }, listener)
        }
    }

    private async registerGateway(): Promise<void> {
        if (
            !this.namingClient ||
            !getBoolean(this.configService.get('nacos.registration.enabled') ?? this.configService.get('NACOS_REGISTER_ENABLED'), true)
        ) {
            return
        }

        const instance = {
            ip: this.resolveRegisterIp(),
            port: getPort(this.configService.get('NACOS_REGISTER_PORT') ?? this.serviceConfig.getServerPort(), 3999, 'NACOS_REGISTER_PORT')
        }

        await this.namingClient.registerInstance(
            this.getGatewayServiceName(),
            {
                instanceId: '',
                healthy: true,
                enabled: true,
                ephemeral: true,
                ...instance
            },
            this.getGroup()
        )
        this.registeredInstance = instance
        this.registered = true
        this.logger.log(`网关已注册到 Nacos：${this.getGatewayServiceName()} ${instance.ip}:${instance.port}`)
    }

    private setHosts(serviceName: string, hosts: Host[]): void {
        this.hosts.set(serviceName, hosts)
        this.logger.log(`服务实例已刷新：${serviceName}，健康实例=${this.getHealthyHosts(serviceName).length}`)
    }

    private getHealthyHosts(serviceName: string): Host[] {
        return (this.hosts.get(serviceName) ?? []).filter(
            host => host.healthy && host.enabled && (host.weight === undefined || host.weight > 0)
        )
    }

    private toTargetUrl(host: Host): string {
        const protocol = host.metadata?.protocol === 'https' ? 'https' : 'http'
        const hostname = host.ip.includes(':') ? `[${host.ip}]` : host.ip
        return `${protocol}://${hostname}:${host.port}`
    }

    private resolveRegisterIp(): string {
        const configuredIp = this.configService.get<string>('NACOS_REGISTER_IP')?.trim()
        if (configuredIp) {
            return configuredIp
        }

        for (const addresses of Object.values(networkInterfaces())) {
            const address = addresses?.find(item => item.family === 'IPv4' && !item.internal)
            if (address) {
                return address.address
            }
        }
        return '127.0.0.1'
    }

    private getConfigSubscription(): { dataId: string; group: string } {
        return {
            dataId: getString(this.configService.get('NACOS_CONFIG_DATA_ID'), 'chat-web-gateway-service.yaml'),
            group: getString(this.configService.get('NACOS_CONFIG_GROUP'), this.getGroup())
        }
    }

    private getGroup(): string {
        return getString(this.configService.get('nacos.discovery.group') ?? this.configService.get('NACOS_GROUP'), 'DEFAULT_GROUP')
    }

    private getGatewayServiceName(): string {
        return getString(
            this.configService.get('nacos.registration.serviceName') ?? this.configService.get('NACOS_SERVICE_NAME'),
            'chat-web-gateway-service'
        )
    }

    private isConfigEnabled(): boolean {
        return getBoolean(this.configService.get('NACOS_CONFIG_ENABLED'), true)
    }

    private isDiscoveryEnabled(): boolean {
        return getBoolean(this.configService.get('nacos.discovery.enabled') ?? this.configService.get('NACOS_DISCOVERY_ENABLED'), true)
    }

    private createNacosClientLogger(): typeof console {
        const clientLogger = Object.create(console) as typeof console
        clientLogger.log = () => undefined
        clientLogger.info = () => undefined
        clientLogger.debug = () => undefined
        return clientLogger
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error)
    }
}
