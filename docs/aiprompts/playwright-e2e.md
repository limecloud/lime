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
- 如果 Playwright 工具当前还在 deferred surface，优先用 `ToolSearch` 的精确选择名，例如 `select:mcp__playwright__browser_click`；不要把 `playwright_browser_click`、`browser click` 之类同义词反复丢给 `ToolSearch`
- 能走真实后端就走真实后端；浏览器模式暂不支持或尚未桥接的能力，允许走 mock
- `verify:gui-smoke` 内部的 browser runtime 校验默认走无界面浏览器会话；它只证明主链可启动，不替代后续真实页面交互验证
- `lime-pet` 原生桌宠属于独立仓库与原生窗口壳，不纳入当前 WebView Playwright 的直接操控范围；在 Lime 主仓里只验证 `companion_*` API、状态事件与主窗口唤起链路，桌宠窗口移动、点击命中与原生层动画仍需额外手工 smoke
- 如果 companion 协议新增了 provider 摘要、桌宠回跳设置、桌宠主动请求同步，或双击 / 三击 / 文本对话触发的桌宠 LLM 交互事件，Playwright 续测只覆盖 Lime 主仓内的“状态事件是否触发”“是否跳到 `设置 -> AI 服务商`”“是否重发脱敏摘要”“是否调用宿主侧 LLM 代理逻辑”和“主窗口是否被唤起”，不在 WebView 层尝试直接操控原生桌宠 UI
- 共享网关控制页已下线，托盘也不再展示网关状态或地址；共享网关 `/v1/routes` 与 selector HTTP 路由也已下线，不再对“启动/停止网关、复制网关地址、路由/curl 示例、selector 路由、托盘运行态文案”做 GUI 续测；server 验证只关注标准 `/v1/messages` 与 `/v1/chat/completions` 主链，如需看运行时状态，走开发者页或实验页的诊断面板
- 旧设置页里的“安全与性能 / 容错配置”已经下线，不再对这些页签、表单或命令写入路径做 GUI 续测；如果还要验证提示路由，只围绕当前输入框 `get_hint_routes` 读取链与提示展示，不再寻找旧设置页入口
- 初装引导里的旧插件选择 / 插件安装 / 配置切换链路已经下线，不再对 `config-switch` 推荐安装、Provider Switch 页面或相关命令做 GUI 续测；当前 onboarding 只围绕现役语音体验流程验证
- 项目排版模板与品牌人设扩展旧链路已下线，不再对相关弹窗、模板列表、默认模板、人设扩展表单做 GUI 续测；项目与工作台回归只围绕当前 `Claw` / `workspace` / 现役 `persona` 主链
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

### 记忆工作台验证

1. 从左侧导航进入 `灵感库`
2. 确认页面左侧已经收敛为 `总览 / 规则 / 工作记忆 / 长期记忆 / Team 影子 / 压缩边界` 六区，而不是继续把 `identity/context/preference/experience/activity` 平铺成顶层导航
3. 打开 `规则`，确认能看到有效来源与自动记忆入口，不会把 working memory 混在同一区块
4. 打开 `工作记忆`，确认至少能看到 session 级文件摘要或明确空态，不会直接报错
5. 打开 `长期记忆`，确认旧 category 仍作为内部筛选存在，并且 `带回创作输入` 能跳回 `Claw` / 新建任务主链
6. 打开 `Team 影子` 与 `压缩边界`，确认页面能消费 localStorage shadow 与 compaction 快照，不会退回旧的单层“灵感库”文案

### AI 服务商页拆分后验证

1. 进入 `设置 -> AI 服务商`
2. 确认默认落在 `服务商设置`，左侧能看到 Provider 列表，右侧是当前 Provider 配置
3. 确认首屏不会默认混入 OEM Offer、套餐或云端模型目录
4. 点击 `云端服务`
5. 确认 OEM 会话、Offer 卡片、默认来源和模型目录改为在该页单独展示
6. 如当前环境故意破坏了 `models/index.json`，确认 Provider 模型区会提示“模型真相源异常”，而不是静默显示空态

### 社媒内容工作流

