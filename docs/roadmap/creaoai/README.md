# Lime CreoAI 对照开发路线图

> 状态：P3A 已落地；P3B discovery 正在推进；P4 继续按 proposal 推进  
> 更新时间：2026-05-05  
> 目标：把 CreoAI 案例里的 “Coding Agent 编码 CLI / API / tools 并长期运行业务” 收敛成 Lime 可执行路线图，补强 skills pipeline 的生成、验证、注册和长期执行闭环。

配套研究：

- [../../research/creaoai/README.md](../../research/creaoai/README.md)
- [../../research/creaoai/architecture-breakdown.md](../../research/creaoai/architecture-breakdown.md)
- [../../research/creaoai/tool-coding-orchestration.md](../../research/creaoai/tool-coding-orchestration.md)
- [../../research/creaoai/lime-gap-analysis.md](../../research/creaoai/lime-gap-analysis.md)
- [../../research/pi-mono-coding-agent/README.md](../../research/pi-mono-coding-agent/README.md)
- [../../research/codex-goal/README.md](../../research/codex-goal/README.md)

配套图纸：

- [./diagrams.md](./diagrams.md)
- [./prototype.md](./prototype.md)
- [./coding-agent-layer.md](./coding-agent-layer.md)
- [./architecture-review.md](./architecture-review.md)

相关路线图：

- [../managed-objective/README.md](../managed-objective/README.md)：把 Codex `/goal` 的 thread goal loop 启发收敛为 Lime 的跨 turn 目标推进控制层。
- [../ai-layered-design/README.md](../ai-layered-design/README.md)：AI 图层化设计路线图；它是 generated adapter 的潜在消费方，但 `LayeredDesignDocument`、Canvas Editor 和设计工程协议不归 Skill Forge 定义。

## 0. 当前落地状态

截至 2026-05-05，CreoAI 路线已经完成到 **P3A：workspace-local file registration**，并开始推进 **P3B：workspace catalog discovery**：

1. `Capability Draft` 已支持 create / list / get / verify / register 命令链。
2. verification gate 通过后，draft 才能进入 `verified_pending_registration`。
3. `capability_draft_register` 只复制标准合规草案到当前 workspace 的 `.agents/skills/<skill_directory>/`，并记录来源、verification report 与权限摘要。
4. Skills 工作台只展示草案、验证与注册结果；注册后仍没有“立即运行 / 自动化”入口。
5. P3B 第一刀固定为 registered skill discovery：显式 `workspaceRoot` 扫描 `.agents/skills`，只投影带 `.lime/registration.json` 的 P3A 注册能力。
6. P3B 后续仍待实现：runtime binding、Query Loop 可见性和 `tool_runtime` 授权。

## 1. 先给结论

Lime 不应该另做一个 CreoAI 式平行工具生成系统。

Lime 应该做的是：

**让 Coding Agent 把 API、CLI、网页流程生成并编译成 Lime 标准 Skill / Adapter，再由现有 Query Loop、tool_runtime、Workspace 和 evidence pack 受控执行。**

一句话北极星：

**Lime 的 skills pipeline 从“安装和调用技能”升级为“生成、编译、验证、注册并长期运行技能”。**

## 2. 权限宗旨

CreoAI 路线的核心不是“无限放权”，而是：

**权限永远显式受控，能力逐级开放；限制的是未经验证、未经授权、不可审计的执行，不是限制 agent 的理解、设计和编码能力。**

固定原则：

1. Coding Agent 可以大胆理解需求、读文档、设计 adapter、写 draft、修 self-check。
2. 系统必须管住它真实执行什么、写到哪里、能不能注册、能不能长期跑。
3. P1A 默认限制 `bash / install / external write`，是为了控制第一阶段 blast radius，不代表长期永远低权限。
4. 后续只能通过 sandbox、verification gate、permission policy、用户确认和 evidence audit 逐级放开。
5. 任何外部写操作、花钱、发布、删除、改价、下单，都不能只靠模型自述安全，必须有结构化授权和可回放证据。

推荐长期分级：

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

## 3. 固定主链

后续所有实现必须收敛到下面这条主链：

```text
用户目标
  -> Coding Agent / Skill Forge 识别能力缺口
  -> Coding Agent 探索 API / CLI / docs / website
  -> 生成 capability draft：Skill / Adapter / Script / Contract / Test
  -> verification gate 校验 contract / permission / dry-run / tests
  -> 注册到 workspace-local skill catalog / ServiceSkill 投影
  -> agent_runtime_submit_turn / tool_runtime 统一执行
  -> Managed Objective 判断是否继续、阻塞或完成
  -> automation job / subagent 长期运行
  -> artifact / evidence pack / Workspace UI 统一展示
```

这条主链意味着：

