export interface NacosRegisteredInstance {
    ip: string
    port: number
}

export interface NacosStatus {
    configEnabled: boolean
    configLoaded: boolean
    discoveryEnabled: boolean
    connected: boolean
    registered: boolean
    configError?: string
    discoveryError?: string
}