1. 点击 `社媒内容`
2. 没有项目时点击 `新建项目`
3. 已有项目时直接选择目标项目
4. 点击 `新建文稿`
5. 选择 `新开帖子（创建新文稿）`
6. 点击 `确认生成`
7. 验证页面出现通用工作区相关内容
8. 再次检查控制台 error
9. 如能查看运行时摘要，继续确认当前 gate 与任务标题恢复自该话题最近一次 `execution_runtime.recent_gate_key / recent_run_title`
10. 当前项目管理与工作台侧已下线“项目风格 / 风格策略”旧入口，不再对其做存在性验证；如页面仍出现相关入口，应判定为回流

### 浏览器工作台站点采集验证

1. 进入带有 browser assist 的工作区或浏览器运行时面板
2. 打开 `站点采集工作台` 或对应调试面板
3. 先确认推荐区已出现，并至少看到一个推荐适配器卡片
4. 点击一个推荐项，确认适配器、资料提示和标签页提示同步变化
5. 触发一次执行失败场景时，确认结果区展示业务级错误码与 `report_hint`
6. 如当前页面带有 `contentId` 上下文，再确认执行成功后默认是“写回当前主稿”，而不是新建资源文档
7. 如工作台模式开启自动保存，再确认执行成功后保存态文案与打开入口正常
8. 打开控制台并确认浏览器资料 / 环境预设读取没有落回 web mock，尤其不应出现 `[Mock] invoke: list_browser_profiles_cmd` 或 `[Mock] invoke: list_browser_environment_presets_cmd`

### Team runtime 工具面验证

1. 进入 `Claw` 或带有 `HarnessStatusPanel` 的运行时页面
2. 打开工具库存 / runtime inventory 面板
3. 确认 current 协作工具面至少包含 `Agent`、`TeamCreate`、`TeamDelete`、`SendMessage`、`ListPeers`
4. 同时确认主线程 current 工具面包含 `SendUserMessage`，且 tool display 不会退回通用图标或泛化文案
5. 如果页面当前走的是浏览器 fallback mock，也要确认 fallback inventory 与 tool display 仍显示同一组工具，而不是只出现一部分协作工具或退回通用图标
6. 如果页面同时展示 MCP bridge 工具，确认 current 命名为 `mcp__<server>__<tool>`，对应 extension surface key 为 `mcp__<server>`；若仍出现裸 `server__tool`、混合前缀或 extension/tool 各自一套命名，判定为协议漂移
7. 如出现缺失、重复图标或文案回退，优先检查 Rust catalog、runtime 注册、`src/lib/tauri-mock/core.ts` 与 `toolDisplayInfo.ts` 是否同步

### Claw 站点技能直跑门禁验证

1. 在 `Claw` 首页或空态推荐区选择一个站点型技能
2. 确认页面切回 `Claw` 对话态，并在输入区上方出现该技能的 A2UI 补参卡，而不是打开独立启动弹窗
3. 如果当前没有附着真实浏览器会话，确认 A2UI 卡继续展示“需要先准备浏览器 / 重新检测会话”的门禁提示，且主提交按钮处于禁用状态
4. 点击 `去浏览器工作台`，确认只发生页面跳转，不会后台偷偷拉起 Chrome
5. 在浏览器工作台附着到真实浏览器并打开目标站点后，回到 `Claw` 再次选择同一技能
6. 确认此时 A2UI 卡主按钮变为可执行，提交后进入 `Claw` 工作区并继续当前对话
7. 确认进入 `Claw` 后会自动发送一条首回合技能任务消息，消息文本包含站点技能启动上下文，而不是由前端挂载副作用偷偷直跑
8. 如果已有附着会话，确认 `Claw` 会通过 `lime_site_run` 执行并把结果写回当前主稿或项目资源
9. 如果没有附着会话，确认不会再向 `Claw` 对话流注入“我已完成登录，继续执行”之类的确认卡；阻断必须停留在技能入口层

### Claw `@配图` 异步任务验证

