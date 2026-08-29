# Gateway 服务部署与故障恢复手册

## 日志排障

容器日志为单行 JSON，日志中的 `requestId` 可串联网关和业务服务。容器启动后可直接检查标准输出和日志轮转配置：

```bash
docker logs --tail 100 chat-web-gateway-service
docker inspect chat-web-gateway-service --format '{{json .HostConfig.LogConfig}}'
```

## 当前基线

| 项目                 | 值                                                 |
| -------------------- | -------------------------------------------------- |
| 容器                 | `chat-web-gateway-service`                         |
| 访问地址             | `http://127.0.0.1:5000`                            |
| 健康检查             | `http://127.0.0.1:5000/health`                     |
| Account 转发检查     | `http://127.0.0.1:5000/api/account/health`         |
| Finance 转发检查     | `http://127.0.0.1:5000/api/finance/health`         |
| CRM 转发检查         | `http://127.0.0.1:5000/api/crm/health`             |
| Skyline 转发检查     | `http://127.0.0.1:5000/api/skyline/health/live`    |
| 公网入口检查         | `https://web.lisfes.cn/health`                     |
| 部署目录             | `/opt/chat-web-gateway-service`                    |
| Docker 网络          | `chat-web-infrastructure`                          |
| Nacos Data ID        | `chat-web-gateway-service.yaml`                    |
| Nacos Group          | `DEFAULT_GROUP`                                    |
| Nacos Namespace 名称 | `chat-web-service`                                 |
| Nacos 服务名         | `chat-web-gateway-service`                         |
| 部署主机             | `chat-home-server`                                 |
| Runner 标签          | `chat-home-server`                                 |

Namespace ID 是本机 Nacos 的运行参数。恢复机器时先在 Nacos 控制台确认 `chat-web-service` 的实际 ID，再填写服务器 `.env`，不要根据历史机器配置猜测。

Dozzle 公网入口为 `https://logs.lisfes.cn`：云端 Nginx 只负责 TLS 和 WireGuard 转发，本机 Nginx 将请求代理到 `chat-web-dozzle:8080`。本机旧入口 `logs.lisfes.com` 仅用于本机直连兼容，可以保留；生产访问统一使用 `.cn` 域名。

开发数据库入口为 `chat-mysql.lisfes.cn:13306`：域名解析到云服务器 `47.119.21.228`，云端 Nginx `stream` 将 TCP 连接经 WireGuard 转发到本机 `10.66.0.2:3306` 的 Docker MySQL。开发电脑无需安装 WireGuard，项目中的数据库主机填写 `chat-mysql.lisfes.cn`、端口填写 `13306`。阿里云安全组必须仅向受信任的开发电脑公网 IP 开放 TCP `13306`，禁止向全网开放；MySQL 使用独立开发账号，不使用 `root`。

验证云端入口：

```powershell
Test-NetConnection chat-mysql.lisfes.cn -Port 13306
mysql -h chat-mysql.lisfes.cn -P 13306 -u chat_dev -p
```

`13306` 是 TCP 端口，不能使用 Dozzle 的 HTTP 检查方式；如果连接失败，依次检查 DNS、安全组、云端 Nginx `stream` 配置、WireGuard 到 `10.66.0.2:3306` 的连通性及本机防火墙。

日志页首屏优化由本机 Nginx 完成：静态 JS、CSS、字体和图片启用 gzip、缓冲和一年 immutable 缓存，日志流路径保持 `proxy_buffering off` 与 3600 秒长连接超时。验证命令：

```powershell
curl -k -I -H "Accept-Encoding: gzip" https://logs.lisfes.cn/assets/main-PgmtVYCl.js
docker exec chat-web-nginx nginx -t
docker exec chat-web-nginx nginx -s reload
```

静态资源响应应包含 `Content-Encoding: gzip` 和 `Cache-Control: public, max-age=31536000, immutable`；首页返回 `307 /login` 表示 Dozzle 鉴权入口正常。

仓库根目录和服务器 `deploy/.env.example` 均只保留进程启动及 Nacos 建连/注册字段；路由、后备地址、跨域、限流及注册发现配置统一以 Nacos 远端 `chat-web-gateway-service.yaml` 为准。

