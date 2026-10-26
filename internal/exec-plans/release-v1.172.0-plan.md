# v1.172.0 发布执行记录

日期：2026-10-26。责任：root。目标：验证并递交当前完整候选，创建和推送 `v1.172.0`，核验远端发布状态。

## 范围与写集

- 起点：`main` / `2f8ff31d38ba4c80598d8ed15b4ebc2215da6ae7`，上一标签 `v1.171.0`；初查远端 main 与本地相同，目标标签本地、远端均不存在。
- 用户要求“发布 v1.172.0”；初始 323 个产品、测试、协议、客户端、脚本、五语言、文档及既有删除项全部属于候选，无主动排除项。
- 本轮直接写集：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、两份 `RELEASE_NOTES*.md`、本文件及候选清单证据；`.gitignore` 仅登记本版两个可审阅 JSON 的精确例外，其余本地产物继续忽略。
- 用户随后明确要求清理旧聊天夹具及对应逻辑，授权删除过时文件、专用场景/伪后端/断言、脚本入口和 active 文档引用。清理写集扩展到 `scripts/agent-runtime/claw-chat-current-fixture*`、旧聚合入口、其实际消费者、`scripts/lib/chat-fixture/**` 和相关质量/治理事实源；不恢复兼容壳。
- 依赖盘点：旧族共 122 个文件；94 个没有族外模块消费者，28 个位于浏览器、会话恢复、草稿和文档预览测试的共享依赖闭包。按消费者迁移公共测试能力并裁剪无用导出，专用逻辑直接删除。源码、权限、存储和 runtime owner 不因旧测试删除而恢复旁路。
- 已有业务改动只读盘点与验证；不覆盖现役 owner 的并行改动。不创建分支，不覆盖已有标签，不 force push，不停止用户进程。
- Forge 与 App Server release manifest 动态读取版本；`pnpm-lock.yaml` 无旧应用版本，不改写。Cargo lock 同步 36 个 workspace 包版本。
- 发布说明采用当前版本单页，中文为主，英文为 companion。

## 候选内容与分类

- current：桌面权限引导、浏览器导航恢复和图片呈现、Computer Use 原生/Chrome/Office 执行与持续授权、canonical 媒体投影、MCP 工具展示、Electron 打包依赖闭包。
- test-only：相应单元、组件、协议、原生平台和真实进程夹具；新增测试文件不等于测试通过。
- deleted：候选既有旧 Chrome Bridge 服务与重复入口、被替换的验证辅助文件。
- deleted：旧聊天 runner 全族 122 个原路径及附属 reasoning、专家旧 evidence gate，共 132 个原路径退出；97 个旧实现/测试删除，35 个模块迁入 `scripts/lib/chat-fixture/` 并按消费者裁剪。先删除 243 个无消费者顶层符号与 26 处旧场景嵌套诊断，再删除仅供旧场景自测的模块及 16 个无用符号。额外删除没有运行消费者的 `fixtures/composer-reference.md` 及其常量和自检。共享后端由 1143 行裁到约 290 行；不保留转发壳。
- current/test-only：受控后端只支持 complete/running/silent，取消按同 sessionId/turnId 匹配；文件点击改用结构化 canonical tool inputs。现役 GUI 测试通过真实五语言“稍后设置”按钮完成首次权限引导。
- 无新增 compat/deprecated 路径。
- KISS/DRY：沿用既有版本事实源、Forge 和 GitHub Release 流水线，仅做版本同步和必要发布修复。
- 本轮 metadata 不改变架构；候选架构变更已记录在 `internal/aiprompts/architecture.md`，保留现有确认与证据边界，不把未运行的平台矩阵提升为通过。

## 验证

