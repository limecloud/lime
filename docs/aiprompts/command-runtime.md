# Lime 命令运行时实施手册

## 这份文档回答什么

本文件定义 Lime 中 `@` 原子命令、产品型 `/` 场景命令及其结果卡 / viewer 的实施规则，主要回答：

- 什么时候一个需求已经属于“命令运行时改动”，而不是普通 UI 或普通 skill 改动
- `@`、`/`、`skill`、`ServiceSkill`、`task`、`viewer` 之间的固定关系是什么
- 服务端统一目录与客户端 seeded / fallback 应该如何配合
- 为什么命令能力不能“先写代码再补 PRD”
- 新增一个命令功能时，最少要先补哪些设计文档
- 公共设计包和单功能方案包分别放在哪里

它是 **命令运行时的长期指导文档**，不是某个单一功能的 PRD。

## 什么时候先读

遇到以下任一情况时，先读本文件，再决定是否开始改代码：

- 新增或调整 `@` 命令
- 新增或调整产品型 `/` 场景命令
- 把某个能力接到“聊天轻卡 + 右侧查看区”主链
- 调整 `ServiceSkill` 与 slash 场景的关系
- 调整配图、视频、转写、修图这类异步 task 型能力
- 调整命令恢复、作用域、重试、取消、viewer 描述
- 想为某个能力补“完整方案包”

如果当前需求已经涉及“命令触发 -> Agent 分析 -> binding -> 轻卡 -> viewer”其中两步以上，就默认属于命令运行时改动。

## 固定产品判断

Lime 的命令体系固定按以下关系理解：

1. `@` 是能力原子入口  
   它表达“系统具备什么能力”，不是最终执行器类型。

2. `/` 是场景组合入口  
   它表达“为了某个用户目标，系统如何把多个能力编排起来”。

3. `ServiceSkill` 是成熟场景真相  
   首页场景卡、产品型 slash、slot filling、delivery 语义优先对齐 `ServiceSkill`。

4. `skill` 是能力绑定抽象  
   它背后可能是：
   - 本地 CLI
   - 服务端 API
   - 混合链路
   - 本地 runtime

5. `task file` 只是异步媒体/资源能力的真相之一  
   它不是所有命令的统一产品真相。

6. UI 的正式消费对象是统一 `CommandRunSnapshot`  
   聊天区轻卡和右侧 viewer 不应直接绑定底层 task、run 或原始响应结构。

## 固定主链

所有命令能力统一按这条主链设计：

`命令触发 -> Agent 分析 -> skills / tools / workflow / task / ServiceSkill binding -> 聊天区轻量结果卡 -> 右侧查看区`

这条主链意味着：

- Agent 是编排层
- binding 是执行分发层
- truth source 是状态事实层
- 轻卡是用户第一反馈层
- viewer 是详情查看层

对图片任务再补一条固定约束：

`@配图/@修图` 原始文本必须先进入 Agent turn，再由 `harness.image_skill_launch` 辅助首刀 `Skill(image_generate)`；不要把 current 主链重新改回前端预翻 slash skill 或前端直建任务。

不要再把命令能力直接叙述成：

- “前端某个按钮直接调接口”
- “某个工作台自己维护一套状态”
- “viewer 自己推断任务状态”

## 统一目录与兜底规则

命令运行时的可发现性必须统一收敛到同一份目录协议，而不是前端各处各写一份静态数组。

当前固定规则如下：

1. `SkillCatalog.entries` 是当前统一目录投影。
2. `entries.kind=command` 驱动 `@` 原子命令。
3. `entries.kind=scene` 驱动产品型 `/` 场景命令。
4. `entries.kind=skill` 驱动首页技能卡、技能中心、启动推荐和补参入口。
5. 在线主路径优先消费：
   - `bootstrap.skillCatalog`
   - `GET /v1/public/tenants/{tenantId}/client/skills`
