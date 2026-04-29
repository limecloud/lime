# Warp 对照 Lime 的缺口分析

> 状态：current research reference  
> 更新时间：2026-04-29  
> 目标：明确 Lime 当前在多模态管理、模型路由、Harness 与 LimeCore 协作上相对 Warp 暴露出的真实缺口，供 `docs/roadmap/warp/` 制定开发计划。

## 1. 总判断

Lime 当前不是缺少能力。

更准确的判断是：

**能力已经很多，但多模态能力还没有完全收敛到统一运行合同。**

Lime 已经有：

1. `harness.*_skill_launch` 系列入口
2. image task artifact 与图片工作台
3. Browser Assist / MCP / workspace tools
4. task profile / routing decision / limit state 的初步模型经济调度
5. evidence pack / replay / analysis / review 主链
6. LimeCore bootstrap / client skills / scenes / Gateway / model catalog 协作方向

但相对 Warp 的稳定骨架，Lime 还缺少四个收口：

1. `ModalityRuntimeContract` 没有成为显式事实源。
2. Profile 尚未同时覆盖“模型角色 + 多模态权限 + executor 策略”。
3. Artifact graph 还不够区分多模态领域产物。
4. Task / run / evidence / LimeCore audit 的关联键还没有覆盖所有多模态入口。

## 2. Lime 已经接近 Warp 的部分

### 2.1 Agent 主链已经成立

Lime 的 command runtime 已经明确：

```text
命令触发 -> Agent 分析 -> skills / tools / workflow / task / ServiceSkill binding -> 轻卡 -> viewer
```

这和 Warp 的 Agent conversation 主线是一致的。

### 2.2 图片主链已有正确方向

`@配图/@修图/@重绘` 已经要求：

1. 原始用户消息进入 Agent turn
2. 前端只补 `harness.image_skill_launch`
3. Agent 首刀调用 `Skill(image_generate)`
4. 最终落标准 image task artifact + worker
5. viewer 消费真实运行态，不伪造完成

这是 Lime 最接近 Warp artifact/attachment 分层的一条链。

### 2.3 模型经济调度已有底座

`docs/roadmap/task/` 已经固定：

1. 任务层永远存在
2. 模型层不等于多模型层
3. 设置不是唯一事实源
4. 自动必须与设置平衡
5. 成本/限额是 runtime 事实

这和 Warp 的 `LLMInfo + AIExecutionProfile` 思路可以对齐。

### 2.4 LimeCore 协作边界已有原则

现有跨仓库约束已经明确：

1. LimeCore 负责云端控制面、登录、目录、Provider Offer、模型目录、Gateway、Scene Catalog。
2. Lime 负责本地工作区、交互、本地技能执行与运行时体验。
3. `client/skills` 和 `client/scenes` 是在线目录事实源。
4. 不要把 LimeCore 误写成 `@` / `/scene` / service skill 的执行器。

这是对 Warp cloud/local 分层的正确本地化。

## 3. Lime 当前偏弱的地方

### 3.1 多模态入口合同分散

当前很多入口已经有规则，但规则散在：

1. parser
2. frontend metadata assembly
3. runtime turn
4. skill prompt
5. task artifact
6. viewer
7. quality workflow 文档

缺口：

**没有一张机器可检查的 contract 表说明每个入口的首刀、能力需求、truth source 和 viewer。**

风险：

1. 新增 `@` 命令容易复制旧模式。
2. 前端可能重新直建任务。
3. Agent 可能先跑 ToolSearch / WebSearch / Bash 偏航。
4. viewer 可能伪造结果或抢焦点。

### 3.2 模型能力矩阵不够多模态

当前 task/model 路由已存在，但多模态能力标签还需要补强：

1. vision input
2. image output
3. image edit
4. audio input
5. audio output
6. browser reasoning
7. local file extraction
8. structured report generation
9. long context
10. cheap summarization

缺口：

**模型候选集还不应只看 provider/model id，而要看任务所需 modality capability。**

