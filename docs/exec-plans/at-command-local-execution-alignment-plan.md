# `@` 命令本地执行面纠偏计划

## 摘要

本计划用于把 Lime 客户端仓库中关于 `@` 命令、产品型 `/scene`、`ServiceSkill` 的 current 文档收口到同一个正确前提：

- `limecore` 只负责目录控制、发布治理与配置同步
- `lime` 客户端负责全部执行
- 不存在服务端代跑 `@` 命令、`/scene` 或 `service skill` 的 current 主链

这份计划只覆盖客户端仓库的文档与后续本地实现收口，同时定义服务端文档完成后的跨仓校验要求。

## 背景

最近两仓围绕 Ribbi 风格统一调用面的分析，暴露出一个持续回流的错误前提：

1. 一部分文档把 `limecore` 写成了命令执行面
2. 一部分文档把 `scene runtime`、`run / poll`、`cloud_required` 继续当成 current 产品模型
3. 这会误导后续实现，把目录控制面继续扩成运行时

用户已明确产品边界：

1. 云端不会执行任何东西
2. `limecore` 只承担 `client/bootstrap`、`client/skills`、`client/service-skills` 这类目录与配置事实源
3. Lime 客户端是唯一执行面

因此，客户端 current 文档必须先于代码实现完成纠偏，否则新增 `@` 命令会继续叠加在错误边界上。

## 正确边界

### `current`

- `SkillCatalog.entries` 作为 `@ / / / skill` 的统一目录协议
- `serviceSkillCatalog` 作为完整服务型技能目录
- seeded / fallback 作为客户端韧性兜底
- `request_metadata.harness.*` 作为本地运行时路由提示
- Agent、tool、browser、workspace、task、viewer 全部留在本地执行

### `deprecated`

- `cloud_required`
- `executionLocation = cloud_required`
- `OEM Scene Runtime run / poll`
- `lime_run_service_skill` 被解释成服务端执行入口
- `cloud-video-dubbing` 这类带云语义的历史命名

### `dead`

- 服务端代跑 `@` 命令
- 服务端代跑 `/scene`
- 服务端代跑 `service skill`
- 任何把目录命中直接翻译成云端 run 的 current 叙事

## 本轮文档改动

需要优先收口以下客户端 current 文档：

1. `docs/aiprompts/commands.md`
2. `docs/aiprompts/command-runtime.md`
3. `docs/aiprompts/limecore-collaboration-entry.md`
4. `docs/roadmap/lime-service-skill-cloud-config-prd.md`

改动原则：

1. 删除或改写 `run / poll`、`cloud_required`、`scene runtime` 的 current 叙事
2. 如果现有实现或历史 ID 仍沿用旧命名，文档里要明确它只是历史命名，不代表当前边界
3. 不新发明第二套术语，统一收敛到“目录控制面 + 本地执行面”

## 后续实现顺序

### Phase 1：文档先行

- 先把 current 文档纠偏
- 在实现前统一团队和 AI 的事实源

### Phase 2：客户端代码收口

后续只在本仓库推进以下本地实现检查：

- `src/components/agent/chat/workspace/useWorkspaceSendActions.ts`
- `src/components/agent/chat/workspace/serviceSkillSceneLaunch.ts`
- `src/components/agent/chat/service-skills/*`
- `src/components/agent/chat/workspace/useWorkspaceServiceSkillEntryActions.ts`
- `src/lib/base-setup/seededCommandPackage.ts`
- `src/lib/base-setup/seededServiceSkillPackage.ts`
- `src/components/settings-v2/system/automation/serviceSkillContext.ts`

目标：

- 去掉任何 current 主链中的云端 run / poll 假设
- 保留目录命中与 metadata 注入
- 把 `@配音`、`/scene-key`、service skill launch 全部收回本地执行链

### Phase 3：服务端完成后的联调校验

服务端会由另一个进程按 `limecore/docs/exec-plans/at-command-control-plane-only.md` 推进。客户端这边在服务端文档完成后，需要补一次跨仓一致性校验。

## 校验要求

### 客户端本地校验

至少重新检查：

- `@配音`
- `/scene-key`
- `@浏览器`
- `@搜索`
- `@发布`
- `@渠道预览`

校验点：