1. 在 `Claw` 对话框输入 `@配图 生成 ...`
2. 确认聊天区先进入 skill 执行态，并能看到 `image_generate` 相关工具轨迹，而不是前端静默直接创建任务
3. 如当前环境走 `Bash -> lime media image generate --json`，确认工具标题与结果摘要对应这条 CLI 主链；若实际走到兼容入口 `lime task create image --json`，也要确认它继续推进到真实完成态，而不是只创建任务文件；CLI 不可用时，才允许回退 `lime_create_image_generation_task`
4. 等待 task file 回流后，确认同一条卡片被替换为成功或失败状态，而不是额外再插一条前端本地伪造结果
5. 刷新页面或切换会话再返回原话题，确认最近图片任务会从 `.lime/tasks` 恢复
6. 如手动打开右侧查看器，确认任务卡状态与聊天区一致，且不会自动展开独立图片画布
7. 如当前界面已暴露任务控制入口，确认 `get/list/retry/cancel` 仍然只经由 task file 主链，不会回流前端直连图片服务
8. 如果任务来自文稿工具栏的 inline 配图、封面位或图片工作台动作，确认聊天区也会出现一条对应的用户消息与 `image_generate` 工具轨迹，而不是只有 task 卡突然出现
9. 如果任务来自文稿工具栏的 inline 配图，确认正文先出现占位图块，task file 成功回填后同一位置被真实图片替换，而不是在正文末尾额外追加第二张图
10. 刷新页面后再次返回该文稿，确认 inline 配图仍能通过 task file 中的 `relationships.slot_id` 恢复并原位替换，不依赖前端内存状态
11. 如果当前文稿已有明确小节并且用户在某一节内发起配图，确认占位图与最终图片会优先落到 `anchor_section_title` 指向的小节，而不是默认追加到全文末尾
12. 如果用户是在某个具体段落上发起配图，确认占位图与最终图片会优先落到 `anchor_text` 对应段落之后，而不是只落到该小节顶部

### Claw `@封面` 异步任务验证

1. 在 `Claw` 对话框输入 `@封面 小红书 标题: 春日咖啡快闪 风格: 清新插画, 1:1 春日咖啡市集封面`
2. 确认聊天区先进入 skill 执行态，并能看到 `cover_generate` 相关工具轨迹，而不是前端静默直接创建任务
3. 如当前环境走 `social_generate_cover_image + Bash -> lime task create cover --json`，确认工具标题与结果摘要对应这条封面任务主链；CLI 不可用时，才允许回退 `lime_create_cover_generation_task`
4. 等待任务回流后，确认同一条结果只展示真实 task file 状态，不会额外再插一条前端本地伪造“封面已生成”
5. 如当前界面已暴露右侧查看区或任务卡，确认其状态与聊天轻卡一致，且任务类型显示为 `cover_generate` / 封面任务
6. 刷新页面或切换会话再返回原话题，确认最近封面任务仍可从 `.lime/tasks` 恢复
7. 如当前上下文带 `contentId`，确认封面任务写回或查看入口仍绑定当前主稿，而不是漂移成普通图片任务

### Claw `@海报` 异步任务验证

1. 在 `Claw` 对话框输入 `@海报 小红书 风格: 清新拼贴 春日咖啡市集活动海报`
2. 确认聊天区先进入 skill 执行态，并能看到 `image_generate` 相关工具轨迹，而不是前端静默直接创建任务
3. 如当前环境走 `Bash -> lime media image generate --json`，确认工具标题与结果摘要对应这条图片任务主链；CLI 不可用时，才允许回退 `lime_create_image_generation_task`
4. 确认请求 metadata 中写入了 `entry_source = at_poster_command`，而不是被当成普通 `@配图` 或另一套海报协议
5. 确认默认海报尺寸会收敛到 `4:5 / 864x1152`，且 prompt 会补齐“海报设计”语义，而不是裸主题词直传
6. 等待任务回流后，确认同一条结果只展示真实 task file 状态，不会额外再插一条前端本地伪造“海报已生成”
7. 刷新页面或切换会话再返回原话题，确认最近海报任务仍可从 `.lime/tasks` 恢复
8. 如当前界面已暴露右侧查看区或任务卡，确认其状态与聊天轻卡一致，且点击后继续复用现有图片 viewer，而不是打开独立海报工作台

### Claw `@转写` 异步任务验证

