# v1.168.0 发布执行计划

状态：PR 已合并，本地硬门禁通过，提交冻结候选等待远端验证；负责人：root；日期：2026-10-23。

## 目标与授权

用户要求发布 v1.168.0，审查并合并 PR #153，核查其他模型并清理过时内容。后续明确授权先合并再完善、一起递交发布，并要求完成发布且不要再次确认。合并、必要修复、清理、提交、标签及推送均在授权范围内；不创建分支，不覆盖并行改动。

## 候选与写集

- 基底：`348e0a03a7dc61e34f984ae490e0a18e40367764`，即 PR #153 的 squash 提交；上一标签 v1.167.0。
- 纳入冻结时全部产品、文档、测试、协议、生成客户端及五语资源，包含 Browser 批注/Design/下载、设置重组、记忆与指令、听写、Git/worktree、Storage 和模型更新。
- release metadata：package.json、packages/cli/package.json、Rust workspace/Cargo.lock、两份当前版本单页发布说明。Forge 与 manifest 继续读取应用版本。
- 排除生成缓存 tsconfig.node.tsbuildinfo；冻结后新增的并行文档更新保留在工作区。
- 冻结源码、独立 index 和最终 tree identity 位于本地 `.lime/release-v11680/`；逐文件 blob 校验确认冻结源码与候选 index 一致。提交仅使用该候选，避免隐式混入后续修改。

## PR #153 审查结论

- 作者 octo-patch 为独立开发者/首次贡献者，提交 unsigned，不能确认其官方身份；MiniMax 官方文档确认对应模型、订阅地址和 Anthropic endpoint。
- 用户后续授权先合并再修复；已 ready 并 squash 合并，原 PR head 为 80452266aaef190c8f700a4cd56eddabc77920f3。
- 补齐 Flash/M3 图片能力和从订阅配置到发送门禁的回归，保留未确认 Preview/文本兄弟型号负向验证。
- 修复新增 Rust capture 测试引用不存在 helper 的编译问题，复用现有 provider_config 与多模态工具历史请求夹具。

## 模型核查与清理

- 官方文档和公开目录依据保存在模型审计 JSON（URL、内容 SHA、限制，不含凭证）；未发起付费推理请求。
- 默认模型更新覆盖 OpenAI、Claude、Gemini、Kimi、GLM、Qwen、DeepSeek、Grok、MiMo 和 MiniMax；对应前后端图片能力与上下文窗口同步。仅改变新建默认，不修改用户已保存 ID。
- OpenAI 当前默认使用 Responses；Kimi Code 使用官方 kimi-for-coding alias，套餐推荐选择通用可用档位。
- canonical 目录：180 → 253，更新 83、新增 158、删除当前 OpenRouter 源已不存在的 85 条。源缺失不等于供应商全局停用，自定义 ID 仍可请求。
- 保留 12 条独立维护的 Agnes 元数据；其公开 API 401/文档 403，无法 live 核实。6 条原有未知上下文继续使用既有 0 哨兵，不猜测窗口。
- 删除退休 OAuth 默认、SenseNova 未核实推荐值、Submodel 旧静态默认及三个接口的重复模型表；HTTP/WebSocket 委托 ModelsConfig 的启用项稳定排序/去重投影。
- canonical 映射优先精确匹配，修复 Codestral/Ministral 有效日期版本被剥离；上下文消费者统一使用 agent-protocol 既有解析器。
- 大文件退出条件：仅机械默认数据/既有推断和共享投影修复、参数化预设回归；完成定向验证后不继续叠加业务逻辑。

## 架构与分类

- current：Desktop/CLI → App Server JSON-RPC → RuntimeCore → canonical Thread/Turn/Item；网络仍归 model-provider，工具与持久化 owner 不变。
- 版本与模型数据更新不增加业务后端。候选既有 Browser/配置合同变更由 architecture.md 与领域计划记录责任开发者确认；发布不代表完整 Codex GUI/Browser 路线图验收。
- compat/deprecated：本轮不新增。deleted：旧设置首页、重复 memory/Soul UI、旧 fixture、重复模型表及上述旧目录记录。
- KISS/DRY：复用既有能力推断、canonical registry、context resolver 和配置模型投影；不增加并行事实源或兼容包装。

