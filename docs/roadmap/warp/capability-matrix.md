# 多模态能力矩阵

> 状态：current planning source  
> 更新时间：2026-04-29  
> 目标：把 `ModalityRuntimeContract.required_capabilities` 接到统一模型能力矩阵，确保模型路由先看底层能力需求，再服务 `@` 命令、按钮和 Scene。

## 1. 事实源

当前机器可检查事实源：

- Matrix：`src/lib/governance/modalityCapabilityMatrix.json`
- Contract：`src/lib/governance/modalityRuntimeContracts.json`
- Check：`scripts/check-modality-runtime-contracts.mjs`
- npm 入口：`npm run governance:modality-contracts`

本文件解释 Phase 2 的字段语义；JSON matrix 是当前校验输入。

## 2. 固定原则

1. 能力矩阵描述底层能力，不描述上层入口。
2. Contract 里的 `required_capabilities` 必须全部出现在 matrix。
3. Contract 里的 `routing_slot` 必须出现在 matrix 的 `model_roles`。
4. 候选模型过滤必须先满足 capability，再考虑成本、限额和偏好。
5. 候选为空、候选唯一、候选能力不足都必须进入 routing evidence。

## 3. Capability 字段

| 字段 | 说明 |
| --- | --- |
| `key` | 能力主键，例如 `image_generation` |
| `lifecycle` | `current` / `compat` / `deprecated` / `dead` |
| `group` | `model` / `tool` / `runtime` / `policy` |
| `description` | 给工程和产品解释能力语义 |
| `routing_sources` | 用来判断能力是否满足的事实源 |
| `capability_gap_code` | 候选为空或能力不足时写入 routing / evidence 的 gap code |
| `evidence_events` | 该能力要求至少能解释到哪些 runtime event |

## 4. Model role 字段

| 字段 | 说明 |
| --- | --- |
| `slot` | 模型角色槽位，例如 `image_generation_model` |
| `lifecycle` | 生命周期分类 |
| `capability_keys` | 该槽位需要满足的能力集合 |
| `fallback_slots` | 允许降级参考的槽位；空数组代表无自动 fallback |

固定约束：

1. `fallback_slots` 只能引用已存在的 slot。
2. fallback 不代表一定允许执行，仍需通过 capability / permission / tenant policy。
3. `image_generation_model`、`voice_generation_model` 等生成类槽位默认不允许自动降级成普通文本模型。

## 5. 首批 current capability

| capability | group | 主要服务 |
| --- | --- | --- |
| `text_generation` | model | 基础 Agent turn |
| `vision_input` | model | 图片输入、截图、视觉附件 |
| `image_generation` | model | 图片、海报、封面生成 |
| `image_edit` | model | 修图、重绘、参考图编辑 |
| `audio_transcription` | model | 音频转写 |
| `voice_generation` | model | 播报、配音 |
| `browser_reasoning` | model | 浏览器状态理解和动作规划 |
| `browser_control_planning` | tool | typed browser action 计划 |
| `web_search` | tool | 搜索、抓取、来源整理 |
| `local_file_read` | tool | 本地文件、PDF、工作区材料读取 |
| `structured_document_generation` | model | 报告、网页、PPT、结构化文稿 |
| `long_context` | model | 长文档、多来源材料 |
| `cheap_summary` | model | 低成本摘要、标题、元信息生成 |

## 6. 与现有 task/model 主链的关系

本矩阵不新建第二条模型路由。

它应继续挂到现有主链：

```text
agent_runtime_submit_turn
  -> runtime_turn.rs
  -> request_model_resolution.rs
  -> TaskProfile
  -> CandidateModelSet
  -> RoutingDecision
  -> thread_read / evidence / review
```

当前 Phase 2 先建立可检查的 capability taxonomy；后续代码实现再把它映射到：

1. `TaskProfile.traits`
2. `RoutingDecision.capability_gap`
3. `LimitState.capability_gap`
4. `thread_read.capability_gap`
5. evidence pack 的 routing 摘要

## 7. 典型阻断规则

### `image_generation`

如果 contract 要求 `image_generation`，候选模型必须支持图片生成或对应服务型执行器能力。

禁止：

1. 回退成普通文本模型输出“图片描述”。
2. 用 WebSearch 替代图片生成。
3. 用自由 Bash 调旧 CLI 作为 current 首发路径。

### `browser_control_planning`

如果 contract 要求 `browser_control_planning`，必须同时满足：

1. Browser executor 可用。
2. `browser_control` 权限允许或可询问。
3. 能产生 browser action observation。

禁止：

1. 直接回退 WebSearch 假装完成浏览器动作。
2. 没有截图 / DOM / URL / network 观测就写 browser artifact。

### `local_file_read`

如果 contract 要求 `local_file_read`，必须同时满足：

1. 本地文件引用可解析。
2. `read_files` 权限允许或可询问。
3. 抽取结果能落到 domain artifact。

禁止：

1. 前端本地解析后伪装成 skill 结果。
2. 只把抽取结果保存为普通聊天文本。

## 8. 校验入口

```bash
npm run governance:modality-contracts
```

当前检查：

1. Matrix 里的 capability key 唯一。
2. Contract 引用的 capability 必须存在。
3. Contract 引用的 routing slot 必须存在。
4. Model role 引用的 capability / fallback slot 必须存在。
5. Capability 的 evidence events 必须是当前允许事件。

后续 Phase 2 代码落地时，再把该检查扩展到真实 routing 类型和测试夹具。
