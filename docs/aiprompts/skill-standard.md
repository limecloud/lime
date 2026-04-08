# Lime Skills 标准

## 这份文档回答什么

本文件定义 Lime 仓库里 `skill` 能力的统一工程标准，主要回答：

- Lime 自己认可的 skill 标准长什么样
- `skill`、`adapter`、`runtime binding` 的边界分别是什么
- 为什么外部 `SKILL.md` 仓库只能作为说明层参考，不能直接成为 Lime 的正式标准
- 以后新增 Claw 业务技能、站点技能、提示词技能时，应该如何保持一致

它是 **Lime 技能能力的总标准文档**。

其中：

- [site-adapter-standard.md](site-adapter-standard.md) 是站点适配器子标准
- 本文负责技能总模型、事实源、分发和 UI 表达边界

## 第一原则

**Lime 有自己的 skills 标准。来源可以多个，但标准只能有一个。**

对 Lime 来说，可以同时存在：

- 服务端下发的技能目录
- 仓库内 seeded 技能目录
- 外部项目提供的 `SKILL.md` / YAML / adapter 来源

但 Lime 内部继续演进的标准只能有一套。

从现在开始，技能能力的唯一长期事实源应收敛到：

> `Lime Skill Spec`

外部仓库只能提供：

- 说明层模板
- 来源层原料
- 触发语义参考

不能直接提供：

- Lime 的运行时协议
- Lime 的分发协议
- Lime 的 UI 表达标准
- Lime 的自动化与浏览器行为边界

## 什么时候先读

出现以下任一情况时，先读本文件，再决定是否写代码：

- 想新增一个 Claw 业务技能
- 想把站点 adapter 封装成业务 skill
- 想新增 prompt-only 技能或说明型技能
- 想扩展服务端 `serviceSkillCatalog` / 未来 `skillCatalog`
- 想修改 `ServiceSkillItem`、`ClientServiceSkillCatalog` 或对应 UI 入口
- 想讨论 skill 与 adapter、Tool Hub、Scene、Claw 的边界
- 发现仓库里开始出现多套 skill 定义、多套入口术语或多套运行语义

如果问题已经缩小到站点适配器字段、脚本、导入和执行，先回到 [site-adapter-standard.md](site-adapter-standard.md)。

## 非目标

本标准明确不负责以下目标：

- 定义另一套浏览器 runtime
- 让外部 `SKILL.md` 直接成为 Lime 运行时协议
- 把 adapter 当成 skill 本体
- 为了兼容来源而长期维护第二套 skill 协议
- 在第一阶段把所有既有实现一次性重命名重构完

尤其不要把“支持更多技能”误解成：

- 再造一个平级的 `service skill` 协议
- 再造一个平级的 `site skill` 协议
- 再造一个平级的 `prompt package` 协议

## 第二原则

**Skill 是 bundle，不是单一 Markdown。**

Lime 在工程上必须明确接受这一点：

- Skill 可以有主说明文件
- 但 Skill 的价值不应只存在于主说明文件
- references、examples、assets、templates、scripts、data、config、memory 都可以是 Skill 的组成部分

也就是说，Skill 不只是“告诉模型做什么”，还应当有能力承载：

- 领域知识
- 模板与示例
- 可执行脚本
- 验证步骤
- gotchas
- setup 信息
- 长期记忆

如果一个 Skill 只有一段说明文字，没有任何额外知识、资产、脚本、验证或渐进披露结构，那么它更接近提示词说明，而不是强 Skill。

## 设计原则补充

除了分层边界，Lime Skill 在设计上还应遵守下面几条补充原则。

### 1. 不要重复模型默认知道的常识

Skill 最有价值的内容，是把模型从默认思路里“推出来”。

应该优先写：

- 组织独有规则
- 项目独有约束
- 常见踩坑点
- 质量判断标准

### 2. 高信号内容优先写成 gotchas

如果某个 Skill 经常失败，先补 gotchas，而不是先补更长的背景介绍。

### 3. 优先使用渐进披露

主文件负责：

- 触发
- 路由
- 总规则

详细内容优先拆到：

- `references/`
- `examples/`
- `templates/`
- `scripts/`

不要把所有内容都塞进单一说明文件。

