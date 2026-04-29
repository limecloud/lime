# Warp 可借鉴模式清单

> 状态：current research reference  
> 更新时间：2026-04-29  
> 目标：把 Warp 中对 Lime 有明确工程价值的模式列成可复查清单，避免后续讨论只停留在“Warp 很先进”这类抽象判断。

## 1. 可直接借鉴的模式

### 1.1 Run Identity First

Warp 任何长任务都尽量回到 run/task/conversation 身份。

Lime 借鉴方式：

1. 多模态入口创建时先绑定 `session_id / thread_id / turn_id / task_id / content_id`。
2. artifact、viewer、evidence、LimeCore audit 都只消费这些关联键。
3. 没有关联键的结果不得升为 current artifact。

### 1.2 Profile = Model + Permission

Warp 的 profile 同时管理模型角色和权限边界。

Lime 借鉴方式：

1. 把模型路由、权限、自动/询问策略合并进 `ModalityExecutionProfile`。
2. `browser_control`、`media_upload`、`local_cli`、`web_search` 都作为 profile 权限面。
3. 租户策略和用户设置合并时保留可解释来源。

### 1.3 Harness Adapter Contract

Warp 的第三方 CLI harness 不是自由 shell，而是有 validate/start/save/exit/resume 的 adapter。

Lime 借鉴方式：

1. 所有 `local_cli` binding 都必须声明 adapter contract。
2. adapter 输出必须回写同一 truth source。
3. 不支持 resume/cancel/progress/artifact 的 adapter 要显式标注能力缺口。

### 1.4 Attachment 与 Artifact 分离

Warp 把输入附件与输出产物拆开管理。

Lime 借鉴方式：

1. 用户给的图片/PDF/音频/URL 是 input attachment。
2. 模型或工具生成的图片/音频/文档/截图是 output artifact。
3. 中间结果进入 timeline，不默认污染最终 artifact 区。

### 1.5 Typed Computer Use

Warp 的 computer use 是 typed action，而不是“模型说要点击哪里就点击哪里”。

Lime 借鉴方式：

1. Browser Assist 动作必须结构化。
2. 截图、DOM、网络、权限、用户确认都进入事件链。
3. 浏览器执行器和搜索执行器必须分开。

### 1.6 Skill Provider Precedence

Warp 支持多生态 skill 目录并按优先级去重。

Lime 借鉴方式：

1. LimeCore online catalog 是 current 目录事实源。
2. 客户端 seeded/fallback 是韧性兜底。
3. 项目/用户/外部生态 skill 进入 provider precedence，而不是散落在 parser。

### 1.7 Task Index 可查询

Warp 的 task CLI 支持按状态、来源、执行地点、skill、model、artifact type、时间、query 过滤。

Lime 借鉴方式：

1. 多模态任务中心要支持按 modality、skill、model、status、artifact kind 查询。
2. Chat UI 只是消费面，不是唯一任务入口。
3. 任务索引应服务恢复、复盘、成本审计和客服诊断。

## 2. 只借鉴原则，不照搬实现的模式

### 2.1 Terminal as Substrate

Warp 的 terminal substrate 对开发者任务成立，但 Lime 不应照搬成终端中心产品。

Lime 应借鉴的是：

1. 执行 substrate 可以很强。
2. 前台不必暴露 substrate。
3. 多模态创作主舞台仍应是 `生成 / 工作区 / viewer`。

### 2.2 Oz Cloud Agent

Warp 的 Oz 是它的云端 agent 平台。

Lime 应借鉴的是：

1. 云端 run 需要身份、审计、artifact、message、resume。
2. LimeCore 可承接目录、Gateway、Scene run 与策略。
3. 但普通 ServiceSkill 不应默认迁成云端代跑。

### 2.3 External CLI Agent

Warp 的 Claude/Gemini harness 适合开发者机器。

Lime 应借鉴的是 adapter 边界，不是把线上产品能力都塞进 CLI。

固定判断：

1. CLI 适合 owner 联调、developer integration、显式本地执行。
2. 正式产品链路优先用 structured API / tool / ServiceSkill binding。
3. CLI 不能成为 current 多模态能力的偷懒入口。

### 2.4 Generic File Artifact

Warp 的 `FILE` artifact 对开发者场景够用。

Lime 不能只照搬 `FILE`，因为：

1. 图片工作台需要变体、种子、尺寸、参考图、编辑链。
2. 音频需要时长、音色、字幕、波形、版权。
3. PDF 需要页码、引用、抽取片段。
4. 浏览器需要 URL、截图、DOM、网络、操作回放。

Lime 应借鉴 artifact 事实源原则，而不是 artifact 枚举粒度。

## 3. 不应借鉴的模式

1. 用终端组织所有前台体验。
2. 为了接外部 CLI 而放松权限策略。
3. 把模型 provider 当成前台主导航。
4. 把通用文件卡作为所有多模态结果的默认展示。
5. 把云 agent 当作所有能力的默认执行位置。
6. 把开源贡献流程和产品内任务流程混为一谈。
7. 让多 harness 并存变成用户需要理解的产品概念。

## 4. 对 Lime 文档和实现的约束

后续任何“参考 Warp”的提案，必须回答四个问题：

1. 借鉴的是哪一层：identity、profile、harness、artifact、task index、computer use、skill registry 还是 cloud/local split？
2. Lime 的 current truth source 是什么？
3. 这项借鉴是否会把 `limecore` 误写成客户端本地执行器？
4. 这项借鉴是否会让 `@` / `/scene` 回流成 parser 分支和自由 Bash？

如果回答不清，就不应进入 roadmap。
