# Gateway 服务部署与故障恢复手册

## 日志排障

容器日志为单行 JSON，日志中的 `requestId` 可串联网关和业务服务。容器启动后可直接检查标准输出和日志轮转配置：

```bash
docker logs --tail 100 chat-web-gateway-service
docker inspect chat-web-gateway-service --format '{{json .HostConfig.LogConfig}}'
```

## 当前基线

| 项目                 | 值                                              |
| -------------------- | ----------------------------------------------- |
| 容器                 | `chat-web-gateway-service`                      |
| 访问地址             | `http://127.0.0.1:5000`                         |
| 健康检查             | `http://127.0.0.1:5000/health`                  |
| Account 转发检查     | `http://127.0.0.1:5000/api/account/health`      |
| Finance 转发检查     | `http://127.0.0.1:5000/api/finance/health`      |
| CRM 转发检查         | `http://127.0.0.1:5000/api/crm/health`          |
| Skyline 转发检查     | `http://127.0.0.1:5000/api/skyline/health/live` |
| Auth 转发检查        | `http://127.0.0.1:5000/api/auth/health/live`    |
| 服务间入口           | `http://127.0.0.1:5000/feign/<服务名>/**`       |
| 公网入口检查         | `https://chat-web.lisfes.cn/health`             |
| 部署目录             | `/opt/chat-web-gateway-service`                 |
| Docker 网络          | `chat-web-infrastructure`                       |
| Nacos Data ID        | `chat-web-gateway-service.yaml`                 |
| Nacos Group          | `DEFAULT_GROUP`                                 |
| Nacos Namespace 名称 | `chat-web-service`                              |
| Nacos 服务名         | `chat-web-gateway-service`                      |
| Nacos 公网入口       | `https://chat-web-nacos.lisfes.cn/nacos/`       |
| 部署主机             | `chat-home-server`                              |
| Runner 标签          | `chat-home-server`                              |

Namespace ID 是本机 Nacos 的运行参数。恢复机器时先在 Nacos 控制台确认 `chat-web-service` 的实际 ID，再填写服务器 `.env`，不要根据历史机器配置猜测。

## WireGuard 双机规约（10.66.0.2 / 10.66.0.3 禁止互抢）

`10.66.0.3` 是另一台客户端机器，不是基础设施宿主。改这边防火墙/上游时，禁止把对端写成单个 IP，否则会出现“改这边那边断、改那边这边断”。

| IP | 角色 | 允许做什么 | 禁止做什么 |
| --- | --- | --- | --- |
| `10.66.0.1` | 云端 Nginx / WireGuard 网关 | 作为公网 Redis/Rabbit/Kafka 的来源 IP | 不要删掉它的放行 |
| `10.66.0.2` | Home 基础设施宿主 | Redis/Rabbit/Kafka 只部署在这里；portproxy 只绑这台 | 不要把云端上游改到别的机器 |
| `10.66.0.3` | 另一台客户端 | 直连 `10.66.0.2:18080-18083` 使用基础设施 | 不要把 Redis/Rabbit/Kafka 迁到这台，也不要让云端上游指向它 |

硬性规则：

1. 云端 Nginx stream 上游永远是 `10.66.0.2:18080`（Redis）、`18081-18083`（Rabbit/Kafka）。禁止改成 `10.66.0.3`。
2. 本机防火墙 `Chat Web infrastructure via WireGuard` 的 `RemoteAddress` 必须是 `10.66.0.0/24`，同时覆盖 `.1` 和 `.3`。禁止改成单个对端 IP。
3. 改规则只许并集不许替换：要放行新机器就加进网段，不要把原来的 `.1` 或 `.3` 删掉。
4. 遗留单 IP 规则必须删掉，尤其是 `Chat Web Rabbit Kafka via WireGuard`。
5. WireGuard **服务端**每个 peer 的 `AllowedIPs` 必须是该 peer 的 `/32`。禁止把 `10.66.0.0/24` 挂在某一个 peer 上，否则会吞掉另一台。
6. WireGuard **客户端** `AllowedIPs` 用 `10.66.0.0/24`，禁止 `0.0.0.0/0`。
7. 阿里云安全组源 IP 只加不删。
8. 计划任务 `ChatWeb-WireGuard-PortProxy` 只修 `18080-18083` 监听，禁止改防火墙 `RemoteAddress`。
9. 验收必须两边都测才算过：公网 `chat-web-redis.lisfes.cn:6379`（源 IP `.1`）发 Redis `PING` 返回 `-NOAUTH`/`PONG`；`10.66.0.3` 直连 `10.66.0.2:18080` 也要通。只测一边不算过。`.3` 暂时离线时，仍按这条规约改规则，禁止为了“修 .3”去改云端上游。

管理员脚本：`deploy/allow-wireguard-infrastructure.ps1`。


## P0 事故：Redis 公网域名连不上，portproxy 有规则但没在听（2026-09-18）

这是公网基础设施入口事故的主记录。Docker 内业务连 `chat-web-redis:6379` 不受影响。

### 影响

- 级别：P0。`chat-web-redis.lisfes.cn:6379` 反复连不上；RedisInsight / 开发电脑客户端失败。同一条链路的 RabbitMQ `5672` / `15672`、Kafka `9092` 也会一起挂。
- 直接症状：本机 `127.0.0.1:16379` Redis 协议正常（`NOAUTH`）；Auth 容器健康检查 Redis `connected=true`；公网域名 TCP 能握手后被 RST，或 Redis 客户端超时。
- 不要误判：`netsh interface portproxy show v4tov4` 仍显示 `10.66.0.2:18080 -> 127.0.0.1:16379` **不等于** 正在监听。`Test-NetConnection chat-web-redis.lisfes.cn -Port 6379` 成功只说明云端 Nginx 接受了 TCP，不说明上游 `18080` 活着。