### 4. 能用脚本和模板解决的，不要全靠自然语言重复描述

给 Skill 提供脚本、模板、示例，通常比在说明中反复描述更稳。

### 5. 需要长期使用的 Skill，应考虑 setup、memory 与 hooks

高价值 Skill 往往不是一次性调用。

设计时要考虑：

- 是否需要用户配置
- 是否需要项目级配置
- 是否要记录历史执行结果
- 是否存在只在调用期间启用的 hooks

## 标准分层

Lime 的技能标准必须分成四层：

### 1. 说明层

作用：

- 回答“这是什么技能、何时使用、依赖什么、怎么触发”
- 给用户、模型、运营和后台治理看得懂

来源可以参考外部 `SKILL.md` 的优点，例如：

- `name`
- `description`
- `when to use`
- `setup`
- `examples`

但说明层不是 Lime 的运行时事实源。

### 2. 输入层

作用：

- 定义技能参数、默认值、校验和补参表单

当前主承载结构是：

- `src/lib/api/serviceSkills.ts` 里的 `ServiceSkillItem`
- `slotSchema`
- `readinessRequirements`

新增技能时，优先补结构化输入字段，不要继续把参数要求散落在 prompt 和按钮文案里。

固定边界：

- `slotSchema` / `readinessRequirements` 是技能补参真相
- `a2ui` 只允许作为 GUI 渲染层，把缺失信息映射成表单
- 不要把 `a2ui` 结构直接写进 skill catalog、runtime metadata 或协议字段

### 3. 运行时层

作用：

- 定义技能最终走哪种执行器

当前允许的主执行绑定为：

- `agent_turn`
- `browser_assist`
- `automation_job`
- `cloud_scene`
- `native_skill`

运行时层回答的是“怎么执行”，不是“对用户如何命名”。

### 4. 分发层

作用：

- 定义技能如何被服务端发布、客户端缓存、bootstrap 注入和独立刷新

当前已存在的事实源包括：

- Lime 本地 seeded catalog
- `client/service-skills`
- `bootstrap.serviceSkillCatalog`

长期目标应收敛到统一的 `client/skills` 与 `bootstrap.skillCatalog`，但兼容期内允许保留现有 `serviceSkillCatalog` 投影。

## 统一对象关系

Lime 技能能力必须明确区分三个对象：

### 1. Skill

作用：

- 面向用户和产品表达业务入口
- 解决“为什么用、何时触发、输出去哪”

### 2. Adapter / Tool

作用：

- 提供底层站点、工具或外部能力的执行工件
- 解决“怎么访问、参数是什么、脚本怎么跑”

### 3. Runtime Binding

作用：

- 把 skill 绑定到具体执行面
- 解决“最终交给谁执行”

### 4. Scene Skill

作用：

- 把产品型 slash scene 组织成可复用的技能流程
- 解决“为了达成一个目标，需要按什么步骤驱动 skill / adapter / runtime”

固定规则：

- `/scene` 的长期真相是 `Scene Skill`，不是前端 if/else，不是单站点特判
- `site-adapter` 只能作为 `Scene Skill` 某一步的执行提供者，不能反客为主变成 scene runtime 本体
- 缺失信息时，优先由 `Scene Skill` 产出结构化 gate request，再由 GUI 层映射成 `a2ui`
- gate request 负责“缺什么、补什么、补完后怎么恢复”；`a2ui` 只负责“怎么收集”
- `Scene Skill` 产生的过程默认应回到当前 assistant 对话流里；如果 runtime 为了稳定性做了 preload、预检查或首刀绑定，这些步骤也要回放成对话内联过程，而不是只写隐藏 prompt 或额外工具卡

推荐模式组合：

- 主模式优先用 `Pipeline`
- 缺参或门禁用 `Inversion`
- 产物结构化输出用 `Generator`
- 封装站点 / CDP / 浏览器能力用 `Tool Wrapper`
- 只有在确实需要产物复核时再叠加 `Reviewer`

必须遵守：

- adapter 不是 skill
- skill 可以引用 adapter，但 adapter 不能冒充 skill
- 一个 skill 只能有一个主执行绑定
- 多 adapter 编排不属于普通 site skill，属于后续 scene / orchestration 范畴

## Lime Skill Spec v1

