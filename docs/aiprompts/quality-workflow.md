# Lime 工程质量工作流

## 这份文档回答什么

本文件定义 Lime 仓库的工程质量入口，主要回答四个问题：

- 不同改动，提交前默认该跑什么
- 为什么 Lime 作为 GUI 桌面产品，不能只看 `lint` / `typecheck` / 单测
- `verify:local`、`verify:gui-smoke`、`test:contracts`、Playwright E2E 分别覆盖什么风险
- `.github/workflows/quality.yml` 与本地校验如何保持一条主线

它是 **工程入口文档**，不是某个模块的实现设计文档。

## 什么时候先读

遇到以下任一情况时，先读本文件：

- 不确定本次改动最少该跑哪些校验
- 修改了 GUI 壳、DevBridge、Workspace、Tauri 命令、前端主路径
- 需要判断跑最小 smoke 还是交互型 E2E
- 需要理解 `quality.yml` 为什么触发某些 CI 任务

## 交付定义

对 Lime 来说，“代码通过检查” 不等于 “产品可以交付”。

一次可交付的改动，至少要满足：

1. **静态与定向校验通过** - 对应范围的 lint、类型检查、单测、Rust 定向测试通过
2. **边界变更已同步** - 命令、桥接、配置、版本等结构性改动完成成组更新
3. **GUI 主路径可运行** - 涉及 GUI 壳、Bridge、Workspace、主页面路径时，最小冒烟通过
4. **用户可见回归已补齐** - 用户可见 UI 改动有稳定断言或既有 snapshot 回归
5. **文档与锁文件不掉队** - 相关文档、schema、锁文件与实际实现保持一致

## 执行硬规则

### 1. 不要继续扩展 compat / deprecated 路径

- 新 API、新 Tauri 命令、新前端入口默认落在当前 `current` 主路径
- 不要继续给 legacy / compat 网关长新表面
- 如果发现能力已经存在多条路径，先读 `docs/aiprompts/governance.md`

### 2. 协议改动必须同步四侧

涉及命令或桥接协议时，至少检查：

- 前端 `safeInvoke(...)` / `invoke(...)` 的实际调用
- Rust `tauri::generate_handler!` 的实际注册
- `src/lib/governance/agentCommandCatalog.json` 的治理口径
- `mockPriorityCommands` 与 `defaultMocks` 的同步状态

只改其中一侧，不算完成。

### 3. 用户可见 UI 改动必须补稳定回归

- 优先补现有 `*.test.tsx` 的关键文案、状态与交互断言
- 如果目标区域已有 snapshot / 结构化快照机制，沿用现有机制
- 不要因为“只是 UI”就跳过回归

### 4. 配置与依赖改动必须成组提交

- 改配置结构时，要同步更新 schema、校验器、消费者与文档
- 改版本结构时，要执行 `npm run verify:app-version`
- 改依赖时，要同步提交对应锁文件，如 `package-lock.json`、`src-tauri/Cargo.lock`
- 本仓库没有 Bazel，不适用 Bazel lockfile 规则

### 5. Rust 校验先小后大

- 默认先跑受影响 crate、模块或定向测试
- 再根据边界扩散决定是否执行全量 `cargo test`
- 目标是尽快暴露问题，而不是一上来把所有测试都跑满

## 质量分层

### Layer 0：快速提醒

入口：

- `.husky/pre-commit`
- `npm run ai-verify`

作用：

- 做提交前的快速卫生检查
- 暴露明显问题与风险

边界：

- **不替代** 编译、测试、契约检查、GUI smoke

### Layer 1：本地统一入口

入口：

```bash
npm run verify:local
npm run verify:local:full
```

作用：

- 根据改动范围自动选择前端、Rust、Bridge、GUI smoke 等检查
- 让开发者在发起 PR 前有一个统一入口

适用建议：

- 普通功能改动：默认执行 `npm run verify:local`
- 跨前后端、大范围重构、发布前自检：执行 `npm run verify:local:full`

### Layer 2：GUI 最小冒烟

入口：

```bash
npm run verify:gui-smoke
```

作用：

- 启动或复用 `headless Tauri`
- 等待 `DevBridge` 健康检查通过
- 验证默认 workspace 的准备态可用

它解决的是 GUI 产品特有风险：

