# Coding Agent / Skill Forge 层设计

> 状态：proposal  
> 更新时间：2026-05-06
> 目标：把 Skill Forge 启发中最关键的 “Coding Agent 现场写代码、调 CLI / API、生成 adapter 和测试” 单独定义清楚，避免路线图退化成只有 Managed Objective 的目标续跑器。

依赖文档：

- [./README.md](./README.md)
- [./implementation-plan.md](./implementation-plan.md)
- [./diagrams.md](./diagrams.md)
- [../../research/skill-forge/agent-product-model.md](../../research/skill-forge/agent-product-model.md)
- [../../research/skill-forge/architecture-breakdown.md](../../research/skill-forge/architecture-breakdown.md)
- [../../research/pi-mono-coding-agent/README.md](../../research/pi-mono-coding-agent/README.md)
- [../../aiprompts/skill-standard.md](../../aiprompts/skill-standard.md)
- [../../aiprompts/query-loop.md](../../aiprompts/query-loop.md)

## 1. 为什么必须单独成层

你指出的问题是对的：如果只有 `Managed Objective`，Lime 得到的是一个“目标续跑控制层”；但 Skill Forge 案例最关键的不是续跑本身，而是：

```text
Coding Agent 根据业务目标
  -> 读取 API / CLI / docs / website
  -> 写 adapter / wrapper / script
  -> 写 contract / permission / fixture test
  -> 修复验证失败
  -> 注册为可复用能力
```

所以 Lime 的完整方案必须有三条互相衔接、但不能混成一条的链：

1. **Coding Agent / Skill Forge 链**
   - 负责生产能力。

2. **Managed Objective 链**
   - 负责围绕目标持续使用能力。

3. **Agent Envelope 产品链**
   - 负责把成功任务包装成带 memory、widget、schedule、permission、evidence 的可 rerun 工作单元。

一句话：

**没有 Coding Agent 层，方案只是在“让已有工具多跑几轮”；有了 Coding Agent 层，才是在“让 AI 生产并治理新工具”。**

## 2. 层级定位

`Coding Agent` 是执行者，`Skill Forge` 是产品与工程边界。

二者关系：

| 名称 | 含义 | 在 Lime 中的边界 |
| --- | --- | --- |
| Coding Agent | 负责理解目标、探索外部能力、写代码、修测试的 agent 行为模式 | 仍通过 `agent_runtime_submit_turn / Query Loop / tool_runtime` 执行 |
| Skill Forge | 承载生成流程、draft、验证、注册和 UI 的产品层 | 不定义新 runtime，不绕过 skill 标准 |
| Generated Capability Draft | Coding Agent 的中间产物 | 未验证前不能进入默认 tool surface |
| Verification Gate | 注册前门禁 | 结构、contract、permission、dry-run、fixture test |
| Workspace-local Skill | 验证后的标准能力 | 进入 Skill Catalog / ServiceSkill 投影 |

固定边界：

**Coding Agent 是 build-time capability author，不是可调度任务 runner。**

## 3. 权限宗旨：受控执行，不是低能力

本层最容易被误解成“为了安全削弱 Coding Agent”。固定修正：

**限制的是未经验证、未经授权、不可审计的执行；不限制 agent 理解需求、探索资料、设计 adapter、编写 draft 和修复 self-check 的能力。**

为什么要这样做：

1. 通用 coding agent 面向开发者，风险主要是“改坏代码”。
2. Lime 的 generated capability 未来会进入 skill catalog、automation job 和 evidence 主链，风险会扩展到账号、API、业务数据、外部发布、花钱、删除和可调度重复执行。
3. 如果未验证 draft 能直接跑，错误会从“一次 agent turn”放大为“长期业务自动化事故”。
4. 因此 Coding Agent 可以大胆生成能力，但系统必须管住它真实执行什么、写到哪里、能否注册、能否授权调用、能否被固化为 Agent。

固定长期原则：

1. 权限永远显式受控。
2. 能力可以逐级开放。
3. 默认 deny 只适用于当前未验证阶段，不代表永远禁止高级能力。
4. 每次放权都必须有 sandbox、verification、permission policy、用户确认或 evidence audit 支撑。

推荐分级：

```text
Level 0: read-only discovery
Level 1: draft-scoped write
Level 2: fixture dry-run
Level 3: sandbox shell
Level 4: workspace-local verified execution
Level 5: human-confirmed external write
Level 6: policy-approved scheduled external write
```