### 时间线

1. Redis 公网链路固定为：域名 `6379` → 云端 Nginx stream → WireGuard `10.66.0.2:18080` → 本机 portproxy → `127.0.0.1:16379` → 容器 `6379`。
2. Docker Desktop 重启 / WireGuard 抖动后，Windows `iphlpsvc` 丢掉绑在 `10.66.0.2` 上的监听套接字，但 netsh 配置还在。
3. 2026-09-18：容器约 00:20 重建后，`netstat` 上 `18080`–`18083` 均无 `LISTENING`。本机 Python 探测 `10.66.0.2:18080` 拒绝或超时；公网 `PING` 被 RST。
4. 处置：重绑四条 portproxy，安装 SYSTEM 计划任务 `ChatWeb-WireGuard-PortProxy`（开机 45 秒后、之后每 5 分钟）自动补监听。禁止把 Redis 再发布到 `10.66.0.2:6379`。

### 根因

Windows `netsh portproxy` 把监听绑在 WireGuard 地址 `10.66.0.2` 上。接口或 IP Helper 重启后：

| 检查项 | 故障时 | 正常时 |
| --- | --- | --- |
| `netsh interface portproxy show v4tov4` | 仍有 `18080→16379` | 同样有规则 |
| `netstat -ano` 是否 `10.66.0.2:18080 LISTENING` | **无** | 有，进程为 `svchost` / IP Helper |
| 本机 `127.0.0.1:16379` Redis 协议 | 通 | 通 |
| 公网域名 Redis 协议 | RST / 超时 | `-NOAUTH` 或 `PONG` |
| Docker 内 `chat-web-redis:6379` | 通 | 通 |

Docker Desktop 不会把容器端口映射到 WireGuard 网卡，所以必须继续用 portproxy，不能改回 `10.66.0.2:6379`。

### 错误处置（禁止再做）

- 只看 netsh 有规则、或公网 `Test-NetConnection :6379` 成功，就宣布 Redis 好了。
- 打开 RedisInsight TLS / `rediss://`。
- 把 Redis 发布回 `0.0.0.0:6379` 或 `10.66.0.2:6379`。
- 为修公网 Redis 去改业务服务 `NACOS_REGISTER_IP`，或本机再跑 Gateway。
- 把防火墙 RemoteAddress 从 `10.66.0.0/24` 改成 `10.66.0.1` 或 `10.66.0.3` 其中一个。
- 把云端 Redis/Rabbit/Kafka 上游从 `10.66.0.2` 改到 `10.66.0.3`。
- 执行 `docker compose down -v` 或删除 `20260801231547_redis-data`。

### 正确处置

1. 先测三层：本机 `127.0.0.1:16379` 协议、`netstat` 是否监听 `10.66.0.2:18080`、公网域名发 `PING\r\n` 是否返回 Redis 报文。
2. 管理员运行 `allow-wireguard-infrastructure.ps1`。它会重建防火墙、四条代理，并把静默修复脚本装到 `C:\ProgramData\chat-web\`，注册计划任务。
3. 任务每 5 分钟检查监听；缺了就删加 portproxy 并重启 `iphlpsvc` 再绑一次。日志：`C:\ProgramData\chat-web\portproxy-repair.log`。
4. Redis 客户端继续明文、`chat-web-redis.lisfes.cn:6379`、填密码；本机程序用 `127.0.0.1:16379`；容器用 `chat-web-redis:6379`。

### 验收命令

```powershell
docker inspect chat-web-redis --format '{{json .HostConfig.PortBindings}}'
netstat -ano | findstr LISTENING | findstr 18080
netsh interface portproxy show v4tov4
Get-ScheduledTask -TaskName ChatWeb-WireGuard-PortProxy
python -c "import socket; s=socket.create_connection(('127.0.0.1',16379),5); s.sendall(b'PING\r\n'); print(s.recv(64)); s.close()"
python -c "import socket; s=socket.create_connection(('chat-web-redis.lisfes.cn',6379),8); s.sendall(b'PING\r\n'); print(s.recv(64)); s.close()"
```

预期：Redis 只发布 `127.0.0.1:16379`；`10.66.0.2:18080` 为 `LISTENING`；两条 `PING` 都返回 `-NOAUTH Authentication required.` 或认证后 `PONG`。只握手成功但发 `PING` 被 RST，仍算失败。

## P0 事故：同机服务注册 WireGuard 地址导致业务 503（2026-09-17）

这是跨服务事故的主记录。Skyline、Finance、Auth、Account、CRM 与同机 Gateway 都适用。

### 影响

- 级别：P0。生产 Gateway 按 Nacos 实例转发 Skyline/Finance/Auth/Account/CRM 时返回业务 503、`ECONNREFUSED` 或探活超时。
- 直接症状：容器自身 `/health*` 正常，但从 Gateway 访问 `/api/skyline/health/live`、`/api/finance/health`、`/api/auth/health`、`/api/account/health`、`/api/crm/health` 失败。
- 公网入口 `https://chat.lisfes.cn/api/**` 同步失败。

### 时间线

