# Repository instructions

本文件在本仓库内独立生效，不依赖 `F:/chat-web-service/AGENTS.md` 或其他工作区文件。

## 通用工程规则

- 使用 Node.js 22、Yarn 1.22.22、NestJS 11 和 TypeScript；源码使用 UTF-8，Shell、YAML 和 Dockerfile 使用 LF。
- 统一使用 4 空格、无分号、单引号、`printWidth: 140`、无尾随逗号；内部源码统一使用 `@/*` 路径别名。
- 文件名使用小写 kebab-case 和职责后缀；类、接口、枚举使用 PascalCase，变量、函数使用 camelCase，常量和注入 Token 使用 UPPER_SNAKE_CASE。
- 日志、校验消息、Swagger 描述和面向维护者的错误信息使用中文，代码标识符使用英文。
- 业务源码和配置文件必须编写清晰、必要的中文注释；配置文件包括 Nacos YAML、Compose、Dockerfile、Actions 和 `.env.example`。新增配置项必须同步说明用途，修改或格式化时必须保留既有注释，不得删除、覆盖或改写；注释中不得出现真实密码、Token、私钥等敏感信息。
- HTTP Controller 只允许 GET、POST；GET 使用 query，POST 使用 body；多选参数必须是数组，禁止使用 `/:uid` 等路径参数。
- 如网关新增分页管理接口，必须使用统一的 `page`、`size` 入参和 `page`、`size`、`total`、`list` 响应；不得引入 `pageSize`、`items`、`records` 或 `rows` 同义字段。
- 请求日志必须包含 logId、方法、URL、状态码、来源、入参和耗时，并脱敏密码、Token 等敏感字段。
- Gateway 只负责路由、认证基础能力、限流、日志和服务发现，不连接业务数据库或读取业务 Redis。
- `.env.example` 只列出启动所需参数和明确占位符；真实密钥、Token、私钥和生产 `.env` 不得提交。
- 每次改动至少执行格式检查、TypeScript 类型检查和 Nest 构建；涉及代理、服务发现或部署时增加运行级验证。

## 单机部署规则

- 本服务只部署到当前主机 `chat-home-server`，原另一台部署机器已废弃并下线，不得再为废弃机器创建部署任务或多机矩阵。
- GitHub Actions 使用 `chat-home-server` Runner 标签和 `production-home` Environment，只构建一次完整 Git SHA 镜像并部署到 `/opt/chat-web-gateway-service`。
- 本仓库使用独立 Self-hosted Runner；部署必须包含健康检查、路由验证和失败自动回滚，不得使用 `--remove-orphans`。

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

## 分支生命周期

- 远程仓库只保留 `main`、`developer` 两个长期分支；临时需求分支必须先合并到 `developer`，发布时同步合并到 `main`，合并并验证通过后立即删除远程和本地临时分支。

## 服务数据边界

- 网关只负责路由与协议边界，不得导入业务 Entity、连接 Account/Finance 数据库或直接读取业务 Redis 数据。
- 跨服务调用必须按 Nacos 服务名或显式服务地址转发到服务 API；需要聚合业务数据时使用强类型 HTTP 客户端 Provider，不得执行跨库 SQL。
- 若网关自身未来需要缓存，必须先分配独立 Redis index，禁止复用 Account index `0` 或 Finance index `1`。

## HTTP Controller 与 Service 编码基准

