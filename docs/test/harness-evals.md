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
   - 当前固定一条 fixture：
     - `fixture-minimal-pending-request`
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
4. 输出统一 JSON / Markdown 摘要，并聚合 `suite tag / failure mode` 分布

当前它**不直接执行真实模型重放**，而是先把“样本是否可评估、摘要是否可归档”工程化。

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

这个命令会做四件事：

1. 读取 replay 最小四件套。
2. 把工作区绝对路径脱敏成稳定占位路径，避免把本机路径直接写进仓库。
3. 把样本复制到 `docs/test/harness-fixtures/replay/<slug>/`。
4. 把 case 回写到 `repo-promoted-replays` suite，成为 nightly 与 trend 的 current 样本。

默认原则：

- 不是每个 replay 都要 promotion，只提升高价值、可重复、能代表失败模式的样本。
- promotion 之后，样本不再只是“本机能看到”，而是仓库 current 主线的一部分。
- 仓库沉淀样本仍然复用原来的 handoff / evidence 形状，不另造 schema。

## Trend Report 做什么

`scripts/harness-eval-trend-report.mjs` 当前负责三件事：

1. 读取一个或多个 `harness eval summary` JSON
2. 生成 baseline / latest 对比、suite 级 delta，以及 `suite tag / failure mode` 聚合变化
3. 输出 JSON / Markdown 趋势报告

如果没有显式提供输入，它会先调用 `harness-eval-runner` 生成当前 summary，再把它当作第一条 trend seed。

这一步的目的不是假装已经有完整历史，而是先把：

- trend 报告字段
- nightly 报告出口
- baseline / latest / suite delta 的最小合同

固定下来。

当前 nightly 还会恢复并追加 `artifacts/history/*.json` 历史窗口，用于让 trend 不只停留在单次 seed。

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

# 从历史 summary 目录生成趋势报告
node scripts/harness-eval-trend-report.mjs \
  --history-dir "./artifacts/history" \
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
- 工作区 replay 是否已经开始形成增量样本

如果摘要回答不了这些问题，就说明 runner 还不算进入 current 主链。

Trend 报告至少还要回答：

- baseline 和 latest 之间，ready / invalid / pending request 有没有变化
- 哪些 suite 在 latest 里变差了
- 哪些 failure mode / suite tag 在 latest 里增长或退化了
- 当前只有 trend seed，还是已经开始形成真正的历史窗口

## 与其他事实源的关系

| 文档 / 文件                                                                                | 角色                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| [agent-evaluation.md](agent-evaluation.md)                                                 | 解释评估原则、pass@k / pass^k、grader 类型      |
| [testing-strategy-2026.md](testing-strategy-2026.md)                                       | 解释为什么 eval 工程化排在 smoke 之后           |
| [../tech/harness/implementation-blueprint.md](../tech/harness/implementation-blueprint.md) | 解释 `P3-2 Eval runner` 在 Harness 主线中的位置 |
| [../tech/harness/tooling-roadmap.md](../tech/harness/tooling-roadmap.md)                   | 解释 runner、nightly、trend 的后续工具面        |
| `scripts/harness-eval-runner.mjs`                                                          | 当前唯一的 runner 入口                          |
| `scripts/harness-eval-trend-report.mjs`                                                    | 当前 trend 聚合与 nightly 趋势出口              |
| [harness-evals.manifest.json](harness-evals.manifest.json)                                 | 当前任务集与 suite 机可读事实源                 |

## 下一刀

`P3-6` 做完之后，下一刀优先级建议固定为：

1. 把分类聚合直接挂到熵治理清单，形成 replay 驱动 cleanup 主线
2. 继续补 observability 证据字段，让 grader 能消费更多 request / timeline / artifact 关联
3. 逐步提高 repo current 样本质量，而不是只增加数量
4. 再考虑是否引入真实模型执行或 transcript grading

## 非目标

当前阶段默认不做：

- 不把 runner 变成第二套 CI 总控
- 不要求所有 replay case 都进仓库版本控制
- 不在这一刀里直接引入真实模型调用成本
- 不绕开 `handoff bundle / evidence pack / replay export` 另造样本格式
