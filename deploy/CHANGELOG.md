# 部署变更记录

## 2026-08-25：移除 OpenTelemetry 运行依赖

- 影响机器：Home；Company 当前离线，本次不等待其部署结果。
- 关联版本：Gateway 本次完整 Git SHA 镜像。
- 变更内容：移除 OpenTelemetry 自动插桩、OTLP Trace/指标导出和 Alloy 地址配置；保留单行 JSON、请求 ID 与 Docker 日志轮转。
- 机器侧操作：部署脚本会从现有 `.env` 自动移除遗留 `OTEL_*` 和 OpenTelemetry `NODE_OPTIONS`；无需修改 Nacos、端口或网络。
- 验证命令：执行 `yarn format:check && yarn test` 和 Compose 配置校验；部署后确认容器环境中不存在 `NODE_OPTIONS`、`OTEL_*`，并验证 `/health/live` 及三个业务服务健康代理。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA 镜像；业务服务与数据不回滚。

## 2026-08-23：接入统一日志、指标与链路追踪

- 影响机器：Home；Company 当前离线，本次不等待其部署结果。
- 关联版本：`@wlisfes/chat-web-base-schema@1.4.6`、`@opentelemetry/auto-instrumentations-node@0.79.0`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：Nest 启动与请求日志统一输出单行 JSON，并关联 `requestId`、`traceId`、`spanId`；自动采集 HTTP、Nest、跨服务调用和 Node 运行指标，通过 Alloy OTLP/HTTP 上报到 Tempo 与 Prometheus；部署脚本把镜像完整 SHA 写入 `service.version`。
- 机器侧操作：先部署 `chat-web-observability`，确认 `chat-web-alloy:4318` 在 `chat-web-infrastructure` 网络内可达；现有 `.env` 无需新增必填项，默认环境标识为 `production-home`。
- 验证命令：执行 `yarn format:check && yarn test` 和 `docker compose --env-file deploy/.env.example -f deploy/compose.yml config --quiet`；部署后验证 `http://127.0.0.1:3999/health/live`，并在 Grafana 查询 `service=chat-web-gateway-service` 的日志、指标和 Trace。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA 镜像；无需回滚数据库、Redis、Nacos 或观测平台数据。

## 2026-08-23：升级 Knife4j 响应模型解析

- 影响机器：Home；Company 当前离线，本次不等待其部署结果。
- 关联版本：`@wlisfes/chat-web-base-schema@1.4.4`、`nestjs-knife4j-plus@1.0.9`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：替换停止维护且无法展开 OAS3 嵌套响应字段的旧版 `nest-knife4j`，升级到支持 OAS3 组合 Schema 和响应示例解析的 Knife4j UI；统一响应中的 `data` 业务字段、字段类型、中文说明和完整示例可在聚合文档中显示。
- 机器侧操作：由流水线重新构建并拉取 Gateway 镜像；无需修改 Nacos 路由、跨域、`.env`、数据库、Redis、端口、Runner、部署目录或网络。
- 验证命令：执行 `yarn format:check --end-of-line auto && yarn test`；部署后刷新 `/doc.html`，检查 Account 菜单详情和 CRM 短信应用更新接口的响应参数与响应示例。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA 镜像；无需回滚 Nacos、数据库或 Redis。

## 2026-08-23：补全网关接口文档模型

- 影响机器：Home；Company 当前离线，本次不等待其部署结果。
- 关联版本：`@wlisfes/chat-web-base-schema@1.4.2`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：网关信息、服务发现状态、路由健康信息、存活检查和 302 文档跳转均改用聚合 Swagger/Apifox 装饰器并提供明确响应类型；新增 OpenAPI 自动完整性测试和格式检查脚本。
- 机器侧操作：无需修改 Nacos 路由、跨域、`.env`、数据库、Redis、端口、Runner、部署目录或网络。
- 验证命令：执行 `yarn format:check --end-of-line auto && yarn test`；部署后检查 `/api/swagger-json`、`/health`、`/health/live` 和 `/gateway`。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA 镜像；无需回滚 Nacos、数据库或 Redis。

## 2026-08-23：同步共享 Feign 运行时版本

- 影响机器：Company、Home。
- 关联版本：`@wlisfes/chat-web-base-schema@1.3.0`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：同步共享包 1.3.0，与 Account、Finance、CRM 使用同一响应、日志和 Feign 运行时版本；Gateway 继续只负责公开路由和反向代理，不作为业务 Feign 调用方。
- 机器侧操作：无需修改 Nacos 路由、跨域、`.env`、端口、Runner、部署目录或网络。
- 验证命令：执行 `yarn format:check && yarn test`；部署后检查 `/api/health` 及 Account、Finance、CRM 代理路由。
- 回滚方法：恢复上一条健康 Gateway 镜像；不回滚业务服务数据库和 Nacos。