- `chat-web-account-service/src/modules/sheet/` 是 Controller、Service、DTO、Utils Service 和 Module 组织方式的唯一基准；网关按基础设施边界适配，不得另建接口风格。
- Controller 必须保持为薄协议层：只声明路由、权限、Swagger/Apifox 元数据，接收 `query`、`body` 或必要请求/响应上下文，并将参数原样交给同名 Service 方法；禁止在 Controller 内实现业务判断、业务数据组装、配置解析、服务发现或代理调度。Cookie、响应头、重定向和流式响应等纯 HTTP 协议操作可以留在 Controller，但不得把 `Request`、`Response` 或响应发送逻辑传入业务 Service。
- Controller 与对应 Service 的公开 HTTP 方法统一声明为 `public async`；CRUD、列表等通用动作通常使用 `httpBaseGateway<Action><Resource>`，Tree、Resolver 等资源专属读取语义可使用 `httpBaseGateway<Resource><Action>`，命名语义参考基准模块的 `httpBaseAccountSheetTree`、`httpBaseAccountSheetResolver`。两层方法名必须完全一致，不得只为统一单词顺序而机械倒装；Controller 直接返回同名 Service 调用结果，禁止再调用 `create`、`list`、`findOne`、`update` 等另一套短方法。
- GET 只接收 `@Query()` DTO，POST 只接收 `@Body()` DTO；无请求 DTO 的接口不制造空 DTO。每个接口必须使用 `ApiServiceDecorator` 完整声明请求来源、请求 DTO、响应 DTO、数组标识和中文说明；重定向等原始响应必须明确关闭统一响应外壳。
- Service 负责业务编排，公开 HTTP 方法必须添加简洁中文职责注释并显式声明 `Promise<...>` 返回类型；健康检查、网关信息和文档重定向数据也由 Service 返回，Controller 不得内联对象。模块请求 DTO 在 Service 中优先使用 `import * as XxxDto` 归组引用。
- DTO 和接口枚举放在模块 `dto/` 目录，优先通过共享基础 DTO 复用字段；字段必须提供 Swagger 示例/说明、必要的类型转换和中文校验消息。分页 DTO 使用公共 `PageDto`，响应固定为 `page`、`size`、`total`、`list`。
- 若项目数据边界允许实体查询，必须优先使用公共 `DataBaseService.builder`，QueryBuilder 别名固定为 `t`；网关当前仍禁止连接业务数据库或为此重复封装 QueryBuilder。
- 仅当查找、校验、锁、树结构或可复用转换形成独立职责时才创建 `<module>.utils.service.ts`，使用 `@Injectable()` 并由 Module 注册注入；仅调用一次且无复用价值的简单步骤不得机械拆成 Utils Service。Module 按 `imports`、`controllers`、`providers`、`exports` 组织。
- 普通业务可选入参统一使用 `class-validator` 的 `isEmpty`、`isNotEmpty` 判空，禁止手写 `input.xxx !== undefined && ...` 或用隐式 truthy/falsy 代替。只有必须区分“未传、显式 null、具体值”的三态字段可以直接判断 `undefined`，且必须紧邻中文语义说明；基础设施配置、代理协议、第三方返回值、布尔值、集合长度及已确认非空值比较不受此限制。
- 重构不得改变公开路由、代理前缀、HTTP 状态、响应结构、异常消息和 Nacos 服务发现行为。

## Git 提交规范

- 所有提交信息必须使用 Conventional Commits 类型前缀，格式固定为 `<type>: 中文摘要`；如需填写作用域，使用 `<type>(<scope>): 中文摘要`。
- `type` 只能使用以下类型：`init`（项目初始化）、`feat`（添加新特性）、`fix`（修复缺陷）、`docs`（仅修改文档）、`style`（仅调整格式或样式）、`refactor`（代码重构）、`perf`（性能优化）、`test`（增加或调整测试）、`build`（构建或依赖变更）、`ci`（持续集成或部署配置）、`chore`（工程工具或其他维护性变更）。
- 提交摘要、正文和脚注必须使用中文；类型前缀保留上述英文小写关键字，代码标识符、命令和版本号可按实际需要保留原文。
- 每个提交应聚焦单一目的，摘要使用动词开头并准确说明影响范围，禁止使用 `update`、`modify` 等无意义描述或整句英文提交信息。
- 示例：`feat: 新增客户归属人筛选`、`fix: 修复 Nacos 服务注册失败`、`docs: 补充部署回滚说明`。

## 共享 Schema 依赖联动

- 当任务包含 `chat-web-base-schema` 公共能力变更时，Agent 必须自行等待共享包发布，随后将本服务升级到明确的新版本，不得要求用户手动更新依赖。
- 升级后应优先使用共享包导出的实现并删除本地重复代码，运行仓库要求的完整测试，并按部署规则同步变更记录。
- 用户已授权完成该联动任务时，Agent 应自行提交、推送、创建 PR 并合并到默认分支；只有权限、认证、分支保护或持续失败的 CI 确实阻止时才请求用户介入。