1. 在 `Claw` 对话框输入 `@转写 https://example.com/interview.mp4 生成逐字稿`
2. 确认聊天区先进入 skill 执行态，并能看到 `transcription_generate` 相关工具轨迹，而不是前端静默直接调用旧 `transcribe_audio`
3. 如当前环境走 `Bash -> lime task create transcription --json`，确认工具标题与结果摘要对应这条 CLI 主链；CLI 不可用时，才允许回退 `lime_create_transcription_task`
4. 等待任务回流后，确认同一条结果只展示真实 task file 状态，不会额外再插一条前端本地伪造“转写已完成”
5. 如果输入里没有 `source_url` / `source_path`，确认 Agent 最多只追问 1 个关键问题请求补充来源，而不是直接创建空任务或伪造完成态
6. 刷新页面或切换会话再返回原话题，确认最近转写任务仍可从 `.lime/tasks` 恢复
7. 如当前界面已暴露任务控制入口，确认 `get/list/retry/cancel` 仍然只经由 task file 主链，不会回流前端旧 ASR 接口

### Claw `@研报` Prompt Skill 验证

1. 在 `Claw` 对话框输入 `@研报 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报`
2. 确认聊天区先进入 skill 执行态，并能看到 `report_generate` 与 `search_query` 的真实工具轨迹，而不是前端静默直接生成长文
3. 确认首个 skill 调用来自 `report_generate`，而不是退回 `research` 或普通聊天回答
4. 等待结果完成后，确认最终输出包含结论、来源、风险/待确认项与建议动作，而不是一段无来源的纯主观总结
5. 如果输入里没有明确主题，确认 Agent 最多只追问 1 个关键问题，而不是直接伪造研报完成态

### Claw `@PPT` Prompt Skill 验证

1. 在 `Claw` 对话框输入 `@PPT 类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿`
2. 确认聊天区先进入 skill 执行态，并能看到 `presentation_generate` 相关工具轨迹，而不是前端本地直接伪造演示提纲
3. 确认首刀不会卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，而是直接进入 `Skill(presentation_generate)`
4. 等待产物回流后，确认当前话题下出现一份真实演示稿 artifact，而不是只有文本解释
5. 打开右侧查看区，确认演示稿能够作为 Markdown artifact 正常预览，并保留封面、目录、核心论点、案例和结论结构
6. 刷新页面或切换会话后再返回原话题，确认演示稿 artifact 仍能恢复，不依赖前端内存态

### Claw `@表单` Prompt Skill 验证

1. 在 `Claw` 对话框输入 `@表单 类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表`
2. 确认聊天区先进入 skill 执行态，并能看到 `form_generate` 相关工具轨迹，而不是前端本地直接伪造字段列表
3. 确认首刀不会卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，而是直接进入 `Skill(form_generate)`
4. 等待结果回流后，确认同一条对话消息里出现可渲染的 A2UI 表单，而不是单文件 HTML artifact 或一段纯文本建议
5. 打开右侧查看区或表单详情时，确认结果仍然是 simple form JSON / A2UI 预览，不会切到另一套自定义表单 DSL
6. 刷新页面或切换会话后再返回原话题，确认表单结果仍能恢复，不依赖前端内存态

### Claw `@代码` 编排主链验证

1. 在 `Claw` 对话框输入 `@代码 修复消息历史切换后图片卡片丢失的问题，并补一个回归测试`
2. 确认聊天区先进入代码编排执行态，而不是普通聊天回答
3. 确认真正出现代码工具或协作步骤时间线，且不会先卡在无意义的 `ToolSearch`
4. 确认执行策略切到 `code_orchestrated`，同时 `task/subagent` 偏好已被打开
5. 如当前页面可查看运行时摘要或请求详情，确认 `preferred_team_preset_id=code-triage-team` 与 `code_command.kind` 已注入
6. 刷新页面或切换会话后再返回原话题，确认代码任务对话仍保留在同一条消息主链，不会裂成另一套旁路会话

### Claw `@渠道预览` 工作流验证

1. 在 `Claw` 对话框输入 `@渠道预览 平台:小红书 帮我预览这篇春日咖啡活动文案的首屏效果`
2. 确认聊天区显示的仍是原始 `@渠道预览 ...` 文本，而不是直接把 slash workflow 暴露给用户
3. 如页面可查看发送详情或运行时摘要，确认实际 dispatch 已导向 `content_post_with_cover`，且 `publish_command.intent=preview` 与 `entry_source=at_channel_preview_command` 存在
4. 确认当前回合不会像 `@发布` 一样直接触发浏览器后台门禁，而是优先产出预览稿 artifact
5. 等待工作流完成后，确认当前话题下出现一份真实预览稿 artifact，而不是只有普通聊天建议
6. 打开右侧查看区，确认预览稿仍复用现有 artifact viewer，不会切到另一套渠道预览工作台
7. 刷新页面或切换会话后再返回原话题，确认渠道预览结果仍可恢复

