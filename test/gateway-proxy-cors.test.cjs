const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { Logger } = require('@nestjs/common')

const {
    GatewayProxyService,
    isRoutableNacosInstance,
    removeDownstreamCorsHeaders
} = require('../dist/modules/gateway/gateway-proxy.service')
const { shouldLogGatewayRequestPath } = require('../dist/modules/gateway/gateway-request-logging.middleware')

function listen(application) {
    return new Promise((resolve, reject) => {
        const server = application.listen(0, '127.0.0.1', () => resolve(server))
        server.once('error', reject)
    })
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
    })
}

test('网关不会透传下游服务的跨域响应头', () => {
    const proxyResponse = {
        headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-credentials': 'true',
            'access-control-expose-headers': 'X-Downstream-Header',
            'content-type': 'application/json; charset=utf-8'
        }
    }

    removeDownstreamCorsHeaders(proxyResponse)

    assert.deepEqual(proxyResponse.headers, {
        'content-type': 'application/json; charset=utf-8'
    })
})

test('网关代理不记录探活和 Swagger JSON 转发日志', () => {
    const silentPaths = [
        '/api/account/health',
        '/api/account/health/live',
        '/api/account/health/ready',
        '/api/account/api/swagger-json',
        '/feign/account/api/swagger-json?refresh=1'
    ]

    for (const path of silentPaths) {
        assert.equal(shouldLogGatewayRequestPath(path), false, `${path} 不应记录转发日志`)
    }
    assert.equal(shouldLogGatewayRequestPath('/api/account/sheet/column'), true)
    assert.equal(shouldLogGatewayRequestPath('/api/account/health/detail'), true)
})

test('网关向下游传递服务前缀且代理错误日志保留完整公开路径', async () => {
    const route = {
        id: 'account',
        prefix: '/api/account',
        serviceName: 'chat-web-account-service',
        fallbackUrl: 'http://127.0.0.1:5010',
        enabled: true,
        stripPrefix: true
    }
    let targetUrl
    let forwardedPrefix
    let resolvedFallback
    const downstreamApplication = express()
    downstreamApplication.use((request, response) => {
        forwardedPrefix = request.headers['x-forwarded-prefix']
        response.json({ url: request.originalUrl })
    })
    const downstreamServer = await listen(downstreamApplication)
    targetUrl = `http://127.0.0.1:${downstreamServer.address().port}`

    const gatewayService = new GatewayProxyService(
        {
            getProxyTimeout: () => 500,
            getGatewayRoutes: () => [route]
        },
        {
            resolveService: async (_serviceName, fallbackUrl) => {
                resolvedFallback = fallbackUrl
                return targetUrl
            }
        }
    )
    const gatewayApplication = express()
    gatewayService.mount(gatewayApplication)
    gatewayService.initialize()
    const gatewayServer = await listen(gatewayApplication)
    const gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`
    const originalError = Logger.prototype.error
    const errors = []

    try {
        const proxyResponse = await fetch(`${gatewayUrl}/api/account/sheet/update?source=manager`).then(response => response.json())
        assert.equal(forwardedPrefix, '/api/account')
        assert.equal(proxyResponse.url, '/sheet/update?source=manager')
        assert.equal(resolvedFallback, '')

        Logger.prototype.error = message => errors.push(message)
        targetUrl = 'http://127.0.0.1:1'
        await fetch(`${gatewayUrl}/api/account/sheet/update?source=error`).then(response => response.json())

        assert.equal(errors.length, 1)
        assert.match(errors[0], /^GET \/api\/account\/sheet\/update\?source=error -> chat-web-account-service：/)
    } finally {
        Logger.prototype.error = originalError
        await Promise.all([close(gatewayServer), close(downstreamServer)])
    }
})

test('Nacos 没有可用实例时网关返回服务不可用业务码', async () => {
    const route = {
        id: 'account',
        prefix: '/api/account',
        serviceName: 'chat-web-account-service',
        fallbackUrl: 'http://127.0.0.1:5010',
        enabled: true,
        stripPrefix: true
    }
    const gatewayService = new GatewayProxyService(
        {
            getProxyTimeout: () => 500,
            getGatewayRoutes: () => [route]
        },
        {
            resolveService: async () => {
                throw new Error('Nacos 服务 chat-web-account-service 没有可用实例')
            }
        }
    )
    const gatewayApplication = express()
    gatewayService.mount(gatewayApplication)
    gatewayService.initialize()
    const gatewayServer = await listen(gatewayApplication)
    const gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`

    try {
        const response = await fetch(`${gatewayUrl}/api/account/sheet/column`)
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.data, null)
        assert.equal(body.code, 503)
        assert.equal(body.message, '服务 account 暂时不可用')
    } finally {
        await close(gatewayServer)
    }
})

