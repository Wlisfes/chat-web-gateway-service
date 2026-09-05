const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { Logger } = require('@nestjs/common')

const { GatewayProxyService, removeDownstreamCorsHeaders } = require('../dist/modules/gateway/gateway-proxy.service')

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
            resolveService: async () => targetUrl
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
        await fetch(`${gatewayUrl}/feign/account/consumer/resolver?keyId=12`).then(response => response.json())
        assert.equal(received.url, '/feign/account/consumer/resolver?keyId=12')
        assert.equal(received.principal, undefined)
    } finally {
        await Promise.all([close(gatewayServer), close(downstreamServer)])
    }
})
