# 部署变更记录

## 2026-09-02：更新 Account 模块路由验证

- 影响机器：`chat-home-server`；本次仅更新测试与规约，未合并 `main` 或触发部署。
- 关联版本：Gateway 与 Account 的本次 `developer` 分支提交。
- 变更内容：代理回归用例改用 `/api/account/sheet/**`，验证 Gateway 保留完整公开路径并将 `/sheet/**` 转发给 Account；Account 的 `/api/account/**` 通配路由配置无需调整。
- 机器侧操作：发布 Account 新版本后按现有 Gateway 流程验证，无需修改 Nacos 路由、Nginx 或外部网络。
- 验证命令：执行 `yarn build`、`node test/gateway-proxy-cors.test.cjs`；部署后检查 `/api/account/health` 及 `/api/account/sheet/tree/structure`。
- 回滚方法：恢复上一版 Gateway 与 Account 完整 Git SHA，测试和客户端路径随旧版本恢复。

## 2026-08-31：拆分快速单测与完整校验

- 影响范围：Gateway 本地测试命令；部署机器运行参数不变。
- 关联版本：服务版本 `0.0.1`。
- 变更内容：`yarn test` 改为快速单测，新增 `yarn test:unit`；完整构建与测试使用 `yarn test:full`。
- 机器侧操作：无需额外操作。
- 验证命令：`yarn test:unit`、`yarn test:full`。
- 回滚方法：恢复本次变更前的 `package.json`。

## 2026-08-31：升级共享基础包并统一本地依赖认证

- 影响范围：Gateway 本地开发与后续部署构建。
- 关联版本：`@wlisfes/chat-web-base-schema@1.4.18`。
- 变更内容：Gateway 升级共享基础包，依赖安装统一通过 `scripts/yarn-auth.cjs` 临时读取 GitHub CLI 凭据，避免 GitHub Packages 返回 401；不保存真实 Token。
- 验证命令：`yarn install`、`yarn build`、`yarn test`。
- 回滚方法：恢复上一版 package.json/yarn.lock 与依赖认证脚本。

## 2026-08-30：统一使用共享 Nacos 运行时

- 影响机器：`chat-home-server`（待本次 Gateway 提交合并 `main` 后生效）。
- 关联版本：`@wlisfes/chat-web-base-schema@1.4.17`；Gateway 已完成依赖升级，当前运行中的镜像不变。
- 变更内容：删除 Gateway 内置的 Nacos 配置、注册和发现实现，改由共享包 `NacosModule.forRoot(forRootNacosRuntimeOptions(process.env))` 统一提供；路由预热、健康实例统计和加权后备解析继续由共享 `NacosService` 完成。Nacos Data ID、Group、Namespace、路由和端口不变。
- 机器侧操作：合并 `main` 后重新构建并部署 Gateway；无需修改 Nacos 数据或基础设施端口。
- 验证命令：执行 `yarn format:check`、`yarn build`、`yarn test`；部署后验证 `/health/live`、`/health/ready` 以及 `/api/account`、`/api/finance`、`/api/crm`、`/api/skyline` 路由。
- 回滚方法：恢复上一版 Gateway 完整 Git SHA 和共享包版本；不回滚 Nacos 配置、服务实例或业务数据。

## 2026-08-30：修复 RabbitMQ 与 Kafka 公网 TCP 转发端口冲突

