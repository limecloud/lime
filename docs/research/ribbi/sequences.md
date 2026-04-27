# Ribbi 时序图

> 状态：current research reference  
> 更新时间：2026-04-18  
> 目标：用更贴近截图的时序图解释 Ribbi 在一个线程里如何分角色、分阶段推进任务。

## 1. 一次 skill 启动的时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant G as Generate
    participant SM as Skill Manager
    participant A as 主 Agent
    participant T as 工具/模型执行器
    participant B as 阶段结果板

    U->>G: 触发一个 skill 或丢入链接/参考图
    G->>SM: 进入任务编排
    SM->>U: 追问必要信息或直接开始
    U->>SM: 补充约束
    SM->>A: 分解成当前执行段
    A->>T: 调用工具与模型
    T-->>A: 返回中间结果
    A->>B: 输出阶段结果
    B-->>U: 展示素材板 / 文本 / 音频
```

## 2. 一次“阶段确认再继续”的时序

这条时序是截图里最关键但我上一版没有画清楚的点。

```mermaid
sequenceDiagram
    participant U as 用户
    participant B as 阶段结果板
    participant G as Generate
    participant SM as Skill Manager
    participant A as 主 Agent
    participant T as 工具/模型执行器

    B-->>U: 展示一批素材或阶段结果
    U->>G: 确认继续 / 提修改意见
    G->>SM: 进入下一阶段编排
    SM->>A: 生成下一段执行计划
    A->>T: 再次调用工具与模型
    T-->>A: 返回下一阶段结果
    A->>B: 更新更完整结果
```

固定判断：

1. Ribbi 当前体验明显有“阶段门”。
2. 用户不是只看最终结果，而是在每一阶段参与继续/调整。

## 3. 一次保存参考到 Pond 的时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant P as Pond
    participant H as 风格提炼 helper
    participant C as 上下文层
    participant G as Generate

    U->>P: 保存喜欢的参考素材
    P->>H: 异步提交风格分析
    H->>C: 写回风格摘要
    Note over H,C: 异步完成，不阻塞当前线程
    U->>G: 发起下一轮任务
    G->>C: 读取最新风格上下文
    C-->>G: 返回更新后的偏好
```

## 4. 一次“帮我做成 skill”的时序

这条时序来自截图里显式出现的“帮我做成 skill”。

```mermaid
sequenceDiagram
    participant U as 用户
    participant G as Generate
    participant SM as Skill Manager
    participant S as Skill 沉淀层

    U->>G: 帮我做成 skill
    G->>SM: 提取当前线程的任务结构
    SM->>S: 归纳输入、步骤和结果约定
    S-->>SM: 返回可复用 skill 草案
    SM-->>U: 确认已沉淀为可复用 skill
```

固定判断：

1. Ribbi 的 skill 不只是预置目录。
2. 它还把对话中的成功路径继续沉淀成 skill。