一句话：

**不是永远限制能力；是永远限制未经验证、未经授权、不可审计的执行。**

## 4. Coding Agent 工作循环

推荐最小循环：

```text
clarify
  -> discover
  -> design
  -> generate
  -> self-check
  -> submit verification
  -> repair
  -> register
```

每一步职责：

1. `clarify`
   - 明确用户目标、成功标准、输入输出、风险等级。

2. `discover`
   - 读取 CLI help、API docs、OpenAPI schema、网页说明、已有代码入口。

3. `design`
   - 决定生成哪类能力：Skill Bundle、Adapter Spec、wrapper script、fixture test。

4. `generate`
   - 写 draft 文件，不注册，不进入默认工具面。

5. `self-check`
   - 本地静态检查、schema 检查、最小 dry-run。

6. `submit verification`
   - 把 draft 交给 verification gate。

7. `repair`
   - 根据 gate 失败项修复文件和测试。

8. `register`
   - gate 通过后进入 workspace-local skill catalog。

## 5. 输入输出契约

### 4.1 `CapabilityGenerationRequest`

概念输入：

```text
request_id
workspace_id
user_goal
success_criteria[]
source_kind: cli | api | docs | website | mcp | local_code
source_refs[]
risk_policy
permission_expectation
runtime_binding_target?
```

约束：

1. `workspace_id` 必须存在。
2. `user_goal` 必须能转成能力边界，不能只是“帮我搞增长”。
3. `source_refs` 必须可追踪，不能只写“网上找的”。
4. 高风险权限默认需要人工确认。

### 4.2 `GeneratedCapabilityDraft`

概念输出：

```text
draft_id
workspace_id
request_id
name
description
source_summary
generated_files[]
input_contract_ref
output_contract_ref
permission_summary
runtime_binding_target
verification_status
created_at
updated_at
```

约束：

1. Draft 不是 tool。
2. Draft 不是 runtime。
3. Draft 不能被 automation job 自动调用。
4. Draft 只能进入 verification gate。

### 4.3 `CapabilityPatchSet`

Coding Agent 每次修改 draft 时，应能形成 patch set 摘要：

```text
patch_id
draft_id
changed_files[]
reason
source_refs[]
self_check_summary
```

作用：

1. 让用户知道 agent 改了什么。
2. 让 verification gate 能回溯失败和修复。
3. 让 evidence pack 后续能关联能力来源。

## 6. 和 Query Loop 的关系

Coding Agent 本身不需要新 runtime。

它应该被理解为一类 `agent turn`：

```text
用户请求生成能力
  -> agent_runtime_submit_turn
  -> request_metadata.harness.capability_generation
  -> runtime_turn / TurnInputEnvelope
  -> tool_runtime 提供受控文件、CLI、docs、workspace 工具
  -> 生成 draft artifact
  -> verification gate
```

固定规则：

1. 不新增 `coding_agent_runtime`。
2. 不新增 generated tool registry。
3. 不绕过 `tool_runtime` 直接执行外部命令。
4. 不把 draft 文件当成已注册 skill。
5. 所有生成动作都要能进入 timeline / artifact / evidence。

## 7. 和 Managed Objective 的关系

二者是前后关系，不是同一层：

```text
Coding Agent / Skill Forge
  -> 生成并验证 workspace-local skill
  -> 注册为可发现能力
  -> 用户创建 automation job
  -> Managed Objective 绑定 job / session
  -> Query Loop 可调度执行并 evidence audit
  -> 成功任务可生成 Agent envelope
```

固定判断：

1. Coding Agent 负责“有什么能力可用”。
2. Managed Objective 负责“这个目标是否还要继续”。
3. automation job 负责“什么时候后台触发”。
4. Query Loop / tool_runtime 负责“真实执行”。
5. evidence pack 负责“事实导出”。

禁止混淆：

1. 不让 Managed Objective 生成 adapter。
2. 不让 Coding Agent 直接运行 job 或创建 Agent envelope。
3. 不让 verification gate 变成 scheduler。
4. 不让 draft 逃过注册直接进入 objective。

## 8. pi-mono 参考边界

[../../research/pi-mono-coding-agent/README.md](../../research/pi-mono-coding-agent/README.md) 说明 `pi-mono` 可以作为本层的 engineering reference，但不能作为 Lime 的新产品形态。

