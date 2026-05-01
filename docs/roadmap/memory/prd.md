# 灵感库 / 记忆系统 PRD

> 状态：current PRD  
> 更新时间：2026-05-01  
> 关联研究：[../../research/memory/inspiration-library-memory-research.md](../../research/memory/inspiration-library-memory-research.md)  
> 产品口径：普通用户看到 `灵感库`；底层工程继续使用 `memory / runtime memory / unified memory`。

## 1. 背景

Lime 已经具备较完整的底层记忆主链：

```text
记忆来源链解析
  -> 单回合 memory prefetch
  -> runtime turn prompt augmentation
  -> session compaction
  -> working / durable memory 沉淀
  -> Memory 页面 / 设置页 / 线程面板稳定读模型
```

当前问题不是能力缺失，而是产品分层混合：

1. `MemoryPage` 已经能展示灵感对象、风格、参考、成果和推荐。
2. 同一页面也展示来源链、working memory、Team Memory、压缩摘要、命中历史等底层诊断。
3. 对开发者这是完整工作台；对创作者这是认知负担。
4. Lime 面向普通创作者，不能把 Claude Code / OpenClaw / Hermes 的记忆工作台直接作为前台体验。
5. Lime 的产品形态更应靠近 Ribbi：单主生成容器、少量入口、后台持续进化 taste / reference / memory / feedback。

本 PRD 的核心判断：

**把底层记忆能力翻译成创作者可管理、可继续行动的灵感库。**

## 2. 用户与场景

### 2.1 普通创作者

用户特征：

1. 关注内容效果，不关心 memory runtime。
2. 希望 Lime 越用越懂自己的风格。
3. 希望能复用历史好结果和参考素材。
4. 对隐私和误记有强敏感，需要随时删除或禁用。

核心场景：

1. 保存一轮满意结果，下次继续围绕它生成。
2. 收藏一张图、一段文案或一个链接，作为后续参考。
3. 告诉 Lime “以后不要这样写”，系统能记住并可查看。
4. 打开灵感库时看到当前风格和参考资产，而不是底层诊断日志。

### 2.2 进阶创作者 / 内容运营

用户特征：

1. 会主动维护品牌语气、栏目模板和内容方法。
2. 希望把历史成果整理成可复用打法。
3. 可以接受“自动整理建议”，但需要审核。

核心场景：

1. 把多个成果合并成一个稳定方法。
2. 把重复或过期偏好清理掉。
3. 查看某条灵感为什么会影响下一轮推荐。
4. 对自动整理建议做确认、忽略、合并。

### 2.3 开发者 / 内测诊断用户

用户特征：

1. 需要解释为什么某次生成带入了某些上下文。
2. 需要验证 memory runtime、prefetch、compaction 是否正常。
3. 能理解来源链、bucket、Team Memory、working memory。

核心场景：

1. 排查某条记忆为什么没有命中。
2. 查看当前 turn prompt 使用了哪些层。
3. 验证 compaction summary 是否正确续接。
4. 检查 memdir 是否有重复或过期索引。

## 3. 产品目标

### 3.1 P0 目标

1. 普通用户默认只看到灵感库前台对象。
2. 底层诊断能力仍保留，但移出默认主体验。
3. 所有长期灵感仍复用 `unified_memory_*` 事实源。
4. 结果保存、推荐信号、围绕灵感继续生成形成闭环。
5. 用户能编辑、删除、禁用影响生成的灵感。
6. Memory baseline 常开；主动记忆、raw recall 预览、自动整理实验、外部 provider 和诊断层默认关闭，只能通过开发者面板 / 高级设置显式开启。

### 3.2 P1 目标

1. 自动整理建议进入待确认队列。
2. 用户能把收藏备选整理成风格 / 参考 / 成果 / 偏好。
3. 每条灵感显示“影响下一轮生成”的解释。
4. 灵感库能把历史成果推荐给 `我的方法`。

### 3.3 P2 目标

1. Taste summary 成为稳定对象，服务创作风格连续性。
2. 支持多项目 / 多品牌的灵感分组。
3. 支持导入图片、链接、文档、音频转写等多模态参考。
4. 高级诊断页支持导出 evidence，用于客服和研发排障。
5. 外部 memory provider / active recall 实验支持单一启用、可见状态、随时关闭和完整 trace。

## 4. 非目标

本 PRD 不做：

1. 新建平行 `inspiration_*` 数据库主链。
2. 重写 `memory_runtime_*` 或 `unified_memory_*`。
3. 把所有聊天历史自动保存为灵感。
4. 把 session working memory 直接当长期灵感。
5. 给普通用户暴露 `memdir`、`prefetch`、`compaction` 等术语。
6. 默认启用 active memory、自动召回预览、Dreaming / auto organization 或 raw hit layer。
7. 让外部 provider 绕过 `unified_memory_*` / `memory_runtime_*` 成为新的事实源。
8. 一次性重构所有记忆代码。

