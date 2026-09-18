const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { Logger } = require('@nestjs/common')

const {
    GatewayProxyService,
    isRoutableNacosInstance,
    removeDownstreamCorsHeaders,
    resolveGatewayBusinessStatusCode
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
        assert.equal(response.headers.get('x-business-code'), '503')
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

test('网关按业务码而不是 HTTP status 判定转发结果', () => {
    assert.equal(resolveGatewayBusinessStatusCode({ 'x-business-code': '500' }, 200), 500)
    assert.equal(resolveGatewayBusinessStatusCode({}, 200, '{"data":null,"code":500,"message":"服务器内部错误"}'), 500)
    assert.equal(resolveGatewayBusinessStatusCode({}, 200, '{"data":null,"code":200,"message":"success"}'), 200)
    assert.equal(resolveGatewayBusinessStatusCode({}, 502), 502)
})

test('网关转发 HTTP 200 但业务码非 200 时记录 ERROR', async () => {
    const route = {
        id: 'auth',
        prefix: '/api/auth',
        serviceName: 'chat-web-auth-service',
        fallbackUrl: 'http://127.0.0.1:5050',
        enabled: true,
        stripPrefix: true
    }
    const downstreamApplication = express()
    downstreamApplication.use((_request, response) => {
        response.status(200).json({ data: null, code: 500, message: '服务器内部错误' })
    })
    const downstreamServer = await listen(downstreamApplication)
    const targetUrl = 'http://127.0.0.1:' + downstreamServer.address().port
    const gatewayService = new GatewayProxyService(
        {
            getProxyTimeout: () => 500,
            getGatewayRoutes: () => [route]
        },
        { resolveService: async () => targetUrl }
    )
    const gatewayApplication = express()
    gatewayService.mount(gatewayApplication)
    gatewayService.initialize()
    const gatewayServer = await listen(gatewayApplication)
    const gatewayUrl = 'http://127.0.0.1:' + gatewayServer.address().port
    const originalLog = Logger.prototype.log
    const originalError = Logger.prototype.error
    const logs = []
    const errors = []

    try {
        Logger.prototype.log = message => logs.push(message)
        Logger.prototype.error = message => errors.push(message)
        const body = await fetch(gatewayUrl + '/api/auth/token/login', { method: 'POST' }).then(response => response.json())
        assert.equal(body.code, 500)
        const proxyErrors = errors.filter(message => typeof message === 'string' && message.includes('chat-web-auth-service'))
        const proxyLogs = logs.filter(message => typeof message === 'string' && message.includes('chat-web-auth-service'))
        assert.equal(proxyLogs.length, 0)
        assert.equal(proxyErrors.length, 1)
        assert.match(proxyErrors[0], /POST \/api\/auth\/token\/login -> chat-web-auth-service 500 /)
    } finally {
        Logger.prototype.log = originalLog
        Logger.prototype.error = originalError
        await Promise.all([close(gatewayServer), close(downstreamServer)])
    }
})

const { createGatewayRequestLoggingMiddleware } = require('../dist/modules/gateway/gateway-request-logging.middleware')

test('网关入口静默探活与 Swagger JSON，同时保留业务请求日志', () => {
    const messages = []
    const originalLog = Logger.prototype.log
    Logger.prototype.log = message => messages.push(message)

    try {
        const middleware = createGatewayRequestLoggingMiddleware('chat-web-gateway-service')
        const silentPaths = [
            '/health',
            '/health/live',
            '/health/ready',
            '/api/swagger-json',
            '/api/account/health/live',
            '/api/account/api/swagger-json',
            '/feign/account/api/swagger-json'
        ]

        for (const path of silentPaths) {
            const { request, response } = createHttpContext(path)
            middleware(request, response, () => undefined)
            assert.equal(response.finish, undefined, `${path} 不应注册完成日志`)
        }

        const { request, response } = createHttpContext('/api/account/sheet/column')
        middleware(request, response, () => undefined)
        assert.equal(typeof response.finish, 'function')
        response.finish()
    } finally {
        Logger.prototype.log = originalLog
    }

    assert.equal(messages.length, 1)
    assert.equal(messages[0].url, '/api/account/sheet/column')
})

function createHttpContext(path) {
    return {
        request: {
            headers: {},
            method: 'POST',
            originalUrl: path,
            path,
            query: {},
            params: {},
            body: {},
            ip: '127.0.0.1',
            socket: {}
        },
        response: {
            statusCode: 200,
            setHeader() {},
            once(_name, listener) {
                this.finish = listener
            }
        }
    }
}

const { createKnife4jServices } = require('../dist/modules/gateway/knife4j-services')

test('Knife4j 只聚合每个服务的一份公开 API 文档', () => {
    const routes = [
        route('account', '/api/account', 'chat-web-account-service'),
        route('feign-account', '/feign/account', 'chat-web-account-service'),
        route('account-alias', '/api/account-alias', 'chat-web-account-service'),
        route('finance', '/api/finance', 'chat-web-finance-service'),
        route('feign-finance', '/feign/finance', 'chat-web-finance-service'),
        route('auth-legacy', '/api/account/auth', 'chat-web-auth-service'),
        route('auth', '/api/auth', 'chat-web-auth-service'),
        { ...route('disabled', '/api/disabled', 'chat-web-disabled-service'), enabled: false }
    ]

    assert.deepEqual(createKnife4jServices(routes), [
        {
            name: '网关服务',
            url: '/api/swagger-json',
            swaggerVersion: '3.0.0',
            location: '/api/swagger'
        },
        {
            name: 'chat-web-account-service',
            url: '/api/account/api/swagger-json',
            swaggerVersion: '3.0.0',
            location: '/api/account/api/swagger',
            servicePath: '/api/account'
        },
        {
            name: 'chat-web-finance-service',
            url: '/api/finance/api/swagger-json',
            swaggerVersion: '3.0.0',
            location: '/api/finance/api/swagger',
            servicePath: '/api/finance'
        },
        {
            name: 'chat-web-auth-service',
            url: '/api/auth/api/swagger-json',
            swaggerVersion: '3.0.0',
            location: '/api/auth/api/swagger',
            servicePath: '/api/auth'
        }
    ])
})

function route(id, prefix, serviceName) {
    return {
        id,
        prefix,
        serviceName,
        fallbackUrl: 'http://127.0.0.1:5001',
        enabled: true,
        stripPrefix: prefix.startsWith('/api/')
    }
}