6. 客户端必须保留本地 seeded catalog 作为韧性兜底：
   - 未登录
   - 服务端未升级
   - 远端拉取失败
   - 返回 legacy `items` 但未返回 `entries`
7. 如果服务端暂时只返回 legacy `items`，客户端允许在网关层兼容构造 `entries`，但这只是 compat 过渡，不是新的长期事实源。
8. 输入区、提及面板、slash 场景面板、首页技能入口都应消费同一份 catalog selector；不要继续在组件内维护第二套硬编码命令列表。
9. 如果服务端下发了 Lime 尚未支持的展示类型，优先由服务端回退到已有 `renderContract`；客户端也必须退化到通用 `tool_timeline` 或 `artifact` 展示，而不是直接失能。

当前 `scene` slash 的第一刀执行也固定如下：

- `useWorkspaceSendActions` 先识别 `/scene-key ...`
- 再通过 `useWorkspaceServiceSkillEntryActions.handleRuntimeSceneLaunch(...)` 从本地缓存 `SkillCatalog.entries` 里解析 `scene`
- 客户端按 `linkedSkillId -> ServiceSkillHomeItem` 复用已有 `ServiceSkill` 启动链，而不是新增一套 scene 执行器
- 若云端 `cloud_scene` 在创建 run 之前就失败，例如缺少会话、服务端暂不可达，客户端要自动回退到本地工作区 prompt 主链，不能让 `/scene-key` 直接失能
- 未命中统一目录的 slash 文本必须继续回到普通 slash 流程，不能被错误吞成“未找到本地 Skill”

一句话：

> 目录发现要服务端优先，但体验稳定性必须由客户端 seeded/fallback 托底。

## 四种产品分型

新增命令前，必须先判断它属于哪一种产品分型：

### 1. `Agent + Task`

适合：

- `@配图`
- `@修图`
- `@重绘`
- `@视频`
- `@转写`

特点：

- 异步
- 耗时
- 可恢复
- 有结构化结果

其中图片类能力当前已经有额外运行时纪律：

- `@配图` / `@修图` / `@重绘` 的 current 主链必须保留原始用户消息进入 Agent
- 前端只负责补 `harness.image_skill_launch` 这类结构化上下文，不负责预翻成 slash skill
- Agent 首刀优先调用 `Skill(image_generate)`，再由 skill / CLI / task file 链路继续执行
- 聊天区轻卡与 viewer 只消费后端真实运行态，不伪造“已完成”

### 2. `Agent + ServiceSkill`

适合：

- `/复刻短视频`
- `/每日获取趋势赛题`
- `/账号自动增长`

特点：

- 场景化
- 有 slot schema
- 有 run / delivery / managed 语义

当前客户端第一刀收口规则：

- `/scene-key` 不再直接落回本地 slash skill 预处理
- 先按统一目录找到 `scene` 与其 `linkedSkillId`
- 复用现有 `ServiceSkill` 启动主链
- 云端首提失败时自动回退本地工作区，保证 seeded/fallback 仍可推进

### 3. `Agent + Workflow`

适合：

- `@技能中心`
- `@工作流`
- `@浏览器`

特点：

- 更像打开一个工作区或会话型工作流
- 不一定需要独立异步任务协议

### 4. `Agent + Prompt`

适合：

- `@总结`
- `@翻译`
- `@分析`

特点：

- 首期轻量
- 可以先不独立恢复
- 后续可升级为更重的形态

## 公共设计包在哪里

命令运行时的公共实施设计包统一在：

- `docs/roadmap/gongneng/command-runtime/roadmap.md`
- `docs/roadmap/gongneng/command-runtime/architecture.md`
- `docs/roadmap/gongneng/command-runtime/flowcharts.md`
- `docs/roadmap/gongneng/command-runtime/sequences.md`
- `docs/roadmap/gongneng/command-runtime/code-structure.md`
- `docs/roadmap/gongneng/command-runtime/feature-document-standard.md`

它们负责定义：