1. `Coding Agent` 是能力作者，负责探索外部能力并写 adapter / contract / test。
2. `Skill Forge` 是生成、draft、验证、注册的产品和工程边界，不是执行系统。
3. `Generated Capability` 只是 draft 态，不是长期 runtime 主类型。
4. 注册后必须回到现有 Skill / ServiceSkill / Adapter / tool runtime 标准。
5. `Managed Objective` 只做目标推进控制，不是第四类执行实体。
6. 长期任务必须复用 runtime queue、automation、subagent、evidence，不新增旁路。

## 4. 非目标

本路线图明确不做：

1. 不复制电商运营垂类产品。
2. 不新增平行 generated tools runtime。
3. 不绕过 Agent Skills 包标准。
4. 不让 agent 生成代码后直接长期执行。
5. 不新增独立 scheduler、queue、artifact、evidence 系统。
6. 不把外部 API / CLI 原始协议直接升格为 Lime 运行时协议。
7. 不在首期承诺高风险外部写操作全自动执行。
8. 不把 Codex `/goal` 照搬成 Lime 的平行 goal runtime。

## 5. 产品对象分层

### 4.0 Coding Agent / Agent Builder

`Coding Agent` 是 CreoAI 启发里最核心的一层，负责把用户讲清楚的业务目标变成可验证的能力草案。详细设计见 [./coding-agent-layer.md](./coding-agent-layer.md)。

本层可以参考 [../../research/pi-mono-coding-agent/README.md](../../research/pi-mono-coding-agent/README.md) 中对 `pi-mono` 的调研，但只参考 coding harness 的工程切面：会话分层、工具 allowlist、可插拔工具后端、事件生命周期和 deterministic test harness。Lime 不引入 pi-style 终端产品、JSONL session 事实源或全仓库 shell/write 权限。

它必须完成：

1. 理解用户目标、成功标准和风险边界。
2. 探索 API、CLI、docs、website、MCP 或本地代码入口。
3. 生成 adapter、wrapper、script、contract、permission summary 和 fixture test。
4. 根据 verification gate 的失败项修复 draft。
5. 通过验证后提交注册，而不是直接长期执行。

固定边界：

**Coding Agent 是 build-time capability author，不是新的 runtime，也不是 Managed Objective。**

### 4.1 Skill Forge

`Skill Forge` 是上游生成阶段，负责：

1. 从用户目标中识别能力缺口。
2. 探索 API / CLI / docs / website。
3. 生成 Skill Bundle、Adapter Spec、script、contract、test 草案。
4. 触发 verification gate。
5. 通过后提交注册。

固定边界：

**Skill Forge 不执行长期任务，不定义新的 runtime。**

### 4.2 Generated Capability Draft

`Generated Capability Draft` 是生成中间态，至少包含：

1. 用户目标摘要。
2. 来源能力说明。
3. 生成文件清单。
4. 输入输出 contract。
5. 权限声明。
6. 验证状态。
7. 注册目标。

固定边界：

**Draft 不能被当作 current tool 使用；验证和注册通过后，才投影为 Lime 标准对象。**

### 4.3 Workspace-local Skill

通过验证后的能力应落成 workspace-local skill：

1. 遵守 Agent Skills 包结构。
2. 可被 Skill Catalog / ServiceSkillCatalog 投影。
3. 可被 Query Loop 发现和调用。
4. 可被 workspace UI 展示来源、权限、最近运行和证据。

### 4.4 Runtime Binding

执行绑定继续使用现有语义：

1. `agent_turn`
2. `browser_assist`
3. `automation_job`
4. `native_skill`

后续如果需要站点采集能力，先编译为 `SiteAdapterSpec`，再通过现有浏览器 runtime 执行。

### 4.5 Managed Objective

`Managed Objective` 是目标推进控制层，参考 [Codex `/goal` 研究](../../research/codex-goal/README.md)，负责：

1. 保存当前 managed skill / automation job 的目标和成功标准。
2. 判断是否需要继续下一轮 agent turn。
3. 在缺输入、阻塞、预算耗尽、完成或失败时停止自动续跑。
4. 要求 completion audit 消费 artifact / evidence，而不是只靠模型自报。

固定边界：

**Managed Objective 必须挂到 `agent turn / subagent turn / automation job` 之一，不允许成为新的 runtime taxonomy。**

详细架构、状态机和实施阶段独立维护在 [../managed-objective/README.md](../managed-objective/README.md)。本路线图只描述它与 Skill Forge / generated skill 的衔接关系。

## 6. 分阶段路线

### P0：文档与边界收口

目标：固定研究、路线图、术语和禁止项。

交付：

1. `docs/research/creaoai/` 研究拆解。
2. `docs/roadmap/creaoai/` 开发计划。
3. 明确 `Skill Forge` 不新增 runtime。
4. 明确 generated capability 必须进入 Skill / Adapter 标准。