### Claw `@上传` 工作流验证

1. 在 `Claw` 对话框输入 `@上传 平台:微信公众号后台 帮我把这篇春日咖啡活动文案整理成可直接上传的版本`
2. 确认聊天区显示的仍是原始 `@上传 ...` 文本，而不是直接把 slash workflow 暴露给用户
3. 如页面可查看发送详情或运行时摘要，确认实际 dispatch 已导向 `content_post_with_cover`，且 `publish_command.intent=upload` 与 `entry_source=at_upload_command` 存在
4. 确认命中后台平台时会继续出现真实浏览器门禁，而不是静默退化成普通 artifact 生成
5. 等待工作流完成后，确认当前话题下出现一份真实上传稿 artifact，而不是只有普通聊天建议
6. 打开右侧查看区，确认上传稿仍复用现有 artifact viewer，不会切到另一套上传工作台
7. 刷新页面或切换会话后再返回原话题，确认上传结果仍可恢复

### Claw `@发布合规` 风控验证

1. 在 `Claw` 对话框输入 `@发布合规 内容:这是一篇小红书种草文案 重点:夸大宣传 输出:风险清单`
2. 确认聊天区显示的仍是原始 `@发布合规 ...` 文本，而不是退回普通聊天口头判断
3. 如页面可查看发送详情或运行时摘要，确认实际 dispatch 已导向 `analysis_skill_launch`，且 `entry_source=at_publish_compliance_command` 存在
4. 确认默认会补齐创作风控的 `focus / style / output_format`，而不是沿用普通 `@分析` 的空白默认值
5. 等待结果完成后，确认输出包含风险等级、风险点、修改建议与待确认项，而不是一段笼统提醒
6. 刷新页面或切换会话后再返回原话题，确认风控结果仍可恢复

### Claw `@发布` 工作流验证

1. 在 `Claw` 对话框输入 `@发布 平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本`
2. 确认聊天区显示的仍是原始 `@发布 ...` 文本，而不是直接把 slash skill 暴露给用户
3. 如页面可查看发送详情或运行时摘要，确认实际 dispatch 已导向 `content_post_with_cover`，且 `publish_command` 元数据存在
4. 确认当前回合如果命中平台后台，会出现真实浏览器门禁提示，而不是直接退化成联网搜索或普通聊天
5. 等待工作流继续推进后，确认产物仍落在现有 `content-posts/*.md` / `*.publish-pack.json` 主链，而不是另一套发布任务协议
6. 刷新页面或切换会话后再返回原话题，确认发布稿与发布包仍可恢复

### Claw `@配音` 云端技能主链验证

1. 在 `Claw` 对话框输入 `@配音 目标语言: 英文 风格: 科技感 给这个新品视频做一版发布配音稿`
2. 确认聊天区保留原始 `@配音 ...` 文本，而不是被改写成 slash scene 或其它内部协议
3. 如页面可查看发送详情或运行时摘要，确认 `request_metadata.harness.service_scene_launch.service_scene_run.scene_key=voice_runtime`，并且 `skill_id` 已绑定到当前可用的配音 service skill
4. 确认首刀进入 `lime_run_service_skill` 主链，而不是普通聊天解释、站点型 `lime_site_run`，或旧的本地 TTS 测试命令
5. 如果当前 OEM 云端会话缺失，确认界面明确提示需要登录 / 注入会话，而不是伪造“配音已完成”
6. 刷新页面或切换会话后再返回原话题，确认该配音任务的时间线与最近使用状态仍可恢复

### Claw `@浏览器` 真实浏览器任务验证

