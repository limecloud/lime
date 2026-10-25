# GUI 结构与命名对齐账本

> 2026-10-25 更新：用户已取消 Lime 主题/皮肤保留例外，旧皮肤及首页装饰段落仅为历史证据，现役实现与验收见 `internal/exec-plans/appearance-home-alignment-20261025.md`。

2026-10-25 current 纠正：下文本地 Profile/Soul 实施为历史证据，已退役。Codex 公共 Profile 为账号服务能力，本地 nickname/bio 表单不能替代；已删除表单、配置、搜索目标和专用 fixture，保留真实 Lime Account Center。个性化仅保留 Memory、AGENTS 与原版指令语义。旧公开 Profile 后续动作不再作为 Lime 当前产品待办。详见 [当前执行计划](../../exec-plans/browser-runtime-right-surface-plan.md)。


当前证据有效性以[缺失声明](validation-evidence-lifecycle-20261018.json)为准：旧`.lime/`整个目录消失，本账本旧收据/冻结结果只保留历史观察，不作为当前验收。新表格合同与测试独立补证，新原生结果须由新候选重建。

状态：current / partial。校准日期：2026-10-20。本页归并已有 REA 审计与正式实现映射，不新增参考应用运行结论，也不是全量符号清单。

2026-10-22 批注重开：同成员有界 REA `ev_614a2ee900e9efc766a559d2096c8915a9b61d75fae9efbd6f65134d458f66dc` 的 Zq/ola/ula/dla/lla 仅作为压缩定位符，确认同实例复用及按标签交付/暂存导航的静态合同。Lime current 为 `openWorkspaceFile`、`threadSidePanelTabs`、原 `ArtifactAnnotationDraftStore` 和无状态 `ArtifactNavigationContext`；旧 `openProjectFilePreviewInCanvas` 及出口/消费者已删除，没有同名 alias 或第二业务 Store。两组 180 项与红回归见[切片计划](../../exec-plans/codex-annotation-files-20261022.md)。新冻结候选被外部删除，GUI/default 当前验证未结算；不据组件结果声称真实 Desktop 或整体完成。

参考为 Codex Desktop `26.1007.30912` / build `20156`，Bundle ID `com.openai.codex`，ASAR SHA-256 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。版本、Evidence ID、原成员摘要和锚点分别由链接的领域审计及[证据索引](evidence-index.json)持有。公开 Rust checkout 只用于共享协议/runtime；不能补出 Desktop 前端原文件名。

## 已确认名称与 current owner

2026-10-22 文件入口：复用下列 Files 迁移的同摘要 REA 共享侧面板 opener 合同，将 PDF/DOCX/XLSX/CSV/TSV/PPTX 的默认与 artifact_review 导航，以及同项目已保存站点、初始项目文件和服务结果文件直接交给既有 openWorkspaceFile，不再先读副本、创建临时 Artifact 或请求 Canvas。新增名称为 0，未改 runtime/Host/协议；跨项目路由和恢复等待保留。组件回归及真实 Electron 边界见 [本片证据](../../exec-plans/artifacts/codex-gui-followthrough-20261021/timeline-professional-files/)。其余 artifact_review、批注 Composer 定位与其他 Artifact/Canvas 消费者仍开放，不以这批路径替代完整清退。

