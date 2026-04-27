# Ribbi 研究总入口

> 状态：current research reference  
> 更新时间：2026-04-18  
> 目标：把 Ribbi 拆成可持续对照的研究事实源，供 LimeNext V2 后续规划、文档生成与实现决策反复校准，避免再次偏向“抽象平台说明书”。

## 1. 目录定位

`docs/research/ribbi/` 只回答两类问题：

1. Ribbi 到底在做什么。
2. Lime 应该学它的哪一层，不该照搬哪一层。

这里是**研究目录**，不是 Lime 的产品决策目录。

固定边界：

1. 这里可以拆解 Ribbi 的架构、意图、skill 体系与 taste 机制。
2. 这里不能直接替 Lime 做产品命名、页面结构和实现排期决策。
3. Lime 自己的决定，统一写进 [../../roadmap/limenextv2/README.md](../../roadmap/limenextv2/README.md)。

## 2. 为什么单独建立这一层

旧的 Ribbi 过渡目录与 [../../roadmap/limenext/README.md](../../roadmap/limenext/README.md) 曾经把“Ribbi 参考”和“Lime 自己的路线图”混在一起讨论，结果容易出现三种跑偏：

1. 直接抄表面能力表，而不是学它的闭环骨架。
2. 把 Lime 的内部执行层写成前台产品对象。
3. 后续生成新文档时，不知道应该先对照外部参考，还是直接沿旧平台叙事继续长文档。

从现在开始，事实源拆成两层：

1. `docs/research/ribbi/`
   - 外部参考事实源
2. `docs/roadmap/limenextv2/`
   - Lime 自己的 current 规划事实源

补充说明：

1. 旧 Ribbi 过渡目录已清理，不再作为任何 current 或 compat 事实源保留。

## 3. 固定不照搬的东西

以下内容默认只作为参考背景，不直接搬进 Lime：

1. Ribbi 的收藏池命名
2. 青蛙 IP、品牌人格、粗口风格
3. 海外平台优先、API 开放性与商业化节奏
4. “不上落地页，用户自己感受”这类产品姿态
5. 为了看起来像 Ribbi 而额外堆页面、堆能力卡

Lime 真正要学的是：

1. 单主 Agent 的上下文连续性
2. skill 作为场景说明书
3. 全流程内容闭环
4. taste / memory / feedback 的持续进化
5. 底层能力多，前台任务少而强

## 4. 建议阅读顺序

1. [architecture-breakdown.md](./architecture-breakdown.md)
2. [architecture-diagrams.md](./architecture-diagrams.md)
3. [agent-tool-orchestration.md](./agent-tool-orchestration.md)
4. [command-inventory.md](./command-inventory.md)
5. [business-diagrams.md](./business-diagrams.md)
6. [flowcharts.md](./flowcharts.md)
7. [sequences.md](./sequences.md)
8. [product-intent.md](./product-intent.md)
9. [skill-system.md](./skill-system.md)
10. [taste-memory-evolution.md](./taste-memory-evolution.md)
11. [lime-gap-analysis.md](./lime-gap-analysis.md)

## 5. 与 LimeNext V2 的关系

后续所有 LimeNext V2 文档与实现建议，默认遵守以下顺序：

1. 先读本目录，确认“Ribbi 到底为什么成立”
2. 再读 [../../roadmap/limenextv2/README.md](../../roadmap/limenextv2/README.md)，确认“Lime 决定怎么做”
3. 只有进入实现细节时，才回看 [../../roadmap/limenext/README.md](../../roadmap/limenext/README.md) 这类旧 current 实现锚点

一句话：

**`research/ribbi` 负责防跑偏，`roadmap/limenextv2` 负责做决定。**
