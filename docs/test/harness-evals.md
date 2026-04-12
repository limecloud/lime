# Lime Harness Evals

> 面向 Lime `P3-6 Replay 样本沉淀` 的 current 事实源  
> 目标：把 replay 样本、grader 合同、仓库固定任务集与 nightly 摘要，收口到一条可执行主链。

## 先给结论

Lime 当前不直接把“真实模型重放平台”一次做完，而是先固定四件事：

1. **固定任务集入口**  
   由 [harness-evals.manifest.json](harness-evals.manifest.json) 持有机可读任务清单。

2. **固定样本形状**  
   所有 replay case 统一要求最小四件套：
   - `input.json`
   - `expected.json`
   - `grader.md`
   - `evidence-links.json`
     其中 `input.json` 继续承载 `classification.suiteTags` 与 `classification.failureModes`。
     如果样本已经完成人工审核，还可以额外挂载可选的 `review-decision.json` / `review-decision.md`，但它不是 replay case 的必填件。

3. **固定摘要出口**  
   由 `scripts/harness-eval-runner.mjs` 统一产出 JSON / Markdown 摘要，后续 nightly 与趋势报表都从这里接。

4. **固定趋势入口**  
   由 `scripts/harness-eval-trend-report.mjs` 把一个或多个 summary JSON 聚合成 trend 报告。

这一步对应 Harness 路线图里的 `P3-2 Eval runner`，不是终点，但它把“评估理念”升级成了仓库内可执行入口。

## 为什么这一步要先做

如果没有固定 manifest 和 runner，Lime 当前的 replay 样本会停留在“可以导出”，却还不能稳定回答：

- 当前有哪些回放样本可以复用
- 哪些样本结构不完整
- grader 需要哪些输入字段
- nightly 应该上传什么摘要

先把这层收口，后面的真实模型评估、trend 报表、熵管理和清理才有统一入口。

## 三层来源挂载

| 层次         | 作用                                                                  | 当前落点                                                        |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `codex-rs`   | 提供 replay / grader / evidence-first 的形状参照                      | manifest 中的 replay case 四件套与评分原则                      |
| `aster-rust` | 提供 thread / turn / runtime / telemetry 的事实边界                   | `input.json` 中的 session / thread / turn / runtimeContext 结构 |
| `lime`       | 持有产品层 handoff bundle、evidence pack、workspace `.lime/` 样本目录 | runner、fixture、nightly 摘要与工作区发现逻辑                   |

一句话：

**Codex 决定评估形状，Aster 决定运行时事实边界，Lime 负责把 replay case、grader 和 nightly 摘要落到 current 主链。**

## 当前任务集

当前 manifest 默认分三条 suite：

1. **仓库固定 Replay 样本**
   - 用于 CI / nightly 的稳定入口
   - 当前固定两条 fixture：
     - `fixture-minimal-pending-request`
     - `fixture-minimal-observability-gap`
   - 角色分工必须稳定：
     - `fixture-minimal-pending-request` 是 `current` 样本，要求 observability fully exported，不能继续挂 `known_gap`
     - `fixture-minimal-observability-gap` 是 `degraded` 样本，专门承载 `known_gap` 语义，避免把证据缺口混进 current 样本
   - 目的不是替代真实会话，而是先验证 grader 合同、字段预算和摘要出口不会漂移

2. **仓库沉淀 Replay 样本**
   - 用于把高价值真实失败从工作区提升为仓库 current 资产
   - 默认进入 `repo-promoted-replays` suite
   - 由 `scripts/harness-replay-promote.mjs` 负责：
     - 复制最小四件套
     - 把绝对工作区路径脱敏为稳定占位路径
     - 回写 manifest case
   - 目的不是把所有会话都进仓，而是把“值得长期回归”的失败收进固定任务集

3. **工作区 Replay 自动发现**
   - 扫描 `.lime/harness/sessions/*/replay`
   - 自动把真实导出的 replay case 纳入统一摘要
   - 默认允许零样本，避免没有本地会话时误报失败

这是一种“固定入口、允许样本增长”的设计：

- 入口是固定的
- 样本既可以来自仓库 fixture，也可以来自已沉淀的 current case，还可以来自真实工作区导出
- 不需要为每个新 session 再发明一套单独脚本

## Runner 做什么