- 影响范围：`chat-home-server` 本机 Docker RabbitMQ/Kafka、WireGuard 端口代理、云端 Nginx stream 公网入口。
- 变更内容：RabbitMQ AMQP 宿主机发布端口固定为 `127.0.0.1:15674`（容器 `5672`），管理端口固定为 `127.0.0.1:15673`（容器 `15672`）；Kafka 宿主机发布端口固定为 `127.0.0.1:19092`（容器 `9092`）。WireGuard 端口代理改为 `18081→15674`、`18082→15673`、`18083→19092`，Redis 的 `18080→16379` 保持不变。公网端口仍为 RabbitMQ `5672`/`15672` 和 Kafka `9092`。
- 脚本变更：`allow-wireguard-infrastructure.ps1` 清理旧的 `10.66.0.2:5672`、`10.66.0.2:15672`、`10.66.0.2:9092` 监听及 Redis 历史规则，仅在 `chat-web-home` 接口放行 `18080`–`18083` 等必要入口。
- 机器侧操作：更新基础设施 Compose 后分别重建 RabbitMQ、Kafka（禁止 `docker compose down -v`，保留数据卷）；以管理员运行端口代理脚本；将云端 Nginx stream 上游改为 `10.66.0.2:18081`（AMQP）、`10.66.0.2:18082`（管理 TCP）、`10.66.0.2:18083`（Kafka），管理台 HTTPS 继续经本机 Nginx `80` 转发到 `chat-web-rabbitmq:15672`。云端配置使用只读 bind mount，原子替换后需强制重建 `chat-web-cloud-nginx`。
- 验证：执行 `docker inspect chat-web-rabbitmq --format '{{json .HostConfig.PortBindings}}'`、`docker inspect chat-web-kafka --format '{{json .HostConfig.PortBindings}}'`、`netsh interface portproxy show v4tov4`；确认三条新代理存在且旧监听不存在。公网分别使用 AMQP 客户端、RabbitMQ 管理台和 Kafka `ApiVersions` 握手验证，不能只依据 TCP 探测。
- 回滚方法：停止公网 RabbitMQ/Kafka 客户端，恢复云端 Nginx 原上游并重新加载；删除 `18081`–`18083` portproxy，将 Compose 宿主机端口恢复为原配置后仅重建对应容器。不得删除 RabbitMQ/Kafka 数据卷。

## 2026-08-30：修复 Redis 公网 TCP 转发端口冲突

- 影响范围：`chat-home-server` 本机 Docker Redis、WireGuard 端口代理、云端 Nginx stream 公网 Redis 入口。
- 关联版本：本机基础设施 Compose 配置；Gateway 部署脚本与运行手册。
- 变更内容：Redis 宿主机发布端口固定为 `127.0.0.1:16379`，容器端口仍为 `6379`；WireGuard 仅开放并监听 `10.66.0.2:18080`，再转发到回环 `16379`；公网 `chat-web-redis.lisfes.cn:6379` 由云端 Nginx 转发到 `10.66.0.2:18080`。端口代理脚本改为幂等清理旧的 `6379`/`16379` Redis 监听规则，并将防火墙放行端口加入 `18080`。
- 机器侧操作：更新本机基础设施 Compose 后仅重建 Redis 容器（禁止 `down -v`），确认外部卷 `20260801231547_redis-data` 保留；运行 `allow-wireguard-infrastructure.ps1`；将云端 `/opt/chat-web-cloud/nginx.conf` 的 Redis 上游改为 `10.66.0.2:18080`，因配置是只读 bind mount，使用 `docker compose -p chat-web-cloud -f /opt/chat-web-cloud/compose.yml up -d --no-deps --force-recreate web` 重新挂载后再验证健康状态。Docker 内服务继续使用 `chat-web-redis:6379`，宿主机程序使用 `127.0.0.1:16379`。
- 验证：执行 `docker inspect chat-web-redis --format '{{json .HostConfig.PortBindings}}'`、`netsh interface portproxy show v4tov4`、`Test-NetConnection chat-web-redis.lisfes.cn -Port 6379`；从云端执行 `nc -vz 10.66.0.2 18080`，并使用明文 Redis 客户端完成认证后 `PING` 返回 `PONG`。确认不存在旧 `10.66.0.2:6379`/`10.66.0.2:16379` 监听规则。
- 回滚方法：停止公网 Redis 客户端，在云端恢复 Nginx 原上游并 reload；删除 `10.66.0.2:18080` 代理，将 Compose 发布端口恢复为 `127.0.0.1:6379:6379` 后重建 Redis。仅使用原外部数据卷恢复，不执行 `docker compose down -v` 或删除 Redis 数据卷。

## 2026-08-30：废弃管理端 Platform 请求头

