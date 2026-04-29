# Warp 对照下的 Lime 多模态管理路线图

> 状态：current planning source  
> 更新时间：2026-04-29  
> 目标：吸收 Warp 开源客户端在 Agent Harness、Execution Profile、Artifact、Attachment、Task Index 与 Cloud/Local 分层上的可借鉴原则，把 Lime 的多模态能力收敛成统一运行合同，而不是继续按 `@` 命令和单点 viewer 分散扩张。

## 1. 本路线图回答什么

本目录统一回答下面几类问题：

1. Lime 如何先建立底层多模态运行合同，再把 `@配图`、`@配音`、`@浏览器`、`@读PDF`、`@搜索` 等上层入口绑定上来。
2. Lime 如何把模型路由升级为多模态 capability matrix，而不是只看 provider/model id。
3. Lime 如何建立 `ModalityExecutionProfile`，把模型角色、权限、执行器策略、LimeCore 租户策略合并解释。
4. Lime 如何把图片、音频、PDF、浏览器、网页、PPT、报告等结果纳入领域化 artifact graph。
5. LimeCore 云服务应该补什么：目录、模型 offer、Gateway policy、Scene policy、audit；不应该抢什么：本地 ServiceSkill 与桌面执行主链。

## 2. 参考事实源

外部研究：

1. [../../research/warp/README.md](../../research/warp/README.md)
2. [../../research/warp/architecture-breakdown.md](../../research/warp/architecture-breakdown.md)
3. [../../research/warp/architecture-diagrams.md](../../research/warp/architecture-diagrams.md)
4. [../../research/warp/sequences.md](../../research/warp/sequences.md)
5. [../../research/warp/flowcharts.md](../../research/warp/flowcharts.md)
6. [../../research/warp/agent-harness-and-multimodal-management.md](../../research/warp/agent-harness-and-multimodal-management.md)
7. [../../research/warp/borrowable-patterns.md](../../research/warp/borrowable-patterns.md)
8. [../../research/warp/lime-gap-analysis.md](../../research/warp/lime-gap-analysis.md)
9. [../../research/warp/claudecode-compatibility.md](../../research/warp/claudecode-compatibility.md)

Lime 现有事实源：

1. [../../aiprompts/command-runtime.md](../../aiprompts/command-runtime.md)
2. [../task/README.md](../task/README.md)
3. [../../aiprompts/harness-engine-governance.md](../../aiprompts/harness-engine-governance.md)
4. [../../aiprompts/limecore-collaboration-entry.md](../../aiprompts/limecore-collaboration-entry.md)
5. [../limenextv2/README.md](../limenextv2/README.md)

## 3. 固定结论

### 3.0 ClaudeCode 是主参考，Warp 是补充参考

本路线图不改变 Lime 的主参考顺序：

1. Agent loop、tool protocol、permission、slash command、SkillTool、AgentTool、subagent task 优先参考 `/Users/coso/Documents/dev/js/claudecode`。
2. Execution profile、harness adapter、artifact/attachment 分离、computer use、task index、cloud/local 分层参考 Warp。
3. GUI、viewer、LimeCore 边界、本地优先执行以 Lime current 规划为准。

固定裁决：

**如果 ClaudeCode 与 Warp 在同一问题上表面冲突，Agent 内循环按 ClaudeCode，多模态运行治理按 Warp，产品形态按 Lime。**

### 3.1 多模态管理首先是底层合同管理

`@` 命令、按钮、Scene 都是上层入口，不是底层事实源。

底层必须先声明：

```text
runtime identity
  -> input context
  -> required capabilities
  -> execution profile
  -> model routing
  -> binding / executor
  -> truth source
  -> artifact graph
  -> evidence events
  -> viewer
```

然后上层入口只做绑定：

```text
@command / button / scene
  -> launch metadata
  -> ModalityRuntimeContract
```

如果某个入口需要绕过底层合同才能工作，它就不能算 current。

### 3.2 模型层必须服从任务层和权限层

模型选择顺序固定为：

```text
TaskProfile
  -> Modality capability requirements
  -> CandidateModelSet
  -> User / tenant / profile constraints
  -> RoutingDecision
  -> limit_state / cost / fallback reason
```