- 总体架构
- 主流程图
- 关键时序图
- 前后端代码分层
- 单功能方案包标准

如果是“所有命令共享的规则”，应更新这里，而不是写回单个功能 PRD。

## 单功能方案包规则

从现在开始，命令运行时相关功能默认必须先有完整方案包，再进入正式实现。

单功能目录统一放在：

`docs/prd/gongneng/<feature>/`

最少包含：

- `prd.md`
- `architecture.md`
- `flowcharts.md`
- `sequences.md`
- `code-structure.md`
- `tasks.md`

当前已落地或已定型的完整功能包包括：

- `docs/prd/gongneng/peitu/`
- `docs/prd/gongneng/xiutu/`

旧平铺文档如果仍保留，只能作为 compat 索引，不再作为 current 主文档。

## 新增命令功能的标准步骤

### 1. 先判产品分型

先明确它是：

- `Agent + Task`
- `Agent + ServiceSkill`
- `Agent + Workflow`
- `Agent + Prompt`

如果这一步说不清，禁止直接开始实现。

### 2. 先判 binding family 和 executor kind

至少要明确：

- 主 binding family 是什么
- 是否涉及 `skill`
- 如果涉及 `skill`，背后是 CLI、API 还是 hybrid
- 底层 truth source 是什么

### 2.5 先判目录来源与兜底策略

至少要明确：

- 这项能力是否需要出现在统一 `SkillCatalog.entries`
- 它是 `command`、`scene` 还是 `skill`
- 对应目录项由 `limecore client/skills` 下发，还是暂时由客户端 seeded
- 服务端未返回该目录项时，客户端如何回退
- 如果这项能力依赖新 render type，Lime 当前是否已经支持

### 3. 先补方案包

方案包至少要回答：

- Agent 如何判断
- 如何补参
- 目录项由谁下发，客户端如何兜底
- 轻卡长什么样
- viewer 看什么
- scope / 恢复 / 重试 / 取消怎么做
- 前端改哪里
- Rust / Tauri 改哪里
- 哪些路径是 current，哪些只是 compat

### 4. 再进入实现

实现时优先遵守：

- 不继续扩 compat / deprecated 路径
- 新入口优先落在 current 主路径
- viewer 只吃统一 snapshot
- 结果卡与 viewer 语义保持一致

### 5. 实现后回挂

实现完成后，要回写：

- 当前事实源
- compat / current / deprecated / dead 分类
- 测试与 GUI 冒烟结果

## 与 `commands.md` 的分工

两份文档不要混用：

- `docs/aiprompts/commands.md`
  - 关注 Tauri 命令边界、`safeInvoke`、`generate_handler!`、mock 与契约同步

- `docs/aiprompts/command-runtime.md`
  - 关注命令运行时产品模型、公共设计包、单功能方案包、轻卡 / viewer / truth source 关系

如果本轮改动既改命令边界，又改命令运行时主链，两份都要看。

## 与质量门禁的关系

命令运行时改动的最低质量要求，除了常规校验外，还要回答：

1. 是否已有完整方案包
2. 是否明确产品分型、binding family、executor kind、truth source
3. 是否覆盖轻卡、viewer、恢复、重试、取消
4. 是否需要 `npm run test:contracts`
5. 是否需要 `npm run verify:gui-smoke`

详细质量门禁继续以 `docs/aiprompts/quality-workflow.md` 为准。

## 当前实施纪律

从 2026-04-05 起，命令运行时相关工作默认遵守以下纪律：

1. 先设计包，后实现
2. 公共规则放公共设计包
3. 单功能能力放单功能方案包
4. compat 文档不再继续长 current 细节
5. 每一刀都要能回挂路线图主线

## 一句话判断标准

如果一个改动会让某个能力“从输入被触发，到在聊天区出现轻卡，再到右侧查看区打开详情”，那它就不是普通小改动，而是命令运行时改动，必须先按本文件与公共设计包收口。