## 2026-08-23：同步共享鉴权运行时版本

- 影响机器：Company、Home。
- 关联版本：`@wlisfes/chat-web-base-schema@1.2.2`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：升级共享运行时依赖以保持微服务版本一致；Gateway 继续只负责路由与协议边界，不引入 Account 会话、JWT 密钥或业务数据库访问，Bearer Token 原样转发给业务服务统一校验。
- 机器侧操作：无需修改 `.env`、Nacos 路由、数据库、Redis、端口、Runner、部署目录或网络。
- 验证命令：执行 `yarn build` 和 Compose 配置校验；部署后验证 Gateway、Account、Finance、CRM 健康转发。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA 镜像；无需回滚 Nacos、数据库或 Redis。

## 2026-08-23：新增 CRM 服务动态路由

- 影响机器：Company、Home；需与 CRM 首次发布处于同一部署窗口。
- 关联版本：`chat-web-crm-service` 首个正式版本；Gateway 本次完整 Git SHA 镜像。
- 变更内容：Nacos `gateway.routes` 新增唯一服务前缀 `/api/crm`，转发到 `chat-web-crm-service:3020`；部署迁移脚本幂等追加 CRM 路由，源码不硬编码代理；部署后在最长 10 分钟内等待并验证 Account、Finance、CRM 三个健康端点，兼容新服务首次上线的跨仓库部署时序。
- 机器侧操作：无需新增数据库或 Redis 配置；确认 CRM 已注册到同一 Nacos Namespace/Group，并保持 `chat-web-infrastructure` 网络可达。
- 验证命令：执行 `yarn build`；部署后检查 `/api/account/health`、`/api/finance/health`、`/api/crm/health` 的业务 `code=200`，并确认 `/api/crm/sms/**` 正确剥离服务前缀。
- 回滚方法：从 Nacos `gateway.routes` 删除 CRM 条目并回滚 Gateway 镜像；不影响 CRM 数据库和容器。

## 2026-08-22：共享请求日志与 Docker 日志轮转

- 影响机器：Company、Home；需与 Account、Finance、Manager 同一发布窗口部署。
- 关联版本：`@wlisfes/chat-web-base-schema@1.1.7`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：在现有共享请求上下文后接入结构化请求日志，记录服务、`logId`、方法、URL、状态码、来源与耗时，并脱敏敏感入参；Docker `json-file` 轮转从保留 5 个文件调整为 30 个。路由仍只有 `/api/account`、`/api/finance` 等服务名称前缀，不新增 Consumer 服务。
- 机器侧操作：无需修改 `.env`、Nacos 路由、数据库、Redis、端口、Runner、部署目录或网络；先部署业务服务，再部署 Gateway。
- 验证命令：执行 `yarn build` 和 `docker compose -f deploy/compose.yml config --quiet`；部署后验证 Gateway、Account、Finance 健康转发、`/api/account/consumer/**` 及 `docker inspect chat-web-gateway-service --format '{{json .HostConfig.LogConfig}}'`。
- 回滚方法：同时回滚 Gateway、Account、Finance、Manager 到上一组兼容镜像；Nacos 路由无需回滚。

## 2026-08-22：恢复服务名称前缀并共享请求上下文

- 影响机器：Company、Home；需与 Account、Finance、Manager 同一发布窗口部署。
- 关联版本：`@wlisfes/chat-web-base-schema@1.1.5`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：Account 对外路由固定为服务名称前缀 `/api/account`，Consumer 仅作为 Account 内部 `/consumer/**` 模块，不新增独立 Gateway 路由；Finance 保持 `/api/finance`。请求 ID 中间件改用共享包无 TypeORM 副作用的 `request-context` 独立入口，并删除 Gateway 本地重复 `src/common` 文件。
- 机器侧操作：部署脚本在 Company、Home 各自 Nacos Data ID 内把遗留 Account 根前缀 `/api` 原地迁移为 `/api/account`，不复制或覆盖整份跨机器配置；无需修改 `.env`、数据库、Redis、端口、Runner、部署目录或外部网络。
- 验证命令：执行 `yarn build`；部署后验证 `/health/live`、`/api/account/health`、`/api/finance/health` 的业务 `code=200`，并确认 `/api/account/consumer/column` 能转发到 Account。
- 回滚方法：同时回滚 Gateway 和 Manager 到上一组健康镜像，并将 Nacos Account 前缀恢复为上一版本使用的值；不回滚数据库或其他服务数据。

## 2026-08-19：共享基础包 1.1.2 与网关数据边界

