# Ribbi 流程图

> 状态：current research reference  
> 更新时间：2026-04-18  
> 目标：把截图里更可信的前台流程和访谈里更长期的系统流程分开画，避免“把愿景当现状”。

## 1. 当前可见的主流程

```mermaid
flowchart TB
    Start["用户在 Skills 选场景<br/>或在 Generate 中直接触发任务"] --> Enter["进入 Generate 主容器"]
    Enter --> Orchestrate["Skill Manager 分解任务"]
    Orchestrate --> Tools["调用工具 / 模型"]
    Tools --> Stage["返回一批阶段结果<br/>图片 / 音频 / 文案 / 研究材料"]
    Stage --> Confirm{"用户是否确认继续"}
    Confirm -->|继续| Next["推进下一阶段"]
    Confirm -->|调整| Adjust["补充要求 / 替换参考 / 调用工具"]
    Adjust --> Orchestrate
    Next --> Final["得到更完整结果"]
    Final --> Save["可沉淀到 Pond<br/>或继续下一轮任务"]
```

固定判断：

1. 当前主流程是阶段式共创，不是一次跑完的黑盒流水线。
2. Generate 里存在明确的人工确认节点。
3. 阶段结果板本身是产品对象，不只是附件列表。

## 2. Generate 内部调用流程

```mermaid
flowchart LR
    Input["输入内容<br/>文本 / 链接 / 参考素材"] --> Trigger["skill 触发 / slash 触发"]
    Trigger --> Manager["Skill Manager"]
    Manager --> Agent["主 Agent"]
    Agent --> Run["工具与模型调用"]
    Run --> Trace["工具轨迹摘要"]
    Trace --> Board["阶段结果板"]
    Board --> User["用户确认 / 调整"]
    User --> Agent
```

固定判断：

1. `Skill Manager` 在产品上更像线程里的编排对象。
2. 工具轨迹不是最终结果，而是阶段证据。
3. 结果板和确认动作比“单次回复文本”更重要。

## 3. Pond 回流流程

```mermaid
flowchart LR
    Ref["用户觉得某批图/视频/风格好"] --> Save["保存到 Pond"]
    Save --> Analyze["系统提炼风格特征"]
    Analyze --> Reuse["下一轮生成优先复用"]
    Reuse --> Better["结果更接近用户偏好"]
```

固定判断：

1. Pond 不是静态收藏夹。
2. 它在流程上承担“把喜欢的东西变成下一轮偏好输入”。

## 4. 长期闭环流程

这张图表达的是 Ribbi 访谈中的长期系统流程，不代表截图里当前每个页面都已经显式露出。

```mermaid
flowchart LR
    Goal["内容或账号目标"] --> Generate["Generate 中完成创作推进"]
    Generate --> Publish["发布 / 分发"]
    Publish --> Monitor["获取表现数据"]
    Monitor --> Review["策略复盘"]
    Review --> NewContext["回写 skill / taste / memory"]
    NewContext --> Generate
```

固定判断：

1. 这条链是系统目标。
2. 当前前台更像先把“生成中的多阶段推进”做强。
