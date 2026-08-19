# Repository instructions

## 部署变更记录

任何会影响 Docker 构建、服务启动、运行参数、Nacos、路由、端口、健康检查、Runner、部署目录或外部网络的修改，都必须在同一次改动中更新 `deploy/CHANGELOG.md`。

变更记录至少包含：日期、影响机器、关联版本、变更内容、机器侧操作、验证命令和回滚方法。禁止在文档中记录密码、Token、私钥或完整 `.env`。

修改以下文件时默认属于部署变更：

- `Dockerfile`、`.dockerignore`
- `.github/workflows/**`
- `deploy/**`
- `.env.example`
- `config/nacos/**`
- Nacos Data ID、Group、Namespace、服务名和网关路由
- 服务端口、Docker 网络、健康检查和 Runner 配置

排障命令和当前运行基线维护在 `deploy/RUNBOOK.md`。

## 服务数据边界

- 网关只负责路由与协议边界，不得导入业务 Entity、连接 Account/Finance 数据库或直接读取业务 Redis 数据。
- 跨服务调用必须按 Nacos 服务名或显式服务地址转发到服务 API；需要聚合业务数据时使用强类型 HTTP 客户端 Provider，不得执行跨库 SQL。
- 若网关自身未来需要缓存，必须先分配独立 Redis index，禁止复用 Account index `0` 或 Finance index `1`。

## 共享 Schema 依赖联动

- 当任务包含 `chat-web-base-schema` 公共能力变更时，Agent 必须自行等待共享包发布，随后将本服务升级到明确的新版本，不得要求用户手动更新依赖。
- 升级后应优先使用共享包导出的实现并删除本地重复代码，运行仓库要求的完整测试，并按部署规则同步变更记录。
- 用户已授权完成该联动任务时，Agent 应自行提交、推送、创建 PR 并合并到默认分支；只有权限、认证、分支保护或持续失败的 CI 确实阻止时才请求用户介入。
