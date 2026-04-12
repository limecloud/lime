# Replay Case 评分说明

- 会话：`fixture-session-observability-gap`
- 线程：`fixture-thread-observability-gap`
- 导出时间：2026-03-27T14:10:00Z
- 目标摘要：确认评估链会把 observability 证据缺口显式识别出来，而不是把证据不完整的会话误判为全量覆盖。

## 建议读取顺序

1. 先读 `input.json`，理解当前任务、线程状态与 observability 缺口。
2. 再读 `expected.json`，确认只评估结果与风险。
3. 再读 `evidence-links.json`，跳转到 handoff 与 evidence 入口。
4. 如需补证据，优先回看 evidence pack 中的 `knownGaps` 与 `observabilitySummary`。

## 评分原则

- 只评结果，不评路径。
- 先证据后结论；缺口必须引用 evidence，而不是凭印象补齐。
- 如果 evidence 已明确记录 `known_gap`，结论里必须解释它是否阻断判定，不能把缺口包装成 PASS 证据。

## 最小通过条件

- 结果必须指出 `requestTelemetry` 与 `artifactValidator` 的缺口状态。
- 结果必须引用 handoff 或 evidence 中的至少一条证据。
- 不得把 observability 缺口误判为“证据已完整”。

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