- 影响机器：Company、Home。
- 关联版本：`@wlisfes/chat-web-base-schema@1.1.2`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：锁定共享基础包 1.1.2，并在仓库规则中明确 Gateway 不连接业务数据库、不读取业务 Redis。部署幂等迁移历史 `/api/windows/finance` 到 `/api/finance`、`/api/account` 到 `/api`，随后从 Gateway 容器验证 Finance 新路由业务 `code=200`；端口 3999、响应封装和服务发现不变。
- 机器侧操作：Company、Home 的部署会原地更新各自 Nacos Gateway Data ID 中的旧路由前缀，不复制另一台配置；读取 Company 历史 CRLF `.env` 时会移除行尾回车再选择 Docker 网络。无需修改 `.env`、数据库、Redis、端口、Runner、部署目录或外部网络。合并后由双机矩阵部署同一完整 SHA。
- 验证命令：`yarn build`；部署后执行 `docker inspect chat-web-gateway-service --format '{{.Config.Image}} {{.State.Health.Status}}'`、`curl -fsS http://127.0.0.1:3999/health/live`、`curl -fsS http://127.0.0.1:3999/api/health` 和 `curl -fsS http://127.0.0.1:3999/api/finance/health`。
- 回滚方法：将两台机器恢复到上一条健康 Gateway SHA；无需回滚 Nacos、数据库、Redis 或其他服务。

## 2026-08-19：共享基础包 1.1.1 联动升级

- 影响机器：Company、Home。
- 关联版本：`@wlisfes/chat-web-base-schema@1.1.1`；网关本次完整 Git SHA 镜像。
- 变更内容：将共享基础包升级到包含 Redis、Nacos、Auth 和 MySQL 隔离运行时子路径的 1.1.1；网关继续只加载共享响应子路径，本地服务发现、动态路由和端口 3999 行为不变。锁文件固定到已发布版本，Docker 仍通过临时 BuildKit Secret 下载私有包。
- 机器侧操作：无需修改 `.env`、Nacos 路由、端口、Runner、部署目录或外部网络；合并后由现有双机矩阵部署同一完整 SHA。
- 验证命令：`yarn build`；部署后分别执行 `docker inspect chat-web-gateway-service --format '{{.Config.Image}} {{.State.Health.Status}}'`、`curl -fsS http://127.0.0.1:3999/health/live`、`curl -fsS http://127.0.0.1:3999/api/health` 和 `curl -fsS http://127.0.0.1:3999/api/finance/health`。
- 回滚方法：将两台机器恢复到上一条健康网关 SHA；无需回滚 Nacos、数据库或其他服务容器。

## 2026-08-18：移除 Account 与 Windows 公网前缀

- 影响范围：Company、Home；Gateway、Manager、Account 与 Finance 的公网 API 路径。
- 关联版本：本次 Gateway 与 Manager 联动发布的完整 Git SHA。
- 变更内容：Account 公网路由由 `/api/account/**` 改为 `/api/**`，Finance 由 `/api/windows/finance/**` 改为 `/api/finance/**`；Gateway 允许 `/api` 作为根路由前缀，并继续按前缀长度优先匹配 Finance，避免被 Account 根路由截获。
- 部署可靠性：两台 Runner 访问 GHCR 多次出现 EOF，镜像拉取默认重试由 3 次提高到 8 次，仍保持递增退避且失败后不切换容器。
- 机器侧操作：先发布支持 `/api` 根前缀的 Gateway，再将两台机器 Nacos `chat-web-gateway-service.yaml` 切换为新路由，最后发布使用新路径的 Manager；禁止在旧 Gateway 上提前发布 `/api` 根路由。

### 验证

```bash
curl -fsS http://127.0.0.1:3999/api/health
curl -fsS http://127.0.0.1:3999/api/finance/health
curl -sS http://127.0.0.1:3999/api/auth/me
```

预期两个健康接口返回业务 `code=200`，未登录 Account 接口返回业务 `code=401`，旧 `/api/account/**` 与 `/api/windows/finance/**` 不再作为正式入口。

### 回滚

- 先把 Nacos 路由恢复为 `/api/account` 与 `/api/windows/finance`，确认旧路径恢复后再回滚 Gateway 和 Manager 镜像。
- 两个后端服务、数据库、服务名及容器端口均未变化，无需回滚数据。

本文件只记录会影响服务器构建、部署、启动或运行的变更，不记录密码、Token、私钥和真实 `.env`。

新增记录必须包含：影响范围、关联版本、变更内容、机器侧操作、验证方式和回滚方式。最新记录放在最前面。

## 2026-08-18：接入 Finance 服务路由与共享响应升级

- 影响范围：Company、Home 网关和财务中心管理页面。
- 关联版本：`chat-web-finance-service` 首个部署版本；`@wlisfes/chat-web-base-schema@1.0.8`；网关本次路由提交。
- 变更内容：Nacos 路由示例和无 Nacos fallback 同时新增 `/api/windows/finance`，转发到 `chat-web-finance-service:3010` 并剥离公开前缀；新增 `FINANCE_SERVICE_URL` 环境覆盖。共享响应升级到 1.0.8，供协议型接口正确保留原生 HTTP 状态。
- 机器侧操作：两台 Nacos 的 `chat-web-gateway-service.yaml` 增加 Finance 路由；确认 Finance 与 Gateway 均加入 `chat-web-infrastructure`。

