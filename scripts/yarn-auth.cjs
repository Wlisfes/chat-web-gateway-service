const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function hasUserGitHubPackagesAuth() {
    const userConfig = process.env.NPM_CONFIG_USERCONFIG || path.join(os.homedir(), '.npmrc')

    try {
        return fs
            .readFileSync(userConfig, 'utf8')
            .split(/\r?\n/)
            .some(line => /^\s*\/\/npm\.pkg\.github\.com\/:_authToken\s*=\s*\S+\s*$/i.test(line))
    } catch {
        return false
    }
}

function getAuthToken() {
    const environmentToken = process.env.NODE_AUTH_TOKEN?.trim()

    if (environmentToken) {
        return environmentToken
    }

    const result = spawnSync('gh', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
    })
    const token = result.stdout?.trim()

    if (result.status === 0 && token) {
        return token
    }

    if (hasUserGitHubPackagesAuth()) {
        return undefined
    }

    throw new Error('未找到 GitHub Packages 凭据。请配置用户级 .npmrc、执行 gh auth login --scopes read:packages，或设置 NODE_AUTH_TOKEN。')
}

function resolveYarnCli() {
    if (process.env.npm_execpath) {
        return process.env.npm_execpath
    }

    if (process.platform !== 'win32') {
        return undefined
    }

    const result = spawnSync('where.exe', ['yarn.cmd'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
    })
    const launchers = result.stdout?.split(/\r?\n/).filter(Boolean) ?? []

    for (const launcher of launchers) {
        const yarnCli = path.join(path.dirname(launcher), 'node_modules', 'yarn', 'bin', 'yarn.js')
        if (fs.existsSync(yarnCli)) {
            return yarnCli
        }
    }

    throw new Error('未找到 Yarn 1.x CLI，请确认 yarn 命令已正确安装。')
}

function runYarn(args, env) {
    const yarnCli = resolveYarnCli()

    if (yarnCli) {
        return spawnSync(process.execPath, [yarnCli, ...args], {
            env,
            stdio: 'inherit',
            windowsHide: true
        })
    }

    return spawnSync('yarn', args, {
        env,
        stdio: 'inherit',
        windowsHide: true
    })
}

const args = process.argv.slice(2)
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-web-yarn-'))
const userConfig = path.join(tempDirectory, '.npmrc')

try {
    const token = getAuthToken()
    const environment = { ...process.env }

    if (token) {
        fs.writeFileSync(
            userConfig,
            [
                '@wlisfes:registry=https://npm.pkg.github.com',
                '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
                'always-auth=true',
                ''
            ].join('\n'),
            { mode: 0o600 }
        )
        environment.NODE_AUTH_TOKEN = token
        environment.NPM_CONFIG_USERCONFIG = userConfig
    }

    const result = runYarn(args, environment)

    if (result.error) {
        throw result.error
    }

    process.exitCode = result.status ?? 1
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
} finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true })
}
