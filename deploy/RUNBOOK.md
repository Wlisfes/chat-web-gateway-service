# Gateway 服务部署与故障恢复手册

## 可观测性排障

容器日志为单行 JSON，由 Alloy 自动采集。日志中的 `requestId` 可串联网关和业务服务，`traceId`、`spanId` 可直接跳转到 Tempo。容器启动后确认以下环境和链路：

```bash
docker inspect chat-web-gateway-service --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(OTEL_SERVICE_NAME|OTEL_SERVICE_VERSION|OTEL_EXPORTER_OTLP_ENDPOINT|DEPLOYMENT_ENVIRONMENT)='
docker logs --tail 100 chat-web-gateway-service
docker run --rm --network chat-web-infrastructure node:22-alpine node -e 'fetch("http://chat-web-alloy:12345/-/ready").then(async response => { console.log(response.status, await response.text()); process.exit(response.ok ? 0 : 1) })'
```

Grafana 中使用 `{service="chat-web-gateway-service"}` 查询日志。若日志存在但没有 Trace，检查 `NODE_OPTIONS` 和 Alloy 4318 端口；若 Trace 存在但没有指标，检查 Prometheus remote-write 接收和 `OTEL_METRIC_EXPORT_INTERVAL`。

## 当前基线

| 项目                 | 值                                                 |
| -------------------- | -------------------------------------------------- |
| 容器                 | `chat-web-gateway-service`                         |
| 访问地址             | `http://127.0.0.1:3999`                            |
| 健康检查             | `http://127.0.0.1:3999/health`                     |
| Account 转发检查     | `http://127.0.0.1:3999/api/account/health`         |
| Finance 转发检查     | `http://127.0.0.1:3999/api/finance/health`         |
| 部署目录             | `/opt/chat-web-gateway-service`                    |
| Docker 网络          | `chat-web-infrastructure`                          |
| Nacos Data ID        | `chat-web-gateway-service.yaml`                    |
| Nacos Group          | `DEFAULT_GROUP`                                    |
| Nacos Namespace 名称 | `chat-web-service`                                 |
| Nacos 服务名         | `chat-web-gateway-service`                         |
| Company Runner       | `chat-server-company-gateway`                      |
| Home Runner 标签     | `chat-server-home`                                 |

Namespace ID 是每台 Nacos 的运行参数。恢复机器时先在 Nacos 控制台确认 `chat-web-service` 的实际 ID，再填写服务器 `.env`，不要根据另一台机器猜测。

Gateway 没有业务数据库或业务 Redis 所有权，不得配置 Account/Finance MySQL 连接或直接读取其 Redis index。所有业务访问只通过现有 Nacos 路由或显式服务 URL 转发。

部署会把遗留 `/api/windows/finance`、Account 根前缀 `/api` 幂等迁移为 `/api/finance`、`/api/account`，并验证两个服务的健康接口响应体 `code=200`。若迁移失败，先核对本机 Gateway Data ID 是否同时包含 Account 与 Finance 路由；不要手工复制另一台完整 Nacos 配置。

## 五分钟排障

### 1. 检查 Gateway 和转发链路

```powershell
docker inspect chat-web-gateway-service --format "{{.Config.Image}} {{.State.Status}} {{.State.Health.Status}}"
docker inspect chat-web-gateway-service --format "{{json .HostConfig.LogConfig}}"
docker logs --tail 200 chat-web-gateway-service
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3999/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3999/api/account/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3999/api/finance/health
```

日志配置预期为 `json-file`、`max-size=20m`、`max-file=30`。Gateway 请求日志会记录 `logId`、服务前缀 URL、状态码和耗时，但不会新增 Consumer 服务路由；Consumer 始终通过 `/api/account/consumer/**` 转发。

`/health` 中 `source` 为 `fallback` 表示 Account 尚未注册到 Nacos，但 Docker 后备地址仍可用；`healthyInstances` 大于 0 表示已通过 Nacos 服务发现。

### 2. 检查 Nacos 和 Docker 网络

```powershell
docker network inspect chat-web-infrastructure
docker logs --tail 100 chat-web-nacos
```

Gateway、Account、Finance、Nacos 必须加入 `chat-web-infrastructure`。Nacos 必须存在 `chat-web-gateway-service.yaml`，Account 和 Finance 后备地址分别为 `http://chat-web-account-service:3000`、`http://chat-web-finance-service:3010`。

### 3. 检查 Company Runner 与 WSL 保活

```powershell
wsl -d Ubuntu-22.04 -u root -- systemctl status actions.runner.Wlisfes-chat-web-gateway-service.chat-server-company-gateway.service
Get-ScheduledTask -TaskName "Chat Web GitHub Runner Company"
```

恢复命令：

```powershell
Start-ScheduledTask -TaskName "Chat Web GitHub Runner Company"
wsl -d Ubuntu-22.04 -u root -- systemctl restart actions.runner.Wlisfes-chat-web-gateway-service.chat-server-company-gateway.service
```

### 4. 检查部署结果

Actions 应满足：Build 成功、Home 与 Company 各自成功。容器镜像标签必须等于本次提交的完整 Git SHA。

## 常见故障

| 现象                    | 原因                                  | 处理                                                       |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Company 部署一直 Queued | Gateway 仓库 Runner 离线              | 启动 WSL 保活任务并重启 Gateway Runner                     |
| 3999 拒绝连接           | Gateway 未部署或未通过健康检查        | 查看容器状态和日志，核对 `/opt` 下 `.env`                  |
| Nacos 配置不存在        | Namespace ID、Data ID 或 Group 不一致 | 核对本机 Namespace 和 `chat-web-gateway-service.yaml`      |
| Account 转发 502        | Account 容器不可达且 Nacos 无健康实例 | 检查 Account 健康和 Docker 网络                            |
| `healthyInstances: 0`   | Account 尚未注册到 Nacos              | 部署包含 Account 注册逻辑的新镜像；fallback 可暂时继续服务 |

## 恢复顺序

1. 启动 Docker Desktop、Nacos 和 Account。
2. 确认 `chat-web-infrastructure` 网络和 Gateway Nacos 配置存在。
3. 确认 `/opt/chat-web-gateway-service/.env` 使用本机 Namespace ID。
4. 启动 WSL 保活任务和 Gateway Runner。
5. 在 GitHub Actions 手动运行当前稳定分支的 `Build and deploy`。
6. 验证镜像 SHA、Gateway 健康和 Account 转发。

每次处理完成后，把新原因和恢复命令补充到 `deploy/CHANGELOG.md`。
