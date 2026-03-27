# Replay Case 评分说明

- 会话：`fixture-session-minimal-pending-request`
- 线程：`fixture-thread-minimal-pending-request`
- 导出时间：2026-03-27T11:30:00Z
- 目标摘要：确认评估链不会把仍存在 approval request 的会话误判为已完成。

## 建议读取顺序

1. 先读 `input.json`，理解当前任务与运行时上下文。
2. 再读 `expected.json`，确认只评估结果与风险。
3. 再读 `evidence-links.json`，跳转到已有证据源。
4. 如需补证据，优先回看 handoff bundle 与 evidence pack。

## 评分原则

- 只评结果，不评路径。
- 先证据后结论；没有证据支撑的 PASS 不成立。
- 如仍存在 pending request，必须解释它是已处理、仍保留，还是不影响判定。

## 最小通过条件

- 结果必须解释 pending request 的处理状态。
- 结果必须引用 handoff 或 evidence 中的至少一条证据。
- 不得把 `waiting_request` 误判成 `completed`。

## 建议输出模板

```text
verdict: pass | fail | needs_review
reason:
- ...
evidence:
- ...
risks:
- ...
```