2026-10-22 Files 职责迁移：复用 REA `ev_1c6a04b3789e56ec539909a4f938180793e9e0643dbb900058d49c47ff3eebcd` 的统一文件 opener、同路径 contentInstance 与 onBeforeClose 合同。`workspace/filePreviewTarget.ts`、`filePreviewModel.ts` 和 `right-surface/useFileTreeState.ts`、`useFileTreeResize.ts` 承接共享投影、模式、目录与宽度；`workspacePath.ts` 唯一归一路径。Files 不再反向依赖 Canvas selection，剩余 Canvas 消费 Files 投影。直接删除七份旧模块/测试及无人消费的 display helper，迁移五语言 key、selector、provenance 与消费者，并补回流守卫。以上为本地职责命名，不把 qBi/JG/TJ 等压缩定位符当成原始名称。定向回归和新产品字节验收分别记录在[当前执行片](../../exec-plans/codex-gui-alignment-followthrough-20261021.md#当前清退files-预览与目录-owner)；完整 Canvas/Artifact 和九类目标仍开放。

2026-10-20侧栏更新：REA `ev_06897fd3c273c7d856bbe452f07615486591d2ce1bdceac0a1cac5cd1101f28d`从实际ASAR的iPo→ZNo→QNo定位到明确导出`ProfileDropdownItems`。Lime直接使用同名组件，`SidebarProfileFooter`仅作为本地presentation职责，账号读取/登录/退出继续委托共享owner；旧AppSidebarAccountMenu与Account卡片样式删除。nSs/g2分组合同迁到AppSidebarSection/useSidebarSections，删除先合计截10及旧split helper。跨产品导入链、referral、旧import timeout和fixture专用分支已退役，canonical历史/图片/流式/失败/分页风险迁到current回归；不新增alias。完整映射、证据、验证与剩余范围见[本轮计划](../../exec-plans/codex-sidebar-cleanup-20261020.md)。参考包具有条件性invite/Help，不能将Lime旧referral删除解释为目标没有这些能力；完整菜单和参考运行分支仍待验收。

2026-10-20深层收敛：导入专用identity/query、nested sticky defaults、事件/Item合并旁路与public ThreadItemMetadata/ThreadItemSourceProvenance合同直接退役；schema、Rust/TUI构造、TS public reader和负向护栏同步迁移。当前canonical工具metadata、typed Plan与顶层线程设置保留。thread_read内按采样/terminal复核职责拆出runtime_snapshot，保持canonical唯一owner与分页identity，三入口竞态确定性回归通过；公共wire/新产物结算见同一本轮计划。不存在新增compat或deprecated owner。

2026-10-17：已确认公开导出 `PdfPreviewPanel`、`DocxPreviewPanel`、`WorkbookPanel`、`PresentationPanel`，Lime同名组件由唯一 `ArtifactRenderer -> PreviewArtifactRenderer` 与文件树消费；四种预览和位置反馈均有固定候选原生证据。共享批注唯一owner为`artifact/annotations/`，各格式持有自己的位置适配器；内部拆分名未冒称上游原名。XLSX普通单元格编辑/保存与共享flush已验收；CSV/TSV原生重验因Main正常退出尚未关闭。Presentation对象/正文编辑与导出保存、DOCX/PDF具体编辑入口、进程重启耐久性和全量类/函数映射继续开放。详见[专业文件审计](professional-files-audit.md)与[工作簿实施计划](../../exec-plans/codex-workbook-alignment.md)。

| 参考名称及证据性质                                                                | Lime current owner / 调用者                                                                                                                                                                   | 已迁移内容与边界                                                                                                                                                                                    | 待办                                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QueuedMessageList`，确认公开导出                                                 | [QueuedMessageList](../../../src/components/agent/chat/components/QueuedMessageList.tsx)，Workspace queue projection / actions                                                                | 直接替换旧 `ThreadQueueStatus`；列表呈现与同一 App Server queue authority 分工；见[导航审计](navigation-composer-audit.md)及[Steer 审计](queue-steer-audit.md)                                      | 暂停、送达未知、拖拽与完整交互须逐合同验收，不能以同名认定全部等价                                                                                                                     |
| `ComposerUtilityBar`，确认公开导出                                                | [ComposerUtilityBar](../../../src/components/agent/chat/components/Inputbar/components/ComposerUtilityBar.tsx)，Home/Inputbar 共享消费                                                        | 项目、分支与运行位置组合；既有 workspace/Git owner 继续执行；旧项目上下文组件删除，见[导航审计](navigation-composer-audit.md)                                                                       | staged worktree / remote                                                                                                                                                               |
| `ReviewThreadSidePanelTab`，确认公开导出                                          | [ReviewThreadSidePanelTab](../../../src/components/agent/chat/workspace/ReviewThreadSidePanelTab.tsx)，RightSurface → 同次 changeView → ChangesPanel                                          | 删除 path-only surface，复用既有 diff/review/file-preview owner；映射及身份见[执行计划](../../exec-plans/codex-gui-alignment-current-plan.md)                                                       | 完整 diff/editor 与视觉逐项核对                                                                                                                                                        |
| `openWorkspaceFile`，确认实际重导出                                               | [openWorkspaceFile](../../../src/components/agent/chat/workspace/right-surface/openWorkspaceFile.ts)，同一LocalState/ThreadSidePanelTabs                                                      | 按路径复用内容实例；空Files消费后移除；28真实多路径/跨工具/折叠/编辑/关闭通过，详见[文件合同](../../exec-plans/artifacts/codex-shared-page-header-20261018/thread-controls/file-editor-contract.md) | 草稿/撤销后继30独立验收；完整toolbar/审阅、读取分类收敛及window quit开放                                                                                                               |
| `TerminalTab` / `TerminalPanel`，确认公开导出                                     | [TerminalTab](../../../src/components/agent/chat/components/TerminalTab.tsx) → [TerminalPanel](../../../src/components/agent/chat/components/TerminalPanel.tsx) → existing command/exec owner | 删除四个旧Shell组件及叠加列表；28真实31秒、双session/主题/关闭隔离通过                                                                                                                              | 完整平台/安装包与任意工具tab合同开放                                                                                                                                                   |
| `LocalConversationBackgroundTerminalTab`，确认公开导出                            | [LocalConversationBackgroundTerminalTab](../../../src/components/agent/chat/workspace/LocalConversationBackgroundTerminalTab.tsx) → XtermOutputPanel/canonical Item                           | 独立只读标签；29真实runtime验证关闭重开不终止、stop-all同一canonical终态，移除提前forget API和dead registration wrapper                                                                             | interruptedItemIds/session-buffer fallback及完整Summary sections开放                                                                                                                   |
| `SettingsPage`，确认公开导出                                                      | [SettingsPage](../../../src/components/settings-v2/_layout/index.tsx)，AppPageContent 唯一产品消费者                                                                                          | `SettingsPageV2`/`SettingsLayoutV2` 别名删除；[sections](../../../src/components/settings-v2/sections.tsx)统一登记、导航、preload/render，见[设置审计](settings-navigation-audit.md)                | canonical章节/返回经既有导航owner，原生第14轮4/4通过；默认130/130批及组合验收通过；Memory配置/SOUL新原生6/6已验收，其他表单/内容搜索待交付；目录仍为 `settings-v2`，未声称目录名已对齐 |
| `VisibleSettingsCommandMenuSectionItems`、`SettingsExternalSection`，确认公开导出 | 目前没有登记为同义 owner 的 Lime 对应符号                                                                                                                                                     | [设置审计](settings-navigation-audit.md)仅证明参考模块职责与导出，未据字符串建立空壳或 alias                                                                                                        | 现有命令菜单/外部设置消费者需按实际能力映射                                                                                                                                            |
| `startNewConversation`，确认公开导出                                              | [useAppNavigation](../../../src/hooks/useAppNavigation.ts) → App/Sidebar → Workspace root navigation                                                                                          | 唯一动作、committed request、稳定 Home scope 与 fresh CAS；删除随机草稿事件、预热/materialized 双轨和 dead general tab owner，见[新建导航审计](new-conversation-navigation-audit.md)                | 普通 Codex 侧栏的运行时 fresh 行为、完整冷草稿 picker 仍 unknown                                                                                                                       |

## 窗口与首页排版重定位（2026-10-18）

实际主Shell为app-initial，sidebar-a9ef58c0cd4b.js是ScheduledSidebar，旧主侧栏映射作废。用户最新截图指定 rail-with-contextual-sidebar，已直接替换上一轮误选的legacy。AppNavigationRail为本地职责名，采用已证36px控件/两侧8px；上下文可折叠，保留52px rail。AppSidebar和SettingsNavigation共用useSidebarWidth/SidebarResizeHandle。参考HeaderAction三槽scope/注册/排序/身份清理迁入app-shell/AppShell，侧栏开关left/order1经唯一renderer呈现，44px共享标题栏。后继已接入Header页面注册、metadata及MainContentLayout两级优先级；ThreadWorkspaceHeader迁入共享renderer，删除工作区46px页头宿主/inset及折叠补位。后继清退其重复导航、常驻状态/目录及专用派生；普通线程title/rename由同包pc/mc/ac确认存在，隐藏identity和NS非空分支仍待实际布局合同，见[补证](../../exec-plans/artifacts/codex-shared-page-header-20261018/thread-controls/report.md)。实现/验证见[共享页头计划](../../exec-plans/codex-shared-page-header-20261018.md)。完整fade/统一工作区其他槽/过渡context及原线程开发名称仍unknown；不以本地AppShellContent职责名称冒充参考原导出。

首页只保留Banner presentation与统一Composer；删除伪装为ambient建议的旧13入口、HomeAmbientSuggestionsContent、HomeSuggestionList、Guide/Drawer/Manager、专用hooks与类型，以及旧恢复卡、项目会话目录和推荐callback接线。上游存在同名export不意味着Lime在缺数据端点时应留空壳。独立Composer布局最大48rem，仅一次panel留白；编辑区136px为用户要求放大的显示选择。useWorkspaceBackgroundSessionRuntime保留侧栏所需canonical状态，删除Home恢复专用状态/导航，不建第二后端。永不显示的creation selector、无人消费的运行卡/Memory/Channels props及为其计算数据的LandingSessionRuntime均已删除，当前ConversationScene直接消费landingSurface。current ambient生产数据能力仍为gap。SettingsPage已删除双栏、多余Title和窄浮层。

当前验证、精确原件和未完成的Home内容/内部命名/账户位置差距由[本轮报告](../../exec-plans/artifacts/codex-shell-layout-rea-20261018/report.md)持有；组件测试通过不冒充实际GUI或全结构对齐。

后台恢复清退的后继验证：当前侧栏承接单会话/双会话reload，真实Gate B已通过。restart暴露RuntimeCore把历史loaded误判为执行仍存活；对照公开Codex thread_read_response_inner/set_thread_status_and_interrupt_stale_turns，以actor active Turn及现有RuntimeTurnDriverCompletions中尚未完成收敛的具体identity派生执行事实，删除仅区分actor存在的临时actor_loaded。具体pending Turn读取是Lime对既有终态投影约束的内部适配，不冒称上游原字段；不合成terminal、不改持久化或新增owner。公共JSON-RPC冷恢复回归已复现，修正及后继验收由同一布局计划/manifest持有。

普通持久化会话的后继公共turn/start另复现“界面空闲但旧Turn仍active”：ensure_current_session_hydrated直接插入raw历史状态。现改用同一SessionLoadContext已归一化的session/turns，其余StoredSession数据不变；这属于既有owner接纳状态修正，不是新增read model或恢复API。普通/fork公共4、hydration1、read13、pending recovery5及multimodal queue1共24项通过；真实GUI restart继续发送/停止27、双会话reload隔离33项通过，原Main15秒/零mock/freshness不变。标准GUI/current聚合及历史退出超时的unknown边界统一见布局报告，不把此修正冒称上游原函数结构。

## 已确认结构与方法，原类名未知

| 参考职责 / 可确认成员                                                                                                                                     | Lime current owner                                                                                                                                                                                                                   | 对齐合同与限制                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主 Composer provider / Controller / EditorView；原类与 hook 名 unknown                                                                                    | [ComposerController](../../../src/components/input-kit/ComposerController.ts)、[ComposerEditor](../../../src/components/input-kit/ComposerEditor.tsx)、`useComposerController`，Workspace 共享给 Home/Inputbar                       | 唯一 EditorState、Transaction、revision 与 typed submission，见[主输入审计](main-composer-audit.md)。`RichTextInput`/`CodexComposerAdapter` 仅为样式或诊断名，不据此迁名              |
| registry：`createNodeView`、`getSnapshot`、`subscribe`、`unregisterNodeView`、`publishNodeViewUpdate`                                                     | [CodeBlockNodeViewRegistry](../../../src/components/input-kit/CodeBlockNodeViewRegistry.ts)                                                                                                                                          | Controller 生命周期持有，稳定 snapshot/listeners，Portal 只消费同一 registry。类名为 Lime 实现命名，方法名可按原成员核对                                                              |
| NodeView：`destroy`、`ignoreMutation`、`stopEvent`、`update`、`selectLanguage`、`getAutoDetectLanguage`、`updateCodeElement`、`focusEditor`、`getContent` | [CodeBlockNodeView](../../../src/components/input-kit/CodeBlockNodeView.ts)、[CodeBlockToolbar](../../../src/components/input-kit/CodeBlockToolbar.tsx)                                                                              | 保留 PM contentDOM，toolbar 与正文事件分工、语言事务保 attrs/selection；见[NodeView 审计](composer-code-nodeview-audit.md)。类名与 React 组件名不是已恢复的上游原名                   |
| highlight / Auto detection 两个 PM plugin；原开发名称 unknown                                                                                             | [composerCodeBlockHighlight](../../../src/components/input-kit/composerCodeBlockHighlight.ts)、[composerCodeBlockAutoDetect](../../../src/components/input-kit/composerCodeBlockAutoDetect.ts)，同一 Controller/View 下的独立 plugin | 位置/节点 cache、UTF16 Decoration、异步失效与销毁保护；见[高亮审计](composer-code-highlight-audit.md)，不能把 NodeView CSS class 当作高亮实现                                         |
| retained/prompt documents → renderer persisted atom → Main file store；原类名 unknown                                                                     | [ComposerDraftCoordinator](../../../src/components/input-kit/ComposerDraftCoordinator.ts) → `persistedAtomHost` / `persistedAtomStore` / `persistedAtomFile`                                                                         | 唯一 keyed 草稿 owner，Home/local promotion、CAS、scope/generation/revision/token 与正常退出；见[保存审计](composer-draft-persistence-audit.md)。不搬压缩类名，不建第二 history store |
| `thread-virtualizer` / `virtualized-turn-list` 是包模块名，公开符号多为压缩 alias                                                                         | [threadVirtualizer](../../../src/components/agent/chat/projection/threadVirtualizer.ts)、[VirtualizedTurnList](../../../src/components/agent/chat/components/VirtualizedTurnList.tsx)                                                | 纯几何与 React 消费分工；canonical paging 与 viewport DOM range 分离。删除旧渐进尾窗/全量展开，不声称原目录或类名已恢复                                                               |
| pending request card / panel 组合；完整原命名未在本账本确认                                                                                               | [PendingRequestItemPanel](../../../src/components/agent/chat/components/PendingRequestItemPanel.tsx) → [ApprovalCard](../../../src/components/agent/chat/components/ApprovalCard.tsx)                                                | same server request/decision authority，替换单行审批提示；实现与验证见[执行计划](../../exec-plans/codex-gui-alignment-current-plan.md)，不由组件形状推断所有自动审查变体已完成        |
| browser/artifact/terminal/subagent 右侧 surface 组合；完整原目录和 registry 名 unknown                                                                    | [RightSurfaceHost](../../../src/components/agent/chat/workspace/right-surface/RightSurfaceHost.tsx)、既有 registry、BrowserTabHost                                                                                                   | 单一 host/scoped display state，既有原生 owner；Browser 生命周期已有相应 Gate，不能扩大到全部 surface                                                                                 |

设置未保存保护补充映射：参考 `settings-page` 的 requestNavigation / pendingNavigation 数据流 → [useAppNavigation](../../../src/hooks/useAppNavigation.ts) 唯一导航 owner；参考 `settings-unsaved-changes-dialog` 的继续编辑/放弃 → [SettingsUnsavedChangesDialog](../../../src/components/settings-v2/_layout/SettingsUnsavedChangesDialog.tsx)。对话框名称按成员职责命名，不声称恢复了原开发符号；外部 registry 原类型仍 unknown。Memory 在 [useMemorySettingsDraft](../../../src/components/settings-v2/general/memory/useMemorySettingsDraft.ts) 保有 draft/snapshot/保存，规范化迁至 [memoryConfig](../../../src/components/settings-v2/general/memory/memoryConfig.ts)，页面内联副本直接删除；[useSettingsDraft](../../../src/components/settings-v2/_layout/useSettingsDraft.ts) 只报告 dirty/saving。配置/SOUL首批 owner 的原生6/6与组合验收已通过。页内笔记已拆至 [MemoryNoteEditor](../../../src/components/settings-v2/general/memory/MemoryNoteEditor.tsx)，同步迁输入版本/保存锁、独立登记与局部页签挂载，删除内联副本；新20项、定向126/126、标准verify:local整轮exit0及原生第5轮笔记6/6通过，收据见 `.lime/qc/settings-note/final-20261015-1/receipt.json`。不冒充上游同名符号或完整设置保护。

Web Search 沿用同一导航合同，草稿与保存归 [useWebSearchDraft](../../../src/components/settings-v2/system/web-search/useWebSearchDraft.ts)，配置投影/字段合并归 [webSearchConfig](../../../src/components/settings-v2/system/web-search/webSearchConfig.ts)。四个局部页签只消费同一草稿，原巨型页面的整份Config快照、保存和定时器副本已删除；保存经既有串行updateConfig合并最新配置，只修改用户编辑的字段，保留其他owner和未编辑引擎。定向5 suite 80/80、严格lint/typecheck、默认verify:local整轮exit0（130批/1764文件、contracts、标准GUI24/24）及原生首轮Web Search 6/6通过；849 IPC，57源码/3145产物/sidecar零漂移，Main正常退出。收据`.lime/qc/settings-web-search/final-20261016-1/receipt.json`；不能推广为全部设置或live搜索。以上新职责名没有同名上游符号证据。

Environment 同样沿用 REA requestNavigation/pendingNavigation 合同，编辑/保存归 [useEnvironmentSettingsDraft](../../../src/components/settings-v2/system/environment/useEnvironmentSettingsDraft.ts)，纯投影/字段合并归 [environmentConfig](../../../src/components/settings-v2/system/environment/environmentConfig.ts)，预览遮罩归 [EnvironmentPreviewPanel](../../../src/components/settings-v2/system/environment/EnvironmentPreviewPanel.tsx)，展示原语归 [EnvironmentFields](../../../src/components/settings-v2/system/environment/EnvironmentFields.tsx)。删除原页面整份Config、内联保存/重读和随变量名称改变的React key；开关/超时各自合并、变量列表保持原子字段，迟到响应不能清除新编辑。命名为Lime职责名，原始表单符号仍unknown。最终定向4suite51/51、默认前置/前端续跑131批/contracts/标准GUI24项组合与原生第5轮通过。可见四路导航加保存读回5/5、主题投影4/4；New仅组件证据（设置壳卸载AppSidebar）。原生四轮失败与QC清理事实保留；收据`.lime/qc/settings-environment/final-20261016-3/receipt.json`。原符号、全皮肤/Windows与完整GUI仍未验。

以上命名 unknown 不妨碍对齐已观察的职责、调用关系和数据合同；获得新可确认导出或 source map 后再直接迁移调用者。不要以压缩局部名、chunk hash、概念同义或同名文件数量推导源码等价。

## 仍需映射或实现的范围

- 设置导航/返回的四项真实合同与默认130/130批组合验收已通过；Memory配置/SOUL、独立笔记和Web Search纵向合同已分别通过原生验收，其余内容target与其他表单仍待交付。不能复制未知registry、隐藏功能或建立第二history。
- 完整 thread shell/header/overflow 与命令菜单消费；现有各局部审计不是全包清单。
- Office/PDF 的真实排版、批注与版本 owner；见[专业文件审计](professional-files-audit.md)。目前文本抽取不能替代排版预览。
- 原生应用工具、授权/执行/反馈，以及环境连接/remote 的产品入口；共享 App Server 边界继续有效，不能另造 runtime。
- 目录、函数、类型、类与所有调用者的完整可追溯覆盖。当前分母未完整枚举，不给出全产品命名或结构百分比。

current 为表中的既有 owner；compat 只保留设置 `Experimental → Developer` 的现存委托；未完成能力按 gap/unknown 登记。已替换的别名、随机 general 草稿 owner 和旧组件属于 dead/deleted，禁止为旧测试恢复。单个切片的行为、结构、清理和进程验证分别由执行计划记录。

Lime 保留主题、多模型与首页 Banner，分别走原 token/skin、catalog/provider 和 Home presentation；三项均不扩展为布局、导航或状态机的额外保留例外。

Execution Policy沿用同一导航合同；[useExecutionPolicyDraft](../../../src/components/settings-v2/system/execution-policy/useExecutionPolicyDraft.ts)拥有编辑生命周期，[executionPolicyConfig](../../../src/components/settings-v2/system/execution-policy/executionPolicyConfig.ts)负责可编辑投影/字段合并，[ExecutionPolicyFields](../../../src/components/settings-v2/system/execution-policy/ExecutionPolicyFields.tsx)与[PolicySourceLayerPanel](../../../src/components/settings-v2/system/execution-policy/PolicySourceLayerPanel.tsx)分别编辑/展示。原1215行页面缩为420行，fullConfig/完整agent副本、内联保存/重载和固定浅色样式已删除；统一useSettingsDraft/updateConfig，新增compat/deprecated为0。新名字仅表达职责，参考表单原符号unknown。最终定向5suite51/51、证据护栏9/9、默认前置/续跑131批/contracts/标准GUI24项组合及两组真实Electron通过；原wrapper超时exit1保留。导航可见合同5/5、四主题4/4、规则CRUD与完整配置保持；冷启动32/32含失败保稿/Save重试及三次正常Main退出。旧原始错误、dirty Reload丢稿、IPC成功冒充写入成功及空Host统计fixture同步删除，收据`.lime/qc/settings-execution-policy/final-20261016-1/receipt.json`。New/诊断定位为组件证据；全皮肤/工具执行/live/Windows/参考实时仍未验，整体GUI partial。

历史草稿切片：ProfileSettings公开导出已由匹配安装包确认，Lime `account/profile/index.tsx`同名，但目前是本地配置编辑，语义等价仍partial。内部新useProfileDraft/profileConfig/ProfileFieldCard/ProfileSummary是职责名，不声称恢复上游符号。页面892→381行；完整Config快照、全profile覆盖、提前清稿、timer/原始错误、无实现头像上传及8键/旧正向测试删除，复用唯一updateConfig与useSettingsDraft/useAppNavigation，compat/deprecated新增0。定向4suite56/56、翻译2suite11/11、默认verify:local整轮exit0（131批1770文件）、contracts与标准GUI24/24通过；真实导航9/9、四主题4/4另列、冷启动第2轮32/32与三次正常Main退出通过。fixture的旧方法名比较/退出字段组装同步迁移，首轮失败原件保留。收据`.lime/qc/settings-profile/final-20261016-1/receipt.json`只关闭草稿安全合同。

参考ProfileSettings经feature flags/loading委托共享core/Layout，单一data-profile-scroll，displayName/bio与公共username/pins/identity并非Lime本地Tag/完成度/email卡片。字段与布局已先行迁移；公共数据入口与可见性继续登记gap；只保留主题、多模型、首页Banner，不新增第四项例外。core REA语义partial/truncated，内部原名与参考实时仍unknown，不为猜测建立alias、空ProfilePage/CME或平行账号后端。

Profile数据追踪新增：core source-module view `ev_e0a17e7831cc4351f87bf767347b9893a83db7de0859017b3f6dca92c54731fb`与5个精确依赖定义的REA parent `ev_87b1f8de96c9b10e16b7303b0c59c6cac67506416c13e29c22a9dde803e5bbef`连接账号query identity、GET profile page、V2 PATCH资料与is_self缓存更新。Fyt/xyt等为压缩alias，不恢复成业务原名。Lime本地Config与OEM session目前没有同义profile page/bio/pins mutation合同；本地字段/布局已替换，公共内容可见性待办，不用config/read或同名ProfileSettings消除语义gap。具体范围及字节摘要见[设置审计](settings-navigation-audit.md)。

当前本地字段内容切片（已验收）：ProfileSettings保留确认的公开名并委托ProfileContent/ProfileLayout/ProfileFieldEditor；useProfileDraft/profileConfig继续为既有草稿/纯映射owner。新内部名称仅表达职责。displayName→nickname映射显式，bio归一化、64/140、名称非空trim均已接实际DOM和保存入口。旧ProfileFieldCard/ProfileSummary/profilePresentation、Tag/完成度/头像/email/用途卡、TS/Rust退役字段和对应旧测试/翻译/原生选择器删除。新增compat/deprecated为0；远端身份/eligibility/pins/upload仍partial。恢复后定向67/67、Rust配置129/129、contracts/typecheck/strict lint、新GUI24/24、最终1.159原生导航9/9与冷启动32/32、四主题4/4通过。全量前端131批和workspace7121通过曾被观察，原始日志被外部删除，只列历史；独立旧收据已恢复。新收据与限制见current计划，不覆盖历史冻结件。

2026-10-17 入口隔离（已验收）：settingsSections 使用既有 OEM runtime 条件互斥预加载/渲染 UserCenterSessionSettings 与本地 ProfileSettings，删除本地页不可用账户卡和双挂载断言，不新增 wrapper、flag 或认证 owner。五语言 5 红例后定向 7suite107/107、typecheck/lint/format 通过。REA eligibility source-module view `ev_d842243733886bd9ced33ce5cf6ea8094fd0b7ada2ed54fa4f16aba9a8a10fdf` 仅为静态身份补证；Lime runtime 条件不等价于参考公共 eligibility，OEM 内容、远端合同和完整 GUI 仍 partial。本地入口9次/原导航9项/四主题均通过真实Electron，OEM分支仅组件证据；最终收据`.lime/qc/settings-profile/entry-final-20261017-1/receipt.json`。原生第1轮保留exit1：启动前Cargo metadata等待自行恢复，未中断进程或修改期限；场景完成后，最终freshness守卫因并行协议源码及生成产物变化拒绝验收。第2轮按标准入口更新构建，并通过已有APP_SERVER_BIN接口显式选择已校验manifest/SHA的sidecar；不放宽守卫、不改生产helper、不覆盖失败证据。

本地字段切片原生结算：导航 `settings-profile-content-native-20261016-1` exit0、9/9，四主题4/4另列，732px/嵌套滚动0/溢出0；1634 IPC、错误/mock0，Main39961正常退出。冷启动 `settings-profile-content-cold-20261016-1` exit0、32/32，98 IPC、错误/mock0，三次Main正常退出与完整配置恢复通过。七张截图人工复核。25声明源码/83原生源码/321产物后验无漂移；Rust实际编译配置129/129（新退役字段回归在内），默认门禁尚在运行。单独的账号session卡、远端公共身份/可见性仍partial。

设置内容搜索的公开文档导出`settingsSearchDocuments`已由REA source-module view `ev_34efb5366f4d9b0617273007cb751bc8764c71383e46d983b157745ce735b1a0`确认；索引结构与内部压缩函数分开处理，不引入5234条参考消息或50组隐藏功能。Lime首批9个内容目标和15个current章节标题已进入单一搜索owner，静态证据与实施合同见current计划；原生验收另记，不扩大为完整设置搜索。

设置搜索实施映射：公开`settingsSearchDocuments` → [settingsSearchDocuments](../../../src/components/settings-v2/settingsSearchDocuments.ts)；翻译匹配 → [searchSettings](../../../src/components/settings-v2/settingsSearch.ts)；输入/键盘 → [SettingsSearch](../../../src/components/settings-v2/_layout/SettingsSearch.tsx)；已提交目标 → [useSettingsSearchTarget](../../../src/components/settings-v2/_layout/useSettingsSearchTarget.ts)。后三者是Lime职责名，参考内部函数压缩名仍unknown。唯一settingsSections派生标题，本地Profile2/Environment3/ExecutionPolicy4静态目标共9项；OEM不索引本地资料，旧侧栏内联过滤/搜索样式直接替换，无第二history、dirty或业务authority。requestKey只属于Renderer定位，确认放弃后重建内容子树；静态target替代参考scrollText文本扫描是Lime实现选择，非原算法逐字等价。16suite198/198与后续验证见current计划，首批9项已通过隔离快照真实Electron验收，完整内容覆盖仍partial。

搜索最终结算：9/9稳定目标、四主题4/4、说明/重复、桌面和600px窄屏草稿/焦点通过；原生第5轮exit0、1740IPC、错误/mock0，91源/1161产物/sidecar零漂移、Main正常退出。前四轮失败均保留（视觉token1次、并行freshness3次）；最终验收绑定独立验证快照，本轮18份源SHA与原工作树一致，不声明最新并行runtime通过。定向198/198+最终搜索27/27、typecheck/lint与标准GUI24/24通过；全仓file-size既有失败及默认整轮未跑分别记录。收据`.lime/qc/settings-content-search/final-20261017-1/receipt.json`；只完成此切片100%，整体GUI partial。

联网搜索15目标扩展（已验收）：沿同一settingsSearchDocuments增加path，getSettingsSearchDocument白名单解析→SettingsPage→唯一settingsSections→WebSearchSettings.initialTab→原Tabs与FieldBlock→原useSettingsSearchTarget。getSettingsSearchDocument/initialTab是Lime职责名；参考只有settingsSearchDocuments公开名及path/scrollText职责已确认。不存在新路由/历史/草稿/配置owner；待确认搜索不切内部页签，放弃后依原requestKey重建。固定search默认入口直接替换，compat/deprecated新增0。定向8suite133/133、完整typecheck/lint/脚本/参考/docs边界通过；同一隔离组合标准24/24、原生累计24/24（新增15/15、4页签）、主题4/4及600px窄屏通过。1683IPC、错误/mock0，91源/1376产物/sidecar零漂移、Main正常退出。本批10份覆盖源码与原工作树相同，11张截图人工复核；快照准备失败与原工作树V8缓存缺失导致的wrapper exit1均保留，缓存已由现有脚本恢复并校验，未声称最新并行Rust/default通过。收据`.lime/qc/settings-content-search/web-search-final-20261017-1/receipt.json`只关闭本批100%，整体设置/GUI仍partial。
Memory / Appearance搜索结构（2026-10-17，已验收）：沿原静态索引/path/sections/canonical requestKey链新增7+5目标，累计36。MemorySettings → SoulSettingsPanel / AdvancedMemorySettings，页面保留导入文本/预览和useMemorySettingsDraft，MemoryStoreStatusPanel保持挂载；AppearanceSettings → AppearanceSettingsView，原appearance与Config owner不变，语言选项复用同一LanguageOption。新组件/类型名仅为Lime职责名，上游原名unknown。旧过长内联展示、重复ResponseLanguageOption与Memory固定memory初始入口直接替换；无compat/deprecated、第二草稿或路由authority。入口871→566与993→418行，其余新展示最大681行。8suite105/105与strict lint通过；进程/产品证据结算另记，不能将本批搜索或拆分等同于整页/整体GUI完成。参考主题差异仍由原skin owner保留，多模型与首页Banner未受影响。

本批最终验收：原生36/36累计、12/12新增目标与Memory3页签、四主题/窄屏/导入草稿保护均通过，标准24/24、定向105/105、证据护栏8/8、typecheck/lint和相关边界通过。1757IPC、错误/mock0、同一canonical identity/turnStart=1，Main正常退出；95源/1481产物/sidecar无漂移，10覆盖源与原工作树SHA相同，10张截图复核。完整默认/最新并行Rust未重跑；整页布局/业务及内部上游原名仍partial。辅助命令失败原件与最终成功记录分别保留；新双份收据`.lime/qc/settings-content-search/memory-appearance-final-20261017-1/receipt.json`不覆盖旧冻结证据。

专业文件当前映射（2026-10-17）：REA 确认的 `PdfPreviewPanel` / `DocxPreviewPanel` → 同一 `artifact/document/` current 组件；`previewArtifact -> PreviewArtifactRenderer` 统一格式分发，文件树与会话 artifact 共用，原字节仅走既有 `readFileBytes -> fs/readFile`。PDF 页面、文字选区、截图与 DOCX 版式、位置分别适配，共用 `ArtifactAnnotationDraftStore` / `ArtifactAnnotationCommentEditor` / `documentAnnotation`、`useDocumentAnnotations` / `ArtifactAnnotations`。PDF 旧共享路径/导出已直接迁移，无 alias。公开组件名来自安装包；内部名为 Lime 职责名，参考压缩符号与原 npm 版本仍 unknown。

DOCX 单条第13轮、跨两页批量第4轮已独立原生通过；来源 Turn 来自 canonical thread_turns，typed start/queue settlement 仍为唯一提交 owner。`artifactAnnotationSubmission` 为浮层和 `ArtifactAnnotationComposerAccessory` 共用批量捕获/发送/revision-safe cleanup。fixture 从父文档读取 iframe DOM，以 CDP Input 操作真实鼠标，sandbox 未开放脚本。Main 正常退出、零错误/mock/freshness 与摘要稳定仅绑定候选1.159.0，不代表根1.160.0并行后端。

主 Composer 回原文的旧文本构造、`document_pages` 误选 Canvas 的两处逻辑及旧正向 selection 断言已替换；现统一 `openFilePreviewArtifact -> openArtifactInWorkbench`。回跳第2轮 DOCX/第1轮 PDF 正确打开 ready 面板但丢失编辑卡，已改为等待读取完成再发布聚焦，导航/卸载/后续请求使旧请求失效，最新原生仍待验收。新增 compat/deprecated 为0；文本 Canvas 仍服务文本，不整文件误删。Store 仍为内存；跨 Workspace/进程耐久性、幻灯片、Office 原文件编辑保存和 Workbook 范围反馈为 gap。WorkbookPanel 已按公开导出实现只读 XLSX/CSV/TSV，同一 gateway 的 Worker 原字节解析、snapshot、虚拟网格、页签/A1/键盘与缓存公式；70项定向通过，原生产品验收中。内部类/函数仍为 Lime 职责名，不将压缩符号猜测成原名。

主 Composer 最新合同：DOCX 第5轮和标准 wrapper5 的24项通过；PDF 第5轮原合同通过后，人工截图发现实际视口仍在第1页。最终导航请求延迟至页面总高度 DOM 提交后滚动，原生新增页码/编辑卡/实际页顶部几何联合检查，尚不声明最终定位通过。专业时间线旧二进制提前拒绝入口已统一委托原文件打开，与 PDF 导航23项定向通过。旧失败/较弱合同成功保留于 composer-review-20261017-1 收据；没有过滤错误、改期限或删失败断言。

2026-10-17 范围反馈接续：PDF 原生第7轮真实视口几何及人工截图通过；工作表只读第7轮完整通过并人工复核原字节网格、样式及 canonical 文件变更打开。artifact/write 的公开投影为 fileChange；fixture 改为真实变更入口并严格保留原 item、只增加本次唯一 event item，不制造 read marker。Main 均正常退出，失败轮次保留。

新增工作表范围反馈已使用 sheetName/sheetId/address、sourceFormat 与源 SHA；范围输入、Shift/拖选和原工作表定位复用同一 WorkbookPanel。共享草稿/编辑卡/Composer accessory/批次 settlement 已直接迁移至 `artifact/annotations/`，页面坐标保留为 document 适配器，无兼容别名。18 suite / 176 定向项、完整类型与 strict lint 通过；共享最终原生、标准 wrapper 和默认门禁仍待结算。REA asset item `ev_7c1eedad628984e0df7802a217280a8697af1f32afcd8352a29c71892d4f8890` 只绑定原成员摘要；addCommentThread 与导航范围语义来自同摘要原字节有界阅读，不冒称完整静态分析或参考运行。Office 编辑保存/roundtrip、幻灯片、重启耐久性及整体 GUI 继续开放。

专业文件最新结算：导入6、Workbook7、PDF9、DOCX7完整原生与标准wrapper24/24通过，绑定94源/1688产物无漂移；收据`import-source-path-final-20261017-1`只关闭源路径、分发及共享批注回归。旧“最终共享原生待验”属历史状态。canonical reader保留原path/move_path，显示裁剪不再污染操作identity；无用document_text分支直接删除，未新增compat/deprecated。

应用scope批注接续：`artifactAnnotationDraftsAtom -> ArtifactAnnotationDraftStore -> ComposerController`复用既有Jotai应用Store，Workspace卸载不重建正文/位置/pending；submit仍由Workspace委托原typed acceptance，跨会话过滤和revision-safe结算不变。上游只确认app-shared scoped signal与jX导出，Lime atom/类名为职责名，不冒称压缩符号的原名。4项红后61项绿、实际Composer隔离33项通过；新原生与wrapper待独立结算。进程重启、Slides、Office编辑保存及整体GUI继续开放。

应用 scope 批注已独立冻结：标准 wrapper24/24，Workbook 原生第8轮真实设置导航卸载原 Workspace（原 Composer DOM isConnected=false），返回后两条正文、位置、源文件变化错误及主草稿保留；显式重定位后整批仅新增1个Turn。Main code0/signalnull、forcedCleanup null、console/page错误0、freshness前后ready，94源/1688产物无漂移。收据 `.lime/qc/professional-files/annotation-scope-final-20261017-1/receipt.json`，SHA `f40cbab2cbaf82af4696797e4dc5d89c48e8173725c4aa452bb723b7f779b5a4`，设置返回截图已人工复核。该收据不包含后续 Slides 变更；进程重启耐久性仍 unknown。

Slides最终验收（2026-10-17）：PresentationPanel、源slideId/点位置与跨slide反馈已沿统一artifact/annotations/Composer实现。Slides4、导入9、DOCX10、PDF12、Workbook11五原生及wrapper3的24/24通过；106声明源/2133 regular产物零漂移（更正此前2022）、错误0、Main正常退出、freshness前后ready。双份收据 .lime/qc/professional-files/presentation-final-20261017-1/receipt.json，SHA b58c5f2371fd49bd338e1a8fb028d4eea8697a43370e20dd8169aa41e57197f3。失败及人工发现的旧toast均保留并修复，完整说明见专业文件计划末节。旧不完整PPTX构造器、DOCX共享驱动名和PPTX系统打开正向分发已替换，无compat/deprecated新增。候选后端1.159.0，根1.160.0默认9因并行Cloud生成类型缺account而失败；不声明最新根通过。Office编辑/flush/save/冲突/roundtrip、其余GUI/符号和平台证据仍开放。

## Workbook 原文件编辑与保存接续（2026-10-17）

复用工作簿 REA parent `ev_e43b4b7ce0e35465a48ce864b3da1b7c8d892cb8955c0fc33431e3d2195215dd` 与实现摘要 `fff4db5c2d594b7bcaec3569f6ab335d2fd0b982a891109c5a053210ef30a6e9`；新保留原字节上下文确认 `openCellEditor`、`commitCellEdit`、`cancelCellEdit`、`updateFormulaInput`、`setActiveSheetName`、`setSelectionRect`。`WorkbookController`、原包编辑 helper 与内存 registry 是 Lime 职责名，不将压缩类名 unknown 改写成已恢复。参考 CRDT 的 `flushCrdtUpdates` 不冒名套用到本地 XLSX 包保存。

current 链为 Grid/公式栏→应用 scope Controller→flushEdits→原文件两次SHA核验→原包定点修改/统一CSV词法→既有 `writeFileBytes / fs/writeFile`。Workspace批注先验证结构，再flush文件，再核原批注SHA，旧版本需显式重新定位。删除重复CSV parser、只读文案及sheetIndex authority，compat/deprecated新增0。XLSX非目标payload保留、公式缓存清理/外部重算；受保护表和分组公式保存明确失败，不声明完整Excel编辑、CAS或重启耐久性。

定向7suite91项和末次原包/词法/Controller24项通过；完整Renderer/Node类型、strict lint与命令合同通过。根1.160.0完整标准wrapper `standalone-shell-01-20261017133528-59598` 24/24通过，console/page/trace/mock错误0。8591份wrapper前声明源中锁文件和两份fixture有变化，原前后清单保留，不能报告该前置集合零漂移。独立持久候选 `.lime/validation/workbook-edit-1.160.0-20261017-1` 复制时8660声明源/1899regular产物与根逐份核验无差异、freshness ready；真实原生编辑/保存/冲突/flush/范围反馈正在该候选运行，尚未验收。根默认门禁另行运行，不扩大旧1.159.0只读收据。

### 工作簿编辑结构与命名结算

| 参考确认项                                                            | Lime current owner                                      | 行为与清理                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| openCellEditor / commitCellEdit / cancelCellEdit / updateFormulaInput | WorkbookController                                      | 同一编辑文档、IME/提交/取消、应用scope恢复；原压缩类名unknown                         |
| setActiveSheetName / setSelectionRect                                 | WorkbookController / WorkbookGrid                       | 迁移重复sheetIndex authority，重开保留文件选区；旧A1重置测试直接迁移并隔离Jotai scope |
| 通用flushEdits / flushPublicFile gate                                 | Controller / Workspace提交owner / 原fileBrowser gateway | 原包保存、两次SHA检查、失败保稿、旧批注重新定位；无CRDT同名伪装，无新增协议/业务后端  |
| CSV/TSV读取与写回                                                     | delimitedWorkbook                                       | 删除重复parser；原词法/编码/换行单一owner                                             |

Current新增上述职责，compat/deprecated新增0；dead/deleted为重复parser、只读文案和重复页签authority。固定1.160.0候选XLSX与三格式共享原生回归、标准24/24已冻结，收据 `.lime/qc/professional-files/workbook-edit-final-20261017-2/receipt.json`（SHA `176685cd012fb03445b17a66d3506030950f1002ca0745d3917989ace05860e7`）。候选应用scope内存不证明重启持久化或完整Excel编辑。根并行Plugin变化/默认门禁及CSV/TSV原生接续见[工作簿计划](../../exec-plans/codex-workbook-alignment.md)。

## Presentation 本地编辑结构与命名（2026-10-17，原生验证中）

| 参考可确认符号/合同                                                                                                | Lime current owner                                 | 结构与语义边界                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| PresentationPanel / source slideId、elementId                                                                      | PresentationPanel / PresentationSlideView          | 沿原文件预览owner扩展，无第二个编辑页面或runtime                                   |
| setSelectedSlideIdx、setSelectedElementId、setEditingEnabled、textActivateBlockEnd、textHandleInput/CompositionEnd | PresentationController                             | 应用scope唯一稿件/选区；原始类名unknown，Lime类名为职责名                          |
| nudgeSelectedElements、updateSelectedElementFrame/Style、deleteSelectedElement、undo/redo                          | 同一Controller与受限iframe父文档overlay            | 顶层对象原ID、原尺寸坐标；方向键重绘保焦点、IME取消不落盘                          |
| 本地编辑导出→500ms串行保存、ETag/ifMatch                                                                           | presentationPackage + 既有fs/readFile/fs/writeFile | 第一切片为原包定点修改/手动保存/两次SHA检查，不能冒称Walnut导出、CRDT或原子CAS等价 |
| 批注前flush / 保存后文件版本校验                                                                                   | useWorkspaceArtifactCommentSubmission              | 复用current文件网关与typed start/queue；旧SHA拒绝、明确重定位后再发送              |

旧只读限定与缺写入网关的测试fixture随实现迁移；新增compat/deprecated为0。包编辑66、Controller8、Panel9、Workspace提交38项分别通过；原生编辑/冲突/应用scope保稿与flush待候选最终收据，不能引用旧只读PPTX收据冒充。完整分组/表格文字、幻灯片增删排序、自动保存/关闭flush、CRDT和平台证据仍gap。原caller来源、40段有界上下文及unknown见[审计](professional-files-audit.md)，唯一实施状态见[Presentation计划](../../exec-plans/codex-presentation-alignment.md)。

后续current接线：addSlide / duplicateSelectedSlide / moveSlide / deleteSlide已沿同一Controller落地，有序`presentationEdits`统一对象与页结构的undo/redo/保存；原包结构codec94/94、Controller13/13。真实layoutId使用本地OPC路径，不冒称上游proto identity。500ms自动保存timer委托同一flush，活动文字/IME不自动commit、失败不轮询重试，hook3/3。真实指针修复使用screen坐标避免工具栏移动iframe产生假拖动，Panel10/10；候选wrapper4与基础编辑原生继续验收。Toolbar原始字节下载/系统打开前flush由`usePublicFileAction`委托现有Controller，删除复制的文件名/Blob算法；33项worker定向通过，新Workbench导航与新候选证据仍待结算。以上名称只对REA确认的公开方法作上游映射，新helper为Lime职责名；不将本段实现写成完整Desktop完成。

### 表格单元格接线（2026-10-18）

确认的公开`tableEditing.{subscribe,getSnapshot,interact,edit}`沿同一PresentationController实现；单元格选区与对象选区分开，文字、基础样式、clear-cells仍按原序进入同一`presentationEdits`和原包codec。逻辑row/column为Lime OPC适配，未冒名cellId。`presentationTableSelection`与`usePresentationTableOverlay`是职责名；受限iframe只由父文档安装控件/监听器，不执行文件脚本。基础cell新候选1已通过集成59项、types/contracts/标准GUI及原生table1、结构导航批注2；11210源/382产物零漂移，IPC70/175、错误/mock0、两个Main正常退出。新收据`presentation-table-final-20261018-1/receipt.json`的SHA为`2ff9a27cec2c30878fd90b6caa43d2b28a4a8e21e94d9f1b9efddd6736d3e681`；旧原件仍missing。

原包结构延伸以`presentationTableGrid`共用矩阵，`presentationTableStructurePackage`实现五种insert/delete/resize动作；纯`presentationTableInteraction`只返回导航/追加意图，末格Tab复用同一历史追加，numeric选区clamp。控件按已绑定panel-structure-menu改为Portal菜单，保留键盘打开/Escape回焦与禁删尽轨；不是上游内部原类名恢复。新结构codec47、既有cell46、Controller14与overlay9通过；独立11219源候选2已通过292项集成、types/contracts、标准GUI与13阶段native；605产物零漂移、IPC124、Main正常退出，收据 `presentation-table-structure-final-20261018-1/receipt.json` SHA `a84586f7cd192f202653592da5c04fa1ee6d4bb5b3cc52fb363926e928211d34`，不扩大候选1。高级8动作和track接线另建验收。 整格rich text、其余表格动作、group及完整GUI仍开放，新增compat/deprecated为0。

### 表格格式、对象集合与canonical文本接续（2026-10-18）

高级表格已由候选3独立冻结26阶段原生验收。custom格式及theme覆盖由候选4冻结16阶段、124 IPC、源码/产物零漂移，收据 `presentation-table-format-final-20261018-1/receipt.json` SHA `dc1ff140edcff54136ae5136cc20ffe68ca27c7ef6620b1b028777a87c03788b`。`presentationTableStyle`/`presentationTableTheme`/`presentationTableBuiltinStyle`继续同一原包与派生renderer职责，不保存renderer fallback定义到文件。device pixel量化由真实Electron证明，声明与显示宽度独立核验，旧失败保持可追溯。

对象状态直接使用已确认的`selectedElementIds`/`primarySelectedElementId`，删除单选state alias；交互预览/提交归`presentationElementController`，原始spTree层级修改归`presentationPackage`。Lime职责型模块名不冒称压缩前类名；SAT框选是明确本地策略，group/ungroup producer保持unknown。候选5独立绑定对象/builtin冻结字节，790项、types/contracts与标准GUI已通过，原生交互仍待终态。

文本方法保留`textActivateBlockEnd`、`textHandleInput`、`textHandleCompositionEnd`并由唯一Controller委托文本协调模块；canonical范围为block/para/run/char，`presentationTextDocument`只登记原始XML/关系，`presentationTextRange`/`Selection`/`Style`/`Html`负责转换，`presentationTextEditor`只处理受限iframe的父DOM事件。旧textarea生产入口已替换，8份原生场景及组件测试迁current DOM，返回字段改为activeTextEditor，旧名字仅留负向回流检查或历史证据。草稿undo/redo与提交后的全局历史分层，但最终只提交同一text action/原包事务；新公开内部类型按职责命名，未声称恢复参考原类名。富文本仍待独立candidate Gate B与最终根门禁。

### 设置草稿与Queue拖拽（2026-10-18，renderer已实现）

MCP `useMcpPageEditorState`、Experimental `useExperimentalSettingsState`、Media `useMediaServicesDraft` 均委托同一 `useSettingsDraft -> SettingsDraftContext -> useAppNavigation`，保留唯一字段草稿与既有配置/CRUD gateway。内部server/tab切换不绕过保护；dirty原始输入、同步在途锁、失败保稿与卸载迟到分别定向验证44/35/37项。Experimental折叠非编辑搜索锚点补充后36项通过，不自动展开凭证。上述hook名为Lime职责名，参考内部表单符号unknown；原页面重复状态/保存与不受控timer直接替换，不新增兼容层、store、协议或业务authority。

Queue公开`onDragEnd`行为由原生handle/drop接入现`QueuedMessageList`；按ID变换`queuedMessageReorder`为Lime职责名。按钮/方向键/拖拽统一进入`runAction -> reorderThreadQueue`并重读canonical投影；实例/thread/完整ID序/数组引用/mutation epoch校验，取消/失效/失败不本地假提交。65项局部回归、窄类型/lint/format通过；不扩active Steer或durable handoff语义。收据见Evidence索引。三个设置与Queue的真实Electron证据仍待候选，整体GUI继续partial。

候选5最终冻结（2026-10-18）：11289份声明源/1384份regular产物及prepared sidecar终态零漂移；35套790项、焦点56项、helper18项、types/contracts/标准GUI通过。builtin9的14阶段/118 IPC与objects3的17阶段/90 IPC均错误/mock0、Main正常code0/signalnull、无强制清理，两张重开截图已人工复核。双份收据 `.lime/qc/professional-files/presentation-elements-final-20261018-1/receipt.json` SHA `b814cf3479dd6e6e3ba1db70a91d002358082e707b07a5c6d7486636dd05ebb0`。旧失败全部保留，builtin7退出超时未定位原因，不据新通过声称修复；富文本及后继字节不属于本冻结候选。

Developer/Media静态内容搜索（2026-10-18，renderer已实现）：原`settingsSearchDocuments`由36扩为47目标，Developer仅静态折叠组外壳，Media9常驻卡与图片数10目标；同一白名单/path/sections/定位requestKey，无新路由或索引authority。原字符串、配置值与凭证不索引，不自动打开或聚焦秘密输入。139项局部回归含五语言55次真实lazy页面定位与跨target草稿保护，strict类型/lint/格式通过；真实Electron后继候选待验。原内部名称仍unknown，不把单批索引数量当完整GUI分母。收据见Evidence索引。

### 粘贴参数与Main退出顺序补证（2026-10-18）

同摘要panel/worker片段确认`textHandlePaste`输入为clipboard对象，根已迁为
`{plainText,html}`并一次更新DOM及回归调用，不留旧签名包装。
`PresentationTextClipboard`是本地职责型类型名；REA跨worker语义trace未匹配，
不宣称恢复了完整原始类型或调用图，详见[补证](presentation-clipboard-followup-20261018.md)。

Main `eZe`/`u7`的prepare→drain→恢复quit顺序映射到
`electron/appQuitLifecycle`→既有`AppServerHost.stop`；原fire-and-forget stop接线
直接替换，无compat。重复请求共享同一drain是明确本地实现选择；上游flush集合、
context dispose界限与资源树不冒称同义。26项定向回归、严格lint、Electron类型通过；
新固定产物原生验证待做，历史偶发超时根因unknown，原15秒门禁不变。

### 共享页头清退与unified合同后继（2026-10-18）

同一AppShell registry的Header/MainContentLayout已接管普通会话页头；独立46px宿主、侧栏补位、重复导航、常驻状态/目录及专用派生/props直接删除，没有新增compat/deprecated owner。清退74项、VM4、完整types/lint、标准GUI24/24和canonical动作后继通过；settled画面检查另暴露分叉raw hydration绕过workspace草稿导航，原120秒失败保留。调用迁到唯一`handleOpenTaskTopic`后，真实后继再次暴露initialScope恒等门槛；修正同一CommandWiring的初始路由恢复生命周期，red/green37、完整types、标准GUI24、真实7图/父子与设置返回草稿隔离及加严Fork Gate B均通过。unavailable backend，无Turn/模型；历史失败保留。

`HeaderToolbar`/`.Actions`/`UnifiedTabStrip`是安装包明文属性；其注册器与shell完整渲染器REA parent分别为`ev_510ea23eb3f657aa91ec654e613ce44f636c57a47ec021f837f1199a098c876e`和`ev_63dece790eea4393d8906f204f9c38dd80da7d3600c7f1f19bcd5c28d4b2d31c`。各自2575/19005bytes解析不代表完整语义或运行证明；full/split/chat、tabpanel/inert/focus及六槽动作应映射既有shell/right-surface owner，产品迁移仍开放。普通及unified内部均存在条件标题；不从rail外观推断flag，不增加独立隐藏开关。精确合同、范围和限制见[unified合同](../../exec-plans/artifacts/codex-shared-page-header-20261018/thread-controls/unified-workspace-contract.md)。

### Unified产品迁移（2026-10-18，active）

唯一[专项计划](../../exec-plans/codex-unified-workspace-20261018.md)持有后继验证。HeaderToolbar/Actions/UnifiedTabStrip采用已证名称；同scope注册只持展示对象，右侧面tab与pane从既有projection显式分流，不新增业务store。Thread动作按REA容器合同进入window/chat/tab-strip，summary按split进入chat，其余留window；More始终保留窗口右槽。稳定DOM容器避免重建工具组件。旧TaskCenterTabStrip/hook/projection与旧42/84px补位、auto-hide栏物理删除；title清洗保留threadTitle，fallback导航保留canonical语义。LayoutTransition继续实际resize/transition、双击full/split/chat、aria/inert和焦点owner。mainPaneEnd/sidePanelActive是本地展示适配，不冒充上游原字段；完整route transition context及content/divider/new-tab/context-menu仍gap。架构图已由root确认依赖方向。标准GUI与真实Electron已由候选3/5结算；工具栏后继候选6另验，不把局部通过写成整体100%。

分隔条后继复用LayoutTransition尺寸owner；参照新REA parent `ev_52abf6e068fc01327c50e66fda539aa7fa2fdabf8c2fea6d1b10c0ff0e249e8d`补10px键盘步进、内容Home/End、separator尺寸aria、主键/pointer身份、起点增量与双击默认宽度，清退360/420和右侧面560px旧下限为320px。28项定向及候选3/5真实后继通过。该项不关闭divider action slot、菜单、route transition或整体GUI。

候选2原生页头在full→chat→split后焦点落BODY；独立真实探针与normal Main退出保留。LayoutTransition仍是唯一focus owner，同一effect观察隐藏与布局形态。候选3完整六步骤通过，9462源码零漂移/429产物摘要；候选4只加严静止截图，同产品字节再次通过。候选5删除chatPanelMinWidth/layoutTransitionChatPanelMinWidth及team/code/Right Surface三个min常量，CSS、keyboard/pointer/aria统一320；94项、strict lint、完整types和原生六步骤通过，9462源码零漂移/541产物。失败317产物摘要独立保留。

线程summary的REA parent `ev_83011e06d28ca110820a1e0688adad13ed10e33e02d79255c483c7bd7f71c632`覆盖6精确输入16949bytes、1393 semantic unknown。完整layout与sections父证据分别为 `ev_e457dea934ddb45739ab0ef92d51716a575f57c193c1567b5e2b99fdad9e4068` / `ev_2da75de405e3fc5e7a9ae8b81d33f98e878609083d0c54db939ba7838e11fa8b`。组件producer `ev_e608e8136665557de99468feb67bb21aa3dd3ccab5b0bb0e2fbfacb24c089809`解析完整30591字节、保留1939 semantic unknown。它们为静态证据，参考运行flags仍unknown。

后继产品已直接替换Activity：`useThreadSummaryPanel`、`ThreadSummaryLayout` 和 `ThreadSummaryPanel` 为本地职责名，消费既有canonical items/children与artifact/thread/URL动作；压缩fc/tE/sE不作原始开发名称。主pane实际宽度驱动300px overlay/shift/gutter，shift同步浮动Composer；Main pin默认true，复用persistedAtoms typed gateway及同一Host file。旧Activity文件、registry、toggle与正向fixture同步删除，不新增compat。当前只覆盖plan、file_artifact输出、children和实际web_search来源；Subscriptions/Created tasks/Side chats/PR/Chrome/Computer Use、深层output identity、projectless空Sources仍partial。226项风险回归、strict lint与contracts已通过；新候选原生验收尚待运行，不能继承候选6的成功。

布局与分组补证分别为 `ev_e457dea934ddb45739ab0ef92d51716a575f57c193c1567b5e2b99fdad9e4068`（完整611bytes/19 semantic unknown）和`ev_2da75de405e3fc5e7a9ae8b81d33f98e878609083d0c54db939ba7838e11fa8b`（14完整函数18040bytes/1191 unknown）。阈值基于主内容目标宽度，不是window宽度；sections随canonical数据/能力显示。该静态调查时Main typed协议尚无该key；后继已完成同一Host合同迁移与真实pin重启验收，不能将此前缺口描述继续当current。portable bundle与完整122记录导出均经完整JSON解析和gzip解压SHA验证，保留原unknown。

HeaderToolbar后继按原注册producer与integrity核对CSS补齐boolean inset、8px默认/8+6px tab-strip、40px pane、compact/secondary、42rem具名容器与原明文DOM属性；不新增alias。28项与strict lint通过；候选6只迁四份冻结输入后重建/原生六步骤全部通过。次级动作能力与当前工具分组分开验，不凭组件API补齐声称窄窗排版完整对齐。

2026-10-19 Thread side panel 后继：单一 launcher、独立 New tab 身份、replaceTabId、Tools 分组与 Files/Changes 分工已进入 current 写集；旧独立工具按钮、底部 Shell 双轨与 Changes 专属 resize hook 正向资产已直接迁移。证据/owner/限制统一见 [对齐合同](../../exec-plans/artifacts/codex-shared-page-header-20261018/thread-controls/thread-side-panel-contract.md)。81 项定向与 157 项护栏/fixture 回归已通过；最终后继类型、lint、Electron 尚须独立结算。此前 Summary “原生尚未运行”只描述旧切片，候选 12 已有独立成功收据；后续 GUI 字节不能继承该成功。整体仍 partial。

2026-10-19 文件标签后继：REA确认的openWorkspaceFile由right-surface同一LocalState消费；按绝对路径复用tab/contentInstance，空Files选文件后被路径标签替代。RightSurfaceHost保留所有打开pane，MainArea用唯一可见状态隐藏/恢复，避免切工具/折叠重建内容；Scene删除重复可选props，继承必填合同。候选17的246项/完整types/strict lint已通过，原生仍待结算，不以DOM保持证明终端进程保持。

文件模式栏后继直接迁移为源码/预览单按钮，移除旧三按钮、option文案字段、三份ARIA键及旧测试选择器；普通源码不显示不可用操作，Markdown默认预览，CodePreview沿用主题token。组件/旧调用者/五语言41项回归已通过，候选18独立验证中。参考协调器setSave/setUnsavedChanges/switchTo、controller的save/saveUntilClean与mtime边界的完整静态记录见[文件编辑合同](../../exec-plans/artifacts/codex-shared-page-header-20261018/thread-controls/file-editor-contract.md)。上述为候选18历史只读预览；已由候选23起的CodeMirror/controller真实编辑、草稿与关闭护栏替换，不将本地职责名称当作未知原始类名。

候选18完整Renderer/Node类型、26套296项风险回归与strict lint通过；39份声明GUI输入与根逐份SHA一致。Renderer及原生待结算。候选17因隔离路径缺失触发重复编译，在Electron启动前受控终止，终态failed；18仅在逐份校验父产物后复用Host/sidecar，独立重跑全部原生场景。当前主线不继承17原生成功，也不以本切片代表并行根后端。

文件文档模型补证：REA parent `ev_2fc0aad06c84714db5247b10f1c353546fc9209fa7f5eaaf287cc320e9c282e9`完整解析56248字节、parse0、3281 semantic unknown。确认ready/conflict、review新旧方向、接受/拒绝与10MiB门槛；`kn/An/jn/Mn`及短重导出都是压缩定位符，不用于产品原始命名。原始parent/summary/module页三份完整记录已保留为`file-document-evidence-bundle.json.gz`并通过全JSON/gzip双SHA回读；这些静态合同没有关闭编辑器、保存、草稿或关闭护栏缺口。

2026-10-19 候选18产品复核：自动门禁成功收据保留，但终端截图显示Shell启动失败，产品验收拒绝；IPC success/processId相同是无效存活判据。compact截图为Chat，不证明Files排版。候选19改为standalone command/exec真实sandbox边界修复、终端状态和严格RPC/output证据，必须新构建backend。整体仍partial，Files编辑器/保存/关闭护栏尚开放。

2026-10-19 后继校准：TerminalTab/TerminalPanel明文导出已对齐；旧ProjectShellSurface/ProjectShellTerminal/TaskCenterShellPanel与叠加后台列表均为dead/deleted。候选22 recovery3真实Electron证明31秒输出、多session隔离、主题原位更新、关闭隔离与窄窗Files正文；其contracts输入缺失仍为failed，不合并成全GUI成功。后台独立kind与LocalConversationBackgroundTerminalTab/XtermOutputPanel已接线，只读canonical完整item key；66项/types通过，完整入口与session buffer fallback/native仍待验。

文件编辑切片已将普通源码路径改为CodeMirror与FileEditorController，新增current textFileStorage、fs/watch委托和同内容实例关闭护栏；旧只读源码分支在该标签被替换，媒体预览继续复用既有owner。500ms草稿、3s自动保存、串行保存/在途输入、ready/conflict、换行与关闭确认identity有定向风险回归；首次29项、扩展78项与strict lint通过，真实Electron尚待验。FileEditorController等内部名称属于Lime职责名，未宣称恢复未知上游类名；跨进程草稿、窗口退出、完整语法/搜索/编辑功能及视觉等价继续开放。新增compat/deprecated为0。

候选23已通过全部13阶段，但人工拒绝旧680px聊天下限造成的编辑区窄排版；后继24/25删除该规则并分别完成独立门禁，25全部12阶段passed、10095输入零漂移、327产物SHA见manifest，Main正常退出、mock命中0。真实保存/冲突/关闭/中文搜索/Markdown/31秒双终端通过；正常宽度正文390px，compact和完整工具栏仍partial。Summary Processes依据yx/$b精确范围及REA parent ev_e3c13d5108436dd20034ee4b66ef097519918e57078a3a24b36e4f656dfecdf9接入canonical投影与停止全部API；旧Coding新增输出按钮删除。宽度parent ev_743b2a230075368070079f5e4efdd79a87468b6fd519ee82dcf3846a2073ed10确认default600自适应及unified320下限，LayoutTransition唯一尺寸owner。runtime26真实Gate发现后台list/raw call ID与canonical item ID不一致，身份断言失败、原件保留；27只修既有process owner公开投影并补真实进程回归，重建/原生验证待结算。参考flags/interruptedItemIds/session-buffer未知，整体partial。

后台入口身份后继25：删除itemId-only回调与Coordinator进程ID前置门槛，所有调用传递同一canonical item，按完整thread/turn/item重读后交给既有标签owner；顺序改为最近turn优先。不增加兼容重载，重复ID/无processId/迟到动作有定向回归。24冻结结果不代表该后继。

2026-10-19 文件历史/审阅后继：历史工具条props按已证canUndo/canRedo/hasSaveError/isSaving/onUndo/onRedo对齐，原压缩\_n/re-export y不是源码名。FileEditorHistoryToolbar只消费当前EditorView深度和controller保存状态，右下浮动；旧顶栏Save/Unsaved已删除。候选31全部8阶段passed，10101输入零漂移/327产物，真实按钮与键盘undo/redo、跨标签历史及精确磁盘内容通过；manifest SHA 3d637b66034cebe51be20aa50c61b0f54a8862ede8b464f6610742375a11c607。30终端超时根因unknown，失败不覆盖。

file-navigation parent ev_4a45e99a84b0b2c1b589fe75def3f8594929b14c1884b68ef505f99f364ee555保留breadcrumb/tree/review三个完整成员，静态语义仍有5508 unknown。InlineFileDiffReview以已确认oldFile/newFile/canEdit/canAccept/onAction映射既有diff owner、全高overlay及底部动作；不是恢复未知原始组件名。原顶部冲突条/两列max-h64正文删除，Edit/reject/accept归同一controller，保留view并hidden/inert。候选32独立八阶段passed，18套128项风险及真实全高审阅/焦点/history/精确磁盘/31秒终端通过，10103源零漂移、327产物manifest SHA d2da1d23652c0c4499c20e01a4f77e5cd42540c72543983e14316dd733e6324e；Main正常退出，root查看三张图。文件矩阵external backend，不能冒称live或全GUI完成。

20个完整路径函数parent ev_fc11cde0223a55bca94fe0ba9400c309d1dbc351071c3a44f9c93d0015b129d5（2输入3188bytes/1097AST/parse0）补齐cwd/workspaceRoot标签、Windows/UNC/扩展前缀、WSL及active/directory映射。FileSourceBreadcrumb/filePathBreadcrumb按模块职责命名，原wn/Tn/En及其它压缩符号未冒称源码名。顶部文件名span/h11替换为共享HeaderToolbar pane、可选择路径和目录popover；WorkspaceDirectoryTree从旧递归渲染抽取，菜单与主树共用目录cache/error/并发读取owner，展开状态各自局部。文件选择回同一onSelectFile和tab生命周期。旧workspaceTreeVisibility实现/测试、unused fixture四常量和hook旧参数deleted；对应CanvasWorkbench有效文件选择风险保留，旧隐藏产物断言迁为真实目录可见。候选33八阶段passed，10106源零漂移/327产物；156项风险及真实目录菜单/复用tab/磁盘/history/终端通过，三图人工复核。后续候选目录消失，原收据/manifest/截图保留为执行时证据，不能重验。完整toolbar/search/context-menu、读取分类及全GUI仍partial，无新增compat/deprecated。

工作台共享fixture删除伪造的旧Canvas/Harness props/button与不消费的ChatNavbar mock，改为ComponentProps约束并渲染真实sidePanelLauncher。workbench01/02的有效开闭、重渲染不抢焦点、Browser目的地、无旧侧栏/库存回流迁到current入口；不为旧测试恢复生产props。根全量139批已按test:resume全部通过，Rustup PATH修正及原失败保留；不等同最新根完整verify:local。ChatNavbar仍存在条件生产消费者，未据普通会话不渲染就盲删整个组件。

2026-10-19 自然排序与默认文件动作：model/controller/store/17比较函数REA链收敛fileTreeOrder；旧isSavedContentBundleDirectory/compareWorkspaceTreeEntryName/sortWorkspaceListingEntries及正向测试删除，不保留alias。37项风险通过，34在质量/renderer通过后源目录消失，freshness及GUI/native没有通过；原因unknown。artifact-preview-header完整成员parent ev_9789fa3cd9ca0f0e4ca174c16bb2a99ccd8832cdf02ab1c710f1e99151c50893确认viewer默认Open分裂按钮，无首选target时fileManager，菜单Open in folder及可用Save as。ArtifactPreviewHeader/saveFileCopy接既有公共动作/scope、原生dialog、current fs/copy，44项回归及strict lint通过；新独立35-recovery1在非系统cache目录重建并完成contracts/Host/sidecar/Renderer/GUI/原生八步骤，零源漂移，正常Main退出。原Ze/re-export n不是已恢复TS命名。目标发现/首选target/GitHub/Drive与其它preview迁移仍partial；无新增compat/deprecated。

2026-10-19 共享目录行：36的真实Arrow/Home/End、导航不激活及完整文件/终端矩阵通过，Host/backend来源与独立Renderer明确绑定。37依据同原件bka/xAa/TAa/EAa/DAa的完整REA parent ev_5a4cce6772170c93ab2a3f0fee5c820611a9624810cba56f4468bb5f8eed5ef7替换共享renderer结构：tree/treeitem、level/posinset/setsize/selected、单focused tabIndex，删除双folder图标和旧aria-current/私有data标记，fixture迁移。焦点仅为局部presentation，不增加目录读取/selection owner。16项风险和strict lint已过；37完整类型因状态union未收窄失败，38仅修明确literal分支后重跑独立验收。bka等压缩符号不冒称原TS名称；virtualization/sticky/search/context/rename/multiselect及target catalog仍partial，无新增compat/deprecated。

2026-10-19 后继38运行中验证目录消失，Node tsc缺失及10137源缺失失败；39在仓库内新冻结10139输入并重建全链，完整types通过，其余验证进行中。40将唯一finder消费者迁到current revealPathInFinder/FileShellHost，旧projectToolsHost、四值类型、gateway、命令、白名单/catalog与正向测试整条删除；99项风险通过，新增原生执行路径0、compat/deprecated0。构建与GUI待后继结算，不把39当40验证。worker直接6声明REA parent ev_8a11174a6898a831a2054c27efeecf8ce134bff00cfc5a84d3e131849ef72ac7确认getTargetCommand缓存/rejection移除和图标信号量，518AST/parse0/131unknown；592声明的大切片timeout partial保留。32目标的完整detector/launcher/native association仍开放。

2026-10-19 FileShellHost后继41：基于平台launcher parent ev_a4cb83333838c8893b1b7cca700326c95239cc1f00da33ca8ea9840c299a090d的file-first原生分流，替换isDirectory为isFile；非文件统一openPath并返回错误，修缺失工作区假定位。旧假文件测试迁到真实临时文件，新增missing路径；15项文件壳通过。根100项聚合中legacy全源扫描5秒超时1项，原失败保留；不放宽守卫。40同源Renderer可条件复用，41须新Electron类型/Host/GUI/native，不冒领40为最新source通过。其它target配置/平台发现/完整GUI仍partial。

2026-10-19 护栏42：41风险与同源重试均因原5000ms全仓legacy扫描超时，125/126及6/7通过原件保留。相同2541文件/约21MB测量后改为顺序读取、每64文件await setImmediate；范围/正则/断言/期限未变。根7/7通过；42须新风险/Host/真实GUI验收。该优化不增加REA或产品覆盖，整体partial。

2026-10-19 目录viewport43：fileTreeViewport/useFileTreeViewport映射Yka/ZOa/Jka/oka可确认职责，原压缩名称不作TS名称。28px/overscan10、sticky目录及parked焦点、逻辑行导航接同一WorkspaceDirectoryTree；主树/面包屑复用目录owner，清旧DOM索引和失效选中选择器。18项风险通过，新增203条目真实滚动/键盘场景，产品验收待43；context/rename/multiselect和全GUI仍partial。完整REA两parent在viewport-bundle-manifest-43登记，未执行参考。

2026-10-19 搜索布局44：43冻结后发现空态被h-full结果容器推到裁剪区外；根已修flex滚动与空态归属，新增真实搜索空结果可见几何断言。43预检不提升为本后继产品成功；44新Renderer和原生矩阵另验，整体partial。

2026-10-19 sticky后继45：按OAa原始top/zIndex及base-file-tree sticky背景补独立行背景与父层在上，新增canonical/sticky无重复树语义及点击折叠焦点回归。19项风险passed；44未跑预检，45才是包含空态与sticky修正的最新产品候选，须新Renderer/GUI/native。

2026-10-19 后继验证与主Composer：39完成10,139源零漂移、全新sidecar/Renderer、标准GUI与controlled Gate B；keyboard/saved/compact三图已人工复核，327产物冻结。42原final因backend复用覆盖新插件资源mtime而被freshness拦截，失败产物保留；recovery1真实重跑desktop-assets，freshness/标准GUI通过，原生矩阵待结算。43同源legacy扫描原5000ms超时，完整types与131/132风险原件保留，不复用其失败为成功；45完整types/19风险/lint/docs/Renderer预检通过，203文件矩阵待验。

主Composer47/48两个完整parent与native46元数据已压缩保全（composer-native-bundle-manifest-46-48，四完整记录，5917 semantic unknown，未执行参考）。Qft→X7e→On/Fdl→AdaptiveFooter/Input/FooterControls证实多行输入占满上行、leading与model/secondary/primary在底行。Lime current迁为ComposerLayout.AdaptiveFooter及独立composerStyles，同一Controller/EditorView；删除MainRow、BottomBar、空输入floating-collapsed和重复附件入口，无新增compat/deprecated。根47项分轮通过/strict lint通过；49冻结10,144源，独立types/Renderer/GUI待验。自动单行测宽/composition锁、完整voice及整GUI仍partial；原压缩函数名不作产品命名。

2026-10-19结算更新：42-recovery1真实producer/freshness/标准GUI/controlled GateB通过，45独立Renderer及203文件真实矩阵通过，均零源漂移/Main正常退出；失败42未覆盖。49完整质量/Renderer/标准GUI通过，但home800真实model重叠与越界失败，327产物及10,144源保全，后续thread/current矩阵未执行。53新增InlineControlLayout和ModelSelectorTrigger，ModelSelector原markup直接迁移，无alias或第二选择owner；按REA51/52先收标签、实测紧凑宽度、必要时隐藏、空间恢复后还原。54修异步挂载测量，质量/Renderer/标准GUI通过，但真实会话52px低于用户要求88px失败。56/57改为88px并整链清退旧FileManager及独立InputbarTools；56两项、57两项原5000ms超时保留，57后继串行复核原用例通过，完整types/lint/contracts/i18n/legacy通过，Renderer/真实桌面尚待结算。current为共享槽位/显示适配；compat/deprecated新增0。自动单行/IME布局锁、voice和其余GUI缺口不在本通过声明内。

文件预览62映射实际manager `XRn/HP/$ma`（REA60）与pane捕获 `oir/eir/qRn`（REA61）至既有ThreadSidePanelTabs、openWorkspaceFile、RightSurfaceHost；压缩符号不是原始开发名称。previewTabId只持显示identity，pinSidePanelTab保留内容tab对象；替换创建contentInstance并复用dndId，树/搜索selection传true、doubleClick/open传false，空Files首次仍固定。捕获按native composedPath豁免树，草稿、controller与文件命令owner不变，无alias/兼容props/第二store。已迁移旧“树点击总是新增普通标签”的合同；独立候选六套61项通过，18源码/测试/场景strict lint通过，完整types/Renderer/真实Electron另验。完整目标应用/实际菜单、参考运行flags及其余GUI缺口继续开放。来源与限制见[消费者审计](workspace-file-tree-consumers-audit.md)。

后继验证：62完整types、strict lint、docs/scripts及独立Renderer已通过；62最终因前驱57富草稿恢复的退役图片按钮fixture失败而未运行。64仅迁四份fixture与专属计划，生产源码保持62原字节；真实加号菜单/aria-controls/唯一同会话input接线已替换，原选择器时限不放宽。64 picker ownership10项、lint、scripts及标准GUI已通过，rich restore和新预览矩阵仍待结算；不把57两轮失败改写为通过。

Sources65/66沿实际`composer.addFiles`命令、active scope、当前Composer prompt/focus及同一attachment-generation owner补证；13＋3完整声明，来源、摘要、限制与Lime缺口见[动作审计](summary-source-actions-audit.md)。Lime目前的image-only input不能冒充Files and folders，projectless空Sources/Add source未实现。下一刀必须复用当前Composer/Plugin/Host owner补齐picker和附件数据链，不以隐藏边框或空按钮收尾；新增compat/deprecated仍为0。

2026-10-19 最新结算：62全部预检与新Renderer通过；64独立预览/编辑/终端矩阵已通过，同源/327产物SHA及freshness前后核验无漂移，五项单一preview/替换树DOM/新editor/双击固定/键盘固定全部为true，Main正常code0/signalnull。64原rich业务全通过但15秒Main退出失败仍保留；带观察器的诊断成功不证明根因修复。67进一步清退Core内部独立图片fallback，精确14文件冻结，68项与strict lint通过，types/新Renderer/产品验收中。整体GUI仍partial。

2026-10-19 Native picker与共享附件后继：REA68明文pickFilesFromDialog→当前filePicker gateway；Host normalizer从main.ts提到electron/dialogOptions，唯一OpenDialogOptions迁到纯类型desktop-host/dialogOptions。69原Host types失败保留；71四文件隔离修正、25项/完整types/contracts/新Renderer+Host/标准GUI通过，327产物冻结零漂移。72将addPickedFiles/addFiles/image/path/generation收敛同一ComposerController，旧双hook与hidden input/旧fixture清退；验证脚本笔误失败后同源续跑至新Renderer，产品尚待。

75：包中composer.addFiles→input-kit/ComposerCommands作用域派发；normal/fallback、connected/visible与注册代际清退已接Core/Home，class名称为实现选择而非上游原名。ThreadSources→RT/JT已确认空态/菜单/目录与附件动作，SummarySection/Row从旧Panel抽为共享显示owner。实际项目归属复用useThreadProjectDirectory，Plugin目录复用现有导航。59项、Scene15项、真实Core/native owner GateA1项和runtime8项通过；完整新产物/桌面仍待。来源数据未换成installed inventory，没有新业务store/backend。connected/featured flyout、安装回conversation、其他Sources种类和参考运行flags仍unknown/gap。

76后继：72共享附件完整质量/新Renderer+Host/标准GUI/rich restore通过，正常Main退出、327产物冻结且sourceDrift为空。75的Sources、命令与导航及混选fixture单独冻结，不将72成功扩大为Sources已验收。当前唯一附件owner保持useComposerAttachments/ComposerController，旧双hook、隐藏input和filechooser旁路为dead/deleted；新增compat/deprecated为0。完整Sources插件合同与GUI仍partial。

77焦点后继：76完整质量/新构建/标准GUI/rich通过，Summary Escape瞬时焦点断言失败且Sources步骤未跑，failed/327产物保留。REA65的zT/VT/FP与当前useComposerCommand对齐动作接收后RAF focus，按同scope EditorHandle及connected/visible/disabled约束，更新callback不丢待focus，离开scope/禁用/卸载清理frame。生产附件owner不变；两种选择结果和生命周期回归、新产物桌面独立验收中，新增compat/deprecated为0。

79有内容Sources：78/79/80沿真实AT/jT/MT/PT→use-local-conversation-sources→sources-model确认按类别呈现，Web search单一非交互行、key web-search，存在性由有效查询/访问汇总而非结果URL决定。当前threadSummaryProjection直接消费canonical query/action_data派生hasWebSearch，ThreadSources删除URL按钮列表，Panel/Scene删除专用URL callback，五语言与旧正向断言同步迁移；时间线网页预览不迁owner。19项新行为回归通过，首轮附件测试5秒超时原件保留、同源单独两项复核通过，未放宽期限。77-recovery1质量/标准GUI/rich通过但Sources fixture modal背景role重定位失败，整轮failed/327产物保留；79以打开前实际元素身份修正观察，真实后继仍待。其余Sources/Plugin和全GUI仍partial，无新增compat/deprecated。

## Composer上下文建议（2026-10-19，active）

当前映射为上游Controller四个可确认方法 → ComposerController/PM suggestion plugin；共享建议视图 → ContextualSuggestions/SuggestionList。+与typed @/$/slash不再各建状态；skill选择从canonical route/atom投影。旧PlusMenu、CharacterMention/SkillSelector、独立Plugin与Knowledge入口、模板launcher/徽标和重复选择状态已按85/86删除清单清退。测试拆分并保留草稿失败/恢复/历史风险，脚本从旧badge/menu selector迁到同scope真实editor atom/listbox。REA86补4px/anchor/availableHeight，静态不证明运行。

父79 recovery已认证，当前建议源码尚待独立冻结与真实Electron；不继承父版本Gate B。完整分类、gap和证据见[上下文计划](../../exec-plans/codex-composer-context-suggestions-20261019.md)。

技能atom90：REA88/89/90将wrapper、显示fallback、PM attrs与prompt序列化分别校准。current catalog保留display_name，共享skillDisplayName；ComposerController/PM唯一文档保留displayName而canonical label=$name，DOM/history/restore/UTF8 fixture同步迁移。清除建议目录对service请求与主题reset的耦合；无新增compat/deprecated。87矩阵/rich/Sources/Plan及89typed Goal为各自冻结字节证据，90新生产字节必须另验。旧installed_skill dispatch加slash前缀和外围service/Knowledge/curated路由仍待直接迁移，不能记完整对齐。

92映射：getText/getPersistedText/mentioned paths→既有ComposerController/serializer；eFi inline-flow→composerMentionDOM/schema与composite样式；SV/LE/Hki默认glyph→同一mention DOM。压缩符号仍仅定位，composerMentionDOM不是声称恢复的上游原名。删除installed_skill SendRoute、slash执行key/前缀、假Skill fallback/宽松匹配、重复初始化effects和route消息徽标；保留选择事件至canonical atom，导航查唯一runtime Skill。旧正向测试迁移到current输入/恢复，generic route测试使用命令合同；新增compat/deprecated为0。62文件初始写集另含后继事实源，真实产品验证待92冻结。

93映射：REA95的Put/fut/Zs/wta跟踪提交/历史，WB/n2与Hm区分正文序列化和侧车元数据；这些压缩绑定不作为新的TS命名。删除resolveUserMessageLabels、UserInstalledSkillMessageContent和canonical独立徽标循环，不保留alias/fallback。旧标签正向测试转为“不凭空生成sidecar标签”的行为回流断言，正文、图片、折叠、复制和canonical identity风险继续保留；根6套71项和strict lint通过。独立新字节产品验收及完整inline consumer仍待，新增compat/deprecated为0。

94映射：REA89 sJr的leafText → 既有composerSchema mention spec，不新增类、第二输入store或alias；可见displayName与canonical label/path保持分工。真实EditorView先红后绿，根112项及lint通过；93新Renderer/标准GUI/rich与矩阵已passed冻结，94独立待验。REA96 `ev_39097e6ae3706546f0f855f241d5faabb6160b473899103b147080aafd9cc3fa`认证并提取m7c/q3c/J3c/FBc/e6c/X3c/Y3c/Z6r/YL九个完整声明（18278bytes、7615 AST、parse0），完整Evidence gzip逐字节回读保全。分类依据href与label；Skill按规范化path优先，否则name/displayName匹配且只接受唯一结果；无目录无href时保留文字，不伪造安装项。打开技能文件还要求本地同host、非远程、可识别Skill定义文件或真实模板目标；加载中的元数据不抢先打开。App与Plugin各自使用current catalog/host/readiness，不由任意文字绑定。上述是静态消费者合同，依赖仍有未解析分支，未执行参考，不能声称全部catalog/remote/点击分支已穷尽。

94已结算passed：11套150项、strict lint、完整types/contracts/i18n/治理、新Renderer、标准GUI、真实rich及54观察48截图通过；sourceDrift空、freshness前后ready、Main正常退出。10134源/325产物manifest SHA `67068b0804a774aae5f51b3008499f93eb93077df40766bf5781a1f1fe52694b`，已查看dark/thread最终截图。

95实施：REA96/97的Skill consumer→skillPromptLink、PromptLinks既有useLimeSkills目录接线、SkillPromptLink与Markdown的remarkPromptLinks；canonical用户正文和MessageUserBody共用。composerMention glyph与inlineMentionStyles共享，删除原Composer重复样式，无alias/第二目录store/backend。保留原label/path属性、只接受唯一目录、loading/缺失/歧义只读，只有current本地已识别定义文件可经现有artifact/file owner打开并带原itemId。原路径先于Markdown URL transform保留；普通HTTP、code、危险URI不绑定。根首轮77项通过；新增资源路径原2失败/26通过保留，修正HAST属性名称后28项通过，独立新Renderer/桌面待验。完整链接serializer、plugin/app、gallery/custom icon、remote/原生平台与全GUI仍partial。

### 96：正文引用词法校准

95已结算failed：风险测试、完整预检、新Renderer、标准GUI和真实rich通过；54项Composer观察后，新增真实提交回合interrupted，模型收据只有GET models。截图另暴露多条$Skill被remarkMath吞入数学节点；两项均不算通过。sourceDrift空、Main正常exit0/signalnull且无强杀，325产物manifest SHA 5b2ec7c6664c61b27f5395a861c6eff3d3aa556cf3bb356fa7f9ab43ea1a39ff，原截图/收据不可变。启动器源码确认backendMode默认unavailable，Rust UnavailableBackend拒绝start_turn；不是provider端口已被证实故障。

REA98/99补证：RH的composerLink在词法阶段优先于Math，原始label独立于渲染children；lcn允许路径空格和转义闭合符，qVr/aH分别解码label/path。98 Evidence ev_8bd6d2b1ec01c1cdd03ecf68f8fce75c9f4bd9270ef1a838da6269fb01b00697（9声明2575bytes/920AST）；99 Evidence ev_835761eb2518d6b90986a82a96730e8d6af7f22f813ac724ae99c2d4256804f0（5声明1930bytes/629AST），parse0，完整JSON gzip逐字节回读保全。98的QVr/$Vr只有未初始化声明，常量值仍unknown；全部静态、未运行参考。

96根实现：remarkPromptLinks由解析后遍历直接替换为现有remark管线的micromark/fromMarkdown扩展；composerLink复用已安装marked处理native title，再按REA scanner识别资源路径；MarkdownLink接管原inline anchor分支并读取原始label，不留旧分支/alias。格式标签、Unicode/空格/Windows路径、反斜杠/括号、多引用与独立数学、code/escape/image和普通HTTP回归共6套70项通过，原4失败/7通过保留。早期96格式标签red用已解析目录却期待原格式，期望本身不符合consumer；后继改为unknown path并按REA99保留原始label，不能将该旧red当产品缺陷证明。新字节产品验证仍待。

current仍是既有Markdown/Skill catalog/文件owner；新增compat/deprecated为0，旧AST-only引用遍历与inline anchor重复分支已替换。全GUI仍partial，真实新字节验证归Composer计划Contract96。

96独立候选已结算failed-before-build：13套风险测试和strict lint通过；正式types发现remark插件的Processor<Root> this与Pluggable不兼容，以及缺失remark-parse的Data类型扩展。sourceDrift空；没有Renderer/Host产物，不伪造artifact manifest或GUI通过。原类型日志及收据SHA保全在candidate-context-types-failure-96.json。97只修this为项目统一Processor并补type-only remark-parse导入，不改变运行行为或放宽tsconfig；从failed96/sourceDrift0精确叠加该文件及六事实源。Contract96全部产品/退出要求继续有效。

REA100补查提交转换：Evidence ev_74cb2596e3f2d7ec0a59e811e829e9ae7861602d0d68a7b424fd4a148a0e40a7，4完整声明2040bytes/594AST、parse0，gzip SHA 4d15859af49e6f80d4de89cbc4fb982d0ac968d791d86a2b2d99862b9077485c，原字节回读保全。Dle普通分支输出context prompt和空text_elements；untrusted/MCP分支另有整段byteRange与placeholder合同，不能混同普通mention；Osn追加image/comment输入。联合REA89 GB、92 WB、95 Put/Zs/fut/Ccn/Eln可确认正常Skill label/path经过Markdown格式化进入prompt，而本地optimistic plain text独立。尚未穷尽特殊附件/全部wire分支，未运行参考。Lime当前serializeComposerDocument仍发送裸label及typed元素；下一刀必须保持canonical路径身份、UTF8范围、失败保稿和恢复，并验证共享runtime对带空格/转义路径的解析，不能凭TUI推断Desktop。当前Rust explicit_candidates的空白拆分是只读发现，尚未迁移；不先删typed身份造成绑定回退到名称。

97结算：13套161项、strict lint、完整types/contracts/i18n/unused/scripts/legacy及新Renderer通过。原runner在复用Host时误将95产物的sourceManifest与96源码比较，失败收据保留；recovery1认证原10步日志/源码/Renderer且改为95自身摘要，从未跳过失败产品门禁。标准GUI通过，rich全部business/assertions通过且零console/page错误，但Main原15秒正常退出超时，失败回收SIGKILL；整轮仍failed，不能称正常退出。10144源/325产物冻结manifest SHA 3ca5b1abcae5cf283e6f05a8c8a265acb453cd3aa79c11b4743fa4ab3e882239，sourceDrift空。尚未执行的matrix另立独立收据执行；其结果不能覆盖原rich退出失败。退出根因尚未定位，不归因于本次词法变更，也不放宽deadline。

97独立matrix的54项Composer观察已完成，真实截图显示4条引用和助手完成文本；随后采集器错误使用requests().body（实际API只返回bodySummary），finally再次Buffer.byteLength(undefined)导致原错误与正常退出收据未落盘。independent-context-matrix-verification-97.json明确failed；原summary的running只是最后检查点，不是存活或通过证据，原日志/截图保留。不能从截图推断后续copy/file或正常Main通过。98在原fixture增加显式requestMarkers布尔摘要，真实HTTP回归证明不暴露payload/凭证；finally前保存原错误并保证始终进入既有teardown。原prompt/身份/54项、零mock与15秒退出合同不变。

REA101退出补证：认证同ASAR与main成员09d19386e1f23cf4ccbc950fc40d85a1e8a064a08be588b2a4be6a89f6ada9e6，4完整声明2345bytes/671AST、parse0，Evidence ev_ce638abaf49a49db7d0fd9ed7bef81e46f79d79bb8869d1577376980c6ea1c97，gzip SHA fb079856960b9a96edc36c52be63388d21664b26a898e253f8ab8b8df7e14946。eZe先allSettled(global/settings/tracing等flush)，再u7(flushAndDisposeContext,5000)，最后dispose与第二次quit；5秒仅约束后一个context drain，不是整个退出期限。不能据此给Lime加总超时或声称修复当前Main阻塞；实际根因仍unknown。全部静态，未执行参考。

2026-10-19 后继99：98真实runtime marker POST、同一Thread/Turn/UserItem completed、54项Composer观察、四引用和原生全文复制通过；点击Skill误走通用产物链，SKILL.md标签出现但右侧Terminal保持active，文件breadcrumb超时。98整轮failed，Main正常code0/signalnull、sourceDrift空；325产物manifest SHA `02d76b67bc369fe2a86daa8bc4d1ed4dcf349c46fabd3eebe8ce19794e1e0e96`，原错误/截图不覆盖。按既有REA96 J3c/e6c openInSidePanel与文件owner合同，99把文本类file_preview直接接到openWorkspaceFile；删除该路径的产物副本读取/注册与canvas选择，沿同一LocalState复用空Files、路径tab/contentInstance与owner epoch。无需新store/backend/兼容层；Office/媒体格式owner仍独立承接。根回归先复现1失败/17通过；初次修复误截Office六例已保全，后继按现有contentKind路由限定文本类。

2026-10-19 结算：99原轮matrix因未hover展开复制footer而被正文拦截，整轮failed且原收据/截图/325产物保留（manifest SHA a3d17d7b7cd098da1fdbda2b6a9a8df9126122ae9521c2c7529b631746e7a3c8）。同一冻结源/产物的99 recovery1只改外部采集器，复用既有prepareCopyAction真实hover/geometry后click，无force或产品注入；认证原18套212项与11步已完成门禁，重验matrix60观察及rich均passed。四引用/三主题重载、原生全文复制、click/Enter/Space进入Files及原文件不变通过；rich保留完整同一Thread/Turn/UserItem与四输入、图片原字节、取消/草稿恢复。matrix Main39255、rich Main51767均正常code0/signalnull，无强制回收，原15秒/identity/mock0/freshness不放宽；10145源/325产物冻结manifest SHA db3e1ce11fd6d103707ae84774f30da775beb583237b482851f0459e2f528586，sourceDrift空。预览区仍偏窄；97退出根因、真正atom→Markdown提交与全GUI保持partial。

102实施：REA89 GB→92 WB→95 n2/GVr/KVr的资源格式映射到既有composerLinks.formatResourceLink与serializeComposerDocument，HTTP无title链接复用相同formatter但原URL校验不变；普通Skill/file/plugin atom输出[label](path)，不再创建wire text_elements，paste/显式element按最终UTF8重算。显示/JSON草稿继续由projectComposerDocument管理；typed path身份暂保留，未迁移共享Rust文本parser。删除旧裸label提交和Skill范围正向/护栏，迁移rich独立literal oracle、资源路径负向以及正文显示名断言。根先红4例，首轮482项中2项旧恢复/手写范围期望失败保全，修正后相关110项和fixture130项通过；独立新Renderer/Gate B待验。不冒充完整wire、全部consumer或全GUI对齐。

2026-10-19 102/104更新：资源Markdown提交候选102的19套336项、strict lint/types/contracts/i18n/治理、新Renderer及标准GUI通过；原矩阵60项业务观察完成，但Main原15秒正常退出超时，整轮failed，sourceDrift空、325产物manifest SHA 725e417ad2072fcd80510e672858e9995c7590985f64829ef85701f407f082b0。102 recovery1再次完成60观察但同一退出门禁failed；7秒被动sample超时且无有效栈，不能归因或当修复证据。原件均保留，rich独立补测中；97/102退出根因open。

104沿REA103 recovery1的dzt/DC/ozt/wn合同实施文件树默认关闭、共享开关与250px临时宽度（min200/max60%）；不凭截图调整固定像素。泛化既有Host bool owner并直接删除summary专用方法，无alias；Summary、Files、Changes及Workbench消费者收敛同一typed gateway，删除每入口局部开关和true默认。Host7套193项、消费者6套44项已通过；真实桌面三主题/多宽度、保存重载与Files/Changes共享待验。`internal/exec-plans/codex-file-tree-visibility-20261019.md`。无新增业务owner/兼容层，不扩写未知Rust、发布和architecture增量；全GUI保持partial。

2026-10-20 当前后继：侧栏按同ASAR的 `nSs -> TSs -> kPo -> _Po` 明确两种分页模式（REA `ev_95e17fe1ed110460bab4d65b5b01580c6a3b2cc9e6d31969caba53faa847ec2c`，4/4解析、parse0、semantic unknown）。末组Recents自动加载，中间组按钮分页；active项追加，source终止且仅余一项直接展示。映射到现有Shelf/LoadMore/sidebarSessions/ProjectGroups，没有包装层；首轮误将自动展开14条判为失败的收据保留，不能删除已证上游能力。

Help/快捷键沿REA `ev_239bec2aefd37970eb55084dcc0bc983997b19ea6dc17efef692017787a7f1fb` 映射已确认导出 `KeyboardShortcutsDialog`。`ProfileDropdownItems`的Help子菜单按真实父menu底部定位并跟随几何更新；菜单与平台快捷键共享 `showKeyboardShortcuts`。`src/lib/commands`注册真实handler、可用性、平台键位和说明，Dialog消费同一挂载快照，搜索线程/设置与文档保存/取消/撤销重做迁入；不填假静态清单。删除4份document hotkey静态副本及测试，保留实际编辑器/Canvas/设置/平台/焦点回归；8套44项通过。What's new使用Lime现役发布页链接，完整feed、workDialog及远端服务合同仍open。

已有线程目标按REA50的Qft→Lft→Nft→U9n/Q6t进入同一Composer，`useThreadGoalComposer`持有pending mode/替换确认并只委托现有thread/goal/set。旧独立Textarea/Modal与6条死文案删除；scope/revision/coordinator CAS与失败保稿并集97项通过。目标附件、新线程、canonical transcript和auto布局仍open，不能把纯文本限制宣称为上游合同。架构图已由root确认，产品新产物与真实Electron按当前计划结算；新增compat/deprecated为0。