test('服务间路由保留 /feign 前缀并下发签名身份上下文', async () => {
    const route = {
        id: 'feign-account',
        prefix: '/feign/account',
        serviceName: 'chat-web-account-service',
        fallbackUrl: 'http://127.0.0.1:5010',
        enabled: true,
        stripPrefix: false
    }
    let received
    const downstreamApplication = express()
    downstreamApplication.use((request, response) => {
        received = { url: request.originalUrl, principal: request.headers['x-gateway-principal'] }
        response.json({ ok: true })
    })
    const downstreamServer = await listen(downstreamApplication)
    const targetUrl = `http://127.0.0.1:${downstreamServer.address().port}`

    const gatewayService = new GatewayProxyService(
        {
            getProxyTimeout: () => 500,
            getGatewayRoutes: () => [route],
            signPrincipal: principal => `signed:${principal.uid}`
        },
        { resolveService: async () => targetUrl }
    )
    const gatewayApplication = express()
    gatewayService.mount(gatewayApplication)
    gatewayService.initialize()
    const gatewayServer = await listen(gatewayApplication)
    const gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`

    try {
        // 服务间调用不经过用户认证，因此不下发身份上下文。
        await fetch(`${gatewayUrl}/feign/account/consumer/resolve?keyId=12`).then(response => response.json())
        assert.equal(received.url, '/feign/account/consumer/resolve?keyId=12')
        assert.equal(received.principal, undefined)
    } finally {
        await Promise.all([close(gatewayServer), close(downstreamServer)])
    }
})

test('网关将缺失健康标记视为可路由，并将 enabled=false 视为下线', () => {
    assert.equal(isRoutableNacosInstance({ ip: '10.0.0.1', port: 5050 }), true)
    assert.equal(isRoutableNacosInstance({ healthy: true, enabled: 'false', weight: 1 }), false)
    assert.equal(isRoutableNacosInstance({ healthy: 'true', enabled: 'true', weight: '0' }), false)
    assert.equal(isRoutableNacosInstance({ healthy: true, enabled: true, weight: 2 }), true)
})

test('Nacos 实例全部下线时网关不走后备地址并返回 503', async () => {
    const route = {
        id: 'auth',
        prefix: '/api/auth',
        serviceName: 'chat-web-auth-service',
        fallbackUrl: 'http://chat-web-auth-service:5050',
        fallbackEnabled: false,
        enabled: true,
        stripPrefix: true
    }
    let resolveCalls = 0
    const gatewayService = new GatewayProxyService(
        {
            getProxyTimeout: () => 500,
            getGatewayRoutes: () => [route]
        },
        {
            getAllInstances: async () => [],
            resolveService: async () => {
                resolveCalls += 1
                return route.fallbackUrl
            }
        }
    )
    const gatewayApplication = express()
    gatewayService.mount(gatewayApplication)
    gatewayService.initialize()
    const gatewayServer = await listen(gatewayApplication)
    const gatewayUrl = 'http://127.0.0.1:' + gatewayServer.address().port

    try {
        const response = await fetch(gatewayUrl + '/api/auth/codex/write?inverse=0')
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.data, null)
        assert.equal(body.code, 503)
        assert.equal(body.message, '服务 auth 暂时不可用')
        assert.equal(resolveCalls, 0)
    } finally {
        await close(gatewayServer)
    }
})

test('多个实例仅部分在线时网关继续转发到服务发现结果', async () => {
    const route = {
        id: 'auth',
        prefix: '/api/auth',
        serviceName: 'chat-web-auth-service',
        fallbackUrl: 'http://chat-web-auth-service:5050',
        fallbackEnabled: false,
        enabled: true,
        stripPrefix: true
    }
    let received
    const downstreamApplication = express()
    downstreamApplication.use((request, response) => {
        received = request.originalUrl
        response.json({ ok: true })
    })
    const downstreamServer = await listen(downstreamApplication)
    const targetUrl = 'http://127.0.0.1:' + downstreamServer.address().port
    const gatewayService = new GatewayProxyService(
        {
            getProxyTimeout: () => 500,
            getGatewayRoutes: () => [route]
        },
        {
            getAllInstances: async () => [
                { ip: '10.0.0.12', port: 5050, healthy: true, enabled: false, weight: 1 },
                { ip: '10.0.0.13', port: 5050, healthy: true, enabled: true, weight: 1 }
            ],
            resolveService: async () => targetUrl
        }
    )
    const gatewayApplication = express()
    gatewayService.mount(gatewayApplication)
    gatewayService.initialize()
    const gatewayServer = await listen(gatewayApplication)
    const gatewayUrl = 'http://127.0.0.1:' + gatewayServer.address().port

    try {
        const body = await fetch(gatewayUrl + '/api/auth/codex/write').then(response => response.json())
        assert.equal(body.ok, true)
        assert.equal(received, '/codex/write')
    } finally {
        await Promise.all([close(gatewayServer), close(downstreamServer)])
    }
})
