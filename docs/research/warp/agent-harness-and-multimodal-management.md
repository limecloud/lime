# Warp 的 Agent / Harness / 多模态管理启发

> 状态：current research reference  
> 更新时间：2026-04-29  
> 目标：把 Warp 里最值得 Lime 借鉴的 Agent Harness 与多模态管理结构拆清楚，尤其说明它如何帮助 Lime 收口 `@` 命令、模型路由、附件、产物与 LimeCore 云事实源。

## 1. 先修正一个误区

看到 Warp 支持 Claude Code、Codex、Gemini CLI、OpenCode，最容易产生的误解是：

**Lime 也应该把多模态能力统一改成外部 CLI 调用。**

这是错误方向。

更准确的理解是：

1. Warp 把外部 CLI 放进 harness adapter。
2. Adapter 必须遵守 runtime 的身份、环境、保存、恢复、退出和错误映射规则。
3. CLI 是 executor 的一种，不是 Agent 首刀自由选择的万能入口。

对 Lime 来说，真正应该学的是：

**执行器可以多样，但运行时合同必须统一。**

## 2. Warp 的 Harness 分层

Warp 的 harness 至少拆成四层：

```text
CLI 参数层
  -> Harness enum / config
  -> ThirdPartyHarness trait
  -> HarnessRunner per run
  -> TerminalDriver / ServerApi / Conversation persistence
```

每一层职责不同：

1. CLI 参数层
   - 选择 `--harness claude/gemini/...`
   - 接收 `--model`、`--mcp`、`--attach`、`--conversation`
2. Harness enum / config
   - 把字符串归一化成 typed harness
   - 防止 unknown harness 被用户直接选择
3. ThirdPartyHarness trait
   - 定义 validate、prepare config、resume payload、build runner
4. HarnessRunner
   - 真正负责 start/save/exit/cleanup
   - 把外部 CLI 的状态回写到 Warp conversation

对 Lime 的借鉴：

1. `local_cli` binding 必须有 typed adapter，不允许裸字符串命令成为 current 主路径。
2. 每个 executor 必须声明是否支持 resume、artifact、progress、cancel、credential、permission。
3. 不支持某项能力时要显式降级，不要伪造成功。

## 3. Warp 的多模态不是“模型多”，而是“对象多”

Warp 涉及的多模态对象包括：

1. 图片附件
2. 普通文件附件
3. screenshot artifact
4. file artifact
5. plan artifact
6. PR artifact
7. voice input / transcription
8. computer use screenshot
9. terminal block snapshot
10. web fetch / web search output

它没有把这些都塞成一种 message，而是分别落在：

1. attachment
2. referenced attachment
3. action result
4. output message
5. artifact
6. transcript / block snapshot
7. task metadata

对 Lime 的借鉴：

1. 多模态管理首先是对象管理，不是模型管理。
2. 模型路由只是在对象管理之后的执行决策。
3. 如果 artifact、attachment、viewer、evidence 没有统一身份，模型再多也只是散乱能力。

## 4. Lime 的多模态合同应如何抽象

建议 Lime 引入内部文档与代码层概念：`ModalityRuntimeContract`。

这个 contract 先描述底层多模态运行能力，再由 `@` / `/scene` / 显式按钮动作绑定上来。

每个底层 contract 都必须声明：

| 字段 | 说明 |
| --- | --- |
| `contract_key` | 例如 `image_generation`、`browser_control`、`pdf_extract` |
| `modality` | `text` / `image` / `audio` / `video` / `browser` / `document` / `code` / `mixed` |
| `runtime_identity` | `session / thread / turn / task / content / run` 关联键 |
| `bound_entries` | 可选绑定的 `@` 命令、按钮、Scene，不作为 contract 主键 |
| `first_agent_action` | 首刀必须调用的 Skill / Tool / Binding |
| `allowed_detours` | 是否允许 search、read、bash、browser 等偏航工具 |
| `required_capabilities` | 模型、工具、权限、凭证、网络、文件系统能力需求 |
| `truth_source` | task file、artifact document、runtime event、LimeCore run、local DB 等唯一事实源 |
| `viewer` | 右侧查看区或工作台消费哪类 artifact |
| `evidence_events` | evidence pack 里必须出现哪些事件 |
| `fallback_policy` | 目录缺失、模型不支持、权限缺失、云不可用时如何退化 |

这个合同的关键价值是：

1. 把当前分散的 skill / runtime / viewer / evidence 连接起来。
2. 让 `@配图` 与 `@读PDF` 虽然入口不同，但底层运行方式同构。
3. 让 LimeCore 下发目录时可以只下发 descriptor，不抢执行主链。

## 5. Warp 的 Profile 对 Lime 的启发

Warp 的 profile 把模型和权限合在一起。

Lime 应借鉴为 `ModalityExecutionProfile`：

```text
ModalityExecutionProfile
  -> model roles
  -> capability permissions
  -> executor permissions
  -> artifact policy
  -> network / file / browser / media budget
  -> tenant / OEM overrides
```

