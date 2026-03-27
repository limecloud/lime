# Playwright MCP 续测与 E2E

## 这份文档回答什么

本文件说明 AI Agent 在 Lime 中如何继续做 GUI 交互验证，主要回答：

- 什么情况下应该进入 Playwright MCP，而不是只跑本地测试
- 如何复用现有浏览器标签页和页面状态
- GUI 续测前最少要做哪些准备
- 出现 bridge 缺口、mock fallback、控制台报错时该怎么判断

它是 **GUI 续测手册**，不是新的本地 Playwright 测试文件模板。

## 什么时候先读

遇到以下任一情况时，先读本文件：

- 用户说“继续测试”“继续复现”“继续用 Playwright MCP 验证”
- 需要复用当前浏览器标签页和已有页面状态
- 需要排查浏览器模式下的 DevBridge、mock fallback、控制台报错
- 已经跑过最小 GUI smoke，接下来要做真实页面交互验证

## 使用边界

- 优先使用 **Playwright MCP** 做交互验证，不优先编写新的本地 Playwright 测试文件
- 浏览器模式默认首页从 `http://127.0.0.1:1420/` 进入
- 能走真实后端就走真实后端；浏览器模式暂不支持或尚未桥接的能力，允许走 mock
- 如果只是模块级代码修改、并不需要真实页面交互，优先跑最小单测或 `verify:local`

## 进入前的最低准备

### 推荐启动命令

```bash
npm run tauri:dev:headless
```

用途：

- 启动前端 dev server
- 启动 Tauri headless 调试环境
- 启动浏览器模式所需的 DevBridge

### 桥接健康检查

```bash
npm run bridge:health -- --timeout-ms 120000
```

用途：

- 等待 `http://127.0.0.1:3030/health` 就绪
- 避免 Playwright 进入页面时，前端早于 DevBridge 启动而产生 `Failed to fetch` 噪音

### 命令 / bridge 相关定向测试

```bash
npm run test:bridge
npm run test:contracts
```

适用时机：

- 修改了 `safeInvoke`
- 修改了 `src/lib/tauri-mock/`
- 修改了浏览器模式 bridge/mock 优先级
- 修改了 Tauri 命令边界

## 标准续测流程

### 1. 先确认当前浏览器会话是否可复用

优先顺序：

1. 调用标签页工具查看当前标签页
2. 如果已有 `Lime` 标签页，先查看当前 URL、标题和页面状态
3. 如果页面已漂移到旧状态，直接重新导航到 `http://127.0.0.1:1420/`

建议：

- 继续测试优先复用当前标签页，避免无意义重复建页
- 如果控制台历史噪音太多，刷新页面重新计数

### 2. 进入页面后先验证加载状态

推荐动作：

1. 打开页面后等待“正在加载...”消失
2. 用页面快照确认首页核心元素已出现
3. 立刻检查一次控制台 error

通过标准：

- 首页成功加载
- 默认首页可交互
- 初始控制台 error 为 0；如果不是 0，先定位是否为 bridge 缺口

### 3. 交互时优先使用稳定定位

遵循 Playwright 官方最佳实践：

- 优先用角色、名称、可见文本定位
- 优先使用 Playwright 自带等待与 web-first 断言
- 不要依赖固定 sleep 代替状态判断
- 点击前先确认元素可见、可交互

本仓库中优先使用：

- `button` + 中文名称
- 页面中明确可见的标题文本
- 快照里的精确元素引用

## Lime 推荐续测主路径

### 首页基础验证

1. 打开 `http://127.0.0.1:1420/`
2. 等待默认首页加载完成
3. 验证主导航可见，例如“首页”“社媒内容”“设置”
4. 检查控制台 error 是否为 0

### 社媒内容工作流

1. 点击 `社媒内容`
2. 没有项目时点击 `新建项目`
3. 已有项目时直接选择目标项目
4. 点击 `新建文稿`
5. 选择 `新开帖子（创建新文稿）`
6. 点击 `确认生成`
7. 验证页面出现 `Theme Workbench` 或相关工作台内容
8. 再次检查控制台 error
9. 如能查看运行时摘要，继续确认当前 gate 与任务标题恢复自该话题最近一次 `execution_runtime.recent_gate_key / recent_run_title`

### 浏览器工作台站点采集验证

1. 进入带有 browser assist 的工作区或浏览器运行时面板
2. 打开 `站点采集工作台` 或对应调试面板
3. 先确认推荐区已出现，并至少看到一个推荐适配器卡片
4. 点击一个推荐项，确认适配器、资料提示和标签页提示同步变化
5. 触发一次执行失败场景时，确认结果区展示业务级错误码与 `report_hint`
6. 如当前页面带有 `contentId` 上下文，再确认执行成功后默认是“写回当前主稿”，而不是新建资源文档
7. 如工作台模式开启自动保存，再确认执行成功后保存态文案与打开入口正常
8. 打开控制台并确认浏览器资料 / 环境预设读取没有落回 web mock，尤其不应出现 `[Mock] invoke: list_browser_profiles_cmd` 或 `[Mock] invoke: list_browser_environment_presets_cmd`