### 8.1 可借鉴

1. `AgentSession / AgentSessionRuntime / services` 分层。
2. `read-only tools` 与 `coding tools` 分级。
3. `noTools / tools allowlist / customTools` 的工具面裁剪。
4. `BashOperations / EditOperations` 可插拔后端。
5. agent / turn / message / tool / session lifecycle events。
6. faux provider + deterministic harness 测试。

### 8.2 不可照搬

1. 不新增 `coding_agent_runtime`。
2. 不把 JSONL session 变成 Lime 第二事实源。
3. 不开放全仓库 `bash / write / edit` 给 draft 生成任务。
4. 不让 pi-style extension runtime 替代 Lime governance / evidence。
5. 不把终端命令系统搬进 Lime 前台。

### 8.3 P1A 工具面修正

因此 P1A 不应被设计成完整 Coding Agent，而应设计成受控的 **Capability Authoring Agent**：

| 工具档位 | P1A 策略 | 说明 |
| --- | --- | --- |
| `author_readonly` | 开放 | 读 docs、source refs、CLI help、OpenAPI、本地代码片段 |
| `author_draft_write` | 开放但强限制 | 只写 draft root 内 `SKILL.md / manifest / scripts / examples / tests` |
| `author_dryrun` | 有限开放 | 只运行 fixture / dry-run，不允许外部写操作 |
| `author_full_shell` | P1A 禁止，后续需升级授权 | 不允许未验证阶段任意 bash、依赖安装、任意网络访问 |
| `author_external_write` | P1A 禁止，后续需升级授权 | 不允许未验证阶段发布、下单、改价、发消息 |

固定判断：

**Lime 这层弱，不代表要补成通用 Coding Agent；先补成可治理的 capability authoring 子集。**

## 9. 首期实现切片建议

如果现在要开始实现 Skill Forge 方向，第一刀不应该是自动续跑，而应该是：

**P1A：Coding Agent 生成 workspace-local skill draft 的最小闭环。**

最小范围：

1. 对话中声明 `capability_generation` metadata。
2. 让 agent 为只读 CLI 生成 draft 文件清单。
3. draft 至少包含 `SKILL.md`、wrapper、input/output contract、fixture test、permission summary。
4. Workspace 显示 draft 为 `unverified`。
5. draft 不进入默认 tool surface。

不做：

1. 不注册 skill。
2. 不执行可调度任务。
3. 不自动续跑。
4. 不做外部写操作。

验收：

1. 用户能看到 Coding Agent 生成了哪些文件。
2. 用户能看到来源、权限和未验证状态。
3. 未验证 draft 不能被 Query Loop 当作可用 skill 调用。
4. 后续 P2 verification gate 可以直接消费该 draft。

## 10. current / deprecated / dead 边界

### current

1. Coding Agent 作为 `agent turn` 的一种任务模式。
2. Skill Forge 作为 draft / verification / registration 产品层。
3. Agent Skill Bundle / Adapter Spec 作为生成目标。
4. Verification Gate 作为注册门禁。
5. Workspace-local skill catalog 作为注册投影。
6. Agent envelope 作为 Workspace 产品组合面，消费 verified skill、memory、schedule、permission 和 evidence。

### deprecated

1. 只写 prompt 让 agent “自己生成工具”，但没有 draft / gate / registration 状态。
2. 把 generated script 直接加入 tool surface。
3. 把 Coding Agent 写成独立 runtime。
4. 把外部 API schema 直接变成 Lime runtime 协议。

### dead

1. `coding_agent_runtime`。
2. `generated_tool_registry`。
3. `unverified_skill_executor`。
4. `direct_script_automation`。

## 11. 实现前检查清单

进入代码实现前，至少确认：

1. 首期目标是不是 P1A draft 生成，而不是 P4 自动执行。
2. draft 文件结构是否已和 `skill-standard.md` 对齐。
3. 生成动作是否仍走 Query Loop。
4. 未验证 draft 是否有明确隔离。
5. Workspace 是否只展示 draft，不把它当可执行 skill。
6. 后续 verification gate 的输入是否已预留，但没有过度实现。

一句话：

**先让 Coding Agent 会安全地产生能力，再让系统通过 tool_runtime 安全地运行能力，最后把成功任务固化为可 rerun Agent。**