建议首批模型角色：

1. `base_model`
2. `coding_model`
3. `vision_input_model`
4. `image_generation_model`
5. `image_edit_model`
6. `audio_transcription_model`
7. `voice_generation_model`
8. `browser_reasoning_model`
9. `report_generation_model`
10. `cheap_summary_model`

建议首批权限面：

1. `read_files`
2. `write_artifacts`
3. `execute_commands`
4. `call_mcp`
5. `web_search`
6. `browser_control`
7. `media_upload`
8. `service_api_call`
9. `local_cli`
10. `ask_user_question`

固定原则：

**模型选择不能绕过权限，权限也不能假装不影响模型路由。**

## 6. Warp 的 Attachment / Artifact 对 Lime 的启发

Warp 的输入附件与输出产物分离，是 Lime 必须补强的一点。

Lime 当前应明确：

1. 输入上下文：用户拖入的图片、PDF、音频、网页 URL、选中文本、当前文稿、当前图片工作台状态。
2. 执行中间态：搜索结果、浏览器截图、OCR、转写、素材候选、模型中间输出。
3. 输出产物：图片、封面、播报音频、转写稿、研报、网页、PPT、排版文稿、浏览器会话快照。
4. 恢复事实：task json、artifact document、runtime timeline、content_id、thread events。

建议 Lime 的 artifact graph 至少区分：

1. `image_task`
2. `image_output`
3. `audio_task`
4. `audio_output`
5. `transcript`
6. `browser_session`
7. `browser_snapshot`
8. `pdf_extract`
9. `report_document`
10. `presentation_document`
11. `webpage_artifact`
12. `generic_file`

不要继续把所有二进制都降级成 `generic_file`，否则 viewer 会重复、点不开、不可审计。

## 7. Computer Use 对 Browser Assist 的启发

Warp 把 computer use 做成 typed action，并在 action 后可返回 screenshot。

Lime 的 Browser Assist 应采用同类闭环：

```text
browser_requirement
  -> permission/profile check
  -> browser actor action
  -> screenshot / DOM / network evidence
  -> tool timeline
  -> user-visible result card
  -> right viewer replay snapshot
```

固定约束：

1. 浏览器操作不是 WebSearch。
2. 浏览器截图不是普通图片产物。
3. 浏览器工具必须进入 evidence，而不是只写一段文本总结。
4. 高风险动作需要 permission profile 与用户确认策略。

## 8. Warp 的 Skill Provider 对 LimeCore 的启发

Warp 支持多个 skill provider 目录并按优先级去重。

Lime + LimeCore 可借鉴为：

1. LimeCore 下发 online catalog：`client/skills`、`client/scenes`、`bootstrap.skillCatalog`、`bootstrap.sceneCatalog`。
2. Lime 保留 seeded / fallback catalog。
3. 本地 project skills、用户自定义 skills、Codex/Claude/Gemini 生态 skills 可作为补充 provider。
4. 最终进入同一套 capability registry。

建议 provider precedence：

1. `runtime_explicit`：当前 turn 显式绑定
2. `limecore_tenant`：租户发布目录
3. `limecore_default`：Lime 默认云目录
4. `project`：当前项目目录
5. `user_home`：用户全局目录
6. `bundled_seeded`：客户端内置兜底
7. `compat_legacy`：旧入口委托

固定约束：

**LimeCore 负责目录事实源与治理，Lime 负责本地优先执行与降级韧性。**

## 9. 对当前 `@` 命令的直接映射

| Lime 入口 | Warp 可借鉴对象 | Lime current 方向 |
| --- | --- | --- |
| `@配图` / `@海报` | attachment + artifact + model capability | `image_skill_launch -> Skill(image_generate) -> image task artifact + viewer` |
| `@配音` | voice input / artifact / profile permission | `service_scene_launch(voice_runtime) -> local ServiceSkill -> audio artifact` |
| `@浏览器` | computer use typed actions + screenshot | `browser_requirement -> Browser Assist tools -> evidence + viewer` |
| `@读PDF` | attachment + file reference | `pdf_read_skill_launch -> Skill(pdf_read) -> extract artifact` |
| `@搜索` / `@深搜` | web search/fetch output messages | `research_skill_launch -> Skill(research) -> search timeline` |
| `@PPT` | plan/file artifact | `presentation_skill_launch -> presentation document artifact` |
| `/scene-key` | skill catalog + run policy | LimeCore 目录下发，Lime 本地执行或显式云 run |

## 10. 最重要的结论

Warp 对 Lime 的核心启发只有一句：

**不要按模态堆功能；要按运行合同管理模态。**

如果 Lime 能把每个多模态入口都收敛到同一套 `entry -> profile -> routing -> binding -> artifact -> evidence -> viewer`，那么模型、工具、LimeCore 云目录、外部 CLI、MCP 都可以逐步扩张，而不会把产品主链打散。
