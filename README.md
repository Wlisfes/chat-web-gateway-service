# chat-web-gateway-service

Chat Web 多个微服务的统一 API 入口。网关不连接数据库，也不承载账号、聊天等业务逻辑。

## 第一版能力

- 从 Nacos `chat-web-gateway-service.yaml` 动态读取全部服务路由和跨域白名单。
- `/api/account/**` 转发到 `chat-web-account-service`，转发时移除 `/api/account` 服务前缀。
- `/api/finance/**` 优先转发到 `chat-web-finance-service`，转发时移除 `/api/finance` 前缀。
- `/api/crm/**` 转发到 `chat-web-crm-service`，转发时移除 `/api/crm` 前缀。
- `/api/skyline/**` 转发到 `chat-web-skyline-service`，转发时移除 `/api/skyline` 前缀。
- 使用 Nacos 发现健康服务实例，并在多个实例之间轮询。
- Nacos 不可用或没有健康实例时，使用各路由对应的 `*_SERVICE_URL` 后备地址。
- 网关自身可注册到 Nacos，并在退出时注销临时实例。
- 支持普通 HTTP 请求和 WebSocket Upgrade 转发。
- 统一生成或透传 `X-Request-Id`，向下游传递来源信息。
- 提供动态 CORS 白名单、安全响应头、基础限流、Knife4j 聚合文档和健康检查。
- Docker 镜像、`chat-home-server` 单机自动部署以及失败回滚。

## 路由规则

| 客户端地址                     | 下游服务地址       |
| ------------------------------ | ------------------ |
| `GET /api/account/health`      | `GET /health`      |
| `/api/account/users/**`        | `/users/**`        |
| `GET /api/finance/health`      | `GET /health`      |
| `/api/finance/brand/**`        | `/brand/**`        |
| `GET /api/crm/health`          | `GET /health`      |
| `/api/crm/sms/**`              | `/sms/**`          |
| `GET /api/skyline/health/live` | `GET /health/live` |

账号服务仍然负责业务鉴权、字段校验和数据访问。网关后续可以增加 JWT 的通用身份解析，但下游服务不能因此取消权限校验。

## 本地启动

```bash
copy .env.example .env
yarn install
yarn dev
```

默认访问地址：

- Knife4j 聚合文档：`http://127.0.0.1:5000/`（自动跳转到 `/doc.html`）
- 网关信息：`http://127.0.0.1:5000/gateway`
- 健康检查：`http://127.0.0.1:5000/health`
- 网关 Swagger：`http://127.0.0.1:5000/api/swagger`
- 账号服务：`http://127.0.0.1:5000/api/account/**`
- 财务服务：`http://127.0.0.1:5000/api/finance/**`
- CRM 服务：`http://127.0.0.1:5000/api/crm/**`
- Skyline 服务：`http://127.0.0.1:5000/api/skyline/**`

公网 Gateway 入口为 `https://chat-web.lisfes.cn`。该域名由云端 Nginx 终止 TLS，经 WireGuard 转发到本机，再由本机 Nginx 转发到 Gateway `5000`；Gateway 本身不直接暴露公网端口。

根目录 `.env` 只保存 `NODE_ENV`、`PORT` 和 Nacos 连接参数。网关路由、后备地址、跨域、限流和注册发现配置统一维护在 Nacos 远端 `chat-web-gateway-service.yaml`。

本地开发同样连接云端 Nacos，当前暂时使用正式 Data ID；根目录 `.env` 只填写以下 Nacos 参数：

```dotenv
NACOS_SERVER=chat-web-nacos.lisfes.cn:8848
NACOS_NAMESPACE=replace-with-nacos-namespace-id
NACOS_CONFIG_DATA_ID=chat-web-gateway-service.yaml
```

## 健康检查

- `/health/live`：只检查网关进程是否存活，Docker 使用该接口。
- `/health/ready`：返回服务发现和路由状态。
- `/health`：便于人工查看的完整状态。

当 Nacos 没有账号服务实例但后备地址已经配置时，网关仍然处于可用状态，路由状态中的 `source` 会显示为 `fallback`。

## Nacos 网关配置

Nacos 配置内容以远端 `chat-web-gateway-service.yaml` 为唯一运行来源。所有对外服务都在 `gateway.routes` 中注册，不再为每个服务修改网关源码。

