## Lime v1.24.0

发布日期：`2026-04-30`

### 发布概览

- 本次发布目标 tag 为 `v1.24.0`。
- 本次发布聚焦多模态运行合同底座、Browser / PDF / Voice / Research / Text Transform 合同闭环、任务中心与旧会话打开体验、工作台首页技能入口，以及版本发布配置同步。
- 本轮待递交内容覆盖 Rust 后端、Tauri 配置、前端 Agent Workspace / Home / Settings / Provider / DevBridge、治理合同 registry、测试覆盖、版本锁文件、图片素材与执行计划文档。

### 重点更新

#### 1. 版本号同步到 v1.24.0

- 应用版本已同步为 `1.24.0`：
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与 `packages/lime-cli-npm/README.md` 已同步到 `1.24.0`，保持 CLI wrapper 与桌面 release 版本一致。
- 浏览器模式默认 mock 的 update current version 已同步为 `1.24.0`。
- GitHub release asset staging 测试中的当前发布样例已同步到 `v1.24.0`。

#### 2. 多模态运行合同底座

- 新增并扩展 `ModalityRuntimeContract` 前端 registry 与 Rust 侧合同常量，统一 `image_generation`、`browser_control`、`pdf_extract`、`voice_generation`、`web_research`、`text_transform` 六类底层运行合同。
- `scripts/check-modality-runtime-contracts.mjs` 与 `npm run governance:modality-contracts` 继续作为合同 registry 的机器校验入口，保护 contract key、entry binding、executor binding 与 metadata path 不漂移。
- 图片生成任务、媒体任务 API、DevBridge mock 与治理目录册同步合同字段，避免入口层直接拥有底层 task / model / artifact / evidence 事实源。
- `docs/roadmap/warp/contract-schema.md` 与 `docs/exec-plans/multimodal-runtime-contract-plan.md` 更新合同 schema、执行阶段与 current / compat / deprecated / dead 分类。

#### 3. Browser / PDF / Voice / Research / Text Transform 合同闭环

- `@浏览器` / Browser Assist 发送链路注入 `browser_control` 合同快照，Rust 侧保留 Browser Assist runtime hint，并把 browser tool timeline metadata 纳入 evidence / replay。
- `@读PDF` 入口收敛到 `pdf_extract` 合同，前端 metadata、Rust prompt 准备、Skill(pdf_read) timeline、evidence pack 与 replay 检查保持同一份合同事实源。
- `@配音` 服务型入口收敛到 `voice_generation` 合同，ServiceSkill / voice runtime 的 request metadata、timeline args 与 replay grader 统一识别音频运行证据。
- `@搜索`、`@深搜`、`@站点搜索`、`@研报`、`@竞品` 统一归入 `web_research` 合同，并补齐 evidence `snapshotIndex`，让联网研究可以按 contract/source/routing/tool trace 检索。
- `@读文件`、`@总结`、`@翻译`、`@分析`、`@发布合规`、`@Logo拆解` 统一归入 `text_transform` 合同，禁止回退为前端直出、ToolSearch / WebSearch 或普通聊天摘要。

#### 4. Evidence Pack / Replay / Task Runtime

- `runtime_evidence_pack_service` 与 `runtime_replay_case_service` 扩展多模态合同快照、索引、expected checks 与 grader 规则，回放样本能判断是否真实命中对应 executor trace。
- 媒体 runtime 与 `media_task_cmd` 补齐合同字段归一化、能力缺口提示、artifact payload 与任务预览字段。
- 前端 `agentRuntime` media/session 类型、`mediaTasks` API、ImageTask viewer 与工作台预览 runtime 同步消费合同字段，减少 viewer 自行猜测 artifact 类型。
- `modalityRuntimeContracts` 的前端/Rust 双侧测试覆盖合同解析、fallback 与 mock 分发，保持浏览器模式不是假绿。

#### 5. 工作台首页、任务中心与旧会话体验

- Agent Chat 新增 Home Start Surface、技能卡片画廊、更多技能抽屉与场景技能管理弹窗，并提交对应 home cover 素材。
- EmptyState / Workspace / AppSidebar 接入新的首页入口、补充快捷入口与任务中心事件桥，一级“新建任务”与会话侧栏切换保持可取消草稿语义。
- 旧会话打开性能继续收口：首屏优先最近消息、timeline 延后物化、历史消息与流式 delta overlap 合并，降低旧会话切换卡顿与布局跳动。
- MessageList / Team Workspace / Workspace Send Actions 增补回归，覆盖新建草稿、旧会话切换、图片任务预览和合同 metadata 发送。

#### 6. Provider / 设置页 / 云端能力边界

- Provider 与 API Key 设置页进一步收口模型能力、Prompt Cache、云端套餐 / 权益 / API Key 展示口径，避免本地设置页重新承载用户中心商业工作台。
- OEM cloud access、LimeHub provider sync、model registry service 与 provider list 工具函数补齐测试，保护登录态、权益摘要、模型支持和 provider capability 展示。
- `withI18nPatch`、Settings Provider 页面与相关 hooks 做格式化和回归更新，保持当前设置入口与 mock / Rust 模型事实源一致。

### 待递交范围确认

- 版本与发布：版本文件、lockfile、Tauri 配置、CLI wrapper、release updater 测试样例与 release notes。
- Rust 主链：多模态合同、媒体任务、Browser Assist、PDF / Research / Summary / Translation / Analysis / ServiceSkill launch、evidence pack、replay case、model registry。
- 前端主链：Agent Chat Workspace、Home Start Surface、MessageList、ImageTask Viewer、任务中心事件桥、Settings Provider、API Key Provider、DevBridge、tauri mock。
- 治理与文档：`modalityRuntimeContracts` registry / 校验脚本、Warp contract schema、执行计划与旧会话性能计划。
- 素材与测试：home cover 素材、新增/更新的 Vitest、Rust 回归与治理合同测试。

### 校验状态

- 已执行：
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `npm run format`
  - `npm run verify:app-version`
  - `cargo test --manifest-path "src-tauri/Cargo.toml" --target-dir "src-tauri/target/codex-release-v124"`
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml" --target-dir "src-tauri/target/codex-release-v124" --all-targets --all-features`
  - `npm run lint`
  - `npm test`
  - `npm run test:contracts`
  - `npm run verify:gui-smoke`
  - `git diff --check`
- 结果：上述校验均已通过；`cargo test` 结果为 `1103 passed; 0 failed; 0 ignored`，另有 2 个真实联网测试按预期 ignored。
- 备注：`cargo clippy` 仍保留既有 warning（`manual_repeat_n`、`too_many_arguments`、`needless_lifetimes`），本轮未扩大 warning 面。
- GUI 主路径：`npm run verify:gui-smoke` 已通过，覆盖 DevBridge、默认 workspace、browser runtime、site adapter catalog、服务技能入口与 runtime tool surface 页面烟测。

---

**完整变更**: `v1.23.0` -> `v1.24.0`
