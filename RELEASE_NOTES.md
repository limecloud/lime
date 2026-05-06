## Lime v1.29.0

发布日期：`2026-05-06`

### 发布概览

- 本次发布目标 tag 为 `v1.29.0`，重点推进 CREAOAI workspace skill runtime binding、显式 runtime enable、AI 图层化设计导出，以及 Memory / Skills / Scene Apps / Knowledge 工作台的主路径收口。
- 版本事实源已同步到 `1.29.0`：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`、`@limecloud/lime-cli` npm wrapper 与 release updater 测试样例保持一致。
- 该版本继续坚持 current-first：workspace skill binding、Query Loop metadata、runtime enable、Evidence Pack、GUI review surface 与 mock/contract 都回到同一条运行时事实源，不新增平行执行入口。

### 用户可见更新

#### 1. Workspace Skill Runtime Binding

- 新增 workspace skill binding readiness 投影，Skills 工作台可区分已注册、可手动启用、缺少输入或仍需治理的 skill。
- Chat request metadata 增加 workspace skill bindings 规划上下文，让 Query Loop 能看到当前 workspace 内可用能力，但不会自动打开执行权限。
- Runtime enable 只在当前 session scope 内显式启用 ready binding，并把 SkillTool 裁剪到 allowlist，避免 marketplace、scheduler 或旧平行命令绕过授权边界。
- Skills / Capability Draft UI 补充 automation draft、agent envelope draft 与 registered skill 状态回归，减少“已注册”和“可执行”之间的语义混淆。

#### 2. AI 图层化设计与导出

- 图层化设计主链继续完善文档、artifact、flat image、extraction、zip export 与 image task 写回能力。
- Design Canvas 与 Layered Design Project API 增加稳定回归，覆盖图层文档编辑、导出、扁平化与图片任务关联。
- 新增 layered design Tauri command 入口，前端、mock 与项目 artifact 消费方继续围绕 `LayeredDesignDocument` 这个事实源收敛。

#### 3. Agent、Memory 与工作区体验

- Agent Chat、MessageList、Harness 状态、runtime review decision、thread grouping 与 workspace scene runtime 继续补稳定回归。
- Memory 页面完成大幅整理，任务建议、inspiration projection 与工作区入口更接近长期使用场景。
- Scene Apps、Knowledge、Settings、Onboarding 与 Sidebar 的主路径继续补齐状态、导航和测试断言，降低 GUI 启动与页面切换漂移。
- 增加 startup layout / diagnostics 工具与 smoke 脚本，用于定位启动布局和页面可见性问题。

### 开发者与治理更新

#### 1. 命令边界与 contract

- 新增并同步 `agent_runtime_list_workspace_skill_bindings` 相关命令与 runtime schema：前端 API、generated manifest、Rust 注册、DevBridge dispatcher、治理目录册、`mockPriorityCommands` 与默认 mock 保持一致。
- 新增 runtime skill binding service 与 prompt projection 测试，明确 readiness metadata 只读、runtime enable 显式、SkillTool gate allowlist 三个边界。
- `npm run test:contracts` 继续覆盖 agent runtime command manifest、command catalog、harness contract、modality contract 与 cleanup report，防止命令面漂移。

#### 2. 路线图与执行计划

- 新增 CREAOAI P3C runtime binding、P3D query loop metadata、P3E tool runtime authorization、P4 managed agent envelope 与 completion audit 执行计划。
- CreoAI research / roadmap 文档更新编码代理层、工具编排、原型与架构拆解，保持 repo 内 artifact 作为唯一记录系统。
- Warp 多模态 runtime contract 文档继续同步 runtime profile、permission state 与 evidence/replay 阻断事实。

#### 3. Release 管线

- 修复 release 构建中的 Vite manual chunk 旧入口引用，`useAgentChatUnified` 现在回到现役 hooks barrel 入口，并移除已不存在的 `immer` 显式 chunk 入口。
- 根包显式声明 GUI smoke 所需的 `playwright` 依赖，并同步 npm / pnpm 锁文件，避免 CI 干净安装后知识库 GUI 冒烟脚本缺包。

### 已知说明

- Workspace skill binding readiness 仍不等于自动注入 tool surface；只有显式 runtime enable 且通过 allowlist 的 binding 才能进入当前 session 的 SkillTool gate。
- AI 图层化设计仍以本地图层文档、导出和 artifact 写回为主，不声明完整 PSD / mask / inpaint provider adapter 能力。

### 校验状态

- 本次版本准备已完成：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `CARGO_TARGET_DIR="/tmp/lime-v1.29.0-clippy-target" cargo clippy --manifest-path "src-tauri/Cargo.toml"`
  - `npm run lint`
  - `npm test`
- 结果说明：
  - 版本一致性检查通过：`1.29.0`。
  - Rust fmt 通过。
  - Rust clippy 通过。
  - 前端 lint 通过。
  - 前端 Vitest smart suite 49 批通过。
  - 标准 Rust `cargo test --manifest-path "src-tauri/Cargo.toml"` 未完成：当前磁盘空间不足，构建 `src-tauri/target/debug/deps/liblime_lib.a` 时报 `No space left on device (os error 28)`；该结果不是测试断言失败。

---

**完整变更**: `v1.28.0` -> `v1.29.0`