`scripts/harness-eval-runner.mjs` 当前负责四件事：

1. 读取 manifest
2. 解析固定 fixture 与工作区自动发现 case
3. 校验 replay case 最小四件套与关键 JSON 字段
4. 输出统一 JSON / Markdown 摘要，并聚合 `suite tag / failure mode / review decision status / risk level` 分布
5. 继续聚合 `observabilitySignals`，把 `requestTelemetry / artifactValidator / browser/gui smoke` 的证据缺口也纳入 trend 与 cleanup
6. 继续聚合 `observabilityVerificationOutcomes`，直接复用 evidence pack 导出的紧凑 outcome，告诉治理层当前更像是 `artifactValidator issues / browser failure / gui smoke failed` 还是已通过

当前它**不直接执行真实模型重放**，而是先把“样本是否可评估、摘要是否可归档”工程化。

如果 case 根目录内存在 `review-decision.json`，或者工作区 replay 同级 `../review/review-decision.json` 已存在，runner 会把它识别为同一条会话的可选人工审核增强信息，并写入：

- `reviewDecisionRecordedCount`
- `reviewDecisionStatuses`
- `reviewRiskLevels`

这符合 Lime 当前阶段的约束：

- 先复用现有 `handoff bundle + evidence pack + replay export`
- 不引入第二套总控平台
- 先把仓库 fixture、repo current 样本和工作区 replay case 变成稳定资产

## 如何把真实 Replay 提升为 current 样本

当某个工作区 replay case 已经足够稳定、足够重要，应该把它从“工作区临时样本”提升到“仓库固定样本”。当前主入口：

```bash
npm run harness:eval:promote -- \
  --session-id "session-123" \
  --slug "pending-request-runtime" \
  --title "Pending request 会话不会被误判为完成"
```

也可以直接指定 replay 目录：

```bash
node scripts/harness-replay-promote.mjs \
  --replay-dir ".lime/harness/sessions/session-123/replay" \
  --slug "pending-request-runtime"
```

这个命令会做五件事：

1. 读取 replay 最小四件套。
2. 把工作区绝对路径脱敏成稳定占位路径，避免把本机路径直接写进仓库。
3. 如果同会话 `review/` 目录里已经有 `review-decision.json/md`，一起复制并脱敏到目标 fixture。
4. 把样本复制到 `docs/test/harness-fixtures/replay/<slug>/`，并把人工审核摘要回写到 manifest case。
5. 把 case 回写到 `repo-promoted-replays` suite，成为 nightly 与 trend 的 current 样本。

默认原则：

- 不是每个 replay 都要 promotion，只提升高价值、可重复、能代表失败模式的样本。
- promotion 之后，样本不再只是“本机能看到”，而是仓库 current 主线的一部分。
- 仓库沉淀样本仍然复用原来的 handoff / evidence 形状，不另造 schema。

如果当前已经在 Lime 工作台里导出了 Replay 样本，也可以直接在 `HarnessStatusPanel` 的 Replay 区块点击：

- `复制回归命令`

它会一次性复制三条现成命令：

1. `npm run harness:eval:promote -- ...`
2. `npm run harness:eval`
3. `npm run harness:eval:trend`

这样做的目的不是把 promotion 内建进 Lime，而是把仓库已有的 current 主命令直接挂到工作台，避免用户还要自己重新拼 `session-id / slug / title`，并且在 promotion 后立刻补上统一 trend 入口。

## Trend Report 做什么

`scripts/harness-eval-trend-report.mjs` 当前负责三件事：

1. 读取一个或多个 `harness eval summary` JSON
2. 生成 baseline / latest 对比、suite 级 delta，以及 `suite tag / failure mode / review decision status / risk level` 聚合变化
3. 输出 JSON / Markdown 趋势报告

如果没有显式提供输入，它会先调用 `harness-eval-runner` 生成当前 summary，再把它当作第一条 trend seed。

这一步的目的不是假装已经有完整历史，而是先把：

- trend 报告字段
- nightly 报告出口
- baseline / latest / suite delta 的最小合同

固定下来。

当前 nightly 会恢复并追加 `artifacts/history/*.json` 历史窗口，用于让 trend 不只停留在单次 seed。

从当前主线开始，nightly 不再手工串 `runner -> trend -> cleanup` 三段命令，而是统一走：