## 5. 前台信息架构

### 5.1 主导航

普通用户看到：

```text
灵感库
  - 总览
  - 风格
  - 参考
  - 成果
  - 偏好
  - 收藏
  - 待整理
```

开发者面板 / 高级入口显式开启后看到：

```text
记忆诊断
  - 来源链
  - 会话工作记忆
  - 持久记忆命中
  - Team Memory
  - 压缩摘要
  - 命中历史
  - memdir 整理
```

### 5.2 灵感对象字段

普通用户可见字段：

1. 标题。
2. 类型：风格、参考、成果、偏好、收藏。
3. 摘要。
4. 标签。
5. 最近使用 / 最近更新。
6. 是否影响生成。
7. 影响说明。
8. 操作：继续生成、编辑、禁用、删除、整理。

普通用户不可见字段：

1. source bucket。
2. provider。
3. memory type。
4. runtime hit layer。
5. compaction id。
6. memdir path。
7. prompt excerpt。
8. external provider name。
9. active recall transcript。

## 6. 功能需求

### 6.1 灵感总览

P0：

1. 展示当前可复用灵感总数。
2. 展示最近更新的风格、参考、成果。
3. 展示“围绕当前灵感继续生成”的推荐卡。
4. 展示 taste summary 的自然语言摘要。
5. 空态引导用户保存结果、导入参考、收藏风格。

验收：

- 普通用户首屏不出现 `memory_runtime`、`prefetch`、`compaction`、`memdir` 等术语。
- 点击推荐卡必须进入共享 launcher，而不是裸 prompt。

### 6.2 保存到灵感库

P0：

1. 聊天结果、结果工作台、自动化详情、scene app 结果都应使用同一保存入口。
2. 保存前构造统一 draft，映射到 `unified_memory.category`。
3. 保存成功后记录推荐信号。
4. 已保存状态在原结果卡显影。
5. 提供“去灵感库继续”的精确落点。

验收：

- 同一结果重复保存时，不再显示可重复点击的主按钮。
- 从结果页进入灵感库，应落到成果分区并聚焦对应条目。

### 6.3 编辑、删除、禁用

P0：

1. 用户可以编辑标题、摘要、标签和类型。
2. 用户可以删除错误或敏感灵感。
3. 用户可以禁用某条灵感，使其不再影响生成，但仍可保留在库中。
4. 删除和禁用必须影响后续推荐与 recall。
5. 高风险删除使用确认弹窗。

验收：

- 禁用条目不会出现在下一轮默认参考对象中。
- 删除条目后，推荐信号和聚焦入口不应继续指向不存在对象。

### 6.4 影响解释

P1：

1. 每条灵感显示“为什么它会影响生成”。
2. 解释语言面向创作者，例如“这会让下一版更接近你常用的短句节奏”。
3. 高级展开可显示底层来源和最近命中，但默认折叠。

验收：

- 普通解释不暴露 runtime 字段名。
- 高级展开能定位到真实 memory id / source path / hit layer。

### 6.5 自动整理建议

P1：

1. 后台抽取只进入“待整理”，不默认污染正式灵感库。
2. 建议动作包括：新建、合并、更新、忽略、删除候选。
3. 系统必须显示建议理由和来源摘要。
4. 用户确认后才影响长期生成。

验收：

- 自动抽取候选未确认前，不进入默认生成参考。
- 合并候选时保留用户可审计的来源摘要。

### 6.6 高级记忆诊断

P0：保留，但默认隐藏，并受开发者面板 / 高级设置开关控制。

1. 来源链继续展示 managed / user / project / local / rules / auto / durable / additional。
2. working memory 继续展示 task plan、findings、progress、error log。
3. durable recall 继续展示命中条目。
4. compaction 继续展示最新摘要和历史摘要。
5. Team Memory 继续展示 repo scoped shadow。

验收：

- 高级诊断消费 `memory_runtime_*` 输出，不自己扫描磁盘或重组事实源。
- 普通用户默认导航不出现这些诊断分区。
- 开关关闭时，不运行 hidden active recall，不展示 raw hit layer，不启动自动整理实验。

### 6.7 开发者面板记忆开关

P0：新增统一开关位，不把高级能力散落到多个普通入口。

约束：这里不是 Memory 总开关。普通用户主链仍保留低成本 baseline，包括已确认偏好、禁用列表、taste / voice summary、最小 evidence id 和当前会话上下文。开发者开关只控制高成本增强、raw trace 和外部 provider。

建议开关：