### 1. 技能分类

第一阶段只允许三类技能：

- `service`
- `site`
- `prompt`

含义如下：

- `service`
  - 业务交付型技能，通常产出主稿、方案、报告、草案
- `site`
  - 业务语义入口，但底层依赖 adapter / 站点工件执行
- `prompt`
  - 说明型或提示词型技能，强调触发语义和使用约束，不强制要求结构化 runtime

### 2. 统一信息清单

无论哪一类技能，新增时都必须回答以下信息。

#### 身份字段

- `id`
- `skillKey`
- `version`
- `source`

#### 展示字段

- `title`
- `summary`
- `entryHint`
- `aliases`
- `category`
- `outputHint`

#### 触发字段

- `surfaceScopes`
- `triggerHints`

说明：

- 当前结构化模型尚未正式包含 `triggerHints`
- 在结构化字段补齐前，新增技能也必须在服务端模板或伴随文档中写清楚，不允许缺失

#### 输入字段

- `slotSchema`
- `default values`
- `validation`

#### 执行字段

- `defaultExecutorBinding`
- `executionLocation`
- `readinessRequirements`

#### 运行时引用字段

- `siteCapabilityBinding`
- `promptTemplateKey`
- 未来可扩展的 `toolHubBinding`

#### 产物字段

- `defaultArtifactKind`
- `output destination`

说明：

- 产品投影层可以直接提供 `outputDestination`
- 标准摘要层统一收敛到 `skillBundle.metadata.Lime_output_destination`
- 新增技能时必须明确写清结果会回到：当前主稿、资源文档、工作区消息、自动化结果还是云端运行结果

#### 说明字段

- `usageGuidelines`
- `setupRequirements`
- `examples`

说明：

- 这些字段可以先由服务端模板或说明文档承接
- 长期目标是结构化，而不是永久只写在 README / prompt 里

## 执行绑定标准

### 1. `agent_turn`

适用于：

- Claw 业务技能
- 结构化 prompt + 当前工作区继续执行

要求：

- 输出是业务结果，不是“进入某个工作台”
- 不能把底层技术入口当成用户动作文案

### 2. `browser_assist`

适用于：

- 必须依赖真实浏览器登录态或页面上下文的技能

要求：

- 业务 skill 可以引用 adapter
- 不能把“浏览器工作台 / 调试面板”作为主产品语义
- 不允许隐式后台自动化

### 3. `automation_job`

适用于：

- 定时或持续跟踪技能

要求：

- 必须说明首轮结果、后续调度、失败处理和结果回流方式

### 4. `cloud_scene`

适用于：

- 必须由云端托管执行的技能

要求：

- 客户端默认只做目录消费、提交和结果回流
- 不把普通本地即时技能错误迁成云端必跑

## UI 表达标准

技能 UI 必须表达业务动作，而不是暴露底层实现。

### 1. 卡片与入口

每个 skill 卡片至少要能回答：

- 这是什么
- 何时用
- 怎么执行
- 需要什么依赖
- 结果去哪

### 2. 启动弹窗

启动弹窗统一应包含：

- 技能摘要
- 补参表单
- 执行方式说明
- 依赖条件说明
- 结果写入位置说明

### 3. 文案禁止项

禁止把以下内容直接当成主产品术语：

- 浏览器工作台
- 调试面板
- 脚本目录
- runtime debug
- adapter 执行器

这些只能作为实现说明，不能作为用户主动作文案。

## 分发与事实源标准

### 标准层与产品层的边界

当前必须明确区分两件事：

- `skillBundle`
  - 对外对齐 Agent Skills 思路的**标准摘要层**
  - 负责表达：`name`、`description`、`license`、`compatibility`、`metadata`、`allowedTools`
  - 以及 Lime 运行时真正需要的标准状态：`resourceSummary`、`standardCompliance`
- `ServiceSkillCatalog` / `ClientServiceSkillCatalog`
  - Lime 面向 Claw / 工作区 / 启动弹窗的**产品投影层**
  - 负责表达：卡片文案、补参表单、执行绑定、结果去向、主题目标、自动化入口等业务语义

强约束：