## 验证与退出条件

- 必须通过版本检查、完整 typecheck、contracts；相关前端/脚本和 Rust owner 定向回归按风险执行，真实 GUI smoke 尽量完成。
- 最终候选已通过模型/Storage 6 文件 103 项、定向 ESLint、版本检查、完整 contracts、模型数据完整性及新增 Rust 文件格式检查。完整 typecheck 已通过；Rust 和 GUI 构建仍在运行，未计作通过。详见发布验证收据。
- 初轮 broader frontend 集合 1235 pass/3 fail；旧 i18n 合同和听写终态等待已修复并定向通过。脚本集合 214 pass/1 timeout，权限 AST 扫描受本机负载影响，未降低断言或延长 timeout；两个 node:test 文件 6 项通过。
- 本机 16 GiB 且有并行重型构建；Rust 曾等待外部锁，缓存重建与换页限制本地速度。不终止其他任务，不用历史二进制或 mock 冒充真实 Gate B。
- 本地硬门禁通过后可先推 main，由同提交 GitHub Quality 补足完整 Rust/GUI/前端证据；通过后打 v1.168.0 标签，跟踪 Release 三平台桌面、CLI、npm 和 updater 发布终态。
- 不覆盖已存在 tag，不以 commit/tag/push 成功代替公开产物发布；未完成或失败按实际状态记录。收尾核对远端 main、tag、Release 和 npm 身份。

## 发布候选追加修复

- 首次推送 ad5ae600d：本地 model-provider 298 pass/1 fail，capture 指出 current URL builder 将 Anthropic 兼容根 /anthropic 拼为 /anthropic/messages；MiniMax 官方明确 /anthropic/v1/messages。修复既有 endpoint builder 的 Anthropic 根路径，保留完整 version/custom endpoint；不降低 capture 断言。该大文件仅修改既有 URL 分支和对应回归，不继续扩展业务。
- 远端 contracts 揭示两份发布审计 JSON 被 .gitignore 排除；增加与前版一致的精确发布证据目录例外，保留 docs 边界守卫。后续冻结验证显式使用候选 GIT_WORK_TREE / GIT_INDEX_FILE，让依赖 Git 索引的检查覆盖实际发布集。
- 纳入并行完成的 Storage 修复：未知/畸形来源与 cloud descendants 不得进入本地清理，支持合法空 feature，并修复两层对话框的键盘焦点恢复；同步领域回归和真实 fixture 断言，不改外部任务文件。
- 旧候选 GUI 构建仅由本任务正常停止，不计通过；新候选重新进行类型、前端、contracts，Rust 与 GUI 继续按实际终态记录。

- 追加候选完整 typecheck exit0（684.46 秒）；Storage UI/API 回归、定向 lint、Markdown 30 项和测试分层 38/38 通过。首候选远端 GUI smoke、全前端 lint/typecheck 通过。完整 contracts 用显式候选 Git 索引重跑中；最终远端 Quality 通过前不创建标签。

## 全量验证追加修复

- 远端 39947149402 全量前端在批次 25/148 暴露 embeddedBrowserHost 测试 Session 夹具缺失 removeListener，3 项 dispose 回归失败；补齐与真实 Session 一致的监听移除语义，不增加生产容错或降低断言。
- 同一轮 Rust 在 host_boundary_guard 暴露工作树队列依赖带实现名的客户端标识。将已有 clientInfo.name 统一为短领域名 desktop，同步 Electron producer、App Server consumer 和真实 JSON-RPC cleanup fixture，直接迁移、不保留旧标识。仅标识值迁移，不改协议 schema、owner 或依赖方向；root 确认 minor 架构影响及上述调用流，不新增后端。

- 第三候选：54 项 Host 回归、两项原始宿主边界守卫、完整 typecheck（109.22 秒）与 contracts（36.4 秒）通过；修复后的 model-provider 299/299 通过。准备推送最终修复等待完整远端矩阵。