- `npm run verify:app-version`：通过，1.172.0。
- `npm run typecheck`：通过，完整 Renderer 与 Node 两个 TypeScript project 均通过。
- `npm run test:contracts`：通过，包含 protocol/client、Electron commands、harness、modality、scripts、release workflow、Desktop/CLI、cleanup 与 docs 边界。
- 定向 Vitest：18 个文件、175 个测试通过，覆盖桌面权限（含五语言）、浏览器导航/图片、canonical 媒体、MCP、持续授权设置与 Forge/资源闭包；完整命令与输出见 `targeted-regressions.log`。
- `npm run test:rust:unit -- -p tool-runtime computer_use`：70 通过、1 忽略、553 过滤；隔离配置下验证授权、租约、持续授权、目标快照、取消与原生宿主协议，不等于真实 Windows/macOS 平台验收。
- 早期旧聚合的四组定向测试为 377 通过、61 场景过滤跳过；该聚合现已删除，此结果只保留为清理过程记录，不作为现役门禁。
- 清理后受影响 Vitest：首轮 69 文件中 63 文件 / 1250 测试通过；5 个 suite 的 locale 路径和 1 个独立后端序列化失败已修复，定向复跑 7 文件 / 261 测试通过（包含重复 catalog）。之后继续删除无现役消费者的旧自测，最终保留的共享 Vitest 为 9 文件 / 206 测试通过；最后一个孤立数据自检删除后，rich-input 定向复跑为 73 通过，不按重复运行累加测试数。
- 清理后 Node 回归：58 测试通过，覆盖共享文本 Provider、canonical tool、并行 Turn 定向取消、无输出取消及 Composer/工作树证据。
- 清理后 `npm run test:contracts`：通过，包含协议、命令、脚本冻结基线、发布、Desktop/CLI 和文档边界。最后复查曾暴露两个已暂存 JSON 被忽略的问题，已沿既有发布证据规则增加精确例外，再运行完整链通过。
- `cargo test --manifest-path lime-rs/Cargo.toml -p app-server --test host_boundary_guard --test computer_use_jsonrpc`（隔离配置 + 仓库 rusty_v8 artifact resolver）：8 + 2 通过。此前未带 resolver 的直接 Cargo 执行遇到第三方 V8 archive 404，不能计通过。
- `npm run governance:legacy-report`：零边界违规；132 个旧路径均已删除并登记回流守卫。报告保留既有 memory path 零引用分类漂移提示。
- 媒体 sidecar 完成判断收回 `media_task::sidecar` owner，避免 image gateway 重复解析字段；`npm run test:rust:unit -- -p app-server image_tools` 最新 6 测试通过，sidecar 重新构建成功。
- GUI smoke：`npm run verify:gui-smoke` 首轮构建受输入指纹变化阻断，冻结输入后 Renderer、Host、原生资源与 sidecar 构建通过；该轮 smoke 的 `report_frontend_debug_log` 发生一次调用错误（23/24），保留失败证据。直接 `node scripts/electron/smoke.mjs` 复用同一新鲜构建复跑，24/24 通过，invoke/trace/console/page/crash/legacy/mock 错误均为零，未过滤错误或移除断言。该偶发错误未复现，不声明已定位根因。
- `npm run smoke:agent-runtime-current`：三个真实 Electron 入口依次通过，Code Mode 21 项、会话恢复 21 项、运行中 Turn 恢复并停止 25 项断言全通过。运行中恢复为 external 受控后端，证明相同 Thread/Turn、重载恢复和取消，不等同 live provider；Code Mode 走真实 runtime 与独立 code-mode-host，Provider 为本地受控 HTTP 服务。执行时显式传入已构建的 `APP_SERVER_BIN` 与宿主 `CARGO_HOME`，避免隔离 HOME 下 Cargo metadata 发起无用网络探测。
- 共享后端最新 Node 测试：4/4 通过，覆盖 canonical file tools、并行 Turn 定向取消及 silent 无输出取消。
- 共用 Electron launcher 的首次权限引导接线：3 文件 / 245 测试通过（包含重复 catalog），从真实对话框选择当前语言的“稍后设置”，不授予 OS 权限、不绕过产品状态。
- 静态脚本 import 与现役共享 exports 检查：无缺失；`git diff --check` 通过。候选完整性、远端 main/tag：发布确认前复核。
- 不整体运行 `verify:local`：其当前计划会选择裸 lint、全量前端与重复构建；按 release skill 使用完整 typecheck、contracts、定向前端/Rust 和真实 Electron 门禁。未运行真实 Windows 安装包、Windows UIA、macOS 全部 TCC 授权/撤销及 live Provider/Office/Chrome 平台矩阵，不能以本地 smoke 代替这些证据。
- 日志目录：`.lime/releases/v1.172.0/`；初始候选清单已保存在该目录，清理闭包为 `artifacts/release-v1.172.0/chat-fixture-cleanup.json`，可审阅清单为 `artifacts/release-v1.172.0/candidate-manifest.json`（发布确认前刷新 hash）。

## 发布与退出条件

发布前审计：完整候选共 596 个 Git 文件变更、620 个显式增删路径（6 个 metadata、611 个产品/测试/文档/治理候选、3 个发布记录/证据），无排除项、无临时工具入库、无未暂存或未纳入的未跟踪文件。初始 323 个路径中的 `claw-chat-current-fixture-backend-env.mjs` 与 `mcp-result-acceptance.test.mjs` 原本未跟踪，已按清理授权删除，因此不形成 Git diff，另在 manifest 的 `deletedInitialUntrackedPaths` 记录。所有非自身清单文件的工作树与暂存 SHA256 一致。最终完整 typecheck、contracts 均退出 0；legacy report 零边界违规。远端 main 仍为起点 SHA，目标标签本地、远端均不存在。

清理与发布准备完成度 100%。用户已明确回复“确认”，授权对该完整候选创建发布提交、`v1.172.0` 标签并推送 main 与标签。本记录冻结于 Git 发布操作前；实际提交、远端引用与安装包状态分别以 Git 和 GitHub Release/Actions 为准，安装包发布完成度不在本地准备阶段计为通过。

完成 metadata 与门禁后，列出完整候选和验证结果，按用户危险操作约定请求一次 commit/tag/push 确认。确认后连续完成 release commit、新标签、main 与标签显式推送及远端 SHA 复核。

递交与打标签推送以本地和远端 main/tag 同一 SHA 为完成条件；安装包发布以 GitHub Release 与实际 workflow/asset 状态为准，流水线触发不等于产物发布完成。
