# 多模态底层运行事实源地图

> 状态：current planning source  
> 更新时间：2026-04-29  
> 目标：先盘清 Lime 多模态运行链中的底层事实源，避免从 `@` 命令、viewer 或 CLI 旁路倒推架构。

## 1. 事实源声明

后续多模态能力只允许向这条 current 主链收敛：

```text
Agent runtime identity
  -> ModalityRuntimeContract
  -> capability matrix
  -> ModalityExecutionProfile
  -> executor binding
  -> domain artifact graph
  -> evidence pack
  -> task index
  -> viewer
```

`@` 命令、按钮和 Scene 只允许作为 entry binding，不是底层事实源。

## 2. 底层事实源总表

| fact source | 分类 | owner | 写入方 | 读取方 | 持久化 | 退出/收口条件 |
| --- | --- | --- | --- | --- | --- | --- |
| `agent_runtime_identity` | current | Agent Runtime | session/thread/turn/task 创建链 | contract、artifact、evidence、viewer | session store / thread read | 后续所有多模态 contract 必须引用 |
| `modality_runtime_contract` | current | `src/lib/governance/modalityRuntimeContracts.json` | 治理 registry | runtime、文档、校验脚本 | repo versioned artifact | 新能力先补或复用 contract |
| `capability_matrix` | current | task/model routing 主链 | model catalog、provider offer、tenant policy | router、profile、evidence | routing decision / thread read | 不能只按 provider/model id 选模型 |
| `execution_profile` | current | runtime policy merge | 用户设置、LimeCore policy、本地安全策略 | executor、router、evidence | thread read / evidence | 权限和模型必须合并解释 |
| `executor_binding` | current | Agent Runtime / Tool registry | Skill、Tool、ServiceSkill、Browser、Gateway adapter | runtime contract | runtime event | executor 必须声明 progress/cancel/resume/artifact/failure |
| `domain_artifact_graph` | current | artifact runtime | executor result、task event | viewer、evidence、task index | artifact document / task file | viewer 只读 artifact graph |
| `evidence_pack` | current | Harness Engine | runtime timeline、routing、profile、artifact event | replay、analysis、review、audit | evidence export | 不从 viewer 反推 evidence |
| `limecore_catalog_policy` | current | LimeCore + Lime bootstrap cache | `client/skills`、`client/scenes`、model catalog、policy | contract registry、profile | bootstrap cache / policy snapshot | 云端控制面，不默认执行 |
| `entry_binding` | current | 上层入口 registry | `@`、button、Scene metadata | runtime contract | entry binding registry | Phase 7 才绑定；不得写 task/artifact |
| `browser_observation` | current | Browser Assist executor | typed action result | evidence、browser replay viewer | observation trace | Browser 不能降级为 WebSearch 假执行 |
| `generic_file_artifact` | compat | artifact runtime | legacy/file executor | generic viewer | file artifact | 只做兜底；多模态主结果迁到 domain kind |
| `legacy_local_cli_media` | compat | typed local_cli adapter | 旧 CLI wrapper | runtime contract | executor event | 只允许 typed adapter；不能自由 Bash |
| `frontend_direct_task_creation` | deprecated | legacy frontend path | 历史入口逻辑 | 旧 viewer / task | 历史 task file | 迁到 contract -> executor -> artifact 后下线 |
| `viewer_inferred_artifact` | deprecated | legacy viewer path | viewer local state | viewer only | UI state | viewer 改为只读 artifact graph 后下线 |
| `limecore_default_executor` | dead | 无 | 无 | 无 | 无 | 不允许作为 current 规划出现 |
| `entry_key_as_contract_key` | dead | 无 | 无 | 无 | 无 | contract 主键必须是底层能力，不是 `@` 命令 |

## 3. current 主链 owner

### 3.1 运行身份

owner：Agent Runtime。

必须提供：

1. `session_id`
2. `thread_id`
3. `turn_id`
4. `task_id` 或 `run_id`
5. `content_id`
6. `artifact_id`

没有这些关联键的结果不能升为 current artifact。

### 3.2 Contract registry

owner：`src/lib/governance/modalityRuntimeContracts.json`。

必须提供：

1. `contract_key`
2. `modality`
3. `required_capabilities`
4. `permission_profile_keys`
5. `executor_binding`
6. `truth_source`
7. `artifact_kinds`
8. `viewer_surface`
9. `evidence_events`

`contract_key` 不得使用 `@配图`、`/scene-key` 这类入口名。

### 3.3 Artifact graph

owner：artifact runtime。

首批 current kind：

1. `image_task`
2. `image_output`
3. `audio_task`
4. `audio_output`
5. `transcript`
6. `browser_session`
7. `browser_snapshot`
8. `pdf_extract`
9. `report_document`
10. `presentation_document`
11. `webpage_artifact`
12. `generic_file`

`generic_file` 只能作为兜底，不能作为多模态默认主结果。

## 4. entry binding 的边界

上层入口只允许做：

1. 识别用户触发意图
2. 补 launch metadata
3. 绑定 `contract_key`
4. 提供默认输入映射
5. 读取 entry visibility policy

上层入口禁止做：

1. 直接创建 task
2. 直接选择 model
3. 直接决定权限
4. 直接写 artifact
5. 直接决定 viewer
6. 直接伪造 evidence

## 5. 本轮守卫

本轮新增最小守卫：

```bash
npm run governance:modality-contracts
```

该守卫负责：

1. 检查 contract registry 必填字段。
2. 检查 contract 主键不是入口名。
3. 检查 artifact、capability、permission、viewer、evidence 使用已知枚举。
4. 检查 entry binding 不在 Phase 0/1 抢写底层事实。

后续进入 Phase 7 时，再扩展该守卫，要求每个 entry binding 必须引用已存在的 `contract_key`。