### 话题模型恢复验证

1. 进入同一工作区中的两个话题
2. 分别切换成不同的 provider/model 组合
3. 在两个话题之间来回切换
4. 验证模型选择器恢复的是该话题最近一次 session runtime，而不是陈旧的 localStorage 默认值
5. 如页面暴露运行时摘要条，再确认 provider/model 文案与选择器一致

### 话题工具偏好恢复验证

1. 进入同一工作区中的两个话题
2. 分别切换 `联网 / 深度思考 / 任务模式 / 子代理` 开关组合
3. 在两个话题之间来回切换，必要时新建一个空白话题再切回
4. 验证工具开关恢复的是该话题最近一次 session runtime，而不是主题级 localStorage 默认值
5. 如首次切回旧话题时只能命中 fallback，再继续切换一次，确认第二次开始已优先走 runtime 恢复

### 话题 Team 恢复验证

1. 进入同一工作区中的两个话题
2. 在话题 A 里选择一个 builtin Team，在话题 B 里选择另一个 builtin 或 custom Team
3. 在两个话题之间来回切换，必要时新建一个空白话题再切回
4. 验证 Team 选择器、摘要区和 Team Workbench 展示恢复的是该话题最近一次 `recent_team_selection`，而不是主题级 localStorage 的旧值
5. 对 custom Team 额外确认：切回后 label / description / roles 没丢；如果本轮是从 fallback 回填，继续切换一次确认第二次开始已优先走 runtime 恢复

### 运行时交接制品验证

1. 进入带有 `HarnessStatusPanel` 的对话工作区，并确保当前话题已经拿到 `sessionId`
2. 展开 `交接制品` 区块，点击 `导出交接制品`
3. 验证区块内出现：
   - 导出时间
   - 线程状态 / 最新 Turn 状态
   - Todo 统计
   - `plan / progress / handoff / review` 文件列表
4. 继续点击单个制品的 `预览`，确认预览弹窗能打开，并能看到对应绝对路径
5. 如页面桥接到了真实后端，再点击 `打开目录` 或单文件 `打开`，确认不会落回 mock，且工作区内确实生成 `.lime/harness/sessions/<session_id>/...`
6. 如果这轮继续开发问题证据包，再把同一条续测链扩展为“先导出 handoff，再导出 evidence pack”，确认两者目录与状态卡不会串线
7. 如果这轮继续开发 replay 样本导出，再点击 `导出 Replay 样本`，确认：
   - `input / expected / grader / evidence-links` 文件列表出现
   - replay 区块能显示 handoff / evidence 的关联根路径
   - 打开目录后工作区内确实生成 `.lime/harness/sessions/<session_id>/replay`
8. 如果这轮继续开发 replay -> eval 主链，再点击 `复制回归命令`，确认：
   - 剪贴板内容同时包含 `npm run harness:eval:promote -- ...`、`npm run harness:eval` 与 `npm run harness:eval:trend`
   - promote 命令里的 `session-id / slug / title` 已自动带出，不需要手工补参数
   - 该入口只是复制仓库已有主命令，不是 Lime 内部自动 promotion
9. 如果这轮继续开发外部分析交接，再点击 `导出分析交接` 与 `一键复制给 AI`，确认：
   - `analysis-brief.md / analysis-context.json` 文件列表出现
   - 复制内容直接来自后端 `copy_prompt`，不需要前端再手写 prompt
   - analysis 区块能显示 handoff / evidence / replay 的关联目录
10. 如果这轮继续开发人工审核记录，再点击 `导出人工审核记录`，确认：
    - `review-decision.md / review-decision.json` 文件列表出现
    - 区块能显示当前状态、审核清单与关联 analysis 文件
    - 打开目录后工作区内确实生成 `.lime/harness/sessions/<session_id>/review`
11. 如果这轮继续开发人工审核保存闭环，再点击 `填写人工审核结果`，至少填写：
    - `决策状态`
    - `决策摘要`
    - `审核人`
    - `风险等级`
12. 保存后确认：
    - 区块里的“当前人工审核结论”立即刷新为最新状态、审核人和摘要
    - `review-decision.md / review-decision.json` 仍然保持同一目录，不会新开平级目录
    - 如页面桥接到了真实后端，重新点击 `导出人工审核记录` 后，已保存结论不会被刷回 `pending_review`

### 话题内容上下文恢复验证

1. 进入带 `contentId` 的工作台话题并完成至少一次发送
2. 留在同一话题下再次发送，保持目标主稿不变
3. 验证本轮仍写回当前主稿，没有误新建资源文档或切到其他内容
4. 如能查看调试面板或运行时摘要，继续确认恢复依据是当前话题最近一次 `execution_runtime.recent_content_id`，而不是页面一次性参数或陈旧缓存
5. 再切到另一个 `contentId` 后立即发送一次，确认同步窗口内仍能命中新主稿，而不是被旧 runtime 误覆盖

### 话题主题上下文恢复验证