1. 2026-09-16：为打通跨主机访问，部署改为强制写入 `NACOS_REGISTER_IP=10.66.0.2`，并把业务端口发布到宿主机。
2. Docker Desktop 不会把 `0.0.0.0:<port>` 映射到 WireGuard 网卡。本机 `127.0.0.1:5030` 返回 200，`10.66.0.2:5030/5040/5010/5050` 全部超时。
3. Skyline `5040` 曾被 Windows `CDPSvc` 占用 `0.0.0.0:5040`，宿主机端口发布失败，问题被进一步掩盖。
4. 同机 Gateway 按 Nacos 注册地址访问 `10.66.0.2:<port>`，连接失败，业务 503。
5. 2026-09-17：清除 Skyline/Finance/Auth/Account 的 `NACOS_REGISTER_IP`，改为注册容器网卡 IP。公网继续走本机 Nginx `80/443` → Gateway（Docker DNS 后备）。不要把 `10.66.0.2` 写回这四个服务。
6. 同日稍后：Gateway 部署验收仍失败。公网实测仅 `/api/crm/health` 超时；CRM 仍强制写入并可能从 Gateway `.env` 继承 `NACOS_REGISTER_IP=10.66.0.2`。Nacos 心跳仍在，验收脚本因此空等约 18 分钟。随后 CRM 按同一规则停止强制注册 WireGuard 地址。

### 根因

同机 Gateway 与业务容器都在 `chat-web-infrastructure`。Nacos 注册地址必须是 **Gateway 容器能直接访问** 的地址。

| 地址 | 谁能访问 | 同机 Gateway 能否作为上游 |
| --- | --- | --- |
| 容器网卡 IP:`<port>` | Docker 网络内 | 能，这是正确注册地址 |
| `127.0.0.1:<published-port>` | 仅宿主机 | 不能当作 Nacos 实例地址 |
| `10.66.0.2:<port>` | 期望给跨主机 WireGuard 使用 | **不能**。Docker Desktop 对 WG 网卡端口映射不通 |

### 错误处置（禁止再做）

- 看到跨主机需求就强制 `NACOS_REGISTER_IP=10.66.0.2`。
- 用宿主机 `Test-NetConnection 10.66.0.2 -Port 5040` 或本机 `127.0.0.1:5040` 200 当作 Gateway 可达证据。
- 把 `10.66.0.2` 写回 Skyline/Finance/Auth/Account/CRM 生产 `.env`。
- 为了让 `10.66.0.2:5040` 通而禁用 `CDPSvc`；保持 `Stopped` + `Manual` 即可，不要禁用服务。
- 把 Gateway 生产 `.env` 的 `NACOS_REGISTER_IP` 清掉当作修复手段。Gateway 入口走 Nginx，不靠业务端口映射到 WG。

### 正确处置

1. 同机业务服务 **不要** 设置 `NACOS_REGISTER_IP`，让进程探测容器网卡 IP 并注册。
2. 公网入口只走本机 Nginx `80/443`，再转到 Gateway `5000`；不要让 Gateway 去打 `10.66.0.2:5010/5020/5030/5040/5050`。
3. 部署后必须在 **Gateway 容器内** 探测 `/api/<service>/health*`，HTTP 200 且业务 `status=UP` 才算成功。HTTP 200 + 业务 503 视为失败。
4. 若确需跨主机注册，必须先从将要调用它的 Gateway 证实该 `IP:port` 可达，再写入 `NACOS_REGISTER_IP`；`deploy.sh` 已按此探测，失败则中止切换。

### 验收命令

在 WSL `Ubuntu-24.04` 执行；不要打印 `.env` 值。

```bash
docker ps --filter name=chat-web-skyline-service --filter name=chat-web-finance-service --filter name=chat-web-auth-service --filter name=chat-web-account-service --filter name=chat-web-crm-service --filter name=chat-web-gateway-service
docker exec chat-web-skyline-service sh -c 'printf %s "${NACOS_REGISTER_IP-}"'
docker exec chat-web-finance-service sh -c 'printf %s "${NACOS_REGISTER_IP-}"'
docker exec chat-web-auth-service sh -c 'printf %s "${NACOS_REGISTER_IP-}"'
docker exec chat-web-account-service sh -c 'printf %s "${NACOS_REGISTER_IP-}"'
docker exec chat-web-crm-service sh -c 'printf %s "${NACOS_REGISTER_IP-}"'
docker exec chat-web-gateway-service node -e "fetch('http://127.0.0.1:5000/api/skyline/health/live').then(r=>r.text()).then(console.log)"
docker exec chat-web-gateway-service node -e "fetch('http://127.0.0.1:5000/api/finance/health').then(r=>r.text()).then(console.log)"
docker exec chat-web-gateway-service node -e "fetch('http://127.0.0.1:5000/api/auth/health').then(r=>r.text()).then(console.log)"
docker exec chat-web-gateway-service node -e "fetch('http://127.0.0.1:5000/api/account/health').then(r=>r.text()).then(console.log)"
docker exec chat-web-gateway-service node -e "fetch('http://127.0.0.1:5000/api/crm/health').then(r=>r.text()).then(console.log)"
docker exec chat-web-gateway-service node -e "fetch('http://127.0.0.1:5000/api/auth/codex/write').then(r=>console.log(r.status))"
curl -fsS https://chat.lisfes.cn/api/skyline/health/live
curl -fsS https://chat.lisfes.cn/api/finance/health
curl -fsS https://chat.lisfes.cn/api/auth/health
curl -fsS https://chat.lisfes.cn/api/account/health
curl -fsS https://chat.lisfes.cn/api/crm/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://chat.lisfes.cn/api/auth/codex/write
curl -fsS http://127.0.0.1:5040/health/live
```