Gateway 没有业务数据库或业务 Redis 所有权，不得配置 Account/Finance MySQL 连接或直接读取其 Redis index。所有业务访问只通过现有 Nacos 路由或显式服务 URL 转发。

部署会把遗留 `/api/windows/finance`、Account 根前缀 `/api` 幂等迁移为 `/api/finance`、`/api/account`，并验证两个服务的健康接口响应体 `code=200`。若迁移失败，先核对本机 Gateway Data ID 是否同时包含 Account 与 Finance 路由；不要手工复制历史机器的完整 Nacos 配置。

### 文档页首次加载慢

Knife4j 的 `doc.html` 只加载当前页面需要的脚本，其他 chunk 按需加载。本机 Nginx 对 hash 静态资源启用 gzip 和一年 immutable 缓存；首次部署后可用以下命令确认压缩和缓存头已经生效：

```powershell
curl -k -I -H "Accept-Encoding: gzip" https://web.lisfes.cn/assets/js/chunk-vendors.8e9185cb.js
```

响应应包含 `Content-Encoding: gzip` 与 `Cache-Control: public, max-age=31536000, immutable`。如果仍然看到完整未压缩的 `Content-Length`，先确认 Gateway 流水线是否已同步 `/etc/nginx/conf.d/web-gateway.conf` 并执行 `docker exec chat-web-nginx nginx -t`、`docker exec chat-web-nginx nginx -s reload`；云端 Nginx 只负责 TLS 和 WireGuard 转发。

## 五分钟排障

### 1. 检查 Gateway 和转发链路

```powershell
docker inspect chat-web-gateway-service --format "{{.Config.Image}} {{.State.Status}} {{.State.Health.Status}}"
docker inspect chat-web-gateway-service --format "{{json .HostConfig.LogConfig}}"
docker logs --tail 200 chat-web-gateway-service
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/api/account/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/api/finance/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/api/crm/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/api/skyline/health/live
curl -kfsS https://web.lisfes.cn/health
curl -kfsS https://web.lisfes.cn/api/skyline/health/live
```

日志配置预期为 `json-file`、`max-size=20m`、`max-file=30`。Gateway 请求日志会记录 `logId`、服务前缀 URL、状态码和耗时，但不会新增 Consumer 服务路由；Consumer 始终通过 `/api/account/consumer/**` 转发。

`/health` 中 `source` 为 `fallback` 表示 Account 尚未注册到 Nacos，但 Docker 后备地址仍可用；`healthyInstances` 大于 0 表示已通过 Nacos 服务发现。

### 2. 检查 Nacos 和 Docker 网络

```powershell
docker network inspect chat-web-infrastructure
docker logs --tail 100 chat-web-nacos
```

Gateway、Account、CRM、Finance、Skyline、Nacos 必须加入 `chat-web-infrastructure`。Nacos 必须存在 `chat-web-gateway-service.yaml`，各服务后备地址分别使用容器名与 `5010`、`5020`、`5030`、`5040` 端口。公网 `web.lisfes.cn` 由云端 Nginx 经 WireGuard 转发到本机 `10.66.0.2:80`，本机入口再转发到 Gateway `5000`。

### 3. 检查 chat-home-server Runner

```powershell
wsl -d Ubuntu-24.04 -u root -- systemctl status actions.runner.Wlisfes-chat-web-gateway-service.chat-server-home-gateway.service
```

恢复命令：

```powershell
wsl -d Ubuntu-24.04 -u root -- systemctl restart actions.runner.Wlisfes-chat-web-gateway-service.chat-server-home-gateway.service
```

### 4. 检查部署结果

Actions 应满足：Build 成功、`Deploy to chat-home-server` 成功。容器镜像标签必须等于本次提交的完整 Git SHA。

## 常见故障

| 现象                    | 原因                                  | 处理                                                       |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------- |
| 部署一直 Queued         | `chat-home-server` 的 Gateway Runner 离线 | 启动 WSL 并重启 Gateway Runner                          |
| 5000 拒绝连接           | Gateway 未部署或未通过健康检查        | 查看容器状态和日志，核对 `/opt` 下 `.env`                  |
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