不能只因为某模型“更强”就绕过权限、预算、OEM 策略和用户显式锁定。

### 3.3 LimeCore 是云事实源，不是默认执行器

LimeCore 负责：

1. `client/skills`
2. `client/scenes`
3. `bootstrap.skillCatalog`
4. `bootstrap.sceneCatalog`
5. Provider offer
6. model catalog
7. Gateway runtime policy
8. Scene run policy / audit
9. 租户级 feature / permission / branding

Lime 负责：

1. 本地工作区
2. Agent turn
3. 本地 ServiceSkill
4. Browser Assist
5. 文件与媒体处理
6. viewer
7. 本地 artifact 与 evidence 主链

固定约束：

**云端优先配置，本地优先执行；只有显式云 run / Gateway call / 托管连接器才进入 LimeCore 执行面。**

### 3.4 Artifact 必须领域化

Lime 的 artifact graph 不应只有 `document` / `file`。

首批 current domain kind：

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

通用文件只作为兜底，不作为多模态默认主结果。

## 4. 目录文档分工

1. [runtime-fact-map.md](./runtime-fact-map.md)
   - Phase 0 底层运行事实源地图，明确 current / compat / deprecated / dead 分类。
2. [contract-schema.md](./contract-schema.md)
   - Phase 1 `ModalityRuntimeContract` 字段语义与机器校验入口。
3. [capability-matrix.md](./capability-matrix.md)
   - Phase 2 多模态能力矩阵、模型角色槽位与 capability gap 口径。
4. [implementation-plan.md](./implementation-plan.md)
   - 分阶段开发计划、改动面、验收输出和验证入口。
5. [evolution-guide.md](./evolution-guide.md)
   - Lime 自下而上的演进总图、泳道图、阶段门禁和每轮收口模板。
6. [acceptance.md](./acceptance.md)
   - 关键场景验收标准，防止路线图停留在抽象层。

当前机器可检查事实源：

1. `src/lib/governance/modalityRuntimeContracts.json`
2. `src/lib/governance/modalityCapabilityMatrix.json`
3. `scripts/check-modality-runtime-contracts.mjs`
4. `npm run governance:modality-contracts`

后续如果继续推进，再按需新增：

1. `artifact-graph.md`
2. `limecore-integration.md`
3. `browser-computer-use.md`
4. `migration-map.md`

## 5. 分阶段总览

| 阶段 | 目标 | 主产物 |
| --- | --- | --- |
| Phase 0 | 盘点底层运行事实源 | runtime fact map |
| Phase 1 | 建底层运行合同 schema | `ModalityRuntimeContract` + governance check |
| Phase 2 | 扩展模型能力矩阵 | modality capability matrix + routing evidence |
| Phase 3 | 建统一 execution profile | model roles + permission profile + tenant override |
| Phase 4 | 领域化 artifact graph | domain artifact kinds + viewer mapping |
| Phase 5 | 建 executor / Browser typed action 边界 | executor adapter + browser evidence |
| Phase 6 | LimeCore 目录与策略接线 | cloud catalog + model offer + Gateway/Scene policy |
| Phase 7 | 绑定上层入口 | `@` / button / scene launch mapping |
| Phase 8 | 任务索引与复盘 | modality task index + audit + replay hooks |

## 6. 当前必须避免的误区

1. 把 Warp 参考理解成“把 Lime 改成终端产品”。
2. 把多模态管理理解成“加更多模型/provider”。
3. 把 LimeCore 理解成“所有 `@` 命令的云执行器”。
4. 把 CLI harness 当作 current 首发捷径。
5. 把 artifact graph 降级成更多文件卡。
6. 把 `@` 命令盘点误当成底层建设起点。
7. 在没有底层运行合同前继续新增 `@` 命令。
8. 让 viewer 自己猜 truth source。

## 7. 这一步如何服务主线

本路线图的直接主线收益只有一句话：

**它把 Lime 当前已经存在但分散在 runtime identity、skill、task、viewer、模型设置、LimeCore bootstrap 和 evidence 里的多模态能力，先收敛成底层运行合同，再让 `@` 命令等入口复用这条 current 主线。**