预期：五个业务容器 `NACOS_REGISTER_IP` 为空；Gateway 与公网健康检查均为 HTTP 200 且业务 UP；验证码 `codex/write` 为 200。`127.0.0.1:5040` 可以为 200。`10.66.0.2:5040` / `10.66.0.2:5030` / `10.66.0.2:5020` 超时 **不** 表示故障，也不要据此把 WireGuard 地址写回 Nacos。

### 何时写 `NACOS_REGISTER_IP`

`.env` 里的 `NACOS_REGISTER_IP` 只表示 **Nacos 服务发现里登记的实例 IP**，给 **将要调用它的 Gateway** 连。它不是公网入口，也不是“要不要把流量切到本地”的开关。流量切到本地靠 `NACOS_REGISTER_WEIGHT`，不靠把 Nginx 上游换成 `host.docker.internal`。

| 场景 | 写不写 | 写什么 |
| --- | --- | --- |
| 同机 Docker 业务容器（生产基线） | **不写** | 进程自动登记容器网卡 IP，同机 Gateway 走 Docker 网络即可访问 |
| 本机 `yarn dev` / `nest --watch` 业务进程，要让 **同机 Docker Gateway** 按高权重转发过来 | **要写** | 写 Gateway **容器内**能访问的宿主机地址。当前 Gateway 在 `172.20.0.0/16`，宿主机桥接网关是 `172.20.0.1`。不要写 `127.0.0.1`，也不要写 `10.66.0.2` |
| 本机进程要被 **另一台机器** 经 WireGuard 发现 | **要写，且先探测** | 才考虑 `10.66.0.2`。必须先从那台机器上的 Gateway 证实 `IP:port` 可达，失败就不要登记 |
| Gateway 自己 | 可保留跨主机发现地址 | 公网入口走 Nginx `80/443`，不要为了修业务 503 去改或清空它 |
| CRM | **不写** | 与另外四个业务服务相同：注册容器网卡 IP。bootstrap 不得从 Gateway `.env` 继承该项 |

同机 Docker Gateway 打 `10.66.0.2:5010/5030/5040/5050` 会超时，这是 Docker Desktop 不把端口映射到 WireGuard 网卡，**不**表示本地高权重联调本身是错的。

本地联调正确姿势：业务服务 `.env` 设 `NACOS_REGISTER_WEIGHT=10`（容器实例保持 `1`），并写入 Gateway 可达的 `NACOS_REGISTER_IP`。Gateway 按平滑加权选实例，权重大的多吃流量。公网入口仍必须打到 Docker Gateway，由它处理 CORS / 鉴权 / Helmet。

## P0 事故：Nginx 把整个 Gateway 换成本地进程，登录跨域（2026-09-17）

这和「本地业务服务注册到 Nacos、权重更高、Gateway 转发到本地」不是同一件事。后者是正常联调；本次事故是入口层把 **Gateway 自己** 换掉了。

### 影响

- 级别：P0。生产登录页 `https://chat.lisfes.cn/login` 验证码加载失败，控制台 `CORS: No Access-Control-Allow-Origin` + `net::ERR_FAILED 200`。
- 页面在 `chat.lisfes.cn`，验证码和 API 请求打到 `https://chat-web.lisfes.cn/api/auth/codex/write`，带 `withCredentials`。
- 用户看到「加载失败，点击重试」。Nacos CORS 白名单当时是正常的，不要先去改白名单。

### 两层转发，不要混

| 层 | 正常 | 不正常 |
| --- | --- | --- |
| 公网 → Nginx → Gateway | 始终打到 Docker `chat-web-gateway-service:5000`。CORS、鉴权、Helmet 只在这里发 | Nginx 优先 `host.docker.internal:5000`，本地 `yarn dev` 的 Gateway 顶替生产入口 |
| Gateway → 业务服务 | 按 Nacos 平滑加权选实例。本地进程 `NACOS_REGISTER_WEIGHT=10`、容器保持 `1`，流量就会偏向本地 | 本地进程登记 `127.0.0.1` 或同机 Gateway 打不通的 `10.66.0.2`，表现为 503，不是跨域 |

### 时间线

1. 2026-09-16：本机 Nginx `web-gateway.conf` 被改成优先 `host.docker.internal:5000`，Docker Gateway 只作 backup。这会换掉整个入口，而不是按服务权重切某一条业务。
2. 2026-09-17 约 07:59：生产机启动 Gateway 的 `yarn run dev` / `nest start --watch`，本机 `node dist/main` 监听 `0.0.0.0:5000`。
3. 公网 `chat-web.lisfes.cn` 被送到这个开发网关。本地网关缺完整 `/api/auth` 路由或 CORS 头，验证码失败且无 `Access-Control-Allow-Origin`。
4. 停掉占用 5000 的开发网关后，公网重新打到 Docker Gateway，ACAO 恢复。但 Helmet 默认仍返回 `Cross-Origin-Resource-Policy: same-origin`，跨域验证码仍可能被拦。
5. 修复：生产 Nginx 只反代 Docker Gateway；Nginx 覆盖 `CORP=cross-origin`；Gateway `helmet` 同步改为 `cross-origin`。本地业务联调继续用 Nacos 高权重，不要再用 Nginx 换入口。

### 根因

1. 用 Nginx 上游模拟“本地优先”，等于换掉生产 Gateway，CORS/鉴权头不再由生产网关签发。
2. 前端与 API 分属 `chat.lisfes.cn` 和 `chat-web.lisfes.cn`。即使 ACAO 正确，Helmet 默认 `CORP=same-origin` 仍会拦跨域验证码。

### 错误处置（禁止再做）

