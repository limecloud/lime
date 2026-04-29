# Warp 对照时序图

> 状态：current research reference  
> 更新时间：2026-04-29  
> 目标：用时序图说明 Lime 采用 ClaudeCode 主参考、Warp 治理补充后，一次多模态任务应如何从上层入口进入底层 contract、路由、执行、artifact、evidence 和 LimeCore audit。

## 1. 底层 contract 先行的标准时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant Entry as 上层入口<br/>@ / button / scene
    participant Runtime as ModalityRuntimeContract
    participant Profile as ExecutionProfile
    participant Router as Model Router
    participant Exec as Executor Binding
    participant Artifact as Artifact Graph
    participant Viewer as Viewer
    participant Evidence as Evidence Pack

    U->>Entry: 触发多模态意图
    Entry->>Runtime: 只提交 launch metadata 与输入上下文
    Runtime->>Runtime: 绑定 session/thread/turn/task/content
    Runtime->>Profile: 请求权限、租户、执行器策略
    Runtime->>Router: 提交 capability requirements
    Profile-->>Runtime: 返回 allow / ask / deny / fallback
    Router-->>Runtime: 返回 RoutingDecision
    Runtime->>Exec: 调用 Skill / Tool / ServiceSkill / Browser / Gateway
    Exec-->>Runtime: progress / observation / result
    Runtime->>Artifact: 写领域 artifact
    Runtime->>Evidence: 写 timeline / routing / profile / artifact event
    Artifact-->>Viewer: 右侧查看区读取 artifact
    Viewer-->>U: 展示结果，不反写事实源
```

固定判断：

1. Entry 不创建 task，不写 artifact，不决定 viewer。
2. Runtime 先绑定身份，再做路由和权限。
3. Evidence 由 runtime timeline 导出，不由 viewer 回推。

## 2. 模型路由与权限合并时序

```mermaid
sequenceDiagram
    participant Runtime as Runtime Contract
    participant Matrix as Capability Matrix
    participant User as User Settings
    participant Core as LimeCore Policy
    participant Profile as ExecutionProfile
    participant Router as Model Router
    participant Evidence as Evidence

    Runtime->>Matrix: required_capabilities
    Runtime->>User: explicit model / permission locks
    Runtime->>Core: tenant policy / provider offer / gateway policy
    Matrix-->>Profile: capability candidates
    User-->>Profile: local constraints
    Core-->>Profile: cloud constraints
    Profile->>Router: merged model roles + permissions
    Router-->>Profile: RoutingDecision / capability_gap
    Profile-->>Runtime: allow / ask / deny / fallback
    Runtime->>Evidence: 记录 decision、来源和限制原因
```

验收重点：

1. 租户禁用某能力时，候选模型再强也不能绕过。
2. 用户锁定模型时仍要做 capability check。
3. 候选为空时必须输出 capability gap，而不是静默 fallback。

## 3. Artifact 与 viewer 时序

```mermaid
sequenceDiagram
    participant Exec as Executor
    participant Runtime as Runtime Contract
    participant Artifact as Artifact Store
    participant Index as Task Index
    participant Viewer as Viewer
    participant Evidence as Evidence

    Exec-->>Runtime: 返回 task result / media / document / observation
    Runtime->>Artifact: upsert domain artifact kind
    Runtime->>Index: 更新 task/artifact/status 索引
    Runtime->>Evidence: 导出 artifact event
    Viewer->>Artifact: 按 artifact_id / kind 读取
    Artifact-->>Viewer: 返回可渲染结构
    Viewer-->>Index: 可选读取任务状态
    Viewer-->>Evidence: 可选读取复盘材料
```

禁止路径：

1. Viewer 不能从聊天文本猜 artifact。
2. Viewer 不能把空文件或中间文件提升为最终结果。
3. Artifact 不能只靠本地路径作为唯一身份。

## 4. Browser Assist typed action 时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant Entry as Browser 入口
    participant Runtime as Runtime Contract
    participant Profile as ExecutionProfile
    participant Browser as Browser Executor
    participant Obs as Observation Store
    participant Evidence as Evidence
    participant Viewer as Browser Replay Viewer

    U->>Entry: 请求浏览器协助
    Entry->>Runtime: browser_control contract metadata
    Runtime->>Profile: 检查 browser_control 权限
    alt 允许自动执行
        Profile-->>Runtime: allow
        Runtime->>Browser: typed action
    else 需要确认
        Profile-->>U: ask
        U-->>Profile: confirm / reject
        Profile-->>Runtime: allow / deny
    end
    Browser-->>Obs: screenshot / DOM / URL / network
    Browser-->>Runtime: action result
    Runtime->>Evidence: action + observation trace
    Runtime->>Viewer: browser_snapshot artifact
    Viewer-->>U: 可复查回放
```

固定判断：

1. Browser 不是 WebSearch。
2. 每个关键动作必须有 observation。
3. 高风险动作进入 profile，而不是工具内部临时绕过。

## 5. LimeCore catalog / policy 接线时序

```mermaid
sequenceDiagram
    participant Lime as Lime Desktop
    participant Core as LimeCore
    participant Cache as Local Cache
    participant Contract as Runtime Contract Registry
    participant Profile as ExecutionProfile
    participant Audit as Audit

    Lime->>Core: bootstrap / client catalog request
    Core-->>Lime: skills / scenes / model catalog / provider offer / policy
    Lime->>Cache: 写入在线目录缓存
    Cache->>Contract: 更新可用 contract binding
    Cache->>Profile: 更新模型与权限约束

    alt 本地执行
        Profile-->>Lime: local executor allowed
        Lime->>Audit: 可选上传关联键摘要
    else 显式 Gateway / cloud scene
        Profile-->>Lime: cloud executor required
        Lime->>Core: Gateway call / Scene run
        Core->>Audit: 写云端审计
    end
```

边界判断：

1. LimeCore 先做目录和策略事实源。
2. 本地执行仍在 Lime。
3. 云执行必须显式进入 Gateway 或 Scene cloud run，不默认劫持所有入口。

## 6. 新入口绑定时序

```mermaid
sequenceDiagram
    participant Dev as 开发者
    participant Contract as Contract Registry
    participant Entry as Entry Binding
    participant Check as Governance Check
    participant Runtime as Runtime

    Dev->>Contract: 查询是否已有底层 contract
    alt 已有 contract
        Dev->>Entry: 新增 @ / button / scene binding
    else 没有 contract
        Dev->>Contract: 先补 ModalityRuntimeContract
        Dev->>Entry: 再绑定入口
    end
    Entry->>Check: 校验 contract_key / viewer / artifact / evidence
    Check-->>Dev: pass / fail
    Entry->>Runtime: 运行时只提交 metadata
```

固定判断：

1. 新入口不是新架构。
2. 新入口必须复用或先补底层 contract。
3. 治理检查要阻止“入口直接写事实源”。
