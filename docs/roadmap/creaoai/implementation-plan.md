# CreoAI 启发下的 Lime 实施计划

> 状态：P3A 已落地；P3B discovery 正在推进；P4 继续按 proposal 推进  
> 更新时间：2026-05-05  
> 目标：把 Skill Forge / workspace-local generated skill 的落地拆成可执行阶段，确保实现不偏离 Lime current 主链。

依赖文档：

- [./README.md](./README.md)
- [./coding-agent-layer.md](./coding-agent-layer.md)
- [./architecture-review.md](./architecture-review.md)
- [./diagrams.md](./diagrams.md)
- [./prototype.md](./prototype.md)
- [../managed-objective/README.md](../managed-objective/README.md)

## 0. 当前实现进度

截至 2026-05-05，本计划已经完成到 **P3A：workspace-local file registration**，并开始推进 **P3B：workspace catalog discovery**：

1. P1A / P2 的最小文件事实源、静态 verification gate 和状态机已经落地。
2. P3A 已新增 `capability_draft_register`：只允许 `verified_pending_registration`，注册前复核 manifest 文件完整性与 Agent Skills 标准。
3. 注册结果只落到当前 workspace 的 `.agents/skills/<skill_directory>/`，并写入 draft 侧 `registration/latest.json` 与 registered skill 侧 `.lime/registration.json`。
4. 前端 Skills 工作台已经展示注册按钮与注册摘要，但仍不展示运行、自动化或外部写入口。
5. P3B 第一刀是 workspace-local registered skill discovery：显式传入 `workspaceRoot`，扫描当前项目 `.agents/skills`，只返回带 `.lime/registration.json` 的 P3A 注册能力。
6. P3B 后续仍要解决 SkillService root、runtime session、Query Loop metadata 与 `tool_runtime` surface 的一致性。

## 1. 实施总原则

1. **标准优先**
   - 生成能力必须编译为 Agent Skill Bundle / Adapter Spec / ServiceSkill 投影。

2. **验证先于注册**
   - 未通过 verification gate 的能力只能是 draft，不能进入默认 tool surface。

3. **执行回到主链**
   - 所有运行必须走 Query Loop、tool_runtime、runtime queue、artifact、evidence pack。

4. **权限显式**
   - 联网、写文件、外部写操作、花钱、发布、删除必须有结构化权限声明。

5. **能力逐级开放**
   - 首期限制的是未验证、未授权、不可审计的执行；后续可以通过 sandbox、verification gate、permission policy、用户确认和 evidence audit 逐级放开。

6. **先低风险闭环**
   - 首期只做只读 CLI / API / 文件输出，不做外部发布、下单、改价。

权限分级口径固定为：

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

## 2. P0：文档和术语落盘

目标：让后续实现有稳定边界。

任务：

1. 新增 `docs/research/creaoai/` 研究拆解。
2. 新增 `docs/roadmap/creaoai/` 路线图、实施计划和图纸。
3. 在文档中固定：`Skill Forge` 是生成阶段，不是 runtime。
4. 在文档中固定：`Generated Capability Draft` 不是长期主类型。

完成标准：

1. 文档能明确回答“是否和 skills pipeline 冲突”。
2. 文档能明确禁止 generated tools 平行 runtime。
3. 文档能给出 P1-P4 的实现顺序。

## 2.5 P0.5：实现前架构补强

目标：进入代码前，先补齐 [./architecture-review.md](./architecture-review.md) 指出的硬边界，避免 P1A 变成不可治理的“生成脚本”。

任务：

1. 固定 draft store 文件结构。
2. 固定 draft manifest schema。
3. 固定 verification gate 最小检查矩阵。
4. 固定 Workspace draft 状态机。
5. 固定 generation / verification / registration 的 evidence 事件命名。
6. 固定 Capability Authoring Agent 的工具 profile：`author_readonly / author_draft_write / author_dryrun`。
7. 参考 [../../research/pi-mono-coding-agent/README.md](../../research/pi-mono-coding-agent/README.md)，明确 `author_full_shell / author_external_write` 在 P1A 默认不开放，后续只能通过升级授权放开。

完成标准：

1. 能回答 draft 放在哪里。
2. 能回答 unverified draft 如何隔离。
3. 能回答 permission summary 如何和实际行为校验。
4. 能回答 draft 如何进入后续 verification gate。
5. 能回答 Coding Agent 的每类工具权限来自哪个 backend、如何被测试。