1. 在线目录可命中
2. seeded / fallback 不失能
3. current 文档不再暗示云执行
4. 轻卡、timeline、viewer 仍以本地运行态为真相

### 跨仓校验

服务端文档完成后，再做一次双仓扫描：

- `cloud_required`
- `云执行`
- `run / poll`
- `scene runtime`
- `not_executable_in_cloud`

扫描结果必须区分为：

1. 已移除
2. 仅保留在历史参考
3. 仍误留在 current，需要继续收口

## 当前状态

- 2026-04-21：创建本计划，作为客户端纠偏的 current 执行入口
- 2026-04-21：与用户确认真实产品边界为“云端不执行，只做目录控制”
- 2026-04-21：本轮优先目标固定为“先改文档事实源，再进入客户端实现收口”
- 2026-04-21：已完成 current 文档纠偏，统一改写为“云端只做目录控制，客户端负责执行”
- 2026-04-21：已继续同步质量事实源；`quality-workflow` 中的 `@配音 / /scene-key` 校验口径已从 `OEM run/timeline` 收回到本地 `service-scene` 直驱执行与 `ServiceSkill / tool timeline`
- 2026-04-21：已继续收口 Rust `service_scene_launch` current 默认值；后端当前默认按 `local_service_skill` 解析，并只把 `cloud_scene` 当 compat alias 读取
- 2026-04-21：已完成客户端 current 主链收口，`/scene` 非站点技能与 `@配音` 不再依赖 OEM run / poll，而是统一生成本地 `composeServiceSkillPrompt(...)` 并通过工作区/Agent 本地执行
- 2026-04-21：已完成 service skill 首页、@ 提及面板、设置自动化文案的执行语义纠偏；`cloud_required` 当前只作为兼容目录标记展示，不再表示云端执行
- 2026-04-21：已继续收口 automation 设置页 current 展示；任务列表、详情弹窗和运行摘要里的 `cloud_required` 现在会显式显示为“客户端执行 + 旧目录兼容”，不再把 compat 标记伪装成当前执行真相
- 2026-04-21：已完成技能工作台 current surface 的旧云运行状态收口，`ServiceSkillHomeItem` 与技能页展示不再消费 `cloudStatus`
- 2026-04-21：已删除零入口 compat 残留 `src/components/agent/chat/service-skills/cloudRunStorage.ts` 与 `src/lib/api/serviceSkillRuns.ts`，避免旧云 run 语义继续回流
- 2026-04-21：已进一步把 current seeded package 主动产出的 `cloud_scene / cloud-scene-instant` 收掉；当前只保留历史 seeded id（如 `cloud-video-dubbing`）与 compat projection/sceneapp 中的旧命名，避免 current 目录事实源继续给云执行语义续命
- 2026-04-21：已继续收口 sceneapp current 主链；Tauri / mock sceneapp planner 产出的 `service_scene_launch.kind` 与 `execution_kind` 已统一改为 `local_service_skill`，并补 `execution_location = client_default`
- 2026-04-21：已移除 current seeded sceneapp 中额外的 `cloud_session` 启动前置，避免 sceneapp detail/runtime 继续把“云端运行时”误当成当前执行门槛
- 2026-04-21：已继续收口 sceneapp 恢复链内部命名；run summary / entry action / resume helper 中的 `cloud_scene_runtime_ref`、`cloudSceneRuntimeRef`、`open_cloud_scene_session` 已统一改成 `service_scene` 语义，并保留 Rust 侧 alias 兼容旧字段
- 2026-04-21：已完成最小交付校验，`npm run test:contracts`、定向 Vitest、`npm run verify:local`、`npm run governance:legacy-report` 全部通过
- 2026-04-21：已补充 sceneapp 定向校验；`npm run verify:gui-smoke` 与 sceneapp 定向 Vitest 已通过，Rust service-scene 新用例改名后需按当前测试名单独补测
- 2026-04-21：已继续收口 sceneapp current planner/action 命名；当前 Tauri/mock planner 改为产出 `open_service_scene_session`，旧 `launch_cloud_scene` 仅保留为 compat 反序列化输入
- 2026-04-21：已把 seeded `voice-runtime` 从 `cloud_managed` current 模型收回到本地即时类型；当前种子目录不再把它描述成“云托管场景”
- 2026-04-21：已继续收口 sceneapp runtime context；`cloud_session_ready` 不再参与 current readiness / tool refs 注入，只再保留为 compat 输入字段，避免 current planning 再把“云会话”带回执行语义
- 2026-04-21：已继续收口 sceneapp seeded/mock 原始目录展示；current `capabilityRefs`、`infraProfile` 与 composition step binding 不再主动写出 `cloud_scene / cloud_runtime`，旧 `cloud_scene` 只再保留在 service-scene adapter 锚点与 compat 输入
- 2026-04-21：已继续收口 sceneapp current entry binding；seeded/mock 里的 `story-video-suite`、`voice-runtime` 当前入口已改成 `agent_turn`，Rust/mock planner 会按 service-scene 特征继续产出 `open_service_scene_session`
- 2026-04-21：已继续收口 Rust sceneapp 内部命名；`CloudManaged / CloudScene / CloudSession / cloud_session_ready` 当前已改成内部 compat 语义名，并通过 serde 继续兼容旧外部值，避免 current 内部建模继续被旧云执行命名污染
- 2026-04-22：已补通过 Rust sceneapp 定向 lib 测试：`should_build_service_scene_adapter_plan_for_hybrid_sceneapp`、`build_sceneapp_scorecard_from_runs_should_keep_stable_scene`、`should_promote_selected_memory_entries_into_reference_items`
- 2026-04-21：已补跑本轮相关前端定向回归；`useWorkspaceSendActions`、`sceneapp` API/目录/展示与 SceneApps 页面共 8 个 Vitest 文件、154 条用例通过
- 2026-04-21：已补跑 `npm run governance:legacy-report`，结果为 `边界违规 0 / 分类漂移候选 0`
- 2026-04-21：已继续收口 sceneapp 展示层 current 边界；`presentation/product` 与 SceneApps 页面测试夹具默认改成 `agent_turn`，展示层不再主动持有 `cloud_scene` current 标签
- 2026-04-22：已继续收口 `serviceSkills / skillCatalog` 类型边界；public `ServiceSkillItem / ServiceSkillCatalog / SkillCatalogExecutionKind` 默认只暴露 current 值，`cloud_scene / cloud_required` 改为显式 compat 类型或原始输入解析层处理
- 2026-04-22：已同步更新聊天入口与技能页相关测试夹具；`service_scene_launch.kind` 当前统一改成 `local_service_skill`，服务技能 fixture 默认改成 `agent_turn + client_default`
- 2026-04-22：已补跑服务技能 / 技能目录 / 聊天入口定向回归共 11 个 Vitest 文件、206 条用例通过；随后补跑 `sceneapp` API/目录/launch 3 个 Vitest 文件、13 条用例通过
- 2026-04-22：已再次补跑 `npm run governance:legacy-report`，结果仍为 `边界违规 0 / 分类漂移候选 0`
- 2026-04-22：已把 service skill 执行位置展示语义收回 `src/lib/api/serviceSkills.ts` 单一事实源；prompt composer 当前只写“客户端执行”，automation 设置页继续通过 compat helper 单独补 `旧目录兼容` 徽标，避免旧云目录标记继续混入 current prompt 文案
- 2026-04-22：已继续收口 mock sceneapp planner 内部判断；legacy `cloudSessionReady` 输入不再把 planner 拉回 `cloud_scene` 分支，mock adapter 当前会先正规化到 `agent_turn` 后再决定是否打开 `service_scene` 会话
- 2026-04-22：已继续收口前端 `sceneapp runtime context` 内部命名；当前默认改用 `directorySessionReadyCompat` 承载 compat 会话位，`sceneapp API` 调 Tauri 前会统一回写为 `cloudSessionReady` wire alias，mock readiness 也与 Rust 一样对 `cloud_session` 保持 compat no-op
- 2026-04-22：已继续收口 SceneApps 页面 current 筛选面；目录页不再主动提供 `cloud_managed` 旧类型筛选，旧 page params / 最近访问里的 `typeFilter=cloud_managed` 现在会在 `navigation` 归一化阶段被丢弃，避免 current 页面状态继续把 compat 类型写回路由与本地存储
- 2026-04-22：已继续收口 sceneapp 展示 compat helper；`presentation/product` 当前统一通过显式 helper 解析 `cloud_managed / cloud_runtime`，workbench 统计与基础设施摘要不再各自直接消费旧云命名，compat 展示只保留在单一 helper 边界
- 2026-04-22：已继续收口 `sceneapp API` 的旧 planner 假门槛；当前网关会过滤 `launchRequirements / readiness.unmetRequirements` 里的 `cloud_session`，并把 context overlay 中的 `toolRefs.cloud_scene -> agent_turn`、`toolRefs.cloud_session -> 丢弃`，避免旧 planner 再把“云会话阻塞”显影到 current 详情页
- 2026-04-22：已继续收口 `sceneapp API` 的 compat 类型投影；旧目录 `sceneappType = cloud_managed` 当前会按绑定族与基础设施信号正规化为 `local_instant / local_durable / browser_grounded / hybrid`，不再把 compat 类型直接暴露给 current 前台对象
- 2026-04-22：已继续收口 current 测试夹具默认值；`workspace sceneapp launch`、`workspace sceneapp entry actions` 与 `automation` 的默认 SceneApp plan/descriptor 夹具已改成 `agent_turn` / 本地能力摘要，只再保留显式 compat 用例验证旧 `cloud_scene` 输入的正规化
- 2026-04-22：已继续清理 sceneapp 深层 current 测试夹具；`product` 与 `SceneAppsPage` 默认目录样板不再把 `cloud_runtime` 当作普通 `infraProfile` 基线，旧云基础设施词现在只保留给显式 compat 断言
- 2026-04-22：已继续收口 SceneApps 详情页 current 启动主链；详情页 launch 现在会优先复用当前 preview planning，`workspace_entry` 做法会继续导航到 `agent` 主链，`automation_job` 会先打开标准自动化弹窗再异步补工作区列表，避免 current UI 因重复 planning 或等待工作区列表而停在 sceneapps 自身
- 2026-04-22：已为 sceneapp launch runtime 补 unmount 保护；页面切走或测试回收后不再回流异步 `setState`，避免 current 导航链在离开 SceneApps 页后继续触发收尾更新
- 2026-04-22：已补跑 `SceneAppsPage / navigation / presentation / product / launch` 共 5 个 Vitest 文件、58 条用例，通过；`npm run governance:legacy-report` 与 `npm run verify:gui-smoke` 也已通过
- 2026-04-22：`npm run verify:local` 在 smart 批次 `src/components/agent/chat/workspace/serviceSkillSceneLaunch.test.ts` 因 `@/lib/api/serviceSkills` mock 未同步导出 `resolveServiceSkillExecutionLocationPresentation` 失败；该阻塞位于另一条 service-skill 线，不属于本轮 sceneapp 启动实现回归
- 2026-04-21：Rust 定向测试 `cargo test should_build_service_scene_adapter_plan_for_hybrid_sceneapp` 因工作区存在多路并发 `cargo test` 抢占 `target`/artifact lock，未拿到最终结果；本轮不把它记为已通过，后续需在较干净的 Rust 构建窗口补测
- 2026-04-21：已尝试用独立 `CARGO_TARGET_DIR=/tmp/lime-target-codex-sceneapp` 复测 Rust service-scene 新用例，但首次编译 `aster`/`lime` 依赖链耗时过长，本轮仍未拿到最终结果；为避免持续占用机器资源，已主动停止该测试进程，后续需在更稳定的 Rust 构建窗口补跑

