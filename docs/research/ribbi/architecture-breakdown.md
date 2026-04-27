# Ribbi 架构拆解

> 状态：current research reference  
> 更新时间：2026-04-18  
> 目标：把 Ribbi 的真实系统骨架拆成稳定层次，避免只看页面截图或能力列表就误判它是“内容工具大拼盘”。

## 1. 先给结论

Ribbi 的本质不是“很多内容工具”，而是：

**一个持续持有上下文的内容主 Agent，加上一套让它不断变聪明的异步进化系统。**

可以把它稳定拆成六层：

```text
用户目标
  -> 场景化 skill 入口
  -> 单一主 Agent 执行
  -> Context Layer 编译
  -> Tool / Model Router 调度
  -> 发布 / 监控 / 复盘反馈
  -> Async agents 持续进化 taste / skill / memory
```

补充修正：

1. 这六层是系统结构，不等于当前前台被拆成六个并列页面。
2. 从截图看，当前更像 `Skills / Generate / Pond` 三入口，其中 `Generate` 是绝对主舞台。

## 2. 六层骨架

## 2.1 Product Surface Layer

用户看到的是任务入口，不是工具入口。

更贴近截图的前台对象是：

1. 场景化 skill 发现入口
2. `Generate` 主执行容器
3. 参考/风格入口
4. 阶段结果板、工具轨迹和人工确认动作

固定判断：

1. 前台卖的是“帮我做成什么”，不是“我有哪些模型和工具”。
2. 工具再多，也不应该在前台按工具分类暴露给用户。
3. 发布、监控、复盘更像系统目标和结果后链路，不一定都已经是当前并列主页面。

## 2.2 Main Agent Layer

Ribbi 对用户只暴露**一个主 Agent**。

原因不是因为不会做多 Agent，而是为了保持：

1. 上下文不切断
2. 风格认知不切断
3. 创作链的连续责任不切断

固定判断：

**Ribbi 不是 multi-agent 主协作产品，而是 single main agent 产品。**

## 2.3 Skill-as-Manual Layer

Ribbi 的 skill 不是按钮功能，不是死工作流，而是“给模型读的说明书”。

每个 skill 至少隐含四类信息：

1. 这是什么场景
2. 这类场景通常要收哪些输入
3. 这类场景建议调哪些工具
4. 结果应该长成什么样

固定判断：

**skill 是说明书，不是 workflow graph。**

## 2.4 Context Layer

Ribbi 真正拉开差距的核心，不在前台，而在执行前编译。

它至少包含：

1. `Skill Layer`
2. `Memory Layer`
3. `Taste Layer`
4. `Tool Layer`

执行时再由编译层决定：

1. 带哪些历史
2. 带哪些参考
3. 带哪些风格约束
4. 开哪些工具
5. 裁掉哪些无关上下文

固定判断：

**Context Layer 是执行前编译层，不是产品对象。**

## 2.5 Tool / Model Router Layer

Ribbi 的底层不是单模型，不是单工具。

它实际依赖：

1. 多模型路由
2. 多媒体工具链
3. 浏览器/搜索/下载/解析类能力
4. 发布、数据读取、定时执行能力

但这些都只应停留在底层，不应直接抬成前台主心智。

固定判断：

**能力池可以无限扩张，但前台任务入口必须被持续压缩。**

## 2.6 Async Evolution Layer

后台异步 agent 不直接和用户争主角，它们的职责是“喂养主 Agent”。

核心异步角色包括：

1. taste 提炼
2. memory 压缩
3. feedback 回写
4. skill 演化
5. 定时任务与账号观察

固定判断：

**异步 agent 的意义不是替用户聊天，而是持续更新主 Agent 的上下文质量。**

## 3. Ribbi 为什么看起来简单

因为它把复杂性全部压进后台了。

用户看到的是：

1. 少量任务入口
2. 一个主生成容器
3. 工具轨迹与阶段结果
4. 少量确认和继续动作

用户看不到的是：

1. tool registry
2. model router
3. context compile
4. taste 提炼
5. skill 演化

这也是它和“工具平台”的本质差异。

## 4. 对 Lime 的直接启发

Lime 如果要学 Ribbi，最应该对齐的是下面四条：

1. 前台卖任务，不卖能力目录
2. `生成` 这类主执行面必须持续持有同一份上下文
3. `SceneApp / Context Layer / Project Pack` 这类对象都应停留在内部层
4. 后台进化层可以越来越复杂，但前台叙事必须越来越简单