- 影响机器：`chat-home-server` 与公网 Gateway。
- 关联版本：Gateway 本次完整 Git SHA 镜像；Manager 同步移除 `Platform` 请求头并改用 API 域名加载验证码。
- 变更内容：Gateway CORS 允许请求头列表删除已废弃的 `Platform`；继续由 Nacos `gateway.cors` 提供 `https://chat.lisfes.cn` Origin 和凭据策略，验证码 Cookie 转发逻辑保持不变。
- 机器侧操作：重新部署 Gateway；确认 Nacos 保留 `allowedOrigins: https://chat.lisfes.cn` 和 `credentials: true`，无需修改路由、数据库、Redis 或 Nginx。
- 验证命令：执行 Gateway 类型检查、构建和测试；发布后发送只带 `content-type` 的登录预检，并用 Cookie 会话验证验证码接口到登录接口的转发。
- 回滚方法：恢复上一条健康 Gateway 完整 Git SHA；Nacos Origin、凭据策略和业务数据不回滚。

## 2026-08-30：禁止下游覆盖网关跨域响应头

- 影响机器：`chat-home-server` 与公网 Gateway。
- 关联版本：Gateway 本次完整 Git SHA 镜像；Nacos `chat-web-gateway-service.yaml`。
- 变更内容：网关代理响应时移除下游服务返回的全部 `Access-Control-*` 响应头，跨域策略只由 Gateway 根据 Nacos `gateway.cors` 生成，避免 Account 的通配符 Origin 覆盖 `https://chat.lisfes.cn`。
- 机器侧操作：重新部署 Gateway；无需修改 Account、Manager、数据库、Redis、Nacos 白名单或 Nginx。
- 验证命令：分别向登录接口发送 `OPTIONS` 和带 `Origin: https://chat.lisfes.cn` 的 `POST`，确认两个响应均返回精确 Origin 和 `Access-Control-Allow-Credentials: true`，实际响应不得包含通配符 Origin。
- 回滚方法：恢复上一条健康 Gateway 完整 Git SHA；Nacos 配置和业务数据均不回滚。

## 2026-08-30：修复网关部署权限与注册端口覆盖

- 影响机器：`chat-home-server` 与云端 Nacos。
- 关联版本：Gateway 部署工作流；Nacos `chat-web-gateway-service.yaml`。
- 变更内容：迁移脚本通过临时 Node 容器的标准输入执行，并在部署文件安装后明确检查生产 `.env` 对 Runner 可读；清理遗留 `NACOS_REGISTER_PORT` 等启动覆盖项，使网关注册端口跟随 `PORT=5000`。跨域白名单仍只开放 `https://chat.lisfes.cn`，API 入口仍为 `https://chat-web.lisfes.cn`。
- 机器侧操作：首次修复现有主机上的 `.env` 后重新运行 Gateway 主分支部署流水线；流水线会幂等迁移 Nacos 配置，再重建网关容器。
- 验证命令：执行 `yarn format:check && yarn tsc -p tsconfig.json --noEmit && yarn build && yarn test`；部署后发送管理端 CORS 预检并确认允许 Origin、凭据和 `Platform` 请求头。
- 回滚方法：恢复上一条健康 Gateway 完整 Git SHA；Nacos 配置保持当前白名单，不回滚业务数据。

## 2026-08-30：修复管理端跨域预检

- 影响机器：`chat-home-server` 与云端 Nacos。
- 关联版本：Gateway 本次完整 Git SHA 镜像；Nacos `chat-web-gateway-service.yaml`。
- 变更内容：管理端页面 Origin 继续只在 Nacos `gateway.cors.allowedOrigins` 中开放 `https://chat.lisfes.cn`，并启用 `gateway.cors.credentials: true`；Gateway 固定允许管理端发送 `Platform` 请求头，修复登录和 Token 续期预检被浏览器拦截的问题。云端与本机 Nginx 不添加重复 CORS 响应头。
- 机器侧操作：发布 Gateway 前幂等迁移云端 Nacos CORS 配置，再部署新镜像；无需修改 Manager、数据库、Redis、端口或 Docker 网络。
- 验证命令：向 `https://chat-web.lisfes.cn/api/account/auth/token/login` 发送带 `Origin: https://chat.lisfes.cn`、`Access-Control-Request-Method: POST` 和 `Access-Control-Request-Headers: content-type,platform` 的 `OPTIONS` 请求，确认响应包含允许 Origin、凭据和 `Platform` 请求头。
- 回滚方法：回滚 Gateway 到上一完整 Git SHA；仅在同时回滚 Manager 的跨域请求方式时才关闭 Nacos `credentials`，不删除 `chat.lisfes.cn` Origin，不回滚业务数据。

