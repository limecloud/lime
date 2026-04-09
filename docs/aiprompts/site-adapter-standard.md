# Lime 站点适配器标准

## 这份文档回答什么

本文件定义 Lime 仓库中站点适配器能力的唯一工程标准，主要回答：

- Lime 自己认可的站点适配器标准长什么样
- 外部来源为什么不能直接成为 Lime 的事实源
- 站点适配器应该如何接入、执行、校验与治理
- 如何避免因为接入外部适配器库而把 Lime 做成“万国牌”

它是 **站点适配器能力的工程标准文档**，不是某个外部项目的引入说明书。

如果讨论的是 Skills 总模型、`skill / adapter / runtime binding` 总边界，先读 [skill-standard.md](skill-standard.md)，再回到本文。
如果讨论的是网页登录态访问、长文导出、Markdown 落盘、图片下载这类浏览器场景编排，再补读 [web-browser-scene-skill.md](web-browser-scene-skill.md)。

## 第一原则

**Lime 有自己的标准。来源可以有多个，但标准只能有一个。**

对 Lime 来说：

- 可以有多个 adapter 来源
  - 仓库内手写
  - 服务端下发
  - 外部项目导入
- 但 Lime 内部只能存在一个继续演进的适配器标准

从现在开始，站点适配器能力的唯一事实源应收敛到：

> `Lime Site Adapter Spec`

外部项目只能提供“原料”，不能提供 Lime 的运行时标准、协议标准或状态标准。

换句话说：

- 可以接更多来源
- 不能接更多“标准”
- 不能让来源格式反过来定义 Lime 的产品边界

如果某个外部来源和 Lime 标准冲突，优先保留 Lime 标准，而不是为了兼容把 Lime 改成第二套产品。

## 什么时候先读

出现以下任一情况时，先读本文件，再决定是否写代码：

- 想新增一个站点适配器
- 想从外部项目导入适配器
- 想扩展站点适配器字段、参数类型或执行语义
- 想调整 `site_*` 命令族的输入输出结构
- 想新增第二套站点执行引擎、pipeline 或 bridge
- 发现站点采集能力开始出现多套定义、多套错误语义或多套运行时

如果问题已经上升为“业务 skill 如何引用 adapter、服务端如何下发统一技能目录、用户入口应该如何表达”，先回到 [skill-standard.md](skill-standard.md)。

## 非目标

本标准明确不负责以下目标：

- 定义另一套浏览器 runtime
- 为外部项目保留原生执行模型
- 支持所有外部适配器语义的 100% 兼容
- 为了“接得更多”而放松 Lime 的产品边界

尤其不要把“支持更多站点”误解成：

- 再引一套 daemon
- 再引一套浏览器扩展协议
- 再引一套站点 pipeline runtime

## 标准分层

Lime 的站点适配器能力必须分成三层：

### 1. 来源层

作用：

- 提供原始 adapter 定义
- 可以来自仓库内、服务端或外部项目

特点：

- 不直接参与 Lime 执行
- 不直接决定 Lime 错误语义
- 不直接决定 Lime 前端展示模型

### 2. 编译层

作用：

- 把来源层 adapter 转换为 Lime 标准
- 做字段收敛、语义校验、步骤白名单检查

特点：

- 是外部来源进入 Lime 的唯一入口
- 是站点适配器治理边界
- 负责拒绝不符合 Lime 标准的来源 adapter

### 3. 执行层

作用：

- 执行已经被编译为 Lime 标准的适配器

特点：

- 只能使用 Lime 当前浏览器执行主链
- 不允许外部来源自带执行内核绕过 Lime runtime

## Lime Site Adapter Spec v1

Lime 内部适配器标准至少包含以下字段语义：

- `name`
  - 唯一标识，推荐 `site/name` 形式
- `domain`
  - 目标站点主域名
- `description`
  - 面向用户和开发者可读的说明
- `read_only`
  - 是否只读
- `capabilities`
  - 当前适配器暴露的能力标签
- `args`
  - 已归一化后的参数定义
- `example`
  - 最小可运行示例
- `auth_hint`
  - 登录态或上下文要求
- `entry`
  - 入口 URL 规则
- `script`
  - Lime 当前唯一执行脚本
- `source_kind`
  - 来源类型，例如 `bundled` / `server_synced` / `imported`
- `source_version`
  - 来源版本号或快照标识

现有实现的主承载结构为：

- `src-tauri/src/services/site_adapter_registry.rs` 中的 `SiteAdapterSpec`

如果未来字段扩展，仍然必须收敛到 Lime 自己的标准模型，而不是向外部项目的原始结构靠拢。

## 标准优先级

站点适配器相关决策的优先级固定如下：

1. Lime 产品边界
2. Lime Site Adapter Spec
3. Lime 当前浏览器运行时主链
4. 外部来源可提供的原始 adapter 定义

这意味着：

- 外部来源只能被编译、裁剪、白名单化后进入 Lime
- 不能为了保留来源格式的完整性，引入第二套 runtime、协议或错误语义
- 不能因为“某来源支持某能力”就直接判定 Lime 也应该支持

## Scene 边界

站点适配器与 slash scene 的固定关系如下：

- `site-adapter` 是步骤执行器，不是产品场景本体
- 用户可见的 `/scene` 真相应落在 `Scene Skill` / `ServiceSkill`
- `slotSchema`、`readinessRequirements` 负责声明缺失输入；是否弹 GUI 表单属于渲染层
- 如果需要补参，scene runtime 应先产出结构化 gate request，再由前端把 gate request 映射成 `a2ui`
- 不要为了单个站点把“缺 URL / 缺项目 / 缺浏览器会话”的逻辑散落在页面组件里

