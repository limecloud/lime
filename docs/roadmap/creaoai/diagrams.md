# CreoAI 启发下的 Lime 架构图与流程图

> 状态：proposal  
> 更新时间：2026-05-05  
> 作用：把 Skill Forge、generated capability、skills pipeline、runtime execution 和 evidence 闭环画成可复查图纸。

配套原型：

- [prototype.md](./prototype.md)

本文负责架构图、流程图、时序图和边界图；产品低保真原型统一放在 `prototype.md`。

## 1. 三层架构对照图

```mermaid
flowchart TB
    User[用户目标 / 约束 / 成功标准] --> CodingAgent[Coding Agent / Agent Builder<br/>探索 API / CLI / docs / website]
    CodingAgent --> Forge[Skill Forge<br/>Draft / Gate / Registration 边界]
    Forge --> Capability[Generated Capability Draft<br/>Skill / Adapter / Script / Contract / Test]
    Capability --> Verify[Verification Gate<br/>schema / permission / dry-run / tests]
    Verify --> Registry[Workspace-local Skill Registry<br/>Skill Catalog / ServiceSkill 投影]
    Registry --> Objective[Managed Objective<br/>目标 / 成功标准 / 续跑策略]
    Objective --> Runtime[Autonomous Execution<br/>Query Loop / tool_runtime / automation / subagent]
    Runtime --> Workspace[Workspace / Agent App Surface<br/>artifact / task / memory / evidence]
    Workspace --> User
    Workspace --> Forge
```

固定判断：

1. `Skill Forge` 是生成阶段，不是 runtime。
2. `Generated Capability Draft` 验证前不能进入默认工具面。
3. `Managed Objective` 只做目标推进控制，不是第四类 runtime。
4. 真实执行必须回到 Lime current runtime。

## 1.1 Coding Agent 内部循环图

```mermaid
flowchart LR
    Clarify[clarify
目标 / 成功标准 / 风险] --> Discover[discover
API / CLI / docs / website]
    Discover --> Design[design
Skill / Adapter / Contract]
    Design --> Generate[generate
wrapper / script / tests]
    Generate --> SelfCheck[self-check
schema / dry-run]
    SelfCheck --> Gate[verification gate]
    Gate -->|失败| Repair[repair draft]
    Repair --> SelfCheck
    Gate -->|通过| Register[workspace-local registration]
```

固定判断：

1. Coding Agent 是能力作者，不是长期执行器。
2. 每一步仍必须通过 Query Loop / tool_runtime 的受控能力完成。
3. Gate 通过前，draft 不能进入默认 tool surface。

## 1.2 Capability Authoring 工具面分级图

```mermaid
flowchart TB
    Agent[Capability Authoring Agent] --> ReadOnly[author_readonly<br/>docs / source refs / CLI help]
    Agent --> DraftWrite[author_draft_write<br/>draft root scoped write / patch]
    Agent --> DryRun[author_dryrun<br/>fixture / static scan / dry-run]

    ReadOnly --> Draft[Generated Capability Draft]
    DraftWrite --> Draft
    DryRun --> SelfCheck[Self-check Result]
    SelfCheck --> Draft

    Agent -.P1A 禁止<br/>后续升级授权.-> FullShell[author_full_shell<br/>任意 bash / install]
    Agent -.P1A 禁止<br/>后续升级授权.-> ExternalWrite[author_external_write<br/>发布 / 下单 / 改价]
```

固定判断：

1. 参考 pi-mono 的工具分级，但 P1A 比通用 coding harness 更保守。
2. `author_draft_write` 只能写 draft root，不能写 workspace 任意文件。
3. `author_dryrun` 只能产生 self-check 事实，不能长期执行任务。
4. 完整 shell 和外部写操作不是永远禁止，但必须等 sandbox / verification / permission / 人工确认 / evidence audit 闭环成熟后逐级开放。
5. 限制的是未经验证、未经授权、不可审计的执行，不是限制 agent 的理解、设计和编码能力。

## 2. 外部能力编译流程图