## 2026-08-29：管理端页面作为浏览器跨域来源

- 影响机器：`chat-home-server` 与云端 `47.119.21.228`。
- 关联版本：Gateway 本次配置提交；Nacos `chat-web-gateway-service.yaml`。
- 变更内容：浏览器页面来源固定为 `https://chat.lisfes.cn`，API 入口固定为 `https://chat-web.lisfes.cn`；Gateway 的跨域白名单需要包含页面 Origin，并保持 `credentials: true` 以支持登录和 Token 续期。
- 机器侧操作：更新 Nacos `gateway.cors.allowedOrigins` 和 `gateway.cors.credentials`，再发布 Gateway 及 Manager。
- 验证命令：访问 `https://chat.lisfes.cn/health`、`https://chat-web.lisfes.cn/health`，并在浏览器确认登录与续期请求不再被 CORS 拦截。
- 回滚方法：恢复上一版 Nacos CORS 配置并回滚 Gateway 镜像；页面静态资源与业务数据不回滚。

## 2026-08-29：基础设施域名统一

- 基础设施公网域名统一按 Docker 容器名命名：`chat-web-mysql.lisfes.cn`、`chat-web-nacos.lisfes.cn`、`chat-web-dozzle.lisfes.cn`、`chat-web-rabbitmq.lisfes.cn`、`chat-web-redis.lisfes.cn`、`chat-web-kafka.lisfes.cn`。
- 云端 Nginx 的 TCP 入口使用容器对应端口 `3306`、`6379`、`5672`、`9092`；Nacos 控制台使用 `https://chat-web-nacos.lisfes.cn/nacos/`，Dozzle 使用 `https://chat-web-dozzle.lisfes.cn/`，RabbitMQ 管理台使用 `https://chat-web-rabbitmq.lisfes.cn/`。
- RabbitMQ 管理台改为经本机 Nginx `80` 端口转发到 `chat-web-rabbitmq:15672`，避免 WireGuard 直连 Windows 发布端口时被主机防火墙拦截。旧域名不再作为公网入口。

## 2026-08-29：统一公网域名前缀

- 影响范围：云端 Nginx、本机网关 Nginx、Gateway 与 Dozzle 公网入口、Nacos 公网入口。
- 关联版本：Gateway 本次配置提交；云端 Nginx `/opt/chat-web-cloud/nginx.conf`。
- 变更内容：正式公网域名统一增加 `chat-` 前缀：`chat-web.lisfes.cn`（Gateway）、`chat-logs.lisfes.cn`（Dozzle）、`chat-nacos.lisfes.cn`（Nacos）。旧公网域名 `web.lisfes.cn`、`logs.lisfes.cn`、`nacos.lisfes.cn` 已从 DNS 与 Nginx 入口移除；证书和转发配置改用新域名。
- 机器侧操作：同步云端 Nginx 配置并 reload；同步 `web-gateway.conf`、`dozzle.conf` 到本机 `chat-web-nginx` 并 reload。Dozzle 和 Nacos 仍只运行在原主机/云端，不新增容器。
- 验证：`curl -k -I https://chat-web.lisfes.cn/health`、`curl -k -I https://chat-logs.lisfes.cn/`、`curl -k -I https://chat-nacos.lisfes.cn/nacos/`；执行两端 `nginx -t` 并确认新域名证书无不匹配。
- 回滚：恢复云端 Nginx 备份和本机两个入口配置后 reload；如需恢复旧域名，还需重新添加对应 DNS 记录和证书域名。

## 2026-08-29：新增云端 Nginx 到本机 Dozzle 的日志入口