```bash
node scripts/harness-eval-history-record.mjs \
  --history-dir "./artifacts/history" \
  --summary-json "./artifacts/harness-eval-summary.json" \
  --summary-markdown "./artifacts/harness-eval-summary.md" \
  --trend-json "./artifacts/harness-eval-trend.json" \
  --trend-markdown "./artifacts/harness-eval-trend.md" \
  --cleanup-json "./artifacts/harness-cleanup-report.json" \
  --cleanup-markdown "./artifacts/harness-cleanup-report.md" \
  --dashboard-html "./artifacts/harness-dashboard.html"
```

这样本地与 nightly 复用同一条 `summary -> history -> trend -> cleanup -> dashboard` 主线，也让 `current / degraded` observability gap 角色在两侧保持同口径，并把 `browser/gui/artifact` 的 verification outcome 焦点直接带进 nightly HTML 仪表板，继续绑定到同一事实源。

从 `2026-03-27` 起，这个历史窗口不再依赖 workflow 里的 `cp / ls / xargs` 拼接；当前唯一 current 入口是 `scripts/harness-eval-history-record.mjs`，统一负责写入和裁剪 history window，保证本地与 nightly 走同一条跨平台主链。

同一天新增的 `scripts/harness-eval-history-record.mjs` 又把这条主链向前推了一步：

- 本地可以一次命令完成 `summary -> history -> trend -> cleanup -> dashboard`
- 本地默认把 history window 写到 `./.lime/harness/history`，并把 `summary / trend / cleanup / dashboard` 全部写到 `./.lime/harness/reports`
- 如显式传入 `--dashboard-html`，会覆盖默认 HTML 产物路径，但仍直接复用 in-memory 的 `summary / trend / cleanup` 对象生成 HTML，不再额外读取第二套事实
- `history-record` 自身的 JSON / text 结果也应直接带出 cleanup 侧的 verification outcome 焦点，避免调用方为了知道“先修 artifact/browser/gui 哪层”还要再手工下钻 cleanup 报告
- `cleanup` 当前还应继续导出稳定的 verification 摘要，例如 `failureCaseCount / recoveredCaseCount`，让 dashboard 与 nightly 值班出口可以直接判断是否需要立刻阻断主线
- 对 failure outcome 还应继续区分 `blocking_failure / advisory_failure`；默认像 `guiSmoke:failed`、`browserVerification:failure` 这类直接验证失败应被归到 blocking，而 `artifactValidator:issues_present` 这类更偏证据治理的失败应停留在 advisory
- `cleanup report` 在未显式传入 `--trend-input / --trend-history-dir` 时，会优先自动发现 `./.lime/harness/history`，再回退到 `./artifacts/history`
- 修复后的趋势积累不再只属于 nightly，开发者本地也能拿到同口径的历史窗口

## 常用命令

```bash
# 人类可读摘要
npm run harness:eval

# JSON 输出，适合脚本和 CI 消费
npm run harness:eval:json

# 把工作区 replay 提升为仓库 current 样本
npm run harness:eval:promote -- --session-id "session-123" --slug "pending-request-runtime"

# 生成当前趋势报告；若没有历史输入，会先生成当前 summary 作为 trend seed
npm run harness:eval:trend

# 指定工作区根目录扫描真实 replay 样本
node scripts/harness-eval-runner.mjs --workspace-root "/path/to/workspace"

# 生成 nightly 可上传的双格式摘要
node scripts/harness-eval-runner.mjs \
  --output-json "./tmp/harness-eval-summary.json" \
  --output-markdown "./tmp/harness-eval-summary.md"

# 推荐的本地一体化入口：记录 history，并同时刷新 summary / trend / cleanup / dashboard
npm run harness:eval:history:record

# 默认产物目录：
# ./.lime/harness/reports/harness-eval-summary.json
# ./.lime/harness/reports/harness-eval-summary.md
# ./.lime/harness/reports/harness-eval-trend.json
# ./.lime/harness/reports/harness-eval-trend.md
# ./.lime/harness/reports/harness-cleanup-report.json
# ./.lime/harness/reports/harness-cleanup-report.md
# ./.lime/harness/reports/harness-dashboard.html

# 如需覆盖 dashboard 产物路径
node scripts/harness-eval-history-record.mjs \
  --history-dir "./.lime/harness/history" \
  --dashboard-html "./tmp/harness-dashboard.html"

# 从历史 summary 目录生成趋势报告
node scripts/harness-eval-trend-report.mjs \
  --history-dir "./.lime/harness/history" \
  --output-json "./tmp/harness-eval-trend.json" \
  --output-markdown "./tmp/harness-eval-trend.md"
```

