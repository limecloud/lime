# 文件点击迁入 Files

状态：本片实现、候选验收及共享应用完成。日期：2026-10-22。负责人：root。整体 GUI 对齐仍 partial。

主目标：继续 Codex Desktop 九类 GUI 对齐。本片将生产中的 `handleWorkspaceFileClick -> handleFileClick` 交给 current Files，并删除没有生产调用方的 `handleTaskFileClick`、会话内容补水和临时文件 Artifact 打开出口。TaskFile 在 Canvas entries 中的实际展示、正式 Artifact、内联代码及媒体编辑器仍分别记录，不以删除无人调用的函数宣称这些消费者已迁完。

参考复用 `/Applications/ChatGPT.app`（`com.openai.codex`，`26.1007.30912 / 20156`）及相同 ASAR 摘要 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`：共享 opener `ev_1c6a04b3789e56ec539909a4f938180793e9e0643dbb900058d49c47ff3eebcd`，同路径实例/导航 `ev_614a2ee900e9efc766a559d2096c8915a9b61d75fae9efbd6f65134d458f66dc`。均为安装包静态观察，不证明参考应用运行，也不把压缩定位符当原始名称。222 个 semantic unknown 沿用前轮限制。

## 写集与协作边界

共享根先只写本计划、README 本片单行导航、`.gitignore` 精确白名单及本片新证据目录。产品与测试实现先在既有隔离候选 `.lime/verification/annotation-files-20261022-r2` 完成，前片日志与归档保持原字节。

候选写集：`workspace/useWorkspaceArtifactPreviewActions.ts` 及其测试、`useWorkspaceArtifactOpenRuntime.tsx` 及组件测试、`useWorkspaceArtifactActionRuntime.ts` 的无用参数清退、`index.workbench03.test.tsx` 的受影响文件点击断言，以及新的窄文件打开 hook/行为测试。基线六文件与共享根逐字节一致，见 `artifacts/codex-file-clicks-20261022/baseline.json`。OpenRuntime、其组件测试及 workbench03 开工时已脏；先交付完整可审补丁与候选验证，再按并行规则申请共享接管，不夹写它们。共享 Rust、Host、协议、架构、主计划、结构账本及浏览器并行改动只读。

## Verification Contract

- current owner：文件点击只决定原件路径，随后委托 `openWorkspaceFile -> Files -> FileTabLifecycle`。原件内容、空文件、二进制、读取错误、编辑草稿及同路径实例继续归既有 Files owner。
- 会话文件事实源：匹配会话文件或明确 session-file 身份时，使用既有 `sessionFile/resolvePath`，不拼接项目目录、不先读内容或补水 Renderer 缓存。普通路径通过既有路径 helper 解析，保留 macOS、Windows 和 UNC 路径语义。
- 成功合同：缓存正文不替代原件；空文件也可进入 Files；相同路径复用现有内容实例；主题只影响样式。没有新状态 store、runtime、协议方法、依赖或兼容包装。
- 失败合同：解析失败不恢复 Canvas，不发布过期路径；新点击、线程/工作区变化和卸载使旧异步成功/失败失效。空路径不发请求；相同 basename 的不同目录不能被会话文件错误绑定。
- 确定性验证：先红后绿，覆盖真实生产 hook 接线、路径/身份、空内容、原件优先、失败与异步取消，以及旧 Canvas/临时 Artifact 不回流。清退专用正向测试，有效行为转入 current Files；超过 1000 行的旧测试只做减法，新行为放入独立测试。
- 门禁：Node24 子进程运行受影响组件/边界回归、Renderer types、窄 lint/格式、contracts/legacy/scripts/docs 守卫。GUI 主链运行 `verify:gui-smoke`，默认 `verify:local`；前片完成态不能认证新源码，既有未完成批次沿原状态续跑。
- 真实交互：复用真实 Electron fixture，证明 canonical Thread/Turn/Item、IPC/current JSON-RPC 与 Files 用户状态；新增场景不得使用生产 mock，受控 external backend 单列执行边界。产品来源、产物及 freshness 前后稳定。若没有直接经过本片点击路径，不以标准壳 smoke 或前片四格式替代。
- 架构评估：本片复用既有 Files 与 sessionFile owner，未改变工作区持久化、协议或产品主链；非重大架构变更。共享架构文档已脏，本片只读，将责任与依赖确认记录于此。

## 分类与退出条件

current：Files、FileTabLifecycle、既有 sessionFile 路径解析。dead：没有生产调用方的 TaskFile 点击出口、仅供该出口的内容补水、迁完调用方后的文件 Artifact 包装。新增 compat/deprecated 为 0。

退出条件：候选的有效点击链路、失败终态、门禁和直接 Electron 场景取得新字节证据；完整补丁可审、共享脏文件基线可核对。共享应用与候选验收分别结算。整体九类仍 partial，无可信整体百分比分母；真实 Canvas TaskFile entries、正式 Artifact 和其余媒体消费者仍开放。

## 实施记录

- 新行为红测 22 失败 / 5 通过，修正测试夹具的空读取返回值后仍为同样的 22 失败 / 5 通过，无未处理错误。日志与退出收据分别保留。
- 候选新增 `useWorkspaceFileOpen`，实际 `handleWorkspaceFileClick -> handleFileClick` 委托 current Files；会话原件走 `sessionFile/resolvePath`，精确匹配完整名称，最新点击及 scope 生命周期隔离旧结果。删除 dead TaskFile 点击、补水、普通文件临时 Artifact 及主题 Canvas 分支。
- 受影响组件与边界 5 文件 / 92 项通过；Renderer types 通过。组件日志仍有既有 JSDOM `Range.getClientRects` 缺失，不宣称组件零 console error。
- 补充检查发现 `ToolCallDisplay` 将变更审阅拼成不存在的 `.diff.md`。候选改为打开实际源文件，保留内联 diff；同步 ResultPanel、行为测试与五语言旧文案。该组回归 2 文件 / 22 项通过。新增写集均先记录字节基线；共享产品源码继续只读。
- 首次 `verify:local` exit 1：i18n 未引用检查检出本片移除分支后失去引用的 `filePreview.openFailed` 与 `auxiliaryNotRendered`。候选五语言同步删除这两项，保留各语言 `agent.json` 完整基线；它们共享根已脏，最终接管范围扩展为原三个文件及五个 `agent.json`。第二轮门禁进行中。
- 新 Electron 专项位于既有 `scripts/electron/`，直接点击 canonical Tool item 的真实文件按钮；不将 Files 树打开或前片专业预览场景当成本片入口证据。
- 复核上游时确认 `sessionId` 与 `threadId` 是不同 authority：存储解析使用前者，线程、存储会话与工作区共同隔离过期请求。候选同步现有 ActionRuntime 到 OpenRuntime 的 sessionId 接线，避免将 thread ID 误作 session storage key；定向 63 项通过。
- 工具文件按钮复用既有五语言“打开文件”文案；InlineToolProcessStep 及其测试纳入 clean 写集。按钮与 diff 行为 44 项通过。
- Electron r1 被 freshness 正确拒绝：构建期间本片修正了存储 identity，产物无效，未启动产品取证。r2 保留失败现场：真实历史过程已折叠，尚未到达文件按钮，正常退出 0 / signal null；r3 增加真实展开操作后继续验证，不修改产品折叠语义。
- r3 展开后确认 canonical Tool 由 ToolCallDisplay 渲染，旧专项选择器错误指向 InlineToolProcessStep；r4 以 canonical Item ID 点击后成功进入实际路径的 Files，页面可见 `DISK_ORIGINAL`，但断言选中了后台隐藏 CodeMirror 文本。r5 改为检查可见 Markdown 预览，不放宽产品行为或超时。
- 第二轮全量前端在第 45 / 141 批保留失败：`session-history-user-collapse-runtime.test.mjs` 的 1ms 测试未到达预期 clipboard oracle，错误来自 wheel visibility 超时；未改该无关测试或时限。后续默认门禁沿该状态续跑。第三轮在前置 i18n 检查发现移除按钮旧文案后遗留的 `openInCanvasWithTarget`，候选五语言同步清退，第四轮继续。
- 当前 Actions 为 425 行（基线 764），其测试为 564 行（基线 1305）。新行为独立于原超长测试；InlineToolProcessStep 原 1145 行测试仅补现有行为的一条 aria 断言，后继拆分归其 owner，本片不添加测试分支或业务逻辑。
- 第 45 批原失败在续跑时通过，未修改该测试；第 67 批精确检出新 fixture 缺少 external backend 登记，候选仅在 clean 的 `appServerRuntimeBoundary.testSupport.ts` 增加本专项路径，生产 Runtime 默认和匹配规则不变。之后沿第 67 批续跑，不重置状态。
- Electron r5 确认普通/空文件及 PDF 通过，停在刷新后没有主动从侧栏恢复会话；r6 修复真实侧栏操作后，观察代码对无 args 的 trace 调用 `includes` 失败；r7 修正观察代码后，暴露恢复期间尚未加载历史过程的等待缺口。均保留原日志、summary、截图和正常退出收据。
- Electron r8 完整通过：从 canonical `file-click-0..4` 工具 Item 打开磁盘原件、空文件、PDF、会话存储原件与不同目录同名文件；四个文本路径各证明同路径复用，PDF 具有 608×811 画布与可选择文本。122 次真实 IPC，current JSON-RPC 包含 thread/start、turn/start、thread/read、sessionFile/resolvePath、fs/readFile，error/mock/console/page error 均为 0，主进程 exit 0 / signal null，源码、构建产物及 sidecar 摘要前后一致。已人工查看 PDF 和会话原件截图。
- 证据等级：macOS Desktop Gate B（受控 external backend）；绕过 production runtime/provider execution，不代表 live provider、Windows 或 installer。整体九类仍 partial。
- 标准 `verify:gui-smoke` exit 0，24 / 24 断言通过：真实 Electron、preload/IPC、default-runtime App Server、刷新恢复、设置和三种窗口尺寸。该命令重建了 Renderer/Host/sidecar，因此随后用这些最终产物执行文件点击 r9，exit 0；五种入口、四个文本路径同实例复用、PDF 608×811 画布及文本全部通过，117 次 IPC，trace error/mock/console/page error 为 0，正常退出 0 / signal null。r9 前后源码与产物摘要稳定，freshness 均 ready；已人工查看最终 PDF 和会话原件截图。
- 全量前端续跑 r5 在第 113 / 141 批的 `WorkspaceConversationScene` 入口提示条关闭文案断言失败。单独原样运行该文件 15 项通过，r6 原样续跑第 113 批也通过；没有修改该无关测试、文案或超时。保留失败与诊断收据，继续剩余批次。
- 候选冻结时：最终 25 文件 Prettier 检查通过，受影响 TypeScript 写集 ESLint 零警告；contracts exit 0（App Server client 296 checks），共享 docs 边界与窄 `git diff --check` 通过。22 个共享原文件 SHA 与基线一致，25 个候选及归档快照 SHA 一致；完整补丁 `git apply --check` 通过，当时尚未应用共享产品源码。后续共享应用见 r1。

## 共享应用边界

完整写集及逐文件前后 SHA 记录在归档内 `candidate-manifest.json`；[implementation.patch](./artifacts/codex-file-clicks-20261022/implementation.patch) 只包含本片 25 文件的增量，以开工时共享字节为基线，保留先前改动。补丁 SHA256：`c0eeccc06e7294080f16a742b7dda16d2e2227330a50249ec24920124d285859`。

其中下列 8 文件开工时已脏，用户针对具体补丁回复“继续”后获准接管：

- `src/components/agent/chat/workspace/useWorkspaceArtifactOpenRuntime.tsx`
- `src/components/agent/chat/workspace/useWorkspaceArtifactOpenRuntime.component.test.tsx`
- `src/components/agent/chat/index.workbench03.test.tsx`
- `src/i18n/resources/zh-CN/agent.json`
- `src/i18n/resources/zh-TW/agent.json`
- `src/i18n/resources/en-US/agent.json`
- `src/i18n/resources/ja-JP/agent.json`
- `src/i18n/resources/ko-KR/agent.json`

依据 [并行协作规则](../aiprompts/parallel-agent-collaboration.md)：“目标文件已脏时不夹写……除非用户明确要求接管该文件。” 本片已单独得到明确授权。应用前再次核对 22 个共享基线、三个新增路径和补丁摘要，均无漂移；`git apply --check` 通过后只应用该补丁，不覆盖并行改动、不提交或创建分支。

避让：共享 Rust、Host、协议、架构、主路线图、结构账本及 browser 热区。本进程已应用具体补丁，25 文件逐字节匹配候选，共享定向回归及真实 Electron 验证通过；Canvas TaskFile 实际展示及正式 Artifact 消费者另行认领，不扩大本片完成范围。

原则：用一个 83 行的窄 hook 处理文件身份和过期异步结果，复用既有 Files 与 sessionFile owner；删除无人调用出口、内容补水与临时 Artifact，移除 `.diff.md` 虚拟路径；不新建兼容层、状态 store、协议或依赖，遵循 KISS、DRY、YAGNI 和单一职责。

## 验收结算

- 全量前端最终续跑 `frontend-resume-r6` exit 0；1940 文件、141 / 141 批 passed，failed/pending/running 为 0。第 45 与 113 批的原失败均保留，未修改无关测试或超时。新 external fixture 的登记缺口已在第 67 批精确修复。
- 默认本地任务按组合步骤结算：r4 的版本、五语资源/未引用 key、全局 lint、硬编码扫描和 Renderer/Node types 已通过；全量前端最终续跑通过；最终 contracts、标准 GUI 24 / 24 及最终产物文件点击 r9 另有 exit 0 收据。四轮 `verify:local` wrapper 的原 exit 1 不变，不声称单轮门禁 exit 0，也不将候选结果升级为共享根全仓结果。
- current：Files、FileTabLifecycle、sessionFile 路径解析；dead 已在候选清退：无人调用 TaskFile 点击及补水、普通文件临时 Artifact/Canvas 分支、虚拟 `.diff.md` 打开。新增 compat/deprecated 为 0。正式 Artifact 与 Canvas TaskFile 展示仍在现有 owner，未宣称它们完成迁移。
- 本片候选实现及合同内验收 100%；共享产品补丁应用 25 / 25（100%），8 个脏文件接管已获准并完成，定向与 Electron 回归通过。整体九类 GUI 仍 partial，没有可信总百分比分母。
- 未验证：Windows、installer、live provider、参考应用运行行为、其余媒体与 Canvas 消费者。r9 是 macOS Desktop Gate B 的受控 external backend；其 threadId/sessionId 相同，二者不同的路由和失效语义由独立组件回归证明，不外推为该 Electron 场景已覆盖。
- 精简收据：[summary.json](./artifacts/codex-file-clicks-20261022/summary.json)。原日志、各轮失败、SHA 基线/候选快照、最终全量 state、GUI/Electron summary 与截图归入 [evidence.tar.gz](./artifacts/codex-file-clicks-20261022/evidence.tar.gz)，包含逐文件 SHA256 清单。归档不包含参考应用代码，前片归档保持原字节。
- 完整归档共 164 个 payload 文件及一份 manifest，14,420,808 字节；SHA256 `2ceb5328c239a4b7bfffd5b7bfe119b1e436b55f94b85c99a2b20d623db7c1c4`。顶层 summary 为外部索引，不打入自身所引用的归档，避免循环摘要。

## 共享接管 r1

- 用户针对上述 25 文件补丁及 8 个脏文件接管请求回复“继续”，本片授权成立。应用前再次确认补丁 SHA、22 个共享原文件及三个新增路径，均无漂移；`git apply --check` 后应用具体补丁，25 文件全部匹配最终候选 SHA。没有修改 Git 索引、提交、推送或创建分支。
- 原候选 Electron r9 的 288 份来源中，共享根只存在 `useAgentChatWorkspaceCommandRuntime.ts` 一处换行格式差异；移除空白后文本一致，该文件保持原字节。共享根另行运行定向与真实 Electron 验证，不把候选产物冒充共享构建。
- 首次共享定向测试的 8 个目标文件、162 项全部通过，但本片证据目录内 11 份源码快照被 Vitest 子串过滤误收集，导致命令 exit 1。将本进程拥有的 `baseline/` 与 `candidate/` 原样移入既有排除目录 `.lime/verification/file-click-evidence-20261022/`，47 文件 SHA 全部保持；原归档保留原路径与原字节，不修改全局测试配置。原失败与搬移收据保留。
- 共享定向 r2 exit 0：8 文件、162 / 162 项通过，含文件点击、session/thread 身份、过期结果、父级接线、工具按钮及 external fixture 边界。写集 ESLint 零警告、25 文件 Prettier 检查通过。日志仍保留 JSDOM 的既有 `Range.getClientRects` 缺失，不宣称组件零 console error。
- 共享 contracts exit 0（App Server client 296 checks，含 scripts/docs 守卫），legacy report exit 0 / 边界违规 0，五语言资源完整性 exit 0（16 namespace / 8401 source key）。全局 `i18n:unused -- --check` exit 1：29 项分布为并行 browserChrome 24、browserHistory 4、settings 1；这些文件不在本片 25 文件写集内且为脏/未跟踪热区，本片只记录、不夹写。agent 与 agentMessageList 的 unused 均为 0。该失败不升级为本片文件入口缺陷，也不宣称共享全仓门禁通过。
- 共享根标准 `verify:gui-smoke` exit 0 / 24 断言全过；真实 default-runtime Electron、preload/IPC、App Server 初始化、刷新、设置与三尺寸响应式通过，errors/mock/legacy 命中为 0。该命令新构建了共享 Renderer、Host 和 sidecar，未复用候选产物冒充共享构建。
- 随后使用同一批共享构建执行 `file-click-shared-20261022-r1`，exit 0；五种入口、四个文本路径同实例复用、PDF 608×811 画布与 `PDF_PREVIEW_01` 文本、侧栏恢复后的会话原件均通过。126 次真实 IPC，trace/mock/console/page error 均为 0；Main 正常退出 code 0 / signal null，无 forced cleanup。288 来源、4456 产物在运行结束和收尾核对均保持 SHA 一致，freshness before/after ready；已人工查看共享 PDF 和会话原件截图。
- 收尾 25 文件 SHA 全部匹配已审阅候选，原补丁与原完整归档摘要保持不变。共享接管授权、应用前后摘要、首轮快照误收集失败、搬移收据、共享回归与 GUI/Electron 原始证据单独进入 [takeover-evidence.tar.gz](./artifacts/codex-file-clicks-20261022/takeover-evidence.tar.gz)；顶层 summary 同时引用两份归档。
- 接管归档含 43 个 payload 文件及一份逐文件 SHA 清单，6,045,399 字节；SHA256 `349084617d20c213cb68b99adf9bd0fdab3bb04e414d7b9ddd0f9d94c91a8a9a`。归档内容的长度和 SHA 已逐项复核通过。
- 本片应用与产品合同验收已完成，无待确认事项。共享全量不重跑：候选已有 1940 文件 / 141 批终态，25 文件应用后 SHA 一致，且共享定向 162 项与两类真实 Electron 已独立通过；全局浏览器文案缺口仍单列，Windows/live/installer 及其余 Artifact/Canvas 消费者继续开放。