- 影响机器：`chat-home-server` 与云端 `47.119.21.228`。
- 关联版本：Gateway 本次完整 Git SHA 镜像；日志域名 `logs.lisfes.cn`。
- 变更内容：云端 Nginx 终止 `logs.lisfes.cn` TLS，经 WireGuard `10.66.0.2:80` 转发到本机 Nginx，再由本机转发到 `chat-web-dozzle:8080`；Dozzle 不在云端安装或保存。Dozzle 静态资源启用 gzip 和一年 immutable 缓存，实时日志接口保留 WebSocket 长连接和关闭缓冲。
- 机器侧操作：云端签发 `/etc/letsencrypt/live/logs.lisfes.cn` 证书并更新 `/opt/chat-web-cloud/nginx.conf`；部署流水线同步 `deploy/dozzle-ingress.conf` 到本机 `chat-web-nginx` 并 reload。原 `logs.lisfes.com` 继续作为本机直连兼容入口，不作为公网入口。
- 验证命令：访问 `https://logs.lisfes.cn/` 应跳转 Dozzle 登录页；检查 `curl -k -I -H 'Accept-Encoding: gzip' https://logs.lisfes.cn/assets/main-PgmtVYCl.js` 返回 `Content-Encoding: gzip` 和 `Cache-Control: public, max-age=31536000, immutable`；执行 `docker exec chat-web-nginx nginx -t`。
- 回滚方法：恢复云端 Nginx 备份并 reload，删除本机 `logs.lisfes.cn` Server 配置后 reload；Dozzle 容器、Docker 日志和 `logs.lisfes.com` 兼容入口不受影响。

## 2026-08-29：优化 Knife4j 文档页首次加载

- 影响机器：`chat-home-server` 与云端 `47.119.21.228`。
- 关联版本：Gateway 本次完整 Git SHA 镜像；公网域名 `web.lisfes.cn`。
- 变更内容：Gateway 对 Knife4j `doc.html` 去除不会影响当前页面的预加载 chunk；本机 Nginx 为带 hash 的 JS、CSS、字体和图片启用 gzip，并设置一年 immutable 缓存，减少首次打开文档页的传输量和后续重复下载。
- 机器侧操作：Gateway 部署流水线同步 `web-gateway.conf` 并 reload 本机 Nginx；云端 Nginx 继续透传本机已压缩的静态资源，无需修改 TLS 或 WireGuard 配置。
- 验证命令：执行 `yarn format:check`、`yarn test`；检查 `curl -k -I -H 'Accept-Encoding: gzip' https://web.lisfes.cn/assets/js/chunk-vendors.8e9185cb.js` 返回 `Content-Encoding: gzip` 和 `Cache-Control: public, max-age=31536000, immutable`，访问 `https://web.lisfes.cn/doc.html` 确认页面正常渲染。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA，并将本机 `web-gateway.conf` 恢复为旧版本后 reload Nginx；浏览器缓存可自然失效，不涉及 Nacos、数据库或业务服务。

## 2026-08-29：新增云端 web 域名到本机 Gateway 的入口

- 影响机器：`chat-home-server` 与云端 `47.119.21.228`。
- 关联版本：Gateway 本次完整 Git SHA 镜像；公网域名 `web.lisfes.cn`。
- 变更内容：本机共享 Nginx 新增 `web.lisfes.cn` 内网入口，将请求转发到 `chat-web-gateway-service:5000`；云端 Nginx 通过 WireGuard `10.66.0.2:80` 转发公网 HTTPS 请求。
- 机器侧操作：云端 Nginx 配置 `web.lisfes.cn` 的 HTTP→HTTPS、TLS 和 WireGuard 上游；本机部署流水线自动同步入口并 reload。
- 验证命令：访问 `https://web.lisfes.cn/health` 及 `https://web.lisfes.cn/api/skyline/health/live`，确认状态码正常。
- 回滚方法：删除云端 `web.lisfes.cn` Server 配置和本机 `web-gateway.conf`，reload 两端 Nginx；Gateway 镜像可独立回滚。

## 2026-08-29：Skyline 接入统一网关