- 看到登录跨域就去改 Nacos `gateway.cors` 白名单，而不先确认响应是不是 Docker Gateway 返回的。
- 生产 Nginx 优先 `host.docker.internal:5000` 来做本地联调。本地联调应走 Nacos 权重，而不是换入口。
- 把「本地高权重转发」和「本机 Gateway 占用 5000」当成同一件事，进而禁止所有本地注册。
- 只停开发进程、不改 Nginx 上游；下次 Gateway `nest --watch` 一起来，公网再次被换成无 CORS 的本地网关。

### 正确处置

1. 生产入口只反代 `chat-web-gateway-service:5000`。
2. 本地要接某条业务流量：该服务 `.env` 写更高的 `NACOS_REGISTER_WEIGHT`，以及 Gateway 容器可达的 `NACOS_REGISTER_IP`。
3. Nginx 对 API 覆盖 `Cross-Origin-Resource-Policy: cross-origin`，并 `proxy_hide_header` 掉上游 `same-origin`。
4. Gateway `helmet` 显式设置 `crossOriginResourcePolicy: { policy: 'cross-origin' }`。

### 验收命令

```bash
netstat -ano | findstr :5000
docker exec chat-web-nginx nginx -t
curl -sI -H "Origin: https://chat.lisfes.cn" https://chat-web.lisfes.cn/api/auth/codex/write
curl -sI -H "Origin: https://chat.lisfes.cn" https://chat.lisfes.cn/api/auth/codex/write
```

预期：公网验证码 HTTP 200、`Content-Type: image/svg+xml`、`Access-Control-Allow-Origin: https://chat.lisfes.cn`、`Access-Control-Allow-Credentials: true`、`Cross-Origin-Resource-Policy: cross-origin`。宿主机不要再有非 Docker 的 `node dist/main` 监听 `5000`。


## 认证与服务间路由配置

网关是唯一的认证入口，也是服务间调用的唯一转发点。`chat-web-gateway-service.yaml` 必须包含：

```yaml
gateway:
    feign:
        # 内省接口和业务 Feign 统一经 Gateway 转发。
        service_token: '<服务间共享凭据>'
        url: http://chat-web-gateway-service:5000
        timeout: 3000
    # 认证成功后签发的身份上下文密钥；所有业务服务必须配置同一个值。
    principal:
        secret: '<至少32位随机串>'
        maxAgeSeconds: 60
    auth:
        enabled: true
        # 内省路径固定；内省目标不在此配置，而是取 routes 中 id 为 auth 的路由，
        # 未配置该路由时回退到 id 为 account 的路由。
        introspectionPath: /internal/auth/token/introspect
        timeoutMs: 3000
        # 显式声明后会覆盖默认值，因此必须把健康检查和文档路径一并列出。
        publicPaths:
            - /health
            - /health/live
            - /health/ready
            - /doc.html
            - /services.json
            - /api/swagger
            - /api/swagger-json
            - /api/auth/codex/write
            - /api/auth/token/login
    routes:
        # 客户端入口：转发时剥离前缀。
        - {
              id: auth,
              prefix: /api/auth,
              serviceName: chat-web-auth-service,
              fallbackUrl: 'http://chat-web-auth-service:5050',
              enabled: true
          }
        # 服务间入口：必须 stripPrefix: false，否则会打到同名的公开业务路由上。
        - {
              id: feign-account,
              prefix: /feign/account,
              serviceName: chat-web-account-service,
              fallbackUrl: 'http://chat-web-account-service:5010',
              enabled: true,
              stripPrefix: false
          }
        - {
              id: feign-finance,
              prefix: /feign/finance,
              serviceName: chat-web-finance-service,
              fallbackUrl: 'http://chat-web-finance-service:5030',
              enabled: true,
              stripPrefix: false
          }
        - {
              id: feign-crm,
              prefix: /feign/crm,
              serviceName: chat-web-crm-service,
              fallbackUrl: 'http://chat-web-crm-service:5020',
              enabled: true,
              stripPrefix: false
          }
        - {
              id: feign-skyline,
              prefix: /feign/skyline,
              serviceName: chat-web-skyline-service,
              fallbackUrl: 'http://chat-web-skyline-service:5040',
              enabled: true,
              stripPrefix: false
          }

```

`deploy/migrate-nacos-routes.cjs` 会在部署时幂等补齐 `/api/auth` 和四条 `/feign/*` 路由，已存在的人工配置不会被覆盖。

**安全约束**：云端 Nginx 只能转发 `/api/*`。`/feign/*` 一旦对公网开放，服务间接口就只剩共享凭据保护。验证方式：

```bash
curl -i https://chat-web.lisfes.cn/feign/account/consumer/select        # 必须 404
curl -i -H 'x-gateway-principal: forged' -X POST https://chat-web.lisfes.cn/api/account/user/column   # 必须 401
```

Dozzle 公网入口为 `https://chat-web-dozzle.lisfes.cn`：云端 Nginx 只负责 TLS 和 WireGuard 转发，本机 Nginx 将请求代理到 `chat-web-dozzle:8080`。`logs.lisfes.com` 仅保留为本机直连兼容入口，不作为公网域名。

基础设施公网入口统一使用 Docker 容器名对应的域名。域名均解析到云服务器 `47.119.21.228`，云端 Nginx 通过 WireGuard 转发到本机 Docker：