## 输出摘要里应该看什么

Runner 摘要至少回答下面这些问题：

- 总共有多少 suite / case
- 有多少 case 已经 ready
- 哪些 case 缺文件
- 哪些 case JSON 字段不完整
- 哪些 case 属于什么 suite tag / failure mode
- 哪些 case 默认需要人工复核
- 哪些 case 已经记录人工审核状态与风险等级
- 哪些 case 还缺 `observabilitySummary` 或仍处于 `requestTelemetry:known_gap`、`artifactValidator:known_gap` 等证据缺口
- 哪些 case 已经导出 `observabilityVerificationOutcomes`，并能直接看出 `artifactValidator:issues_present`、`browserVerification:failure`、`guiSmoke:failed` 等 outcome
- 工作区 replay 是否已经开始形成增量样本

如果摘要回答不了这些问题，就说明 runner 还不算进入 current 主链。

Trend 报告至少还要回答：

- baseline 和 latest 之间，ready / invalid / pending request 有没有变化
- 哪些 suite 在 latest 里变差了
- 哪些 failure mode / suite tag 在 latest 里增长或退化了
- 哪些人工审核状态 / 风险等级在 latest 里新增、减少或发生迁移
- 哪些 observability signal gap 在 latest 里增加、减少或仍然停留在 current 样本中
- 哪些 verification outcome 在 latest 里新增、减少或迁移，足以直接指出先修 artifact/browser/gui 哪一层
- 哪些 observability gap 属于 `current` 样本回归，哪些只是 `degraded` 样本刻意保留的诊断基线
- 当前只有 trend seed，还是已经开始形成真正的历史窗口

## 与其他事实源的关系

| 文档 / 文件                                                                                | 角色                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| [agent-evaluation.md](agent-evaluation.md)                                                 | 解释评估原则、pass@k / pass^k、grader 类型      |
| [testing-strategy-2026.md](testing-strategy-2026.md)                                       | 解释为什么 eval 工程化排在 smoke 之后           |
| [../tech/harness/implementation-blueprint.md](../tech/harness/implementation-blueprint.md) | 解释 `P3-2 Eval runner` 在 Harness 主线中的位置 |
| [../tech/harness/tooling-roadmap.md](../tech/harness/tooling-roadmap.md)                   | 解释 runner、nightly、trend 的后续工具面        |
| [../tech/harness/entropy-governance-workflow.md](../tech/harness/entropy-governance-workflow.md) | 解释 trend 怎样回挂到 cleanup / governance 建议 |
| `scripts/harness-eval-runner.mjs`                                                          | 当前唯一的 runner 入口                          |
| `scripts/harness-eval-trend-report.mjs`                                                    | 当前 trend 聚合与 nightly 趋势出口              |
| `scripts/report-generated-slop.mjs`                                                        | 当前 cleanup/slop 聚合与治理建议入口            |
| `scripts/check-doc-freshness.mjs`                                                          | 当前 Harness 文档保鲜检查入口                   |
| [../../.github/workflows/harness-nightly.yml](../../.github/workflows/harness-nightly.yml) | 当前 nightly summary / trend / cleanup artifact 主入口 |
| [harness-evals.manifest.json](harness-evals.manifest.json)                                 | 当前任务集与 suite 机可读事实源                 |

## 下一刀

`P3-6` 做完之后，下一刀优先级建议固定为：

1. 继续补 observability 证据字段，让 grader、analysis handoff 和 cleanup report 都能消费更多 `request / timeline / artifact` 关联
2. 逐步提高 repo current 样本质量，而不是只增加数量
3. 让 review-decision / 风险等级 / replay promotion 继续回挂到同一条趋势主线
4. 再考虑是否引入真实模型执行或 transcript grading

## 非目标

当前阶段默认不做：

- 不把 runner 变成第二套 CI 总控
- 不要求所有 replay case 都进仓库版本控制
- 不在这一刀里直接引入真实模型调用成本
- 不绕开 `handoff bundle / evidence pack / replay export` 另造样本格式