```mermaid
flowchart LR
    Source[Capability Source<br/>API / CLI / Docs / Website / MCP] --> Explore[Agent 探索能力]
    Explore --> Adapter[生成 adapter / wrapper / script]
    Adapter --> Contract[生成 input / output contract]
    Contract --> Permission[生成 permission summary]
    Permission --> Tests[生成 examples / fixture / dry-run]
    Tests --> Bundle[编译为 Skill Bundle / Adapter Spec]
    Bundle --> Gate[Verification Gate]
    Gate -->|通过| Register[注册 workspace-local skill]
    Gate -->|失败| Draft[保留 draft 并给出修复建议]
```

固定判断：

1. 来源格式只提供原料。
2. Lime 标准仍是 Skill Bundle / Adapter Spec。
3. gate 失败只能保留 draft，不能注册。

## 3. 与 Query Loop 的边界图

```mermaid
flowchart TB
    subgraph BuildTime[生成 / 编译阶段]
        Goal[用户能力生成目标]
        Forge[Skill Forge]
        Draft[Capability Draft]
        Gate[Verification Gate]
    end

    subgraph Runtime[现有运行时主链]
        Objective[Managed Objective<br/>控制层，不是 runtime taxonomy]
        Submit[agent_runtime_submit_turn]
        Turn[runtime_turn / TurnInputEnvelope]
        ToolRuntime[tool_runtime]
        Queue[runtime_queue / automation]
        Stream[stream_reply_once]
    end

    subgraph Facts[事实源]
        Timeline[timeline]
        Artifact[artifact]
        Evidence[evidence pack]
        ThreadRead[thread read]
    end

    Goal --> Forge
    Forge --> Draft
    Draft --> Gate
    Gate -->|注册后| Objective
    Objective --> Submit
    Submit --> Turn
    Turn --> ToolRuntime
    ToolRuntime --> Queue
    Queue --> Stream
    Stream --> Timeline
    Stream --> Artifact
    Timeline --> Evidence
    Artifact --> Evidence
    Evidence --> ThreadRead
    Evidence --> Objective

    Draft -.验证前禁止进入.-> ToolRuntime
    Objective -.不能绕过.-> Queue
```

固定判断：

1. 生成阶段不能绕过 submit turn。
2. tool surface 仍由 `tool_runtime` 裁剪。
3. evidence pack 是执行事实源。
4. Managed Objective 必须消费 evidence / artifact 做完成审计，不能只靠模型自报完成。

## 4. Verification gate 时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant A as Coding Agent
    participant F as Skill Forge
    participant V as Verification Gate
    participant C as Catalog
    participant R as Runtime
    participant E as Evidence

    U->>A: 描述要生成的 CLI / API 技能
    A->>F: 生成 draft bundle / adapter / tests
    F->>V: 提交结构、contract、权限、dry-run
    V-->>F: 返回验证结果

    alt 验证失败
        F-->>U: 展示失败项与修复建议
    else 验证通过
        F->>C: 注册 workspace-local skill
        C-->>U: 显示可用 skill 与权限摘要
        U->>R: 手动运行或创建 managed job
        R->>E: 写入调用、产物、验证事实
    end
```

## 5. 长期任务执行闭环

```mermaid
flowchart TD
    Start[Managed Skill Job] --> Objective[加载 Managed Objective<br/>目标 / 成功标准 / 预算]
    Objective --> Load[加载 workspace-local skill]
    Load --> Policy[检查权限 / sandbox / budget]
    Policy --> Execute[tool_runtime 执行]
    Execute --> Result{任务结果}

    Result -- 成功 --> Verify[completion audit<br/>结果验证]
    Verify --> Artifact[写入 artifact]
    Artifact --> Evidence[更新 evidence pack]
    Evidence --> Audit{目标是否完成}
    Audit -- 已完成 --> Done[completed]
    Audit -- 未完成 --> Continue[下一轮 continuation turn]
    Continue --> Execute

    Result -- 缺输入 --> NeedsInput[needs_input]
    NeedsInput --> User[请求用户补充]
    User --> Objective

    Result -- 可恢复失败 --> Retry[retry / resume]
    Retry --> Execute

    Result -- 不可恢复失败 --> Failed[failed / blocked]
    Failed --> Evidence
