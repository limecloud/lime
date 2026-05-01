# 灵感库 / 记忆系统目标架构

> 状态：current architecture plan  
> 更新时间：2026-05-01  
> 目标：在不新增长期记忆事实源的前提下，把底层 memory runtime 翻译成普通用户可理解的灵感库产品层。

## 1. 架构原则

### 1.1 单事实源

长期灵感只认：

```text
unified_memory_*
```

运行时记忆只认：

```text
memory_runtime_*
```

会话压缩只认：

```text
agent_runtime_compact_session
```

前台 `灵感库` 是 projection，不是新存储主链。

Ribbi 产品形态对应的内部事实源是：

```text
taste / reference / memory / feedback -> context compile -> 单主生成容器
```

这里的 taste / reference / memory / feedback 是后台编译对象，不是普通用户默认导航。

### 1.2 前后台分层

```text
普通用户前台
  -> 灵感库 projection
  -> 风格 / 参考 / 成果 / 偏好 / 收藏
  -> 继续生成 / 编辑 / 禁用 / 删除

开发者面板 / 高级诊断后台
  -> feature gate 默认关闭
  -> memory_runtime_* stable read model
  -> 来源链 / working memory / durable recall / Team Memory / compaction / active recall trace
```

固定规则：

**普通用户前台不解释底层如何命中，只解释这条灵感如何帮助下一轮生成。**

### 1.3 高级能力默认关闭，但 Memory baseline 常开

这些能力必须受开发者面板或高级设置控制，默认 off；这不等于关闭 Lime 的基础记忆能力：

1. active memory / 自动召回预览。
2. raw source / hit layer / provider 诊断。
3. auto organization / dreaming 实验。
4. external memory provider。

常开的 baseline：

1. 已确认偏好、禁用列表、taste / voice summary cache。
2. 当前会话工作上下文和短摘要。
3. 少量 durable memory top-k 或 evidence id。
4. 条目级删除、禁用、归档和影响解释。

默认关闭的架构理由：

1. 防止普通用户感到系统“擅自记住并使用”。
2. 避免误召回直接污染生成结果。
3. 保护隐私、prompt cache 稳定和可审计边界。
4. 给团队留下 trace / rollback / evaluation 的安全缓冲。

### 1.4 Claude Code 架构映射

| Claude Code 层 | Lime 底层 | Lime 前台 |
| --- | --- | --- |
| `CLAUDE.md` / rules | 规则来源链 | 我的方法 / 创作规则 |
| auto-memory | 自动抽取候选 | 待整理灵感 |
| session memory | working memory | 这轮正在做什么 |
| persistent memory | unified memory | 灵感库 |
| compaction | session compaction | 继续上一轮 |
| `/memory` | 高级诊断入口 | 设置 / 高级 / 诊断 |

## 2. 当前事实源分类

### 2.1 `current`

这些路径共同构成 current 主链：

1. `docs/aiprompts/memory-compaction.md`
2. `src/lib/api/memoryRuntime.ts`
3. `src-tauri/src/commands/memory_management_cmd.rs`
4. `src-tauri/src/services/memory_source_resolver_service.rs`
5. `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
6. `src/lib/api/unifiedMemory.ts`
7. `src-tauri/src/commands/unified_memory_cmd.rs`
8. `src/components/memory/inspirationProjection.ts`
9. `src/components/agent/chat/utils/saveSceneAppExecutionAsInspiration.ts`
10. `src/components/agent/chat/utils/curatedTaskRecommendationSignals.ts`

事实源声明：

**长期创作者资产收敛到 `unified_memory_*`；当前回合上下文收敛到 `memory_runtime_*`；前台灵感库只做投影与操作编排。**

### 2.2 `compat`

这些路径仍可保留，但不能继续定义主链：

1. `src/lib/api/memory.ts`
2. `src-tauri/src/commands/memory_cmd.rs`
3. `src/lib/workspace/projectPrompt.ts`

定位：

- 只承接项目资料、角色、世界观、大纲等附属层。
- 不新增长期灵感能力。
- 不新增 runtime recall 能力。

### 2.3 `deprecated`

这些路径不应继续扩张：

1. 独立 memory feedback 链。
2. 任何重新恢复独立记忆反馈前端页的实现。
3. 新增平行 `inspiration_*` CRUD 以绕开 `unified_memory_*` 的实现。

### 2.4 `dead`

本路线图不新增 dead 分类；后续若清理本地备份残留，按 `docs/aiprompts/governance.md` 执行。

## 3. 目标分层

### 3.1 Presentation Layer

职责：

1. 展示灵感对象。
2. 提供继续生成、编辑、禁用、删除、整理动作。
3. 将底层类别翻译成创作者语言。
4. 将推荐信号解释成可行动建议。

不允许：

1. 自己扫描磁盘构造记忆。
2. 自己重组 durable recall。
3. 自己决定 runtime prompt 应该注入什么。

### 3.2 Projection Layer

职责：

1. `UnifiedMemory -> InspirationProjectionEntryViewModel`。
2. `UnifiedMemory[] -> InspirationTasteSummaryViewModel`。
3. 根据禁用、归档、待整理状态过滤默认推荐对象。
4. 生成普通用户影响解释。

关键对象：

```text
InspirationProjectionEntry
  id
  title
  summary
  projectionKind
  tags
  influenceState
  influenceReason
  nextActions