## 命名标准

适配器唯一标识统一使用：

- `site/name`

示例：

- `reddit/hot`
- `zhihu/hot`
- `github/search`

禁止：

- 让来源项目自己的内部 ID 成为 Lime 对外主标识
- 同时维护多套命名规则

## 参数标准

参数定义必须先归一化，再进入 Lime 主链。

`v1` 建议先稳定在最小集合：

- `string`
- `integer`

每个参数至少应有：

- `name`
- `description`
- `required`
- `arg_type`
- `example`

不要在第一阶段为了兼容外部来源而引入复杂参数系统。

## 执行标准

### 1. 运行时只能走 Lime 主链

站点适配器的真实执行，只允许走 Lime 当前运行时路径：

- `managed_cdp`
- `existing_session`

禁止：

- 直接调用外部项目自带 daemon 作为 Lime 主执行链
- 直接让外部项目控制 Chrome / Chromium 生命周期
- 在 Lime 内部并行保留第二套 site adapter runtime

### 2. 当前执行模型以 script 为唯一主格式

对 Lime 来说，站点适配器当前主格式是：

- 归一化 manifest
- 归一化 script
- 通过现有 runtime 执行 script

如果外部来源使用：

- YAML pipeline
- 自定义表达式系统
- 特定 bridge 协议

都必须先编译为 Lime 现有 script 模型。

不要直接把外部 pipeline engine 搬进 Lime。

### 3. 步骤兼容必须采用白名单

对外部 adapter 的语义兼容，必须采用白名单，而不是黑名单。

`v1` 推荐只允许：

- `navigate`
- `evaluate`
- `map`
- `filter`
- `limit`
- `sort`

`v1` 明确不允许：

- `intercept`
- `tap`
- `Desktop` 模式
- 依赖浏览器扩展上下文的动作
- 依赖 daemon 会话协议的动作
- 隐式启动、唤醒、关闭浏览器的动作

对不支持步骤，必须在导入阶段直接失败。

## 错误语义标准

Lime 的适配器错误语义必须统一，不能跟着来源项目漂移。

至少保持以下错误类型继续收敛：

- `auth_required`
- `no_matching_context`
- `adapter_runtime_error`
- `site_unreachable`
- `internal_error`

错误信息可以引用来源 adapter 的上下文，但错误分类、前端提示和结果结构必须以 Lime 为准。

## 产品边界标准

这是站点适配器能力不可突破的边界。

### 明确禁止

- 无任务时后台自动执行适配器
- 自动启动浏览器
- 自动唤醒浏览器
- 自动连接外部 daemon
- 常驻后台的浏览器控制进程
- 用户未明确发起时预热站点运行时

### 只允许

- 用户显式发起一次站点任务
- Lime 在可见状态下执行
- 用户可感知当前使用的浏览器上下文
- 执行完成后及时收口

如果某个外部来源天然依赖“后台常驻自动化”，它就不能原样进入 Lime 主链。

## 外部来源接入规则

外部来源接入必须遵守以下顺序：

1. 先盘点来源能力
2. 再定义支持子集
3. 再做编译器
4. 再导入白名单 adapter
5. 最后才允许进入 Lime 主链

禁止：

- 未经过编译层直接执行来源 adapter
- 全量导入来源仓库的全部 adapter
- 把来源项目的 runtime 一并当成捷径接入

## 外部适配器来源 的定位

`外部适配器来源` 在 Lime 中的定位必须被明确限定为：

- **站点适配器来源**

而不能是：

- Lime 的浏览器 runtime
- Lime 的适配器事实源
- Lime 的协议事实源

也就是说：

> Lime 可以借 YAML 来源 的 adapter，但不能把 YAML 来源 变成 Lime。

## 治理标准

治理时统一沿用仓库的 `current / compat / deprecated / dead` 语言。

对站点适配器能力，建议这样判断：

- `current`
  - `Lime Site Adapter Spec`
  - 当前 `site_*` 命令族
  - 当前 `managed_cdp / existing_session` 执行主链
- `compat`
  - 仅为迁移期保留的来源转换层
- `deprecated`
  - 已经不再建议新增依赖的旧 adapter 表示格式
- `dead`
  - 已无入口、无引用、无导入计划的旧来源代码

任何新的来源项目接入，如果引入了第二套运行时、第二套错误语义或第二套前端结果模型，就说明已经偏离本标准。

## 校验与交付

修改站点适配器能力时，除了常规工程校验，还应至少回答以下问题：

1. 这次改动是否仍然收敛到 `Lime Site Adapter Spec`
2. 是否新增了第二套执行主链
3. 是否破坏了当前 `site_*` 命令族的统一语义
4. 是否引入了后台自动化副作用
5. 是否补了站点适配器目录、搜索、推荐、运行的最小验证

推荐最小校验：

```bash
npm run test:contracts
npm run verify:gui-smoke
npm run smoke:site-adapters
```

如果只是新增或调整适配器来源规则，也应至少补对应文档和最小 smoke 说明。

## 实施建议

如果下一步要把外部 adapter 引入 Lime，推荐按以下顺序推进：

1. 先冻结 `Lime Site Adapter Spec v1`
2. 建立来源导入服务
3. 建立步骤白名单
4. 只导入只读、安全、无后台副作用的 adapter
5. 跑通 3 到 5 个站点后再扩面

不要一开始就追求：

- 全量兼容
- 全量站点导入
- 全量步骤支持

站点适配器能力的目标是 **标准化扩展**，不是 **来源堆砌**。

## 一句话版本

> Lime 可以吸收外部 adapter 能力，但所有来源都必须先编译成 Lime 标准，再交给 Lime 自己的 runtime 执行。