## 3. P1：Coding Agent 生成 Skill draft scaffold

目标：支持 Coding Agent 从对话生成 workspace-local skill 草案。首期先证明“AI 能安全地产生能力”，不直接进入长期自动执行。

### 3.0 为什么 P1 必须先做 Coding Agent

CreoAI 启发的核心不是已有工具多跑几轮，而是 Coding Agent 能把 CLI / API / docs / website 编译为可复用能力。

因此 P1 的最小实现对象应是：

```text
用户目标
  -> Coding Agent capability_generation turn
  -> Generated Capability Draft
  -> Workspace draft review
```

不是：

```text
用户目标
  -> Managed Objective
  -> 自动续跑
```

固定边界：

**Managed Objective 可以在 P3.5 / P4 接入，但不能替代 P1 的 Coding Agent 生成层。**

### 3.1 用户流

```text
用户：帮我把这个 CLI 包装成每天生成报告的技能
  -> agent 询问缺失输入
  -> agent 生成 skill draft
  -> workspace 展示草案、文件、权限、验证状态
```

### 3.2 Draft 最小内容

Draft 至少包含：

1. `SKILL.md`
   - 触发条件。
   - 任务说明。
   - 依赖和 setup。
   - 使用示例。
   - gotchas。

2. `metadata` 或等价 manifest
   - `name`
   - `description`
   - `source_kind`
   - `permission_summary`
   - `runtime_binding_target`
   - `verification_status`

3. `scripts/`
   - 最小 adapter 或 wrapper。
   - 禁止把业务状态机写死在单个脚本里。

4. `examples/`
   - 最小输入样例。
   - 期望输出样例。

5. `tests/`
   - fixture 或 dry-run 测试。

### 3.3 产品要求

1. Draft 必须清楚标注“未验证”。
2. Draft 默认不进入全局 skill catalog。
3. Draft 默认不可被自动任务调用。
4. 用户可以查看生成文件和权限声明。

完成标准：

1. 一个只读 CLI 能被生成成 skill draft。
2. draft 能在 workspace 中被发现。
3. 未验证 draft 不会出现在默认可调用工具面。

### 3.4 Capability Authoring Agent 工具面

P1 不做完整独立 Coding Agent。首期只做受控的 `Capability Authoring Agent`，工具面参考 [../../research/pi-mono-coding-agent/README.md](../../research/pi-mono-coding-agent/README.md) 的 read-only / coding tools 分级，但默认更保守：

| 工具档位 | 首期用途 | 状态 |
| --- | --- | --- |
| `author_readonly` | 读取 source refs、CLI help、OpenAPI、workspace docs | 必须支持 |
| `author_draft_write` | 写 draft root 内文件与 manifest | 必须支持 |
| `author_dryrun` | 执行 fixture / dry-run self-check | 可以最小支持 |
| `author_full_shell` | 任意 bash / install / 访问本机项目 | P1 禁止，后续需 sandbox + 升级授权 |
| `author_external_write` | 发布、下单、改价、发消息 | P1 禁止，后续需人工确认或策略批准 |

最小验收：

1. draft 文件路径逃逸会失败。
2. 未声明网络或写操作的 self-check 会失败。
3. CLI 探索只允许 allowlist 命令或 dry-run。
4. 生成失败和 self-check 失败都要进入 draft 状态，而不是静默重试。

## 4. P2：Verification gate

目标：把 generated skill 从“文件草案”变成“可注册能力”。

### 4.1 Gate 输入

1. Skill bundle 路径。
2. 目标 runtime binding。
3. 权限声明。
4. 输入输出 contract。
5. 测试或 dry-run 配置。

### 4.2 Gate 检查

最小检查：

1. 包结构存在且可解析。
2. `name / description / setup / examples` 足够完整。
3. 输入 contract 存在。
4. 输出 contract 存在。
5. 权限声明覆盖脚本行为。
6. dry-run 或 fixture test 通过。
7. 高风险权限需要人工确认。

### 4.3 Gate 输出

输出状态：

1. `draft`
2. `verification_failed`
3. `verified_pending_registration`
4. `registered`

失败结果必须包含：

1. 失败检查项。
2. 修复建议。
3. 是否可以让 agent 尝试修复。

完成标准：

1. 缺 contract 的 skill 无法注册。
2. 测试失败的 skill 无法注册。
3. 权限声明和实际行为不一致时无法注册。
4. 通过验证的结果能被 evidence / runtime 事实链消费。

