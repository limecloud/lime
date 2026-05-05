## Lime v1.28.0

发布日期：`2026-05-05`

### 发布概览

- 本次发布目标 tag 为 `v1.28.0`，重点把 Capability Draft / Skill Forge 从草案创建推进到验证、注册闭环，同时继续推进 AI 图层化设计、Knowledge 主链和 Harness 证据治理。
- 版本事实源已同步到 `1.28.0`：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json` 与 release updater 测试样例保持一致。
- 该版本继续坚持“一个事实源”：能力草案、知识包、运行时权限确认、Evidence Pack、Artifact/Canvas 与 GUI review surface 都优先回到 current 主链，不新增平行执行入口。

### 用户可见更新

#### 1. Capability Draft / Skill Forge 闭环

- 新增 workspace-local Capability Draft 创建、列表、详情、验证与注册链路，草案事实源落在 `.lime/capability-drafts/`。
- Skills 工作台新增草案 review surface，可展示目标、权限摘要、文件清单、验证报告和注册结果。
- Verification gate 覆盖结构、contract、权限声明、危险 token、fixture 存在性等静态检查；失败会写入可追踪报告。
- Registration gate 仅允许 `verified_pending_registration` 草案注册到当前 workspace 的 `.agents/skills/<skill_directory>/`，并记录来源与验证报告。
- 已注册草案仍不会自动运行、不会进入默认 tool surface、不会接 automation，避免把“文件注册”误当成“已授权执行”。

#### 2. AI 图层化设计主链

- 新增 `LayeredDesignDocument` 最小协议，把图片生成从“单张扁平 PNG”推进到可编辑图层工程。
- 新增 `DesignCanvas` 最小可见 UI 与 `canvas:design` Artifact 接入口，图层文档可进入 Workspace Canvas。
- 新增本地 Layer Planner seed、Artifact bridge、图片层生成请求 seam 和 image task artifact 写回路径。
- 支持从 edit history 刷新图片任务结果，并把成功产物写回目标图层。
- 增加主流图片模型族能力约束与透明图层策略，作为后续 provider adapter 的 contract 基础。

#### 3. Agent UI、Harness 与证据治理

- Agent stream、session history、runtime context、request log、tool event、completion、error 和 inactivity 等控制器继续拆分成可测边界。
- Harness 状态面板、Review Decision 与 Evidence Pack 继续收敛权限确认状态，区分 `not_requested`、`requested`、`resolved` 与 `denied`。
- Evidence Pack / Replay / Review 对 denied 或未解决权限确认保持阻断语义，避免把未经真实确认的运行标记为成功交付。
- Agent task index、timeline、artifact action 与 message projection 回归继续补强，降低长会话恢复和工作台投影漂移。

#### 4. Knowledge 与工作区入口

- Knowledge 页面、导入入口、知识包选择和 workspace knowledge runtime 继续补稳定回归。
- Knowledge GUI smoke 主链保持覆盖知识库入口、Agent 知识上下文跳转和导入视图组织入口。
- 知识包、Skill、Memory、Inspiration 与 capability draft 的边界继续在路线图和执行计划中沉淀为 repo 内 artifact。

### 开发者与治理更新

#### 1. 命令边界与 mock 同步

- 新增并同步 `capability_draft_create/list/get/verify/register` 命令族：前端 API、Rust command、DevBridge dispatcher、治理目录册、`mockPriorityCommands` 与默认 mock 保持一致。
- `npm run test:contracts` 的命令契约仍覆盖新增命令族，避免前端、Rust 注册和浏览器 mock 漂移。
- Release updater manifest 测试样例已更新到 `v1.28.0` 的 macOS asset 命名。

#### 2. 路线图与执行计划

- 新增 CreoAI / Capability Authoring、Verification、Registration 执行计划，明确“生成能力”和“执行能力”分层。
- 新增 AI 图层化设计路线图与实现计划，固定 `LayeredDesignDocument` 是设计工程事实源。
- 新增 Managed Objective 相关路线图，把跨 turn 目标推进控制层限定为 current runtime 的消费方，而不是新 runtime。
- Warp / 多模态 runtime contract 文档继续补齐 task index、entry binding 与执行 profile 锚点。

### 已知说明

- Capability Draft 当前只交付到 workspace-local 文件注册，不代表已经进入运行时 tool surface；P3B / P4 仍需补 catalog discovery、runtime binding、授权执行和 evidence 审计。
- AI 图层化设计当前以协议、Canvas 入口和 image task artifact 写回为主，不直接新增 provider adapter、不声明完整 PSD / mask / inpaint 能力。
- 标准 `cargo test --manifest-path "src-tauri/Cargo.toml"` 仍依赖 `local-sensevoice` 下的 `sherpa-onnx` 静态库归档；本轮冷环境中该归档下载 / 复用不稳定，发布前需在已准备 archive 的稳定 Rust target 中补跑一次完整 Rust 测试。

### 校验状态

- 本次版本准备已完成：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `SHERPA_ONNX_ARCHIVE_DIR="<local-archive-dir>" CARGO_TARGET_DIR="/tmp/lime-release-verify-target" cargo clippy --manifest-path "src-tauri/Cargo.toml" --all-targets --all-features`
  - `npm run lint`
  - `npm test`
  - `CARGO_HOME="/tmp/lime-cargo-home" CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-release-verify-target" cargo test --manifest-path "src-tauri/Cargo.toml" --no-default-features services::runtime_evidence_pack_service::tests::should_export_runtime_evidence_pack_to_workspace --lib`
- 结果说明：
  - 版本一致性检查通过：`1.28.0`。
  - Rust fmt 通过。
  - Rust clippy 全目标全特性通过；首次冷跑曾因 `sherpa-onnx-sys` 下载 GitHub release 归档 TLS 中断失败，改用本地 archive 后通过。
  - 前端 lint 通过；本轮顺手移除了 Review Decision 弹窗中未使用的 `permissionConfirmationDenied` 变量。
  - 前端 Vitest smart suite 49 批通过。
  - 标准 Rust `cargo test` 未完成：一次冷 target 触发 incremental dep-graph 临时文件移动错误；后续重跑受 `sherpa-onnx` archive 缺失 / 下载过慢影响。已修复并定向验证 Evidence Pack 权限确认 fixture，发布前仍需补完整 `cargo test --manifest-path "src-tauri/Cargo.toml"`。

---

**完整变更**: `v1.27.0` -> `v1.28.0`