- 影响机器：`chat-home-server`。
- 关联版本：Gateway 本次完整 Git SHA 镜像；Nacos Data ID `chat-web-gateway-service.yaml`。
- 变更内容：新增 `/api/skyline/**` 路由，使用 Nacos 服务名 `chat-web-skyline-service` 并以 `http://chat-web-skyline-service:5040` 作为后备地址；流水线增加 Skyline 路由验证。
- 机器侧操作：部署迁移脚本幂等追加 Skyline 路由，网关订阅配置后立即生效；Skyline 的独立域名入口由 Skyline 仓库部署流程清理。
- 验证命令：访问 `http://127.0.0.1:5000/api/skyline/health/live`，预期返回 `{"status":"UP"}`。
- 回滚方法：从 Nacos `gateway.routes` 删除 Skyline 路由并恢复上一条健康 Gateway 完整 SHA；不回滚 Skyline 服务数据。

## 2026-08-29：移除本地 Nacos 路由模板

- 影响机器：`chat-home-server`；本次仅调整仓库文件，不触发镜像构建或线上部署。
- 关联版本：Gateway `developer` 分支工作区。
- 变更内容：删除 `config/nacos/chat-web-gateway-service.yaml`。Gateway 运行时只从云端 Nacos Data ID `chat-web-gateway-service.yaml` 加载路由、跨域、限流和服务发现配置。
- 机器侧操作：无需修改 Nacos 配置或现有容器；后续更新路由直接在 Nacos 控制台操作。
- 验证命令：确认 `rg` 全仓库无代码读取该文件，并执行 `yarn build && yarn test`。
- 回滚方法：从上一版本恢复该参考文件即可，不影响运行中的 Nacos 配置和服务实例。

## 2026-08-29：统一网关监听端口为 5000

- 影响机器：`chat-home-server`；Company Runner 当前离线，本次不等待其部署结果。
- 关联版本：Gateway 本次 `developer` 配置提交；未合并 `main`，不触发镜像构建或线上部署。
- 变更内容：Gateway 容器、Nacos 注册、健康检查和本地文档端口由 `3999` 统一为 `5000`；Account、Finance、CRM 后备地址同步为 `5010`、`5030`、`5020`。
- 机器侧操作：下次部署重新创建 Gateway 容器，使 `PORT=5000` 生效；Nacos 路由前缀、域名、Docker 网络和限流配置不变。
- 验证命令：检查 `docker inspect` 中的 `PORT=5000`、访问 `/health/live` 以及 `/api/account/health`、`/api/finance/health`、`/api/crm/health`。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA，并将 Nacos `server.port`、注册端口和后备地址恢复为旧值。

## 2026-08-29：统一环境示例并补充 Nacos 鉴权迁移

- 影响机器：`chat-home-server`；Company Runner 当前离线，本次不等待其部署结果。
- 关联版本：Gateway 本次 `developer` 配置提交；未合并 `main`，不触发镜像构建或线上部署。
- 变更内容：根目录与部署目录 `.env.example` 统一只描述启动和 Nacos 参数，网关路由、限流和跨域配置继续由云端 Nacos 管理；路由迁移脚本增加 Nacos 登录令牌读取和发布支持。
- 机器侧操作：无需修改 Nacos 路由、端口或 Docker 网络；确认部署主机 `.env` 保留 Nacos 用户名和密码，真实密钥不得提交仓库。
- 验证命令：执行 `yarn build`；运行路由迁移脚本读取鉴权 Nacos 配置，并检查 `/health/live` 及三条代理路由。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA；Nacos 路由、业务服务与数据均不回滚。

## 2026-08-29：部署拓扑收敛到 chat-home-server