## 5. P3：Catalog registration

目标：让通过验证的 skill 进入现有发现与调用主链。

实现拆分：

1. **P3A：workspace-local file registration**
   - 只把 `verified_pending_registration` 草案复制为 `<workspaceRoot>/.agents/skills/<skill_directory>/`。
   - 记录来源、verification report、权限摘要和目标目录。
   - 不触发 Skill reload，不接运行，不接 automation。

2. **P3B：workspace catalog discovery / runtime binding**
   - 解决 workspace 选择、进程 cwd、SkillService root 与 runtime session 的一致性。
   - 将 workspace-local skill 投影到 Skill Catalog / ServiceSkillCatalog。
   - 通过 Query Loop 和 `tool_runtime` 决定工具可见性。

### 5.1 注册位置

注册后的能力应投影到：

1. workspace-local skill catalog。
2. Skill Catalog / ServiceSkillCatalog 可发现对象。
3. Query Loop 的 skill launch metadata。
4. tool_runtime 可裁剪的 tool surface。

### 5.2 注册规则

1. 只注册 `verified_pending_registration` 状态的 draft。
2. 注册必须记录来源、版本、校验摘要和权限摘要。
3. 注册不应修改全局 seeded skill。
4. workspace-local skill 只在当前 workspace 默认可见。

### 5.3 执行规则

1. 执行必须走现有 `agent_runtime_submit_turn`。
2. 工具可见性必须由 `tool_runtime` 决定。
3. 运行产物必须进入 artifact / timeline。
4. evidence pack 必须能追踪 skill 来源与调用结果。

完成标准：

1. 注册后的 skill 能在后续对话中被发现。
2. 注册后的 skill 能被当前 workspace 调用。
3. 其他 workspace 不会默认获得该 skill。
4. evidence pack 能看到注册来源和运行事实。

## 6. P3.5：Managed Objective 边界

目标：在进入长期任务前，先固定“目标推进控制层”不是新的 runtime。

参考研究：

- [../../research/codex-goal/README.md](../../research/codex-goal/README.md)
- [../managed-objective/README.md](../managed-objective/README.md)
- [./coding-agent-layer.md](./coding-agent-layer.md)
- [./architecture-review.md](./architecture-review.md)

### 6.1 固定定义

`Managed Objective` 只回答：

1. 这个 managed skill / automation job 要完成什么目标。
2. 当前是否还需要继续下一轮 agent turn。
3. 当前是完成、暂停、缺输入、阻塞、预算耗尽还是失败。
4. 完成审计应消费哪些 artifact / evidence。

它不回答：

1. skill 如何生成。
2. adapter 如何编译。
3. 工具如何注册。
4. 后台任务如何调度。
5. evidence 如何导出。

固定边界：

**Managed Objective 是挂在 `agent session / automation job` 上的控制层，不是第四类执行实体。**

详细状态机、audit contract、automation owner binding 和自动续跑策略不在本文件展开，统一以 [../managed-objective/architecture.md](../managed-objective/architecture.md) 与 [../managed-objective/implementation-plan.md](../managed-objective/implementation-plan.md) 为准。

### 6.2 与现有主链关系

```text
workspace-local skill
  -> automation job / agent session
  -> managed objective state
  -> Query Loop agent turn
  -> artifact / evidence pack
  -> completion audit
  -> continue / needs_input / blocked / complete
```

实现时必须遵守：

1. durable 后台承载继续走 `automation job`。
2. 每轮模型执行继续走 `agent_runtime_submit_turn`。
3. 工具可见性继续由 `tool_runtime` 决定。
4. 完成审计必须引用 evidence pack 或等价 runtime facts。
5. 用户输入、暂停、预算限制优先于自动续跑。

### 6.3 P4 前置完成标准

进入 P4 前，文档和设计必须能回答：

1. Managed Objective 绑定到哪个 `automation_job` 或 `agent session`。
2. 下一轮 continuation turn 由谁触发。
3. 哪些状态会阻止自动续跑。
4. 完成审计读取哪些 evidence / artifact。
5. 哪些场景必须进入 `needs_input / blocked` 而不是继续自动跑。

## 7. P4：Managed execution

目标：把 verified skill 绑定到长期任务。

### 7.1 任务形态

首期支持：

1. 手动运行。
2. 定时运行。
3. 失败后等待用户输入。
4. 用户暂停和恢复。

暂不支持：

