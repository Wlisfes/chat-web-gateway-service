'use strict'

const MANAGER_ORIGIN = 'https://chat.lisfes.cn'

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

/** 服务间路由清单；与共享 Feign 客户端声明的 `/feign/<服务名>` 前缀一一对应。 */
const FEIGN_ROUTES = [
    {
        id: 'feign-account',
        prefix: '/feign/account',
        serviceName: 'chat-web-account-service',
        fallbackUrl: 'http://chat-web-account-service:5010'
    },
    {
        id: 'feign-finance',
        prefix: '/feign/finance',
        serviceName: 'chat-web-finance-service',
        fallbackUrl: 'http://chat-web-finance-service:5030'
    },
    { id: 'feign-crm', prefix: '/feign/crm', serviceName: 'chat-web-crm-service', fallbackUrl: 'http://chat-web-crm-service:5020' },
    {
        id: 'feign-skyline',
        prefix: '/feign/skyline',
        serviceName: 'chat-web-skyline-service',
        fallbackUrl: 'http://chat-web-skyline-service:5040'
    }
]

/** 幂等地补齐一条网关路由；已存在同前缀配置时保持人工维护的内容不变。 */
function ensureRoute(content, route) {
    const pattern = new RegExp(`^[ \\t]*prefix:[ \\t]*['"]?${route.prefix.replace(/\//g, '\\/')}['"]?[ \\t]*$`, 'm')
    if (pattern.test(content)) return content

    const lines = [
        `    - id: ${route.id}`,
        `      prefix: ${route.prefix}`,
        `      serviceName: ${route.serviceName}`,
        `      fallbackUrl: ${route.fallbackUrl}`,
        '      enabled: true'
    ]
    if (route.stripPrefix === false) lines.push('      stripPrefix: false')

    const nacosIndex = content.search(/^nacos:\s*$/m)
    if (nacosIndex < 0) throw new Error('Gateway Nacos config must contain the root nacos section')
    return `${content.slice(0, nacosIndex)}${lines.join('\n')}\n\n${content.slice(nacosIndex)}`
}