## 本轮实现结果

### 已完成

- `/scene` 非站点技能：改为构造 `kind = local_service_skill` 的 request metadata，并生成本地 prompt；不再向 current 主链注入 `oem_runtime` 或云端 session 语义
- `@配音`：保留用户可见原文，但底层 dispatch 改为 `composeServiceSkillPrompt(...)` 生成的本地 prompt；metadata 同步切换到 `local_service_skill`
- service skill 入口点击：删除 current 对 `createServiceSkillRun` / `getServiceSkillRun` / run-poll 的依赖，统一进入本地工作区准备态
- 首页与提及展示：`runnerLabel`、`runnerDescription`、`actionLabel`、`outputDestination` 改为本地执行叙事；legacy `cloud_required` 只按兼容目录标记处理
- automation 设置页展示：`service skill` 任务列表、详情弹窗与运行摘要当前都会补显 `旧目录兼容` 徽标与说明文案；即使 run metadata 已被正规化为 `client_default`，只要来源 job 仍带旧目录标记，也不会在 current 展示层把 compat 信息洗掉
- Rust `service_scene_launch` 解析：当前默认 `kind` 已切到 `local_service_skill`，并允许 `cloud_scene` 只作为 compat alias 继续读取；`aster_agent_cmd` 定向测试样例也已同步改成 current 命名
- Rust `prompt_context / lime_run_service_skill`：当前系统提示已改成“本地 service-scene 直驱执行”，`lime_run_service_skill` 只再作为 compat 护栏保留，不再发 OEM `/runs` 请求
- seeded 目录：保留历史 id 以避免目录断裂，但 `@配音` 的 command binding 已切到 `agent_turn`，技能标题/摘要已改成当前本地执行语义
- sceneapp planner：Tauri 与 mock 当前改为产出 `open_service_scene_session`；旧 `launch_cloud_scene` 只作为 compat 反序列化输入保留，避免历史 planner / fixture 直接失效
- sceneapp seeded / fallback：当前目录不再额外声明 `cloud_session` 启动前置；sceneapp detail 展示会继续聚焦“目录控制面 + 客户端执行”，不再把云端运行时写成 current 门槛
- sceneapp seeded voice-runtime：当前目录模型已改成 `local_instant` + 本地执行文案；旧 `cloud_managed` 只再保留给 compat 目录输入与展示兜底
- sceneapp runtime context：当前 context compiler 不再把 `cloud_session` 注入 tool refs，且 runtime readiness 对 `cloud_session` 只按 compat no-op 处理；这样历史字段还能读，但不会再影响 current 启动判断
- sceneapp 恢复链：当前做法复盘和继续执行链已统一改为 `service_scene` 命名；旧 `cloud_scene_runtime_ref` 只再作为 Rust 反序列化 alias 保留，避免历史 run summary 数据读取失败
- mention / sceneapp 内部命名：聊天发送边界里的 usage slot 提取已统一改成 `service_scene` 语义，sceneapp current seeded/mock 目录的展示能力摘要也已改成 `agent_turn` / 本地工作区表述，避免 current 实现继续把内部变量写成“云场景”
- sceneapp current service-scene 入口：当前 seeded/mock 目录不再依赖 `entryBindings.bindingFamily = cloud_scene` 才能走本地场景执行；planner 会在 `agent_turn` current 目录下按 linked service skill / scene key 继续产出 `open_service_scene_session`
- sceneapp 展示层：`presentation/product` 与 SceneApps 页面当前测试夹具、组合步骤、入口绑定和执行摘要默认都已切到 `agent_turn`；`cloud_scene` 不再作为 current UI 文案映射保留在展示层
- `serviceSkills / skillCatalog` 类型面：公开 catalog/item/execution 类型当前只暴露 `agent_turn / client_default` 等 current 值；`cloud_scene / cloud_required` 仅再保留为 compat 输入类型与解析层归一化逻辑，避免前台 current consumer 继续把旧云执行名当作常规值处理
- 聊天入口测试夹具：`workspaceEntry / AppPageContent / slash preflight / scene launch / send actions / EmptyState` 等 current fixture 已同步改成 `local_service_skill` 与 `agent_turn` 语义，避免测试继续给旧云执行命名续命

### 仍保留为 compat / 历史锚点

- `cloud-video-dubbing`
- `cloud_scene`
- `executionLocation = cloud_required`
- `launch_cloud_scene` / `open_cloud_scene_session`

这些字段当前仍存在于历史 skill id、compat projection、sceneapp 规划与测试中，用于兼容历史目录和旧数据，不再代表 current 执行边界；其中 current seeded package 已不再主动产出 `cloud_scene / cloud-scene-instant`，sceneapp current planner 也不再主动写出 `service_scene_launch.kind = cloud_scene`。

## 下一步

- 等服务端进程完成 `limecore` 文档与目录控制面实现后，按本计划里的“跨仓校验”重新扫描双仓术语一致性
- 如果后续要继续做减法，优先清理 `sceneapp` 与 compat projection 中仍残留的 `cloud_scene` 历史命名，但这不阻塞当前客户端本地执行主链交付