1. 在 `Claw` 对话框输入 `@浏览器 打开 https://news.baidu.com 并提炼页面主要内容`
2. 确认聊天区保留原始 `@浏览器 ...` 文本，而不是被改写成其它内部 slash 或 skill 协议
3. 如页面可查看发送详情或运行时摘要，确认 `request_metadata.harness.browser_requirement=required` 且 `browser_launch_url=https://news.baidu.com`
4. 确认该回合优先进入 Browser Assist / `mcp__lime-browser__*` 时间线，而不是 WebSearch 或普通聊天解释
5. 如果输入改成后台发布、登录、扫码这类任务，确认 requirement 升级为 `required_with_user_step`
6. 刷新页面或切换会话后再返回原话题，确认浏览器任务时间线与关联浏览器 artifact 仍可恢复

### Claw `@读PDF` Prompt Skill 验证

1. 在 `Claw` 对话框输入 `@读PDF /tmp/agent-report.pdf 提炼三点结论并标注关键证据`
2. 确认聊天区先进入 skill 执行态，并能看到 `pdf_read` 与 `list_directory / read_file` 的真实工具轨迹，而不是前端静默直接给出摘要
3. 确认首个 skill 调用来自 `pdf_read`，而不是退回 `summary`、`analysis` 或普通聊天回答
4. 如果输入的是本地路径，确认 Agent 不会再追问“请上传 PDF”，而是直接读取并输出文档信息、核心要点、关键证据
5. 如果输入里只有 PDF URL，确认 Agent 最多只追问 1 个关键问题请求本地路径或导入工作区，而不是伪造“已读 PDF”

### Claw `@链接解析 / @抓取` 异步任务验证

1. 在 `Claw` 对话框输入 `@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要`
2. 确认聊天区先进入 skill 执行态，并能看到 `url_parse` 相关工具轨迹，而不是前端静默退回普通总结
3. 如当前环境走 `Bash -> lime task create url-parse --json`，确认工具标题与结果摘要对应这条 CLI 主链；CLI 不可用时，才允许回退 `lime_create_url_parse_task`
4. 如果当前回合无法即时抓取正文，也必须看到真实 `url_parse` task file 被创建，且 `extractStatus` 为 `pending_extract`，而不是停留在口头解释
5. 如果输入里没有 URL，确认 Agent 最多只追问 1 个关键问题请求补充链接，而不是直接创建空任务或伪造完成态
6. 刷新页面或切换会话再返回原话题，确认最近链接解析任务仍可从 `.lime/tasks` 恢复
7. 再输入 `@抓取 https://example.com/post 帮我抓正文并整理成素材库摘要`，确认仍走同一条 `url_parse` task 主链，但 `entry_source = at_web_scrape_command`，并默认携带 `extract_goal = full_text`
8. 再输入 `@网页读取 https://example.com/post 帮我读这篇文章并告诉我核心结论`，确认仍走同一条 `url_parse` task 主链，但 `entry_source = at_webpage_read_command`，并默认携带 `extract_goal = summary`

### Claw `@竞品` 研究报告验证

1. 在 `Claw` 对话框输入 `@竞品 Claude 与 Gemini 在中国开发者市场的差异`
2. 确认聊天区先进入 skill 执行态，并能看到 `report_generate` 相关工具轨迹，而不是前端静默退回普通聊天对比
3. 确认运行时仍沿 `report_generate -> search_query / WebSearch` 主链，而不是退回一次性普通搜索
4. 确认 `report_request.entry_source = at_competitor_command`
5. 确认默认会补齐竞品分析的 `focus` 与 `output_format`，而不是沿用普通 `@研报` 的默认值
6. 刷新页面或切换会话再返回原话题，确认竞品分析结果仍按原会话恢复

### Slash Skill / Skill 执行验证

1. 进入 `Claw` 或任一支持 slash skill 的聊天入口
2. 输入一个已安装技能，例如 `/image_generate 画一张春日海报`
3. 确认前端不会回退普通 `chat_stream`，而是进入 skill 执行态
4. 打开控制台，确认浏览器模式接通 DevBridge 时不再出现 `execute_skill`、`list_executable_skills` 或 `get_skill_detail` 的 unknown command 报错
5. 如当前 skill 设计为走 `Bash -> lime ...`，继续确认最终反馈的是任务提交摘要或任务状态，而不是前端本地伪造成功态

### 聊天结果保存为技能验证