1. 进入普通对话话题完成一次发送，再切到 `Theme Workbench` 话题完成一次发送
2. 在两个话题之间来回切换，必要时新建一个空白话题再切回
3. 验证 UI 恢复的是该话题最近一次主题上下文，而不是页面一次性参数或主题级缓存
4. 如能查看调试面板或运行时摘要，继续确认依据是当前话题最近一次 `execution_runtime.recent_theme / recent_session_mode`
5. 再从普通对话切到新的 `theme_workbench` 后立即发送一次，确认同步窗口内仍命中新 theme / session mode，而不是被旧 runtime 误覆盖

### Theme Workbench 运行阶段恢复验证

1. 进入同一个 Theme Workbench 话题，至少完成一次 `write_mode` 或 `publish_confirm` 阶段发送
2. 留在同一话题下再次发送，保持当前 gate 和任务标题不变
3. 验证本轮仍衔接当前 gate / 任务标题，而不是掉回旧阶段或空标题
4. 如能查看调试面板或运行时摘要，继续确认恢复依据是当前话题最近一次 `execution_runtime.recent_gate_key / recent_run_title`
5. 再切到新的 gate 或新的运行标题后立即发送一次，确认同步窗口内仍命中新 gate / run title，而不是被旧 runtime 误覆盖

### 服务型技能自动化交付链

1. 从首页进入服务型技能卡片
2. 选择一个 `scheduled / managed` 的本地服务型技能
3. 打开“创建自动化任务”，提交后进入对应工作区
4. 确认同一次操作里：
   - 自动化任务已创建
   - 工作区已打开
   - 对应内容仍落在同一个 `contentId`
5. 如能查看运行记录或调试面板，继续确认自动化 `agent_turn` payload 含 `content_id` 与 `request_metadata.artifact`

### 素材页验证

1. 从社媒内容项目进入 `素材`
2. 验证素材列表可加载
3. 验证素材计数、列表项或空状态正常显示
4. 检查控制台无新增 error

## 每一步至少记录什么

执行 Playwright MCP 续测时，至少记录以下事实：

- 当前页面 URL
- 当前关键可见文本
- 是否走到了真实 bridge
- 是否触发了 mock fallback
- 控制台 error 数量
- 如失败，明确失败命令名或失败交互点

推荐结论格式：

- 页面是否可打开
- 业务流是否走通
- 控制台是否归零
- 新暴露的命令缺口是什么
- 该缺口更适合补真实 bridge 还是补 mock

## 常见故障与处理

### 1. `Cannot read properties of undefined (reading 'invoke')`

通常表示：

- 浏览器里加载了真实 Tauri API 包
- 没有走 web mock / HTTP bridge 链路

优先排查：

- 是否使用了浏览器模式专用启动方式
- Vite 是否正确走了 web alias
- 当前页面是否需要强制刷新以拿到最新前端代码

### 2. `[DevBridge] 未知命令`

说明：

- 前端已调用某命令
- 浏览器 bridge 分发器没有实现

处理顺序：

1. 先判断该命令是否应走真实后端
2. 如果该能力在浏览器模式下不是关键阻塞项，可加入 mock 优先集合
3. 如果该命令属于核心业务路径，优先补 bridge 分发

### 3. `Failed to fetch`

常见原因：

- DevBridge 没启动
- `3030` 端口不可用
- 前端先于 bridge 就绪开始调用

处理建议：

- 确认 `tauri:dev:headless` 已启动
- 检查 bridge 健康接口
- 刷新页面后复测，排除启动时序问题

### 4. UI 已可用但控制台仍报错

说明：

- 页面可能依赖 fallback mock 继续运行
- 但仍有命令先打到了 bridge 并报 unknown command

处理建议：

- 如果该命令属于浏览器模式可接受的降级能力，加入 mock 优先列表
- 如果该命令属于当前主路径必须能力，补真实 bridge
- 对浏览器资料 / 环境预设这类已桥接命令，优先排查真实 DevBridge 或默认种子，不要再把它们加回 mock 优先集合

## 何时补 mock，何时补真实 bridge

### 优先补真实 bridge

适用于：

- 当前主路径必须命令
- 明确已有后端实现
- 返回结构简单稳定
- 不涉及复杂流式事件或强原生依赖

### 优先补 mock

适用于：

- 浏览器模式不支持的原生能力
- 非主路径功能
- 高频噪音命令，但不影响主流程完成
- 流式 / 系统级能力，短期内 bridge 成本高于收益

## 结果判定标准

一次“继续测试”完成后，至少满足以下之一：

1. 主路径走通且控制台 error 归零
2. 主路径走通，且剩余错误已被明确归类为非阻塞项
3. 已定位新的 bridge 缺口，并给出下一步最小修复点

## 交接要求

如果本轮没有完全收口，结论里必须留下：

- 当前停留页面
- 已完成的业务步骤
- 最新暴露的命令缺口
- 推荐下一步先补 mock 还是先补 bridge
- 下一轮建议的 Playwright 复测路径

## 相关文档

- `docs/aiprompts/quality-workflow.md`
- `docs/aiprompts/commands.md`
- `docs/aiprompts/governance.md`
