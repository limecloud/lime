# Claude Code Agent Task Runtime 全面对齐计划

## 摘要

目标是把 Lime 的 agent 主链从“线程态 + 工具流 + 诊断信号”升级为对标 Claude Code 的“统一任务运行时”：

- 主会话、子 agent、等待输入、完成结算都统一映射为可见任务。
- 简单问题不再错误抬升为常驻 `MAIN TASK` 面板，只在复杂、长链路、可跟踪任务里显示当前进展。
- 工具调用按批次聚合，必须产出中间过程结论，而不是只留下工具名。
- `token usage` 与 `prompt cache` 在任务完成态和消息态都保持可见。
- E2E 与 GUI smoke 后续统一以“任务是否创建、推进、完成”为核心断言。

## 关键改动

### 1. Agent Task Runtime 投影

- 新增统一任务投影模型，先覆盖 `main_session` 与 `subagent`。
- 每次主会话回合都可以被投影成任务，但展示层增加“简单直答自动折叠”规则。
- 当前回合的任务标题、状态、阶段、等待原因、工具批次摘要、子任务统计统一从现有 `thread_read / turns / items / messages / child_subagent_sessions` 归一投影。

### 2. 任务展示规则

- 仅在以下场景显示任务状态：
  - 有工具批次或过程轨迹
  - 有子任务
  - 有排队 / 待补信息 / 等待确认
  - 回合失败或中断
- 简单直接回答成功后默认折叠隐藏，不显示常驻 `MAIN TASK`。
- 复杂任务也不再插入聊天主区大卡片，改挂输入区底栏弱提示 pill。
- 任务状态 pill 保留：
  - 主任务标题
  - 当前状态
  - 工具批次摘要
  - 子任务数量
  - 阻塞 / 排队信号

### 3. 工具批次与过程结论

- 复用现有工具批次聚合与工具过程摘要能力。
- 任务状态条优先展示批次级结论，例如：
  - 已探索项目
  - 已查看关键文件
  - 已检查页面
- 当没有工具批次时，状态 pill 回退到等待原因、失败原因或当前阻塞摘要。

### 4. 回归与验收

- 前端单测覆盖：
  - 简单直答完成后不显示任务状态条
  - 工具批次会显示输入区顶部弱提示条
  - 等待输入会显示等待态
  - 聊天主区仍保留消息级 `token usage` 与 `prompt cache` 摘要
- 后续 GUI / E2E 继续对齐：
  - 打开真实项目后触发分析请求
  - 断言复杂任务可见
  - 断言简单直答不出现误报任务卡

## 当前进度

- 2026-04-14：创建执行计划文件。
- 2026-04-14：前端新增主任务投影工具与任务卡组件。
- 2026-04-14：先前尝试把主任务直接插入聊天主区，已确认不符合 Claude Code 的任务层级。
- 2026-04-14：主任务展示已回撤出聊天主区，并进一步收敛为输入区底栏弱提示 pill；完成态自动折叠。
- 2026-04-14：补充任务投影、输入区与消息列表的定向回归测试。
- 2026-04-14：定向 `vitest` 已通过，覆盖“复杂任务完成后不继续占据聊天主区，token usage / Prompt Cache 仍由消息结算区承载”。
- 2026-04-14：定向 `eslint` 已通过；`verify:local` 仍被仓库现存无关问题阻塞，当前已知阻塞文件为 `src/components/agent/chat/utils/toolBatchGrouping.ts` 与 `src/components/memory/MemoryPage.tsx`。
- 2026-04-14：`verify:gui-smoke` 已启动并推进到 headless Tauri 最终链接阶段，当前阻塞为首次临时 `CARGO_TARGET_DIR` 的 Rust/Tauri 大编译，尚未拿到 `http://127.0.0.1:3030/health` 就绪结果。
- 2026-04-14：`verify:gui-smoke` 最终通过，确认默认 workspace、browser runtime、site adapter catalog 与 agent service skill entry 主链未回退。
- 2026-04-14：浏览器 E2E 已验证复杂请求运行中只在输入区底栏显示状态 pill；完成后 pill 自动折叠消失，消息尾部继续显示 `token usage` 与缓存统计。
- 2026-04-14：后端已落地“连续只读工具批次并发执行”，当前只对 Bash / PowerShell 的保守只读命令集启用并发，写操作与高风险命令继续串行。
- 2026-04-14：补齐路径预检，避免在分析本地项目时盲猜不存在路径。
- 2026-04-14：定位到 `tauri:dev*` 脚本把 `CARGO_TARGET_DIR` 写死为 `target`，会在 GUI 续测与 Rust 测试并行时放大构建锁竞争；现已改成“默认 target，但允许显式覆盖”。
- 2026-04-14：继续收口“任务分工建议”视觉层级，首页空态与普通输入栏统一改为轻量胶囊提示，不再用大横幅抢占输入区主视觉。
- 2026-04-14：按最新反馈去掉消息正文里的 `阶段结论` 标题壳；新消息直接显示结论正文，旧历史通过前端统一清洗兼容去标题。
- 2026-04-14：继续追查 GUI 续测慢点，确认 `run-tauri-dev.mjs` / `run-tauri-profile.mjs` 会把相对 `CARGO_TARGET_DIR` 传进 `tauri dev`，在当前启动链下误写成 `src-tauri/src-tauri/target`；现已改成仓库根绝对路径下的 `src-tauri/target`，同时同步更新 README 说明。

## 本轮验证记录

### 已完成

- `npx vitest run "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/utils/agentTaskRuntime.test.ts"`
- `npx eslint "src/components/agent/chat/components/Inputbar/index.tsx" "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx" "src/components/agent/chat/utils/agentTaskRuntime.ts"`

### 进行中

- `npm run verify:gui-smoke`
  - 当前表现：前端壳 `http://127.0.0.1:1420/` 可访问，但 `3030` DevBridge 尚未监听，页面仍处于 mock/fallback 状态。
  - 当前判断：阻塞源是 headless Tauri 首次完整构建与链接，不是任务 pill 回退或聊天主区重新渲染 task 卡片。
- `npm run tauri:dev:headless`
  - 当前表现：真实页面发送按钮 disabled 的直接原因不是输入组件，而是 `aster_agent_init` 因 DevBridge 不可达失败，页面落入 bridge cooldown / mock fallback。
  - 当前判断：根因之一不是单纯构建锁，而是开发脚本传入的相对 `CARGO_TARGET_DIR` 被 `tauri dev` 解析成 `src-tauri/src-tauri/target`，造成双层 target 与冷编译；脚本已改成绝对路径，正在重新拉起真实 bridge 做二次验证。

### 已完成补充验收

- 真实浏览器会话中已验证：
  - 复杂请求运行中，聊天主区展示的是消息与过程结论，不再插入大 task 面板
  - 输入区底栏出现紧凑状态 pill，内容包含任务标题、状态与批次摘要
  - 任务完成后状态 pill 自动折叠隐藏
  - 消息结算区继续显示 `68.0K tokens` 与缓存统计 `缓存 62.3K（读 62.3K / 写 0）`
  - 本轮真实交互后控制台未新增 bridge/runtime 错误，仍只剩浏览器模式的 i18n warning

## 默认假设

- 本阶段优先修正产品感知与主路径可见性，不先重写底层 `session/thread/turn/item` 存储结构。
- 媒体 / 插件任务暂不并入统一任务 runtime。
- 真正的后端 `task event` 契约和 `thread_read.task_runs` 字段后续再补，当前先用前端投影收口主体验。