function migrateRoutePrefixes(content) {
    let migrated = content
        .replace(/^([ \t]*prefix:[ \t]*)['"]?\/api\/windows\/finance['"]?[ \t]*$/gm, '$1/api/finance')
        .replace(/^([ \t]*prefix:[ \t]*)['"]?\/api['"]?[ \t]*$/gm, '$1/api/account')
        .replace(
            /\n {8}- id: skyline\r?\n {10}prefix: \/api\/skyline\r?\n {10}serviceName: chat-web-skyline-service\r?\n {10}fallbackUrl: http:\/\/chat-web-skyline-service:5040\r?\n {10}enabled: true\r?\n/g,
            '\n'
        )
    if (!/^[ \t]*prefix:[ \t]*['"]?\/api\/crm['"]?[ \t]*$/m.test(migrated)) {
        const crmRoute =
            '    - id: crm\n' +
            '      prefix: /api/crm\n' +
            '      serviceName: chat-web-crm-service\n' +
            '      fallbackUrl: http://chat-web-crm-service:5020\n' +
            '      enabled: true\n'
        if (!/^nacos:\s*$/m.test(migrated)) throw new Error('Gateway Nacos config must contain the root nacos section')
        migrated = migrated.replace(/^(nacos:\s*)$/m, `${crmRoute}\n$1`)
    }
    if (!/^[ \t]*prefix:[ \t]*['"]?\/api\/skyline['"]?[ \t]*$/m.test(migrated)) {
        const skylineRoute =
            '    - id: skyline\n' +
            '      prefix: /api/skyline\n' +
            '      serviceName: chat-web-skyline-service\n' +
            '      fallbackUrl: http://chat-web-skyline-service:5040\n' +
            '      enabled: true\n'
        const nacosIndex = migrated.search(/^nacos:\s*$/m)
        if (nacosIndex < 0) throw new Error('Gateway Nacos config must contain the root nacos section')
        migrated = `${migrated.slice(0, nacosIndex)}${skylineRoute}\n${migrated.slice(nacosIndex)}`
    }
    // 鉴权服务的客户端入口；认证接口从账号服务迁出后由该前缀承载。
    migrated = ensureRoute(migrated, {
        id: 'auth',
        prefix: '/api/auth',
        serviceName: 'chat-web-auth-service',
        fallbackUrl: 'http://chat-web-auth-service:5050'
    })
    // 服务间入口；网关不剥离 /feign/<服务名> 前缀，下游按共享 Feign 客户端的继承路由接收。
    for (const service of FEIGN_ROUTES) {
        migrated = ensureRoute(migrated, { ...service, stripPrefix: false })
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
    if (!/^[ \t]*prefix:[ \t]*['"]?\/api\/skyline['"]?[ \t]*$/m.test(migrated)) {
        throw new Error('Gateway Nacos config must contain the Skyline prefix /api/skyline')
    }
    if (/^[ \t]*prefix:[ \t]*['"]?\/api['"]?[ \t]*$/m.test(migrated)) {
        throw new Error('Gateway Nacos config must not contain the root prefix /api')
    }
    return migrated
}

function leadingSpaces(line) {
    return line.match(/^[ \t]*/)[0].length
}

function findSectionEnd(lines, startIndex, indent) {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        const line = lines[index]
        if (!line.trim() || line.trim().startsWith('#')) continue
        if (leadingSpaces(line) <= indent) return index
    }
    return lines.length
}

function findDirectChild(lines, startIndex, parentIndent, name, sectionEnd) {
    let childIndent
    for (let index = startIndex + 1; index < sectionEnd; index += 1) {
        const line = lines[index]
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const indent = leadingSpaces(line)
        if (indent <= parentIndent) return -1
        childIndent ??= indent
        if (indent === childIndent && (trimmed === `${name}:` || trimmed.startsWith(`${name}: [`))) {
            return index
        }
    }
    return -1
}

function inferNestedIndent(lines, startIndex, parentIndent, sectionEnd) {
    for (let index = startIndex + 1; index < sectionEnd; index += 1) {
        const line = lines[index]
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const indent = leadingSpaces(line)
        if (indent <= parentIndent) break
        return Math.max(indent - parentIndent, 2)
    }
    return 2
}

function spaces(count) {
    return ' '.repeat(count)
}

function normalizeOriginLine(origin, indent) {
    return `${spaces(indent)}- ${origin}`
}

function extractOrigins(lines, startIndex, endIndex) {
    const block = lines.slice(startIndex, endIndex).join('\n')
    const origins = block.match(/https?:\/\/[^\s,\]}"']+/g) ?? []
    return [...new Set(origins.map(origin => origin.replace(/[),.]+$/, '')))]
}

function migrateManagerCors(content) {
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const gatewayIndex = lines.findIndex(line => /^\s*gateway:\s*$/.test(line))
    if (gatewayIndex < 0) throw new Error('Gateway Nacos config must contain the root gateway section')

    const gatewayIndent = leadingSpaces(lines[gatewayIndex])
    const gatewayEnd = findSectionEnd(lines, gatewayIndex, gatewayIndent)
    const corsIndex = findDirectChild(lines, gatewayIndex, gatewayIndent, 'cors', gatewayEnd)
    const routesIndex = findDirectChild(lines, gatewayIndex, gatewayIndent, 'routes', gatewayEnd)
    if (routesIndex < 0) throw new Error('Gateway Nacos config must contain gateway.routes')

    if (corsIndex < 0) {
        const routesIndent = leadingSpaces(lines[routesIndex])
        const indentUnit = inferNestedIndent(lines, routesIndex, routesIndent, gatewayEnd)
        const propertyIndent = routesIndent + indentUnit
        const originIndent = propertyIndent + indentUnit
        lines.splice(
            routesIndex,
            0,
            `${spaces(routesIndent)}cors:`,
            `${spaces(propertyIndent)}allowedOrigins:`,
            normalizeOriginLine(MANAGER_ORIGIN, originIndent),
            `${spaces(propertyIndent)}credentials: true`
        )
        return lines.join('\n')
    }

    const corsIndent = leadingSpaces(lines[corsIndex])
    const corsEnd = findSectionEnd(lines, corsIndex, corsIndent)
    const indentUnit = inferNestedIndent(lines, corsIndex, corsIndent, corsEnd)
    const propertyIndent = corsIndent + indentUnit
    const originIndent = propertyIndent + indentUnit
    const existingOrigins = extractOrigins(lines, corsIndex, corsEnd)
    const origins = [MANAGER_ORIGIN, ...existingOrigins.filter(origin => origin !== MANAGER_ORIGIN)]
    const replacement = [
        `${spaces(corsIndent)}cors:`,
        `${spaces(propertyIndent)}allowedOrigins:`,
        ...origins.map(origin => normalizeOriginLine(origin, originIndent)),
        `${spaces(propertyIndent)}credentials: true`
    ]
    lines.splice(corsIndex, corsEnd - corsIndex, ...replacement)

    return lines.join('\n')
}

function migrateGatewayConfig(content) {
    return migrateManagerCors(migrateRoutePrefixes(content))
}

async function main() {
    const parameters = await configParameters()
    const response = await fetch(`${getBaseUrl()}/nacos/v1/cs/configs?${parameters}`)
    if (!response.ok) throw new Error(`Unable to read Gateway Nacos config: HTTP ${response.status}`)
    const content = await response.text()
    const migrated = migrateGatewayConfig(content)
    if (migrated === content) {
        process.stdout.write('Gateway Nacos route prefixes and CORS already current\n')
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
    process.stdout.write('Gateway Nacos route prefixes and CORS migrated\n')
}

if (require.main === module || process.env.RUN_NACOS_ROUTE_MIGRATION === '1') {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
    })
}

module.exports = { migrateGatewayConfig, migrateManagerCors, migrateRoutePrefixes }