1. 自动发布到外部平台。
2. 自动付款、下单、改价。
3. 跨 workspace 共享 generated skill。
4. 未确认的外部写操作。

### 7.2 状态要求

长期任务至少使用以下状态：

```text
planned
running
needs_input
blocked
verifying
completed
failed
paused
```

其中：

1. `planned / running / paused / failed` 属于任务执行生命周期。
2. `needs_input / blocked / verifying / completed` 必须能回到 Managed Objective 的完成审计语义。
3. `completed` 不能只由模型自报，必须有 artifact / evidence / verification 支撑。

### 7.3 Workspace 展示

Workspace 应展示：

1. 任务名称和绑定 skill。
2. 最近运行状态。
3. 下次运行时间。
4. 当前阻塞原因。
5. 最近产物。
6. evidence 入口。
7. 暂停、恢复、重新验证操作。

完成标准：

1. 定时任务能运行一个 verified read-only skill。
2. app 重启后任务状态可恢复或明确标记阻塞。
3. 失败时用户能看到失败步骤和下一步。
4. evidence pack 能导出长期运行事实。

## 8. 最小验收场景

### 场景：只读 CLI 每日报告

用户输入：

```text
把这个只读 CLI 包装成一个技能：每天 9 点运行，生成 Markdown 趋势摘要，保存到当前 workspace。失败时不要重试超过 2 次，提示我检查配置。
```

系统应完成：

1. 生成 skill draft。
2. 生成 wrapper script、示例和 fixture test。
3. 通过 verification gate。
4. 注册为 workspace-local skill。
5. 手动运行一次。
6. 创建 scheduled managed job。
7. 为该 job 绑定 Managed Objective，记录目标、成功标准和预算。
8. 产出 Markdown artifact。
9. evidence pack 可看到调用、产物、验证事实和 completion audit 输入。

不要求：

1. 发布到外部平台。
2. 操作浏览器登录态。
3. 连接付费 API。
4. 跨 workspace 共享。

## 9. 验证策略

### 9.1 P1 文档与 scaffold

最小验证：

1. skill draft 文件结构快照测试。
2. draft 状态不会进入默认 catalog 的单测。
3. workspace 展示 draft 状态的组件测试。

### 9.2 P2 gate

最小验证：

1. contract 缺失失败。
2. 权限缺失失败。
3. dry-run 失败阻断注册。
4. dry-run 通过允许进入 pending registration。

### 9.3 P3 registration

最小验证：

1. workspace-local catalog 只包含当前 workspace 注册项。
2. Query Loop 能发现注册 skill。
3. tool_runtime 仍能裁剪工具面。
4. evidence pack 包含 skill source metadata。

### 9.4 P4 managed execution

最小验证：

1. 定时任务状态机单测。
2. 失败后 `needs_input / blocked` 行为测试。
3. artifact 写入测试。
4. evidence pack 导出测试。
5. GUI 最小 smoke：创建、运行、查看证据。

## 10. 实现守卫

实现时必须守住以下约束：

1. 不新增 `GeneratedTool` 作为长期主类型。
2. 不新增独立 generated tool registry。
3. 不新增独立 queue / scheduler / evidence。
4. 不允许未验证 draft 进入默认 tool surface。
5. 不允许外部写操作在无人工确认时自动执行。
6. 不允许 adapter 直接成为前台产品入口。
7. 不允许来源 API / CLI schema 反向定义 Lime runtime 协议。
8. 不允许 Managed Objective 成为 `agent turn / subagent turn / automation job` 之外的第四类执行实体。
9. 不允许 generated capability 反向定义领域文档协议，例如 `LayeredDesignDocument`。
10. 不允许把 AI 图层化设计的 Canvas / document / export 主链搬进 Skill Forge runtime。

## 11. 后续扩展顺序

完成只读 CLI 每日报告后，再按以下顺序扩展：

1. 只读 HTTP API adapter。
2. 只读网页采集 SiteAdapterSpec。
3. 需要登录态但只读的浏览器流程。
4. 外部写操作 draft，但默认只 dry-run。
5. 人工确认后的外部写操作。
6. 多 skill managed workflow。
7. 领域型 adapter 生成，例如图片 provider adapter、PSD exporter、OCR / matting wrapper；这些只能作为 AI 图层化设计的辅助能力，不接管 `LayeredDesignDocument` 或 Canvas Editor。

一句话：

**先证明“生成能力可以被治理”，再扩大“能力可以做什么”。**
