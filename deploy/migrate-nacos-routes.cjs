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
    return line.match(/^\s*/)[0].length
}

function findSectionEnd(lines, startIndex, indent) {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        const line = lines[index]
        if (!line.trim()) continue
        if (leadingSpaces(line) <= indent) return index
    }
    return lines.length
}

function normalizeOriginLine(origin) {
    return `            - ${origin}`
}

function migrateManagerCors(content) {
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const gatewayIndex = lines.findIndex(line => /^gateway:\s*$/.test(line))
    if (gatewayIndex < 0) throw new Error('Gateway Nacos config must contain the root gateway section')

    let gatewayEnd = findSectionEnd(lines, gatewayIndex, 0)
    let corsIndex = -1
    for (let index = gatewayIndex + 1; index < gatewayEnd; index += 1) {
        if (/^ {4}cors:\s*$/.test(lines[index])) {
            corsIndex = index
            break
        }
    }

    if (corsIndex < 0) {
        const routesIndex = lines.findIndex((line, index) => index > gatewayIndex && index < gatewayEnd && /^ {4}routes:\s*$/.test(line))
        if (routesIndex < 0) throw new Error('Gateway Nacos config must contain gateway.routes')
        lines.splice(
            routesIndex,
            0,
            '    cors:',
            '        allowedOrigins:',
            normalizeOriginLine(MANAGER_ORIGIN),
            '        credentials: true'
        )
        return lines.join('\n')
    }

    let corsEnd = findSectionEnd(lines, corsIndex, 4)
    let allowedIndex = -1
    for (let index = corsIndex + 1; index < corsEnd; index += 1) {
        if (/^ {8}allowedOrigins:/.test(lines[index])) {
            allowedIndex = index
            break
        }
    }

    if (allowedIndex < 0) {
        lines.splice(corsIndex + 1, 0, '        allowedOrigins:', normalizeOriginLine(MANAGER_ORIGIN))
        corsEnd += 2
        allowedIndex = corsIndex + 1
    } else if (lines[allowedIndex].trim() !== 'allowedOrigins:') {
        const existingOrigins = lines[allowedIndex].match(/https?:\/\/[^,\]\s'"]+/g) ?? []
        const origins = [...new Set(existingOrigins.filter(origin => origin !== MANAGER_ORIGIN)), MANAGER_ORIGIN]
        lines.splice(allowedIndex, 1, '        allowedOrigins:', ...origins.map(normalizeOriginLine))
        corsEnd += origins.length
    } else {
        let allowedEnd = findSectionEnd(lines, allowedIndex, 8)
        for (let index = allowedIndex + 1; index < allowedEnd; index += 1) {
            if (/^ {12}-\s*['"]?\*['"]?\s*$/.test(lines[index])) {
                lines.splice(index, 1)
                index -= 1
                allowedEnd -= 1
                corsEnd -= 1
            }
        }
        const hasManagerOrigin = lines.slice(allowedIndex + 1, allowedEnd).some(line => line.trim().replace(/^-\s*/, '') === MANAGER_ORIGIN)
        if (!hasManagerOrigin) {
            lines.splice(allowedIndex + 1, 0, normalizeOriginLine(MANAGER_ORIGIN))
            corsEnd += 1
        }
    }

    corsEnd = findSectionEnd(lines, corsIndex, 4)
    const credentialsIndex = lines.findIndex((line, index) => index > corsIndex && index < corsEnd && /^ {8}credentials:/.test(line))
    if (credentialsIndex < 0) {
        const refreshedAllowedIndex = lines.findIndex(
            (line, index) => index > corsIndex && index < corsEnd && /^ {8}allowedOrigins:/.test(line)
        )
        const allowedEnd = refreshedAllowedIndex < 0 ? corsIndex + 1 : findSectionEnd(lines, refreshedAllowedIndex, 8)
        lines.splice(allowedEnd, 0, '        credentials: true')
    } else {
        lines[credentialsIndex] = '        credentials: true'
    }

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
