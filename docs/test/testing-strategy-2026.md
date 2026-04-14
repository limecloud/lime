# Lime 测试体系待办（2026）

> 本文件只保留当前仍未解决的测试问题；已落地能力已从优先级清单移除。

## 1. 事实源与分类

### current

以下路径已经是当前测试体系的事实源，不再作为“待建设能力”重复列入：

- `docs/test/README.md`：当前测试入口与命令索引
- `docs/test/e2e-tests.md`：当前浏览器续测与 E2E 总览入口
- `docs/aiprompts/playwright-e2e.md`：当前浏览器续测 / Playwright MCP 事实源
- `package.json`：当前统一测试命令入口
- `scripts/local-ci.mjs`：当前本地智能校验入口
- `scripts/report-legacy-surfaces.mjs`：当前 legacy / compat 回流护栏

### compat

- 当前无仍需保留的 E2E compat 文档

### deprecated

- `tauri-driver` 作为仓库推荐 E2E 方案的说法
- `npm run test:e2e` 作为现行测试入口的说法

### dead

- `npm run test:e2e` 作为现行仓库命令已不存在，不应继续作为测试标准引用

## 2. 已从待办移除的事项

以下能力已具备基础，不再保留在优先级清单中：

- 前端 `Vitest` 覆盖已经足够广，`src/components`、`src/hooks`、`src/lib/api`、`src/features/browser-runtime` 等已有大量测试
- Rust 单测 / 集成测试基础已经存在，`src-tauri/src` 与多个 workspace crate 都有可运行测试
- 本地统一校验入口已经存在：`test:frontend`、`test:bridge`、`test:rust`、`verify:local`、`verify:local:full`
- 桥接基础测试已经存在：`src/lib/dev-bridge/safeInvoke.test.ts`、`src/lib/tauri-mock/core.test.ts`
- legacy 治理护栏已经存在：`npm run governance:legacy-report`
- 旧权限表面治理护栏已经补齐：`src/lib/governance/legacyToolPermissionGuard.test.ts` + `npm run governance:legacy-report`
- 跨层命令契约检查基础版已经落地：`npm run test:contracts` 已进入 `scripts/local-ci.mjs`
- 命令契约延期例外已经收口：`agent_terminal_command_response`、`agent_term_scrollback_response` 已退出 `runtimeGatewayCommands`，改为 `dead-candidate` 治理监控
- 自包含 smoke 最小基线已落地：`npm run smoke:workspace-ready`、`npm run smoke:browser-runtime`、`npm run smoke:site-adapters` 都无需人工准备；另外，`npm run smoke:agent-runtime-tool-surface` 已补齐“runtime inventory -> 主界面提示/runtime strip”这条应用层主线 smoke，`npm run verify:gui-smoke` 现已默认串联这四条 current smoke
- 测试文档事实源已经收口：`docs/test/README.md`、`docs/test/e2e-tests.md`、`docs/aiprompts/playwright-e2e.md` 已按“索引 / 总览 / 详细事实源”分层

## 3. 当前仍未解决的问题优先级

| 优先级 | 事项                                        | 为什么重要                                          | 当前证据                                                                                                                                                                                                  | 完成定义                                                                                               |
| ------ | ------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| P1     | Agent eval 仍未完全工程化                   | 价值高，且当前最缺的是把证据沉淀成长期回归资产      | 已补 `docs/test/harness-evals.md`、`harness-evals.manifest.json`、`scripts/harness-eval-runner.mjs`、`scripts/harness-eval-trend-report.mjs` 与 nightly 摘要 / trend 骨架，但真实执行与更多高价值样本仍缺 | 形成稳定任务集、可增长 replay 样本、grader、nightly 输出与趋势指标                                     |
| P2     | terminal / server 自包含 smoke 仍可继续扩面 | 最小 GUI smoke 基线已具备，但更细分主链仍缺专项守卫 | 当前 `workspace-ready / browser-runtime / site-adapters` 已覆盖 GUI 最小主链；`smoke:social-workbench` 仍依赖已有 session，terminal / server 还没有各自独立的自包含 smoke 入口                            | 如后续需要继续扩面，应补 terminal 或 server 的独立 smoke，而不是继续把现有 3 条 current smoke 算成缺口 |

## 4. 建议执行顺序

### 第 1 步：把 Agent eval 工程化

现在可以把它提到第一优先级，因为前面的最小 GUI smoke 基线已经具备：

- 有稳定门禁
- 有稳定契约检查
- 有可重复 smoke

当前已先补：

- 固定 manifest 与 replay fixture
- runner 摘要出口
- nightly artifact 与 trend 骨架

后续再继续补：

- transcript 存档
- 更多真实高价值 replay 样本
- 更长窗口的趋势报表

### 第 2 步：按需继续扩自包含 smoke 覆盖面

如果后续还要补 smoke，不要重复把 `workspace-ready / browser-runtime / site-adapters` 记成“未完成”。

下一轮更合理的扩面方向是：

1. terminal 基础链路
2. server 基础链路
3. 仍依赖人工前置状态的专项 smoke 去人工化

## 5. 当前建议

如果只看投入产出比，当前最值得先做的两刀是：

1. 把 Agent eval 工程化
2. 如需继续补 smoke，优先做 terminal / server 专项自包含场景

这两步做完之后，再继续往 nightly、趋势报表与 replay promotion 收口，收益会更高。