### 3.3 权限与模型策略仍可能分裂

Lime 有 provider、service model、OEM offer、local runtime、MCP、browser、file、CLI 等多类配置。

缺口：

**缺少 Warp `AIExecutionProfile` 式的统一运行 profile，把模型角色、权限、allowlist、tenant policy 合并解释。**

风险：

1. 用户以为禁用了某能力，但 skill 内部仍绕路执行。
2. 某模型支持图片，但当前权限不允许媒体上传，路由仍硬撞。
3. LimeCore 下发默认模型后，客户端本地设置继续成为第二事实源。

### 3.4 Artifact 粒度还需领域化

图片任务已较清晰，但其他模态还容易退化为普通文本或文件：

1. 音频结果
2. PDF 抽取
3. 浏览器截图
4. 网页生成
5. PPT / 演示稿
6. 研报
7. 视频/素材候选

缺口：

**artifact graph 需要明确 domain kind，不应只有 generic file/document。**

### 3.5 Browser Assist 需要独立高风险闭环

Warp 的 computer use 提醒我们：浏览器/桌面操作需要独立 action model。

缺口：

1. 浏览器动作和 WebSearch 的边界必须更硬。
2. browser evidence 应包含 screenshot/DOM/network/action trace。
3. 用户确认策略应进入 profile，而不是散在工具实现。

### 3.6 Task Index 与运行审计不够统一

Warp 的 task CLI 可以按 state、source、execution-location、skill、model、artifact type 查。

Lime 目前更多从聊天线程和局部 task 文件恢复。

缺口：

**多模态任务需要统一索引，以服务任务中心、复盘、成本、审计、客服诊断。**

## 4. current / compat / deprecated / dead 分类

### 4.1 current

这些方向应继续强化：

1. `Agent turn -> harness metadata -> Skill first action -> typed tool/task -> artifact -> viewer`
2. `TaskProfile -> CandidateModelSet -> RoutingDecision -> limit_state`
3. `LimeCore catalog / model offer / Gateway policy` 作为云端配置事实源
4. `evidence pack` 作为运行事实导出
5. image task artifact + worker 主链
6. Browser Assist 作为独立工具时间线与 evidence 面

### 4.2 compat

这些可以保留，但不能承载新逻辑：

1. 旧 `Bash -> lime media image generate --json`
2. 旧 `lime task create image --json`
3. `/gateway-api` 旧代理入口
4. 客户端 seeded/fallback 目录
5. 旧 service skill run/poll 语义
6. 旧 artifact 通用文件卡展示

### 4.3 deprecated

这些应逐步退出：

1. 前端按入口单独维护任务构建逻辑
2. skill 内部自由决定是否调用 Bash
3. viewer 自己猜测 artifact 类型和完成状态
4. 模型设置、service_models、OEM defaultModel 各自独立决定运行模型
5. Browser Assist 回退成 WebSearch 或普通聊天解释

### 4.4 dead

这些方向不应再进入新规划：

1. 为每个多模态功能新建一套独立 session / task / viewer 旁路
2. 把 LimeCore 改成所有 `@` 命令的默认执行器
3. 把第三方 CLI 当作产品 current 执行入口
4. 用普通文件卡承载所有图片/音频/浏览器/PDF 结果
5. 把多模型宣传当作模型路由事实

## 5. 对开发计划的直接要求

`docs/roadmap/warp/` 必须把这些缺口收成可执行计划：

1. 先做底层 runtime fact map，再做代码扩张。
2. 先补 contract、字段和事实源，再补页面体验。
3. 先让底层多模态 contract 同构，再把现有 `@` 命令绑定上来。
4. 先证明 artifact / evidence / viewer 能共用 truth source，再谈自动任务中心。
5. LimeCore 只补 catalog、policy、model offer、audit，不抢本地执行。

一句话：

**Warp 对照下，Lime 下一步不是加更多能力，而是把现有能力纳入一个可验证的多模态运行合同。**
