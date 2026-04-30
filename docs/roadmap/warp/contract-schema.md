# ModalityRuntimeContract Schema

> 状态：current planning source  
> 更新时间：2026-04-29  
> 目标：定义 Lime 多模态底层运行合同的机器可检查结构，确保 `@` 命令、按钮和 Scene 只能绑定到底层 contract，而不是反过来决定运行事实源。

## 1. Schema 事实源

当前机器可检查事实源：

- Registry：`src/lib/governance/modalityRuntimeContracts.json`
- Capability Matrix：`src/lib/governance/modalityCapabilityMatrix.json`
- Artifact Graph：`src/lib/governance/modalityArtifactGraph.json`
- Execution Profiles：`src/lib/governance/modalityExecutionProfiles.json`
- Check：`scripts/check-modality-runtime-contracts.mjs`
- npm 入口：`npm run governance:modality-contracts`

本文件解释字段语义；JSON registry 是校验输入。

## 2. 核心原则

1. `contract_key` 代表底层多模态运行能力，例如 `image_generation`、`browser_control`、`pdf_extract`。
2. `contract_key` 不代表上层入口，不能写成 `@配图`、`@浏览器` 或 `/scene-key`。
3. `bound_entries` 在 Phase 0/1 可以为空；进入 Phase 7 后按 contract 逐条把 `@`、按钮和 Scene 绑定进来。
4. 每个 contract 必须能解释 identity、capability、profile、executor、truth source、artifact、viewer、evidence。
5. `required_capabilities` 必须全部出现在 [capability-matrix.md](./capability-matrix.md)。
6. `routing_slot` 必须出现在 capability matrix 的 `model_roles`。
7. contract 不允许引用不存在的 artifact kind、viewer surface、permission key 或 evidence event。
8. contract 引用的 artifact kind 必须能在 artifact graph 中找到 truth source / viewer / evidence 交集。
9. current contract 必须能在 [execution-profile.md](./execution-profile.md) 中找到 profile 与 executor adapter 覆盖。

## 3. 顶层结构

```json
{
  "version": 1,
  "status": "current",
  "owner": "docs/roadmap/warp/contract-schema.md",
  "contracts": []
}
```

## 4. Contract 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `contract_key` | string | 是 | 底层能力主键，不能是入口名 |
| `lifecycle` | string | 是 | `current` / `compat` / `deprecated` / `dead` |
| `modality` | string | 是 | `text` / `image` / `audio` / `video` / `browser` / `document` / `code` / `mixed` |
| `runtime_identity` | string[] | 是 | 运行关联键，例如 `session_id`、`thread_id`、`turn_id` |
| `input_context_kinds` | string[] | 是 | 输入上下文类型 |
| `required_capabilities` | string[] | 是 | 模型/工具/执行能力需求 |
| `permission_profile_keys` | string[] | 是 | 权限面需求 |
| `routing_slot` | string | 是 | 模型角色槽位 |
| `executor_binding` | object | 是 | 执行器描述 |
| `truth_source` | string[] | 是 | 唯一事实源 |
| `artifact_kinds` | string[] | 是 | 输出 artifact kind |
| `viewer_surface` | string[] | 是 | viewer / workspace 消费面 |
| `evidence_events` | string[] | 是 | evidence pack 必须导出的事件 |
| `limecore_policy_refs` | string[] | 是 | LimeCore 只作为目录/策略/offer/audit 事实源 |
| `fallback_policy` | string[] | 是 | 降级或阻断策略 |
| `detour_policy` | object | 是 | 允许/禁止的偏航工具 |
| `owner_surface` | string | 是 | current owner |
| `bound_entries` | object[] | 是 | 上层入口绑定；Phase 0/1 默认允许为空 |

## 5. Executor binding

```json
{
  "executor_kind": "skill",
  "binding_key": "image_generate",
  "current_path": "Agent turn -> Skill(image_generate) -> image task artifact",
  "supports_progress": true,
  "supports_cancel": true,
  "supports_resume": false,
  "supports_artifact": true,
  "failure_mapping": ["permission_denied", "capability_gap", "executor_error"]
}
```

固定约束：

1. `local_cli` 只能作为 typed adapter。
2. 不支持 progress / cancel / resume / artifact 的 executor 必须显式写 `false`。
3. executor 失败必须映射到可解释原因，不能只返回普通文本。

## 6. Entry binding

Phase 7 才允许大量补 entry binding。

结构：

```json
{
  "entry_key": "at_image_generate",
  "entry_kind": "command",
  "display_name": "@配图",
  "launch_metadata_path": "harness.image_skill_launch",
  "entry_source": "at_image_command",
  "default_input_mapping": ["user_text", "selected_assets"],
  "entry_visibility_policy": ["skill_catalog_visible", "profile_allows_image_generation"]
}
```

固定约束：

1. Entry binding 必须引用已存在的 `contract_key`。
2. Entry binding 不得拥有 `truth_source`、`artifact_kinds`、`viewer_surface`。
3. Entry binding 只补 launch metadata、`entry_source` 和 input mapping。
4. `launch_metadata_path` 必须指向 `harness.*`，避免入口直接绕到 task / artifact 层。

## 7. 首批 contract

首批 registry 先覆盖底层能力；进入 current 的 contract 必须继续被 capability matrix、artifact graph、execution profile 与 executor adapter registry 同步覆盖：

1. `image_generation`
2. `browser_control`
3. `pdf_extract`
4. `voice_generation`
5. `audio_transcription`
6. `web_research`
7. `text_transform`

这些 contract 用于验证 schema 和治理守卫；后续 vertical slice 继续按“先底层、后 entry binding”的顺序推进。

## 8. 校验入口

```bash
npm run governance:modality-contracts
```

通过标准：

1. 所有必填字段存在。
2. 所有数组字段非空，除 `bound_entries` 可为空。
3. `contract_key` 唯一且不是入口名。
4. 枚举字段使用已知值。
5. executor binding 声明能力与 failure mapping。
6. entry binding 不携带底层事实源字段。
7. entry binding 必须声明 `entry_source`，且 `launch_metadata_path` 必须留在 `harness.*`。
8. `artifact_kinds` 必须存在于 artifact graph，并与 contract 的 truth source、viewer、evidence 至少各有一个交集。
9. current contract 必须被 execution profile 覆盖，且 `executor_binding` 必须能解析到已声明 executor adapter。
