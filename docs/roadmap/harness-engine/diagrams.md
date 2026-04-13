# Lime Harness Engine 架构图与流程图

> 状态：进行中
> 更新时间：2026-04-13
> 作用：把 Harness Engine 的关键结构、时序和治理闭环画成可复查的图，而不是只靠长文描述。

## 1. 总体架构图

```mermaid
flowchart TB
    User[用户 / 人工审核] --> UI[前端工作台 UI]
    UI --> RuntimeAPI[agent_runtime_* 命令边界]
    RuntimeAPI --> Runtime[Aster / Lime Runtime]

    Runtime --> Prompt[System Prompt / Memory Prompt]
    Runtime --> ToolSurface[Tool Surface / Skills / MCP / Browser]
    Runtime --> Policy[Sandbox / Approval / Restriction Policy]
    Runtime --> Session[Session / Thread / Queue / Resume / Continuation]
    Runtime --> Workspace[Workspace / Filesystem / Artifact]

    Prompt --> Memory[AGENTS / Project Rules / Durable Memory]
    ToolSurface --> Exec[Bash / File Tools / Browser Tools / Subagent Tools]
    Workspace --> Artifact[Artifact / Timeline / Runtime Snapshot]

    Session --> Evidence[Evidence Pack]
    Artifact --> Evidence
    Runtime --> Evidence

    Evidence --> Replay[Replay Case]
    Evidence --> Analysis[Analysis Handoff]
    Evidence --> Review[Review Decision]
    Evidence --> Dashboard[Cleanup / Dashboard / Trend]
    Evidence --> StatusPanel[HarnessStatusPanel]

    Replay --> Governance[治理与回归决策]
    Analysis --> Governance
    Review --> Governance
    Dashboard --> Governance
    StatusPanel --> Governance
```

## 2. 运行时与证据导出时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as 前端工作台
    participant C as agent_runtime_submit_turn
    participant R as Lime / Aster Runtime
    participant T as Tools / Skills / Browser / Bash
    participant W as Workspace / Artifact
    participant E as agent_runtime_export_evidence_pack
    participant P as HarnessStatusPanel

    U->>F: 发送任务
    F->>C: submit_turn(request_metadata + turn_config)
    C->>R: 创建 / 恢复当前 turn
    R->>T: 调用 tools / skills / browser / subagent
    T-->>R: 返回输出 / metadata / offload / errors
    R->>W: 写入 artifact / timeline / runtime state
    R-->>F: 流式状态 / item / summary

    U->>F: 导出问题证据包
    F->>E: export_evidence_pack(session_id)
    E->>R: 读取 session detail / thread read
    E->>W: 汇总 runtime.json / timeline.json / artifacts.json / summary.md
    E-->>F: 返回 evidence pack + observability summary + verification summary
    F->>P: 渲染 known gaps / verification outcomes / focus lists
    P-->>U: 展示证据事实与治理焦点
```

## 3. Evidence 驱动治理闭环

```mermaid
flowchart LR
    A[Runtime Thread / Session] --> B[Evidence Pack]
    B --> C[Observability Summary]
    C --> D[Verification Outcomes]
    D --> E[HarnessStatusPanel]
    D --> F[Replay Case]
    D --> G[Analysis Handoff]
    D --> H[Review Decision]
    H --> I[修复实现]
    I --> J[回归验证]
    J --> B
```

## 4. 长时任务执行闭环

```mermaid
flowchart TD
    Start[用户任务进入主会话] --> Plan[计划 / Todo / Scene Binding]
    Plan --> Execute[主代理执行]
    Execute --> Tools[Tools / Skills / Browser / Bash]
    Tools --> Check{是否完成?}

    Check -- 否 --> Continue[Auto Continue / Provider Continuation / Queue Resume]
    Continue --> Compact[必要时 Compact / Offload / Context Recovery]
    Compact --> Execute

    Check -- 需要拆分 --> Subagent[Spawn Subagent / Team Runtime]
    Subagent --> Execute

    Check -- 是 --> Verify[Verification / Replay / Review]
    Verify --> Done[形成交付物与证据]
```

## 5. 事实源分层图

```mermaid
flowchart TB
    RuntimeFact[Runtime Thread / Session / Timeline]
    EvidencePack[Evidence Pack]
    Derived[Replay / Analysis / Review / Dashboard]
    View[UI / Prompt Copy / Status Cards]

    RuntimeFact --> EvidencePack
    EvidencePack --> Derived
    EvidencePack --> View
    Derived --> View

    View -.禁止反向定义事实.-> EvidencePack
    Derived -.禁止旁路重建真相.-> RuntimeFact
```

## 6. 当前最关键的治理关注点

### 6.1 已经成形的图上主链

- `User -> UI -> agent_runtime_* -> Runtime -> Tools / Workspace -> Evidence`
- `Evidence -> Replay / Analysis / Review / StatusPanel`
- `Continuation / Compact / Offload / Resume`

### 6.2 仍需继续加强的图上闭环

- `Verification Outcomes -> Review / Cleanup / Dashboard` 还要更强一致
- `是否完成 -> Continue / Compact / Resume` 还没完全约束化
- `任务类型 -> JIT Tool / Context Assembly` 还没完全平台化

## 7. 后续补图原则

后续如果 Harness Engine 再新增图纸，遵守三条规则：

1. 只画 current 主链，不为 compat / deprecated 画主图。
2. 图中节点必须能对应到仓库真实模块、命令或文档，不画空概念。
3. 如果实现已经改变事实源或时序，优先更新图，而不是只改 README 文案。