- 前端壳能不能真正起来
- `DevBridge` 是否就绪
- 默认 workspace / 本地工作目录能力是否可用

这类问题 **单靠** `lint`、`typecheck`、`vitest` 无法覆盖。

### Layer 3：契约与桥接边界

入口：

```bash
npm run test:contracts
npm run test:bridge
npm run bridge:health -- --timeout-ms 120000
```

作用：

- 检查前端命令调用与 Rust 注册表是否一致
- 检查浏览器桥接 / mock 优先路径是否同步
- 检查 `DevBridge` 是否可用

高频场景：

- 修改 `safeInvoke` / `invoke`
- 修改 `agent_runtime_update_session` 或会话 provider/model 恢复语义
- 修改 `src/lib/dev-bridge/`
- 修改 `src/lib/tauri-mock/`
- 修改 `src-tauri/src/app/runner.rs`
- 修改 `src-tauri/src/dev_bridge/`

### Layer 4：交互型 E2E

入口：

- `docs/aiprompts/playwright-e2e.md`

作用：

- 用 Playwright MCP 做真实页面交互验证
- 检查控制台错误、主导航、关键业务工作流

注意：

- 不要把所有页面默认都推进到重型 E2E
- 先跑最小 smoke，再决定是否需要完整交互验证

## 改动类型与最低门槛

| 改动类型                            | 至少运行                                           | 额外要求                                    |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| 普通前端改动                        | `npm run verify:local`                             | 如有用户可见变化，补稳定回归                |
| Tauri 命令 / Bridge / mock 改动     | `npm run verify:local`、`npm run test:contracts`   | 必要时补 `npm run governance:legacy-report` |
| GUI 壳 / Workspace / 页面主路径改动 | `npm run verify:local`、`npm run verify:gui-smoke` | 必须补对应 UI 回归                          |
| 配置结构改动                        | `npm run verify:local`                             | 同步 schema、消费者、文档                   |
| 版本相关改动                        | `npm run verify:app-version`                       | 与发布配置一起核对                          |
| Rust 模块改动                       | 受影响 crate / 模块定向测试                        | 再决定是否跑全量 `cargo test`               |
| 真实页面交互验证                    | 先跑 `npm run verify:gui-smoke`                    | 再进入 `playwright-e2e.md`                  |

补充说明：

- 如果这次改动把 `ServiceSkill -> automation_job -> agent_turn` 接到 Artifact 主线，除了常规 `verify:local` / `test:contracts` 之外，还应至少补一条稳定回归，证明 `content_id + request_metadata.artifact` 没在表单编辑或执行链路里丢失。

## CI 事实源

主工作流：

- `.github/workflows/quality.yml`

关键事实源：

- `scripts/quality-task-planner.mjs`
- `scripts/quality-task-selector.mjs`
- `scripts/local-ci.mjs`

要求：

- 本地 `verify:local` 与 CI 使用同一套 changed-path 分类逻辑
- 最终由 `results` job 聚合为统一质量信号
- 对 GUI 产品来说，PR 门禁不能只覆盖静态检查，还必须覆盖 `Bridge & Contracts` 与 `GUI Smoke`

## PR 前最小清单

发起 PR 前，至少自问这五件事：

1. 这次改动属于普通逻辑、协议边界、GUI 主路径还是治理收口？
2. 我是不是已经走过对应的最低校验？
3. 如果改了命令、配置或版本，相关文档与锁文件是否同步？
4. 如果改了用户可见 UI，是否补了稳定回归？
5. 如果改了 GUI 壳、Bridge、Workspace，是否真的跑过最小 smoke？

## 常用命令

```bash
# 本地统一校验
npm run verify:local
npm run verify:local:full

# GUI 最小冒烟
npm run verify:gui-smoke

# 前端 / 桥接 / 契约
npm test
npm run test:bridge
npm run test:contracts
npm run bridge:health -- --timeout-ms 120000

# GUI / headless 调试
npm run tauri:dev:headless
```

## 相关文档

- `docs/aiprompts/commands.md`
- `docs/aiprompts/governance.md`
- `docs/aiprompts/playwright-e2e.md`

## 决策原则

只有一句话：

**Lime 是 GUI 桌面产品，工程质量不能只验证“代码能编译”，还要验证“应用壳、桥接、工作区主路径能运行”。**
