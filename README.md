# chat-web-gateway-service

Chat Web 多个微服务的统一 API 入口。网关不连接数据库，也不承载账号、聊天等业务逻辑。

## 第一版能力

- 从 Nacos `chat-web-gateway-service.yaml` 动态读取全部服务路由和跨域白名单。
- `/api/account/**` 转发到 `chat-web-account-service`，转发时移除 `/api/account` 前缀。
- 使用 Nacos 发现健康服务实例，并在多个实例之间轮询。
- Nacos 不可用或没有健康实例时，使用 `ACCOUNT_SERVICE_URL` 后备地址。
- 网关自身可注册到 Nacos，并在退出时注销临时实例。
- 支持普通 HTTP 请求和 WebSocket Upgrade 转发。
- 统一生成或透传 `X-Request-Id`，向下游传递来源信息。
- 提供动态 CORS 白名单、安全响应头、基础限流、Swagger 和健康检查。
- Docker 镜像、双 Runner 自动部署以及失败回滚。

## 路由规则

| 客户端地址                | 下游服务地址  |
| ------------------------- | ------------- |
| `GET /api/account/health` | `GET /health` |
| `/api/account/users/**`   | `/users/**`   |

账号服务仍然负责业务鉴权、字段校验和数据访问。网关后续可以增加 JWT 的通用身份解析，但下游服务不能因此取消权限校验。

## 本地启动

```bash
copy .env.example .env
yarn install
yarn dev
```

默认访问地址：

- 网关信息：`http://127.0.0.1:3999/`
- 健康检查：`http://127.0.0.1:3999/health`
- Swagger：`http://127.0.0.1:3999/api/swagger`
- 账号服务：`http://127.0.0.1:3999/api/account/**`

如果本地没有 Nacos，可以关闭配置中心和服务发现：

```dotenv
NACOS_CONFIG_ENABLED=false
NACOS_DISCOVERY_ENABLED=false
ACCOUNT_SERVICE_URL=http://127.0.0.1:3000
```

启用 Nacos 时使用以下配置：

```dotenv
NACOS_NAMESPACE=e60f5b2a-ba9d-475a-91ee-fa252e0456c1
NACOS_CONFIG_DATA_ID=chat-web-gateway-service.yaml
NACOS_CONFIG_GROUP=DEFAULT_GROUP
```

## 健康检查

- `/health/live`：只检查网关进程是否存活，Docker 使用该接口。
- `/health/ready`：返回服务发现和路由状态。
- `/health`：便于人工查看的完整状态。

当 Nacos 没有账号服务实例但后备地址已经配置时，网关仍然处于可用状态，路由状态中的 `source` 会显示为 `fallback`。

## Nacos 网关配置

仓库中的 `config/nacos/chat-web-gateway-service.yaml` 是配置结构参考，当前 Nacos 配置内容与其保持一致。所有对外服务都在 `gateway.routes` 中注册，不再为每个服务修改网关源码。

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
            - https://admin.example.com
            - https://chat.example.com
        credentials: false
    routes:
        - id: account
          prefix: /api/account
          serviceName: chat-web-account-service
      fallbackUrl: http://chat-web-account-service:3000
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

跨域白名单必须填写完整 Origin，只允许 `http` 或 `https`，不能带路径。空数组表示禁止浏览器跨域访问；`allowedOrigins` 包含 `*` 时不能启用 `credentials`。

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

1. 首次部署会自动从 `deploy/.env.example` 创建 `/opt/chat-web-gateway-service/.env`；需要覆盖实例参数时直接修改服务器文件。
2. 确认 `chat-web-infrastructure` 外部网络已经存在，Nacos 和账号服务位于该网络。
3. GitHub 仓库配置 `production-home`、`production-company` Environment，以及对应自托管 Runner。
4. 合并到 `main` 后，流水线构建并推送 GHCR 镜像，然后滚动部署并执行健康检查。

开发分支使用 `developer`，`main` 只接受合并后的稳定代码。所有微服务容器归属 `chat-web-service` Compose 项目；独立部署脚本不会清理同组的其他服务。

## 注意事项

- 生产跨域白名单统一维护在 Nacos `gateway.cors.allowedOrigins`，不要使用 `*`。
- 只有网关位于可信 Nginx、负载均衡器后方时才将 Nacos `gateway.trustProxy` 设置为 `true`。
- 跨宿主机使用 Nacos 时，应将 `NACOS_REGISTER_IP` 设置成其他节点能够访问的地址。
- 当前限流状态存储在单个网关进程内；网关多副本部署后，如需全局限流应接入 Redis 或使用 APISIX/Kong 等专用网关。
- Swagger 当前描述网关自己的接口；业务服务文档聚合应在各服务统一暴露 OpenAPI JSON 后增加。