| 容器                | 域名                          | 协议/端口                                                    |
| ------------------- | ----------------------------- | ------------------------------------------------------------ |
| `chat-web-mysql`    | `chat-web-mysql.lisfes.cn`    | MySQL TCP `3306`                                             |
| `chat-web-nacos`    | `chat-web-nacos.lisfes.cn`    | 控制台 HTTPS `443`（`/nacos/`）、客户端 gRPC `9848`          |
| `chat-web-dozzle`   | `chat-web-dozzle.lisfes.cn`   | HTTPS `443`                                                  |
| `chat-web-rabbitmq` | `chat-web-rabbitmq.lisfes.cn` | AMQP TCP `5672`、管理台 HTTPS `443` / TCP `15672`            |
| `chat-web-redis`    | `chat-web-redis.lisfes.cn`    | Redis TCP 公网 `6379`（WireGuard `18080`，本机回环 `16379`） |
| `chat-web-kafka`    | `chat-web-kafka.lisfes.cn`    | Kafka TCP `9092`                                             |

开发电脑无需安装 WireGuard。MySQL、Redis、RabbitMQ 和 Kafka 客户端分别使用上表域名及对应端口；MySQL 使用独立开发账号，不使用 `root`。公网基础设施链路如下：

- Redis：`chat-web-redis.lisfes.cn:6379` → 云端 Nginx → WireGuard `10.66.0.2:18080` → 本机 `127.0.0.1:16379` → 容器 `6379`。
- RabbitMQ AMQP：`chat-web-rabbitmq.lisfes.cn:5672` → WireGuard `10.66.0.2:18081` → 本机 `127.0.0.1:15674` → 容器 `5672`。
- RabbitMQ 管理台：浏览器使用 `https://chat-web-rabbitmq.lisfes.cn/` → 本机 Nginx `80` → 容器 `chat-web-rabbitmq:15672`；需要 TCP 访问时，`chat-web-rabbitmq.lisfes.cn:15672` → WireGuard `10.66.0.2:18082` → 本机 `127.0.0.1:15673` → 容器 `15672`。
- Kafka：`chat-web-kafka.lisfes.cn:9092` → WireGuard `10.66.0.2:18083` → 本机 `127.0.0.1:19092` → 容器 `9092`。

本机端口代理由 `allow-wireguard-infrastructure.ps1` 幂等创建：`18080→16379`、`18081→15674`、`18082→15673`、`18083→19092`。阿里云安全组只应向受信任的开发电脑公网 IP 开放这些 TCP 端口（公网端口仍为 `6379`、`5672`、`15672`、`9092`），禁止向全网开放。

验证云端入口：

```powershell
Test-NetConnection chat-web-mysql.lisfes.cn -Port 3306
mysql -h chat-web-mysql.lisfes.cn -P 3306 -u chat -p
Test-NetConnection chat-web-redis.lisfes.cn -Port 6379
```

Redis 客户端使用明文连接（不要使用 `rediss://`），填写域名端口 `6379` 和 Redis 密码；本机宿主程序直连时使用 `127.0.0.1:16379`，Docker 内服务继续使用 `chat-web-redis:6379`。云端 Nginx 的 stream 上游必须是 `10.66.0.2:18080`，不能再指向 `10.66.0.2:6379`。

云端 Nginx 配置通过只读 bind mount `/opt/chat-web-cloud/nginx.conf:/etc/nginx/nginx.conf:ro` 使用。若采用原子替换（先上传临时文件再 `mv`）更新配置，运行中的容器仍可能持有旧 inode；替换后必须执行 `docker compose -p chat-web-cloud -f /opt/chat-web-cloud/compose.yml up -d --no-deps --force-recreate web`，再检查容器内配置哈希和健康状态。仅 `nginx -s reload` 适用于直接修改同一个 inode 的场景。RabbitMQ/Kafka 的 stream 上游必须分别使用 `10.66.0.2:18081`、`10.66.0.2:18083`，不能再指向旧的 `10.66.0.2:5672`、`10.66.0.2:9092`；RabbitMQ 管理台继续走本机 Nginx `80`。

这些基础设施入口都是 TCP 端口，不能使用 Dozzle 的 HTTP 检查方式；如果连接失败，依次检查 DNS、安全组、云端 Nginx `stream` 配置、WireGuard 到 `10.66.0.2` 的连通性及本机防火墙。RabbitMQ 管理台使用 `https://chat-web-rabbitmq.lisfes.cn/`，Nacos 控制台使用 `https://chat-web-nacos.lisfes.cn/nacos/`。

本机 Windows 防火墙只允许 `chat-web-home` WireGuard 接口访问必要端口（Account `5010`、`18080`–`18083` 以及现有 HTTP、MySQL、Nacos 入口），不再放行旧的 RabbitMQ/Kafka 端口 `5672`、`15672`、`9092`。由于 Docker Desktop 的端口发布默认不能从 WireGuard 地址直接访问，脚本会幂等创建四条本机回环代理，并清理旧的 `6379`、`16379`、`5672`、`15672`、`9092` 监听规则。首次配置、Docker Desktop 重启后公网 Redis 连不上、或 `18080` 没有 LISTENING 时运行以下命令。脚本会弹出 UAC，重建代理，并安装开机/每 5 分钟自动修复任务：

```powershell
powershell -ExecutionPolicy Bypass -File F:\chat-web-service\chat-web-gateway-service\deploy\allow-wireguard-infrastructure.ps1
```

确认 Redis 映射和旧规则清理：

```powershell
docker inspect chat-web-redis --format '{{json .HostConfig.PortBindings}}'
netsh interface portproxy show v4tov4
Test-NetConnection chat-web-redis.lisfes.cn -Port 6379
```

