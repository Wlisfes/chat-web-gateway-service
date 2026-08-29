'use strict'

function required(name) {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Missing environment variable: ${name}`)
    return value
}

function getBaseUrl() {
    const server = required('NACOS_SERVER')
    return (/^https?:\/\//i.test(server) ? server : `http://${server}`).replace(/\/$/, '')
}

async function getNacosAccessToken(baseUrl) {
    const username = process.env.NACOS_USERNAME?.trim()
    const password = process.env.NACOS_PASSWORD
    if (!username || password === undefined) return undefined

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/nacos/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password })
    })
    if (!response.ok) throw new Error(`Nacos 鉴权失败：HTTP ${response.status}`)
    const result = await response.json()
    if (typeof result.accessToken !== 'string' || !result.accessToken.trim()) {
        throw new Error('Nacos 鉴权响应缺少 accessToken')
    }
    return result.accessToken
}

async function configParameters() {
    const parameters = new URLSearchParams({
        dataId: required('NACOS_CONFIG_DATA_ID'),
        group: process.env.NACOS_CONFIG_GROUP?.trim() || process.env.NACOS_GROUP?.trim() || 'DEFAULT_GROUP',
        tenant: process.env.NACOS_NAMESPACE?.trim() || 'public'
    })
    const accessToken = await getNacosAccessToken(getBaseUrl())
    if (accessToken) parameters.set('accessToken', accessToken)
    return parameters
}

function migrateRoutePrefixes(content) {
    let migrated = content
        .replace(/^([ \t]*prefix:[ \t]*)['"]?\/api\/windows\/finance['"]?[ \t]*$/gm, '$1/api/finance')
        .replace(/^([ \t]*prefix:[ \t]*)['"]?\/api['"]?[ \t]*$/gm, '$1/api/account')
    if (!/^[ \t]*prefix:[ \t]*['"]?\/api\/crm['"]?[ \t]*$/m.test(migrated)) {
        const crmRoute =
            '        - id: crm\n' +
            '          prefix: /api/crm\n' +
            '          serviceName: chat-web-crm-service\n' +
            '          fallbackUrl: http://chat-web-crm-service:5020\n' +
            '          enabled: true\n'
        if (!/^nacos:\s*$/m.test(migrated)) throw new Error('Gateway Nacos config must contain the root nacos section')
        migrated = migrated.replace(/^(nacos:\s*)$/m, `${crmRoute}\n$1`)
    }
    if (!/^[ \t]*prefix:[ \t]*['"]?\/api\/finance['"]?[ \t]*$/m.test(migrated)) {
        throw new Error('Gateway Nacos config must contain the Finance prefix /api/finance')
    }
    if (!/^[ \t]*prefix:[ \t]*['"]?\/api\/account['"]?[ \t]*$/m.test(migrated)) {
        throw new Error('Gateway Nacos config must contain the Account prefix /api/account')
    }
    if (!/^[ \t]*prefix:[ \t]*['"]?\/api\/crm['"]?[ \t]*$/m.test(migrated)) {
        throw new Error('Gateway Nacos config must contain the CRM prefix /api/crm')
    }
    if (/^[ \t]*prefix:[ \t]*['"]?\/api['"]?[ \t]*$/m.test(migrated)) {
        throw new Error('Gateway Nacos config must not contain the root prefix /api')
    }
    return migrated
}

async function main() {
    const parameters = await configParameters()
    const response = await fetch(`${getBaseUrl()}/nacos/v1/cs/configs?${parameters}`)
    if (!response.ok) throw new Error(`Unable to read Gateway Nacos config: HTTP ${response.status}`)
    const content = await response.text()
    const migrated = migrateRoutePrefixes(content)
    if (migrated === content) {
        process.stdout.write('Gateway Nacos route prefixes already current\n')
        return
    }

    const body = await configParameters()
    body.set('type', 'yaml')
    body.set('content', migrated)
    const publish = await fetch(`${getBaseUrl()}/nacos/v1/cs/configs`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
    })
    if (!publish.ok || (await publish.text()).trim() !== 'true') {
        throw new Error(`Unable to publish Gateway Nacos config: HTTP ${publish.status}`)
    }
    process.stdout.write('Gateway Nacos route prefixes migrated\n')
}

if (require.main === module || process.env.RUN_NACOS_ROUTE_MIGRATION === '1') {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
    })
}

module.exports = { migrateRoutePrefixes }