```

### 3.3 Action Orchestration Layer

职责：

1. 保存结果到灵感库。
2. 记录推荐信号。
3. 构造 launcher prefill。
4. 合并 reference selection。
5. 同步 `生成 -> 灵感库 -> 生成` 闭环。

当前入口：

1. `saveSceneAppExecutionAsInspiration(...)`
2. `recordCuratedTaskRecommendationSignalFromMemory(...)`
3. `buildCuratedTaskReferenceEntries(...)`
4. `buildMemoryEntryCreationReplayRequestMetadata(...)`

### 3.4 Durable Memory Layer

职责：

1. 长期灵感 CRUD。
2. 统计、列表、搜索。
3. 从对话候选抽取结构化长期记忆。
4. 被 runtime durable recall 消费。

固定入口：

```text
unified_memory_*
```

### 3.5 Runtime Memory Layer

职责：

1. turn 前 prefetch。
2. working memory 聚合。
3. durable recall。
4. Team Memory shadow。
5. latest compaction。
6. prompt augmentation。

固定入口：

```text
memory_runtime_prefetch_for_turn
memory_runtime_get_working_memory
memory_runtime_get_extraction_status
```

### 3.6 Feature Gate Layer

职责：

1. 统一控制 `memory diagnostics`、`active memory recall preview`、`auto organization experiments`、`raw source / hit layer`、`external memory provider`。
2. 保证默认关闭。
3. 保证开关状态可见、可关闭、可用于测试断言。
4. 保证开关只改变展示 / 实验运行，不改变 `unified_memory_*` 与 `memory_runtime_*` 的事实源地位。

不允许：

1. 每个组件各自维护一套诊断开关。
2. 开关开启后绕过 current API 直接扫描磁盘或拼 prompt。
3. 多个 external provider 同时 active。

### 3.7 Advanced Diagnostics Layer

职责：

1. 给开发者、内测和客服解释上下文命中。
2. 提供来源链、压缩、命中历史、memdir 状态。
3. 不参与普通用户默认体验。

固定规则：

**高级诊断只读 current read model，不成为新事实源。**

### 3.8 External Provider Boundary

职责：

1. built-in / current 主链始终存在。
2. 同一时刻最多启用一个 external provider。
3. provider 输出进入 fenced / untrusted recall block。
4. provider 写入候选先经过 secret / injection scan 与待整理队列。
5. provider 生命周期挂在统一 manager / gateway，不在前台组件散落实现。

不允许：

1. 外部 provider 直接写 `inspiration_*` 平行表。
2. 外部 provider 直接修改当前系统 prompt。
3. 外部 provider 在普通用户默认层展示 raw transcript。

## 4. 数据生命周期

### 4.1 保存结果

```text
结果工作台
  -> 构造 inspiration draft
  -> createUnifiedMemory
  -> record recommendation signal
  -> 灵感库 projection 刷新
  -> 推荐卡默认带上新成果
```

### 4.2 自动整理

```text
会话结束 / 后台抽取
  -> memory candidate
  -> 待整理队列
  -> 用户确认 / 合并 / 忽略
  -> create/update UnifiedMemory
  -> projection 刷新
```

### 4.3 下一轮生成

```text
用户选择灵感
  -> reference selection
  -> CuratedTaskLauncher
  -> request metadata.creation_replay
  -> runtime turn
  -> memory_runtime_prefetch_for_turn
  -> prompt augmentation
```

### 4.4 长会话续接

```text
长会话
  -> agent_runtime_compact_session
  -> compaction summary
  -> runtime prefetch
  -> 高级诊断展示
```

长会话续接默认不写入长期灵感库，除非用户显式保存或确认自动整理建议。

### 4.5 Active Memory / 高级召回实验

```text
开发者开关关闭
  -> 不运行 hidden active recall
  -> 普通生成只走现有 memory_runtime_prefetch_for_turn

开发者开关开启
  -> eligibility check
  -> active recall / external provider prefetch
  -> fenced untrusted context
  -> trace / debug 仅诊断层显示
  -> 候选写入仍进待整理
```

固定判断：active recall 是运行时增强，不是普通灵感库的新事实源。

## 5. 状态与权限

### 5.1 灵感影响状态

| 状态 | 是否默认影响生成 | 用户可见 | 说明 |
| --- | --- | --- | --- |
| `active` | 是 | 是 | 正式灵感 |
| `disabled` | 否 | 是 | 保留但不再影响生成 |
| `pending_review` | 否 | 是 | 自动整理候选 |
| `archived` | 否 | 可选 | 历史保留 |
| `deleted` | 否 | 否 | 删除 |

### 5.2 隐私规则

1. 敏感信息不得自动进入正式灵感。
2. 自动候选必须可审阅。
3. 用户删除后不得继续出现在推荐、recall 或聚焦入口。
4. 团队共享记忆不得覆盖用户私有禁用选择。
5. 引用外部资源时优先保存指针与用途，不保存凭证内容。
6. 自动写入和 provider 输出必须扫描 prompt injection、隐藏 Unicode、credential exfiltration 和敏感文件读取指令。

## 6. 与其他路线图关系

1. `limenextv2`
   - 提供前台主词、信息架构和创作者闭环。
2. `task`
   - 提供任务画像、模型路由与成本调度。
3. `warp`
   - 提供 execution profile、artifact/evidence、云本地分层参考。
4. `voice / artifacts`
   - 后续多模态素材可进入参考素材，但不能绕开 unified memory projection。

## 7. 最小实现边界

第一刀不需要重写底层，只需要完成：

1. 普通灵感库与高级诊断在 IA 上分离。
2. 普通层隐藏底层术语。
3. 灵感条目支持影响解释和禁用概念。
4. 保存结果到灵感库继续使用 current `unified_memory_*`。
5. 相关测试断言普通页面不出现 runtime 术语。
6. 开发者面板开关默认关闭，且关闭时不运行 active memory / raw recall / auto organization 实验。
