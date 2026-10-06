# Post 图片、AI 点评与 Supabase 首版交付

日期：2026-10-06。工作分支：`codex/post-images-ai-comments`，从本地 `develop` 创建；两者基线为 `2ae6c1bb200afec4d21f5b61257fdfb42323e286`。Owner 指定推送目标为 `dev`；提交与远程状态以 Git 记录为准。尚未进行生产部署。

## 已实施

- 数据库继续由 Hono/Drizzle 访问，支持 Supabase Direct / Session pooler、SSL、连接池上限和独立迁移 URL。保留现有认证和对象存储。
- Article 增加选图入口、上传进度、上传期间禁止保存、失败移除占位符；正文、预览与匿名分享共用可放大图片的 Markdown 组件。Rote 保留现有附件上传能力。
- 新增文章附件关联表，迁移回填作者正文中已有 URL。文章保存与清理采用用户行锁；文章引用的图片不会被未绑定清理、短笔记删除、资料图片替换或附件删除误删。解除短笔记关联仍产生同步记录。
- Article / Rote 作者可手动生成和删除私有 AI 点评。支持请求幂等、同目标并发限制、正文版本检查、过期标记、失败状态及令牌记账；图片内容不发送给模型分析，纯图片内容不生成点评。
- 移除原作者主页、GitHub 统计、官方 App、演示站和社区推荐；保留源码、自部署帮助、许可证及法律声明。中、英、日语言资源同步更新。
- 根据后续确认，移除个人资料、设置、屏蔽用户及用户主页的整组附加侧栏；文章和短笔记详情移除 RSS 与表情装饰。RSS 功能整体移除，包括后端接口、生成与查询代码、feed 依赖、页面订阅声明、Postman 请求及文档说明。前端 URL 配置继续服务分享与认证用途。
- 宣传首页整体删除，根路径 `/` 和旧 `/landing` 均转到 `/login`，登录页移除宣传首页链接，初始化成功后进入登录页。已登录用户按既有登录入口逻辑进入笔记页；未初始化站点从登录页进入设置向导。演示账号自动填充也已移除。
- 探索页移除“支持与文档”、自部署与 Issues 快速入口。“我的”和探索页复用 EveDayOneCat 组件，支持点击随机换猫及中、英、日提示。
- 新表启用 RLS，没有给 Data API 角色开放私有点评或附件关联表的策略。后端使用表所有者或具备相应数据库权限的服务端角色。

浏览器直传仍使用最终对象 Key，信任客户端元数据，确认仅写数据库；未增加对象验证、复制、处理或恢复面板。旧上传协议保持既有实现。

## 验证结果

- 前后端 `bun run lint`、`bun run build` 通过。前端保留现有循环 chunk、大 bundle、混合静态/动态导入告警。
- 完整迁移在隔离 PostgreSQL 17 和 Supabase PostgreSQL 15.8 镜像执行成功。Supabase 镜像的 pgcrypto、pgvector 可用。该结果不等同于连接真实 Supabase 云项目。
- 新增连接及评论内容单元测试：5 项通过。
- Supabase PostgreSQL 集成测试：图片关联、所有权、引用保护、共享图片解除关联同步共 3 项；评论持久化、非作者权限、请求幂等、生成竞态和数据库约束共 4 项，通过。
- 前端图片上传与评论组件测试共 5 项通过；匿名分享既有 11 项、短笔记提交和重试 19 项通过。现有上传、未绑定清理及资料图片生命周期回归 31 项通过。
- 本地浏览器连接真实后端路由和隔离数据库，AI 与对象存储由本地 fixture 提供；已验证登录、Article / Rote 手动点评、文章图片展示和放大、选图上传并保存、正文修改后的旧版点评提示。

本地模拟服务不验证云模型质量、真实对象存储 CORS、真实 Supabase SSL/网络连通性或生产备份恢复。附件引用按作者正文中的 URL 保守识别，纯文本或代码中的 URL 也会保护附件；避免误删，但可能延迟回收。

## Supabase 配置与部署

先在 Supabase 项目获取 Direct 或 Session pooler 连接串。现有服务有会话锁语义，不能直接换成 Transaction pooler。连接串只放环境变量，不提交到仓库。

```dotenv
POSTGRESQL_URL=<服务端 Direct 或 Session pooler URL>
POSTGRESQL_MIGRATION_URL=<Direct 或 Session pooler 迁移 URL>
POSTGRESQL_SSL=true
POSTGRESQL_POOL_MAX=5
VITE_API_BASE=<可被浏览器访问的后端地址>
```

迁移 URL 可与运行 URL 相同。迁移使用单连接。确认新建项目的 public schema 权限，先在独立测试库执行全部迁移：

```sh
# 在 server/ 中
bun install --frozen-lockfile
bun run db:migrate:programmatic
bun run lint
bun run build
```

独立 Supabase Compose 入口不启动本地 PostgreSQL，不与原 Compose 叠加：

```sh
# 项目根目录；先设置上述环境变量
docker compose -f docker-compose.supabase.yml config --quiet
docker compose -f docker-compose.supabase.yml up --build -d
```

首次启动需配置现有站点认证、对象存储和站点 AI。该 Compose 镜像尚未执行完整镜像构建或生产部署。

本项目保留原 JWT 身份体系。Supabase Data API 不需要时应关闭或限制暴露 schema；既有业务表不能因为新增表启用 RLS 就视为全部受保护。不要向浏览器提供数据库密码或服务端密钥。

## 已有数据迁移与发布前事项

1. 确认迁移的是已有部署还是新部署；已有部署先记录当前 migration journal、表数量、附件数量、账号及对象存储 URL。
2. 对旧业务数据库做可恢复备份，在独立 Supabase 项目试恢复并核对数据；不覆盖 Supabase 的 auth/storage 管理 schema、系统角色或平台扩展。导入保留业务 ID、对象 Key 与 URL。
3. 在试迁移数据库执行项目迁移，核对新增附件回填、账号登录、增量同步、清理候选及 AI 配置。备份恢复演练和完整旧数据回填验收尚未执行。
4. 确定维护窗口，暂停旧站写入，完成最终搬迁和计数核对，再切换后端连接。失败时回退连接及发布版本；不要让新旧数据库同时接受写入。
5. 在真实环境检查 SSL、Session 连接、存储 CORS、Article / Rote 上传、非作者点评访问限制和实际模型请求。生产发布仍需项目配置及发布授权。

## 回归测试命令

集成测试只接受数据库名以 `_product_test` 结尾的隔离库。两个集成文件分别启动 Bun 进程，避免共享连接关闭影响另一文件：

```sh
# server/；ROTE_PRODUCT_TEST_DATABASE_URL 设置为隔离库 URL
bun test database/connection.test.ts postComments/content.test.ts
bun test articles/attachmentReferences.integration.test.ts
bun test postComments/service.integration.test.ts
```

```sh
# web/；当前 Node 的实验性 Web Storage 需关闭
NODE_OPTIONS=--no-experimental-webstorage bun x vitest run src/pages/article/hooks/useArticleImages.test.tsx src/features/post-comments/PostComments.test.tsx src/features/note-sharing/SharedNotePage.test.tsx
```

需求范围与验收条件见 [需求文档](PRODUCT-OPTIMIZATION-REQUIREMENTS.zh.md)。
