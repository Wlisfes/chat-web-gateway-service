const test = require('node:test')
const assert = require('node:assert/strict')

const { getCorsOptions } = require('../dist/config/environment')

test('管理端跨域配置允许凭据和 Platform 请求头', () => {
    const options = getCorsOptions(['https://chat.lisfes.cn'], true)

    assert.deepEqual(options.origin, ['https://chat.lisfes.cn'])
    assert.equal(options.credentials, true)
    assert.ok(options.allowedHeaders.includes('Platform'))
})
