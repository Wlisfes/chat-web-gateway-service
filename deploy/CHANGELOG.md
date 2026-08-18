# 部署变更记录

本文件只记录会影响服务器构建、部署、启动或运行的变更，不记录密码、Token、私钥和真实 `.env`。

新增记录必须包含：影响范围、关联版本、变更内容、机器侧操作、验证方式和回滚方式。最新记录放在最前面。

## 2026-08-18：统一响应模块与 GitHub Packages 构建认证

- 影响范围：Company、Home 网关及管理端 API 调用。
- 关联版本：网关本次共享响应接入提交；`@wlisfes/chat-web-base-schema@1.0.6`。
- 容器与端口：服务和健康检查端口仍为 `3999`；Docker 构建新增只读使用仓库 `GITHUB_TOKEN` 的 BuildKit secret。
- 变更内容：网关接入共享 `HttpResponseModule`；限流、网关初始化和下游不可用响应统一为 HTTP 200，并通过 `{ data, code, message, timestamp }` 的数字 `code` 表达业务结果；Token 只存在于构建临时配置，不写入镜像层。
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