1. 在 `Claw / 创作` 中完成一段足够长的助手结果
2. 确认助手消息操作区出现 `保存为技能`
3. 点击后确认页面跳到 `技能`，并自动打开脚手架对话框
4. 确认对话框仍只暴露轻量基础字段，但已经带着来源摘要
5. 直接创建后，确认生成的 `SKILL.md` 预览里已经包含：
   - `何时使用`
   - `输入`
   - `执行步骤`
   - `输出`
   - `失败回退`
6. 如当前链路来自聊天结果沉淀，确认这些 section 不是通用空壳，而是带有本次结果提炼出的上下文

### Slash Scene / ServiceSkill 验证

1. 进入 `Claw` 对话框，确认当前租户目录里存在一个 `entries.kind=scene` 的场景，例如 `/daily-trend-brief`
2. 输入 `/daily-trend-brief 帮我整理今天的小红书趋势赛题`
3. 确认聊天区先出现正常的用户消息，再进入 Agent 执行态，而不是前端静默直接提交云端 run
4. 打开时间线，确认首个执行器是 `lime_run_service_skill`，而不是前端本地直接产出结果卡
5. 如当前 OEM 会话可用，确认工具结果会回流 run 状态或摘要；若当前会话缺失，确认聊天区明确提示需要登录或注入会话，而不是伪造成功
6. 未命中 scene 目录时，确认 `/unknown-scene ...` 仍回到普通 slash / Codex 流程，不会被误报为本地技能异常
7. 如果当前 scene 绑定的是站点型 skill，例如 `/x文章转存 https://x.com/.../article/...`，确认 slash 菜单可见后仍能成功解析到底层 site skill，而不是因为首页未暴露 site skill 就在发送时失配
8. 对 `markdown_bundle` 型站点场景，确认成功后项目目录里同时出现 `index.md`、`images/` 和 `meta.json`，且正文中的图片链接已经被改写为项目内相对路径，而不是继续指向远程图片 URL
9. 同时确认聊天轻卡或 tool timeline 会明确展示项目目录、Markdown 相对路径和图片数量，避免用户只能看到“已保存”却不知道文件实际落点

### 开发者页站点来源导入验证

1. 进入 `设置 -> 开发者`
2. 在 `站点脚本目录联调` 区块找到 `外部来源 YAML 导入`
3. 粘贴一份仅包含 Lime 支持子集的 YAML 来源，点击 `导入到 Lime 标准`
4. 验证摘要区来源切换为 `外部导入`，且适配器列表出现新导入名称
5. 再点击 `清空站点目录缓存`，确认来源恢复为 `应用内置`，列表回退到 bundled 目录
6. 导入与清理全过程都不应出现后台自动拉起浏览器、自动唤醒 Chrome 或常驻浏览器控制进程

### 连接器页验证

1. 进入 `设置 -> 连接器`
2. macOS 下确认首页能看到“我的浏览器”“macOS 连接器”“高级控制”三块主区域；Windows 与其他非 macOS 平台默认不应出现系统连接器卡片
3. 点击“展开高级控制”，确认 `总览 / Profile / 桥接 / 后端 / 调试` 页签可切换
4. 如当前环境允许目录选择，点击“选择目录并安装”或“同步更新扩展”，确认安装目录最终落到固定子目录 `Lime Browser Connector`
5. 点击“复制配置”，确认剪贴板内容包含 `serverUrl / bridgeKey / profileKey`
6. 确认“连接方式”区块同时展示“浏览器扩展 / CDP 直连”两种说明，并包含 `chrome://extensions` 与 `chrome://inspect/#remote-debugging` 的打开或复制入口
7. 在“动作配置”区块临时关闭一个能力，例如“页面内查找”，确认开关状态立即更新，且后端能力列表同步隐藏对应动作
8. 如当前环境已有 observer 连接，再确认“断开已连接扩展”能把页面状态回退到等待连接
9. 如当前环境接通真实后端，再确认“打开 Chrome 扩展页”与“打开远程调试页”可成功唤起对应 Chrome 页面

### 自动化设置页验证

1. 进入 `设置 -> 系统 -> 自动化`
2. 确认调度状态、任务列表、健康面板能正常加载
3. 打开控制台，确认浏览器模式接通 DevBridge 时不再出现 `get_automation_jobs`、`get_automation_health` 或 `get_automation_run_history` 的 unknown command 报错
4. 如当前环境允许创建或编辑任务，再确认提交后列表能刷新，而不是只靠 web mock 静态回显