```yaml
gateway:
    trustProxy: false
    proxy:
        timeoutMs: 30000
    rateLimit:
        max: 300
        windowMs: 60000
    cors:
        allowedOrigins:
            - https://chat.lisfes.cn
            - https://admin.example.com
            - https://chat.example.com
        credentials: true
    routes:
        - id: account
          prefix: /api/account
          serviceName: chat-web-account-service
          fallbackUrl: http://chat-web-account-service:5010
          enabled: true
        - id: finance
          prefix: /api/finance
          serviceName: chat-web-finance-service
          fallbackUrl: http://chat-web-finance-service:5030
          enabled: true
        - id: crm
          prefix: /api/crm
          serviceName: chat-web-crm-service
          fallbackUrl: http://chat-web-crm-service:5020
          enabled: true
        - id: skyline
          prefix: /api/skyline
          serviceName: chat-web-skyline-service
          fallbackUrl: http://chat-web-skyline-service:5040
          enabled: true
nacos:
    discovery:
        enabled: true
        required: false
        group: DEFAULT_GROUP
    registration:
        enabled: true
        serviceName: chat-web-gateway-service
```

跨域白名单必须填写完整 Origin，只允许 `http` 或 `https`，不能带路径。空数组表示禁止浏览器跨域访问；`allowedOrigins` 包含 `*` 时不能启用 `credentials`。如果管理端页面由 `https://chat.lisfes.cn` 提供，必须把该 Origin 加入白名单。

路由和跨域配置更新后会由 Nacos 订阅实时生效。`server.port` 和网关注册 IP/端口涉及监听地址，修改后需要重启服务。

## 添加新微服务

直接在 Nacos `chat-web-gateway-service.yaml` 的 `gateway.routes` 中追加路由。例如：

```yaml
- id: chat
  prefix: /api/chat
  serviceName: chat-web-chat-service
  fallbackUrl: http://chat-web-chat-service:3000
  enabled: true
```

`id` 和 `prefix` 必须唯一。网关会自动订阅新增的 Nacos 服务，只移除公开服务前缀，其余路径和查询参数保持不变。本地需要覆盖后备地址时，可设置与路由 ID 对应的环境变量，例如 `CHAT_SERVICE_URL=http://127.0.0.1:3001`。

## 部署

部署基线、故障恢复和跨机器操作记录：

- [部署变更记录](deploy/CHANGELOG.md)
- [故障恢复手册](deploy/RUNBOOK.md)

凡是修改 Docker、Actions、Nacos、路由、端口、环境变量、健康检查或 Runner，必须在同一次提交中更新部署变更记录。

1. 首次部署会自动从 `deploy/.env.example` 创建 `/opt/chat-web-gateway-service/.env`；需要覆盖实例参数时直接修改服务器文件。
2. 确认 `chat-web-infrastructure` 外部网络已经存在，Nacos 和账号服务位于该网络。
3. GitHub 仓库配置 `production-home` Environment，以及带 `chat-home-server` 标签的自托管 Runner。
4. 合并到 `main` 后，流水线构建并推送 GHCR 镜像，然后滚动部署并执行健康检查。

Self-hosted Runner 默认只属于注册它的仓库。即使 `chat-home-server` 已经安装了账号服务 Runner，网关仓库仍需使用独立目录和网关仓库生成的 Token 再安装一个 Runner；选择标签统一为 `chat-home-server`。原另一台部署机器已废弃，不再创建部署任务。

开发分支使用 `developer`，`main` 只接受合并后的稳定代码。所有微服务容器归属 `chat-web-service` Compose 项目；独立部署脚本不会清理同组的其他服务。

## 注意事项

- 生产跨域白名单统一维护在 Nacos `gateway.cors.allowedOrigins`，不要使用 `*`。
- 只有网关位于可信 Nginx、负载均衡器后方时才将 Nacos `gateway.trustProxy` 设置为 `true`。
- 跨宿主机使用 Nacos 时，应将 `NACOS_REGISTER_IP` 设置成其他节点能够访问的地址。
- 当前限流状态存储在单个网关进程内；网关多副本部署后，如需全局限流应接入 Redis 或使用 APISIX/Kong 等专用网关。
- Knife4j 根据 `gateway.routes` 聚合网关及业务服务文档；业务服务必须统一暴露 `/api/swagger-json`。

## 可观测性

Docker 部署输出结构化单行 JSON 日志，网关会保留并下传 `x-request-id`，可通过容器标准输出直接串联请求排障，完整命令见 `deploy/RUNBOOK.md`。