```

固定判断：

1. 长期任务必须能明确完成、阻塞或失败。
2. 失败路径和成功路径都要进入 evidence。
3. 需要用户输入时不能伪装成自动完成。
4. continuation turn 只能由 Managed Objective 策略触发，并继续走 Query Loop。

## 6. Workspace 可见面图

```mermaid
flowchart TB
    Workspace[Workspace] --> Skills[Generated Skills]
    Workspace --> Jobs[Managed Jobs]
    Workspace --> Objectives[Managed Objectives]
    Workspace --> Artifacts[Artifacts]
    Workspace --> Evidence[Evidence]

    Skills --> SkillCard[Skill Card<br/>来源 / 权限 / 验证 / 版本]
    Jobs --> JobCard[Job Card<br/>状态 / 下次运行 / 阻塞 / 操作]
    Objectives --> ObjectiveCard[Objective Card<br/>目标 / 成功标准 / audit 状态]
    Artifacts --> Output[Output Viewer<br/>报告 / 数据 / 草稿]
    Evidence --> Audit[Audit View<br/>调用 / 失败 / 确认 / 回放]

    SkillCard --> Run[手动运行]
    SkillCard --> Schedule[创建定时任务]
    ObjectiveCard --> Review[查看证据]
    JobCard --> Pause[暂停]
    JobCard --> Resume[恢复]
    JobCard --> Review
```

固定判断：

1. 用户必须能看见 agent 生成了什么能力。
2. 用户必须能看见能力权限和验证状态。
3. 用户必须能看见长期任务对应的目标和完成审计状态。
4. 用户必须能从任务回到 evidence。

## 7. current / deprecated 边界图

```mermaid
flowchart LR
    Current[Current 主链<br/>Skill Bundle / Adapter Spec / ServiceSkill / Query Loop / tool_runtime / automation job / evidence] --> OK[继续强化]

    Deprecated[Deprecated 方向<br/>平行 generated tools runtime / goal runtime / 直接执行脚本 / 单场景 scheduler / 单场景 evidence] --> Stop[停止扩展]

    Source[外部来源<br/>API / CLI / Website / MCP] --> Compile[编译到 Lime 标准]
    Compile --> Current
    Source -.禁止直接成为 runtime 标准.-> Deprecated
    GoalPattern[Codex /goal<br/>persistent objective 参考] --> ObjectivePattern[折回 Managed Objective 控制层]
    ObjectivePattern --> Current
    GoalPattern -.禁止照搬为第四 runtime.-> Deprecated
```

## 8. 与 AI 图层化设计的消费关系图

```mermaid
flowchart LR
    Forge[Skill Forge] --> Adapter[Verified Adapter / Skill]
    Adapter --> ToolRuntime[tool_runtime]
    ToolRuntime --> Design[AI Layered Design]
    Design --> Doc[LayeredDesignDocument]

    Design -. owns .-> Doc
    Forge -. does not own .-> Doc
```

固定判断：

1. Skill Forge 可以生成 provider adapter、PSD exporter、OCR / matting wrapper。
2. 这些 adapter 通过验证后才能被 AI 图层化设计消费。
3. `LayeredDesignDocument`、Canvas Editor 和设计导出协议仍归 [../ai-layered-design/README.md](../ai-layered-design/README.md)。
4. 不允许为了图层化设计新增平行 generated tools runtime。

## 9. 后续补图原则

后续如果本路线图继续补图，遵守三条规则：

1. 只画 current 主链，不为平行 generated runtime 画主图。
2. 图中执行节点必须能对应到 Lime 现有 Query Loop、tool_runtime、workspace 或 evidence 主链。
3. 如果实现改变事实源或状态机，优先更新本文图纸和 `implementation-plan.md`。
