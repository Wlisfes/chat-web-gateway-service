const test = require('node:test')
const assert = require('node:assert/strict')

const { migrateGatewayConfig, migrateManagerCors } = require('../deploy/migrate-nacos-routes.cjs')

test('Nacos 迁移会为跨域 API 补充管理端页面 Origin', () => {
    const content = [
        'gateway:',
        '    cors:',
        '        allowedOrigins:',
        '            - https://old.example.com',
        '        credentials: false',
        '    routes:',
        '        - id: account',
        '          prefix: /api/account',
        '          serviceName: chat-web-account-service',
        '          fallbackUrl: http://chat-web-account-service:5010',
        '          enabled: true',
        'nacos:',
        '    discovery:',
        '        enabled: true'
    ].join('\n')

    const migrated = migrateManagerCors(content)

    assert.match(migrated, /allowedOrigins:\n {12}- https:\/\/chat\.lisfes\.cn\n {12}- https:\/\/old\.example\.com/)
    assert.match(migrated, / {8}credentials: true/)
})

test('Nacos 迁移会在缺少 CORS 时创建跨域配置', () => {
    const content = [
        'gateway:',
        '    routes:',
        '        - id: account',
        '          prefix: /api/account',
        '          serviceName: chat-web-account-service',
        '          fallbackUrl: http://chat-web-account-service:5010',
        '          enabled: true',
        'nacos:',
        '    discovery:',
        '        enabled: true'
    ].join('\n')

    const migrated = migrateManagerCors(content)

    assert.match(migrated, / {4}cors:\n {8}allowedOrigins:\n {12}- https:\/\/chat\.lisfes\.cn\n {8}credentials: true\n {4}routes:/)
})

test('Nacos 迁移启用 credentials 时不会保留星号 Origin', () => {
    const content = [
        'gateway:',
        '    cors:',
        '        allowedOrigins:',
        '            - *',
        '        credentials: false',
        '    routes:',
        '        - id: account',
        '          prefix: /api/account',
        '          serviceName: chat-web-account-service',
        '          fallbackUrl: http://chat-web-account-service:5010',
        '          enabled: true',
        'nacos:',
        '    discovery:',
        '        enabled: true'
    ].join('\n')

    const migrated = migrateManagerCors(content)

    assert.doesNotMatch(migrated, /-\s*\*/)
    assert.match(migrated, / {12}- https:\/\/chat\.lisfes\.cn/)
    assert.match(migrated, / {8}credentials: true/)
})

test('完整迁移同时维护路由前缀和 CORS', () => {
    const content = [
        'gateway:',
        '    cors:',
        '        allowedOrigins:',
        '            - https://old.example.com',
        '        credentials: false',
        '    routes:',
        '        - id: account',
        '          prefix: /api',
        '          serviceName: chat-web-account-service',
        '          fallbackUrl: http://chat-web-account-service:5010',
        '          enabled: true',
        '        - id: finance',
        '          prefix: /api/windows/finance',
        '          serviceName: chat-web-finance-service',
        '          fallbackUrl: http://chat-web-finance-service:5030',
        '          enabled: true',
        'nacos:',
        '    discovery:',
        '        enabled: true'
    ].join('\n')

    const migrated = migrateGatewayConfig(content)

    assert.match(migrated, /prefix: \/api\/account/)
    assert.match(migrated, /prefix: \/api\/finance/)
    assert.match(migrated, /prefix: \/api\/crm/)
    assert.match(migrated, /prefix: \/api\/skyline/)
    assert.match(migrated, / {12}- https:\/\/chat\.lisfes\.cn/)
    assert.match(migrated, / {8}credentials: true/)
})
