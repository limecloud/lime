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
- 首条自包含 smoke 已落地：`npm run smoke:workspace-ready` 可自动校验 DevBridge 就绪、默认 workspace 获取、目录修复与路径回查
- 测试文档事实源已经收口：`docs/test/README.md`、`docs/test/e2e-tests.md`、`docs/aiprompts/playwright-e2e.md` 已按“索引 / 总览 / 详细事实源”分层

## 3. 当前仍未解决的问题优先级

| 优先级 | 事项                      | 为什么重要                                     | 当前证据                                                                                                                                                                                                  | 完成定义                                                                                                   |
| ------ | ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P0     | 自包含 smoke 仍然不足     | 单测很多，但主链路仍缺少无需人工准备的自动回归 | 目前仅有 `smoke:workspace-ready` 属于自包含 smoke；`smoke:social-workbench` 仍依赖已有 session，`bridge:e2e` 更像排障脚本                                                                                 | 至少补齐 3 条无需人工准备的 smoke；当前已完成 1 条，仍需补 server / terminal / browser runtime 等 2 条以上 |
| P1     | Agent eval 仍未完全工程化 | 价值高，但建立在前面基础门禁稳定之后           | 已补 `docs/test/harness-evals.md`、`harness-evals.manifest.json`、`scripts/harness-eval-runner.mjs`、`scripts/harness-eval-trend-report.mjs` 与 nightly 摘要 / trend 骨架，但真实执行与更多高价值样本仍缺 | 形成稳定任务集、可增长 replay 样本、grader、nightly 输出与趋势指标                                         |

## 4. 建议执行顺序

### 第 1 步：把 smoke 升级为自包含场景

先只挑 3 条最高价值场景，不要贪多：

1. 应用启动 + workspace 可创建 / 打开
2. server 基础链路可自动打通
3. terminal 或 browser runtime 至少有一条基础链路可自动打通

验收标准是“本地和 CI 都能重复执行”，而不是“方便人工排障”。

### 第 2 步：把 Agent eval 工程化

这一步放在最后，不是因为不重要，而是它依赖前面的基础设施稳定：

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

## 5. 当前建议

如果只看投入产出比，当前最值得先做的两刀是：

1. 把 smoke 升级为自包含场景
2. 把 Agent eval 工程化

这两步做完之后，再继续往 nightly 与趋势报表收口，收益会更高。