- 不要把 `ServiceSkillItem` 上的产品展示字段误认为标准本体
- 也不要把外部 `SKILL.md` 原文直接当成 Lime 客户端协议
- 标准层与产品层可以共存，但标准层必须有唯一投影：`skillBundle`

### 当前事实源

客户端现状：

- 本地 seeded `SkillCatalog`
- `bootstrap.skillCatalog`
- `client/skills`
- `client/service-skills` compat 投影
- `siteAdapterCatalog`

服务端现状：

- `control-plane-svc` 负责客户端统一技能目录聚合
- Tool Hub 方向负责 tool / adapter 工件真相源

### 长期收敛方向

长期收敛规则固定如下：

1. 统一技能目录继续收敛到 `client/skills`
2. `bootstrap.skillCatalog` 与独立刷新必须消费同一份目录协议
3. `SkillCatalog.entries` 必须承载三类统一目录项：
   - `skill`
   - `command`
   - `scene`
4. `client/service-skills` 只允许作为 compat 投影继续保留，不再承接新的目录标准定义
5. adapter / tool 工件目录继续独立，不与 skill 目录混用

### 统一目录补充分层

`SkillCatalog.entries` 是分发层的 current 投影，但它不改变 skill 的产品与执行边界：

- `skill` 目录项回答“这是一个什么业务能力”
- `command` 目录项回答“用户可以通过哪个 `@` 原子入口触发它”
- `scene` 目录项回答“用户可以通过哪个 `/` 场景把多个能力编排起来”

固定约束：

- `/` 场景不是新的客户端硬编码系统，而是统一目录中的 `scene`
- `@` 命令不是独立于 skill 的第二套协议，而是统一目录中的 `command`
- `command` / `scene` 可以绑定到 skill、CLI、服务端 API 或 hybrid executor，但绑定规则仍属于运行时层
- Lime 客户端必须保留 seeded catalog 作为 offline / degrade 兜底，不能只依赖服务端在线目录

## 外部 `SKILL.md` 参考边界

外部 `SKILL.md` 仓库对 Lime 只有三类帮助：

- 触发语义怎么写更清楚
- `when to use / setup / examples` 怎么组织更清楚
- 说明层如何让人和模型都容易理解

它不能直接成为：

- Lime 的目录协议
- Lime 的执行绑定协议
- Lime 的客户端 UI 标准
- Lime 的租户分发标准

一句话：

> 外部 `SKILL.md` 只可借“说明书结构”，不可借“产品标准定义权”。

## 新增技能的最低检查单

新增一个技能时，至少要回答以下问题：

1. 它属于 `service / site / prompt` 哪一类
2. 它的主执行绑定是什么
3. 它是否依赖 adapter、浏览器、模型、项目或云端运行
4. 它的结果会写回哪里
5. 它的用户主动作文案是否仍然是业务语义，而不是底层实现
6. 它是否继续沿用当前主目录协议，而不是再造平级协议
7. 如果它引用 adapter，是否仍然遵守 [site-adapter-standard.md](site-adapter-standard.md)

## 当前主链

当前新增能力的主链固定如下：

- 在线目录：继续收敛到 `client/skills` 与 `bootstrap.skillCatalog`
- 本地兜底：继续收敛到 seeded `SkillCatalog`
- compat 投影：仅在迁移期保留 `client/service-skills`
- 标准摘要层：继续收敛到 `skillBundle`
- 站点工件目录：继续收敛到 `siteAdapterCatalog`
- 业务 skill 引用站点能力：通过 `siteCapabilityBinding.adapterName`

对输入面板和启动入口再补一条固定约束：

- `entries.kind=command` 驱动 `@`
- `entries.kind=scene` 驱动产品型 `/`
- `entries.kind=skill` 驱动首页技能入口与技能中心
- 服务端未返回 `entries` 时，客户端允许由 compat `items` 投影构造，但不得继续在组件层手写平行常量

不要在这个阶段再引入：

- 平级 `skill.json` 目录协议
- 平级 Markdown-only 技能协议
- 平级浏览器技能协议

## 相关文档

- [overview.md](overview.md)
- [site-adapter-standard.md](site-adapter-standard.md)
- [commands.md](commands.md)
- [quality-workflow.md](quality-workflow.md)
- [limecore-collaboration-entry.md](limecore-collaboration-entry.md)
