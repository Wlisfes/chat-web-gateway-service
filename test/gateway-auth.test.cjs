const test = require('node:test')
const assert = require('node:assert/strict')

const { GatewayAuthService } = require('../dist/modules/auth/gateway-auth.service')

function createService(overrides = {}) {
    const options = {
        enabled: true,
        accountServiceName: 'chat-web-account-service',
        accountFallbackUrl: 'http://127.0.0.1:5010',
        introspectionPath: '/internal/auth/token/introspect',
        timeoutMs: 3000,
        serviceToken: 'internal-token',
        publicPaths: ['/api/account/auth/token/login'],
        ...overrides
    }
    const config = {
        getGatewayAuthOptions: () => options,
        getGatewayRoutes: () => [
            {
                id: 'account',
                prefix: '/api/account',
                serviceName: 'chat-web-account-service',
                fallbackUrl: 'http://127.0.0.1:5010',
                enabled: true
            }
        ]
    }
    const nacos = { resolveService: async () => 'http://127.0.0.1:5010' }
    return new GatewayAuthService(config, nacos)
}

test('网关认证跳过配置的公开接口', async () => {
    const service = createService()
    const originalFetch = global.fetch
    global.fetch = async () => {
        throw new Error('公开接口不应请求 Account')
    }
    try {
        const request = { method: 'POST', originalUrl: '/api/account/auth/token/login' }
        assert.equal(await service.authenticate(request), undefined)
    } finally {
        global.fetch = originalFetch
    }
})

test('网关认证拒绝缺少 Bearer Token 的业务请求', async () => {
    const service = createService()
    await assert.rejects(
        service.authenticate({ method: 'GET', originalUrl: '/api/account/user/resolver', header: () => undefined }),
        error => error?.status === 401
    )
})

test('网关认证使用独立服务凭据调用 Account 并写入身份主体', async () => {
    const service = createService()
    const originalFetch = global.fetch
    let requestInit
    global.fetch = async (_url, init) => {
        requestInit = init
        return new Response(JSON.stringify({ code: 200, message: 'success', data: { uid: '1001', sessionId: 'session-1' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })
    }
    try {
        const request = {
            method: 'GET',
            originalUrl: '/api/account/user/resolver',
            header: name => {
                if (name === 'authorization') return 'Bearer user-token'
                if (name === 'x-request-id') return 'request-1'
                return undefined
            }
        }
        const principal = await service.authenticate(request)
        assert.deepEqual(principal, { uid: '1001', sessionId: 'session-1' })
        assert.deepEqual(request.user, principal)
        assert.equal(requestInit.headers['x-service-token'], 'internal-token')
        assert.equal(requestInit.headers['x-request-id'], 'request-1')
        assert.deepEqual(JSON.parse(requestInit.body), { token: 'user-token' })
    } finally {
        global.fetch = originalFetch
    }
})
