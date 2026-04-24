# Lime 任务层 / 模型层图纸集

> 状态：提案
> 更新时间：2026-04-23
> 作用：把任务层、候选解析、模型路由、OEM 约束、成本/限额事件和单模型降级链画成可复查图纸。
> 依赖文档：
> - `./architecture.md`
> - `./task-taxonomy.md`
> - `./model-routing.md`
> - `./oem-and-local-policy.md`
> - `./cost-limit-events.md`

## 1. 总体架构图

```mermaid
flowchart TB
    User[用户 / 设置页 / 工作台] --> UX[Product and UX Layer]
    UX --> Task[Task Layer<br/>TaskProfile]
    UX --> Settings[会话模型 / service_models / OEM 默认值]

    Task --> Candidate[Candidate Resolution Layer<br/>CandidateModelSet]
    Settings --> Candidate
    OEM[OEM Control Plane] --> Candidate
    Pool[Provider Pool and Model Registry] --> Candidate

    Candidate --> Router[Model Routing Layer<br/>RoutingDecision]
    Limits[Cost and Limit State] --> Router

    Router --> Runtime[Runtime Execution Layer]
    Runtime --> Telemetry[Cost / Limit / Telemetry Layer]
    Runtime --> Thread[Thread Read / Evidence / Review]
    Telemetry --> Thread

    Thread --> UX
```

## 2. 主流程图：提交到路由决策

```mermaid
flowchart TD
    A[agent_runtime_submit_turn] --> B[TaskProfile 构建]
    B --> C[读取会话模型 / service_models / request_metadata]
    C --> D[读取 OEM policy / provider pool / model registry]
    D --> E[生成 CandidateModelSet]
    E --> F{candidate_count}

    F -- 0 --> G[RoutingDecision: no_candidate]
    F -- 1 --> H[RoutingDecision: single_candidate]
    F -- N --> I[按能力 / 成本 / 限额 / 连续性优选]

    I --> J[RoutingDecision: multi_candidate]
    G --> K[执行阻断或要求用户调整]
    H --> L[透传执行或能力降级]
    J --> M[生成 ConfigureProviderRequest]

    L --> M
    M --> N[进入 runtime_turn 和 stream_reply_once]
```

## 3. 主对话时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as 前端工作台
    participant API as agent_runtime_submit_turn
    participant Turn as runtime_turn.rs
    participant Resolve as request_model_resolution.rs
    participant Exec as Runtime Execution
    participant Tele as Telemetry

    U->>FE: 发送消息 / 选择当前会话模型
    FE->>API: submit_turn(request + metadata)
    API->>Turn: 构建 TaskProfile
    Turn->>Resolve: 解析候选集与路由
    Resolve-->>Turn: RoutingDecision + provider config
    Turn->>Exec: 执行 turn
    Exec-->>Tele: usage / rate limit / cost / warnings
    Exec-->>FE: 流式消息与状态
    Tele-->>FE: thread read / evidence 可读事实
```

## 4. 单候选时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant Turn as Task Layer
    participant Candidate as Candidate Resolver
    participant Router as Routing Layer
    participant Exec as Runtime
    participant Tele as Cost and Limit

    U->>Turn: 发起任务
    Turn->>Candidate: 请求当前任务可用候选
    Candidate-->>Turn: candidate_count = 1
    Turn->>Router: TaskProfile + single candidate
    Router-->>Turn: single_candidate 决策<br/>附带 capability gap 和 reason
    Turn->>Exec: 用唯一候选执行或降级
    Exec-->>Tele: 记录 single_candidate_only / capability_gap / cost
```

## 5. OEM 与本地协同时序图

```mermaid
sequenceDiagram
    participant FE as 前端
    participant OEM as OEM Control Plane
    participant Candidate as Candidate Resolver
    participant Router as Routing Layer
    participant Pool as Local Provider Pool
    participant Exec as Runtime

    FE->>OEM: 读取 bootstrap / offers / preference
    OEM-->>FE: routingMode + allowlist + quotaPolicy
    FE->>Candidate: 提交 turn 与 OEM 上下文
    Candidate->>Pool: 读取本地可用 provider/model
    Candidate-->>Router: 合成 CandidateModelSet
    Router-->>Router: 应用 OEM managed / hybrid / advisory 规则
    Router-->>Exec: 最终 provider/model 或 fallback 结果
```

## 6. 成本与限额事件时序图

```mermaid
sequenceDiagram
    participant Router as Routing Layer
    participant Exec as Runtime
    participant Tele as Telemetry
    participant Thread as Thread Read
    participant Evidence as Evidence Pack

    Router->>Tele: cost_estimated / limit_state_snapshot
    Exec->>Tele: usage / actual cost / rate limit / quota status
    Tele->>Thread: 更新 routing_decision / limit_state / events
    Thread->>Evidence: 导出 current 事实
```

## 7. 能力缺口降级流程图

```mermaid
flowchart TD
    A[TaskProfile] --> B[检查 required_capabilities]
    B --> C{当前候选是否满足}
    C -- 满足 --> D[正常执行]
    C -- 不满足且可回退 --> E[尝试 fallback chain]
    C -- 不满足且不可回退 --> F[生成 capability_gap]

    E --> G{fallback 成功?}
    G -- 是 --> H[回退执行]
    G -- 否 --> F

    F --> I[RoutingDecision: degraded 或 blocked]
    I --> J[写入 runtime 事件和 thread read]
```

## 8. 自动与设置平衡流程图

```mermaid
flowchart TD
    A[收到任务] --> B{是否有显式锁定}
    B -- 是 --> C[按显式锁定执行]
    B -- 否 --> D{是否存在任务级 service_models 偏好}
    D -- 是 --> E[把 service_models 作为首选候选]
    D -- 否 --> F{是否存在 OEM 硬约束}
    E --> F

    F -- 是 --> G[在 OEM 允许范围内解析候选]
    F -- 否 --> H[合并本地 provider pool 与会话偏好]

    G --> I{候选数量}
    H --> I

    I -- 0 --> J[阻断并解释]
    I -- 1 --> K[单候选透传或降级]
    I -- N --> L[自动优选]
```

## 9. 数据模型关系图

```mermaid
flowchart LR
    TaskProfile --> CandidateModelSet
    SessionSettings[会话模型设置] --> CandidateModelSet
    ServiceModels[workspace_preferences.service_models] --> CandidateModelSet
    OEMPolicy[OEM routing policy] --> CandidateModelSet
    CandidateModelSet --> RoutingDecision
    LimitState --> RoutingDecision
    RoutingDecision --> ExecutionRuntime[AsterSessionExecutionRuntime]
    RoutingDecision --> RequestLog
    LimitState --> RequestLog
    RequestLog --> ThreadRead
    ExecutionRuntime --> ThreadRead
```

## 10. 图纸使用规则

1. 图只表达主链职责，不单独固化最终 wire 字段名。
2. 图中所有节点都必须能映射到 Lime 仓库真实模块或真实配置面。
3. 后续若实现先落地，再优先更新本图，而不是只改散文说明。
