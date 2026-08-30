const test = require('node:test')
const assert = require('node:assert/strict')

const { removeDownstreamCorsHeaders } = require('../dist/modules/gateway/gateway-proxy.service')

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
