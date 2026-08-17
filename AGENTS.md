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