1. `memory diagnostics`：显示来源链、working memory、durable recall、compaction、Team Memory。
2. `active memory recall preview`：允许预览主动召回结果，但默认不影响普通生成。
3. `auto organization experiments`：允许试验自动整理 / dreaming 候选，但候选默认进入待整理。
4. `raw source / hit layer`：显示 provider、source bucket、hit layer、prompt excerpt 等排障字段。
5. `external memory provider`：同一时刻最多启用一个外部 provider，并显示当前 provider 状态。

默认值：全部关闭。

开启后必须满足：

1. 页面明显标识“诊断 / 实验能力”。
2. 用户能随时关闭，关闭后下一轮不再运行对应 hidden recall。
3. recalled context 必须 fenced / untrusted，不得当作用户新输入。
4. 自动候选必须经过 secret / injection scan，再进入待整理。
5. 所有命中只解释 current read model，不绕过 `unified_memory_*` 或 `memory_runtime_*`。

验收：

- 新安装或普通配置下，开发者开关全部为 off。
- 开启状态可见、可关闭、可复现。
- 关闭后不再出现 active memory debug、raw source、hit layer 或自动整理实验结果。

## 7. 数据与接口原则

### 7.1 单事实源

长期灵感：

```text
unified_memory_* -> inspiration projection -> 灵感库 UI
```

当前回合上下文：

```text
memory_runtime_* -> runtime prompt / thread preview / 高级诊断
```

长会话续接：

```text
agent_runtime_compact_session -> compaction summary -> 高级诊断 / runtime recall
```

固定规则：

**前台新增的是 projection、状态和操作，不新增平行长期记忆表。**

### 7.2 外部 provider 与召回安全

如果后续引入外部 memory provider、active memory 或自动召回实验，必须遵守：

1. built-in / current 主链始终存在；外部 provider 只能作为附加召回或实验候选。
2. 同一时刻最多一个 external provider active，避免多后端同时影响生成。
3. recalled context 必须 fenced / untrusted，并明确不是用户新输入。
4. 自动写入候选必须经过 injection / secret scan。
5. 会话中保存的长期资产不应立刻重写当前系统 prompt；应在下一次 context compile 或下一轮稳定生效。
6. 任何 provider 都不能直接成为前台 `灵感库` 的第二套事实源。

### 7.3 状态模型

灵感条目至少需要支持这些产品状态：

1. `active`：默认影响生成。
2. `disabled`：保留但不影响生成。
3. `pending_review`：自动整理候选，未确认。
4. `archived`：历史保留，不进入默认推荐。
5. `deleted`：移除，不再参与任何入口。

如果现有 `unified_memory` 不支持完整状态，Phase 1 可以先用前端 filter / metadata 字段过渡，但退出条件是进入统一持久字段或统一 metadata 约定。

## 8. 成功指标

产品指标：

1. 保存到灵感库后的二次继续率。
2. 围绕灵感继续生成的启动率。
3. 用户主动编辑 / 禁用 / 删除次数。
4. 自动整理建议确认率。
5. 结果保存后推荐命中率。

质量指标：

1. 误召回投诉下降。
2. 重复灵感条目下降。
3. 空态到首条灵感的时间下降。
4. 普通用户页面底层术语曝光为 0。
5. 默认关闭状态下 active memory / raw recall / auto organization 运行次数为 0。

工程指标：

1. `unified_memory_*` 仍是唯一长期事实源。
2. `memory_runtime_*` 仍是唯一运行时记忆读模型。
3. 新增前台能力不新增旁路扫描磁盘逻辑。
4. 文档与测试覆盖普通层 / 高级层分离。

## 9. 风险

1. 过度隐藏诊断层，导致研发排障困难。
   - 缓解：保留高级入口和 evidence 导出。

2. 自动整理误写入长期灵感。
   - 缓解：先进入待整理，用户确认后才影响生成。

3. 灵感库变成历史垃圾桶。
   - 缓解：只保存可复用对象，提供禁用、归档、合并。

4. 前台 projection 和底层 category 语义漂移。
   - 缓解：把映射写进 roadmap 和测试，不新增第二套 category。

5. 普通用户无法理解“影响生成”。
   - 缓解：解释必须用创作者语言，不用 runtime 字段名。

6. 默认关闭导致团队误以为不用建设底层能力。
   - 缓解：把默认关闭解释为 rollout 策略，不是架构裁剪；后台仍建设审计、fenced recall、provider 生命周期和用户控制。

## 10. 发布原则

1. 先改信息架构和口径，再扩自动能力。
2. 先让用户能控制，再让系统更多自动保存。
3. 先做结果保存闭环，再做多模态导入。
4. 先隐藏诊断默认入口，不删除诊断能力。
5. active memory / auto organization / raw hit layer 先走开发者开关，默认关闭。
6. 每一阶段都必须保持 `memory_runtime_*` / `unified_memory_*` 主链不分叉。