验收：

1. 文档能解释三层架构。
2. 文档能解释和现有 skills pipeline 不冲突。
3. 文档明确 current / deprecated / dead 边界。

### P1：workspace-local skill scaffold

目标：让 agent 可以为一个明确目标生成 workspace-local skill 草案。

范围：

1. 生成 `SKILL.md`。
2. 生成 `metadata` 或等价 manifest 草案。
3. 生成 `scripts/`、`examples/`、`tests/` 的最小结构。
4. 在 Workspace 中展示 draft 状态。

验收：

1. 用户能从对话请求创建本地 skill draft。
2. draft 清楚标注来源、目标、权限、验证状态。
3. 未验证 draft 不会进入默认 tool surface。

### P2：verification gate

目标：注册前必须通过结构化校验。

最小 gate：

1. 包结构校验。
2. 输入输出 contract 校验。
3. 权限声明校验。
4. dry-run 或 fixture test。
5. 高风险权限人工确认。

验收：

1. 缺少 contract 的 draft 不能注册。
2. 未声明联网、写文件、外部写操作的 draft 不能注册。
3. 测试失败的 draft 只能保留为 draft。
4. verification 结果能进入 evidence 或等价运行记录。

### P3：registration / runtime binding

目标：通过验证的 workspace-local skill 先完成可审计注册，再进入现有 catalog 与 tool runtime。

范围：

1. P3A：复制为 `<workspaceRoot>/.agents/skills/<skill_directory>/`，并记录来源、verification report 与权限摘要。
2. P3B：注册为 Skill Catalog / ServiceSkillCatalog 可发现项。
3. P3B：由 Query Loop 注入相关 metadata。
4. P3B：由 `tool_runtime` 统一裁剪和授权。
5. P3B / P4：调用记录写入 timeline 与 artifact。

验收：

1. P3A 注册后的 skill 包只在当前 workspace 本地落盘，不修改全局 seeded skill。
2. P3A 不触发运行、自动化或外部写操作。
3. P3B 注册后的 skill 可在后续 agent turn 中被发现和使用。
4. tool surface 仍由现有 runtime 控制。
5. evidence pack 能追踪 skill 来源、版本、调用结果。

### P4：managed execution

目标：让验证后的 generated skill 可进入 scheduled / managed 任务。

范围：

1. 绑定 `automation_job` 或 subagent team。
2. 支持暂停、恢复、阻塞、人工输入。
3. 任务产物进入 workspace artifact。
4. 长期执行事实进入 evidence pack。

验收：

1. 用户关掉窗口后，任务仍能通过 runtime 状态恢复或明确阻塞。
2. 任务失败时能看到失败步骤、原因和下一步。
3. 高风险外部写操作默认要求确认。
4. Workspace 能展示最近运行、下次运行、证据入口。

## 7. 最小可交付场景

首个场景不选电商全链路，避免范围失控。

推荐首个场景：

**给一个只读 CLI 或公开 API 生成 workspace-local skill，并定时产出 Markdown 报告。**

示例任务：

```text
每天上午 9 点读取某个公开数据源或本地 CLI 输出，生成一份趋势摘要，保存到 workspace，并在失败时提示我补配置。
```

选择理由：

1. 只读，风险低。
2. 能覆盖 CLI / API adapter 生成。
3. 能覆盖 contract、dry-run、注册、artifact、evidence。
4. 后续可自然扩展到网页、登录态和外部写操作。

## 8. 与 AI 图层化设计的关系

AI 图层化设计不是 Skill Forge 的子阶段。

固定边界：

1. `LayeredDesignDocument`、Canvas Editor、Layer Planner、设计项目导出，归 [../ai-layered-design/README.md](../ai-layered-design/README.md)。
2. Skill Forge 只负责生成和验证可复用能力，例如 provider adapter、PSD exporter wrapper、OCR / matting tool wrapper。
3. 通过验证后的 adapter 必须进入 workspace-local skill / ServiceSkill / tool_runtime 主链。
4. AI 图层化设计可以消费这些 verified adapter，但不能让它们反向定义设计文档协议。
5. 不为 AI 图层化设计新增平行 generated tools runtime。

## 9. 这一步与现有主线的关系

本路线图服务以下现有主线：

1. `skill-standard.md`：补上自动生成和编译阶段。
2. `query-loop.md`：所有执行继续走统一 submit turn 和 tool runtime。
3. `harness-engine-governance.md`：自动执行必须导出证据。
4. `remote-runtime.md`：未来远程触发只接入 current ingress，不自建 remote runtime。
5. `task/README.md`：generated skill 的任务画像、模型路由和成本限额仍归 runtime 底层。

一句话：

**这不是新产品旁路，而是把 Lime 现有 agent runtime 从“能用工具”推进到“能生产并治理工具”。**