预期 Redis 容器仅发布 `127.0.0.1:16379`，portproxy 存在 `10.66.0.2:18080 -> 127.0.0.1:16379`，`netstat` 能看到 `10.66.0.2:18080 LISTENING`，且不存在 `10.66.0.2:6379` 或 `10.66.0.2:16379` 的旧监听规则。计划任务 `ChatWeb-WireGuard-PortProxy` 应为 Ready。若仅 TCP 成功但 RedisInsight 仍提示无法连接，先对本机和公网域名发送 Redis `PING`；再从云端执行 `nc -vz 10.66.0.2 18080`，检查云端 Nginx stream 上游和 WireGuard 防火墙；认证失败时只重新填写密码，不启用 TLS。

确认 RabbitMQ/Kafka 映射和旧规则清理：

```powershell
docker inspect chat-web-rabbitmq --format '{{json .HostConfig.PortBindings}}'
docker inspect chat-web-kafka --format '{{json .HostConfig.PortBindings}}'
netsh interface portproxy show v4tov4
Test-NetConnection chat-web-rabbitmq.lisfes.cn -Port 5672
Test-NetConnection chat-web-rabbitmq.lisfes.cn -Port 15672
Test-NetConnection chat-web-kafka.lisfes.cn -Port 9092
```

预期 RabbitMQ 容器发布 `127.0.0.1:15674:5672`、`127.0.0.1:15673:15672`，Kafka 发布 `127.0.0.1:19092:9092`；portproxy 存在 `10.66.0.2:18081 -> 127.0.0.1:15674`、`10.66.0.2:18082 -> 127.0.0.1:15673`、`10.66.0.2:18083 -> 127.0.0.1:19092`，且不存在旧的 `10.66.0.2:5672`、`10.66.0.2:15672`、`10.66.0.2:9092` 监听规则。TCP 探测成功后仍需使用 AMQP 客户端完成连接、RabbitMQ 管理台登录以及 Kafka `ApiVersions` 握手验证。

日志页首屏优化由本机 Nginx 完成：静态 JS、CSS、字体和图片启用 gzip、缓冲和一年 immutable 缓存，日志流路径保持 `proxy_buffering off` 与 3600 秒长连接超时。验证命令：

```powershell
curl -k -I -H "Accept-Encoding: gzip" https://chat-web-dozzle.lisfes.cn/assets/main-PgmtVYCl.js
docker exec chat-web-nginx nginx -t
docker exec chat-web-nginx nginx -s reload
```

静态资源响应应包含 `Content-Encoding: gzip` 和 `Cache-Control: public, max-age=31536000, immutable`；首页返回 `307 /login` 表示 Dozzle 鉴权入口正常。

仓库根目录和服务器 `deploy/.env.example` 均只保留进程启动及 Nacos 建连/注册字段；路由、后备地址、跨域、限流、入口认证及注册发现配置统一以 Nacos 远端 `chat-web-gateway-service.yaml` 为准。

启用入口认证前，必须在 Gateway Nacos `gateway.auth` 中配置 `enabled: true`、`introspectionPath: /internal/auth/token/introspect`、`timeoutMs` 和公开路径数组，并在 Gateway Nacos `gateway.feign.service_token` 写入真实凭据；Auth Nacos `gateway.feign.service_token` 必须使用同一个真实凭据。凭据只写入 Nacos，不写入 `.env`、镜像、仓库或日志。Gateway 会通过 Nacos `id: auth` 路由的服务发现或 `fallbackUrl` 调用内部接口，内部认证路径不能加入 `gateway.routes`。

Gateway 没有业务数据库或业务 Redis 所有权，不得配置 Account/Finance MySQL 连接或直接读取其 Redis index。所有业务访问只通过现有 Nacos 路由或显式服务 URL 转发。

部署主机上的 `$DEPLOY_PATH/.env` 由 `runner:runner` 持有并使用 `0600` 权限，供专用 Runner 读取 Nacos 建连参数；如果文件被 root 创建，先执行 `chown runner:runner "$DEPLOY_PATH/.env" && chmod 600 "$DEPLOY_PATH/.env"`，不要放宽为全局可读。

部署会把遗留 `/api/windows/finance`、Account 根前缀 `/api` 幂等迁移为 `/api/finance`、`/api/account`，并验证两个服务的健康接口响应体 `code=200`。若迁移失败，先核对本机 Gateway Data ID 是否同时包含 Account 与 Finance 路由；不要手工复制历史机器的完整 Nacos 配置。

### 文档页首次加载慢

Knife4j 的 `doc.html` 只加载当前页面需要的脚本，其他 chunk 按需加载。本机 Nginx 对 hash 静态资源启用 gzip 和一年 immutable 缓存；首次部署后可用以下命令确认压缩和缓存头已经生效：

```powershell
curl -k -I -H "Accept-Encoding: gzip" https://chat-web.lisfes.cn/assets/js/chunk-vendors.8e9185cb.js
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
curl -kfsS https://chat-web.lisfes.cn/health
curl -kfsS https://chat-web.lisfes.cn/api/skyline/health/live
curl -k -i -X OPTIONS https://chat-web.lisfes.cn/api/account/auth/token/login -H "Origin: https://chat.lisfes.cn" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
curl -k -i https://chat-web.lisfes.cn/api/account/user/resolver
```

日志配置预期为 `json-file`、`max-size=20m`、`max-file=30`。Gateway 请求日志会记录 `logId`、服务前缀 URL、状态码和耗时，但不会新增 Consumer 服务路由；Consumer 始终通过 `/api/account/consumer/**` 转发。

