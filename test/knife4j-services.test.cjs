const test = require('node:test')
const assert = require('node:assert/strict')

const { createKnife4jServices } = require('../dist/modules/gateway/knife4j-services')

test('Knife4j 只聚合每个服务的一份公开 API 文档', () => {
    const routes = [
        route('account', '/api/account', 'chat-web-account-service'),
        route('feign-account', '/feign/account', 'chat-web-account-service'),
        route('account-alias', '/api/account-alias', 'chat-web-account-service'),
        route('finance', '/api/finance', 'chat-web-finance-service'),
        route('feign-finance', '/feign/finance', 'chat-web-finance-service'),
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