### 话题模型恢复验证

1. 进入同一工作区中的两个话题
2. 分别切换成不同的 provider/model 组合
3. 在两个话题之间来回切换
4. 验证模型选择器恢复的是该话题最近一次 session runtime，而不是陈旧的 localStorage 默认值
5. 如页面暴露运行时摘要条，再确认 provider/model 文案与选择器一致
6. 如其中一个组合是 `ollama`，再补验证一组原生 tools 模型与一组非原生 tools 模型都能真实发出回复，而不是只拿到模型列表后在运行时卡成 `502 Bad Gateway`

### 话题权限恢复验证

1. 进入同一工作区中的两个话题
2. 在话题 A 选择 `只读`，在话题 B 选择 `当前工作区` 或 `完全访问`
3. 在两个话题之间来回切换，必要时刷新页面后再切回
4. 验证输入框权限选择器恢复的是该话题最近一次 accessMode，而不是工作区级默认值
5. 如页面暴露运行时摘要、调试面板或开发日志，继续确认恢复依据是当前话题最近一次 `execution_runtime.recent_access_mode`
6. 再立即发送一条消息，确认本轮会沿用该 accessMode 对应的正式权限策略，而不是只在 metadata 里残留旧的 `harness.access_mode`

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
6. 如果当前项目已有子代理或父会话上下文，再发送一条新消息，确认 Team Workbench 的 shadow 卡片与当前 Team 恢复一致，不会退回到全局 theme fallback；本轮如涉及 `harness.team_memory_shadow`，这里就是最小 GUI 续测锚点

### 子代理 current 字段验证

1. 准备一个带 Team 或父子会话上下文的工作区，并触发一次子代理创建
2. 如果当前入口支持显式名称或工作目录，优先带上 `name` 与绝对 `cwd`；如果 UI 暂无显式入口，至少复用现有 flow 创建一个 child session，并在详情区观察其展示名与工作目录
3. 验证 child session / Team Workbench 优先显示显式 `name`，而不是退回 `agent_type`、profile label 或 task summary fallback
4. 如果本轮涉及 `teamName`，确认 child 会回挂到当前 Team，上下文里能按该名字识别，不会出现重复成员或错挂到其它 Team
5. 验证 child 的 `working_dir` 与详情展示反映请求的绝对 `cwd`；如果请求非法相对路径，前端应看到明确失败，而不是静默回退父目录
6. 如果当前入口或调试面板暴露 `mode / isolation`，传入非空值时前端应看到明确 unsupported，而不是静默创建 child session

### 上下文压缩链路验证

1. 准备一个长线程，确保能够稳定接近上下文上限
2. 在 `workspace.settings.auto_compact=true` 时发送普通消息，确认需要时会自动压缩，并且时间线出现 `自动压缩`
3. 再把同一工作区切到 `workspace.settings.auto_compact=false`
4. 分别验证两条链路：
   - 普通发送消息
   - ask-user / elicitation 回填后继续执行
5. 两条链路都不应再静默自动压缩；如果达到上下文上限，页面应出现“请先手动压缩上下文或新建会话后重试”的可见错误

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

1. 进入普通对话话题完成一次发送，再切到通用工作区话题完成一次发送
2. 在两个话题之间来回切换，必要时新建一个空白话题再切回
3. 验证 UI 恢复的是该话题最近一次主题上下文，而不是页面一次性参数或主题级缓存
4. 如能查看调试面板或运行时摘要，继续确认依据是当前话题最近一次 `execution_runtime.recent_theme / recent_session_mode`
5. 再从普通对话切到新的 `general_workbench` 后立即发送一次，确认同步窗口内仍命中新 theme / session mode，而不是被旧 runtime 误覆盖

### 通用工作区运行阶段恢复验证

1. 进入同一个通用工作区话题，至少完成一次 `write_mode` 或 `publish_confirm` 阶段发送
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
4. 如当前环境能查看调试面板或 DevBridge 日志，优先确认素材页读取的是 `gallery_material_*` 命令，而不是旧 `poster_material_*` 命名
5. 检查控制台无新增 error

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