### 验证

```bash
curl -fsS http://127.0.0.1:3999/api/windows/finance/health
curl -sS -X POST http://127.0.0.1:3999/api/windows/finance/brand/column -H 'Content-Type: application/json' -d '{"page":1,"size":10}'
```

### 回滚

- 从 Nacos 移除 Finance 路由并恢复上一条网关镜像；Finance 数据库和容器不随网关回滚删除。

## 2026-08-18：统一响应模块与 GitHub Packages 构建认证

- 影响范围：Company、Home 网关及管理端 API 调用。
- 关联版本：网关本次共享响应接入提交；`@wlisfes/chat-web-base-schema@1.0.6`。
- 容器与端口：服务和健康检查端口仍为 `3999`；Docker 构建新增只读使用仓库 `GITHUB_TOKEN` 的 BuildKit secret。
- 变更内容：网关接入共享 `HttpResponseModule`；限流、网关初始化和下游不可用响应统一为 HTTP 200，并通过 `{ data, code, message, timestamp }` 的数字 `code` 表达业务结果；构建时在临时鉴权环境查询固定版本的 GitHub Packages tarball 地址并继续冻结锁文件安装，Token 和下载地址不写入仓库或最终镜像层。
- 机器侧操作：无需修改服务器 `.env`、Nacos 或端口；由 Actions 重新构建并滚动部署网关镜像。

### 验证

```bash
yarn build
docker build --secret id=github_token,env=NODE_AUTH_TOKEN -t chat-web-gateway-service:response-test .
curl -fsS http://127.0.0.1:3999/health/live
```

### 回滚

- 回滚到上一版网关镜像；无需回滚数据库、Nacos、端口或服务器环境变量。

## 2026-08-17：Gateway 双机器部署与 Company Runner 安装

- 影响范围：Company、Home。
- 关联版本：`main` 提交及镜像 `9d98e9827abc68aa130f92c71f5f14a1bdd01dca`。
- 容器与端口：`chat-web-gateway-service`，宿主机 `3999`，容器 `3999`。
- 部署目录：`/opt/chat-web-gateway-service`。
- Docker 网络：`chat-web-infrastructure`。
- Nacos：Data ID `chat-web-gateway-service.yaml`，Group `DEFAULT_GROUP`，Namespace 名称 `chat-web-service`。

### 变更内容

- Gateway 已在 Home、Company 完成同一 SHA 镜像部署。
- Company Nacos 已创建 Gateway 配置，并配置 `/api/account/**` 到 `chat-web-account-service`。
- Company 安装独立 Gateway Runner，目录 `/opt/actions-runner-gateway-company`，服务名 `actions.runner.Wlisfes-chat-web-gateway-service.chat-server-company-gateway.service`。
- Windows 计划任务 `Chat Web GitHub Runner Company` 改为隐藏 PowerShell 包装，保持 WSL 长期运行且不弹窗口。
- 仓库中的 Nacos Namespace 示例与 Company 当前 `chat-web-service` Namespace 对齐；Home 必须核对其本机 Namespace ID。

### 机器侧状态与动作

- Company：Gateway Runner、Nacos 配置、容器和转发链路均已验证。
- Home：部署已成功；同步仓库改动后，确认 `/opt/chat-web-gateway-service/.env` 仍指向 Home 本机的 `chat-web-service` Namespace，并确认相同 Data ID 已存在。
- 不同仓库的 Runner 必须使用独立目录和各自仓库生成的临时注册 Token。

### 验证

```bash
docker inspect chat-web-gateway-service --format '{{.Config.Image}} {{.State.Health.Status}}'
curl -fsS http://127.0.0.1:3999/health
curl -fsS http://127.0.0.1:3999/api/account/health
```

正常结果：Gateway 为 `healthy`，自身健康检查和 Account 转发都返回 HTTP 200。

### 回滚

- Actions 部署脚本会在健康检查失败时自动恢复部署前镜像。
- 手动恢复时，将 `/opt/chat-web-gateway-service/compose.yml` 的 `IMAGE` 指向上一条已验证 SHA 后执行 `docker compose up -d --no-deps gateway-service`。
- Nacos 路由配置异常时，恢复上一版 `chat-web-gateway-service.yaml`，不要删除 Account 服务容器。

## 记录模板

```markdown
## YYYY-MM-DD：变更标题

- 影响范围：Company / Home / 全部。
- 关联版本：分支、提交 SHA、镜像 SHA。
- 变更内容：
- 机器侧操作：
- 验证：
- 回滚：
```
