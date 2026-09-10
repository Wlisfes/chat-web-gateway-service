const test = require('node:test')
const assert = require('node:assert/strict')
const { Logger } = require('@nestjs/common')

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
