# 灵感库 / 记忆系统验收标准

> 状态：current acceptance plan  
> 更新时间：2026-05-01  
> 目标：定义普通用户体验、进阶控制、高级诊断和工程边界的可验证验收标准。

## 1. 普通用户验收

### 1.1 首屏理解

场景：用户从主导航点击 `灵感库`。

必须满足：

1. 首屏解释为灵感、参考、风格、成果、收藏或继续生成。
2. 不出现 `memory_runtime`、`prefetch`、`compaction`、`memdir`、`source bucket` 等底层术语。
3. 用户能看到至少一个明确动作：保存、导入、继续生成、整理。
4. 空态说明如何积累第一条灵感，而不是说明记忆系统如何工作。
5. 默认不运行 active memory / hidden recall / auto organization 实验。

失败示例：

- 首屏默认展示来源链。
- 普通用户必须理解 working memory 才能继续。
- 页面标题写成“记忆诊断”。

### 1.2 保存结果

场景：用户在结果工作台保存满意结果。

必须满足：

1. 保存入口文案为 `保存到灵感库` 或同义创作者语言。
2. 保存成功后原结果卡显示已保存状态。
3. 用户能点击 `去灵感库继续`。
4. 灵感库落到成果分区并聚焦该结果。
5. 下一轮推荐能带上该成果。

失败示例：

- 保存后只能 toast，页面状态不变。
- 重复点击产生重复成果。
- 跳转到泛化首页，用户找不到刚保存的结果。

### 1.3 围绕灵感继续

场景：用户从灵感条目点击继续生成。

必须满足：

1. 打开共享 launcher。
2. 默认带入该灵感的标题、摘要和标签。
3. 用户可确认或调整输入。
4. 发送后 request metadata 能关联该灵感。
5. 生成结果可继续保存回灵感库。

失败示例：

- 直接拼接裸 prompt。
- 丢失灵感引用。
- launcher 里无法看出正在围绕哪条灵感。

## 2. 进阶控制验收

### 2.1 编辑

必须满足：

1. 用户能编辑标题、摘要、标签和类型。
2. 编辑后列表、详情、推荐卡同步更新。
3. 编辑不改变 memory id。
4. 错误输入有清晰提示。

### 2.2 禁用

必须满足：

1. 禁用条目仍可在灵感库看到。
2. 禁用条目不进入默认 reference selection。
3. 禁用条目不参与推荐排序提升。
4. 用户可以重新启用。
5. 禁用状态有明确说明：“保留，但不影响生成”。

### 2.3 删除

必须满足：

1. 删除前有确认。
2. 删除后条目不再出现在列表、推荐、聚焦入口。
3. 删除不会破坏旧会话阅读。
4. 已删除对象的 recommendation signal 被清理或安全忽略。

### 2.4 待整理

必须满足：

1. 自动候选未确认前不影响生成。
2. 候选显示来源摘要。
3. 用户可确认、合并、忽略、删除。
4. 合并不会制造重复条目。
5. 敏感候选默认要求确认。

## 3. 高级诊断验收

### 3.1 入口隔离

必须满足：

1. 高级诊断不在普通主导航默认展开。
2. 可从开发者面板、设置高级、线程可靠性或 dev flag 进入。
3. 进入后明确标识这是诊断层，不是普通灵感库。
4. 默认关闭时，普通用户看不到也触发不了诊断层。

### 3.2 事实源一致

必须满足：

1. 来源链读 `memory_runtime_*` 或对应 current read model。
2. working memory 不由 UI 扫描磁盘拼装。
3. durable recall 不由 UI 自己决定回退策略。
4. compaction summary 来自 current compaction cache / runtime API。
5. Team Memory 只作为 shadow 展示，不替代显式选择。

### 3.3 排障能力

必须满足：

1. 能解释当前 turn 命中了哪些层。
2. 能看到最近 prefetch history。
3. 能看到最新 compaction summary。
4. 能看到来源路径或来源类型。
5. 能为客服 / 研发提供 evidence 线索。

### 3.4 开发者开关

必须满足：

1. `memory diagnostics` 默认 off。
2. `active memory recall preview` 默认 off。
3. `auto organization experiments` 默认 off。
4. `raw source / hit layer` 默认 off。
5. `external memory provider` 默认 off，且同一时刻最多一个 active。
6. 每个开关开启后都有可见状态、关闭动作和最小 trace。
7. 关闭后下一轮不再运行对应 hidden recall / auto organization。

失败示例：

- 普通导航进入后已经显示 active recall debug。
- 关闭开关后后台仍持续写入自动整理候选。
- 多个外部 provider 同时影响同一轮生成。

## 4. 工程验收

### 4.1 单事实源

必须满足：

1. 长期灵感仍走 `unified_memory_*`。
2. 当前回合记忆仍走 `memory_runtime_*`。
3. 压缩仍走 `agent_runtime_compact_session`。
4. 不新增平行 `inspiration_*` 长期 CRUD 主链。
5. 新前台 projection 不反向定义 runtime prompt。
6. 开发者开关只控制展示 / 实验，不改变事实源地位。

### 4.2 命令和 mock 同步

如果新增或修改 Tauri 命令，必须满足：

1. 前端 API 网关同步。
2. Rust `generate_handler!` 同步。
3. `agentCommandCatalog` 同步。
4. DevBridge mock / browser mock 同步。
5. `npm run test:contracts` 通过。

### 4.3 测试覆盖

普通灵感库变化至少覆盖：

1. 普通首屏不出现底层术语。
2. 保存结果后状态变化。
3. 结果跳转聚焦成果。
4. 禁用条目不进入默认推荐。
5. 删除条目不被推荐信号继续引用。
6. 高级诊断入口仍可打开。
7. 开发者开关默认关闭。
8. active recall 开启后 recalled context 被 fenced / untrusted 包裹。
9. 自动整理候选经过 secret / injection scan 且未确认前不影响生成。

建议命令：

```bash
npm exec vitest run "src/components/memory/MemoryPage.test.tsx"
npx eslint "src/components/memory/MemoryPage.tsx" "src/components/memory/MemoryPage.test.tsx"
```

如涉及协议：

```bash
npm run test:contracts
```

如涉及 GUI 主路径：

```bash
npm run verify:gui-smoke
```

## 5. 产品验收清单

发布前逐项确认：

1. 主导航仍叫 `灵感库`。
2. 普通页面没有底层 runtime 术语。
3. 每条正式灵感都有继续动作。
4. 用户可以控制是否影响生成。
5. 自动候选不默认污染生成。
6. 高级诊断仍可定位上下文问题。
7. active recall / raw hit layer / auto organization 默认关闭。
8. Memory baseline 常开，高级开关关闭时仍保留已确认偏好、禁用列表和最小 summary / evidence id。
9. 文档明确 current / compat / deprecated 边界。

## 6. 不通过判定

出现任一情况，本路线图阶段不算完成：

1. 新增第二套长期灵感事实源。
2. 普通用户默认页必须理解 `prefetch` 或 `compaction`。
3. 自动抽取未确认就默认影响生成。
4. 用户无法删除或禁用错误灵感。
5. 保存结果后不能围绕它继续。
6. 诊断能力被删除，导致无法解释上下文命中。
7. 默认启用 active recall 或 raw provider trace，导致普通生成被不可见上下文影响。
8. recalled context 未标记 untrusted，或 provider 输出可被当作用户新输入。
9. 开发者面板开关关闭后连基础偏好、禁用列表或 taste / voice summary 也被关闭，导致产品失忆。
