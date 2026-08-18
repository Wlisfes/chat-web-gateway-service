# 部署变更记录

## 2026-08-18：移除 Account 与 Windows 公网前缀

- 影响范围：Company、Home；Gateway、Manager、Account 与 Finance 的公网 API 路径。
- 关联版本：本次 Gateway 与 Manager 联动发布的完整 Git SHA。
- 变更内容：Account 公网路由由 `/api/account/**` 改为 `/api/**`，Finance 由 `/api/windows/finance/**` 改为 `/api/finance/**`；Gateway 允许 `/api` 作为根路由前缀，并继续按前缀长度优先匹配 Finance，避免被 Account 根路由截获。
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
