# Ribbi 对照 Lime 的偏差分析

> 状态：current research reference  
> 更新时间：2026-04-18  
> 目标：明确 Lime 现在究竟是“方向错了”，还是“表达层跑偏了”，并给后续 V2 文档提供对象级收口依据。

## 1. 总判断

Lime 现在不是 wrong direction。

更准确的判断是：

**大方向对了，但产品表达仍然 too abstract, too early。**

也就是说，问题主要不在底层技术骨架，而在前台对象和叙事节奏。

## 2. Lime 已经接近 Ribbi 的部分

以下能力已经具备明显的 Ribbi 式骨架：

1. `生成` 已经开始收口为唯一主执行面
2. `SceneApp` 已经被压回内部合同
3. `Context Layer` 已有 first cut
4. `灵感库` 已经开始作为 `Memory + Taste + Reference` 的前台投影
5. `Project Pack / Evidence / Review` 已经开始构成结果与复盘主链

这些部分说明 Lime 并不是从零开始对齐 Ribbi，而是已经走到一半。

## 3. Lime 当前偏的地方

真正的偏差集中在下面四点：

1. 仍然过度强调平台层名词
   - `Context Layer`
   - `Project Pack`
   - `Scorecard`
   - `SceneApp descriptor`
2. 前台更像工作台和目录系统，而不是任务型 skill 系统
3. 太容易把“长期闭环愿景”直接画成“当前前台 IA”
4. 太早暴露了系统完整性，太晚压缩成用户任务

补充说明：

从最新截图看，Lime 当前最危险的偏差还多了一条：

**容易把 `项目结果 / 复盘` 提前做成并列页面，而不是先收成 `Generate` 后链路里的结果视角。**

## 4. current / compat / deprecated / dead 分类

基于当前方向，后续文档与产品面建议按下面分类收口：

### 4.1 current

这些是后续应该继续强化的主路径：

1. `生成` 作为唯一主执行面
2. `灵感库` 作为 taste / reference / memory 的前台投影
3. `单主 Agent + 异步辅助 agent` 的执行骨架
4. `Generate` 内的阶段式推进与人工确认
5. `全流程内容闭环` 作为产品北极星，而不是当前页面拆分方式

### 4.2 compat

这些对象可以在过渡期保留，但不应继续当主叙事：

1. `创作场景`
   - 只保留为 skill 装配、选路、准备层
2. `SceneAppsPage`
   - 可以保留现役实现，但 V2 不再把它当第一主舞台
3. `项目结果 / 复盘` 独立页面化尝试
   - 若已有实现，可暂时保留，但 V2 叙事里优先降回 `生成` 后链路视角

### 4.3 deprecated

这些表达不应再继续长成 V2 主规划：

1. “创作操作系统”
2. “完整平台总装层”式叙事
3. 把 `SceneApp / Context Layer / Project Pack` 当成前台主产品词
4. 把长期闭环愿景直接等同于当前 IA
5. 把 `项目结果 / 复盘` 默认写成一级并列主面

### 4.4 dead

这些方向在 V2 里应明确判死，不再回头：

1. Ribbi 的收藏池命名
2. “多主 Agent 协作”作为前台核心卖点
3. “先做能力市场，再慢慢长任务”这条路线
4. “首页铺满几十个工具/能力卡”这类入口方式

## 5. 对 V2 文档的直接要求

因此 LimeNext V2 的文档必须做到：

1. 把 `research/ribbi` 作为对照层
2. 把 Lime 的决定写进独立的 `roadmap/limenextv2`
3. 把旧 `roadmap/limenext` 降级为 current 实现锚点，而不是继续承担北极星
4. 清理旧 Ribbi 过渡文档，避免旧参考继续干扰生成
5. 明确把 `Generate` 写成单容器主舞台，而不是普通聊天页
6. 明确把“当前前台结构”和“长期系统闭环”分开表述

一句话：

**后续真正需要收掉的，不是底层能力，而是前台的抽象噪音。**