跨域预检应返回 `204`，并包含 `Access-Control-Allow-Origin: https://chat.lisfes.cn`、`Access-Control-Allow-Credentials: true`，且 `Access-Control-Allow-Headers` 包含 `Content-Type`。实际代理响应也必须返回相同的精确 Origin，不能返回 `*`。Origin 和凭据策略统一维护在云端 Nacos `gateway.cors`；Gateway 不透传下游服务的 `Access-Control-*` 响应头，Nginx 不重复生成 CORS 响应头。

启用入口认证后，最后一条未携带 Token 的业务请求应返回 `401`；登录、验证码、健康检查、Swagger 和 CORS 预检仍应正常返回。若返回 `503`，先检查 Auth 容器健康、Nacos `id: auth` 服务发现和两端 `gateway.feign.service_token` 是否一致；不得在日志中打印凭据。

`/health` 中 `source` 为 `fallback` 表示 Account 尚未注册到 Nacos，但 Docker 后备地址仍可用；`healthyInstances` 大于 0 表示已通过 Nacos 服务发现。

### 2. 检查 Nacos 和 Docker 网络

```powershell
docker network inspect chat-web-infrastructure
docker logs --tail 100 chat-web-nacos
```

Gateway、Account、CRM、Finance、Skyline、Nacos 必须加入 `chat-web-infrastructure`。Nacos 必须存在 `chat-web-gateway-service.yaml`，各服务后备地址分别使用容器名与 `5010`、`5020`、`5030`、`5040` 端口。公网 `chat-web.lisfes.cn` 由云端 Nginx 经 WireGuard 转发到本机 `10.66.0.2:80`，本机入口再转发到 Gateway `5000`。

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

| 现象                   | 原因                                                          | 处理                                                                  |
| ---------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 部署一直 Queued        | `chat-home-server` 的 Gateway Runner 离线                     | 启动 WSL 并重启 Gateway Runner                                        |
| 5000 拒绝连接          | Gateway 未部署或未通过健康检查                                | 查看容器状态和日志，核对 `/opt` 下 `.env`                             |
| Nacos 配置不存在       | Namespace ID、Data ID 或 Group 不一致                         | 核对本机 Namespace 和 `chat-web-gateway-service.yaml`                 |
| Account 转发 502       | Account 容器不可达且 Nacos 无健康实例                         | 检查 Account 健康和 Docker 网络                                       |
| `healthyInstances: 0`  | Account 尚未注册到 Nacos                                      | 部署包含 Account 注册逻辑的新镜像；fallback 可暂时继续服务            |
| 业务请求统一返回 `401` | Gateway `gateway.auth.publicPaths` 缺少登录、验证码或文档路径 | 补齐 Nacos 公开路径后等待配置订阅生效，再验证预检和登录               |
| Gateway 认证返回 `503` | Auth 内部认证接口不可达或服务凭据缺失/不一致                  | 检查 Auth 健康、Docker 网络及两端 Nacos 凭据；不要关闭下游权限校验 |
| 管理端 CORS 预检失败   | Nacos 未启用凭据或未允许管理端 Origin                         | 核对 `gateway.cors`，再确认响应允许 `Content-Type` 请求头             |
| 登录页验证码跨域 / `ERR_FAILED 200` | Nginx 把整个 Gateway 换成本地 `yarn dev`，或 Helmet `CORP=same-origin` | Nginx 只反代 Docker Gateway 并覆盖 `CORP=cross-origin`；本地业务联调用 Nacos 高权重，不要换入口；不要先改 Nacos CORS |
| Redis 域名连接超时 / 握手后 RST | netsh 仍有 `18080` 规则但没有 LISTENING；Docker/WG 重启丢掉了绑定 | 看 `netstat` 是否监听 `10.66.0.2:18080`，不要只看 netsh；跑 `allow-wireguard-infrastructure.ps1` 或等计划任务 `ChatWeb-WireGuard-PortProxy`；再用 Redis `PING` 验收 |
| 公网 Redis 和好了但 `10.66.0.3` 直连失败，或反过来 | 防火墙 RemoteAddress 写成单个对端 IP，两台机器互抢 | Remote 改回 `10.66.0.0/24`，删除单 IP 遗留规则；不要改云端上游；两边都测才算过 |
| 业务健康检查 503 但容器自身 UP | 同机服务把 Nacos 注册成不可达的 `10.66.0.2` | 删除业务服务 `NACOS_REGISTER_IP` 并重建容器；从 Gateway 复测 `/api/<service>/health*`；不要写回 `10.66.0.2` |

## 恢复顺序

1. 启动 Docker Desktop、Nacos 和 Account。
2. 确认 `chat-web-infrastructure` 网络和 Gateway Nacos 配置存在。
3. 确认 `/opt/chat-web-gateway-service/.env` 使用本机 Namespace ID。
4. 启动 WSL 保活任务和 Gateway Runner。
5. 在 GitHub Actions 手动运行当前稳定分支的 `Build and deploy`。
6. 验证镜像 SHA、Gateway 健康和 Account 转发。

每次处理完成后，把新原因和恢复命令补充到 `deploy/CHANGELOG.md`。

### Redis 公网转发回滚

若需要回滚 Redis 转发改造，先停止依赖公网 Redis 的客户端，再在云端 Nginx stream 中恢复原上游并 reload；本机删除 `10.66.0.2:18080` portproxy 后，将 Compose 发布端口恢复为 `127.0.0.1:6379:6379`，执行 Redis 容器重建并确认外部数据卷未被删除。回滚期间 Docker 内服务仍使用 `chat-web-redis:6379`，不要执行 `docker compose down -v` 或删除 `20260801231547_redis-data` 卷。
