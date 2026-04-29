# Warp 对照多模态管理验收标准

> 状态：current planning source  
> 更新时间：2026-04-29  
> 目标：为 [implementation-plan.md](./implementation-plan.md) 提供可验证场景，避免“参考 Warp”停留在架构口号。

## 1. 总体验收口径

本文件里的 `@` 命令场景是验收样本，不是开发顺序。

开发顺序必须先证明底层 `ModalityRuntimeContract`、模型能力矩阵、execution profile、artifact graph、executor adapter 和 LimeCore policy 可用，然后再验证 `@` 命令是否只是薄入口。

本路线图完成后，任意多模态入口都必须回答：

1. 用户从哪里触发？
2. 前端补了什么 structured metadata？
3. Agent 首刀应该做什么？
4. 需要哪些模型能力？
5. 需要哪些权限？
6. 谁是真正 executor？
7. 唯一 truth source 是什么？
8. 结果落成什么 artifact kind？
9. viewer 如何打开？
10. evidence pack 导出什么？
11. LimeCore 提供了什么目录或策略？
12. 失败时如何解释和降级？

只要有一项回答不清，该入口就不能算 current 完成。

额外约束：

1. 上层入口不得直接创建任务、写 artifact 或决定 viewer。
2. 上层入口不得直接决定模型和权限。
3. 上层入口只能补 launch metadata，并绑定到底层 contract。

## 2. `@配图` 验收

必须证明：

1. 原始用户消息进入 Agent turn。
2. 前端只补 `harness.image_skill_launch` 或后续同构 contract metadata。
3. Agent 首刀调用 `Skill(image_generate)`。
4. 如果尚未拿到 `task_id/path/status`，必须继续调用 `lime_create_image_generation_task`。
5. 模型路由要求 `image_generation` 能力。
6. 结果落 `image_task` / `image_output`，不重复镜像成普通文件卡。
7. viewer 打开图片工作台或图片详情，不由聊天消息伪造完成。
8. evidence pack 能看到 task、model routing、artifact、timeline。

禁止：

1. 前端直建图片任务绕过 Agent。
2. 首刀先走 ToolSearch / WebSearch / Read / Glob / Grep 找技能。
3. 回退旧 Bash CLI 作为 current 首发路径。

## 3. `@浏览器` 验收

必须证明：

1. 入口生成 `browser_requirement` 或同构 contract metadata。
2. 模型路由要求 `browser_reasoning`。
3. 权限 profile 检查 `browser_control`。
4. 执行动作是 typed browser/computer action。
5. 每次关键动作产生 observation：screenshot、DOM、network 或 URL state。
6. timeline 展示真实 browser tool 过程。
7. evidence pack 导出 browser trace。
8. 禁用 browser_control 时给出阻断或询问，不回退 WebSearch 假装完成。

禁止：

1. 把浏览器需求改写成普通搜索。
2. 只输出文字总结，不保留可复查 evidence。
3. 让 viewer 从 UI 状态反向定义执行事实。

## 4. `@读PDF` 验收

必须证明：

1. 前端补 `pdf_read_skill_launch` 或同构 contract metadata。
2. Agent 首刀调用 `Skill(pdf_read)`。
3. 本地路径场景检查 `read_files` 权限。
4. 输入 PDF 是 attachment，不是 output artifact。
5. 输出为 `pdf_extract` 或文档 artifact，带页码/引用/来源。
6. viewer 能打开抽取结果并回到原文件引用。
7. evidence pack 能导出 read/extract timeline。

禁止：

1. 前端本地直接解析后伪装成 skill 结果。
2. 把 PDF 抽取结果只作为普通聊天文本保存。

## 5. `@配音` / `@转写` 验收

必须证明：

1. `@配音` 走 `service_scene_launch(scene_key=voice_runtime)` 或后续同构 contract。
2. `@转写` 走 transcription contract，不和普通文件读取混淆。
3. 模型路由分别识别 `voice_generation` / `audio_transcription`。
4. 媒体上传、读取和生成权限进入 profile。
5. 输出区分 `audio_task`、`audio_output`、`transcript`。
6. 音频 artifact 带时长、mime、来源、任务状态。
7. evidence pack 能导出媒体任务与产物。

禁止：

1. 回流旧本地 TTS 测试命令作为 current。
2. 把音频输出只当通用文件卡。

## 6. `@搜索` / `@深搜` / `@研报` 验收

必须证明：

1. `@搜索` 只补 research launch metadata，首刀 `Skill(research)`。
2. `@深搜` 同样走 research skill，但 contract 标明多轮扩搜要求。
3. `@研报` 首刀 `Skill(report_generate)`。
4. Web search 权限进入 profile。
5. 搜索过程进入 tool timeline。
6. 研报结果落 `report_document`，不是只留聊天总结。
7. evidence pack 能区分 search events 与 report artifact。

禁止：

1. 前端伪造“已搜索完成”。
2. 深搜只作为普通搜索加强文案。
3. 研报由前端本地拼接。

## 7. `/scene-key` 验收

必须证明：

1. Scene 目录优先来自 LimeCore `client/scenes` 或 `bootstrap.sceneCatalog`。
2. 客户端 seeded/fallback 只做韧性兜底。
3. Scene 入口生成 `service_scene_launch` 或同构 contract。
4. 默认仍由 Lime 本地执行，除非 scene 明确声明 cloud run。
5. cloud run 场景进入 LimeCore audit。
6. 本地执行场景进入 Lime evidence pack。
7. 目录缺失、权限缺失、策略禁用都有清晰降级。

禁止：

1. 继续长期维护客户端第二份产品型 `/scene` 静态定义。
2. 把 LimeCore 误写成所有 Scene 的默认执行器。

## 8. 模型路由验收

必须证明：

1. 每个入口都能生成 capability requirements。
2. `CandidateModelSet` 根据 capability 过滤候选。
3. 用户显式锁定模型时仍做能力校验。
4. 租户 policy 可以禁用某类能力或模型。
5. 候选为空时输出 capability gap。
6. 候选唯一时输出 `single_candidate_only`，不宣传智能优选。
7. routing decision 写入 thread read 和 evidence。

## 9. Artifact / Viewer 验收

必须证明：

1. viewer 只消费 artifact graph 或 runtime truth source。
2. artifact kind 能决定 viewer surface。
3. 空内容文件不自动成为用户可见结果卡。
4. 用户点击轻卡能打开对应 viewer。
5. 流式写入文档类 artifact 才允许自动抢焦点。
6. artifact 能回到原 turn/task/model routing/evidence。

## 10. LimeCore 协同验收

必须证明：

1. `client/skills` / `client/scenes` 能覆盖在线目录。
2. bootstrap 下发目录后，客户端不重复维护业务定义。
3. model catalog / provider offer 进入 routing constraints。
4. Gateway 调用使用 current `https://llm.limeai.run` 入口，不回流 `/gateway-api`。
5. Scene cloud run 只在明确 cloud 执行时发生。
6. LimeCore audit 与 Lime evidence 通过关联键能互相解释。

## 11. 最小回归集

每次推进本路线图，至少选择相关命令：

1. 文档/contract 改动：`npm run harness:doc-freshness` 或等价文档检查。
2. command/runtime contract 改动：`npm run test:contracts`。
3. UI 可见改动：相关 `*.test.tsx` 与 `npm run verify:gui-smoke`。
4. 模型路由改动：相关 Rust / TS 路由测试与 thread read 断言。
5. LimeCore 接口改动：同步改 LimeCore OpenAPI、SDK、类型与客户端消费测试。

最终收口前，至少跑：

```bash
npm run verify:local
```