- 影响机器：仅 `chat-home-server`；原另一台部署机器已废弃并下线，不再创建部署任务。
- 关联版本：Gateway 本次 `developer` 配置提交；未合并 `main`，不触发镜像构建或线上部署。
- 变更内容：删除 Company/Home 双机矩阵，Runner 选择标签统一为 `chat-home-server`，继续使用 `production-home` Environment 和 `/opt/chat-web-gateway-service` 部署目录。
- 机器侧操作：Gateway 仓库在线 Runner 的自定义标签已由 `chat-server-home` 更新为 `chat-home-server`，systemd 服务保持运行；废弃机器的离线 Runner 登记已从 GitHub 删除，若要恢复只能使用新 Token 重新注册。无需修改 `.env`、Nacos 路由、端口或 Docker 网络。
- 验证命令：校验 Actions YAML，确认现行配置不再引用 `chat-server-company`、`chat-server-home`、`production-company` 或部署矩阵。
- 回滚方法：若新标签无法调度，仅把当前单机任务和在线 Runner 的自定义标签临时改回 `chat-server-home`；不得恢复废弃机器的部署任务，Nacos 路由与业务数据不回滚。

## 2026-08-26：根目录运行配置收口到 Nacos

- 影响机器：Company、Home；容器部署参数和双机矩阵不变。
- 关联版本：`@wlisfes/chat-web-base-schema@1.4.10`、Gateway 本次完整 Git SHA 镜像；Nacos Data ID `chat-web-gateway-service.yaml`。
- 变更内容：根目录 `.env.example` 仅保留 `NODE_ENV`、`PORT` 和 Nacos 建连字段；服务后备地址不再出现在根示例，运行时统一读取 Nacos 远端动态路由，仓库原有 `config/nacos/chat-web-gateway-service.yaml` 仅作为结构参考。
- 机器侧操作：两台机器继续维护各自 Namespace 中的 Gateway 路由；服务器 `deploy/.env` 和部署迁移脚本保持不变，不得使用根目录示例覆盖生产文件。
- 验证命令：执行 `yarn format:check && yarn test`；确认根 `.env.example` 的有效键只有 `NODE_ENV`、`PORT`、`NACOS_SERVER`、`NACOS_NAMESPACE`，并验证 Account、Finance、CRM 三条 Nacos 路由。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA；保留当前 Nacos 路由，业务服务和数据不回滚。

## 2026-08-26：同步 Nacos 运行时共享包版本

- 影响机器：Company、Home；两台机器继续部署同一个 Gateway 完整 Git SHA 镜像。
- 关联版本：`@wlisfes/chat-web-base-schema@1.4.9`；Gateway 本次完整 Git SHA 镜像。
- 变更内容：将共享包精确升级到 1.4.9，与 Account、Finance、CRM、Skyline 的 Nacos 运行时契约保持一致；Gateway 继续使用仓库内独立 Nacos 模块，路由和注册行为不变。
- 机器侧操作：无需修改 Gateway `.env`、Nacos 路由、端口、数据库、Redis、Runner、部署目录或外部网络。
- 验证命令：执行 `yarn format:check && yarn test` 和 `IMAGE=example.invalid/chat-web-gateway-service:compose-check docker compose --env-file deploy/.env.example -f deploy/compose.yml config --quiet`；部署后检查 `/health/live` 及 Account、Finance、CRM 健康代理。
- 回滚方法：恢复上一条健康 Gateway 完整 SHA 镜像；无需回滚业务服务、数据库、Redis 或 Nacos 数据。

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

## 2026-08-29：开发数据库域名入口

- 影响范围：云端 Nginx、WireGuard 到本机 MySQL 的 TCP 转发。
- 变更内容：云端 Nginx 新增 `chat-mysql.lisfes.cn:13306` TCP 入口，经 WireGuard 转发到本机 Docker MySQL `10.66.0.2:3306`；开发电脑无需安装 WireGuard。
- 安全要求：阿里云安全组仅允许受信任的开发电脑公网 IP 访问 `13306`，MySQL 使用独立开发账号，不使用 `root`。
- 验证：`Test-NetConnection chat-mysql.lisfes.cn -Port 13306`，再使用 MySQL 客户端登录。
- 回滚：删除云端 Nginx `stream` 中的 `13306` 服务并移除 Compose 的 `13306:13306` 端口映射。

## 2026-08-29：开发数据库账号命名

- 变更内容：远程开发数据库账号统一使用 `chat`，保留原有开发密码和业务数据库权限，并移除 `chat_dev` 账号。
- 验证：通过 `chat-mysql.lisfes.cn:13306` 使用 `chat` 账号执行 `SELECT 1` 成功。

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
