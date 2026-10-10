# TUI/CLI 继续同步 Codex 执行计划

状态：in-progress（当前切片已验证；总体对齐仍有明确 defer/partial）
日期：2026-09-08（最新续跑 2026-10-10）
参考实现：`/Users/coso/Documents/dev/rust/codex`
当前基线：Rust commit `4aaee872e31abefe0d32e91faab23b09b6968824`（参考目录当前 checkout）

最新续跑（2026-10-10）：第97删除editor入口的启动cwd参数，直接读取服务端同步的App.cwd，
修复跨目录resume后正文临时文件仍落在旧启动目录的问题，无wrapper/compat或第二后端。
第96冻结CLI的真实跨目录PTY红灯已保留；全TUI1742、strict Clippy/fmt/locked CLI build、
132唯一守卫、inventory1539文件与治理/docs通过。新冻结CLI真实complete/images门禁exit0，
强制消费TUI_EDITOR_CWD_OK，含空格/Unicode目录、草稿、首Left/Right、唯一canonical提交、
冷读cwd/正文与终端恢复均通过；两次KeepScreen可见性/stdin/退出重入断言保持。
本切片条件4/4（100%，macOS）；Windows、GUI、live Provider与完整verify:local未由本轮验证。
第96同名TerminalHandoff/with_restored、一次帧所有权与普通帧零复制仍current；
第95标准平台parser/错误/清空行为仍current，第95/96各4/5（80%，Windows/MSVC/editor未验）。
Codex policy-aware editor_directory需共享有效filesystem/grantedPermissions查询或投影合同，
现有profile id/sandbox标签不足，继续defer，不在TUI读取YAML或复制权限算法。
第94默认11场景和MCP组合/混合选择证据保留原范围，第92/93各4/5（80%，真实Windows未验）。
第91及既有CLI/contracts/npm证据保留各自范围，总体无可信对齐率分母。
第88负载粘贴分段、外部editor首键和complete aggregate总超时仍open，不由重复绿灯关闭；
Desktop GUI/live Provider与完整verify:local继续待补。

## 全维度对齐验收（2026-10-01）

多端约束（用户再次确认）：Lime GUI/TUI 共用 App Server、runtime、持久化、工具和 canonical
Thread/Turn/Item；“兼容 GUI/TUI”是共享底层同时支撑两种 Product Surface，不是恢复旧实现兼容层。
Codex 对齐以公开 App Server/shared domain 与 TUI 源码为事实，未开源 Desktop 不推测实现。
业务决策/权限/存储不得下沉到 TUI 私有后端；终端 keymap/composer/PTY 保持 surface owner，
共享 protocol/schema/config 改动必须检查 GUI 消费链，不能以 TUI Gate B 冒充 GUI 验收。

### 当前续跑：ChatWidget 输入与 transcript presentation owner（terminal acceptance completed；整体 partial）

本轮用户已明确确认批量迁移（详细认领/验证见下方同名切片）。App 不再持有主 ChatComposer，
39个原消费者已直接迁到 BottomPane；额外 local_settings 的测试也改走同一边界。主输入、
popup/Vim/history/paste/mouse、计时与主draft/交互队列原子恢复归 BottomPane。旧 App.composer、
重复 popup 维护函数和 ThreadInputState 包装已原位删除，无新 compat/deprecated 或第二后端。
本次续跑进一步把该输入 owner 放入 Codex 对齐的 `ChatWidget`：App 现在只持有
`chat_widget: ChatWidget`，主输入调用统一经过 `chat_widget.bottom_pane`；旧的 App 级
`bottom_pane` 字段和 `BottomPaneAction`/composer mapper 命名已删除。ChatWidget 当前真实持有
BottomPane 输入/交互 owner；本轮再把 pager、transcript scroll/viewport/follow/search/selection、
footer/prompt header、composer gap、retained pager/bookmark、Agent Center 与 model/agent/resume/
export picker surfaces 收敛到 ChatWidget。App 只保留 host/session 的 scrollback availability、
App Server 请求与 canonical projection 接线，下一刀回到 collaboration scope、replay seed 和
其它 Codex session state，
不把本阶段误报为完整 ChatWidget。
独立问答 notes editor 保留。前序输入 owner 的结构/夹具回流守卫61/61、新增owner回归7/7、
线程生命周期15/15与 fresh PTY/stdio/CLI 证据仍有效；本轮新增 transcript owner 结构守卫与
inventory 守卫40/40，TUI all-targets 为1457 library +18 integration +1 dependency guard，
严格 all-target Clippy、fmt、diff check、contracts 与 legacy governance 均通过。本轮 fresh
TUI Gate B 首次因 queue-edit PTY 时序抖动重跑后通过，fresh CLI Gate B 使用同一当前 binary
通过；本切片仍为局部进展（非总体对齐率），整体 partial，其余defer不因本切片实现而标完成。
以下thread-owned interactive input记录为前序证据，
其中旧owner路径/待确认状态不再作为current事实。

### 前序：thread-owned interactive input（terminal acceptance completed；整体 partial）

主目标继续为 GUI/TUI 共用业务底层的全维度 Codex 对齐。本刀审计发现 successful
thread handoff 仅保存 ComposerDraft，随后 clear BottomPane，正在编辑的问答/备注、审批
选择和 MCP 表单丢失；可见交互也未消费 serverRequest/resolved 与 turn terminal。
对照公开 chatwidget/input_restore 的 ThreadInputState/questions 与 pending_interactive_replay，
将已有交互 view 随 ThreadInputState 移交，不复制业务队列、waiter 或持久化。App 仍负责
宿主/线程路由，BottomPane 管理交互 view；完整 ChatWidget/BottomPane composer owner
迁移继续 partial，本刀不加空 ChatWidget/Deref/兼容壳。

窄写集：app/thread_input + 独立 interaction tests、App 的状态类型/notification/断线/成功
resume 接线、Agent Center 打开时不再提前捕获、bottom_pane/input_state + request identity、
现有结构/真实stdio fixture与PTY门禁、architecture/commands/本计划。GUI/protocol/runtime/
provider/Electron 只读，不新增 method/schema/config/依赖，不删除文件、不提交或建分支。
退出条件：1) root/child rich draft 与交互 notes/selection/MCP field 无损且单一 live owner；2) resolved/terminal/item-start/ThreadClosed 精确清理当前及休眠 Thread，不影响其它请求；3) disconnect 清旧连接交互和 replay，不丢草稿，失败 resume 不消费；4) 定向/完整 crate、Clippy、结构守卫；5) production resume 的真实 stdio evidence 与既有
PTY modal/键盘/terminal恢复、同 fresh binary CLI Gate B。仅完成代码不关闭条件5。
责任 root，2026-10-01；主链保持 Product Surface -> App Server -> RuntimeCore -> canonical
Thread/Turn/Item；本刀仅改变 TUI 内存输入投影生命周期，不宣称未开源 Desktop 已对齐。

实现：ThreadInputState持有ComposerDraft与BottomPaneInputState；take/restore移动完整queue
view，不flatten每题备注、选项、审批选择、MCP字段/游标或timer。当前bindings重新注入每个
恢复editor；目标快照被消费，active/dormant只各有一个交互owner。Agent Center打开时撤掉
旧的提前capture，成功resume才移交；failed resume不消费。canonical通知按Thread路由到
当前或休眠view，resolved精确匹配id，turn terminal匹配turn，command/file ItemStarted
匹配turn+item；MCP只按独立resolved或ThreadClosed清理。disconnect统一清所有旧连接
views与replay channels，rich drafts保留。没有新增GUI/shared backend/schema/配置策略。

首轮新library测试11 passed/1 failed为TestBackend宽字符continuation cell被字符串拼接成
额外空格，已沿现有display_width跳过续格，保持Unicode文案/完整答案断言；两题提交按已有
commit顺序，notes保留既有user_note编码。当前1.148.0定向thread_input15/15与完整TUI
1445 library +18 integration +1 dependency guard通过，结构/PTY/inventory守卫57/57、
contracts、legacy/scripts、ESLint、docs boundary通过。真实stdio fixture首次等待question
超时，现补method序列和隔离fixture ledger诊断；Gate显式注入测试配置，不读真实用户配置。
普通gated test early return不计真实证据，条件5未关闭，最终PTY/CLI验收进行中。
TUI all-target Clippy --no-deps -D warnings通过。续跑诊断确认新stdio的第二轮夹具复用
request/tool/assistant Item identity，导致 canonical multi-turn chain拒绝；现按原Turn派生
独立identity，并补真正执行generated external backend的连续两轮相关性回归。休眠响应
使用完整typed答案，不把空答案取消冒充成功完成。macOS直接诊断补齐当前target动态库
路径，真实stdio两轮恢复/失败resume/休眠resolved/零额外child Turn通过；它沿用旧App
Server binary，只是诊断证据，最终验收仍需fresh当前二进制。58结构/夹具守卫首轮通过。

同链续跑写集新增pending_interactive_replay及独立tests（此前该文件干净）：旧category
HashSet/by-turn indexes无法区分同item的多个request，snapshot可能复活已解决旧请求或
丢失仍未解决请求；原位收敛为single pending_requests_by_request_id，精确id+typed identity
作为唯一replay authority。ItemStarted同时匹配turn/item，旧event淘汰不清replacement，
MCP仍独立resolved生命周期。751行owner拆为155行生产+414行独立tests，删除无生产
consumer的pending查询和镜像索引，不新增compat或native Op适配。新增5条回归含真正
ThreadEventStore rebase消费；定向/crate/Clippy/fresh Gate B待latest验证。Codex同名入口
保留，单表为merge：Lime共享JSON-RPC有精确response id，不复制Codex native Op缺id时
的FIFO索引策略。root确认输入投影与共享业务主链不变，2026-10-01。
latest结构/夹具/PTY接线守卫59/59、ESLint、Prettier、docs boundary、diff check通过；
inventory更新1408 src文件，仅用于发现差异。fresh build与replay定向被磁盘满中断：
archive/query-cache/LLVM object输出均返回os error 28，非测试通过。当时Rust新回归、
完整TUI/Clippy及fresh PTY/CLI不能沿用前序证据，条件2/4/5待latest；当时最低验收为
2/5（40%，仅本切片，非总体对齐率）。旧binary真实stdio只作为诊断，不升级fresh证据。
已确认cargo/rustc退出，Data卷检查时仅余356MiB（随后895MiB），incremental约45G、
deps约58G。未删除缓存/源码/二进制、未终止未知进程；清增量缓存需用户明确确认，
不扩大为全target删除或cargo clean。gate-b-final/replay-related日志保留真实失败。
分类：typed view与single replay map为current；旧handoff清pane/提前capture/category
镜像索引/无consumer查询为dead原位删除，独立tests为test-only，无新增compat/deprecated。
SRP拆tests，DRY单表identity，KISS/YAGNI不复制native Op索引/查询、不加空壳。
下一刀仍是完整composer ownership：App平行持有BottomPane+ChatComposer，40个TUI
源码文件直用(app|self).composer；应真迁BottomPane输入/布局/render/恢复owner，再迁
ChatWidget，不新增Deref/旧字段包装。GUI/shared protocol/runtime/provider/Electron本刀
生产只读，GUI专用UX、平台/live与verify:local未验收。整体partial/in-progress，goal
active，未标完成、未自行pause或blocked；先收口当前切片latest验收，再推进composer所有权。
并行工作区版本从1.147.0更新至1.148.0，版本manifest不属本刀写集、未覆盖或回退；
verify:app-version通过。前序1.147.0测试不能替代当前工作树，重新编译/验收后再回填。
日志`/tmp/lime-thread-interaction-*`。Codex基线仍c248f6d48b，SHA-256：input_restore
`cf5dabc591fe35780af1e08ce61289b8acf659275dc708af51f5edc696cb91a4`；pending_interactive_replay
`0cb54e0297667ad298d8050c2173e8ab6e36ebfd6ee9997ddca40d6cf1494b41`；bottom_pane/mod
`4698ca77d465b5b02736f43f3a35ac99749b94a796d325e19e2d2a6476d8937a`。
ThreadInputState与canonical pending lifecycle为direct同义，移动现有typed views/精确item+turn
和现有App owner接线为merge；完整ChatWidget/BottomPane composer所有权、协作scope完整
恢复、history byte scan/replay seed、Agent Center异步刷新和其它mentions继续defer。

2026-10-01续跑：Data卷可用空间已由外部状态变化恢复（观察到58GiB、随后106GiB），
本进程未执行删除，未获得也未使用清理授权；磁盘满仅保留为历史失败，不再作为当前阻塞。
接续原replay recovery session成功：pending_interactive_replay 13/13，当前library共1450条。
随后启动完整TUI all-targets；检测到另一App Server public JSON-RPC测试进程持有artifact
lock，保留并等待，不终止未知进程，不并行启动Clippy或fresh Gate构建。
下一刀BottomPane composer owner涉及约40个源码/测试候选文件（包括需排除的嵌入式notes
composer命中），已请求批量重构的明确确认；未确认前不执行该批修改，不删除文件。
验证当前工作树不代表认领共享App Server/protocol/config/release/GUI改动。
续跑结构/夹具/PTY接线/inventory守卫59/59与test:contracts通过；replay定向13/13是
本轮新增精确identity回归的实际Rust证据，不将普通gated tests的early return算真实stdio。
锁持有进程为外部App Server prompt_history_jsonrpc/user_input_limit_jsonrpc测试，其
sherpa-onnx-sys原生库下载有实际.part文件增长；这是构建等待，不是本刀测试失败。
外部下载完成并释放artifact lock后，完整TUI all-targets通过：1450 library、18 integration
tests、1 dependency guard（普通运行未启用的PTY场景不计真实交互证据）；strict Clippy
--all-targets --no-deps -D warnings与TUI fmt
check通过。执行计划Prettier已修正。默认fresh smoke:tui-gate-b已启动，不设置二进制
override、不放宽timeout、不将旧binary诊断或普通gated-test返回升级为真实证据。

fresh首轮构建成功（4m50s），完整场景执行后在image ledger比较失败：byteRange内容
相同，start/end键顺序不同，JSON.stringify比较错误地把对象顺序当identity。本进程
准备最小修复时发现tui-gate-b.mjs被另一进程改为Node deepStrictEqual，apply_patch
校验拒绝，未写入任何脚本/测试文件；立即暂停该文件写入并请求协作选择。现有并行
修复经只读复核保留完整对象/数组顺序断言，没有只比较text或弱化identity。

最终当前工作树验收通过：replay定向13/13、完整TUI 1450 library +18 integration tests
+1 dependency guard、strict all-target Clippy、TUI fmt、59结构/fixture/PTY接线守卫、
contracts、Gate脚本ESLint与diff check。默认fresh Gate完整11场景通过，thread
`01a0f76c-2f21-7ab2-952c-26b3ee9ca744`、turn `turn_29c10b25a2d949048f51114088323fe5`；
强制thread-input-stdio marker通过，root `01a0f76c-582c-7e73-8349-18b43bc0f857`、child
`01a0f76c-584c-7971-b5ae-e7df1d76dc8b`、turns `turn_0c848fd843734862be6ec24f26fd3147` /
`turn_4ac83a96adc34b87a464b637151f1a1a`。typed-input-stdio、notes-keymap、thread draft/edit
lifetime、session register、images、structured history、submission reject、focus/resize/
reconnect与terminal=restored全部ok。同一fresh CLI/App Server二进制的CLI Gate B通过：
thread `01a0f76d-46ca-7b50-9368-6d93f2b56257`、turn `turn_02d8ae6d940b4d16a62620bef00db770`，
jsonl/stdin/error-exit/completion全部符合合同。受控external backend，无live provider。
日志：`/tmp/lime-thread-interaction-gate-b-recovery.log`（首轮真实失败）、
`/tmp/lime-thread-interaction-gate-b-retry-current.log`（最终通过）、
`/tmp/lime-thread-interaction-cli-gate-b-recovery.log`（同binary CLI通过）。
本切片最低退出条件5/5（100%，不代表总体对齐率）；整体partial/in-progress、goal active。
本轮continuation只编辑本执行计划，脚本并行修复不冒领；验证当前工作树而非改动归属。
GUI UX/Windows/X11/live与verify:local未新增验收，不以TUI Gate B代替Desktop Gate B。
下一刀仍为真实BottomPane composer ownership与后续ChatWidget，不加兼容壳；约40文件
批量迁移等待用户明确确认，未执行。源码/缓存/二进制未删除，没有提交、推送或建分支。

#### 下一刀的只读所有权核准（2026-10-01，实施待确认）

上一goal turn为progress：获得当前切片fresh PTY/CLI终端验收，而非状态复述。本次续跑
重新读取当前工作树：HEAD为`dd9a851a0`，TUI源码和Gate脚本已干净，本进程未提交；
Codex基线仍`c248f6d48b97eb4a2aa56147a0b11b7d763278b9`。App仍在app.rs:149直接持有
ChatComposer，BottomPane仅持有queue/keymap；因此所有权重构未实现，现有绿灯不能证明
全维度对齐。上一轮批量确认和并行脚本接管问题未收到用户明确回答；本轮只认领本计划，
源码、脚本、GUI、shared protocol/runtime/provider/Electron均只读，不把自动goal续跑当确认。

多行`(app|self).composer`盘点为40个候选文件；逐类核准后主composer consumer为39个：
16个生产入口文件、23个测试引用文件（含chat_composer/paste_input.rs内的App回归）。
唯一排除项是request_user_input/mod.rs中的RequestUserInputOverlay.composer，它属于每题
备注编辑器；公开Codex BottomPane同样保留独立questions composer，不能全局替换self.composer。
ThreadInputState.composer是ComposerDraft快照，也不是待移动的live editor字段。

| 当前入口                                                    | 必须迁入的所有权                                     | 不能误迁的职责                                          |
| ----------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| app/input_flow、app/interaction                             | BottomPane统一editor/popup/Vim/paste/mouse路由       | App的全局退出、interrupt、线程导航与transport action    |
| view、bottom_pane/footer、shortcut_overlay                  | BottomPane输入高度、绘制、popup与footer presentation | canonical transcript/Thread状态与App Server事实         |
| app/thread_input、bottom_pane/input_state                   | 同一BottomPane原子捕获/恢复主draft与现有交互view     | 不能flatten notes，不能把草稿持久化成第二store          |
| app.rs pre_draw_tick、runtime frame调度、keymap/history回包 | BottomPane主editor及交互view的timer/config/恢复接线  | session clipboard worker、stdio、文件系统与host生命周期 |

审计新增约束：现有BottomPane::clear只清queue，app/thread_input::clear_connection_interactions
依赖它保留主草稿。加入composer后不得把clear改成同时清draft；thread/resume失败、断线与
successful handoff仍是三种不同生命周期。runtime目前只读取BottomPane的交互timer，而App
另外flush主composer paste burst；仅移动字段将继续保留平行timer/input/render控制流，不能
作为完成。目标必须无App.composer、无Deref/旧字段getter兼容壳，同时保持独立notes editor。

真实主composer生产consumer：app.rs；app/{input_flow,input_submission,interaction,interrupts,
message_history,reasoning_shortcuts,right_click_paste,startup,thread_input,transcript_presentation}；
bottom_pane/{footer,shortcut_overlay}；runtime.rs、runtime/input_submission.rs；view.rs。
实施还需同步既有BottomPane owner、相关测试/结构守卫、architecture与本计划；不新增业务
backend/schema/method。分类：现有editor/view为current，App平行composition为待重构current
缺口，不错误标成已删除dead；本轮没有新增compat/deprecated，也未恢复旧路径。
以上是当前源码/公开Codex的只读证据与迁移边界核准，不是未执行计划的完成声明。批量实施
仍为0%（待明确确认），整体partial/in-progress、goal active；未自行pause或标complete。

#### GUI 共用底层验收与未知记录 presentation（2026-10-01，续跑）

用户强调 GUI/TUI 共用底层后，补验 current Desktop surface，不改变 App Server/runtime/
Thread/Turn/Item。前序完整 `smoke:agent-runtime-current-fixture` 真实 Electron 聚合退出0，
22个 Electron 场景通过，external controlled backend、liveProviderUsed=false；`verify:gui-smoke`
退出0，reload、三个viewport和memory settings ready，证据
`.lime/qc/project-gates/standalone-shell-01-20261001130225-16263/shell-01-electron-smoke/summary.json`。
日志 `/tmp/lime-shared-surfaces-gui-current-fixture.log` 与
`/tmp/lime-shared-surfaces-gui-smoke.log`。它们只证明当时工作树的 Desktop/current fixture，
不证明 live provider、Windows 或 Codex 未开源 Desktop 实现。

只读复核聚合日志发现测试缺口：Claw消息终态阶段实际20条全部skipped，旧
MessageList.test.tsx 已成为layout/scroll owner，终态场景归
MessageList.runtimeStatus.test.tsx。真实Electron场景通过不掩盖该漏测。窄写集认领
current-fixture-regression-smoke及tests、共享vitest-smoke-runner及tests：入口直接改到
current测试owner；沿同一runner增加隔离JSON reporter，exit非0/被signal终止、缺失或
损坏报告、报告失败、零实际passed测试均fail closed，返回executedTests。不新增第二runner、
根脚本、config/schema或依赖。unit测试模拟Node默认/命名export一致，首轮测试harness
interop失败已修；最终35/35回归、实际3/3终态场景通过，不把过滤skips计作执行。

真实截图另暴露UX缺口：unknown Item卡把futureCapability、opaquePayload等内部字段名
默认摊在对话主时间线。沿设计语言“普通主线隐藏实现词、诊断显式收纳”修复：唯一
UnsupportedItemCard presentation owner保留通用fail-visible提示和canonical状态，原生
details/summary默认折叠，展开后只显示已脱敏类型/字段名，不渲染raw metadata/payload。
五语言同步；主renderer提取fallback，不增加新业务owner或本地持久化。该renderer原835行，
提取后805行，其余展示分支后续继续拆分（退出条件<800行），不把这次局部提取称全清。

新增窄写集：UnsupportedItemCard及独立component tests、现有timeline renderer/两条接线
断言、五语言agent.json、unknown-item Electron collector及guard。本轮不碰TUI、共享协议、
App Server/runtime/provider/Electron源码、release-v1.148.0-plan并行改动；不使用子Agent，
不提交、推送、建分支、删除文件或缓存。canonical未知记录及read model保持，不为GUI另造
fallback后端。current为presentation/runner；旧测试owner错配与默认机器字段展示为dead
原位替换，无新增compat/deprecated。SRP拆展示，DRY共享runner，KISS原生展开交互。

本切片退出条件：1) current终态3条确实执行与零执行fail closed；2) 五语言默认收纳/
真实展开收起/无raw值组件回归；3) typecheck/lint/格式/契约与相关守卫；4) latest真实
Electron聚合含诊断交互、同identity恢复/终态及最小GUI smoke。当前1/2通过，74/74
focused回归通过；3/4进行中，不用前序Desktop结果代替latest UI交互。日志
`/tmp/lime-shared-surfaces-focused-regression.log`。本刀没有跨层架构/协议变更，root确认
共享Product Surface -> App Server -> RuntimeCore -> canonical projection主链不变。
BottomPane/ChatWidget39文件主composer迁移仍待用户明确批量确认，未自动获得授权；
整体partial/in-progress，尚未完成全维度对齐。

续跑最终证据：`/tmp/lime-shared-surfaces-gui-current-fixture-final.log` 聚合退出0，22个真实
Electron场景通过，streaming selector实际34/34（包含`turn/completed` typed error），终态3/3；
runner/入口守卫35/35、focused74/74、零执行拒绝、typecheck/ESLint/Prettier/contracts通过。
五语言missing/extra/unused均0，生产组件i18n scan无新增发现。latest `verify:gui-smoke`退出0，
证据`.lime/qc/project-gates/standalone-shell-01-20261001134119-18820/shell-01-electron-smoke/summary.json`。
本GUI切片退出条件4/4（100%，非总体对齐率），external controlled backend，无live provider；
日志`/tmp/lime-shared-surfaces-*`。未新增全量verify:local/Windows/X11/live证据。

#### BottomPane 主 composer 所有权迁移（2026-10-01，用户已确认批量实施）

用户明确回复“确认：继续批量迁移并清理旧入口”，前述待确认仅为历史审计，不再阻塞。
本轮认领核准39个主composer消费者、BottomPane输入/渲染/恢复owner、既有结构守卫、
architecture及本计划；避让release-v1.148.0-plan未知并行改动，保留前序GUI修改。
不修改shared App Server/protocol/runtime/provider/Electron，不新增backend或兼容壳。
独立RequestUserInput备注editor不做机械替换。断线只清交互、不清草稿；成功handoff才
捕获，失败resume不消费。责任开发者root确认目标图：App(host/actions) -> BottomPane
(main composer + interaction views + input/render/timers/draft snapshot) -> existing editor/view。
实施退出条件：1) 无App.composer及外部editor字段访问；2) 输入/渲染/计时与原子状态恢复
归BottomPane；3) 生命周期/布局回归、all-targets/Clippy/fmt与结构回流守卫；4) fresh真实
PTY/stdio及同binary CLI Gate B。当前4/4（100%，仅本切片），整体partial/in-progress，
完整ChatWidget下一刀，不声明全维度对齐完成。

实现为直接迁移，不是字段平移或getter包装：BottomPane私有持有主ChatComposer，input.rs
路由活动view、popup/Vim/history/paste/mouse/chord，公开key API也不能绕过modal；
render.rs统一主输入/交互高度与绘制，popup在footer之后由同一owner绘制。composer.rs
只承接领域配置/回包/草稿操作，测试观察只返回值或渲染buffer，不公开editor/textarea句柄。
App保留global导航/interrupt、native clipboard worker协作和transport action，不复制业务后端。
BottomPaneInputState原子保存draft与移动的queue；原App ThreadInputState包装、composer字段、
replace_composer及重复popup维护函数已删除。独立notes editor未重构为主editor副本。
计时取主paste/活动interaction的最早delay，断线也继续物化草稿；clear_interactions职责不扩为
清draft。当前keymap应用于主editor和所有queued/restored views，host配置不进入Thread快照。
SRP分输入/展示/快照，DRY收统一调度，KISS/YAGNI不留Deref、第二backend、compat壳或未用生产API。
分类：新BottomPane领域边界/原editor与交互views为current；旧App平行入口和快照包装为
dead/deleted/guard-only；没有新增compat/deprecated。结构守卫遍历pane外Rust consumer，
禁止旧字段、直接editor访问和getter恢复，同时守住input/render/timer/snapshot接线及<800行。
本刀核准39个旧主composer消费者已迁，BottomPane owner/测试及local_settings接线同步；
未删除源码文件、缓存、二进制或用户数据，未提交、推送或创建分支。

首轮all-targets实际1454通过/2失败：帮助层Esc退到scroll/interrupt之后，以及公开pane按键
接口只编辑主composer、越过活动notes。两处沿唯一input owner修复，不改原失败断言/超时；
新增direct-key回归证明Backspace与Enter只编辑/提交活动notes、主草稿不变。最新完整TUI
1457 library +18 integration +1 dependency guard通过，owner新增7/7、线程生命周期15/15；
普通gated test early return不计真实stdio/PTY。strict all-target Clippy --no-deps -D warnings、
TUI fmt、结构/夹具/PTY/inventory守卫61/61、ESLint/Prettier/diff check、contracts通过；
legacy-report边界违规/分类漂移/零引用候选均0。inventory重新生成（1411文件）。

默认fresh TUI Gate B构建成功（2m31s），完整11场景退出0，thread
`01a0f7eb-bcaf-7520-892d-cacf910a515b`、turn `turn_668845abba4a441592e98cdda1d54cc6`；
强制thread-input-stdio marker：root `01a0f7ec-3836-7041-bd43-a32a059bff26`、
child `01a0f7ec-387a-71b3-aeab-8f61deab76bb`、turns
`turn_a833a70e6c2940388d8ac17be4baa992` / `turn_f564f2da6a064abd84a01e5c4273d203`；
typed-input-stdio：thread `01a0f7ec-6911-7710-b498-114d193a0803`、
turn `turn_280a9dc1b27b492eb711eba5b9aad5bc`。queue edit、Agent Center、thread draft/edit lifetime、
session register、notes keymap、images/mentions、structured history、submission reject、
focus/resize/reconnect与terminal=restored全部ok。受控external backend，非live provider。
保留本次隔离fixture evidence于
`/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-gate-b-qpv3P8`（不含真实用户输入）。

同一fresh CLI/App Server的CLI Gate B退出0，thread `01a0f7ee-f27f-72a3-88f4-be58bcf49162`、
turn `turn_201161e0fc02411884f30b31f2be1c40`；jsonl/stdin/error-exit/completion合同通过。
CLI前后二进制SHA-256一致：lime
`24cea7f93a62de9001faad02e4130bb9ee7c5216bd8bf460ee66a1caeba9fd5d`；app-server
`ac6b75af0167729538988ec46976d64e520668505c8fa655ee8e093d150bceea`。
日志：`/tmp/lime-bottom-pane-{all-targets,clippy,fmt,guards,eslint,format,gate-b,cli-gate-b}-final.log`，
contracts、inventory、legacy-report与定向失败/恢复日志同一prefix。
责任开发者root确认实际架构图与architecture.md一致；GUI/TUI共用App Server/runtime/
canonical owner未改变，无PR或release操作。本轮未新增全量verify:local/Windows/X11/live验收。
工作区后续出现sidebar/navigation并行改动，保持只读；前序GUI证据只属于当时工作树，不覆盖
这些后续改动。release-v1.148.0-plan继续避让。本切片验收完成不等于整体目标达成：
完整ChatWidget/协作scope恢复、history byte scan/replay seed、Agent Center异步刷新、
app/plugin/task mentions与平台/live等仍按原路线图partial/defer推进。

### 前序：lossless structured input restore（terminal acceptance completed；整体 partial）

主目标和 GUI/TUI 共用业务底层约束不变。下一刀修复 TUI queue/edit/history/retry 将
canonical TextElement.placeholder=None 改成 Some 与图片 detail 丢失的问题：终端可以生成
自己的图片标签和 trim 文本，但不得无声覆盖 canonical 输入元数据。窄写集：textarea
elements/snapshot/submission trim、composer attachments/draft/history/external edit、App input
lowering、runtime submission dispatch 的提取、独立回归和现有 PTY/guard、架构与本计划。
GUI/protocol/provider/Electron 只读，沿用已有 ImageDetail 字段，不新增 schema/method/config。
runtime.rs 为 2257 行，必须把本切片提交/失败恢复路由提取到独立 runtime/input_submission
owner，不在巨型 loop 增加业务逻辑；其余 host loop/clipboard/export 的后续拆分继续登记
退出条件 <800 行，不用这次定向拆分宣称巨型 owner 已全清。
退出条件：1) None/Some 元数据经 UTF-8 编辑、snapshot/undo/thread、trim 提交原样保留；2) remote/local detail 经 queue edit、history、retry、external edit 保留且附件原子删除不串位；3) 各层复用 canonical typed input，旧 paths-only/urls-only rich-history 投影原位替换；4) 定向/完整 TUI、strict owner Clippy 与结构守卫；5) freshly built binary 的真实 PTY/CLI
和共享 read-model 断言。实现 1/2/3 已接线；最终退出条件仍待完整质量/真实终端验收，不以
gated stdio 测试在普通单测中的 early return 当实际证据。总体 partial/in-progress，goal active。
责任 root，2026-10-01；不使用子 Agent，不提交、推送、建分支或重置。

实现：TextArea range/snapshot 保留 optional placeholder；mixed paste expansion 与 trim 不再
将 None 填成字符串。AttachmentState 原位移除重复 AttachedImage，完整 local/remote
attachment 同时进入 history、thread snapshot、Vim undo、external editor 与失败恢复。
remote metadata 按对象顺序移动/删除，相同 URL 的不同 detail 不会串位。queue preview/edit
撤旧 None/detail 禁用条件，同时保留边界/overlap/排序/Skill identity 检查，未知 Mention 仍
fail closed。runtime/input_submission 将三条 transport 成功/失败路径统一为真实 owner，
约100行；runtime.rs 2136行，剩余 host/clipboard/export/tests 待拆，不称巨型owner已清理。
首轮完整库1432 passed/1 failed 正是旧 can_restore guard 仍禁用 typed metadata，已修生产
guard 并补五语言 edit hint 与非法范围回归，未弱化输入/完整对象断言。
定向 input_submission 10/10（其中新 real stdio target 普通运行未开启）与前序 structured
input 3/3通过；新增mixed-paste、真实共享stdio fixture和最终完整验收进行中。
新增真实stdio场景归既有 Gate queue-edit 驱动：canonical sidecar/detail/None queue
-> TUI keyboard Tab -> 原 thread/queue/add -> 全对象echo；active steer+queue失败、显式queue
失败与idle start失败均保留typed draft，等待真实turn terminal，再断言read model与零额外Turn。
该场景不制造生产注入入口、不调用外网/provider、不改进程全局环境；所有数据/sidecar/ledger
隔离在临时目录。元数据往返属于真实stdio证据，完整PTY另行证明terminal surface，不冒充
GUI 或live provider。docs中的 owner/data-flow 已同步，root确认共享主链不变，2026-10-01。

最终验收：完整 TUI 1435 library + 18 integration + 1 dependency guard、TUI all-target
Clippy --no-deps -D warnings、55结构/PTY/inventory守卫、contracts、legacy/scripts、ESLint、
docs boundary、fmt/diff check 均通过。普通单测内 gated stdio 的 early return 不计真实证据；
Gate queue-edit 实际开启并强制检查 STDIO_TYPED_INPUT_OK marker，真实 canonical queue
全对象往返与 queue/steer/start 三条拒绝恢复均通过。HTTP URL 首轮假定三个入口都拒绝不成立，
改为非法 data URL 后真实复验；未改变 production HTTP 语义。
完整11场景 PTY通过：thread `01a0f6f6-3c29-7001-8e49-b74c2c502ea8`、turn
`turn_79de58aa112f46f294088ce098230112`；typed stdio thread
`01a0f6f6-7c3c-7f00-bbd7-372254c8a170`、turn `turn_4bb841aac1a34dc494fc769c21d2aacd`、
queue `446111df-fe39-4a76-bb7b-504a78cb090b`。相同fresh二进制CLI Gate B通过：thread
`01a0f6fa-563d-7ab0-ada7-541974ad23ff`、turn `turn_a1b99aad62ab44d8a4b4506fbee3894d`，
jsonl/stdin/error-exit/completion与终端恢复全部保持。日志 `/tmp/lime-lossless-input-*`。
退出条件5/5（100%，仅切片最低验收）；整体 partial/in-progress，goal active。
分类：typed input/history/restore与提交owner为current；重复AttachedImage、生产paths-only/
urls-only重建、None/detail禁止编辑为dead/原位替换，无新增compat/deprecated。cfg(test)默认
图片夹具不属生产兼容。SRP提取submission，DRY同一typed snapshot，KISS/YAGNI不扩协议。
inventory 1404 src文件仅用于发现差异。GUI/protocol/provider/Electron本刀只读，沿用前序
shared runtime Electron fixture和GUI smoke，不冒充本刀GUI专用UX证据。扩大protocol/
App Server strict Clippy既有问题、verify:local、Windows/MSVC、WSL/X11、live provider未收口。
基线 `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；Codex SHA-256：protocol/user_input
`735e8f4f8c531dbd99d495cea5602d8f7f5f5cc77b309db9b7c6b75661e7a368`；chatwidget/input_submission
`5d0485e9bd4f673425ea80d9735484fb3e194072cd02490d8951df03c1028888`；bottom_pane/textarea
`28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50`。
ImageDetail/optional element为direct协议语义；None无损、typed remote与独立submission为merge，
不是逐字复制Codex TextArea。下一刀回到完整thread-owned lifecycle/routing；history replay seed/
byte scan、Agent Center async refresh及app/plugin/task mentions继续defer。

### 前序：submission preparation / shared input limit（terminal acceptance completed；整体 partial）

主目标仍是 GUI/TUI 共享底层的全维度 Codex 对齐。用户再次强调多端共用，并非旧实现兼容。
本切片对照公开 `chat_composer::prepare_submission_text/trim_text_elements` 与 App Server
`validate_v2_input_limit/input_too_large_error`：终端先展开长粘贴，按 Unicode whitespace trim，
以 UTF-8 bytes 重定位元素；共享服务端按所有 Text parts 的 Unicode scalar count 汇总校验，
不 trim、不 flatten GUI 输入。阈值唯一归 `agent-protocol::input::MAX_USER_INPUT_TEXT_CHARS`
（1 << 20），`validate_user_input_text_length` 被 TUI、turn/queue public ingress 和 RuntimeCore
消费。媒体/Skill/Mention identity 不计入正文长度，仍保持原有校验与媒体 owner。

窄写集：canonical input、App Server processor/turn/input 与 turn/queue 接线、runtime/turn_start、
独立 public JSON-RPC fixture；TUI composer/submission、input routing、InputResult/App mapping、
notes overlay 与五语言错误、独立回归、既有 PTY/结构守卫；architecture/commands/本计划。
turn.rs 接近 800 行，同轮将 282 行 inline tests 迁到 turn/tests.rs，不保留测试 wrapper 或
新增业务后端。前序脏改动延续；Codex/GUI/provider/Electron 只读，不新增 method、schema
字段、依赖、配置或 mock fallback。未提交、推送、创建分支或重置。

实现：旧 `take_submission` 原位替换为真实 `submission` owner，使用同义
`prepare_submission_text/handle_submission/trim_text_elements`；验证成功前不消费 editor，
拒绝保持 folded payload、元素 ID、cursor、attachments、mentions 和本地 history，无需重建
editor 导致 undo 损失。成功后仅当前 owner 消费草稿并记录 rebased rich history。主 composer
映射 Error transcript；嵌入式 notes 的错误在自身 footer 可见，不无声丢弃。
public start 在环境/设置副作用前校验；steer/add/update 共用同一 structured INVALID_PARAMS：
`data={input_error_code:"input_too_large",max_chars,actual_chars}`。RuntimeCore admission/queue
消费相同阈值规则；不把历史 read 或合法附件转换变成新的限制入口。

退出条件：1) 展开后 trim/rebase + Unicode boundary + 空输入及附件/mention/history；2) public start/steer/queue add/update 全对象错误、拒绝零 mutation、有效 GUI-shaped rich input
原样进入 backend；3) 主/嵌入式五语言可见错误，完整 draft 保留且可编辑重试；4) crate/Clippy/结构与 contracts，shared runtime fixture + GUI smoke；5) 真实 PTY oversized reject / 原子删除 / padded draft canonical trim 和同 binary CLI Gate B。
退出条件 1/2/3/4/5 已闭环，5/5（100%，仅该切片最低验收）；扩大 strict Clippy 与
GUI 超长输入专用 UX 仍列为额外未收口项，不称全仓全绿。首轮 TUI 1423 passed / 1 failed
是旧测试期待保留尾部空白，已按 Codex trim 语义更新；notes enum 接线缺口已补并复验。

latest 证据：完整 TUI 1427 library + 18 integration + 1 dependency guard、canonical protocol
43/43、RuntimeCore input admission 3/3、turn lowering 11/11、公共 queue 5/5、独立 input-limit
JSON-RPC 1/1、52 结构/PTY/inventory 守卫、GUI inputbar/typed thread client 44/44、contracts、
legacy/scripts/ESLint/diff check 通过。notes 首轮 snapshot 只画了不含 footer 的子组件，现已
直接走主 view/BottomPane/footer 渲染，五语言可见错误通过，没有修改断言去接受不可见状态。
shared runtime Electron fixture 聚合通过（liveProviderUsed=false），覆盖正常 GUI 输入、rich draft
恢复、同 Turn steer、真实终态和 read model；它不证明 GUI 超长输入的专用 UX 已验收。
TUI all-target Clippy --no-deps -D warnings 通过；独立 agent-protocol strict Clippy 发现既有
message_content.rs large_enum_variant 与 thread.rs TurnQueueState derivable_impls，源码与 HEAD
无本轮差异，未为了绿灯添加 allow 或改共享类型布局。该额外检查为未收口质量项，不称全绿。
test:related 在 Vite 扫描 bare electron 时 EISDIR，随后按相同 consumer 精确执行两 target，
44/44 通过；不修改 runner/依赖或无差别扩大前端全量。inventory 1401 文件只用于发现差异。
日志 `/tmp/lime-input-preparation-*`；本轮避让 GUI/provider/Electron 源码和此前其它热区。

最终终端验收：完整 11 场景真实 PTY 通过，thread
`01a0f6d7-6f34-7092-ba1a-ca6ed5e20900`、turn `turn_f617b86b2f2243289caf1e1a2f90bd8d`，
`submission-prepare=ok rejected-draft=ok` 与此前全部 draft/history/queue/agents/images/skills/
keymap/focus/resize/reconnect 保持，terminal=restored。相同 freshly built binaries 的 CLI
Gate B 通过，thread `01a0f6d8-8460-7ab3-9d19-8e0ec7cd32a7`、turn
`turn_a254a93dff2f4993a68b07bd12f33d35`，`jsonl=ok stdin=ok error-exit=1 completion=zsh`。
GUI smoke pass：`.lime/qc/project-gates/standalone-shell-01-20261001093424-88679/shell-01-electron-smoke/summary.json`，
包含真实 Electron/App Server、重载、3 responsive viewport、memory settings；不证明 GUI
超长错误 UX。扩大 App Server strict Clippy 报 124 个问题，多数为其它既有 owner；本轮
turn.rs 两处 field-reassign 初始化已原位修复，不批量添加 allow。独立 protocol 两项既有
lint 继续未收口；verify:local、Windows/MSVC、Linux WSL/X11、live provider 未执行。
分类：shared policy / submission owner / public validation 为 current；旧 take_submission 和
test-only lowering wrapper 为 dead / 原位替换，无新增 compat/deprecated 或第二 backend。
SRP 拆分 turn tests 与 submission，DRY 共用字符 validator，KISS/YAGNI 不扩展协议或复制 GUI
输入策略。整体 partial/in-progress，不将此切片 100% 当成总体进度。

来源基线 `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；SHA-256：Codex chat_composer
`3f9847e8188f57c0ad665b682f626c8ae9b9f1c5d1c03bf231b0d762f6645ef2`；protocol/user_input
`735e8f4f8c531dbd99d495cea5602d8f7f5f5cc77b309db9b7c6b75661e7a368`；turn_processor
`0a1058134accb3f9285aa940708e109704b582b8fc35d04f1dfb84e1231fc1e0`。
trim/rebase/Unicode cap 与 structured error 为 direct，同一个 shared validator 和验证前不消费
草稿为 merge；完整 slash/deferred goal/bang-shell、ChatWidget lifecycle、None placeholder /
image detail lossless restore 仍 defer，不能由这一刀宣称完整 composer 对齐。
架构确认：root，2026-10-01；共享 canonical policy + 多 surface consumer，业务主链不变。
整体 partial/in-progress，goal active；平台/live provider/完整 GUI Gate B 尚无本轮验收。

### 前序：thread composer edit lifetime（terminal acceptance completed；整体 partial）

主目标保持共享底层与全维度 Codex 对齐。下一切片只重建 successful thread handoff 的
editable state：旧 Thread undo/redo/command/search/paste-burst/matcher 不进入新 Thread；
kill/yank 属 TUI session，通过 Codex 同名 `KillBufferSnapshot/take_kill_buffer_snapshot/
restore_kill_buffer_snapshot` 移交，不写入 per-thread draft 或持久化。完整 App/ChatWidget/
BottomPane lifecycle 仍 partial，不预建空壳。窄写集：textarea/vim_register + reexport、
composer/draft、app/thread_input、独立测试、既有 PTY/guard 与本计划/architecture。
Codex 仅读，前序工作延续，GUI/协议/runtime 不变。退出条件：1) successful handoff 重建
editable state 且旧 undo/repeat/chord/search 不泄漏；2) linewise/characterwise register
保持类型与文本并只有一个 live owner；3) rich draft、cursor、attachments/pending paste/mention
仍完整恢复，bindings/catalog/event sender 等进程配置不丢；4) owner/crate/Clippy/结构守卫；5)真实 root/child PTY 与同一 binary CLI。责任 root，2026-10-01；业务 authority 仍归共享
App Server/canonical Thread/Turn/Item，thread draft 仅是 TUI 内存投影。

已实现：`textarea/vim_register` 的同名 snapshot take/restore 具有真实 fresh-editor consumer；
`ChatComposer::restore_thread_input_state` 重建 DraftState/TextArea，不重建第二套 App/后端。
现有 shell 保留 app event sender、locale、skills catalog 与 navigation 配置；当前 RuntimeKeymap
重新注入新 editor，完整 rich draft/cursor 仍从同一内存 snapshot 恢复。register 不进入
ComposerDraft，正常 reconnect 与 failed resume 不走该 owner。capture 前沿既有 paste owner
物化 held typing，避免替换时丢失或在新线程迟到 flush；query/preview 不进入 original draft。
root/child 定向 6/6、首轮完整库1418/1418、all-target 18 integration + 1 guard、owner Clippy
及51结构守卫通过。新真实 agents-overview PTY 首轮通过，thread
`01a0f6a3-af4f-78b1-887f-81f7d73eddac`、turn `turn_b1db9347f705442f86f04a8a697af390`：
`thread-edit-lifetime=ok session-register=ok`，真实 `u/.` 不把 child undo/command 写入 root，
`p` 保留跨线程 linewise register，原 folded draft/cursor 与 atomic paste 删除断言保留，
pre-submit ledger 仍为唯一原始 turn。补 held ASCII capture 后定向7/7通过，latest全库/11场景/
stdio复验进行中；未提前关闭退出条件5。
来源基线仍 `c248f6d48b`；SHA-256：Codex session_lifecycle
`dfffdff4d55f24724c108efb52a3198c30635b87c48d0f4bbdc6569e39d32437`；chatwidget/input_restore
`cf5dabc591fe35780af1e08ce61289b8acf659275dc708af51f5edc696cb91a4`；textarea
`28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50`。
register API/文本与kind、fresh edit lifetime 为 direct 同义；当前 composer shell + rich snapshot、
小模块和 capture时复用 paste owner 为 merge，完整 ThreadInputState/ChatWidget 仍 defer。

最终验收：latest all-target TUI 1419 library + 18 integration + 1 dependency guard、owner
Clippy `--no-deps -D warnings`、51结构/PTY/inventory guards、legacy/scripts、ESLint、docs
boundary、fmt/diff check 全部通过。完整11场景真实 PTY 通过，thread
`01a0f6a7-b7ae-7042-a190-f8b195e64856`、turn `turn_50f38942ce344d72951ec67b292fd71c`：
`thread-edit-lifetime=ok session-register=ok`，此前所有 modal/editor/notes/history/queue/agents/
images/skills/structured-history/focus/resize/reconnect 和 terminal=restored 保持。相同 freshly
rebuilt binary 的 CLI Gate B 通过，thread `01a0f6a8-4ea5-7bf3-a50b-581a6c649a0b`、turn
`turn_23b0297aec074166a4336454ed161b60`，`jsonl=ok stdin=ok error-exit=1 completion=zsh`。
日志 `/tmp/lime-tui-thread-edit-*`；本切片无 protocol/schema/config/GUI 修改，沿用本轮 modal
公共 config 与 contracts 已闭环的共享底层合同，不冒充 GUI 产品证据。库存1399 src文件只用于
发现差异；draft324、thread tests157、PTY thread303、register含snapshot <160 行，无巨型owner。
分类：fresh editor/register transfer/capture flush 与 rich draft 单一恢复入口为 current；旧
successful handoff 直接复用编辑状态为 dead / 原位替换，未保留 compat/deprecated 或第二后端。
SRP 保持 register/草稿/host 路由分层；DRY 复用 paste owner、同一 bindings/snapshot恢复；
KISS/YAGNI 不复制完整 ChatWidget 或加入无消费 ThreadInputState字段。责任 root 再确认
architecture 中传递图，2026-10-01。退出条件5/5（100%）；总体 partial/in-progress、goal active。
verify:local/full GUI、Windows/MSVC、Linux WSL/X11、live provider 本轮未执行；共享后端保持
GUI/TUI可消费，不表示这些平台/GUI已重新验收。未提交、推送、创建分支或重置。
下一刀回到 submission preparation：展开 pending paste 后的 trim/rebase/字符限制、附件与
mention完整对象及拒绝后的草稿恢复；审计 shared UserInput/App Server消费者，再在 current
owner重建，不把 TUI-only提交策略下沉成另一套 GUI/runtime权威。完整 thread-owned
ChatWidget/BottomPane routing、byte-anchored history scan/replay seed、Agent Center async refresh
和已列产品范围 defer 继续未完成，不用本切片100%替代全目标完成度。

### 当前续跑：Vim keymap contexts / BottomPane snapshot（terminal acceptance completed；整体 partial）

主目标保持功能、UI/UX、命名、目录、owner、设计模式和测试组织全维度对齐。
本切片承接已验收 editor owner，迁入 Codex 同义 `TuiVimNormalKeymap`、
`TuiVimOperatorKeymap`、`TuiVimTextObjectKeymap`、`TuiVimSearchKeymap` 与运行时
`KeymapContext/TextArea::keymap_context`。直接替换 modal raw-key matches、composer 的
undo/redo 和事务启动硬编码，不保留双轨；linewise register/paste 与字段真实消费者同轮闭环。
窄写集：core config/tui_keymap 及 Vim schema 子模块、TUI keymap 的 Vim owner、textarea
modal routing/register/search、composer input/vim_history、App 与 BottomPane snapshot 接线，
对应独立测试、既有 config_jsonrpc/PTY/结构守卫和 ops/commands/architecture/本计划。
前序改动保持；Codex 仅读；不触碰 GUI/provider/runtime，不新增 method/依赖/私有配置。
退出条件：1) 四个 Vim contexts 的字段均有真实消费者；2) alternatives/chord/unbind、
大小写/shift、modal printable prefix、重绑/切换清 pending 和冲突拒绝；3) semantic replay、
undo/redo、history 与 linewise register/paste 不依赖原始键；4) startup snapshot 传播到
BottomPane 新建与排队文本输入且 pending completion 不穿透提交；5) 定向/crate/公共
config JSON-RPC/真实 current PTY 与 stdio 证据。完整 thread-owned composer lifecycle、
跨 thread Vim history lifetime 和 byte-anchored history scan 继续 defer。
责任开发者 root，2026-10-01：canonical App Server 主链不变，仅收敛终端输入 owner。
前序 related 最终结果已接收：CLI 8/8 + TUI 1402/1402、docs boundary/ESLint/diff check 通过。
实施中发现 current `bottom_pane/mcp_server_elicitation.rs` 已达 1824 行，新增 snapshot 接线
必须同轮拆成 control / render / schema / tests（退出条件各非生成文件 <800 行），不继续堆逻辑。
首轮 modal keymap 50/50 通过；完整库 1409 passed/3 failed：idle Normal Esc 误截 host interrupt、
selected remote-image Delete 未启动 undo 事务、默认 search backward 未向显式 global `?`
让位。三项按 owner 修复，原断言保留；尚未宣称 terminal acceptance。

最新实施与验证：四 contexts 的 69 个 action 均经 schema roundtrip 与实际 dispatch 测试；
`vim/input` 唯一解析 modal action，`vim_register` 统一 linewise/characterwise，composer
undo/redo 与事务启动删除 raw-key 检测。BottomPane 排队/新建 notes 与 MCP 文本字段接同一
snapshot，query editor pending chord 优先于提交/取消。MCP control/render/schema/tests
拆分后分别 546/360/371/570 行，无旧 render reexport。默认 Normal Home 不保留隐式 alias，
既有 PTY 改用 Codex 的 `0` motion，语义断言不变。新增结构守卫覆盖上述 owner 与旧路删除。
TUI 最新完整库 1414/1414、all-target 的 18 integration + 1 dependency guard、owner Clippy
`--no-deps -D warnings`、core keymap 6/6、结构/PTY/inventory guards 51/51 已通过。
公共 config JSON-RPC 从仓库既有受校验 V8 artifact resolver 进入真实定向 `cargo --test
config_jsonrpc`，1/1 通过，未重复展开 58 targets；覆盖四 contexts 的 read、normalized
alternatives/chord/unbind、batchWrite 和非法字段/键/三段 chord 写入拒绝且持久状态不变。
contracts、legacy/scripts、ESLint、docs boundary、fmt 与 diff check 已通过；all-target 验证
不包括受专用 entrypoint 驱动的真实 PTY（正在执行 complete/user-input），尚未标退出条件5完成。
来源基线仍为 `c248f6d48b`；Codex SHA-256：keymap
`af8edcd1afa0510da8ac596d4adfe082dabb9ac3d2dd2e9a5b97bed17dd3acd1`；config/tui_keymap
`d37c9dc213f86fc938d68bf68860122e4e3194f589acce109f48cadde394a33e`；textarea
`28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50`；vim_commands
`217443ca1cd7df8993c4a7ec4fafa485e746d499b1e5cd6b5d768490d6879aec`。
69 同名字段/action、KeymapContext、linewise register 为 direct 同义迁入；小模块、typed
resolved action 与既有两段 matcher/host boundary 为 merge，不复制 Codex 巨型文件或空配置。
库存更新为 1397 src 文件，仅用于差异发现；宏生成类型不由 regex inventory 完整提取，
以编译/69 action dispatch 证明 consumer，不以文件/符号数计算完成率。
分类：schema/modal dispatch/register/BottomPane snapshot 为 current；raw-key modal/search/
undo detector、MCP Ctrl+J fallback 与旧大文件单 owner 为 dead / 原位替换，无 compat/deprecated。
日志 `/tmp/lime-tui-modal-*`；verify:local/full GUI、Windows/MSVC、Linux WSL/X11、live provider
未执行，不能借用前序证据宣称本切片终端通过或整体对齐100%。
首轮真实 PTY complete 在 `Esc + 0` 连写时被终端解析为 Alt+0，仍处于 Insert，后续 `x`
进入文本；按实际屏幕定位为测试键流问题。改为 standalone Esc 后等待 Normal 的真实
render predicate，再发送可打印命令；不加固定 sleep、不改 timeout、不保留 Home alias。
删除/unbind 断言比较完整输入行，避免 substring 掩盖多余字符，重跑中。

最终验收：complete/user-input 定向 PTY 通过，thread
`01a0f696-ff23-7d31-a079-3be2c06a8f94`、turn `turn_c34d73ec241c47f09552aae465a51f15`。
随后保留完整行断言重跑全部 11 场景通过，thread
`01a0f698-230d-7941-8953-c6666136bcfb`、turn `turn_94a88dcbf90d4a1089157f147ee14c64`：
`vim-keymap=ok vim-linewise=ok vim-modal-chord=ok notes-keymap=ok`，既有 editor/history/
persistent-history/Vim-repeat/search-state/paste-burst、queue/agents/thread-draft、images/skills/
structured-history、sticky-prompt/main-find/focus/resize/reconnect 和 terminal=restored 保持。
pre-submit ledger 继续证明 modal 编辑/chord 不创建 canonical Turn，notes 仍提交精确
`Safe + user_note: PTY_NOTE_ANSWER`，不弱化答案或恢复断言。
同一 freshly rebuilt `lime + app-server` 的 CLI Gate B 通过，thread
`01a0f699-8a0d-7111-a0ac-07ba2a96be21`、turn `turn_38db06c9812f424ea9a1ff326e8e3751`，
`jsonl=ok stdin=ok error-exit=1 completion=zsh`；不是旧 target、第二 backend 或 mock fallback。
latest inventory/51 guards/docs boundary/diff check 通过；App Server build 中既有
`lower_turn_start_params/lower_runtime_options` dead-code warning 不属于本轮终端 owner，
未越过窄写集修改。该切片退出条件 5/5（100%），整体 partial/in-progress、goal active；
verify:local/full GUI 和未运行平台继续明确未验证。无提交、推送、分支、重置。
SRP 拆分 modal/register/MCP control/render/schema，DRY 复用 bindings/matcher/语义编辑，
KISS/YAGNI 只暴露真实 69 action consumer；多端共享 App Server/config owner 不变。
下一刀是 composer 在 thread 边界的重建/状态清理：Codex 新 widget 重置 undo/录制/search，
通过 `KillBufferSnapshot/take_kill_buffer_snapshot/restore_kill_buffer_snapshot` 传递 session
register。不能让旧 Thread 的 undo 写入新 Thread，不能把 register 放进 per-thread durable
draft，也不能为了命名同构预建无真实消费者的 ChatWidget 空壳；完整 lifecycle 继续待实现。

### 当前续跑：editor keymap owner（terminal acceptance completed；整体 partial）

主目标仍是功能、UI/UX、命名、目录、owner、设计模式与测试全维度对齐。本轮先闭环
Codex 同义 `TuiEditorKeymap/EditorKeymap`、`TextArea::set_keymap_bindings/input_with_keymap`，
直接替换 insert-mode 硬编码分支与 composer 的静态 editor-key 检测，不留 alias。
窄写集：core config/tui_keymap、TUI keymap/editor、textarea/input、composer/input、App snapshot
接线及独立测试，public config_jsonrpc、既有 PTY/结构/inventory 守卫、ops/commands/architecture
与本计划。前序脏改动延续；外部 Codex 只读；不触碰 GUI、provider 或其它 runtime 热区。
唯一配置链仍是 core config -> App Server config/read -> LocalSettings -> RuntimeKeymap ->
TextArea/composer；不新增 method、私有配置文件、环境变量或无消费者 Vim 字段。
退出条件：1) 17 个 editor action 都由同一 snapshot 消费；2) alternatives/chord/unbind、
跨 global/host 冲突 fail closed；3) Insert/Replace 共用 resolved semantic action，重放不依赖
当前绑定；4) public config read/write + composer/textarea 回归；5) current binary 真实 PTY、
stdio、alternate screen 与 terminal restore。完整 Vim contexts 下一切片继续，不冒充完成。
责任开发者 root，2026-10-01：App Server/canonical 业务链不变，只收敛客户端编辑 owner。

实现状态：17 个 editor action、alternatives/chord/unbind、global/host conflict、真实 App
snapshot 接线与 Insert/Replace resolved semantic replay 已实现；textarea 输入拆到独立
`textarea/input.rs`，主文件从接近 800 行缩回 604 行。旧 `is_editor_key_event` 与
insert-mode raw key match、Replace 硬编码 Backspace 为 dead / 原位替换，无 alias。
快捷帮助的 newline 改用同一 snapshot，解绑/仅普通 Enter 时不宣传不可执行换行；五语言
使用既有 Label，不新增字符串镜像。Vim query editor 继承当前 snapshot，更新只换 bindings。
当前尚未完成 BottomPane 其它文本编辑 overlays 的 snapshot 传播与完整 Vim contexts，保持 defer。
首轮测试编译因迁出输入 imports 暴露 elements_tests 对父层偶然 import 的依赖，已改测试显式
导入。library 首轮 1395 passed/3 新断言失败：Windows-only AltGr 的 macOS 错预期两项，
Enter 已与 insert_newline 冲突却要求 reserved 诊断一项，已按平台及真实 conflict 修正。
随后 TUI 1399 library + 18 integration + 1 dependency guard 通过；后续增加可见帮助/查询与
pending Esc 测试，最终轮仍待验收。core tui_keymap 5/5、contracts/legacy/scripts 已通过。
直接 cargo app-server 测试尝试下载 denoland v8 默认 archive 并 404；转仓库既有
`test:rust:integration` wrapper 解析受校验的 Codex V8 artifacts，不修改依赖或系统环境。
当时 public JSON-RPC / complete PTY / Clippy 仍在进行，未提前标为 terminal acceptance。

来源基线保持 `c248f6d48b`；SHA-256：Codex `tui/src/keymap.rs`
`af8edcd1afa0510da8ac596d4adfe082dabb9ac3d2dd2e9a5b97bed17dd3acd1`；
`config/src/tui_keymap.rs`
`d37c9dc213f86fc938d68bf68860122e4e3194f589acce109f48cadde394a33e`；
`tui/src/bottom_pane/textarea.rs`
`28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50`。
类型/action 名、17 字段、默认绑定、Arc snapshot 与 input_with_keymap/resolved replay 为
direct 同义对齐；Lime 独立小模块、既有两段 matcher、五语言与 retained host 路由为 merge。
没有把大量未消费的 Codex global/chat/Vim 字段复制成空合同。

后续验收中新增五语言 TestBackend 断言忽略了 CJK wide-cell 的空白占位，导致
1401 passed/1 新测试失败；按既有测试的 compact 比较修正，不修改 renderer 或放宽语言覆盖。
最终 TUI `1402` library + `18` integration + `1` dependency guard 已通过，latest owner
all-target Clippy `--no-deps -D warnings` 通过；core keymap `5/5`、48/48 结构/PTY/库存守卫通过。
public config/read/batchWrite/valueWrite 的 normalized editor shape、未知字段/非法 chord 拒绝与
失败写入不改 persisted state 通过。仓库 integration wrapper 的 `--tests` 与指定 `--test`
组合实际展开 App Server 全部 targets：最终 58 targets / 1948 tests 通过，无 ignored；
今后定向复核先避免该 additive selection，不把无意扩大门禁当成主线新能力。
PTY 首次在 build lock 等待时命中原 60s fixture timeout，未开始场景；不改超时，锁释放后
重跑。第二轮 complete 的 editor 改绑/unbind/chord 全部走通，Agent thread draft 的原子
paste Delete 断言失败，原因是新 fixture 的 delete_forward=[] 套到了所有场景；把该配置
限定 complete，保留其它场景原配置和完整断言，Agent 定向 Gate B 随后通过：thread
`01a0f64f-4705-77a0-a39f-3fd0e5b707b7`、turn `turn_a2031799bfd14592af66691c74c6bb74`。
当时全 11 场景最新重跑仍在验收。current binary CLI Gate B 已通过：thread
`01a0f64e-53d9-7311-8ae8-82b3b52eeb2e`、turn `turn_33401862551d4be090297f8bf2c95b7e`，
`jsonl=ok stdin=ok error-exit=1 completion=zsh`。日志统一 `/tmp/lime-tui-editor-*`。
`verify:local` smart 命中整个前序脏工作树，version/i18n/lint/变更文案 scan 已执行；在
typecheck 阶段停止本轮编排（exit 143），避免下一步从第 1 批重跑已完成的前端 120/120。
原 `.lime/test/vitest-smart-last-run.json` 保持 passed；不宣称这次 local/typecheck/full GUI
门禁通过，不重启 runtime aggregate，不把 Windows-only AltGr 的 cfg 回归当 Windows 实跑。

最终验收：完整 11 场景真实 PTY Gate B 通过，thread
`01a0f650-78e9-7483-864b-e7b5a692039c`、turn `turn_79f84ce0e8da475981b5ac79b449f70c`；
`editor-keymap=ok editor-unbind=ok editor-chord=ok`，已有 history/persistent-history、Vim
repeat/search-state/paste-burst、queue、agents/thread-draft、sticky-prompt/main-find、images、
skill/structured-history、focus/resize/reconnect 与 terminal=restored 全部保持。pre-submit ledger
仍证明编辑/chord/搜索不会创建 canonical Turn。current CLI Gate B 使用同一 freshly rebuilt binary，
不是旧 target 或 mock fallback。主 textarea 604 行，input 139 行，editor keymap 319 行，
core schema 490 行；库存 Codex 1048 + Lime 339 = 1387 src 文件，不作为完成率。
旧 input_replace_mode helper 与 Insert/Replace 重复分支一并删除；semantic DeleteBackward 的
Replace recovery 保持单一 owner。分类：editor schema/snapshot/dispatch、resolved semantic
input、实际帮助与真实消费者为 current；硬编码 detector/key match/Replace helper 为
dead / 原位删除；无 compat、deprecated、品牌新命名或平行业务后端。
本切片退出条件 5/5（100%）；整体继续 partial / in-progress，goal 保持 active。
SRP 拆分编辑输入与渲染，DRY 合并 Insert/Replace 和 replay，KISS/YAGNI 只接真实 consumer。
未重新闭环 verify:local/full GUI；Windows/MSVC、Linux WSL/X11 与 live provider 未运行。
没有提交、推送、分支或重置。

下一刀保持完整 Vim keymap owner：`RuntimeKeymap::{vim_normal,vim_operator,vim_text_object,
vim_search}`、`TextArea::keymap_context` 与 Codex 同义 action routing；同时明确补 BottomPane
其它文本编辑 surface 的 snapshot 传播。不能先暴露无消费字段，不能给 hardcoded key match
新增平行 owner。linewise register/paste、完整 thread-owned ChatWidget/composer lifetime、
byte-anchored history scan 与既有产品范围 defer 继续列为未完成，不能用本切片 100% 替代。

### 当前续跑：semantic Vim commands / stored search draft（terminal acceptance completed；整体 partial）

主目标保持功能、UI/UX、命名、目录、owner、设计模式与测试全维度对齐，不以文件数量冒充完成率。
参照同一 Codex HEAD 的 `textarea/vim_commands.rs` 与 `chat_composer/history_search_draft.rs`：
真实 `VimCommandState/VimEdit/VimAction/VimEditTarget/VimPersistentState` 承接命令录制、
完整 change 的 `.` 重放与 last search；搜索保存 original 与 preview 的独立状态。
窄写集：textarea/{vim,vim_commands,editing,vim_search}.rs、textarea.rs、composer 的
history_search{,\_draft}、draft/input/vim_history 接线、独立测试、app/thread_input 的 snapshot
消费者、app/input_submission 的异步恢复与 app/history_search 回归、现有 PTY/结构守卫/
本计划与 architecture。前序脏改动原样延续，Codex 仅读。
不新增协议、后端、GUI 业务或兼容 alias；不重启已通过的异步历史聚合。
退出条件：1) 语义命令录制与完整 change 重放真实使用；2) 搜索前 Vim command/search 状态取消
后保留且匹配接受隔离；3) 后台图片/文本编辑不改变 query/preview，取消保留、接受丢弃；4) thread snapshot 捕获 original 而非 preview；5) 定向/crate/Clippy/真实 PTY current stdio。
完整 keymap owner、thread-owned ChatWidget lifecycle、byte-anchored scan 等既有 defer 不冒充完成。

完整 Vim keymap 配置 consumer、linewise register/paste 与跨 thread Vim history lifetime 仍为
明确 defer；本切片只证明 semantic complete-change、stored search draft 与真实消费者对齐。
来源 SHA-256：`textarea/vim_commands.rs`
`217443ca1cd7df8993c4a7ec4fafa485e746d499b1e5cd6b5d768490d6879aec`；
`chat_composer/history_search_draft.rs`
`4e2f5b1ee1eb3e03292fad646483b30f806d34eb672041ff0dc2f842017dcb80`；
`chat_composer/vim_history.rs`
`bced83c897f7c92c856815be809df0932d180da2150a2fd8a701840cb54c1074`。
同义类型、owner、swap/record/start/finish/repeat 直接迁入；小模块、五语言、既有 host recovery
与 ComposerDraft 数据形状为 merge，不另建对外 snapshot 协议。

实现按 Codex 同名 owner 迁入语义事务，未保留 raw-key replay 或旧 Replace vector：
`VimPending::ReplaceChar` -> `Replace`、`next_word_start` -> `beginning_of_next_word`、
`word_end_cursor` -> `vim_word_end_cursor`，旧名字为 dead / 原位替换，无 alias。
`vim_commands.rs` 迁入完整 command recording/repeat 与 Replace recovery；`vim.rs` 保留
modal routing/operator/text-object，find/jump 实现迁回 Codex 的 command owner。2021 edition
仅改写不支持的 let-chain 语法，不变更 workspace edition/依赖。Normal 模式禁止 paste burst；
Replace/paste/Backspace 跳过并保留已注册 image/mention/paste elements，不以全量 element 快照
恢复被错误覆盖的附件。旧三个覆盖附件预期测试重写为 current 保留语义，保留 path/range/
mention identity/payload/undo/redo 断言。
`edit_stored_draft` 交换完整 original/preview Vim state，并暂存 Lime history owner，防后台
mutation 的 navigation reset 中断真实 lookup；query/fallback 与 original 独立，不复制业务存储。
后台 attach/insert/恢复未确认提交均有真实消费者；thread capture 使用 original。架构确认：
责任开发者 root，2026-10-01，现有 terminal -> App Server -> canonical 投影链不变。
中间验证记录：初轮 bottom_pane 342 passed / 3 旧附件语义失败，重写后 library 1380/1380、
related cli 8/8 + tui 1380/1380 通过（后续补 recovery/rapid-key 两项，最终轮待接收）。
新命令最初编译暴露 private sibling methods 与 2024 let-chain，已收口到 owner 可见性与 2021
语法；新增 TestBackend 使用既有 StatefulWidgetRef API，不补第二套 renderer。
`test:related` 的 Vitest related loader 对 electron 目录报 EISDIR，未改无关 test runner，转精确
`vitest run`。初轮 inventory guard 仍要求 snapshot_draft，已按 host 的 original draft_snapshot
事实重写，并额外断言 stored original。
真实 PTY 首轮 Vim 全流程走通后使旧历史场景缓存变热，旧 uncached Searching 等待失败；
移动 Vim 场景到完整历史检查之后，保留未缓存慢读与边界断言。中间 test helper 调用了不存在的
paste_burst_active，已改为现有 owner 的 is_active。后续 PTY 在首屏 shortcut close 原有竞态
处失败：旧 footer marker 在 overlay 仍显示时已存在，已改为同时等待 footer 存在且 overlay
消失，不添加 sleep、不扩大 timeout、不删原断言。全部失败日志保留于 /tmp/lime-tui-vim-commands-\*。

随后按 current paste-burst consumer 补 Unicode reclassification 回归，真实复现 17 字可见输入
经 `.` 变为 50 字（预期 34）：visible prefix 已撤回但 semantic command 仍录制该 prefix。
`retract_paste_burst` 的普通插入分支改经同一 `DeleteBackward` semantic actions，禁止只撤回
visible text。补 grapheme-boundary fail-closed；Replace recovery 分支仍复用同一事务。
该修正为 Lime current consumer 的 merge 正确性修复，不修改 Codex 参考仓库。

最终终端证据（2026-10-01）：TUI `1385` library + `18` integration + `1` dependency guard
通过，latest all-target owner Clippy `--no-deps -D warnings`、workspace fmt --check、docs:boundary、
diff check 与 `46/46` structure/inventory/PTY fixture guards 通过。治理 legacy/scripts 通过。
完整 11 场景真实 PTY Gate B 通过：thread `01a0f620-47b1-7c50-b162-b7b6cbaa46cb`、turn
`turn_eede251e1ccc42579d2ac83dea12b376`；`vim-repeat=ok vim-search-state=ok
vim-paste-burst=ok`，history-search、persistent-history、queue-edit、agents-overview、thread-draft、
sticky-prompt、main-find、images、skill-mentions、structured-history、focus、resize、reconnect
与 `terminal=restored` 均保持。17 字 Unicode 输入的实际键流 `.` 后为 34 字，并能两次 undo
回空；既有 pre-submit ledger 仍确保输入、搜索和 Vim 命令不会生成 canonical turn。
同一 freshly built current binary 的 CLI Gate B 通过：thread
`01a0f620-a1ef-78e3-9984-57ef07d8ff0d`、turn `turn_cf3785ee28984ad489bec88913f53133`，
`jsonl=ok stdin=ok error-exit=1 completion=zsh`。日志统一 `/tmp/lime-tui-vim-commands-*`。
来源 inventory 为 Codex `1048` + Lime `334` src 文件，仅表示覆盖，不表示完成率。
本切片退出条件 `5/5（100%）`；总体仍 partial / in-progress，goal 保持 active。
分类：semantic command/repeat/persistent state、stored draft、host recovery/handoff 为 current；
旧 Replace vector/recovery helper/临时命名/重复 search end-cursor 为 dead / 原位删除；
无 compat、deprecated、旧 alias 或新后端。SRP 把 command 与 query owner 分开，DRY 让键入、
Replace、retraction/replay 共用语义动作，KISS/YAGNI 复用 canonical 主链而不扩协议。
本轮未修改 App Server/IPC/GUI owner，不重复前序已通过的 runtime aggregate、contracts/GUI
smoke 或全量前端；不把定向验证提升为完整 verify:local pass。Windows/MSVC、Linux WSL/X11、
live provider 未运行，macOS PTY/current fixture 不冒充对应平台/live evidence。无提交/推送/建分支。

下一刀：Codex `RuntimeKeymap::{editor,vim_normal,vim_operator,vim_text_object,vim_search}` 与
`TextArea::set_keymap_bindings/keymap_context`。只读盘点已确认 Lime RuntimeKeymap 当前只有
transcript/agents/list，core TuiKeymap 尚无 editor/Vim contexts；不能先加无 consumer 配置。
按既有 core config -> App Server config read -> TUI runtime snapshot -> TextArea/composer 的
唯一配置链同步字段、同义类型/目录、冲突验证、unbind 与 resolved-action replay，补 public
config、键位定向回归和真实 PTY，不复用硬编码按键写第二套 keymap。linewise register/paste、
跨 thread Vim history lifetime、byte-anchored scan 与完整 ChatWidget routing 仍明确 defer。

### 当前续跑：asynchronous persistent history（terminal acceptance completed；整体 partial）

上一 goal turn 判为 progress：迁移 history search owner/UI、修复真实 App 吞 Paste，
完整 11 场景 PTY/CLI/core gates 通过；本轮不是重复验证，直接替换仅搜索已加载页的限制。
唯一持久化 owner 仍为 App Server PromptHistoryStore；TUI history 只持有 metadata、
query-independent cache、local rich entries、navigation/search pending state。
来源 Codex `c248f6d48b`：`chat_composer_history{.rs,/search_batch.rs}`、`app_event{.rs,_sender.rs}`
与其响应/批量错误/唯一结果测试。`search_batch.rs` SHA-256
`58dec92445cd736fc458ea8015912e1f579c4551d8ce88c2a8760fdb246dca94`，
`app_event.rs` `d14dc7bb2ae06212574442cdc5f9bf5341e7e00662aa90b644fc0297a2de63a9`，
`app_event_sender.rs` `72bd0fdb019f2b53ed9919199b0ffeef28a3f9308aad8bee4feb1e9906b22eb4`。
metadata/local_history/fetched_history/history_cursor、LookupMessageHistoryEntry/Batch、
HistoryEntryResponse、Pending/Unavailable、on_entry_response/on_batch_response/on_batch_error
为 direct 语义迁入；App Server cursor/read lowering、String identity、小模块拆分与五语言为 merge。
不复制 Codex 私有 history 文件/byte cursor，不新增公开 method、平行存储或 compat 包装。

窄写集：`tui/src/{app_event,app_event_sender}.rs`、`app/message_history*.rs`、
`chat_composer_history{.rs,/**}`、`chat_composer/{history,history_search,draft}.rs` 与 sender 接线、
`app/startup.rs`、`app_server_session` history read 边界、locale composer、既有 runtime 的 channel
初始化/select 委托、独立回归、既有 PTY/guard/inventory、architecture/commands/本计划。
`runtime.rs` 已超过 1000 行，本轮只加 channel/select 委托，不在该文件追加 lookup/cache/retry
业务；新逻辑迁到 app/message_history，后续退出条件仍为拆出既有巨型 event loop/action dispatch。
App Server store 追加 row-bounded paging 与 malformed row/cursor public 回归：防空/坏行让
一次 read 穿透整个 offset 空间；schema/method 不变，GUI gateway 已检查支持 empty page + cursor。
不修改其它 GUI/Electron/发布热区；既有脏目标均是前序本任务延续，Codex 只读。
退出条件：1) 单 entry 探测后批量读取，能搜索超过 200 条的历史；2) query-independent cache、
唯一结果/Newer/边界；3) stale thread/log/cursor 响应、取消/改 query/输入后迟到回包不覆盖草稿；4) bounded retry/Unavailable 不冒充 NoMatch，慢读不阻塞输入；5) 定向/crate/Clippy/public
JSON-RPC 与真实 PTY/current stdio 证据。local 全量进程 `78941` 已在 59/120 失败：
`src/lib/governance/codexModelResponsesPolicyOrigin.test.ts:130` 的外部 Codex client source-string
断言不再匹配参考 HEAD，未命中 composer 写集。1–58 批通过，保留
`.lime/test/vitest-smart-last-run.json` 续跑点，不重启全量或放宽断言。
byte-anchored disk scan、replay-seeded history 与完整 thread routing 仍单列 defer。

当前实现：metadata + local rich history + fetched offset cache 直接替换旧 entries/200 上限，
`load_history/set_persistent_entries/navigation_index` 为 dead / 原位删除，无 compat alias。
完整 cache setter 仅 `#[cfg(test)]`；同名 AppEvent/AppEventSender 接入真实 runtime select，
request/reply/cache/retry 业务在 app/message_history 与 search_batch，不追加进 runtime 巨型逻辑。
新增 EntryError 是 App Server IO 错误与 malformed row 的明确区分；五语言 Searching/
Unavailable 可见反馈为 merge，不把失败映射成 NoMatch。App Server paging 按 offset 行窗口
推进，GUI gateway 已补 empty page + nextCursor 行为回归。底层文件扫描仍由现有 store 完成，
尚未迁 byte-anchored scan，不宣称磁盘读取成本已 O(batch)。
真实 PTY complete fixture 种子为 360 条（含坏行、重复文本、最旧匹配）；额外使用 fs2
跨平台文件锁阻塞真实 App Server read，验证等待时仍能编辑 query、Esc 取消与输入草稿。
fs2 只新增为 TUI dev-dependency，复用 workspace 既有版本/锁文件，无新生产 IO 入口。
架构 owner/数据流已同步 architecture.md 与 commands.md，责任开发者 root，2026-10-01。
补充最小测试写集 `src/lib/governance/codexModelResponsesPolicyOrigin.test.ts`：本地门禁第 59
批的旧 source-string 断言仍按历史签名读取 Codex。已只读核对 current `core/src/client.rs`：
header forwarding 迁到 `ModelClientSession::build_responses_options`，WS metadata 增加
include_internal 参数，formatter 改为接收完整 ModelInfo。直接重写 current 来源断言，
同时断言 ModelInfo flag 传递和 helper 的 exact header 分支；不删 assertion、不新增 skip、
不修改 Lime provider 或外部 Codex。不把格式/函数签名漂移误报成协议语义变化。
`ThreadHistoryEntryResponse/on_history_lookup_response/on_history_entry_response/
on_history_batch_response/on_history_batch_error/apply_history_batch_result` 已按同义直接迁名，
不保留本轮临时 MessageHistoryResponse/handle_history_response 名字。
当前定向 168 项、初轮 TUI 1363 library + 18 integration + 1 guard、47 项结构/fixture/gateway
回归与 contracts 通过；公共 JSON-RPC 2/2、owner all-target Clippy `--no-deps -D warnings`
通过（后续补了 empty terminal batch 与 cached-good-row 不被坏行覆盖两项，最终轮待接收）。
统一 integration wrapper 的 `--tests` 再次扩大成全 App Server 58 targets 的无关链接；
已停止本轮自启动的进程组 91158（exit 130）并保留日志，使用同一官方 resolver
`resolveRustyV8CargoEnv` + `cargo test -j 2 -p app-server --test prompt_history_jsonrpc` 精确验证。
第一次完整 PTY runner 含 52.51s test 编译，被既有 60s execFile 场景上限终止；没有放宽
timeout/断言，等待热缓存后重跑，不将只有 binary startup 的记录记为 Gate B pass。
裸 Cargo 依赖级 Clippy 命中未修改 agent-protocol 的 large_enum_variant/derivable_impls；
裸 App Server test 绕过仓库 rusty-v8 artifact resolver 而下载 404，保留失败记录，并转统一
test:rust wrapper/current Gate runner，不新增依赖抑制或改 vendor。

最终终端证据（2026-10-01）：history 定向 `170/170`，TUI `1365` library + `18` integration

- `1` dependency guard，current all-target owner Clippy `--no-deps -D warnings`，public
  prompt_history_jsonrpc `2/2`，store `2/2`，`49/49` structure/fixture/gateway/origin guards、
  contracts、定向 ESLint、governance legacy/scripts 与 diff check 通过。inventory 为 Codex
  `1048` + Lime `331` src 文件（只表示扫描覆盖，不是完成率）。
  真实完整 11 场景 PTY 最终通过：thread `01a0f5e6-742d-7a73-81c8-b585c1c8d7ff`、turn
  `turn_2167c6837ade471b9f683113a1b11041`；`history-search=ok persistent-history=ok`，并保持
  queue-edit、agents-overview、thread-draft、sticky-prompt、main-find、images、skill-mentions、
  structured-history、focus-palette、resize-reflow、reconnect 和 terminal=restored。
  热缓存 PTY 中间轮暴露原同步测试在旧预览仍可见时提前发送 Down；已明确先观察 Searching，
  再等待 AtBoundary 恢复 accept 后继续键盘操作，与 Codex pending 不跳过扫描的语义一致。
  无固定 sleep、测试合成终态、放宽 timeout 或降低断言。慢读文件锁和 360 条最旧匹配都经过
  真实 PTY -> stdio -> App Server promptHistory/read；前置 ledger 断言仍保证搜索/accept 不提交 turn。
  GUI smoke 重跑通过：`standalone-shell-01-20261001051325-50010`。前序
  smoke:agent-runtime-current-fixture 的 Electron screenshot timeout 已在本轮隔离重跑通过：
  unknown-item thread `01a0f5ed-2f2e-7b03-9242-bf727ab48688`，summary ok=true，
  screenshotCapture.mode=full-page、fallbackUsed=false、fullPageError=null。保留前序失败日志；
  没有把截图改为 optional、放宽时间或改 fixture assertion。聚合 session 16960 最终 exit 0，
  `[smoke:agent-runtime-current-fixture] 通过`，所有 current Electron fixture 场景闭环。
  同一 current binary 的 CLI Gate B 重跑通过：thread `01a0f5e9-616a-7fa3-8995-f5bd37af05d8`、
  turn `turn_6ca89d633ac542849da0def7cef5522d`，`jsonl=ok stdin=ok error-exit=1 completion=zsh`。
  本切片五项终端退出条件 `5/5（100%）`，整体不标记 complete。分类：metadata/cache/typed
  events/App Server paging/唯一搜索 owner 为 current；旧 eager vector/200-limit/load_history 与
  临时响应命名为 dead / 原位替换；无 compat/deprecated/alias。统一 request handle 与小模块
  分工体现 SRP/DRY，复用已有协议/storage 而不预建第二后端体现 KISS/YAGNI。
  前端全量已用 test:resume 从 59/120 继续至 120/120，session 17810 exit 0，state 的
  status=passed、failed_batch=null、120 个 batch 均 passed，日志
  `/tmp/lime-tui-async-history-frontend-resume.log`；未从第一批重启。第 59 批 current source
  签名守卫已定向/续跑通过。正式 renderer/node typecheck、check:protocol-types、docs:boundary
  final 链 exit 0，workspace fmt --check 与 diff --check 通过。本地聚合门禁尚未完整闭环，
  不能把局部门禁提升为 verify:local pass；current runtime fixture 重跑 session 16960 已最终通过，
  日志 `/tmp/lime-tui-async-history-runtime-fixture.log`，无待接续验证进程，不重复启动。

下一刀：Codex `textarea/vim_commands.rs::VimPersistentState/swap_vim_persistent_state` 与
`chat_composer/history_search_draft.rs::edit_stored_draft/draft_snapshot`。只读盘点已确认 Lime
当前 replace/reset 会清 pending/search/replace steps，history session 只保存 VimHistory，
尚无完整 command recording/repeat owner；必须先建立真实同义 owner/consumer，不能以保存
少数字段的空 snapshot 冒充完整 Vim 对齐。byte-anchored disk scan、replay-seeded history 与
ChatWidget/thread-owned lifecycle 仍单列 defer；继续沿本主线，不扩展 provider/GUI 业务写集。
本轮仍未运行 Windows/MSVC、Linux WSL/X11 或 live provider；fs2 的跨平台实现不冒充
对应平台的真实产品证据。没有提交、推送、建分支或重置。

### 紧接续跑：history search owner / unique traversal（terminal acceptance completed；整体 partial）

写集限定 `bottom_pane/chat_composer_history{.rs,/search*.rs}`、
`chat_composer/{history,history_search,paste_input,input}.rs` 及状态类型接线、独立回归与本计划。
来源同一 Codex HEAD：`chat_composer_history.rs` SHA-256
`781e1409025bf0af4f75a011b3ff8cbff407b514e5579c074e9faaf07efe7e4f`，
`chat_composer/history_search.rs` `63edae2331bc55ff0e466d6e4d47bf0938a644ff0d5e52e5b916aec5eacaa477`。
`HistorySearchDirection/HistorySearchResult`、`search/reset_search`、unique match cache 与
`HistorySearchSession/begin_history_search/update_history_search_query/apply_history_search_result`
迁同义 direct；小文件拆分、五语言 footer 和已加载历史接线为 merge。删除数组查找旧函数，
无 alias。异步 persistent batch/Pending/Unavailable 尚无本切片真实接线，继续 defer，
不预建空分支；启动只读一页仍 defer。本切片同步 `app/startup.rs` 现有读取边界：
明确请求服务端上限 100，newest-first page 正序化后交给 shell recall；不新建 history store。
退出条件：唯一文本结果/大小写保留、Older/Newer cache/边界、query restart/空 query、
rich preview/取消/接受及 crate/Clippy/真实 PTY。补 `reconnect.rs` 同一 cancel owner、
原 Vim undo/redo history 交接、既有 complete PTY 与对应 runner/guard 接线；
textarea Vim pending command/replace persistent state 和 background draft edits 仍 defer。
保留前序脏改动，Codex 只读；不扩大协议/GUI写集。
真实 PTY 首跑定位 App 搜索路由吞掉 Paste：composer 单测通过但查询粘贴没有到达 owner。
窄写集追加 `app/interaction.rs` 的既有 history mode event 分支与独立
`app/history_search_tests.rs`；明确转发 Paste 到同一 composer query，不绕过 App 入口。
UI 同步同义 `history_search_footer_line/history_search_cursor_pos/display_query`：query 独立着色、
Match 的 Enter accept/Esc cancel、NoMatch 的红色反馈、换行/Tab 可视标记与窄屏光标钳制。
写集追加既有 footer/locale composer 与独立行为回归；五语言覆盖，不新增 GUI 视觉规则。

最终终端证据（2026-10-01）：TUI `1347` library + `18` integration + `1` dependency guard、
all-target Clippy `-D warnings`、workspace fmt/diff 与 `45/45` 定向 structure/fixture/contract guards
通过；inventory 为 Codex `1048` + Lime `324` 个 src 文件（仅覆盖数量，不是完成率）。
真实完整 `11` 场景 PTY 通过：thread `01a0f5b0-74ea-74c2-9e1a-8e37b3b39902`、turn
`turn_11bb22e420c6462f9afcb0dfa3463378`，`history-search=ok skill-mentions=ok images=ok
structured-history=ok`，并覆盖 queue-edit、agents-overview、thread-draft、sticky-prompt、
main-find、focus、resize、reconnect 与 terminal restore。complete 场景从真实 App 入口验证
Ctrl-R/Paste、duplicate boundary、cached Newer、Enter 只接受不提交；终端预览断言和
ledger 无 turnStart 同时成立。第一次 PTY 定位吞 Paste 后已补 App event 回归；中间一次
启动屏幕等待无输出失败，最终清空构建竞争后完整同一 binary 重跑通过，不删除失败记录。
CLI Gate B 同时通过：thread `01a0f5b1-837c-7201-a35e-a385c1ed4eb3`、turn
`turn_1a3c93f61a4e4d3496bec27c05a8984f`，`jsonl=ok stdin=ok error-exit=1 completion=zsh`。
该 history owner/UI 切片五项终端退出条件 `5/5（100%）`；异步 batch、stale response、
完整 Vim persistent state/background edits 为 explicit defer，不计算进本切片成功。
分类：唯一 search/session/footer owner 为 current；旧 find_older/find_match/find_newer、
start_history_search/select_history_match 与 cursor_position 名字为 dead / 原位删除，
无 compat/deprecated/alias。Codex 同义接口直接迁名，小文件拆分和本仓库协议供给为 merge。
架构 owner/数据流已同步 architecture.md，责任开发者 root，2026-10-01。

### 前序续跑：structured skill mentions（terminal acceptance completed；产品门禁 partial）

唯一 owner 为 `ChatComposer` draft 的元素 ID → `ComposerMentionBinding`，对外以
`MentionBinding` 有序快照传递；submission lowering 在 `app/input_submission`，不再在
超大 `runtime.rs` 堆业务。来源仍为 `c248f6d48b`；textarea ID/snapshot、selected mention、
binding transfer 为 direct；canonical queue、五语言及本仓库小模块拆分为 merge。
upstream `textarea.rs` SHA-256 `28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50`，
`chat_composer/draft_state.rs` `4e5ec20000b59eb08cd64db634668147c9788faea5f098d1ee5b3a57a02051e1`，
`mention_codec.rs` `5325566e53898c24724da15b1130ab5a593a53ab7a7dea43a4f6c61b6e7cdae3`，
`chatwidget/input_submission.rs` `5d0485e9bd4f673425ea80d9735484fb3e194072cd02490d8951df03c1028888`，
`chatwidget/skills.rs` `202dcb48337a6c2c8f0a2a7e3e4ca98b555001dbc1a4ad281a02f97b43795953`。

窄写集：`tui/src/bottom_pane/{textarea*,chat_composer*,mod.rs}` 中 ID/mention 接线、
`tui/src/mention_codec*`、`tui/src/app/{input_submission*,skills*}`、`lib.rs`、runtime 的既有
submission/prompt-history 接线及迁出测试、现有 PTY skill 场景和结构守卫、architecture/本计划。
已有脏改动属于前序本任务，保留；Codex 只读，避让 App Server、协议、GUI、Electron 和发布。
退出条件：1) 原子选择/ID/重复名字/删除与 Vim undo；2) paste/external editor/draft/history
绑定恢复；3) bound path 优先、catalog refresh fail closed、合法 typed/linked mention 保留；4) submit/queue/transport failure/canonical queue edit 保留绑定；5) crate/Clippy/guard 与真实
PTY → stdio App Server → canonical cold read。没有对应 owner 的 app/plugin/task mention、
image detail 与 None placeholder lossless 恢复仍 defer，不假装全量 mention 对齐。

真实 PTY 追加冷读历史后发现 current blocker：`promptHistory/append` 声明/发送
`sessionId`，而 v2 ingress 禁止该字段，实际返回 `v2 requests must use threadId`。
本切片扩展窄写集为 protocol `v2/prompt_history.rs`、相应协议/公开 JSON-RPC 回归、
App Server `processor/prompt_history.rs` 和 `runtime/prompt_history.rs` 的已有字段接线、
TUI `app_server_session.rs`、schema fixtures/generated types、commands 与架构说明。
公共请求/返回直接替换为 `threadId`，不添加 ingress 例外、alias 或新 method；JSONL
内部仍使用 Codex 的 `session_id` 记录格式，但值由 canonical Thread ID 传入。
Renderer 的 EmptyState / Inputbar 两处 append 直接迁为 `threadId: sessionId`；现有 GUI
session 参数承接 canonical Thread ID（`agentRuntime/threadClient` 同一 lowering），不新建
映射。read entry 只消费正文，fixture 同步 threadId；typed append client 消费生成 Params，无裸 IPC/
mock append caller。两处大组件只改字段接线，不追加逻辑；Electron JSONL 转发、method/catalog
名称与白名单不变，只读核验。新增窄写集为这两处 callback、promptHistory fixture 和边界守卫。
大型 protocol tests 仅迁已有断言，不追加业务；新增 public integration 独立文件。
扩展门禁：protocol crate、App Server prompt-history public JSON-RPC、generated drift、
`test:contracts` 与同一 real PTY/cold-history evidence，未通过前不得标记本切片完成。

协议修复后的最终结果：protocol `133` library + `1` schema fixture、prompt-history store
`2/2`、公共 `prompt_history_jsonrpc` `1/1`、generated drift 与 `test:contracts` 通过。
仓库 integration wrapper 带 `--tests`，实际扩大到 app-server 的 library/integration set，
`58` 个 target 共 `1947` 项通过、忽略 `0`；这不是本切片新增的运行入口。
真实全场景 PTY 的 skills 场景确认选定路径与
`10..24` 元素抵达同一 canonical UserMessage，且真实 append 后冷读历史包含 `threadId`
与路径 link；fixture 未补写历史伪造成功。前述 `5/5（100%）` terminal/core 退出条件闭环。
Renderer 两处 append、typed fixture、schema/client 与边界守卫均已迁 `threadId`；旧公开
sessionId 和 runtime 字符串猜测 skill 路径为 dead / 原位删除，无新兼容层。

跨 surface 门禁：`verify:gui-smoke` 通过，run
`standalone-shell-01-20261001040646-24401`；current fixture 原跑及复跑均在 unknown Item
Electron 场景的 `screenshotCaptured` 失败，具体为 `page.screenshot` 15000ms timeout。
GUI/read model 已观察到完成态，但截图缺失不能算该 fixture/Gate B 通过；未放宽断言。
failure evidence：`.lime/qc/gui-evidence/claw-chat-current-fixture/claw-chat-current-fixture-unknown-item-regression-summary.json`。
全仓 `tsc --noEmit` 退出 2，错误未命中本切片 EmptyState.tsx/useInputbarController.ts/
promptHistory 文件；generated diff 仅两个 sessionId→threadId 字段，不借机改其它类型错误。
不能据此声称全仓类型检查通过或所有外部错误均已证明为基线。`verify:local` 首跑在新
边界守卫的 `process` no-undef 失败，已显式导入 `node:process`，定向 lint 与 gateway 测试
复跑通过。官方 local 复跑的全 src lint、i18n/两处 GUI hardcoded scan 与正式
renderer/node typecheck 均已通过；上述 raw `tsc --noEmit` 包括额外测试夹具，不能将两者
混称同一门禁。local 现于前端 Vitest `3/120` 批次（执行 session `78941`，日志
`/tmp/lime-tui-history-owner-local-final.log`）；后续先收该进程，失败/中断则按
`.lime/test/vitest-smart-last-run.json` 使用 `test:resume`，不得重开全量。尚未运行至 local 的
Rust/GUI 后置阶段，不能把整个 verify:local 写为 pass。Windows/MSVC、Linux WSL/X11、
live provider 未运行；fixture 为 test-only。
治理最终报告：零引用/分类漂移/边界违规均 `0`，scripts governance 通过。
总体保持 partial/in-progress，下一刀为异步 persistent history bounded search，再
submission trim/limits、完整 thread_routing/ChatWidget 与 Agent Center async refresh。

用户明确：对齐覆盖功能、UI/UX、函数/类型命名、文件目录、职责边界、设计模式与测试组织。
每个切片必须先读取 Codex 实现及测试，再记录 upstream → Lime current owner 与差异分类：
`direct` 为语义一致的直接迁入；`merge` 为同一语义接入 Lime canonical 主链或五语言；
`partial/defer` 必须列缺口、原因与退出条件。只统计同名符号/目录数量不能证明完成。

| 维度           | 退出条件                                                                          |
| -------------- | --------------------------------------------------------------------------------- |
| 功能/状态机    | 同一 Thread/Turn/Item，关键状态转移、取消/恢复/异常行为与 upstream 对应           |
| UI/UX          | 实际输入、布局、样式、快捷键、焦点、窄屏/换行有稳定 cell/真实 PTY 证据            |
| 函数/类型命名  | 同义 current 符号直接迁名并迁消费者；无旧 alias/wrapper，同名不同义不伪装         |
| 文件/目录      | 同职责优先同路径；因本仓库 800 行约束或 App Server 边界拆分时登记差异             |
| 设计模式/owner | 唯一状态 owner、snapshot transfer、projection/render 分离，无平行后端或字符串镜像 |
| 测试组织       | 独立转换单测、owner 集成、canonical fixture、真实 PTY 分层，不以静态守卫冒充行为  |

本轮窄写集：`diff_render{.rs,/**}`、`entry.rs`（仅废弃 Patch 着色分支）、
`runtime_pty_tests{.rs,/thread_input.rs}`、现有 Gate B runner/guard、结构 inventory 与本计划。
Codex 只读；保留前序本任务脏改动，不碰 Electron、GUI、发布、MCP/协议/runtime 热区。
`DiffRenderStyleContext` / `current_diff_render_style_context()` 直接迁同义符号，不加旧名兼容。
`diff_render/style.rs` / 独立测试是 800 行约束下的目录差异；syntax-theme scopes 仍 partial。
`ComposerDraft` 与 upstream 内部 snapshot 同义，保留；`thread_input.rs` 只承接草稿交接，
不伪称已具 Codex `thread_routing.rs` 的 channel/event/operation routing 职责。

## 本轮 UI/UX 完全对标约束（2026-09-30，继续）

### 当前续跑：inline local images / structured submission（2026-10-01）

状态：本输入/历史切片 completed；目标仍为完整 CLI/TUI 全维度对齐，不将本切片当总目标。
前一目标 turn 为 progress：已落地 diff/草稿/单一 view 并取得真实全场景 PTY；本轮重新核对
工作树与 Codex checkout，下一刀直接替换上方 local-image rows 和 string-only submission。
来源为当前 Codex `bottom_pane/chat_composer{.rs,/attachment_state.rs}`、`textarea.rs`、
`bottom_pane/mod.rs`、`chatwidget/input_submission.rs` 与对应 inline tests。
current owner 为 ChatComposer/AttachmentState/TextArea，App/Runtime 只 lowering 到现有
`UserInput::Text { text, text_elements }` 和同一 App Server；不新增协议/持久化/平行 composer。
写集：`bottom_pane/chat_composer{.rs,/{attachment_state,draft,input,layout,render,pending_paste}.rs}`、
textarea elements、App input submission/action、runtime lowering、受影响回归、PTY fixture/guard、
architecture/inventory/本计划。旧 accessor/独立本地附件 rows 直接迁移，不加 alias。
退出条件：cursor inline atomic attachment、删除/remote-first 重编号不改 literal 同名文本、
expand-paste 后 TextElement UTF-8 范围正确、submit/queue/failed transport/queued edit 保留附件、
Unit/TestBackend + 真实 PTY/current stdio request capture。structured history/mention 仍须继续，
不得仅靠图片 display 宣称全量 composer 对齐。

同一续跑追加结构化 local history：对照 Codex `bottom_pane/chat_composer_history.rs`，
以同名 `HistoryEntry` / `ChatComposerHistory` 替换 composer 内 `Vec<String>` 与散落导航状态。
本地提交、Ctrl-C、Up/Down 和 Ctrl-R 必须保留元素、图片与 pending paste，persistent history
仍消费现有 App Server `promptHistory/*`；不得新建日志/协议。mention codec、异步 batch search
仍为 partial，后续迁入真实协议消费者。追加写集为同名 history owner、现有 history/search/
completion 接线和行为回归；不把子集实现标成完整 upstream history 状态机。

来源锚点（Codex `c248f6d48b`，路径相对 `codex-rs/tui/src/`）：

| upstream path                                   | SHA-256                                                            | Lime current owner / 分类                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `bottom_pane/chat_composer/attachment_state.rs` | `bffdf490b368bb5d4d5f3ade87fa690d5de02554a80d066b3d7eba32e56f9330` | 同名 owner / merge（结构化恢复、增加编号时倒序迁名防碰撞）                            |
| `bottom_pane/chat_composer/paste_input.rs`      | `a129a32117af4b2f330bf1848dec7dc4480b679d83f2f289e8df9c5394bdcfbf` | 同名 owner / merge（真实路径解码与既有 paste burst）                                  |
| `bottom_pane/chat_composer_history.rs`          | `781e1409025bf0af4f75a011b3ff8cbff407b514e5579c074e9faaf07efe7e4f` | 同名 owner / merge（rich local 与现有 persistent text；async batch/mentions partial） |
| `bottom_pane/textarea.rs`                       | `28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50` | `textarea/elements.rs` / merge（800 行约束，原子迁名与 canonical ranges）             |
| `clipboard_paste.rs`                            | `e471c51dc13e93f353f216513725def37a4316838962b30e43c6dd3a143c770d` | 同名 owner / merge（共享既有 WSL helper，不重复路径实现）                             |
| `chatwidget/input_submission.rs`                | `5d0485e9bd4f673425ea80d9735484fb3e194072cd02490d8951df03c1028888` | `app/input_submission.rs` / merge（canonical queue/stdio，非第二后端）                |
| `bottom_pane/chat_composer.rs`                  | `3f9847e8188f57c0ad665b682f626c8ae9b9f1c5d1c03bf231b0d762f6645ef2` | `chat_composer/{draft,input,history,external_edit}.rs` / merge（800 行拆分）          |

命名/目录与模式：`LocalImageAttachment`、`AttachedImage`、`AttachmentState`、`HistoryEntry`、
`ChatComposerHistory`、`apply_external_edit`、`replace_element_payload` 和同名 attachment/history
路径承接对应 upstream 职责；不新增旧 accessor alias。`InputResult::{Submitted,Queued}` 与
`AppAction::{Submit,Queue}` 携带 TextElement，queue 的 runtime intent 仍由 canonical App Server
决定，不照搬 upstream 内存 pending action 队列。旧 local-image rows、string-only submission、
`take/restore_pending_images`、空 Backspace pop last image、旧 `Vec<String>` history 与附件不能
Ctrl-C 取消的分支为 dead / 原位删除；不新增 compat/deprecated。

本轮稳定验证覆盖 cursor inline、reordered delete、remote prefix 增删、9/10 编号长度变化、
literal 同名文本、UTF-8 paste rebasing、Vim Replace/undo/redo、offline delete、remote-only 空态、
failed transport restore、多 Text/skill prefix queue edit、external editor 和 structured recall。
真实 images/large-paste PTY 已通过：thread `01a0f554-bb18-75f2-af79-89de0508c5f1`、turn
`turn_5da7384bbf3d4d88bde3b66a5ab1a8e6`；images 证明实际第二张 PNG 字节抵达 runtime，
冷读同一 Thread/Turn/UserMessage 的 `sidecar://` 图片引用与 `15..25` 元素范围。
最终 current 工作树证据：TUI `1329` library + `18` integration + `1` dependency guard 通过；
TUI all-target Clippy `-D warnings`、workspace Rust fmt check/diff 和结构/fixture guards 均通过。
全 `10` 个真实 PTY 场景（含 images、large-paste）通过，thread
`01a0f55c-a99a-7f33-b9ce-9b358dbf2549`、turn `turn_ba7ada908714424b84b7f51916fc2c8d`，
同时覆盖 queue edit、Agent Center、跨线程草稿、sticky prompt、find、focus、resize、reconnect
和终端恢复。Provider 为 test-only external fixture，不是 live provider 或 Electron/Windows 证据。
治理报告：零引用候选 `0`、分类漂移 `0`、边界违规 `0`。没有协议/GUI bridge 改动，故不扩跑
`test:contracts`/`verify:gui-smoke`；Windows/MSVC 与 Linux WSL/X11 未实际运行，继续 platform-defer。
本切片退出条件 `5/5（100%）`；不改变总体 A3 partial 与完整对齐 in-progress 的判定。

剩余差异：MentionBinding/mention codec、None placeholder 元素所有权、image detail 恢复、
async bounded persistent search、submission trim/限制、完整 thread_routing/ChatWidget 与
Agent Center async refresh。无 lossless owner 的 queue mention/detail 继续 fail closed，不显示
虚假的可编辑入口。本轮 `shlex` 复用现有锁定版本，manifest/lock 一起同步。
`runtime.rs` 与历史大测试仍为前序大文件：本轮仅迁已有 action/lowering 接线，不加新业务分支；
退出条件为后续将 submission dispatch 和 scenario harness 拆到既有领域 owner。结构 guard
测试接近 1000 行，后续分离 composer 与 transcript guards，不继续堆叠聚合文件。
架构确认：`architecture.md` 已更新单一 structured input/history 数据流，责任开发者 root，
2026-10-01。整体继续 in-progress，不将本切片完成率当整体完成率。

紧接下一刀：将 Lime 自有 `expanded_text*` 名称和成员式展开逻辑直接替换为 Codex
`current_text_with_pending` / `expand_pending_pastes(text, elements, pending_pastes)`。
静态转换同一 owner 处理有序元素与 payload FIFO，外部编辑器、submission 与草稿测试迁消费者，
不留旧名 alias；以重复 placeholder 的消费顺序、literal 不替换、UTF-8 rebasing 与真实
images/large-paste PTY 验证。该命名/模式续跑 completed：`1331` library + `18` integration +
`1` dependency guard、TUI all-target Clippy `-D warnings`、workspace fmt check/diff 和
`44/44` TUI/CLI structure/fixture/binary guards 通过；inventory 为 Codex `1048` + Lime `315`
个 src 文件，覆盖数量不是整体完成度。新 `current_text_with_pending`/纯展开接口及 FIFO
算法均为 upstream 同义 direct；模块拆分与 Lime canonical 接线为 merge，没有旧名包装。
最新真实 images/large-paste PTY：thread `01a0f564-6301-7f21-9079-6c3d226d86e2`、turn
`turn_0663acbe10ff43bab0d4bedd888d9031`，`images=ok structured-history=ok`，另含 focus/
resize/reconnect/terminal restore。真实 CLI Gate B 同时通过：thread
`01a0f564-c04a-7d93-9ca5-4b27e05e8988`、turn `turn_bf43c3e454aa4edf945a9fee9d0aa239`，
`jsonl=ok stdin=ok error-exit=1 completion=zsh`；同一 current stdio App Server，非 live provider。
最终同一 current 二进制全 `10` 场景复跑通过：thread `01a0f565-8bab-7bd3-8e63-fbdc17c5c098`、
turn `turn_f5939e8eaf744bca88954f9fe02efe3c`，`images=ok structured-history=ok`，以及 queue-edit、
agents-overview、thread-draft、sticky-prompt、main-find、focus、resize、reconnect 和 terminal restore。
输入/历史切片 `5/5（100%）`；命名/展开续跑的同义接口、无 alias 全消费者迁移、FIFO/
literal/UTF-8 行为与真实 PTY 四项退出条件 `4/4（100%）`。
整体仍 partial/in-progress，下一刀为 structured mention binding 和 persistent history search，
再推进 thread_routing 与 Agent Center async refresh；不能用同名目录数替代完整功能/UX 验收。

用户已明确：CLI/TUI UI/UX 完全对标 Codex；Lime 不合理的实现直接重构、清理，不保留双轨。
验收基线是当前 checkout 的源文件及行为测试，不套用 Lime GUI 视觉语言，不以“近似布局”算完成。
全局退出条件需逐项覆盖启动/会话切换、composer/快捷提示、transcript/活动收纳、picker/审批/
提问、Agent Center、完成/断线反馈与真实 PTY；当前仍为 in-progress，不宣称整体 100%。

本切片：Agent Center 标签页、任务列、项目/状态分组、分页、独立 metadata 输入、帮助与
当前默认键位。写集为 `tui/src/app/agents_overview_{view,render}.rs`、
`tui/src/app/agent_center/**`、`tui/src/app/agents_overview_grouping.rs`、
`tui/src/app/agent_center_tests.rs`、`tui/src/locale{.rs,/agents.rs}`、
`tui/src/bottom_pane/{mod,selection_tabs}.rs`、`tui/src/keymap{.rs,/tests.rs}`、
`tui/src/style{.rs,/selection.rs}`、`tui/src/{terminal_palette,shortcut_help,lib,view}.rs`、
相关 interaction/PTY 测试、配置文档和结构 inventory。
已脏的目标文件是前轮本任务延续，保留其已有能力；避让 MCP、App Server protocol、Electron、
发布与未确认产物。测试先定向，再 crate、Clippy、结构守卫与真实 stdio/PTY Gate B。

来源分类（迁移前登记，均来自 `c248f6d48b`）：

| upstream path（`codex-rs/tui/src/`） | SHA-256                                                            | Lime owner / 分类                                                                           |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `app/agent_center/mod.rs`            | `a74d135dde5d46f6c3d310f8b0f69e0e7c72ccc96e9f5028439aa7e5e63e1c1f` | 同名 module / merge                                                                         |
| `app/agent_center/input.rs`          | `1dac8d682dd52853fc509184a1948c6a5e76549b072fccf56ef603b14006d799` | 同名 module / merge                                                                         |
| `app/agent_center/navigation.rs`     | `d8010d701e4ad94de361cd8f2efc4e3f4ef2376bd2978ec044110143effc39c3` | 同名 module / direct                                                                        |
| `app/agent_center/render.rs`         | `11e7a550e1b45f918fefc9eb1d8937c6a2820f37025ff03bc3dca72b1e62d3bc` | 同名 module / merge（五语言）                                                               |
| `app/agent_center/rows.rs`           | `f7fb88ad2283f56bbb683bb64a938e6f5745ba8973d4fdb4b57ebcb1659a819e` | 同名 module / merge（canonical Thread）                                                     |
| `app/agent_center/hints.rs`          | `e3dccc50fb82f7435d52ff61faf5b211e4a67ee0287e3cd61e85e2505f99830b` | 同名 module / merge（真实已接线 action）                                                    |
| `app/agents_overview_view.rs`        | `028d06577818ce9eff54bb53d4ceedbc5a5e82d539456cb79575e518a37d9453` | 同名 view / merge（metadata target、详情层级）                                              |
| `app/agents_overview_grouping.rs`    | `09aa241f2113c35595b8153ea58d85bc81d6f25e3413916b5db8b8c044356150` | 同名 module / merge；model 字段缺失则 defer                                                 |
| `bottom_pane/selection_tabs.rs`      | `d86fe96a64991911918cd80a0894e001970a41d2fc1928ade3e044444681ac6c` | 同名 module / direct（filled tab bar）                                                      |
| `style/contrast.rs`                  | `ab52727328eb91923eb6970218d49b24e9b71450950f13875317d4aae3daf589` | `style/selection.rs` / merge（已知 palette fill 与保守 fallback；全局 contrast 仍 partial） |
| `bottom_pane/picker_style.rs`        | `cfb19e947a9b4ec51d5f7b59d7d37f8c1bbe95f6aa3770fe10034cb90c3b9704` | `style/selection.rs` / merge（active tab）                                                  |
| `keymap.rs`                          | `af8edcd1afa0510da8ac596d4adfe082dabb9ac3d2dd2e9a5b97bed17dd3acd1` | TUI `keymap.rs` / merge（已接线 task 默认键位）                                             |

补充来源：`shortcut_help.rs`（SHA-256
`c8b2e88684a6e4bbe7b9cad262bb4cf5dada56c8136dc297f920618b1784c86b`）为本切片读取的
三/二/单列帮助算法，迁入同名 current owner；
surface 提供真实 bindings 和五语言 labels，不新增未接线动作。

- [x] 替换旧 summary/wrapped List renderer；同一分组行模型用于绘制和翻页。
- [x] 标签页、输入 suffix/cursor、rename target 和 refresh 保留状态稳定回归。
- [x] 默认键位及实际配置提示对齐，无旧键位作为 task action 的隐式 fallback。
- [x] 五语言、窄屏/宽屏、TestBackend 与真实 PTY 证据完成后登记结果。

本切片结果：上述 4 个退出条件完成 `4/4（100%）`，仅代表该核心交互切片；
Agent Center 全量及整体 CLI/TUI UI/UX 仍为 `partial / in-progress`，不可宣称完全对齐。

- **current**：同名 `agent_center/{input,navigation,render,rows,hints,mod}.rs`、
  `agents_overview_grouping.rs`、filled tabs 和 `shortcut_help.rs`；view 仅保留 canonical metadata
  的交互状态，生产视图主体从 806 行降至约 290 行，原测试迁至 `agent_center_tests.rs`。
- **deleted（原位替换）**：旧四项 summary、wrapped List/SelectionRow 渲染、冗余 current badge、
  长串硬编码 footer、未使用的手动 Refresh action 和旧 Ctrl task defaults；无新增 compat/deprecated
  双轨。原 render 文件只承接唯一 read-only details owner。
- **稳定回归**：状态 tabs 与宽屏 columns、分组/翻页、narrow active-tab retention、100K CJK
  metadata suffix/cursor、emoji grapheme 删除、刷新后 rename target 固定、无搜索结果不下溢、
  自定义/解绑 task hints、BackTab normalization、help footer 护栏、三/二/单列帮助、五语言。
- **Rust**：`cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui --tests --quiet`
  通过（1138 library + 18 integration + 1 dependency regression）；
  `cargo clippy --locked --manifest-path lime-rs/Cargo.toml -p tui --lib --no-deps -- -D warnings`
  通过；workspace fmt check、`git diff --check` 通过。
- **结构/fixture guard**：重生成 `inventory:tui-structure`；TUI structure 与 Gate B script guard
  共 `20/20` 通过。更新 guard 的旧 Ctrl 键位与旧行文案断言，不把 source guard 当交互证据。
- **TUI Gate B**：最新 `npm run smoke:tui-gate-b` 通过；thread
  `01a0f200-0dfd-7ab1-8b46-b058902d060f`，turn `turn_7788234182bd48af9f4cb99f3551bacd`。
  Agent Center 经真实 PTY 的 `n -> Working filter -> r -> x -> f -> resume`；queue-edit、
  sticky-prompt、main-find、focus-palette、resize-reflow、reconnect 与 terminal restore 同时通过。
  链路为真实 `lime -> stdio -> App Server JSON-RPC -> RuntimeCore -> canonical projection`；
  provider 为 test-only external fixture，非 live provider 或 Desktop/Windows/X11 证据。
- **未运行**：本切片没有修改协议、Electron 或 GUI bridge，因此未扩跑 `test:contracts`、
  `verify:gui-smoke`；Windows 与真实 X11 PRIMARY 仍 platform-defer。App Server 的
  `lower_turn_start_params`/`lower_runtime_options` 既有 warning 未夹写。
- **架构确认**：本轮仅拆分终端 interaction/render owner，不新增 runtime、Thread model、
  history store 或 transport。责任开发者 root，2026-09-30。

下一刀：按当前 Codex `bottom_pane/{footer,shortcut_overlay,composer_gap}.rs` 与
`chatwidget/*` 重构输入区/快捷提示和状态层级；再推进 startup/session handoff、completion footer、
activity disclosure、picker/审批/提问的逐场景 UI/UX 验收，不能用目录覆盖数替代行为完成度。

### 继续：composer footer / shortcut overlay（2026-09-30）

状态：本切片 completed；整体仍 in-progress / partial。唯一 current owner 为 TUI composer presentation，不改变 canonical runtime。
来源仍为 `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`：

| upstream path（`codex-rs/tui/src/`）        | SHA-256                                                            | 分类                              |
| ------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| `bottom_pane/footer.rs`                     | `101110f738896098133ea1d7c951356a2c3d21584ace96f6e796cad7fa88da62` | merge（五语言、已接线 context）   |
| `bottom_pane/shortcut_overlay.rs`           | `699e792f440308f758bfff89c455bd23fdfa65ae5e32e388358c8b59b4abdb40` | merge（只显示真实 action）        |
| `bottom_pane/chat_composer/footer_state.rs` | `c9874a5fee151511451af6a0cfb558a889260b7beacf96519169224cde0e2c76` | merge（唯一 composer state）      |
| `bottom_pane/composer_gap.rs`               | `b8ac95d8d23554d5e4b5d6faf62e86d3d94b02fceb15df1f91ed799854b987c7` | read-only 对照，后续逐场景迁移    |
| `chatwidget/settings.rs`                    | `e60f468c3f5d266bd0f9885a11174bf30be80f0ad04b0b1fa450d122b779d22f` | read-only mode indicator 生效条件 |

窄写集：`bottom_pane/{footer,shortcut_overlay,shortcut_overlay_tests,mod}.rs`、
`bottom_pane/chat_composer{.rs,/footer_state.rs,/footer_state_tests.rs}`、
`locale{.rs,/shortcuts.rs}`、`keymap.rs`（仅真实 bindings hint）、`view.rs`（仅 layout 接线）、
专用 render/interaction 回归、现有 PTY fixture 与结构 inventory/guard、本计划。
避让 MCP、App Server protocol/runtime、Electron、发布及未确认产物；已有 TUI 改动为本任务延续。

- [x] 删除 idle draft-ready、运行中 turn ID footer；保留 canonical status owner。
- [x] Plan mode 左侧层级与 responsive collapse 对齐；passive agent label、queue hint 接线回归。
- [x] 空输入 `?`/`Shift+?` 打开真实快捷键参考；Esc 关闭不触发 interrupt；输入/paste 恢复编辑。
- [x] 快捷键参考三/二/单列，测量/绘制共用，clipped area 保留 close hint；五语言与真实 keymap。
- [x] 定向测试、TUI crate、Clippy/fmt/结构 guard 和真实 PTY Gate B；登记证据后继续下一刀。

尚无 current contract 的 statusline、account/usage、voice、edit-last-message 不伪造入口或提示；
本轮没有协议/GUI bridge 改动，不扩大为 contracts/GUI smoke。

第一轮证据（仍继续实现，不代表整体完成）：TUI `1151` library + `18` integration +
`1` dependency regression、TUI Clippy `-D warnings`、fmt/diff、结构/PTY guard `20/20` 通过。
真实 `smoke:tui-gate-b` 通过，thread `01a0f28a-9149-73e2-814b-f1b13a380245`、turn
`turn_edd8d5f4460f419a8a213ec4d4ea6ffb`；新增 `? -> Keyboard shortcuts -> Esc -> composer`
经过真实 PTY；原 queue-edit、Agent Center、sticky-prompt、main-find、focus-palette、resize、
reconnect 和 terminal restore 均通过。Provider 为显式 external fixture，非 live/Windows/X11。

后续收口写集追加 `keymap/hints.rs`、`view/tests{.rs,/**}`，只搬迁已有测试和提示投影。
`view.rs` 从 2363 行收敛为约 484 行，各专用测试模块低于 800 行；keymap 主体退回 800 行以下。
未改变 render public boundary、状态机、持久化或 runtime 架构。`runtime_pty_tests.rs` 为 test-only
旧大文件，本轮只加 help 场景证据；退出条件为后续把 scenario drivers 拆出，而不堆产品逻辑。
无生产写入者的 `FooterFlash`/读取分支为 dead / 原位删除；已有真实 clipboard feedback
继续由 `TranscriptComposerGap` 与 frame scheduler 承接，不创建并行 toast owner。

### 下一切片：model picker 无边框底部列表（2026-09-30）

状态：本切片 completed；整体仍 in-progress / partial；来源 `c248f6d48b`。
`bottom_pane/list_selection_view.rs` SHA-256
`73496ffec9df5fed4ee75749e96bf27d29abdb6420f3cd9a25a8e51dd95d8880`、
`bottom_pane/picker_style.rs` SHA-256
`cfb19e947a9b4ec51d5f7b59d7d37f8c1bbe95f6aa3770fe10034cb90c3b9704`、
`chatwidget/tests/model_picker_tests.rs` SHA-256
`84008a9d5169cddb523dda0a4ca695b9e1c1defa2105c67e4c55bd00f2cd9c6b`。
行列宽算法另读取 `bottom_pane/selection_popup_common.rs` SHA-256
`dbd20b229188017b0a19f62748d26631d77498045f8940c4aecafc2765d647bc`，采用全行 name width、
两列间距与 description 最少 30% 的上游规则，不沿用旧固定 40% label 列。
分类 merge：current model catalog、provider identity、settings contract 不变；只迁移终端 presentation。

写集：`tui/src/model_picker{.rs,/render.rs,/render_tests.rs}`、`app/thread_settings.rs`（仅 current
model/provider 默认定位）、`locale{.rs,/pickers.rs}`、`view.rs`（picker 替换输入区，不再居中盖层）、
相关 view/render tests、现有结构/PTY guard 和本计划。model picker/thread_settings 当前无他人脏改动。

- [x] 无边框底部列表、标题/独立搜索行、编号/描述/当前与默认标识；footer 不溢出。
- [x] 以真实 model + provider 定位当前项；重名但未获 provider 事实时不猜测。
- [x] 渲染与测量共享 visual rows，长描述/窄宽/空筛选仍保留 selected row 与输入光标。
- [x] Unicode 查询删除、normalized paste、翻页/边界、五语言与稳定回归。
- [x] crate/Clippy/fmt/结构 guard + 真实 `/model` PTY open/cancel。

Codex model-family、account 产品文案、durable-default/session-only 和 advanced reasoning 二级选择
需要另行对齐 current contract；本轮不把仅模型选择伪称为“Model and Effort”全量完成。

验证中：footer 收口后 library `1150` + integration `18` + dependency `1` 通过，删除了仅测试
写入的 flash 占位回归；结构/PTY guard `21/21` 通过，Clippy/fmt/diff 通过。
真实 PTY 二次门禁因并行 Cargo build lock 而在测试进程启动阶段超时，未形成新增 active-help
证据；版本从 1.146.0 到 1.147.0 的无关发布改动与 MCP/App Server 并行校验均避让，等待共享
artifact lock 释放后串行重跑，不修改外部进程或发布写集。

最新收口证据（2026-09-30）：TUI library `1158`、integration `18`、dependency regression `1`
通过；model picker 定向 `14/14`、TUI Clippy `--lib --no-deps -D warnings`、fmt/diff 通过。
`visible_models` 收回 test-only helper，不加 dead-code 豁免。结构/PTY guard `21/21` 通过。
串行 `smoke:tui-gate-b` 已通过：thread `01a0f2a9-c3e1-75c0-b113-2011dbf1de8f`、turn
`turn_83472ea739ac4e5cbcd3fe49b379858e`，新增 `/model -> 无匹配 -> Esc` 与 active-help
关闭无 `turnCancel` 的 ledger 断言生效。Provider 为 external fixture，非 live / Desktop / Windows。
Footer 与 model picker 两个切片退出条件均完成 `5/5（100%）`，整体仍 partial，继续下一刀。
旧居中 model popup、draft-ready / turn-ID / dead flash 为 deleted；current catalog/settings/
clipboard-gap owner 不变，无新增 compat/deprecated。无协议或 GUI 变更，不扩大运行对应门禁。

### 继续：slash / file / skill suggestion rows（2026-09-30）

状态：in-progress。事实源仍为 current composer + App Server catalog/search，无业务后端变更。
来源 commit `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`：

| upstream path（`codex-rs/tui/src/`） | SHA-256                                                            | 分类                                                   |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `bottom_pane/command_popup.rs`       | `74ee51f219a9b9a8ef2c92ed2018e97d6cf801193522537faa449e40292ae1d0` | merge（真实 command catalog / 五语言）                 |
| `bottom_pane/file_search_popup.rs`   | `8d6bf186cc89fd36a6ea718dce39c930db1c55c6a4973d16fd98d29346c0d950` | merge（canonical search result identity）              |
| `bottom_pane/skill_popup.rs`         | `1aaea0b777667241dee222faa75ef49517e73d96554b12d8ebb0185685ba7d7f` | merge（skills/list；未接线 App/Plugin mention 不伪造） |
| `bottom_pane/picker_rows.rs`         | `893e4a141b91f53c17d35d41c1b5cc4c9c73127e6a80a5506452d95731246e13` | merge（共享 single-line 行、上下溢出提示）             |
| `bottom_pane/scroll_state.rs`        | `284500ee9149e2269a091b142b9c552f61ef84abf29273fcf7cd2bba4a184461` | merge（只迁有消费者的 navigation）                     |

另复用已登记 `selection_popup_common.rs`、`picker_style.rs` 的全行列宽/selection fill/visual rows
算法；Unicode match indices 参考 `codex-rs/utils/fuzzy-match/src/lib.rs`。
窄写集：`bottom_pane/{command_popup,selection_row_layout,scroll_state,selection_popup_common,picker_rows,mod}.rs`、
`bottom_pane/chat_composer/{file_search_popup,skill_popup}.rs`、私有 fuzzy helper、`locale/pickers.rs`、
独立 render 回归、既有 PTY fixture/guard、结构 inventory 和本计划；view 接线保持 overlay 语义。
避让 protocol/runtime/MCP、Electron、发布；只替换原 presentation，不保留旧绘制分支。

- [x] Slash description 统一列宽和 wrapped rows，filter 改变重置 selection/scroll。
- [x] 文件长路径保留可区分 filename，display query / pending query 分离，插入保留原 path。
- [x] 技能完整匹配列表与选中项滚动窗口、窄屏 tag、真实 insert/close hint。
- [x] 共享 filled selection / overflow hints / Unicode match indices，五语言与 TestBackend 回归。
- [x] 定向/crate/Clippy/fmt、结构守卫和真实 PTY suggestion open/navigate/complete/cancel。

本切片完成 `5/5（100%）`，整体仍 partial。current 为共享 `scroll_state`、`picker_rows`、
`selection_popup_common` 和既有 composer popup owner；旧单行 slash 截断、技能无窗口绘制、
ASCII-only fuzzy_score 与三个重复选中样式分支原位删除，无新增 compat/deprecated。
Unicode helper 为终端私有 projection，不新增依赖；来源 fuzzy-match SHA-256
`dc8adaf8bb46166721d98315a1bd986419050faf44d4427ca6e8cf3e4996808b`。
定向 bottom pane `262/262`；完整 TUI library `1177` + integration `18` + dependency `1`、
Clippy `--lib --no-deps -D warnings`、fmt/diff 通过；结构/PTY guard `22/22` 通过。
真实 Gate B thread `01a0f2cd-e400-7331-b152-cf33fca23f3e`、turn
`turn_a95b425877a74acf8ddf2248ed5a2a3c`：slash wrap/cancel、真实 fuzzyFileSearch 的长目录两文件
选择与原路径插入、skills/list 的 10 项目录技能滚动/Tab 插入均通过；补全期间无 `turnStart`。
首次 PTY driver 误把 `@p` 中间画面当最终结果，已改为等待完整 query 和选中 filename 的业务
predicate，保留 production 的 pending/display-query 语义，不用 sleep 等待稳定。
测试-only driver 拆到 `runtime_pty_tests/suggestions.rs`，不继续向旧大文件堆场景逻辑。
Provider 为显式 external fixture；非 live/GUI/Desktop/Windows/X11 证据。

### 继续：approval presentation / fullscreen details（2026-09-30）

状态：本切片 completed；整体仍 in-progress / partial。唯一 current owner 为 BottomPane 中现有 ApprovalOverlay；不改响应决策、
权限范围或协议。当前缺陷是长 command/reason 的 header 会在固定 18 行 pane 中挤掉选中动作。
source commit 仍为 `c248f6d48b`；`bottom_pane/approval_overlay.rs` SHA-256
`feedfa0d4fa8df15355bd36e32e28f3d7086bdc7eb81cc357ae03ad19a4622f5`、
`bottom_pane/selection_picker_layout.rs` SHA-256
`69ccd3130c36bf5a64e75f5ececd9db0c07576b8cf0a9998690e542c07649a2c`，另复用已登记
`list_selection_view.rs` 的 borderless/header elision 和选中行优先布局。
upstream `Approval.open_fullscreen` 默认 Ctrl+A / Ctrl+Shift+A，App event dispatch 打开静态
详情 pager，不做审批；Lime 复用 current PagerOverlay，不复制 runtime 或决策状态。
窄写集：`bottom_pane/{render,mod}.rs`、`bottom_pane/approval_render{.rs,_tests.rs}`、
`app/interaction.rs`（protected key 路由）、`locale/pickers.rs`、专用 view / PTY 回归与本计划。
这些 approval render 目标文件无他人脏改动；避让 protocol/runtime/MCP/发布/Electron。

- [x] 审批无边框、共享 selection fill；长 header 不遮挡当前可操作选项。
- [x] header elision + 真实 Ctrl+A 全文查看；关闭详情不审批、不丢 request/selection/draft。
- [x] 五语言、长命令、窄/短终端、decision identity 和保护输入回归。
- [x] 定向/crate/Clippy/fmt、结构守卫、真实 PTY approval details open/close/approve。

没有 current file-change diff 的字段不伪造 patch diff；当前只展示已有 grant-root/reason，
完整 patch-review 和 request-user-input surface 仍待后续逐合同收敛。

审批最新定向 `18/18`、完整 TUI library `1183` + integration `18` + dependency `1` 通过。
`app/event_dispatch.rs` 的只读 pager 接线 SHA-256
`bad9e35ed2f4d758dac1524e940564e1e302c95f5688297aaa9a71868ce053e7`。
真实 approval/failure 门禁通过，thread `01a0f2e2-c478-7083-a42c-f62fc7b78cab`、turn
`turn_19a814aa384a4f77b7a9885a2bed6773`；全场景首次失败停在 failure 的未提交草稿，
重跑定位为测试 typed bytes 被调度合并到 paste burst 的风险。PTY driver 在提交前发送真实
Ctrl+E 清空 paste window 并等待完整可见 draft，不改生产粘贴保护，不以固定 sleep 修复。
完整门禁后续通过，thread `01a0f2e6-b051-7932-87f7-ce0cb03817aa`、turn
`turn_91ae388f914640048fd5adb19fec6f3a`。审批切片 `4/4（100%）`；旧 bordered approval
分支原位删除，current 决策 owner 不变，没有 compat/deprecated 双轨；不是 GUI、live provider
或 Windows 证据。

### 继续：request-user-input menu / notes layout（2026-09-30）

状态：本切片 completed；整体仍 in-progress / partial。唯一 current owner 仍为 BottomPane 的 RequestUserInputOverlay。
来源 commit `c248f6d48b`，`bottom_pane/request_user_input/`：

| upstream path     | SHA-256                                                            | 分类                                        |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `render.rs`       | `686ee905a854d8aa94d530597cdd695c93821e104b557c6995c8bf13ea5dc4c1` | merge（无边框 surface / 当前 footer owner） |
| `layout.rs`       | `9d9421974fdbaac4c7cbcead363deef458775da7b79ed542a3a64c3a62545900` | merge（question/options/notes 分区预算）    |
| `mod.rs`          | `62e490a792a9b5c112e55db9148a0bbf71e188b57da65531797b25334c275870` | read-only（option rows / question / notes） |
| `render_tests.rs` | `dbddd55329a52b09028f8b478f3e8882daf2f622c8e94ae82174db54fc039d3b` | merge（grapheme-safe truncation）           |

窄写集：`bottom_pane/request_user_input/{mod,render,render_tests,layout,tests}.rs`、
`bottom_pane/render.rs`（只迁移 UserInput 路由）、`selection_popup_common.rs`（共享 stack 布局参数）、
`locale{.rs,/pickers.rs}`（删除重复 add-notes 文案，补五语言 progress）、现有 view/PTY 回归、结构 inventory/guard
及本计划。只读 Codex；避让 MCP、协议/runtime、Electron 和发布。当前工作树已无未知脏改动。
业务响应、question navigation、Other、notes、secret masking、auto-resolution 不改合同。

- [x] 无边框 menu / progress / question / wrapped options，测量与绘制同源。
- [x] 长题干/短屏优先保留选中动作与编辑区；废弃文本猜测 option 行和单行截断。
- [x] 复用 TextArea 的渲染/滚动/cursor 与 secret mask，五语言与稳定回归。
- [x] 定向/crate/Clippy/fmt、结构守卫与真实 PTY option/notes/submit 证据。

本切片行为与真实 PTY 已通过，最后静态门禁复核中。current 为无边框的 request menu、
分区 layout、共享 stacked/wrapped selection rows 和既有 TextArea viewport；旧文本猜测
option 行、单行 ellipsis notes、手算 cursor、重复 add-notes 文案与 bordered UserInput
分支均原位删除，没有新增 compat/deprecated。原 `mod.rs` 1227 行拆出原测试到 `tests.rs`，
生产模块回到约 580 行，保留测试名与业务合同；新 render/layout/test 均小于 800 行。
定向 request-user-input `34/34`、完整 TUI library `1193` + integration `18` + dependency `1`
通过；结构/PTY guard `24/24`，workspace fmt/diff 通过。Clippy 首次发现只剩 MCP 的
single-pattern match，已直接简化为 if-let，不改变 MCP 行为，复核中。
真实完整 Gate B thread `01a0f2f5-6417-73a1-86ac-94e8ad76f53d`、turn
`turn_830b83a29fa74a4999c5634f1849ec83`：Down 选择 Safe，Tab 添加长备注并滚动显示尾部，
Esc 返回选择且无 actionRespond，再添加备注并 Enter；App Server backend 捕获的
canonical answer 为 `{ mode: ["Safe", "user_note: PTY_NOTE_ANSWER"] }`。审批全文、queue-edit、
Agent Center、sticky-prompt、find、focus、resize、reconnect 与 terminal restore 同时通过。
external backend/ledger 仅 test-only，无协议/依赖/runtime/GUI 变更，不冒充 live/Desktop/Windows。
最终 Clippy `--lib --no-deps -D warnings` 通过，本切片 `4/4（100%）`，整体不提升为完全对齐。

### 继续：resume picker 可操作布局 / selected row（2026-09-30）

状态：本切片 completed；整体仍 in-progress / partial。唯一 current owner 仍是 App Server thread/list、resume、archive 与 TUI picker。
source commit `c248f6d48b`：`resume_picker.rs` SHA-256
`c92d93de52b85a397bcf2b5dba3851ce336b7845303070123c378e7e33ab9ccd`，
`resume_picker/layout.rs` SHA-256
`fa5c14ca73b5cb2e6b827768055900cd01c7474252cbed48ccc8ebfce26d0ec0`。
已读取上游 layout、comfortable/dense selected row、overflow 与 responsive footer 源码及相关 tests。
merge：保留 canonical Thread 和 existing session host，不复制上游 local DB/history owner。
窄写集：`resume_picker{.rs,/{render,layout,host,tests}.rs,/tests/**}`、picker 专用 PTY 回归、
locale picker hints、既有 fixture/guard/inventory 及本计划；其它 runtime/protocol/发布保持只读。

- [x] 先拆分 2567 行聚合文件的 host/render/test，不在超大文件继续堆产品逻辑。
- [x] decorative chrome 优先收缩；短屏选中行保留，overflow 基于真实可见窗口。
- [x] current filled selection / expanded marker、五语言响应式主操作提示。
- [x] 定向/crate/Clippy/fmt/guard 与真实 PTY resume open/cancel；历史合同全量仍 partial。

本切片 `4/4（100%）`。root 从 2567 行收敛到约 735 行，host/render/layout/tests 各小于
800 行，测试名称保留；current thread/list/read/resume、archive owner 和 private state 不变。
旧 cyan/❯ 选中分支、固定 chrome 挤掉 list、根据 selected index 猜 overflow、查询被 toolbar
挤掉和裸英文 more 为 deleted / 原位替换。只定义但没有消费者的 standalone fork/resume
launcher wrapper 和其唯一 `AppServerSession::fork_thread` helper 为 dead / deleted，清掉原
正向结构断言并补负向回流守卫；运行中 `/fork` 使用原 runtime 的 request handle，不改协议。
窄写集追加 `app_server_session.rs` 仅删除无消费者 helper/import；不改 App Server boundary。
定向 resume `53/53` + 对应 integration `1`；完整 TUI library `1200` + integration `18` +
dependency `1`、Clippy `--lib --no-deps -D warnings`、workspace fmt/diff 全通过。
结构/PTY guards `25/25` 通过；治理报告边界违规 `0`、分类漂移 `0`、零引用候选 `0`。
真实完整 Gate B thread `01a0f309-cabc-7770-a8f9-c8cc8bd48427`、turn
`turn_8cf130bf6b28497e8b4b182bb69736c3`：从 completed canonical thread 打开真实 `/resume`，
thread/list 行与 Enter/Esc 可见，Esc 返回同一 transcript，期间 turnStart 仍仅 `1`。
全部原场景与 terminal restore 同时通过；仅 macOS stdio/PTY external test fixture。
未跑 GUI/live/Windows/X11，因为本轮不触达这些产品/平台。架构确认 root，2026-09-30：
仅拆分原终端 presentation/host，没有新 runtime、store、协议或持久化事实源。

下一刀：resume paging 仍固定 10 项，toolbar focus / configured list keymap 尚未全量迁移。
继续用上游实际 viewport 几何对齐 PageUp/PageDown；不能用本切片完成率替代整体 UI/UX 完成率。

### 继续：resume viewport paging / pending target（2026-10-01）

状态：本切片 completed；整体仍 in-progress / partial。同一 Codex hash，另读取 `update_viewport`、PageUp/PageDown handler、
`complete_pending_page_down` 与 `page_navigation_uses_view_rows` 测试。
窄写集为原 picker state/render/host、navigation/rendering tests 和现有 PTY driver；
`runtime.rs` 只在 page-load notification 分支接入 picker 的 pending predicate，不往旧聚合
runtime 添加分页业务逻辑。pending target 和几何仍归 picker，无协议/runtime 后端变化。

- [x] PageUp/PageDown 使用实际 list height，resize 立即更新，未绘制时保持上游 10 行默认。
- [x] PageDown 跨 App Server cursor 的 target 保留；逐页加载到目标或真实结束，不合成条目。
- [x] 其它导航/query mutation 清除 pending target；过期 page 不改变选择。
- [x] 定向/crate/Clippy/fmt/guard 与 PTY resize/page/close 验证；整体仍 partial。

本切片 `4/4（100%）`；current picker 的 viewport / pending target 承接翻页，固定十项主路径
原位替换，无 compat/deprecated。上游尚未绘制的 fallback 10 行不等于旧固定 paging 回流。
新增跨 cursor、真实结束、过期 page、搜索取消 target、加载中重复 PageDown 和 resize
几何回归；定向 resume `60/60` + integration `1`，完整 TUI library `1207` + integration `18`

- dependency `1`、Clippy `--lib --no-deps -D warnings`、fmt/diff、结构/PTY `25/25` 通过。
  真实完整 Gate B thread `01a0f315-adfd-7702-ae0c-ff29f3154e63`、turn
  `turn_ca4e887d16854e9a9c59693a1b218c7d`：resume PTY 从 24 行缩到 8 行，选中行与 Enter/Esc
  仍在可见区域，PageDown/PageUp 后恢复到 24 行并关闭，completed transcript 与 terminal
  restore 保持正确。跨 cursor 的 target 为 owner 状态转换回归；本场景仅有一个真实 canonical
  thread，不把 PTY 边界按键冒充多页真实历史分页 E2E。该多页合同仍需后续增加隔离 canonical
  thread fixtures。无 GUI/live/Windows/X11 证据。

### 继续：resume toolbar focus / arrow controls（2026-10-01）

状态：本切片 completed；同一 source/hash，已读取 `ToolbarControl`、Tab/BackTab、左右键 dispatch、
toolbar_for_width 和 default_filter_focus_arrows_reload_with_new_filter 测试。
窄写集为 picker `{input,render}.rs`、state 仅字段/接线、专用 toolbar tests、locale picker hints、
既有 PTY driver/guard/inventory 与本计划；只使用现有 ToggleFilter/Status/Sort App Server 主链。

- [x] 拆出 input owner；Tab/BackTab 只改变焦点，左右键切换真实对应 control。
- [x] focused control filled style，narrow fallback 优先保留焦点，不隐藏当前可操作项。
- [x] 五语言与默认 filter/status/sort、Fork 隐藏 status 的稳定回归。
- [x] 定向/crate/Clippy/fmt/guard 与真实 PTY toolbar 控制接线；配置化 list keymap 仍单独 partial。

本切片 `4/4（100%）`。Tab / BackTab / Shift+Tab 原位替换无效导航；真实左右键仍使用既有
ToggleFilter/Status/Sort consumer，无新 method/runtime/store/compat。无 cwd 候选时显示 All，
且 Filter 箭头不产生无效 reload；极窄宽度仅剩 ellipsis 时仍保留 focused style 的非 DIM 对比。
新增 7 项独立 toolbar 回归，定向 resume `67/67` + integration `1`，完整 TUI library `1214`

- integration `18` + dependency `1`、Clippy、workspace fmt/diff、结构/PTY guards `25/25` 通过。
  真实完整 Gate B thread `01a0f326-7cf1-7a40-93ba-b6904946ec7c`、turn
  `turn_95875d869e3141d0b009ac81c692d4c7`：目录 All/Current、状态 Archived/Active、排序 Created/Updated
  真实按键往返后 canonical row 恢复；resize/page/close 与全部原场景/终端恢复通过。
  证据为 macOS PTY/stdio external test fixture，非 GUI/live/Windows/X11；整体保持 partial。

### 继续：Model and Effort 嵌套选择（2026-10-01）

状态：本切片 completed；整体仍 partial。current model/list catalog 和 thread/settings/update 是唯一事实源。
同一 Codex source commit，`chatwidget/model_popups.rs` SHA-256
`a45aa40bc68c81550d7ef4d792028c38851340e7bf20a16409d2c160d9781583`；已读取
open_all_models_popup_with_view_id、open_reasoning_popup、advanced popup 与返回/高亮语义。
窄写集：`model_picker{.rs,/{render,effort,effort_tests}.rs}`、`app/{thread_settings,event_dispatch}.rs`、
五语言 picker labels、独立 picker/接线回归、PTY test/guard/inventory 与本计划。
只消费 existing catalog 的 supported/default reasoning effort；不按 provider/model 名猜测能力、
不复制账号 rate-limit/default-persistence/Plan scope 合同，不改 protocol/runtime/GUI。

- [x] 选择模型先进入 effort 子菜单，Esc 回模型列表并保留 query/highlight；单项直接选择。
- [x] current/default effort 定位，More reasoning 子层与五语言，无 hardcoded capability fallback。
- [x] 确认后用单次现有 settings request 同时写 model/provider/effort，取消不写配置。
- [x] 定向/full/Clippy/fmt/contract/guard 与真实 PTY/settings persistence 证据。

真实 Gate B 暴露并修复的接线缺口：settings 已把新 provider 持久化到 canonical metadata，但
v2 thread/read/list/resume 仍消费 immutable creation provider。追加窄写集
`app-server/src/processor/thread/projection{.rs,/{thread,tests}.rs}` 和既有
`tests/thread_control_jsonrpc.rs`。先从 1280 行 projection 拆出 thread projection，再让 read/list
filter/resume 复用 current durable settings 的 provider 解析；没有修改 rollout schema/immutable fields、
method/schema/持久化 owner。projection root 剩余大文件暂不加业务逻辑，退出条件为后续按 item/lowering
拆分到 800 行以内，不能借这次 helper 拆分继续堆叠。新增 provider filter/origin fallback 纯回归，
并增强 public JSON-RPC 冷恢复断言。架构确认 root，2026-10-01：仅修复既有 canonical metadata
到 v2 read model 的权威字段选择，没有新 runtime/store/transport。

最新完整真实 Gate B 通过：thread `01a0f346-8e45-7a11-a3ce-f66c78dd405f`、turn
`turn_905e0e8634804e2b99e814a43f00bba3`；catalog、effort、More reasoning、Esc 层级返回、
query/highlight 保留、High 最终确认与独立 stdio cold resume 均通过。原 canonical identity 和
单次 turnStart 保持，终端恢复成功。projection 定向 `24/24`、最新 contracts 全通过；完整
TUI `1222` library + `18` integration + `1` dependency、Clippy、workspace fmt/diff、结构/PTY
guards `26/26` 全通过。Rust layer integration 入口实际选择 App Server 全部 tests（含 library
与其它 integration），最终退出码 `0`，public settings 冷恢复回归随之通过。共享
`smoke:agent-runtime-current-fixture` 亦通过，包含真实 Electron fixture；liveProviderUsed=false。
该补充证明共享主链无回归，不代表 GUI 新增了嵌套模型选择器。切片 `4/4（100%）`；current
为唯一 catalog options、picker 与 current settings projection；旧创建 provider 投影原位替换，
无新增 compat/deprecated/store/transport，整体仍 partial。

### 继续：reasoning shortcuts / catalog authority（2026-10-01）

状态：本切片 completed；整体仍 partial。来源为同一 Codex HEAD 的 `chatwidget/reasoning_shortcuts.rs`，SHA-256
`eeb8d6ca8ff30a7dbc0d8bd3b130c4254ea9275978d835b09e19552db556daf0`；完整读取输入保护、
default/unsupported anchor、advertised order、advanced order、boundary 与 Ultra 显式选择语义及测试。
窄写集：`tui/src/model_catalog{.rs,/reasoning{.rs,_tests.rs}}`、`model_picker/effort.rs`（共享
catalog options）、`app/{reasoning_shortcuts,event_dispatch}.rs`、必要的 module 接线、
`settings.rs`（删除固定 EFFORTS）、`app/input_flow.rs`（popup pass-through 保护）、五语言 reasoning labels、专用输入/dispatch/PTY 回归、
现有 guard/inventory、commands 与本计划。不改协议、provider 能力、持久化 owner 或用户配置。

- [x] 唯一 model/provider identity 解析与共享 advertised/default options；歧义/缺失 fail closed。
- [x] 不循环的升降与 default anchor，Max/Ultra 后置，Raise Ultra 仅导航提示。
- [x] popup/modal、startup、parent-owned 输入保护；成功前不改变本地设置，五语言反馈。
- [x] 定向/full/Clippy/fmt/guard 与真实 PTY、stdio cold settings 验证。

Plan-only override 与全局默认分离必须由 existing server contract 证明：当前 collaboration update
同时写普通 durable reasoningEffort，不具备 Codex 独立 Plan override。该 scope 继续 contract-defer，
本刀遇到 Plan fail closed 并给出可见说明，不能把全局/普通设置变更伪装成 Plan-only。
普通快捷键只写当前 Thread settings，既不写全局 default，也不新增第二套配置状态。

本切片 `4/4（100%）`，不含明确 deferred 的 Plan scope / configurable chat bindings。
current 为 ModelCatalog 唯一 reasoning options/anchor 与 App shortcut owner；固定 EFFORTS/循环
逻辑、picker 重复 options/advanced 排序已原位删除，无 compat/deprecated。新回归抓到 Slash
popup pass-through 已在 input_flow 和 settings dispatch 两层保护；另统一修正失效 current
effort 的 picker 默认定位。新增纯状态/owner/输入/五语言回归 `16` 项，reasoning 定向 `31/31`
（最后 picker anchor 又新增 `1` 项）；最新完整 TUI `1238` library + `18` integration + `1`
dependency、Clippy、workspace fmt/diff 与 guards `27/27` 全通过，inventory `1319` files。
最新完整 Gate B thread `01a0f365-760f-7e60-851e-7a42f702f31e`、turn
`turn_4718b3029b3e41e88ff07e5ecc82abb9`：High→Medium→Low、最低边界不循环、
Low→Medium→High→Max、Raise Ultra 仅导航、status pager 拥有 Alt+,、回主面仍能正确降到 High，
独立 cold resume 保持 model/provider/High 与 canonical identity。所有原场景与终端恢复通过。
证据为 macOS PTY/stdio external test fixture，非 live/Windows/X11；共享 read model 的
App Server 公共 settings 定向复核 `1/1` 亦通过。

### 继续：resume configured list keymap / truthful hints（2026-10-01）

状态：此切片完成（100%）；全局 list consumers 仍 partial。同一 Codex source/hash，已读取 `ListAction/ListKeymap`、默认 bindings、
resume input priority/searchable plain text、pending page target 与配置化 footer/test。
窄写集：core `config/{tui_keymap,mod}.rs`（唯一配置 serde schema）、TUI `keymap{.rs,/list.rs}`、
resume `{input,render,host}.rs` 与 state 仅接线、runtime resume snapshot 接线、picker locale、
local-settings/配置/导航/渲染回归、现有 PTY fixture/guard、运维/CLI 配置文档及 inventory。
`list` 此切片的真实 consumer 仅 resume/fork picker；模型、Agent Center 和其它 selection surface
尚未接入该 context，明确记录为下一刀，不宣传全局 lists 已完成。没有第二配置文件、环境配置面或协议。

- [x] 十项 list action 从同一启动 config/read snapshot 解析，支持 alternatives/chord/unbind。
- [x] 输入/search priority 与 pending-page lifecycle 同源；旧 Ctrl+F filter / Ctrl+S status / Ctrl+R sort 删除。
- [x] footer 使用实际 bindings，不保留隐藏默认 fallback，五语言和窄屏关键动作可见。
- [x] schema/owner/crate/contract/guard 与真实 PTY config/read→picker 键位证据。

验证：resume `72`、keymap `17`、core config `4` 定向回归通过；公共 config/read + batchWrite
持久化 integration 通过，contracts（含 `299` typed client checks）通过。
与下一 Model consumer 合并后的 TUI library `1254/1254`、integration `18/18`、dependency `1/1`、
Clippy `--lib --no-deps -D warnings`、fmt/diff 与结构/PTY guard `27/27` 通过。
完整真实 PTY Gate B thread `01a0f38d-95d9-7330-a96d-960380743975`、turn
`turn_8479d89d81ed4cdeb44e135f3151c1aa`，证明 isolated config/read→F9/chord/paging→
canonical thread/resume 与 terminal restored；非 live provider，不证明 Windows/X11。
首轮构建锁超时、后续旧 model Esc fixture 失败均已纠正，最终串行完整 Gate B exit 0。

架构确认 root，2026-10-01：仅把 existing input/navigation 能力接到 current TuiConfig / RuntimeKeymap，
业务仍经唯一 App Server canonical thread/list/resume/archive owner；无新 runtime/store/transport。

事实缺口：模型分组/usage/live activity、worktree/new-task chooser 与 archive/hide/delete
需继续按 current owner 核对接线，不以 provider 名称冒充模型，不提前渲染无 consumer 的动作。

### 继续：Model/Effort configured list consumer（2026-10-01）

状态：此切片完成（100%）；其它 selection surfaces 仍 partial。只读对照同一 Codex HEAD 的 `bottom_pane/list_selection_view.rs`
`handle_key_event`、configured page/jump 回归和 `keymap.rs::ListKeymap`。
窄写集：TUI `model_picker{.rs,/input.rs,/keymap_tests.rs,/render.rs}`、app picker snapshot
接线、共用 ListKeymap searchable priority、动态五语言 footer、现有 PTY driver/guard、文档及 inventory。
不新增业务方法或配置 context；同一 config/read snapshot 继续是唯一键位事实源。

- [x] 模型搜索优先普通文本；effort 子层允许普通 j/k 导航，共用 chord/alternatives/unbind。
- [x] 模型和两级 effort 的 accept/cancel/page/jump 与实际键位一致，无 Ctrl+D/Enter/Esc 暗路。
- [x] 同源动态 footer 和窄屏回归，真实 PTY 使用 F9、Ctrl+X q 完成嵌套确认/返回。
- [x] owner/crate/Clippy/fmt/guard、完整真实 PTY 和 canonical 冷恢复验证。

验证：新增 six configured consumer 回归、ModelPicker 合计 `30/30`，完整测试与 Gate B
同上。真实 Ctrl+D→More reasoning、F9 嵌套确认、返回 chord、High durable settings/cold resume
通过；空结果移除硬编码 Esc 文案，8 列屏仍显示能容纳的实际 F9。旧 input/hints 原位替换，
分类 `dead/deleted`；新 snapshot consumer 为 `current`，没有 compat/deprecated 双轨。

架构确认 root，2026-10-01：只替换 input/hint consumer；Thread settings 经已有
thread/settings/update 持久化，provider/model/catalog/runtime/store/transport owner 不变。
Agent Center 与其它 selection surfaces 尚未迁移，不宣称全局 lists 已完成。

### 继续：Agent Center configured list consumer（2026-10-01）

状态：此切片完成（100%）；全局 list consumers 和 Agent Center 全量功能仍 partial。已读 Codex `app/agent_center/{input,hints}.rs`、
`agents_overview_view.rs::handle_key_event` 及 fixed-shortcut/configured-hint tests。
窄写集：TUI keymap agents/list dispatch、Agent Center state/input/hints 与 snapshot 接线、
独立行为回归、现有 PTY driver/guard、文档和 inventory；不改 backend/schema/config context。
真实 PTY 抓到 App-scoped refresh status 叠画在 center footer 的残影，写集扩至 view 的同一
render 接线和 Center notice geometry：只有 Center 渲染 notice 与 controls，窄屏优先完整可操作键。
扩大 `--all-targets --no-deps` Clippy 后，对前序 reasoning/clipboard 测试的 3 处表达式/initializer
做机械修复，旧 hints inline test 迁入独立 keymap_tests；不新增测试侧 production API。

- [x] 删除 Agent Center 硬编码列表导航/确认/返回，编辑与帮助均消费实际列表键位。
- [x] 单一 chord owner 支持 task/list 共用 prefix，任务优先；搜索/rename/new 输入防穿透。
- [x] footer/help 与可达键位同源，unbind/冲突/替代键和五语言稳定回归。
- [x] crate/Clippy/fmt/guard 与真实 Agent Center PTY 新建、rename、search-resume 键位证据。

验证：新增 `10` Agent Center regressions（含 task chord prefix 对 list single 的优先级、
notice/controls 不叠画和 8～24 列 complete actionable key），旧 hints test 原位迁移；完整 TUI
library `1264/1264`、integration `18/18`、dependency `1/1`、Clippy
`--all-targets --no-deps -D warnings`、workspace fmt/diff 和结构/PTY guards `28/28` 通过。
inventory `1326` files；治理报告边界违规/分类漂移/零引用候选均 `0`。
完整 PTY Gate B thread `01a0f4a0-abcf-7273-b935-d49d6d7db43b`、turn
`turn_d512e64ff2d04c9c9b3c3a7cb82bab51`，真实 F9 new/rename/search-resume、帮助页 chord 返回、
Ctrl+D/Ctrl+U、同一 canonical history、alternate screen 与 terminal restore 全通过。
首轮真实 PTY 的 footer overpaint 缺陷已修复，最终 exit 0；非 live provider，不证明 Windows。
`current` 为共用 snapshot/单一 matcher/Center-owned presentation；旧硬编码导航和 task-only
dispatch 为 `dead/deleted`，未新增 compat/deprecated。Notice 和窄屏 fitting 只治理当前 presentation，
Codex account/usage、worktree/archive/delete/new-task handoff/full snapshots 仍单独 partial。

架构确认 root，2026-10-01：只迁 terminal input/hint，canonical thread/list/start/name/set/
turn/cancel/resume owner 不变；没有第二 thread store、runtime 或生产 mock fallback。

### 继续：Subagents borderless selection / shared list presentation（2026-10-01）

状态：此选择器切片完成（100%）；整体仍 partial。已读同一 Codex HEAD 的 `app/session_lifecycle.rs::agent_picker_selection_view_params`、
`multi_agents.rs::agent_picker_status_dot_spans`、`bottom_pane/list_selection_view.rs` 和
`app/tests/session_lifecycle_requests.rs` 的 bottom-popup snapshot。
窄写集：共享 `bottom_pane/list_selection_view.rs` 纯布局、ModelPicker presentation 迁入共享 owner、
AgentPicker input/render 与 current/path/thread-id 投影、snapshot 接线、五语言、专用回归和既有 PTY fixture。
不改 thread lifecycle、catalog、permissions、store 或 transport，不建立第二子 Agent 后端。

- [x] Subagents 去除居中边框；底部 current/path/Thread id/status dot 与 Codex snapshot 同义。
- [x] 模型和子 Agent 复用唯一 visual-row/viewport/footer owner，page jump 与渲染共用实际行数。
- [x] Subagents 接同一 configured list snapshot，移除 Ctrl+D/Enter/Esc 硬编码分支并补五语言。
- [x] 定向/crate/Clippy/fmt/guard、真实 PTY open/cancel/current-root selection；多子 Agent handoff 单独追踪。

分类：共享 `ListSelectionView`、当前线程定位和真实 list snapshot 为 current；
旧 AgentPicker 居中边框/硬编码按键/在 composer 上叠画路径、无消费者的
`centered_popup` helper 与其旧正向测试原位删除，无 compat/deprecated 双轨。
模型及 Subagents 都由 screen_chunks 为 bottom input 分配实际高度，关闭后草稿/设置/线程保持。

验证：AgentPicker 定向 `11/11`、ModelPicker 相关 `31/31`；全 TUI library `1269/1269`、
integration `18/18`、dependency guard `1/1`、all-targets Clippy `-D warnings`、
workspace fmt/diff 通过；structure+PTY guard `29/29`（inventory `1329` files）。
真实 `smoke:tui-gate-b` 全场景通过，thread `01a0f4b1-fd71-7d43-9ac6-7ff963448ec6`、
turn `turn_52db8b89eef84ff8ad98345899e07091`；Subagents open/配置分页/chord cancel/F9
current-root accept 与 canonical transcript 恢复均通过，未新增 turn。其余 queue-edit、
Agent Center、sticky-prompt、main-find、focus-palette、resize-reflow、reconnect、终端恢复通过。
证据为 macOS 真实 PTY/stdio App Server + 显式 external test fixture，非 live provider/GUI/Windows/X11。
本轮无协议/schema/GUI bridge 改动，不扩跑 contracts/GUI smoke；App Server 既有两项 warning 未改。

架构确认 root，2026-10-01：仅把两个 terminal selector 的重复纯布局迁到 TUI bottom_pane owner，
业务仍是 App Server thread/resume + canonical projection。真实多子 Agent liveness/backfill/replay/parent-owned
handoff 合同不由本轮 root-only PTY 证据冒充完成。

### 继续：composer owner 重构与旧控制流清理（2026-10-01）

状态：此 owner/输入框切片完成（100%）；完整 composer 仍 partial。用户进一步明确旧 composer 必须重构/清理，不接受只改表面布局。
盘点：`chat_composer.rs` 1735 行，生产主体超过 1000 行；当前实际消费者仍是
App input -> ChatComposer -> TextArea，不能把唯一 current 输入 owner 整体判 dead。
下一刀先按 draft/input/history/completion 边界拆分，清理跨 popup 的旧 slash-only 命名，
文件/Skill completion 重复编辑流程，并把 pending file-search 生命周期收回唯一 popup owner。
写集：`bottom_pane/chat_composer{.rs,/**}`，实际 App/view/footer 消费者的机械迁移，
专用回归、structure inventory/guards 和本计划。避让 RuntimeCore、store、protocol、Electron、发布。
不增加第二 composer、不保留旧包装入口。退出条件：聚合文件/各新 owner <800 行；
输入/历史/附件/Vim/paste/三种 completion 行为回归、真实 PTY 和 terminal restore 全通过。
架构确认 root：仅 terminal interaction owner 重构；canonical runtime/Thread/Turn/Item 不变。

同切片追加真实输入框显示对齐，来源同一 Codex HEAD：
`chat_composer/composer_layout.rs` SHA-256 `02b1bf1abfd51672e8290283625d4e974bf3eb5007a0f175c7b4c058eeb7a6b7`；
`chat_composer.rs::render_with_options` SHA-256 `3f9847e8188f57c0ad665b682f626c8ae9b9f1c5d1c03bf231b0d762f6645ef2`。
view 不再持有第二 renderer；`ChatComposer::render` 统一填充 user-message 底色、上下各一行、
2 列 prompt gutter、1 列右边距、附件对齐/空行分隔、当前输入/选中图片的 cursor 语义。
clipped 屏优先保留 editable row；本地图片暂仍是独立附件行，Codex inline atomic image/paste
elements、完整 mentions/history payload 和 reasoning ignition 等继续 partial，不能用本轮几何验收冒充完成。

- [x] composer 聚合/各 owner <800；清掉旧错误命名与无消费者入口。
- [x] 文件/Skill completion 共用编辑 owner，pending search 清空后同 query 可重发，迟到结果不能串场。
- [x] 输入框底色/上下/左右 inset、附件间隔、Unicode/cursor/窄屏与五语言稳定回归。
- [x] crate/all-targets Clippy/fmt/guard 与真实 PTY 多行输入/三种 completion/选择器/terminal restore。

分类：ChatComposer 仍是唯一 current terminal 输入状态；主聚合 `1735 -> 88` 行，
draft/history/input/completion/render 各 `88–371` 行、原回归搬至 `tests.rs`（627 行）。
旧错误命名、文件/Skill 重复编辑与 view 内输入 renderer、零消费者 cursor_position 原位删除，
无 compat/deprecated 双轨。PopupState 唯一持有 file-search generation/pending query/catalog；
cancel 后重新打开同 query 会重发且迟到响应不能串入新 surface。

验证：TUI library `1279/1279`、integration `18/18`、dependency guard `1/1`、
all-targets Clippy `-D warnings`、workspace fmt/diff、结构/PTY guards `30/30`；
inventory `1338` files。真实全场景 `smoke:tui-gate-b` 通过，thread
`01a0f4c3-3fa0-7930-a382-660e9d78cb0d`，turn `turn_f0b5ef986a124aa9a470f951eeddaf64`。
首次 queue-edit helper 在旧 footer marker 已存在时提前断言 help 关闭；改为等待 footer 已恢复
且 overlay 不存在的真实 screen predicate，复跑通过，不加 sleep。多行 Unicode bracketed paste/
gutter/上下留白/Ctrl-C clear 不提交回合，三种 completion 与原所有场景/终端恢复通过。
证据限 macOS PTY + stdio App Server + 显式 external fixture；不证明 live provider、GUI、Windows/X11。

### 继续：显示强调色 / shared contrast（2026-10-01）

状态：本切片 completed（100%），整体仍 partial。已读当前 Codex `style{.rs,/contrast.rs,/contrast_tests.rs}`、`color.rs`。
下一刀替换旧 Cyan/light cyan RGB 和未经对比度筛选的 256 色文本匹配；selection、tab、
key hints 和 shared accent 共用唯一 contrast owner，尊重 ANSI/unknown terminal 的默认前景。
写集：TUI `style{.rs,/**}`、`terminal_palette.rs`（仅固定 palette lowering）、
`terminal_palette/perceptual.rs`、`transcript_view/follow_control{.rs,_tests.rs}`、
专用回归与 inventory/本计划。无协议、业务状态、GUI、runtime 或 store 改动。

- [x] 强调色改为 Codex dark `(99,168,248)` / light `(28,100,200)`；共享 contrast owner
      负责实际背景上的 4.5:1 文本对比度，ANSI16/unknown 保留 Reset。
- [x] 256 色 palette 用 CIE76；文本遍历满足对比度的固定色再选 perceptual nearest，
      不再最近色不足就直接黑白。唯一固定 palette catalog 不复制；512 项有界 cache
      按 preferred/background/level 分键，避免逐帧重复扫描和主题变更串色。
- [x] selection、active tab、key hint、secondary/footer 全部迁同一 owner，旧私有
      `readable_foreground`/ratio/luminance 已移除，不保留 compat。
- [x] follow control 接 shaded prompt 的实际 quantized 背景强调色；仅 hover 才 bold/reverse。
      remote image Cyan 仍为 Codex current，未进行无差别换色；local inline images 尚未对齐。
- [x] 定向、全量 TUI/Clippy、稳定渲染回归与真实 PTY Gate B 验收。

源文件 SHA-256（同一 `c248f6d48b` 基线）：`style.rs`
`ea425b86ed801ff73f3e6f3d1d3eb4f99b3820f9d8509f2d40da539021884f10`；
`style/contrast.rs` `ab52727328eb91923eb6970218d49b24e9b71450950f13875317d4aae3daf589`；
`color.rs` `fdb5acf38aff891574b59950f8ac78c6d41bd9b0a0c2f186ddf9f63169082412`。
定向 style `16/16` 已通过；首次链接因缓存 `.rlib` 缺失失败，窄重建协议 crate 后通过。

### 继续：长粘贴原子输入 / draft payload（2026-10-01）

状态：本切片 completed（100%），整体仍 partial。范围为 TUI textarea `elements`/`editing`/render/Vim/mouse、composer
paste/draft/submission/history/reconnect、locale 和 external editor 的 expanded draft 接线。
当前 textarea 的 `set_text_clearing_elements` 是空语义旧入口；改为真实原子范围，编辑与恢复
只消费同一 TextArea。原 1086 行 owner 先拆 editing 与 tests，不继续向巨型文件堆逻辑。
该切片必须证明 `>1000` 字符粘贴折叠、重复长度唯一编号、UTF-8 安全原子移动/删除、render
highlight、submit/queue 原文展开、Vim undo/redo/replace recovery、history/offline/editor 不丢 payload。
不新增协议或持久化；本地图片 inline 和 canonical structured history 仍为后续 partial。

来源：Codex `chat_composer/paste_input.rs` SHA-256
`a129a32117af4b2f330bf1848dec7dc4480b679d83f2f289e8df9c5394bdcfbf`、`textarea.rs`
`28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50`，均为 merge。

- [x] 超过 1000 个 Unicode 字符折叠；同长度活跃 paste 唯一编号，CRLF/CR 归一化。
- [x] TextArea 真正拥有原子范围，箭头/删除/范围替换/word kill/鼠标/Vim 编辑不能切碎。
      render 复用实际 wrap 区域并保留背景；沿用 Codex Cyan placeholder，不机械改色。
- [x] `ComposerDraft` 保留 pending paste 和有效元素；Vim undo/redo/Replace Backspace recovery、
      history-search cancel、临时 Up/Down recall 和 offline 编辑走同一快照。
- [x] 按登记范围一次性展开 submit/queue/Ctrl-C recall；literal 同名文字不扩展，
      外部编辑器及 string-only thread handoff 用展开原文。后者不会丢内容，但折叠形态尚不保留。
- [x] 粘贴到 history/Vim 搜索编辑 query，不生成输入占位符；paste-burst 不能回收已有元素尾部。
- [x] 五语言与稳定可见 label 回归；旧 TextArea 从 1086 行降至 667，Vim 从 867 降至 791，
      editing/elements/navigation 单一职责；无新增 compat/deprecated owner。
- [x] 真实 `large-paste` Gate B 场景及全部原场景完成。

当前验证：pending paste `9/9`、atomic elements `6/6`；TUI library `1304/1304`、integration
`18/18`、dependency guard `1/1`；all-targets Clippy `-D warnings`、fmt/diff、结构/PTY guards
`32/32` 通过。治理报告扫描成功，边界违规与分类漂移均为 0。inventory 暂为 `1350` files，
最终源码哈希需在 Gate 后刷新。架构 owner/data flow 已更新，责任开发者 root，2026-10-01。
默认 Gate B 构建遇本机 V8 `.a` 缓存缺失，未修改依赖/系统配置；复用晚于 App Server 源码的
`target/debug/app-server`（2026-10-01 08:41:14），显式 `APP_SERVER_BIN`，只重建本轮 current CLI。
真实全场景 Gate B 通过，thread `01a0f4ed-1038-78a3-8877-74b696da8114`、turn
`turn_0d19a04e416649f9880d6de51d131d0a`；新增 `large-paste` 与 complete/approval/user-input/
interrupt/failure/queue-edit/agents-overview、focus-palette/resize/reconnect、terminal restore 均通过。
long paste 原文由 external fixture ledger 的 `inputText` 完整相等验证，真实 stdio/App Server
canonical Thread/Turn/Item，不是 renderer mock。限 macOS + 非 live provider，不证明 GUI、Windows/X11。

### 继续：diff shaded rows / syntax contrast（2026-10-01）

状态：核心 shaded-row 切片 implemented / verified；全量 diff 仍 partial。已迁 Codex rich-color
的 light/dark add/delete 行底色、行号区底色与实际背景上的 syntax foreground；旧 delete `DIM`
已删除。原 1047 行文件的测试迁到 `diff_render/tests.rs`，样式落 `diff_render/style.rs`，
同一 parser/wrap/render owner 不复制；当前 root/style/tests/style_tests 为 539/111/547/320 行。
写集：TUI `diff_render{.rs,/**}`、shared `style.rs` 与专用回归、inventory/本计划。
真实 cell 回归发现 Paragraph 不会把 Line 背景延伸到右侧留白，追加窄写集
`terminal_hyperlinks/paragraph.rs`：同一 wrap/scroll 几何先铺行底色，再由 span 覆盖 gutter，
不改正文、不补空格、不复制 renderer。PTY fixture 追加 canonical file item 的 diff-display 场景。
当前固定 ANSI syntax theme 不具备可配置 diff scope background，保留明确 partial，不伪造迁入。

来源 `codex-rs/tui/src/diff_render.rs` SHA-256
`ab0ef70e507a0c61d7df264a087e83aa98c9cc9d7ad582c812477f701d6ab5c3`。
`DiffRenderStyleContext` 与 `current_diff_render_style_context()` 按同义 snapshot 直接迁名，
所有消费者已迁移，不加旧 `DiffStyleContext` alias。`entry::format_line` 的三条旧 Patch
着色分支无真实消费者，原位删除；diff 只经 `diff_render`，先扣消息 prefix 宽度防二次折行。
共享 `readable_color_on` 使用同一 palette 快照；syntax contrast 不复制算法、不逐 span 查询终端。
Unit diff `42/42`、paragraph cell 回归 `2/2` 已通过，真实 diff-display thread
`01a0f50c-903e-7cf1-a047-759d6f630956`、turn `turn_1f26b8f965fc42b3bb9487ddca17c155`
证明 canonical file Item 的 sign/body/continuation/padding 实际底色且无 DIM。
core 的单次 snapshot、rich fill/gutter、contrast lowering、single render path、Unit+PTY 五项
退出条件完成 `5/5（100%）`；可配置 theme scopes 与 Windows Terminal promotion 仍 defer，
不能据此宣称全量 diff 或整体 UI/UX 完成。

### 继续：跨线程结构化输入草稿（2026-10-01）

状态：核心草稿交接切片 implemented / verified。对齐 Codex
`chatwidget/user_messages::ThreadComposerState` 的内存恢复语义，
不扩展 App Server/persistent history 合同。写集：`app{.rs,/thread_input.rs,/agents_overview.rs,/session_lifecycle.rs}`、
既有 `ComposerDraft` 可见性与跨线程回归、architecture/guards/inventory/本计划。
`App::thread_input_states` 直接保存 composer 唯一快照；恢复后移除休眠副本，由 active composer
继续持有；成功 `thread/resume` 后、hydrate 前统一捕获原线程，因此不依赖先打开 Agent Center。
删除 Agent Center `input_states` 纯字符串镜像与 fallback；它没有独立生产消费者。
退出条件：折叠粘贴、原子范围、cursor、local/remote 图片在 root/child 往返后完整相等，未知线程
不会继承前一个线程的附件；真实 Agent Center open/cancel/resume 无额外 turn。inline local image
与完整 structured submission/history/mention 仍是下一刀，不能用本切片替代。

新增真实 PTY helper `runtime_pty_tests/thread_input.rs`；仅 fixture 配置 `open_agents: ctrl-n`，
不改变生产默认。`agents-overview` 场景在折叠 Unicode root 草稿中 open/cancel，给 canonical
root 改名、创建/改名/停止 background task、resume 后验证 unseen child 输入隔离，再带不同
折叠草稿 root → child 往返，检查 suffix 中原光标、恢复后整块删除及无额外 turn。
首轮成功 thread `01a0f517-9a92-7651-ae47-04d6d39979d1`、turn
`turn_c2dd3596afe948d09dba21910c494c84`，focus/resize/reconnect/terminal restore 同时通过。
PTY 不附图：local/remote attachment 由五语言完整 snapshot 单元回归证明，不能假装 PTY 覆盖。
完整 snapshot 往返、unknown-thread 附件隔离、active snapshot 消费、成功 resume 统一捕获、
真实 PTY/no-extra-turn 五项退出条件完成 `5/5（100%）`，仅代表内存草稿交接切片。

### 继续：Agent Center 单一交互 owner（2026-10-01）

状态：单一交互 owner 清理切片 completed；全量 Agent Center 仍 partial。
来源同一 baseline 的 `app/agents_overview.rs`、`agents_overview_view.rs` 与
`agents_overview_tests.rs`。分类 `merge`：Codex 的 `Arc<Mutex<ViewState>>` 有真实 SelectionView 共享读者；
Lime 是直接拥有/绘制 view，没有该消费 topology，不留纯同名镜像来假装完成。
窄写集追加 `app/{agents_overview,agents_overview_threads,agents_overview_tests,interaction}.rs`、
architecture/结构 guard/本计划；不改协议、runtime、ThreadStore。

- 删除 `view_state` 锁内 view 副本与 `visible_thread_ids` 派生副本，键盘热路径不再克隆完整 view。
- 删除生产无读者的 initialized/request_id/rendered_full_screen/refresh_thread_ids，以及永不赋值的 refresh_task
  和无作用 Drop；保留真实 `refresh_generation` + refreshing/pending 的单一请求状态机。
- 删除无调用的 view id 常量和 6 个旧 App helper/wrapper；单一刷新入口继续读取 current `thread/list`。
- `sync_pagination` 只同步唯一 view 的分页标量；metadata/search/notification 直接更新同一 owner。
- 旧静态“暴露 Codex 字段”测试迁为请求合并行为；新增 query/selection + canonical rename +
  loading/retry 的完整回归，结构 guard 防复制镜像/旧包装回流。

退出条件：定向/全 crate、Clippy、结构 guard、真实 root/child 草稿与全场景 Gate B；架构
责任开发者 root，2026-10-01。此切片不等于全量 daemon discovery/usage/worktree 功能已对齐。
该五项退出条件完成 `5/5（100%）`。upstream `app/agents_overview.rs` SHA-256
`0399a3ccfcac9f8ce8b215a45a0b540d5579540755ea18fbc81c8c1393f47810`，
`app/agents_overview_tests.rs` SHA-256
`f2c56a404a1bff3b392a681750a053edaa634af929144fc5965f1558a3019f53`；view 来源见前序登记。
设计模式尚未完全同构：当前 refresh 仍由 handler await session，Codex 后台 refresh task 与
事件回传/跨关闭保留尚未实现。不能靠保留无赋值的 AbortHandle 或重复 request 字段伪称完成；
后续按真实异步 request owner 重建并补 refresh 中输入/关闭/重开证据。

### 本轮最终验证与下一刀（2026-10-01）

- current：同义 diff snapshot 命名、单一 diff renderer/Paragraph fill、完整 ComposerDraft 交接、
  单一 Agent Center view；五语言草稿往返与稳定行为测试。上述三个限定切片分别为 `5/5（100%）`。
- dead/deleted：三条旧 Patch 着色分支、Agent Center 锁内 view 与派生 id 镜像、五个无消费者
  字段/无作用 Drop、6 个无调用 helper/wrapper、无调用 view-id 常量；无新增 compat/deprecated。
- 最终当前源码 `cargo test --locked --manifest-path "lime-rs/Cargo.toml" -p tui -- --quiet`
  通过：library `1313/1313` + integration `18/18` + dependency guard `1/1`。
  all-targets Clippy `--no-deps -D warnings`、workspace fmt/diff 通过。
- Vitest structure/PTY script guards `37/37` 通过，旧 `/agents` 纯文本开启守卫迁为真实
  nonempty-draft `Ctrl-N` helper；不把 static guard 当行为证据。
- 最新 `inventory:tui-structure` 为 `1357` source files（Codex 1048 + Lime 309），Lime source
  tree SHA-256 `f19cee616369dbc379f66811c26e229eb5de8ef6626149016315a2231443a554`。
  symbol 4346 只作为差异盘点，不参与完成度。治理报告：边界违规/分类漂移/零引用候选均 `0`。
- 最终 **重新构建 current CLI** 后全 9 个 `smoke:tui-gate-b` 场景通过；thread
  `01a0f522-df07-7270-a4a9-2db6e6620875`，turn `turn_abe8f1157acd4063bf252bbcfcd604e3`。
  complete/approval/user-input/interrupt/failure/queue-edit/agents-overview/large-paste/diff-display，
  root-child draft、focus-palette/resize-reflow/reconnect 与 terminal restore 均通过。
  App Server 使用已构建 current binary；external fixture 是 test-only，非 production mock。
- 证据限 macOS、真实 CLI/stdio/App Server/PTY/canonical Thread/Turn/Item；非 live provider、
  Desktop/GUI、Windows 或 X11。无协议/GUI/依赖变更，因此本轮不扩跑 contracts/GUI smoke。
- 整体仍 `partial / in-progress`，未做全量行为分母的整体百分比，不能用文件/符号比值凑完成率。
  下一刀仍为 local image inline/attachment owner、structured submission/history/mention；
  并继续 app thread_routing 的真实职责收敛与 Agent Center async refresh，而非仅改文件名。

本轮继续同步（2026-09-30）：

- [x] 对齐 Codex `abc8f0c9a1` 的终端调色板语义：Markdown 有序列表标记由默认/主题强调色
      改为 `Color::LightBlue`，保留无序标记、块引用和代码块的既有样式；新增跨行 marker
      样式回归。
- [x] 对齐 Codex `136391a23e` 的未发送输入保留边界：提交/排队请求在 transport 失败时
      通过 `App::restore_submission_draft` 一次性恢复文本、本地图片和远程图片，不自动重试
      不确定请求；新增完整草稿恢复回归。真实重连 Gate B 仍需覆盖“请求已被服务端接受但客户端
      未收到响应”的 uncertain receipt 矩阵，当前保持 partial。
- [x] 对齐 Codex `136391a23e`/`1cc7e23612` 的连接态文案边界：断线不再把 transport 错误
      正文显示在 TUI，统一使用五语言 `reconnecting`、`reconnected`、`reconnect failed` 状态；
      详细错误仅保留 debug 日志。

本轮验证：TUI library `1098/1098`；`cargo fmt --all -- --check`；`git diff --check`；真实
`npm run smoke:tui-gate-b` 通过（`queue-edit`、`agents-overview`、`sticky-prompt`、
`main-find`、`focus-palette`、`resize-reflow`、`reconnect`、alternate-screen 恢复）。首次
PTY 运行出现既有时序抖动，复跑通过；`cargo clippy -p tui --all-targets -- -D warnings`
仍被既有 `agent-protocol` 的 `large_enum_variant`/`derivable_impls` 阻塞，非本轮触达文件；按
包边界执行的 `cargo clippy -p tui --lib --no-deps -- -D warnings` 已通过。

本计划承接 [全量差异报告](./codex-lime-tui-cli-difference-report.md)，目标是继续按
Codex 的真实目录、文件、公开类型、函数名和测试名同步 Lime 的 TUI/CLI。禁止根据截图
或主观设计补造同名壳；每个实现批次必须先读取对应 Codex 源文件和测试，再迁移到 Lime
current owner。

## 1. 基线与完成目标

当前事实：

| 维度              |  Codex |  Lime | 当前结论                                                |
| ----------------- | -----: | ----: | ------------------------------------------------------- |
| TUI Rust 文件     |   1048 |   309 | 目录体系仍未同构（2026-10-01 inventory）                |
| TUI 类型/函数符号 | 15,341 | 4,346 | 结构差异大，须按 owner 分批收敛（2026-10-01 inventory） |
| TUI snapshot      |  1,269 |     0 | 已建立逐项分类账本，未迁入快照文件                      |
| CLI Rust 文件     |     96 |    10 | current CLI 较薄，产品专属文件不机械复制                |
| execpolicy 文件   |     17 |    17 | 已同构                                                  |
| CLI 测试          |    467 |     - | 50 covered、89 partial、81 Cloud deferred、247 excluded |

完成目标不是让文件数量形式上相等，而是：

1. Codex current TUI 行为都有明确 Lime owner、测试和分类；可迁移的目录/符号/测试使用
   Codex 原名，不能继续由 Lime 聚合文件隐式承载。
2. TUI 的 direct/merge 场景具备稳定的 Lime snapshot 或等价 TestBackend/VT100 断言；
   contract 场景具备真实 App Server JSON-RPC evidence。
3. CLI 的 89 个 partial 要么补齐 current contract 和真实 Gate B，要么记录明确的
   `defer`/`excluded` 理由，不保留 `missing/pending`。
4. Desktop、CLI/TUI 继续共享 App Server、RuntimeCore、Thread/Turn/Item projection；
   Cloud 只增加 authenticated transport，不复制 runtime、状态机、工具 registry 或存储。

## 2. 不变量与命名规则

- Codex 路径、模块名、`pub struct/enum/type/fn` 和测试名是基线；迁移前保存上游路径、
  source commit 和内容 hash。
- `current` 只能落在 `lime-rs/crates/**`、`packages/cli` 或 App Server current owner；
  `compat` 只能委托；`deprecated` 只能迁出；`dead` 必须删除并补回流守卫。
- TUI 业务链固定为：`TUI Host -> app-server-client -> App Server JSON-RPC -> RuntimeCore -> canonical projection`。
- 不复制 Codex 私有 auth、account、rollout/history DB、daemon、provider manager、
  marketplace、doctor、pets、theme、update、ChatGPT 状态或平台私有 sandbox internals。
- 不恢复 `lime-cli`、`terminal-ui`、`TerminalGuard`、`TuiTerminal`、旧 bounded EOF
  restart、旧 crossterm registry 输入路径；这些只能出现在 negative guard/history evidence。
- 生产路径不使用 mock；fixture 只能用于测试，且必须通过真实 stdio/PTY/JSON-RPC 边界。
- 新增代码不得使用 `codex*` 品牌前缀；只有与 Codex 对齐的领域 owner 名称可以保留
  `ChatWidget`、`HistoryCell`、`Renderable` 等语义名。

## 3. 写集与避让范围

### 本计划允许的写集

- `lime-rs/crates/tui/**`
- `lime-rs/crates/cli/**`
- `lime-rs/crates/app-server-client/**`、`lime-rs/crates/app-server-protocol/**`（仅为已确认的
  TUI/CLI contract 缺口）
- `lime-rs/crates/core/src/config/{mod.rs,types.rs,tui_keymap.rs}`、
  `lime-rs/crates/app-server/src/processor/config.rs` 与
  `lime-rs/crates/app-server/tests/config_jsonrpc.rs`（仅限 TUI keymap 的单一用户配置层、
  `config/read` consumer 与写入校验；不得新增 TUI 私有配置文件或环境变量配置面）
- `lime-rs/crates/app-server/src/processor/thread.rs`、
  `lime-rs/crates/app-server/src/runtime/{thread_read.rs,canonical_thread_store.rs,canonical_thread_store_tests.rs}`、
  `lime-rs/crates/app-server/tests/thread_v2_jsonrpc.rs`（仅限 Codex paginated resume cursor
  contract，不扩展其它 App Server 业务）
- `packages/cli/**`、`pnpm-lock.yaml`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`
- `docs/ops.md`、`internal/aiprompts/commands.md`（仅同步 `tui.keymap` current 配置合同）
- `scripts/app-server/{tui,cli}-*.mjs` 及对应测试、TUI/CLI inventory 生成器和账本
- `.gitignore`、`internal/exec-plans/README.md`、本计划和差异报告

### 明确避让

`electron/**`、无关 `src/**`、Codex Desktop/Goose 计划热区、服务端外部仓库、
`lime-rs/crates/agent/**` 和已有未跟踪产物。若必须改变 App Server protocol，先单独登记
contract 写集、消费者、schema、锁文件和测试，不在 TUI 批次夹写。

## 4. 阶段 A：TUI Codex owner 同构

### A0 迁移准备

- [x] 为每个批次建立 `upstream-path -> lime-owner -> classification -> test` 映射，来源必须
      是 Codex 当前 checkout，不得只依据文件名猜测。
- [x] 复核 `tui-structure-inventory.json` 和 `tui-codex-snapshot-inventory.json` 的 hash、
      source commit 与分类；新增 upstream 文件必须先分类再写代码。
- [x] 维护唯一 owner 表，确认 `projection.rs`、`runtime.rs`、`view.rs` 等 Lime 聚合 owner
      的拆分边界；不创建第二个 Thread/Turn/Item 模型。

### A1 纯终端 direct owner

对应 Codex：`render/`、`streaming/`、`markdown_render/`、`diff_render`、`insert_history`、
`terminal_hyperlinks`、`terminal_palette`、`table_detect`、`wrapping`。

- [x] 按 Codex 文件名补齐 `tui/src/render/` 的 `mod.rs`、`line_utils.rs`、`renderable.rs`、
      `highlight.rs` 和 streaming highlight；把 Lime `highlight.rs`/`view.rs` 中对应纯算法迁入
      唯一 owner。当前 `render/highlight.rs` 已承接固定 ANSI 主题的 Lime 算法，
      `render/highlight_streaming.rs` 已复制 Codex 的增量状态机；未引入 Codex 私有主题配置。
- [x] 按 Codex 真实测试名迁移 48 个 `direct` snapshot 场景，使用 `insta` 或等价
      `TestBackend/Buffer` 断言；不引入 Codex runtime 状态。
- [ ] 对 `markdown_render`、`diff_render`、OSC 8 和宽字符边界补窄终端、UTF-8 grapheme、
      表格、重排回归；`wrapping` 已完成 Codex range/projection 与 URL-aware 行为回归。
- [ ] 删除迁移后的 Lime-only 重复纯渲染函数，更新 inventory 并增加禁止重复 owner 的结构守卫。

当前进度：`render`/`highlight`/`renderable`/增量高亮和 `insert_history` owner 已完成；
48 个 direct snapshot 已全部按 Codex 测试名补齐 Lime 等价断言：
`diff_render` 23、`markdown_render` 20、`render` 1、`terminal_hyperlinks` 2、
`insert_history` 2。`insert_history` 使用真实 VT100 parser，覆盖 Zellij raw terminal
软换行、overflow replay、viewport 边界和 history-row bookkeeping，没有复制 Codex 私有
`custom_terminal` 或 runtime state DB。
`history_cell/{mod,base,messages,exec,patches,plans,approvals,mcp,notices,request_user_input,separators,session}.rs`
现已建立，`TranscriptHistoryCell` 只适配 Lime canonical `TranscriptEntry`；
`exec_cell/{mod,model,live_output,render}.rs` 现已承接 command output head/tail、UTF-8
行截断和 omission marker，`entry.rs` 不再持有 bounded output 算法。已新增 Codex-shaped
`HistoryCell`、`TranscriptHistoryCell`、`CommandOutput`、`LiveCommandOutput`、
`OutputLines`、`OutputLinesParams` 和 `output_lines` 符号，并由结构守卫锁定目录/符号。
`app/history_ui.rs` 现已承接 Codex-shaped `render_transcript_content_lines`，主 transcript
与 pager overlay 复用同一 canonical projection 投影；未伪造尚无 Lime consumer 的
`history_pagination` 或完整导出 runtime。
已通过 `cargo test -p tui`、TUI Clippy、结构 inventory 与 snapshot inventory 守卫。

本轮 wrapping 收口：`lime-rs/crates/tui/src/wrapping.rs` 已迁入 Codex 同名
`ProjectedText`、`project_halfwidth_sound_marks`、`source_offset`、`break_projected_words`、
`wrap_projected_ranges`、`borrowed_slice_range`、`map_owned_wrapped_line_to_range`、
`word_wrap_flattened_line`、`MixedUrlWord`、`mixed_url_wrap_ranges` 和完整 URL 识别 helper；
`bottom_pane/textarea/wrapping_tests.rs` 与 wrapping inline tests 共保留 Codex 测试名 61 个，
覆盖 trailing-space/sentinel、owned penalty、CRLF、缩进 source mapping、halfwidth sound mark、
URL-only 与 mixed URL/prose。相关过滤测试 61/61、TUI Clippy 和 fmt 均通过。

本轮 textarea hyperlink 收口：按 Codex `bottom_pane/textarea/hyperlinks.rs` 建立同名
`HyperlinkCache` owner，并把 URL 扫描、换行行偏移缓存和可见行 OSC 8 重映射接入
`TextArea` 的 wrap cache。缓存随文本替换/插入/删除失效，滚动只标记当前可见行；不把
OSC 8 控制序列写入 canonical draft，也不复制第二套 hyperlink parser。新增同名测试覆盖
跨行 URL、滚动后的目的地保留、emoji grapheme、超长 URL fail-closed、文本变更失效和
重绘复用；`bottom_pane/textarea/hyperlinks.rs`、`hyperlinks_tests.rs` 已纳入结构 inventory。

相关验证：textarea hyperlink 定向测试 12/12、TUI library 586/586、TUI Clippy、workspace
fmt check、结构 inventory 14/14 和 `git diff --check` 通过。

退出条件：48 个 direct snapshot 全部有 Lime owner 和稳定断言；`cargo test -p tui`、
TUI Clippy、结构 inventory 和 TUI Gate B 通过。

### A2 transcript/history owner

对应 Codex：`history_cell/`、`exec_cell/`、`app/history_ui.rs`、`app/history_pagination.rs`、
`app/transcript_export.rs`、`pager_overlay/`。

- [x] 建立 `history_cell` 的 canonical entry adapter，只消费 App Server `Thread/Turn/Item`
      projection；按 Codex 文件拆分 approvals、exec、MCP、patches、plans、messages、notices、
      session 和 request_user_input。
- [x] 建立 `exec_cell/{mod,model,live_output,render}.rs`，把 command live output 与 Lime
      `entry.rs` 的重复渲染收回同一 owner。
- [x] 将 `Ctrl+T` transcript overlay、resume transcript、pager 和 export 统一到
      `history_cell`/`pager_overlay` 的渲染链；不创建 rollout/history DB。当前 `/export` 支持
      剪贴板和显式路径 noclobber 写入，主 transcript、pager 与 resume preview 共享
      `app/history_ui.rs` 的 canonical projection。
- [x] 对齐 Codex `/export` 的 destination/selection popup 与 filename prompt：无参数命令先
      进入复制到剪贴板/保存到文件选择，保存路径使用线程 ID 默认文件名并复用 canonical
      transcript、clipboard 和 noclobber 写入；直接带路径的 `/export <path>` 继续走现有 current
      写入路径。
- [x] 建立 Codex-shaped `app/history_pagination.rs` 的 cursor/loading/去重状态，并接入
      App Server `thread/items/list` contract；legacy thread 继续由 `thread/read` hydrate，
      paginated thread 使用 `thread/resume(excludeTurns=true)` 后按 `nextCursor` 加载 older
      items。TUI 不持有第二套 history store。
- [x] 对齐 Codex `paginated_resume_backwards_cursors`：canonical ThreadStore 的 turn/item
      page 始终从首行生成 inclusive `backwardsCursor`，metadata-only `thread/resume` 返回稳定
      turn/item head cursor，重复 resume 保持相同 cursor，cursor 可重新读取最新 canonical
      Turn/Item。TUI `advancing_cursor` 同步为 Codex 的重复 cursor 截止语义。
- [x] 对齐 transcript pager 的 bounded reflow：手动滚动在前置历史和终端宽度变化后保持
      逻辑行锚点，底部 pinned 状态继续跟随最新尾部；实现位于 `pager_overlay.rs`，不引入
      第二套 transcript/history store。
- [ ] 迁移 `merge=702` 中与 history/transcript/pager 相关场景；跨 runtime 的 136 个
      `contract` 场景必须绑定 App Server fixture 和 canonical identity。

当前剩余：分页 persisted-history hydration 的 TUI current loader 已落地并完成本地投影回归；
older-page 的跨页 nested-review reconciliation 已接入已有 `thread/turns/list` contract，
仍需补充完整 history/transcript contract 证据；不得用本地 DB、缺失的 Turn status 字段或伪造字段补齐。review prompt filtering
已在 TUI 唯一 `history_filter.rs` owner 中按 Codex canonical Turn/ThreadItem 规则落地：完整
Thread hydration 隐藏 review 区间内的 UserMessage，并隐藏前一 completed review turn 后、
当前未完成 interrupted turn 中完全重复的双 prompt；实时 ItemStarted/ItemCompleted 与
TurnCompleted canonical repair 继承 review 边界状态，普通用户消息保持可见。分页
`thread/items/list` 在有 Turn metadata 时按 canonical UserMessage ID 做跨页过滤；旧 App Server
缺少 `thread/turns/list` 或目标页缺少可判定的前序 Turn 时保持 item-only、fail-closed。MCP 摘要已在唯一 projection.rs owner 中对齐可由 v2 canonical 字段
证明的内容类型计数、structured content、截断/可取回标记、错误与耗时，并覆盖未知块
fail-closed 回归及五语言 detail 文案；Codex 专用 rmcp 媒体解码、资源正文、Node/CUA REPL
与相邻 computer activity 仍因 Lime canonical 不保留原始 wire 内容而标为 contract/defer。
Web Search action detail 已在唯一 projection.rs owner 中对齐：typed Search/OpenPage/FindInPage
字段按 Codex 语义展示，多 query 使用首项省略标记，未知、字符串或 malformed action 均回退
canonical query；新增 projection 与 entry-boundary 回归，不扩展 v2 协议。
export destination/selection popup 与 filename prompt 已完成 current 迁移。历史分页已具备
current 最小路径，public App Server JSON-RPC 已覆盖 resume/head cursor/turn-item 重读；真实
stdio fixture 与 PTY/alternate-screen Gate B 已通过，剩余是 history/transcript contract 场景扩大。

本轮历史完成边界补充（2026-09-13）：新增 `app/history_completion.rs`，按 Codex
`group_completed_turn_items` 语义把跨页 item 分组，并仅为包含 completed turn 最后 item 的
分组生成 completion metadata；`Failed`、`Interrupted`、`InProgress` 不生成边界。完成元数据
由 `ConversationProjection` 独立保存，完整 Thread hydrate、实时 `TurnCompleted` 和旧页加载
均可接入现有 `FinalMessageSeparator`；transcript/pager 渲染时插入分隔线，导出仍只消费
canonical `TranscriptEntry`；耗时标签已覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`。
旧 App Server 无法提供 `thread/turns/list` 时保持 item-only
投影并 fail-closed。Codex runtime metrics、完成时间本地化和跨页 nested-review 状态仍为
`partial/contract/defer`，没有伪造字段或第二套 history store。

聚合文件退出约束：`processor/thread.rs`、`runtime/thread_read.rs` 与
`runtime/canonical_thread_store.rs` 均已超过 1000 行。本批只允许完成上述 Codex cursor
合同的最小补丁；下一次继续修改这些热区前，必须先依据 Codex 当前 checkout 确认对应
子模块边界并迁出本次触达的 resume/page 逻辑，保留同名函数与公共测试，禁止继续堆叠。

架构图确认：本批保持 `TUI -> app-server-client -> App Server JSON-RPC -> RuntimeCore ->
ThreadStore -> canonical Thread/Turn/Item projection` 单主链；Cloud 仍只允许 transport 扩展。
责任开发者确认：root，2026-09-10。

退出条件：Message/Reasoning/Command/Patch/MCP/Plan/Multi-Agent/approval/request_user_input
各有稳定 cell owner；历史分页、overlay、export、live output 具备 VT100/PTY 证据。

### A3 composer/chatwidget/bottom_pane owner

对应 Codex：`chatwidget/`、`bottom_pane/`、`public_widgets/composer_input.rs`、
`keymap/`。

- [ ] 逐文件对照 Codex `chatwidget/{constructor,input_flow,input_submission,interaction,
interrupts,tool_lifecycle,turn_lifecycle,streaming,transcript,settings}.rs`，把 Lime
      `app`、`bottom_pane/chat_composer` 和 `projection` 中相应逻辑迁入 Codex-shaped owner。
- [ ] 按 Codex 目录补齐 composer 的 `attachment_state`、`draft_state`、`history_search`、
      `popup_state`、`slash_input`、`vim_history`、`vim_search`、`footer_state` 和测试；保留
      Lime 的图片/队列 canonical contract，不复制 Codex 私有 provider/auth。当前
      `attachment_state` 已覆盖本地图片、远程 `UserInput::Image`、上下选择、删除、统一编号、
      提交、队列和无损队列编辑；其余 composer 子状态仍待拆分。未选中的远程图片不会被空
      Backspace 隐式删除，必须先通过上下键选中后再删除。
- [ ] 按 Codex `bottom_pane` 补齐 action banner、footer、selection、file search、skills、
      hooks、MCP elicitation 和 unified exec 的可用子集；没有 App Server consumer 的动态工具
      继续 reject/fail closed。
- [ ] 将 Lime `command_popup.rs`、`pending_input_preview.rs`、`status_indicator.rs`、
      `settings.rs` 迁移到对应 Codex owner，迁移后删除重复聚合实现。

本轮 A3 composer/TextArea 对齐切片（2026-09-13）已建立 `textarea/vim.rs` 作为 Lime TextArea
唯一 Vim owner，并以 `vim_commands_tests.rs` 覆盖 Insert/Normal/Replace、grapheme 移动删除、
operator pending、替换和模式指示器。`ChatComposer` 通过 `/vim` 本地命令接入开关，App 继续
把输入交给同一 composer/TextArea；活动回合中 Insert/Replace/operator pending 的 Escape
优先退出编辑状态，Normal 模式 Escape 才产生中断，Normal 模式 Up/Down 不再劫持历史导航。
footer 复用 composer 的模式指示器，并在窄终端通过统一截断保持边界；五语言 `/vim` 描述和
启停状态文案已补齐。`SlashCommand::ALL`、popup、App 本地命令和 canonical projection status
均已同步，未引入第二套 runtime、history store 或生产 mock。

本切片的 Codex 对齐范围是 current 最小核心，不等同于完整 Vim 同构：
`RuntimeKeymap`/配置化 toggle、search、text object、find/till、dot repeat、完整 replace
recovery、search highlight/overlay 和完整 ChatWidget/footer 行为仍为 `partial/defer`；visual-wrap
preferred-column 已在后续切片收口为 `current`。后续只有
在读取对应 Codex owner 与测试后才继续迁移，不以当前硬编码按键集合冒充完成。

本轮 VimHistory 切片（2026-09-13）已建立 `bottom_pane/chat_composer/vim_history.rs` 唯一
owner：以 Lime composer 的文本、游标、本地图片、远程图片 URL 和选择状态组成快照，按
Codex 的 pending transaction 语义把 Normal 命令、Insert/Replace 会话、普通粘贴和附件变更
合并为一个可撤销编辑；undo 使用 `u`，redo 使用 `Ctrl-R`，历史限制为 64 步和 1 MiB，查询
输入、移动、模式切换和空历史操作不会污染历史。`vim_history_tests.rs` 覆盖文本、Unicode
Insert、附件、远程图片删除和空历史；完整 RuntimeKeymap、dot repeat、text object、find/till
与更完整附件原子事务仍保持 `partial/defer`。

本轮反向历史搜索 Enter 语义（2026-09-13）按 Codex `history_search` 对齐：命中预览后 Enter
只接受预览并退出搜索，保留文本作为可继续编辑的草稿，不直接创建 turn；接受动作同时清空
旧 Vim 撤销栈，使后续 `u` 不会回退到搜索前草稿。新增
`ctrl_r_search_accepts_a_match_with_enter` 与
`accepted_reverse_history_preview_starts_a_fresh_vim_edit_history` 回归；可配置 keymap、
异步 persistent history、跨后端历史查询与完整 ChatWidget/footer 行为仍保持
`partial/defer`。

本轮 MCP elicitation footer 切片（2026-09-15）按 Codex `FooterTip` 的显示优先级收口：宽屏
继续复用五语言完整 controls 文案；窄屏按提交、字段/选择导航、取消的顺序拆分为多行，并对
每个提示逐项降级（`Enter`/`Esc`、方向键、`Tab`），保证每行不超过可用宽度且取消动作落在
最后一行。状态模型仍保持 Lime 的 `Option<usize>` 与硬编码按键边界，没有引入 Codex 私有
`ScrollState`/keymap 或新的协议字段。新增五语言窄 footer 顺序与宽度回归；MCP 输入/选择
状态同 Codex 的完整 keymap、错误提示分组和 scroll contract 继续标为 `partial/contract-defer`。

本轮底部交互窗口收口（2026-09-15）：按 Codex `MAX_POPUP_ROWS`/selection window 语义，
approval、`request_user_input` 与 MCP elicitation 的选项窗口统一限制为 8 行，并保证当前
选择始终可见；MCP elicitation 的标题、消息、字段描述按终端宽度换行，选项/输入保持单行
省略，footer 在极窄宽度逐级压缩并保留 `Esc` 取消入口。`request_user_input` 与 MCP 文本
输入的光标位置改为依据实际物理换行行数计算，避免长 CJK/多行草稿错位。新增 MCP 窄宽度
行边界和选择窗口回归；相关实现仍只消费 App Server JSON-RPC 请求，不新增协议字段或第二
套 runtime。

验证证据：TUI library `880/880`、integration `16/16`、TUI all-targets Clippy
`-D warnings`、workspace fmt check、`git diff --check`、`npm run test:contracts` 全部通过；
TUI Gate B（真实 PTY、alternate screen、stdio JSON-RPC、resize/reconnect、terminal restore）
沿用本批既有通过证据。未运行 `verify:gui-smoke`，因为本轮仅触及 Rust TUI。
无匹配时 Enter 保持搜索会话和原草稿，允许继续编辑查询；新增
`history_search_no_match_enter_keeps_search_open_for_query_edits` 回归。
本轮 history-search 可见契约补充（2026-09-13）：Lime `ChatComposer` 复用 Codex 的单一
历史搜索预览状态，新增大小写无关且 UTF-8 安全的 `match_ranges`，仅在命中预览期间把
查询匹配范围作为 render-only 反色粗体样式传给 `TextArea`；Enter 接受后搜索状态清除，
高亮随之消失。footer 搜索提示新增查询末尾光标定位，使用显示宽度计算并在窄终端内钳位，
不改变 canonical draft 或历史存储。新增 `history_search_highlights_preview_until_accepted`、
`history_search_preview_highlights_matches_until_accepted`、
`history_search_footer_cursor_tracks_query_and_clamps_to_narrow_width` 与 Unicode/大小写
匹配范围回归。
本轮文件搜索对齐（2026-09-13）：Lime `ChatComposer` 已建立唯一 `@` 文件补全 owner，
通过 `AppServerSession::fuzzy_file_search_request` 调用真实 `fuzzyFileSearch` JSON-RPC，
使用绝对 cwd、App Server roots 和稳定 cancellation token；runtime 以 generation/query
过滤旧结果并对相同 query 去重。文件 popup 对齐 Codex 的最多 8 条结果、循环上下选择、
`Ctrl-P`/`Ctrl-N` 导航、loading/no-match、Esc dismissal、Enter/Tab 补全和分隔空格处理；
空 `@` 只显示 idle 提示，不发搜索请求，命令 popup 与文件 popup 保持互斥。新增 stale
结果、UTF-8 token 边界、嵌入/重复 `@`、空 query、补全和窄终端渲染回归；未引入本地
filesystem/mock fallback，真实 App Server/PTY Gate B 与 contracts 均通过。
本轮最终验证：TUI library 706/706、history-search 相关回归 12/12、文件搜索与 token 边界回归、
TUI Clippy `-D warnings`、cargo fmt check、`git diff --check`、`npm run test:contracts`、
结构/snapshot inventory 17/17 与真实 `npm run smoke:tui-gate-b` 均通过；Gate B 证明真实 PTY、
alternate screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、queue-edit、
agents-overview、focus-palette、resize-reflow、reconnect 和 terminal restore。App Server 仍有既有
`lower_turn_start_params`/`lower_runtime_options` dead_code 警告，不影响本轮门禁。

本轮 A3 slash popup 光标语义对齐（2026-09-13）：

- `bottom_pane/chat_composer/slash_input.rs` 新增 Codex-shaped `command_popup_filter_text`，按
  首行命令名与 UTF-8 安全光标边界计算 popup 过滤值；命令带参数时，光标在命令名内仍可恢复
  popup，进入参数区则保持关闭，不改变提交解析或 App Server contract。
- `ChatComposer::sync_command_popup` 与 Esc dismissal 共用该过滤 owner，避免整段文本的空格
  判断造成 popup 丢失；无新增 popup 状态、协议字段、兼容包装或本地 fallback。
- 回归覆盖参数后回到命令前缀、参数区关闭、Esc dismissal 作用域和非边界 UTF-8 光标；该切片
  分类为 `current`，A3 完整 ChatWidget/RuntimeKeymap 仍为 `partial/defer`。
- 已通过 slash-input 4/4、composer 26/26、TUI library 733/733、Clippy `-D warnings`、
  workspace fmt check、结构/snapshot inventory 18/18、`npm run test:contracts`、
  `npm run smoke:tui-gate-b` 与 `git diff --check`。Gate B 证明真实 PTY、alternate screen、
  stdio App Server JSON-RPC、canonical Thread/Turn/Item、queue-edit、agents-overview、
  focus-palette、resize-reflow、reconnect 和 terminal restore；编译期间仍有 App Server 既有
  `lower_turn_start_params`/`lower_runtime_options` dead_code 警告，非本切片引入。

退出条件：composer key/event/input/interrupt/queue/attachment/history 逐函数有 Codex 来源；
所有当前可用 popup、approval、request_user_input、status、queue 场景有测试和五语言文案。

### A4 app/startup/reconnect/resize owner

对应 Codex：`app/{startup,startup_prompts,working_directory,session_picker,reconnect,
resize_reflow,thread_routing,thread_session_state,thread_title}.rs`、`tui/*`。

- [x] 把 `viewport.rs` 接入 runtime resize/reflow 主路径，使用实际 TUI resize event 和
      Ratatui viewport，覆盖宽度变化、底部对齐、composer 草稿、alternate-screen round trip
      和重复缩放；Codex 的 tmux-specific smoke 在 Lime 中等价为 portable-pty `MasterPty::resize`。
- [ ] 迁移 Codex startup/session/working-directory 语义到 App Server contract；没有 Lime
      current contract 的字段明确标为 `contract/defer`，不能在 TUI 本地合成。
      当前 startup 初始化已迁入 `app/startup.rs::initialize_session`，统一承接
      `thread/start`、`thread/resume`、canonical history hydrate、permission/collaboration
      catalog、model catalog、skills/list、prompt history 与 queued submissions；启动保护 gate
      的 Codex 同名 helper 已有 Lime 测试，并在首个无待处理请求的键盘/粘贴事件后释放 boundary，
      避免后续普通会话请求继续被误标为 startup request。`app/startup_prompts.rs` 已承接 Codex 同名的
      `SkillLoadWarningState`、`StartupTooltipOverride`、model migration/availability NUX 纯
      逻辑，并由真实 `skills/list`、`model/list` JSON-RPC 启动请求消费。`cwd_prompt.rs` 已
      承接 Codex 同名 `CwdPromptAction`、`CwdSelection`、`CwdPromptOutcome` 状态机。
      完整 `working_directory`/`/cd` trust/config、fork/replace 和 resume-cwd persistence
      继续按 contract/defer 处理。
      当前已对齐可由 Lime canonical session 直接承接的 `/pwd` 与 Codex `/cwd` 别名，使用
      `App.cwd -> ConversationProjection`，并补齐五语言文案和同名回归测试；Codex `/cd` 的
      trust/config、后台 terminal、fork/replace 与 resume-cwd preference 仍为 `contract/defer`，
      不在 TUI 本地伪造。
- [x] 补齐 `tests/suite/status_indicator.rs` 的 Lime 版本；它消费独立的
      `ansi-escape::{ansi_escape, ansi_escape_line}` current owner。
- [x] 补齐 `tests/suite/reconnect.rs` 的 Lime 版本；测试通过真实 PTY 和 loopback
      `RemoteTransport` 断线/重连，验证草稿保留、精确两次 `thread/resume`、恢复后的通知路由
      和 alternate-screen 恢复。顶层 `tui/src/reconnect.rs` 仍只作为历史委托壳，待零消费者后
      删除。
- [x] 补齐 `tests/suite/resize_reflow.rs` 的 Lime 版本，保留 Codex 四个测试名并通过真实
      PTY window-size signal、VT100 屏幕投影和终端退出恢复验证；Gate B 以单线程顺序执行，
      不依赖 tmux、live provider 或 mock backend。
- [x] 补齐 `tests/suite/focus_palette.rs` 的 Lime 版本，并绑定真实 PTY、启动期 OSC 10/11
      palette probe、FocusGained 输入恢复和 alternate-screen restore；Gate B 通过
      `suite::focus_palette::focus_gained_with_unanswered_palette_queries_preserves_immediate_input`
      执行，不使用 mock backend 或空 `#[ignore]`。
- [x] 收口 startup protected-input handoff：首个无待处理启动请求的键盘/粘贴事件释放
      `App` boundary；可见 BottomPane 请求仍优先接收解决键，后台线程请求继续只进入其线程
      缓冲区。新增 `startup_boundary_ends_on_the_first_safe_user_input`、
      `first_safe_user_input_releases_boundary_before_reaching_composer` 与
      `startup_boundary_waits_for_visible_request_before_releasing` 回归测试。
- [ ] 把 terminal lifecycle 继续固定在 `Tui`/`Terminal`/`EventBroker`/`FrameRequester`，
      不恢复 `TerminalGuard` 或 runtime EOF 重启。

退出条件：TUI resize/reflow、focus、reconnect 和 terminal restore 通过真实 PTY/VT100；
旧 reconnect 壳和旧输入恢复路径不存在 current 引用。

## 5. 阶段 B：TUI 测试体系同构

- [x] 新增 Codex-shaped `lime-rs/crates/tui/tests/` 第一批：`all.rs`、`test_backend.rs`、
      `manager_dependency_regression.rs`、`suite/mod.rs`、`suite/vt100_history.rs`、
      `suite/vt100_live_commit.rs`、`suite/status_indicator.rs`。VT100 测试直接调用 Lime
      current `insert_history_lines`/`RowBuilder`，status 测试消费新增的 Codex-shaped
      `ansi-escape::{ansi_escape, ansi_escape_line}` owner；manager regression 扫描 Lime
      `src`，不复制 Codex 私有 `custom_terminal` 或 manager/runtime 状态。
- [x] 迁移 `suite/reconnect.rs`：使用 Lime 当前 `--remote` + `RemoteTransport` 的公开
      App Server JSON-RPC WebSocket 合同，未复制 Codex 私有 daemon 控制 socket、auth、history
      DB 或 runtime。`fixtures/oss-story.jsonl` 在 Codex 当前 `tui/tests` 没有 Rust consumer，
      继续保持 `defer`，不得为填文件差异而引入未消费 fixture。
- [ ] 从 Codex 测试复制测试结构和测试名，仅替换 Lime App Server fixture、canonical
      projection 和五语言文案；不得把 Codex 私有 backend/state DB 带入测试。
- [ ] 引入 `insta`、`serial_test`、`assert_matches` 等依赖前先确认只用于 TUI test target，
      同步 Cargo.lock 和最小结构守卫。
- [ ] 对 991 个 snapshot 保持逐项账本：`direct` 迁移、`merge` 合并、`contract` 绑定真实
      protocol、`defer` 保留退出条件、`dead` 禁止复制。

当前证据：Codex-shaped 集成目录已建立，VT100 history/live commit、status indicator、
focus palette、resize/reflow 和 reconnect 共 15 个测试通过；TUI library 全量测试在本轮
wrapping owner 迁移后重新验证，terminal
probe 定向测试、TUI integration Clippy、fmt、inventory、治理报告和真实
`smoke:tui-gate-b`（包含 `reconnect=ok`）均通过。`fixtures/oss-story.jsonl` 仍是明确
`defer`，原因是上游当前没有 Rust consumer。

退出条件：TUI 集成目录、snapshot、TestBackend、VT100 history/live commit、status 和
PTY Gate B 同时通过；账本无未分类条目，且测试失败不会回退到 mock backend。

## 6. 阶段 C：CLI 89 个 partial 收口

### C1 CLI current contract

- [x] `permission options`：按 Codex `approve-for-me`、`not-so-yolo` 和 root/exec/resume
      precedence 测试逐项决定是否能映射 Lime `permissionProfile/list` + `thread/settings/update` +
      `turn/start`；不能
      映射的别名不添加假兼容。
- [ ] `plugin`：补 marketplace cache、repo-local marketplace、catalog refresh、JSON
      output 和 enable/disable 边界；所有 mutation 继续走 `plugin/*` App Server owner。
  - [x] 本地 repo marketplace discovery、`--available`/JSON 投影和真实 CLI Gate B 已完成。
  - [ ] 远程 marketplace cache/refresh 与 mutation 继续按产品范围 deferred/excluded，不伪造
        第二套 catalog 或 credential owner。
- [x] `mcp`：补齐 `mcpServer/oauth/*` 的 logout current contract：协议/schema、Rust/TS
      client、RuntimeCore、LocalAppDataSource、MCP OAuth store、CLI 和 OAuth fixture 均沿同一
      App Server JSON-RPC 主链；CLI 不直接读 credential store。`logout` 仅接受
      `streamable_http`，未知 server、stdio 和未注入 credential root 均 fail closed；重复 logout
      返回 `removed=false`。
- [ ] `mcp`：继续补 login/logout 的真实 stdio CLI Gate B、provider error/uncertain receipt
      矩阵和 Codex client-registration/keyring 差异；没有当前 Lime owner 的能力继续 defer。
- [ ] `queue`：补本地 queue 的完整命令/错误矩阵；远程 queue 只在 Cloud transport evidence
      完成后启用，不添加本地 fallback。
- [ ] `app-server entrypoint`：复制 Codex 参数和错误测试到 Lime sibling App Server owner；
      transport/daemon/proxy/capability 只在有 current handler 时暴露。
- [ ] `sandbox`：补 sandbox-state replay、managed network、named profile 矩阵；缺少
      App Server/tool-runtime owner 时保持 fail closed，不在 CLI 自建策略。

### C2 CLI 结构与命名

- [ ] 保持 `MultitoolCli`、`Subcommand`、`TuiCli`、`ExecCli`、`ResumeCommand`、
      `McpCli`、`PluginCli`、`FeaturesCli`、`QueueCommand`、`DebugCommand`、
      `SandboxSetupCommand`、`handle_exit_status` 等 Codex-shaped owner。
- [x] 将 `packages/cli/bin/lime.js` 的 `codexPackageRoot`、`findCodexExecutable`、
      `isPnpmOwnedCodexInstall` 和 `isVitePlusOwnedCodexInstall` 改为 Lime 语义，并同步
      npm package test 和 structure inventory；launcher current owner 不再暴露 Codex 残留名称。
- [ ] 扩展 Linux ARM64/musl、Windows ARM64、Android 目标前必须先有可复现构建产物、
      native payload、launcher smoke 和 CI evidence；没有产物的 optional package 不得发布。
- [ ] 保持 `init_firewall.sh`、`run_in_container.sh` 为 Codex Cloud/容器参考，不复制为
      Lime 伪生产入口。

## 2026-09-11 CLI 工作目录参数命名收敛

- `lime-rs/crates/cli/src/main.rs::ConnectionArgs::cwd` 已按 Codex
  `SharedCliOptions::cwd` 对齐为 `--cd`/`-C`；`exec`、`resume`、默认 TUI、Thread/Skills/
  Plugin/Queue 等共享连接参数统一消费该定义。
- 真实 TUI PTY fixtures（runtime、focus palette、reconnect）和 CLI Gate B fixtures 已统一
  使用 `--cd`；旧 `--cwd` 仅保留在 CLI 负向解析回归，确保 legacy 命名不能回流。
- 退出证据：`cargo test --manifest-path lime-rs/Cargo.toml -p cli --bin lime`（42）、
  `cargo test --manifest-path lime-rs/Cargo.toml -p tui --lib`（507）、
  `node scripts/app-server/cli-gate-b.mjs`、
  `LIME_TUI_GATE_B_SCENARIOS=complete node scripts/app-server/tui-gate-b.mjs`、
  CLI Gate B Vitest（4 tests）、fmt 和 `git diff --check` 均通过。
- 分类：CLI/TUI 参数与 fixtures 为 `current`；`--cwd` 仅为 `dead` 负向 guard；没有新增
  `compat` 或 `deprecated` 入口。与主链关系：参数只影响 Host 启动配置，业务仍走同一
  `CLI/TUI Host -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item`。

## 2026-09-11 session_resume 纯路径语义

- 新增 `lime-rs/crates/tui/src/session_resume.rs`，按 Codex 同名 owner 承接无副作用的
  `cwds_differ` 路径比较：优先解析现存路径的 symlink/canonical path，路径不存在时执行
  lexical `.`/`..` 归一化。
- `app/startup.rs` 与 `app/session_lifecycle.rs` 统一通过该 helper 判断是否需要更新本地
  cwd；最终 cwd 仍以 App Server `thread/start`/`thread/resume` 的 `response.cwd` 为事实源。
- Codex `effective_resume_cwd_mode`、rollout/state DB 读取、trust/config 重建、后台 terminal
  阻塞检查和 `/cd` fork/replace 仍没有 Lime current contract，继续分类为 `contract/defer`，
  没有复制私有持久化或在 TUI 本地伪造配置。
- 验证：`cargo test --manifest-path lime-rs/Cargo.toml -p tui --lib session_resume`（3）、
  `cargo clippy --manifest-path lime-rs/Cargo.toml -p tui --lib --no-deps -- -D warnings`、
  `cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check` 通过。
- 同批修复 `tests/suite/focus_palette.rs` 的 PTY 退出时序：等待 Ctrl-U redraw 后再发送
  Ctrl-D，避免 focus palette 与 resize 串行 Gate B 下的偶发退出竞态；隔离测试与完整
  `LIME_TUI_GATE_B_SCENARIOS=complete node scripts/app-server/tui-gate-b.mjs` 均通过。

退出条件：89 个 partial 全部变成 `covered`、有记录的 `defer` 或 `excluded`；CLI Gate B、
npm staging/launcher、JSON/JSONL/stdin/exit/signal/completion 和结构 inventory 通过。

## 7. 阶段 D：Cloud transport foundation

仅在阶段 A-C 的本地 current contract 稳定后推进：

- [ ] 完成 authenticated WebSocket transport 的 tenant identity、protocol version、TLS、
      credential lifecycle 和 token redaction contract。
- [ ] 补跨网络 disconnect/reconnect/resume、tenant isolation、rate limit、audit 和
      credential leak negative tests；TUI/CLI 继续复用同一 session facade。
- [ ] 远程 queue、remote plugin catalog、Cloud managed permission profile、remote sandbox
      和 exec-server 测试仍对应 CLI ledger 的 81 个 `cloud-deferred` 条目。
- [ ] 未取得 LimeCore 服务端合同、租户隔离证明和真实远端 Gate B 前，不接入默认 CLI/TUI、
      Electron sidecar 或 npm production package，不创建假 Cloud endpoint。

退出条件：安全评审、服务端合同、真实 authenticated remote Gate B 和审计 evidence 全部具备。

## 8. 治理与删除

- [ ] 每个批次刷新 TUI/CLI structure、snapshot、test inventory，并把新增差异分类为
      `current/compat/deprecated/dead`。
- [ ] 零消费者后删除顶层 `tui/src/reconnect.rs`；旧路径只保留 retired guard/negative test。
- [ ] 对 `lime-cli`、`terminal-ui`、`TerminalGuard`、`TuiTerminal`、旧 runtime、旧
      crossterm registry、旧 launcher 命名增加结构负向测试。
- [ ] 若发现跨命令组 legacy policy/mock residual，登记 `tech-debt-tracker.md` 的 `CCD-012`，
      不在本计划中新增兼容层。

## 9. 验证门禁

每个阶段按最小边界验证，阶段收尾再扩大：

```bash
cargo test --locked -p tui -p cli
cargo clippy --locked -p tui --no-deps -- -D warnings
cargo clippy --locked -p cli --no-deps -- -D warnings
npx vitest run scripts/app-server/tui-structure-inventory.test.mjs
npx vitest run scripts/app-server/tui-snapshot-inventory.test.mjs
npm run test:contracts
npm run smoke:cli-gate-b
npm run smoke:tui-gate-b
npm run governance:legacy-report
npm --prefix packages/cli test
git diff --check
```

涉及协议/锁文件时追加 `cargo metadata --locked`、相关 App Server crate 测试和
`npm run test:rust:related -- <paths...>`；涉及真实 TUI 生命周期时必须追加 PTY、alternate
screen、键盘输入和终端恢复证据；涉及 Cloud 时必须追加服务端合同和 authenticated remote Gate B。

## 10. 完成定义

- TUI structure inventory 中所有 Codex current 能力均有 Lime current owner；聚合 Lime-only
  owner 已拆除或有明确保留理由。
- 991 个 snapshot 全部有 `direct/merge/contract/defer/dead` 分类，direct/merge/contract
  的可交付子集均有对应测试和证据，dead 不进入 current。
- TUI Codex-shaped integration suite 全绿；631 个 library、15 个 integration 和 1 个
  manager regression 测试不回退。
- CLI ledger 不再有 `missing/pending`；partial 逐项收口或有可验证 defer/excluded 记录。
- Desktop 与 CLI/TUI 仍消费同一个 App Server JSON-RPC/RuntimeCore/read model；Cloud 仍是
  authenticated transport 扩展点。
- `lime-cli`、`terminal-ui`、旧 runtime、旧 launcher 和第二套状态机无 current 引用，治理
  扫描通过。

本轮收尾验证（2026-09-12）：

- TUI library 586 tests、CLI all-targets 52 tests、TUI integration 15 tests 全部通过。
- TUI clippy `-D warnings`、fmt、diff-check、governance legacy report 全部通过。
- 当前仍未完成的工作以本计划 A3、C1/C2、D 及各阶段 `[ ]` 条目为准；不能标记为 complete。
- 当前分类：TUI/CLI current owner 与测试门禁可用；Codex 私有产品能力为 excluded/dead；
  尚无 Lime current contract 的历史、Cloud、MCP OAuth、marketplace、完整 Vim 和部分
  startup/working-directory 能力为 defer/partial；顶层 `reconnect.rs` 仍是 compat 委托壳。
- 本轮补充：`packages/cli/bin/lime.js` 的 package-root、可执行文件查找和包管理器归属
  helper 已改为 `lime*` 命名；npm launcher 8 个测试通过，CLI structure inventory 已刷新。
- 参考目录更新至 Codex `c4017a87aacc7558002b7cb510025e967c1d765e` 后，CLI 测试账本刷新为
  467 条：`missing/pending=0`，当前 `covered=50`、`partial=89`、`cloud-deferred=81`、
  `product-specific/excluded=247`。新增 exec-server auth/MCP OAuth 测试归 Cloud deferred，
  worktree/update 测试归 product-specific，sandbox TTY 保留 current contract partial。

本轮补充验证（2026-09-13）：

- startup protected-input boundary 已按 Codex 生命周期收口：首个无待处理启动请求的键盘/粘贴
  事件释放 boundary；可见 BottomPane 请求仍优先接收解决键，后台线程请求不阻塞主线程。
- TUI library 597/597、integration 15/15、manager regression 1/1、TUI Gate B（runtime、
  queue-edit、agents-overview、focus-palette、resize-reflow、reconnect、terminal restore）
  全部通过；结构 inventory 15/15、snapshot inventory 2/2、governance legacy report、
  test:contracts 和 `git diff --check` 通过。
- 本次新增与调整属于 `current`；没有新增 `compat` 或 `deprecated` surface。Codex `/cd`
  trust/config、fork/replace、后台 terminal 与 resume-cwd persistence 仍为
  `contract/defer`，不在 TUI 本地伪造。
- 本次补充：`/export` 无参数 destination/selection popup 与 filename prompt 已迁入
  `app/transcript_export.rs::ExportPicker` current owner；TestBackend 覆盖目的地选择、默认
  文件名、保存动作和渲染，TUI library 更新为 597/597。

本轮 A3 Vim composer 补充验证（2026-09-13）：

- TUI library 全量 629/629、TUI integration 15/15、manager dependency regression 1/1
  通过；其中新增 App `/vim` 切换、活动回合 Escape 边界、Normal 模式历史隔离和窄终端
  footer 指示器回归均通过。
- `npx vitest run scripts/app-server/tui-structure-inventory.test.mjs scripts/app-server/tui-snapshot-inventory.test.mjs`
  通过（17/17）；结构清单已登记 `textarea/vim.rs` 与 `vim_commands_tests.rs`。
- `npm run smoke:tui-gate-b` 通过：真实 `lime`、PTY、alternate screen、stdio App Server
  JSON-RPC、canonical Thread/Turn/Item projection、queue-edit、agents-overview、
  focus-palette、resize-reflow、reconnect 和 terminal restore 均有证据。
- 本轮改动分类为 `current`；没有新增 `compat`/`deprecated`。完整 Vim 行为与 Codex 私有
  keymap/search/history 能力继续保持 `partial/defer`，本计划总体仍为 `in-progress`。

本轮 A2 transcript overlay 补充验证（2026-09-13）：

- `pager_overlay.rs` 的 transcript overlay 现在按 Codex 语义保留手动滚动锚点：前置历史时
  按新增逻辑行偏移，终端宽度变化时按重排后的逻辑行首映射；底部 pinned 状态继续跟随
  最新尾部，静态 status pager 不共享该缓存。
- 新增前置历史与窄终端重排 TestBackend 回归；pager overlay 定向测试 8/8，TUI library
  631/631、integration 15/15、manager regression 1/1、fmt、TUI clippy、结构/快照
  inventory 17/17 和 `git diff --check` 均通过。
- `npm run smoke:tui-gate-b` 重新通过：真实 PTY、alternate screen、stdio App Server
  JSON-RPC、canonical Thread/Turn/Item projection、queue-edit、agents-overview、
  focus-palette、resize-reflow、reconnect 与 terminal restore 均有证据。
- 本轮改动属于 `current`，没有新增 `compat`/`deprecated`。review prompt filtering 已完成
  current 迁移并由纯过滤器、完整 hydration、实时边界与 canonical repair 回归覆盖；分页跨页
  nested-review reconciliation、MCP/file-activity details 与剩余 history/transcript contract
  场景仍为 `defer`/未完成。

本轮 A2 persisted-history hydration 补充（2026-09-13）：

- `thread_transcript.rs` 现在先通过只读 `thread/read(includeTurns=false)` 获取 canonical Thread
  metadata，避免 resume picker 预览触发 `thread/resume` 的队列唤醒或归档拒绝。Legacy 线程
  继续通过 `thread/read(includeTurns=true)` 获取完整 Turn/Item；Paginated 线程则从
  `thread/items/list(cursor=None)` 按 descending 页面读取全部 Item，按服务端时间顺序重组后
  复用 `ConversationProjection`，resume picker preview 与完整 transcript 共用同一 loader。
- 分页后续 nextCursor 通过唯一 cursor 集合 fail-closed；新增多页顺序与重复 cursor 回归，不创建
  本地 history store，不伪造 Turn status。分页页面缺失 Turn status 时，跨页 nested-review 过滤继续
  明确 defer。归档线程保留只读 `thread/read` 路径。
- TUI library 643/643、TUI Clippy `-D warnings`、workspace fmt、`git diff --check` 已通过；
  结构/snapshot inventory 17/17 与真实 `npm run smoke:tui-gate-b` 均通过。Gate B 线程为
  `01a097e1-afaf-7012-b734-f52b83ba6213`，回合为 `turn_38d084cfd5c7457bb3949b0c330ec14d`。

本轮 A3 Ctrl-C composer 语义补充（2026-09-13）：

- 对照 Codex `ChatComposer::clear_for_ctrl_c`、`BottomPane::on_ctrl_c` 与
  `ChatWidget::on_ctrl_c`，Lime `ChatComposer` 新增纯文本草稿清理 owner：Ctrl-C 会清空草稿、
  写入本地文本历史并重置历史导航；空闲状态可立即通过 Up 恢复，活动回合仍返回
  `AppAction::Interrupt`，不改变 RuntimeCore/App Server 中断主链。
- 含本地或远程图片的草稿暂不清空，保持 fail-closed，避免当前 Lime 纯文本历史伪造或
  丢失 canonical 附件；该富历史能力继续分类为 `partial/defer`，没有新增 compat/deprecated
  surface，也没有复制 Codex rollout/history DB。
- App connected input 回归覆盖 idle plain-text draft、active-turn draft 和 attachment draft；
  ChatComposer 回归覆盖 Ctrl-C 清空、Up 恢复和附件保留。
- 本轮改动仍保持 `TUI Host -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item`
  单主链；断开态 Ctrl-C 的现有退出语义未混入本刀。

本轮 A3 MCP elicitation approval 补充（2026-09-13）：

- `bottom_pane/mcp_server_elicitation.rs` 现在按 Codex 的 message-only form 语义处理合法空对象
  schema：普通空 schema 进入 Allow / Deny / Cancel 选择面，`_meta.persist` 暴露 session / always
  选项，接受动作发送带空对象 `content` 的 typed v2 response；所有 action/content/meta 组合继续
  通过 App Server `McpServerElicitationRequestResponse::validate`。
- `_meta.codex_approval_kind=tool_suggestion` 仍 fail closed，因为 Lime 没有当前 tool
  suggestion enable/install consumer；不伪造 Codex 私有插件/connector side effect，也不新增
  compat/fallback。MCP 表单字段（string、boolean、single-select）保持原有 current owner。
- 五语言 approval option 文案已补齐；BottomPane 回归覆盖空 schema accept、decline、持久化
  accept，以及 tool-suggestion 负向守卫。
- 验证：MCP elicitation 定向测试 9/9，BottomPane unsupported-request 回归 1/1；完整 TUI
  library 669/669、integration 15/15、manager regression 1/1，TUI Clippy、workspace fmt、
  结构/snapshot inventory 和 `git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 仍覆盖
  PTY/alternate-screen/stdio/App Server 主链；当前 Gate B 未包含真实 MCP server elicitation，
  该跨层 fixture 保持下一步 contract 任务，不以单元测试冒充。

下一执行批次：**A2 remaining history/transcript contract**，优先补齐 MCP/file-activity details、
剩余 history/transcript contract 与具备 Turn status contract 后的分页跨页 nested-review reconciliation；
startup protected-input、
reconnect、resize 和 working-directory 的可用 current 子集已具备真实 PTY/App Server 证据。
不并行扩张 Cloud，也不复制 Codex 产品专属模块。

本轮 Gate B 诊断与收口（2026-09-13）：

- `queue-edit` 单场景曾在等待 `interrupted` 时超时；只读 PTY 输出确认 App Server 已发送
  `thread/status/changed` 与 `turn/completed`，且 Ratatui 已把头部从 `interrupting` 更新为
  `interrupted`。失败根因是测试 helper 仅剥离 ANSI 后串接增量写入，无法从差分片段（例如
  只写入 `ed `）重建当前屏幕文本，不是客户端通知反序列化或 projection 路由缺陷。
- `runtime_pty_tests.rs` 的状态等待改为复用现有 `vt100::Parser` 屏幕投影
  `wait_for_screen_marker`；移除临时子进程/接收诊断。增量历史文本标记仍保留原 helper，避免
  改变其它场景的等待语义。
- 验证：`LIME_TUI_GATE_B_SCENARIOS=queue-edit npm run smoke:tui-gate-b`、
  `npm run smoke:tui-gate-b`、`cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui`
  （653 library、15 integration、1 manager regression）、
  `cargo clippy --locked --manifest-path lime-rs/Cargo.toml -p tui --no-deps -- -D warnings`、
  `cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、结构/快照 inventory
  （17/17）及 `git diff --check` 均通过。
- 本轮没有新增 current/compat/deprecated surface；Gate B 已恢复为可交付状态。总体计划仍为
  `in-progress`，下一刀继续 A2 remaining history/transcript contract。

本轮 A2 Web Search history detail（2026-09-13）：

- `projection.rs` 复用 `agent_protocol::response_item::WebSearchAction` 的 typed 反序列化，
  把 v2 `WebSearchItem.action` 的 Search/OpenPage/FindInPage detail 转成稳定的 canonical
  transcript text；`Other`、字符串、未知类型和 malformed 字段 fail-closed 回退 `query`，
  不把任意 action JSON 原文带入终端。
- 新增多 query、URL/pattern、空 detail、malformed/unknown fallback 以及五语言 entry-boundary
  文案回归；长文本继续由现有 transcript/pager wrapping owner 处理。该切片属于 `current`，
  没有新增 `compat`/`deprecated`，也不改变 App Server protocol/schema。
- 定向验证：`cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui --lib projection::tests`
  21/21 通过；完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为
  library 656/656、integration 15/15、manager regression 1/1；TUI Clippy、fmt、结构/
  snapshot inventory 17/17、`git diff --check` 与 `npm run smoke:tui-gate-b` 均通过。
  Gate B 线程为 `01a0985c-9647-7382-ab8a-08d1f94c13a8`，回合为
  `turn_9b13a4b9a8fa4fc4916901dc143c832f`。

本轮 A2 Web Search lifecycle（2026-09-13）：

- 对照 Codex `history_cell/search.rs` 的 `Searching the web`/`Searched the web` 语义，
  Lime 在唯一 `projection.rs` owner 中仅使用实时 JSON-RPC 生命周期证明状态：
  `ItemStarted(WebSearchItem)` 显示 `searching the web`，`ItemCompleted(WebSearchItem)` 显示
  `searched the web for ...`；无 query/action 时分别显示不带 detail 的状态文案。
- persisted `ThreadItem::WebSearch` 仍走 status-agnostic historical projection，显示稳定的
  `web search: ...`；因为 v2 `WebSearchItem` 不含 status 字段，历史 hydration、分页和导出
  不猜测 running/completed，也不扩展 App Server schema。五语言 entry-boundary detail 前缀
  已补齐，未知 action 继续 fail-closed 回退 canonical query。
- 新增实时 started/completed 替换、历史 status-agnostic 回归，以及 completed turn canonical
  repair 不降级已完成 WebSearch 文案的回归；该切片属于 `current`，没有新增
  `compat`/`deprecated` surface，也没有第二套 history store 或 wire parser。由于 v2
  `WebSearchItem` 不含 status 字段，未伪造历史实时状态；五语言 detail 仍在 entry boundary
  统一本地化。
- 验证：`projection::tests` 27/27；完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui`
  为 680 library、15 integration、1 manager regression；TUI Clippy `-D warnings`、workspace fmt、
  结构/snapshot inventory 17/17 与 `git diff --check` 通过。真实 Gate B
  已通过：thread `01a0993f-e24b-7bf3-8b00-9e3d85e460b5`、turn
  `turn_f81ba7a78ea1422e9e5ec4267b1428f9`；事件为
  `turn.started,message.delta,item.started,item.completed,turn.completed`，queue-edit、
  agents-overview、focus-palette、resize-reflow、reconnect 和 terminal restore 均为 `ok`。
  Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options`
  dead-code 警告，非本切片引入。

本轮 A2 persisted nested-review hydration（2026-09-13）：

- `thread_transcript.rs` 在 paginated transcript loader 中增加只读
  `thread/turns/list(itemsView=notLoaded)` 分页；turn 与 item 页面均按 descending cursor
  重新组装为临时 canonical `Thread`，再复用 `ConversationProjection::hydrate_thread` 和
  `history_filter::hidden_user_message_ids`。因此跨 item page 的“已完成 review turn + 未完成
  interrupted 子 turn”重复 prompt 现在按 Codex 规则隐藏，且不引入本地 history store。
- turn/item 关联缺失、分页 cursor 重复或旧 App Server 不提供 turn list 时，loader 保留 flat
  item projection，明确 fail-closed，不猜测 Turn status，也不隐藏可能是用户输入的内容。
- 新增跨页 nested-review 和未知 turn metadata 回归；TUI library 658/658、integration
  15/15、manager regression 1/1、TUI Clippy、fmt、结构/snapshot inventory 17/17 与
  `git diff --check` 通过。App Server 分页 contract 定向测试因本机 `rusty_v8 v150.4.0`
  预构建包不存在（下载返回 HTTP 404）未能启动，待工具链缓存/版本恢复后重跑。
- 本切片属于 `current`，没有新增 `compat`/`deprecated`；主 TUI transcript overlay 的
  older-page runtime reconciliation 仍需沿用同一 turn metadata contract，MCP 原始媒体与
  file-activity 富内容继续按 canonical 字段可用性逐项收口。

本轮 A2 MCP canonical summary 补充（2026-09-13）：

- `projection.rs` 继续作为唯一 MCP 投影 owner：对 App Server 已限界的 canonical 结果增加文本
  output preview（首行、最多 160 字符、最多 4 条）、structured content compact JSON、内容类型
  计数、`truncated`/`output available` 标记、错误和耗时；未知 content block 只计为 `unknown`，
  不解码媒体或把任意 wire body 带入 TUI。现有 MCP invocation 标题仍显示紧凑参数 JSON。
- `Locale::detail` 已补齐 `output:` 的 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` 文案；
  projection 回归同步覆盖 output 与 structured content 的完整摘要文本。新增回归锁定多行文本
  只取首行、超过 160 字符追加省略号，以及最多保留 4 条文本 preview。
- 本切片属于 `current`，没有新增 `compat`/`deprecated`。Codex 专用的逐媒体/资源正文渲染、
  更丰富的多行宽度截断和 export-only structured result 仍受 Lime canonical 字段边界限制，
  继续分类为 `contract/defer`，不在 TUI 伪造第二套 wire 解析或历史存储。
- 验证：`cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui`（659 library、15
  integration、1 manager regression）通过；`projection::tests` 22/22、TUI Clippy
  `-D warnings`、workspace fmt check、结构/快照 inventory 17/17、`git diff --check` 和
  `npm run smoke:tui-gate-b` 均通过。Gate B 线程为
  `01a09886-44d2-7532-9380-94f489c13a46`，回合为 `turn_9c171a0a164343cc809dd60470b8708c`。
- 本切片未修改 App Server protocol/schema；App Server contract 全量测试未在本刀重复执行，
  既有环境阻塞仍是 `rusty_v8 v150.4.0` 预构建包下载返回 HTTP 404，待工具链缓存恢复后补跑。

本轮 A2 用户图片 history/export 对齐（2026-09-13）：

- `projection.rs` 继续作为 live `item/completed` 与 persisted Thread hydration 的唯一用户输入
  投影 owner：`UserInput::Image` 和 `UserInput::LocalImage` 只保留图片数量与原始顺序，形成内部
  `image: N` 摘要；远程 URL、data URL 和本地路径均不进入 `TranscriptEntry.text`。文本、skill
  与 mention 仍进入用户消息正文，不扩展 App Server v2 protocol/schema。
- `entry.rs` 在终端边界把内部图片摘要渲染为独立编号行；`Locale::numbered_image_label` 覆盖
  zh-CN `[图片 #N]`、zh-TW `[圖片 #N]`、en-US `[Image #N]`、ja-JP `[画像 #N]` 与
  ko-KR `[이미지 #N]`。图片行不复用普通 activity 的 `- detail` 前缀。
- `app/transcript_export.rs` 按同一 canonical 摘要把图片编号写入 Markdown 用户消息正文；
  纯图片输入仍保留 `## User` 段，且不导出内部 `image: N` token、图片 URI、data URL 或
  本地路径。resume picker 与 Codex 一致保持 text-only preview，不在缺少 canonical 文本时
  伪造图片预览。
- 本切片属于 `current`，没有新增 `compat` 或 `deprecated` surface。MCP 原始媒体/资源正文、
  相邻 `ComputerActivityCell` 聚合和更丰富的 file-activity detail 仍受 canonical producer/consumer
  字段限制，继续分类为 `contract/defer`；不得在 TUI 增加第二套 wire parser、history store 或
  rollout DB。
- 验证：`projection::tests` 23/23、`entry::tests` 6/6、
  `app::transcript_export::tests` 8/8；完整 TUI 为 library 672/672、integration 15/15、
  manager regression 1/1。TUI Clippy `-D warnings`、workspace fmt check、结构/snapshot
  inventory 17/17 与 `git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 通过，线程为
  `01a098cf-3dc6-7f71-b061-c8058f5c9f23`，回合为
  `turn_1b9f9bc4af1a4241bb4166c6a712bb46`；`queue-edit`、`agents-overview`、
  `focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间
  仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，
  非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 MCP result history-cell owner 对齐（2026-09-13）：

- MCP canonical result 摘要从 `projection.rs` 下沉到独立的 `history_cell/mcp_result.rs` owner；投影层只复用该 owner 的 invocation、summary 与 bounded text 事实。摘要仅消费 App Server v2 已限界的 `content`、`structured_content`、`meta` 与 error/duration：文本 preview 取首行、最多 160 字符、最多 4 条，补充内容类型计数、`truncated`/`output available` 标记和紧凑 structured JSON。
- image/audio/resource/未知 content block 不解码、不保留正文或 URI，仅计入类型事实；未知 wire payload、原始媒体/资源正文和更丰富的 export-only 结构继续按 canonical 边界 `contract/defer`，不新增第二套 parser、history store、protocol/schema 或 mock fallback。
- `history_cell/mcp_result.rs` 新增 2 个单元回归，覆盖 bounded text、结构化事实、媒体/资源/未知块 fail-closed 与 preview 截断；结构 inventory 期望同步锁定该 owner。该切片属于 `current`，没有新增 `compat`/`deprecated` surface。
- 验证：MCP owner 定向测试 2/2；`cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为 682 library、15 integration、1 manager regression；TUI Clippy `--lib --no-deps -- -D warnings`、workspace fmt check、结构/snapshot inventory 17/17 与 `git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 通过，thread `01a09963-2f05-7093-9daf-aab827f906f5`、turn `turn_e8d86225a587403bb5c873775f8fdf87`；事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 FileChange history/export 对齐（2026-09-13）：

- ThreadItem::FileChange 继续只消费 App Server v2 canonical status/changes/diff；终端正文保留逐文件路径、rename 目标与 diff，摘要保留 files/add/delete/update 计数，不新增协议字段或本地 patch/history store。
- Markdown export 现在保留仅有摘要的 FileChange activity，并从 canonical EntryStatus 与 files: N 生成 Codex 风格 file changes: <status> · N changes 头部；已有逐文件 diff、ANSI 清理与图片导出语义保持不变。persisted/live transcript 共享同一 projection，不再因正文为空丢弃合法的零变更或失败 patch 条目。
- 本切片属于 current，没有新增 compat/deprecated。MCP 媒体/资源逐项 export 仍需先确认 canonical content producer 的边界，未在 TUI 伪造原始 wire 解码。
- 验证：app::transcript_export::tests 10/10、projection::tests 23/23；完整 TUI library 674/674、integration 15/15、manager regression 1/1；TUI Clippy -D warnings、workspace fmt check、结构/snapshot inventory 17/17、git diff --check 均通过。真实 npm run smoke:tui-gate-b 通过，线程为 01a098e4-f271-7b13-8491-1cc4fbe8e27e，回合为 turn_133013e8f71348748d10bfbb7e951da6；queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 和 terminal restore 均为 ok。App Server 既有 lower_turn_start_params、lower_runtime_options dead-code 警告非本切片引入。

本轮 A2 persisted export canonical loader + persisted/live merge（2026-09-13）：

- `runtime.rs::export_transcript_with` 改为异步复用现有 `thread_transcript::load_session_transcript_with_handle`，优先读取 App Server persisted Thread/Turn/Item；加载失败、缺少 thread id 或请求句柄不可用时回退当前 live projection，不新增 history store、wire parser 或 mock fallback。
- `merge_export_entries` 保持 persisted 顺序；同 ID 由 live 最新 entry 覆盖，persisted 中尚未落盘的新 live entry 追加到末尾，避免进行中或尚未持久化内容在 `/export` 中丢失。Markdown export 继续复用既有 canonical renderer、路径 noclobber 与 clipboard 边界。
- 新增 `export_merge_keeps_persisted_order_and_latest_live_entries` 回归，锁定同 ID 覆盖、顺序保持和新条目追加；该切片属于 `current`，没有新增 `compat`/`deprecated` surface。
- 验证：真实 `npm run smoke:tui-gate-b` 通过，线程为 `01a098ff-ad6b-7be3-a654-7e2895c032ab`，回合为 `turn_28627348942544eda6752a11456169d8`；`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。`cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui`（675 library、15 integration、1 manager regression）、TUI Clippy `-D warnings`、workspace fmt check、结构/snapshot inventory 17/17 与 `git diff --check` 均通过；Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告。总体计划继续保持 `in-progress`。

本轮 A2 DynamicToolCall history/transcript bounded summary（2026-09-13）：

- `projection.rs` 继续作为唯一 DynamicToolCall canonical consumer：复用 v2 `DynamicToolCallOutputContentItem`，对 `InputText` 提取首行、最多 160 字符、最多 4 条 `output:` preview；`InputImage`/`InputAudio` 仅保留既有 `content items` 计数，不把 image/audio URL 或媒体正文写入 `TranscriptEntry.summary`。
- Markdown export 继续复用同一 `TranscriptEntry.summary`，因此 persisted/live export 可见 bounded 文本事实，同时保持 Codex/Lime 的媒体 fail-closed 边界；没有扩展 App Server schema、增加 wire parser、history store 或 mock fallback。
- 新增 projection 回归覆盖多行首行选择、160 字符省略、最多 4 条 preview、媒体 URL 不泄露；本切片属于 `current`，没有新增 `compat`/`deprecated` surface。
- 验证：`projection::tests` 24/24；完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为 676 library、15 integration、1 manager regression；TUI Clippy `-D warnings`、workspace fmt check、结构/snapshot inventory 17/17 与 `git diff --check` 通过。真实 `npm run smoke:tui-gate-b` 通过，线程为 `01a0990b-85c2-77e1-bf33-4954a9c00cb6`，回合为 `turn_f834ac084d614cfca0ecfdc17c2cf76a`；`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 ImageView history/display 路径对齐（2026-09-13）：

- `diff_render::display_path_for` 提取为共享路径显示 owner；`entry.rs` 在终端渲染边界识别 `view image: ...`，把当前 cwd 下的绝对路径归一化为相对路径后再交给 Locale 处理，其他 Tool/System 详情保持原样。canonical `TranscriptEntry`、App Server v2 schema、persisted loader 与 Markdown export 均不变。
- 新增 `image_view_paths_are_relative_to_the_current_working_directory` 回归，锁定 `/workspace/assets/result.png` 在 `/workspace` cwd 下显示为 `assets/result.png`，不暴露冗长绝对路径；该切片属于 `current`，没有新增 `compat`/`deprecated` surface。
- 验证：`entry::tests` 7/7、完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为 677 library、15 integration、1 manager regression；TUI Clippy `-D warnings`、workspace fmt check、结构/snapshot inventory 17/17 与 `git diff --check` 通过。真实 `npm run smoke:tui-gate-b` 通过，线程为 `01a09915-8b45-7ce1-9826-a8f81fd1b65b`，回合为 `turn_0f9f3097bc2946e5ad090eacb6ae4766`；`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 Sleep history visibility 对齐（2026-09-13）：

- `projection.rs` 将 v2 `ThreadItem::Sleep` 按 Codex `thread_transcript`/`agent_status_feed` 语义视为内部 runtime control item，直接 fail-closed，不进入 `TranscriptEntry`、transcript overlay、persisted export 或 agent status feed；同时移除唯一无消费者的 `sleep:` locale 前缀。
- 新增 projection 回归锁定 `SleepItem` 不产生 transcript entry；该切片属于 `current`，没有新增 `compat`/`deprecated` surface，不改变 App Server v2 schema 或 runtime 行为。
- 验证：`projection::tests` 24/24、`entry::tests` 7/7；完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为 677 library、15 integration、1 manager regression；TUI Clippy `-D warnings`、workspace fmt check、结构/snapshot inventory 17/17 与 `git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 通过，线程为 `01a0991f-3b10-7e61-80df-768a0c03d28f`，回合为 `turn_8df4cbc170b342a6936f49557afae52d`；`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 ImageGeneration history/export 边界对齐（2026-09-13）：

- `projection.rs` 按 Codex history cell 语义不再把 `ImageGenerationItem.result`（通常为媒体 URL 或 data payload）写入 `TranscriptEntry.summary`；仅保留 canonical `saved_path` 与 `revised_prompt`，状态继续由 `EntryStatus` 映射。这样终端与 Markdown export 不会泄露媒体地址或原始结果正文。
- 新增 projection 回归锁定结果 URL 不进入 summary；该切片属于 `current`，没有新增 `compat`/`deprecated` surface，不改变 App Server v2 schema、运行时生成或保存路径语义。
- 验证：`projection::tests` 24/24、`app::transcript_export::tests` 10/10；完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为 677 library、15 integration、1 manager regression；TUI Clippy `-D warnings`、workspace fmt check、结构/snapshot inventory 17/17 与 `git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 通过，线程为 `01a09923-658c-7181-96a6-de31df43c83c`，回合为 `turn_713b3a2adc204192856841eca424e79a`；`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 Web Search history-cell owner 收敛（2026-09-13）：

- 新增 `history_cell/search.rs` 作为 Codex-shaped Web Search action detail owner；`projection.rs` 不再持有本地解析实现，只复用该 owner。对 v2 `WebSearchAction` typed 解析 `Search`、`OpenPage`、`FindInPage` 和 `Other`，多 query 仅保留首项并以 `...` 标记；未知 action、malformed payload、字符串或不支持字段均 fail-closed 回退 canonical query。
- Started/Completed/Historical 生命周期文案、入口边界多语言映射和 persisted status-agnostic projection 保持不变；未扩展 App Server protocol/schema，也未新增兼容包装或第二套 wire parser。未知 action 字段继续按 `contract/defer` 处理。该切片属于 `current`，没有新增 `compat` 或 `deprecated` surface。
- 新增 Web Search owner 定向回归 2/2，覆盖 typed action detail 与 malformed/unknown fallback；结构 inventory 同步锁定 `history_cell/search.rs`。
- 验证：`projection::tests` 27/27；完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为 684 library、15 integration、1 manager regression；TUI Clippy `--lib --no-deps -- -D warnings`、workspace fmt check、结构/snapshot inventory 17/17 与 `git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 通过，thread `01a09971-fca9-7d82-b67d-7af821174202`、turn `turn_e40bb6dbd06b44cdb6a9c22f6259ee93`；事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 Hook lifecycle transcript/status 对齐（2026-09-13）：

- `projection.rs` 接入 App Server v2 `hook/started` 与 `hook/completed` 通知，维护按 turn 关联的 active Hook 运行状态；单个 Hook 显示 status message 或 `running hook`，多个同消息 Hook 复用该消息，不同消息 fail-closed 为 `running hooks`。Hook completion 会清理对应 active 状态，并将失败、阻断、停止及带用户可见输出的结果投影为 bounded system transcript entry。
- 新增 `history_cell/hook.rs` 作为唯一 Hook display-fact owner：Context-only 成功 Hook 静默，不把 model-facing Context 写入 transcript；非 Context 输出最多 4 条，每条取首行并限制 160 字符。未复制 Codex 私有 HookCell 定时状态机、history DB 或 rollout DB。
- `Locale::status`/`Locale::detail` 已覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` 的 `running hook(s)`、`hook completed/failed/blocked/stopped` 与 `hook output:` 文案；结构 inventory 锁定 Lime `history_cell/hook.rs`，同时保留 Codex `history_cell/hook_cell.rs` 作为上游基线。
- 本切片属于 `current`，没有新增 `compat`/`deprecated`，未修改 App Server protocol/schema。当前 Hook summary 只由实时通知提供，canonical `ThreadItem` 尚不携带 `HookRunSummary`；因此 persisted history/export 不伪造 Hook completion，继续标记为 `contract/defer`，待 canonical producer 提供持久化字段后再收口。
- 验证：Hook owner 定向测试 2/2；`projection::tests` 41/41；Locale 定向测试 21/21；`cargo fmt --manifest-path lime-rs/Cargo.toml --all` 通过；结构 inventory 已刷新为 Codex/Lime 合计 859 个 Rust 文件。完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 通过（691 library、15 integration、1 manager regression）；TUI Clippy `--lib --no-deps -- -D warnings`、结构/snapshot Vitest 17/17、`git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 通过，thread `01a0998c-08a0-7fc0-8228-2b09c975422e`、turn `turn_90b335d8fc1443c6934f358cb964e895`；事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 MessagePhase final-answer 语义修复（2026-09-13）：

- `ConversationProjection` 在唯一 TUI canonical projection owner 内维护 assistant item 的 `MessagePhase` 索引。`Commentary` 仍进入 transcript 供用户查看，但不再被 `final_answer()` 误选；`FinalAnswer` 作为最终回答，`phase=None` 继续保留 legacy 行为。hydrate、prepend、实时 `ItemStarted`/`ItemCompleted` 与 `TurnCompleted` canonical repair 均同步 phase，hydrate 时清理索引避免跨线程残留。
- 不扩展 `TranscriptEntry`、App Server protocol/schema 或新增过滤投影；resume preview、transcript overlay 与 export 继续复用同一 canonical transcript。该切片属于 `current`，没有新增 `compat`/`deprecated` surface。
- 新增回归覆盖 Commentary 可见但非最终回答、FinalAnswer 覆盖旧 Commentary、legacy 无 phase、实时流式 phase 修复和 persisted hydrate。
- 验证：`projection::tests` 37/37；完整 `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 通过（696 library、15 integration、1 manager regression）；TUI Clippy `--lib --no-deps -- -D warnings`、`cargo fmt --check`、结构/snapshot Vitest 17/17、`git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 通过，thread `01a099ab-da21-75a3-ab59-ddbf93c5edb4`、turn `turn_1d5d76ce99284a60b01c91a004af0a34`；事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有 `lower_turn_start_params`、`lower_runtime_options` dead-code 警告，非本切片引入。总体计划继续保持 `in-progress`。

本轮 A3 ComposerDraft 共享快照对齐（2026-09-13）：

- `bottom_pane/chat_composer/draft_state.rs` 建立 Lime 唯一 `ComposerDraft` owner，统一保存文本、UTF-8 安全游标以及本地/远程图片附件状态；快照字节预算与 Vim undo/redo 共用同一实现，避免历史搜索、历史导航和 Vim 各自维护重复快照。
- `history_search.rs` 的 `HistorySearchState` 改为保存完整 `ComposerDraft`。搜索取消、断线编辑取消预览和无匹配恢复均通过同一 `restore_draft`，因此会保留原始游标与附件；历史导航的 unsent draft 也改为同一快照。未引入 Codex 私有 text elements、mention、paste 或 rollout/history DB 字段，缺失能力继续是 `partial/defer`。
- `ChatComposer` 只保留一个 capture/restore 边界；Vim history 复用该边界并继续把文本/附件编辑作为单一事务。footer 与 command popup 在恢复后同步，避免取消搜索残留 HistorySearch 状态。
- 本切片属于 `current`，没有新增 `compat`/`deprecated` surface，也未修改 App Server protocol/schema；生产链仍为 `TUI Host -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item`。
- 新增回归覆盖历史搜索取消后游标、附件和 footer 草稿状态保持不变；既有 Vim 文本、Unicode、附件、远程图片、历史搜索和断线恢复测试继续通过。
- 验证：composer 定向测试 43/43；完整 `cargo test --locked --manifest-path "lime-rs/Cargo.toml" -p tui --lib` 697/697；TUI Clippy `--lib --no-deps -- -D warnings`、`cargo fmt --manifest-path "lime-rs/Cargo.toml" --all -- --check` 与 `git diff --check` 通过。总体计划继续保持 `in-progress`。

本轮 A3 Skills `$` mention popup 对齐（2026-09-13）：

- `bottom_pane/chat_composer/skill_popup.rs` 建立 Codex-shaped current owner：消费 App Server
  `skills/list` 返回的 enabled `SkillMetadata`，支持大小写无关的子序列筛选、稳定排序、最多
  8 行、Up/Down 与 Ctrl-P/Ctrl-N 循环选择、Enter/Tab 补全、Esc dismissal 和窄终端截断。
  Popup 只负责展示与选择，技能路径仍由 canonical `SkillMetadata.path` 提供，不读取本地
  skill 目录或创建第二份缓存。
- `app/startup.rs` 将真实 `skills/list` 响应注入 `ChatComposer`；`ChatComposer` 维护唯一
  `$` token range/dismissal 状态，并与现有 slash/`@` file popup 互斥。补全写回 `$name` 和
  分隔空格，重复 token dismissal 按 occurrence 区分；`view.rs`/App event routing 同步接入。
- runtime 提交路径按已加载 catalog 为精确 `$name` 追加 `UserInput::Skill { name, path }`，
  保留原始 prompt 文本和图片顺序；queue edit/preview 接受 Skill part 并恢复为可编辑 `$name`
  前缀。未匹配的 shell 变量、未知 `$token` 和空 skills catalog 不会制造 Skill input。
- 本切片属于 `current`，无新增 `compat`/`deprecated`。Codex 私有 connectors/plugins、完整
  atomic text-element binding、skills 管理 UI 与 marketplace 仍无 Lime current consumer，继续
  分类为 `contract/defer` 或 `excluded`，没有伪造协议字段、local history store 或 mock fallback。
- 验证：skill popup/composer 定向测试 4/4，submission lowering 定向测试 1/1；完整 TUI
  library 708/708、TUI Clippy `--lib --no-deps -- -D warnings`、workspace fmt check、
  TUI structure/snapshot inventory 18/18 与 `git diff --check` 通过。App Server protocol/schema
  未修改，Gate B 需在下一轮真实启动后补跑；总体计划继续保持 `in-progress`。

本轮 A3 Skills `$` current 收口与 catalog refresh（2026-09-13）：

- 复核并补齐 `skill_popup` 的 Ctrl-P/Ctrl-N、shell `$HOME`/`$1` fail-closed 与 UTF-8 token
  边界回归；skill popup/composer 定向测试实际为 6/6。完整 TUI library 测试为 716/716，
  没有引入 provider 侧重复 Skill 文本注入；`UserInput::Skill` 继续由 App Server/runtime
  的结构化输入 owner 消费，prompt 文本仅作为用户可见原文保留。
- 对齐 Codex `SkillsChanged` 行为：`app_server_events.rs` 收到真实 App Server
  `skills/changed` 通知后调用 `skills/list(forceReload=true)`，通过 `startup::apply_skills_list_response`
  原子更新 composer enabled catalog 与 skill load warning；启动和运行时刷新共用同一投影
  helper，没有本地 skills store、mock fallback 或第二套 runtime。新增回归锁定 disabled skill
  不进入 `$` 补全目录。
- 该切片属于 `current`，未修改 App Server protocol/schema，也未新增 `compat`/`deprecated`。
  Codex 私有 atomic text-element binding、skills 管理 UI、marketplace 与 plugin mention
  继续分类为 `contract/defer` 或 `excluded`。
- 验证：`cargo test --locked --manifest-path "lime-rs/Cargo.toml" -p tui --lib` 716/716；
  `cargo clippy --locked --manifest-path "lime-rs/Cargo.toml" -p tui --lib --no-deps -- -D warnings`；
  `npm run inventory:tui-structure`、结构/snapshot Vitest 18/18、`npm run test:contracts`、
  `npm run smoke:tui-gate-b` 与 `git diff --check` 均通过。Gate B 证明真实 PTY、alternate
  screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、queue-edit、agents-overview、
  focus-palette、resize-reflow、reconnect 和 terminal restore；编译期间仍有既有
  `lower_turn_start_params`/`lower_runtime_options` dead-code 警告，非本切片引入。总体计划
  继续保持 `in-progress`。

本轮 A2 CUA MCP display facts（2026-09-13）：

- 新增 `history_cell/computer_activity.rs` 作为 CUA-backed MCP 的唯一 display-fact owner。
  对 canonical `server == "cua_repl"` 的 `McpToolCall`，保留参数中的有界 `title`、截图块数量
  和首行失败诊断；原始图片/音频/资源正文、provider 手册和跨 item 相邻调用均不进入
  `TranscriptEntry`，不新增协议字段、wire parser 或 history store。
- `projection.rs` 继续保持每个 canonical MCP item 一个 entry，并在既有 MCP result summary
  后追加 CUA facts；调用 ID、server/tool/arguments 和状态仍由原有 projection 保留，待协议
  具备稳定分组/Turn 边界后再评估 Codex `ComputerActivityCell` 的相邻聚合。
- `Locale::detail` 补齐 computer action/error/screenshot 的 `zh-CN`、`zh-TW`、`en-US`、
  `ja-JP`、`ko-KR` 映射。该切片属于 `current`，没有新增 `compat`/`deprecated` surface。
- 定向回归覆盖截图事实和 provider 错误首行截断；完整 TUI 为 `718` library、`15` integration、
  `1` manager regression，Clippy `-D warnings`、workspace fmt check、结构/snapshot inventory
  `18/18`、`npm run test:contracts`、真实 `npm run smoke:tui-gate-b` 与 `git diff --check` 均通过。
  Gate B 证明真实 PTY、alternate screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、
  queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 和 terminal restore；编译
  期间仍有 App Server 既有 `lower_turn_start_params`/`lower_runtime_options` dead-code 警告，
  非本切片引入。总体计划继续保持 `in-progress`。

本轮 A2 MCP startup diagnostics（2026-09-13）：

- `app/startup_prompts.rs` 新增 `McpStartupWarningState`，消费 App Server v2
  `McpServerStatusUpdated` canonical notification。Failed/Cancelled 按服务器名去重并保留可选
  错误，Ready 只清除对应服务器；Starting 不制造虚假失败状态。
- App header 与 status pager 通过 `App::status_value()` 复用该状态；active turn、Hook status
  和显式命令状态优先，MCP startup 诊断只在 ready/空闲状态显示。该诊断不写入
  `TranscriptEntry`、不新增 history store，也不改变 protocol/schema。
- `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` 的 status 前缀和 server/error 动态尾部均有回归；
  App-scoped notification 的失败、Ready 清理和状态优先级均有测试。该切片属于 `current`，
  没有新增 `compat`/`deprecated` surface。
- 验证已完成：`cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 为
  `721 library + 15 integration + 1 manager regression`，TUI Clippy `--lib --no-deps -- -D warnings`、
  workspace `cargo fmt --check`、`npm run inventory:tui-structure`、结构/snapshot Vitest
  `18/18`、`npm run test:contracts`、`npm run smoke:tui-gate-b` 和 `git diff --check` 均通过。
  Gate B 真实线程为 `01a09a70-d2fc-7601-80b9-423c40c4abc3`，回合为
  `turn_494f9631329e489a9394d5dacf733fa0`，事件为
  `turn.started,message.delta,item.started,item.completed,turn.completed`，并证明
  `queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 与
  terminal restore 均为 `ok`。Gate B 编译期间仍有 App Server 既有
  `lower_turn_start_params`/`lower_runtime_options` dead-code warning，非本切片引入。

本轮 A3 ChatComposer 历史导航与 visual-wrap 边界补充（2026-09-13）：

- 对照 Codex `ChatComposerHistory::should_handle_navigation`，Lime 增加最近召回文本状态：
  空草稿可开始历史，非空草稿仅在精确匹配最近召回文本且光标位于边界时消费 Up/Down。
- 单行长文本在已知 visual-wrap 宽度下，仅首/尾 visual row 进入历史；中间行交给 TextArea，
  并补齐插入模式箭头键到同一 visual vertical owner。
- 旧的任意非空草稿历史替换回归改为 Codex 语义，并新增
  `wrapped_single_line_vertical_navigation_stays_in_editor_until_visual_boundary`。
- TUI library `749/749`、TUI Clippy、相关 rustfmt 与 `git diff --check` 通过；workspace fmt
  仍被其他既有 agent-runtime/tool-runtime debug 输出格式差异阻断。此前 integration、contracts
  与 TUI Gate B 证据保持有效；本切片未触达协议、Electron 或生产 mock。
  总体计划继续保持 `in-progress`，A2 history/transcript contract、A3 剩余 owner、CLI
  partial 与 Cloud transport 仍未完成。

本轮 A2 CUA title boundedness 修复（2026-09-13）：

- `history_cell/computer_activity.rs` 的 CUA action title 现在复用 canonical `compact_text`
  规则，仅保留首行、最多 160 个字符并追加省略号；避免 provider 手册或超长多行 title
  直接进入 `TranscriptEntry.summary`。截图计数、错误首行和媒体 fail-closed 边界保持不变。
- 新增长标题/多行 title 回归；定向 CUA 测试 `3/3`、TUI Clippy、workspace fmt 和
  `git diff --check` 通过。该修复属于既有 `current` owner，没有新增 `compat`/`deprecated`，
  也未修改 App Server protocol/schema。

本轮 A2 history completion boundaries（2026-09-13）：

- 新增 `app/history_completion.rs` 与 Codex 同名的三个边界回归，覆盖跨页 turn、多个完成
  turn 顺序以及失败/中断/运行中 turn 不产生 completion boundary。
- `ConversationProjection` 独立保存 completion metadata；完整 Thread hydrate、实时
  `TurnCompleted` 和旧页加载使用同一 `FinalMessageSeparator` 渲染链，旧页按 item 页的
  `turn_id` 有界查找 Turn（最多 16 页，重复 cursor 截止）。分隔线耗时文案覆盖五种产品
  locale，导出仍只读取 canonical `TranscriptEntry`。
- 验证已完成：TUI library `729`、integration `15`、manager regression `1`；TUI Clippy
  `--all-targets --no-deps -D warnings`、workspace fmt、`git diff --check`、结构/snapshot
  Vitest `18/18`、`npm run test:contracts` 与真实 `npm run smoke:tui-gate-b` 均通过。Gate B
  线程为 `01a09a92-9968-75f0-8f85-aff9ff46b4be`，回合为
  `turn_8220938727854d1f8248108f7c9316a6`；PTY、alternate screen、stdio JSON-RPC、canonical
  projection、queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 和
  terminal restore 均为 `ok`。Codex runtime metrics、完成时间本地化和跨页 nested-review
  仍保持 `partial/contract/defer`，总体计划继续 `in-progress`。

本轮 A2 older-page nested-review reconciliation（2026-09-13）：

- 对照 Codex `app/history_pagination.rs` 的 Turn 顺序要求，`thread_turns_for_items` 保持
  App Server `sortDirection=desc` 的读取方向，并在返回前统一为时间正序；当目标页最早
  Turn 位于当前 Turn 页尾部时继续请求一页，确保至少带一个更早 Turn 作为 nested-review
  前序上下文，最多 16 页且重复 cursor 立即 fail-closed。
- older-page projection 复用唯一 `history_filter::hidden_user_message_ids`，将完整 Turn
  metadata 得出的 canonical UserMessage ID 传给 grouped projection；页面内显式
  Entered/Exited 边界和跨页重复 prompt 均只按 ID 过滤，不按文本猜测。完成 separator 仍以
  原始 group 最后 item 为边界，隐藏用户消息不会前移分隔线；缺少 Turn metadata 时保持
  item-only 投影。
- 新增 canonical-id 过滤、前序 Turn 上下文、正序恢复和 grouped completion 边界回归。
  本轮已通过 TUI library `740/740`、integration `15/15`、manager regression `1/1`、
  TUI Clippy `--all-targets --no-deps -D warnings`、workspace `cargo fmt --check`、
  `git diff --check`、TUI structure/snapshot inventory `18/18` 与 `npm run test:contracts`。
  真实 `npm run smoke:tui-gate-b` 通过，
  最终 thread 为 `01a09ab2-a01d-7990-9082-feeb2a6cb1d9`、turn 为
  `turn_015404412e8d4dedb6ca324d8985ff5c`，PTY/alternate screen、stdio App Server
  JSON-RPC、canonical Thread/Turn/Item、queue-edit、agents-overview、focus-palette、
  resize-reflow、reconnect 与 terminal restore 均为 `ok`。该切片属于 `current`，未新增
  `compat`/`deprecated`、协议字段、第二套 history store 或 mock fallback；总体计划继续
  保持 `in-progress`。

本轮 A3 TextArea 编辑按键边界对齐（2026-09-13）：

- 对照 Codex `bottom_pane/textarea.rs::input_with_keymap`，将插入模式编辑快捷键的判定收回
  `keymap.rs::is_editor_key_event`，避免 ChatComposer 的控制键分支吞掉编辑动作。补齐
  `Ctrl-H`/退格、`Ctrl-M`/换行、`Ctrl-P`/上移、`Ctrl-N`/下移，以及终端可能上报的 C0
  `^A/^B/^E/^F/^H/^J/^M/^N/^P/^U` 别名；新增 `key_hint::is_altgr` 的 Windows 判定，
  Alt-Gr 字符不会误触发编辑动作，Ctrl-C 和 Ctrl-R 仍由原有 composer 边界优先处理。
- `TextArea` 新增 UTF-8/grapheme 安全的逻辑行垂直移动，按终端显示宽度选择目标列；多行
  `Up/Down` 进入同一编辑 owner，单行 Up/Down 仍保留历史导航。未复制 Codex 私有配置
  schema，完整 `RuntimeKeymap` 配置化与 visual-wrap preferred-column 仍为 `partial/defer`。
- 新增 keymap、TextArea、ChatComposer 三组 Codex-shaped 回归，覆盖控制键、C0 输入、宽字符
  边界和多行 composer 导航；本切片属于 `current`，无新增 `compat`/`deprecated`、协议字段、
  runtime 分支或本地存储。
- 验证已完成：TUI library `745/745`、integration `15/15`、manager regression `1/1`，定向
  keymap/TextArea/ChatComposer 测试通过；TUI Clippy `--lib --no-deps -- -D warnings`、workspace
  `cargo fmt --check`、`git diff --check`、structure/snapshot inventory `18/18`、
  `npm run test:contracts` 和真实 `npm run smoke:tui-gate-b` 均通过。Gate B 线程为
  `01a09ac5-7037-7ab2-972f-18769f54b259`，回合为 `turn_1073b2655f42487d9994bdca2972096a`，
  PTY、alternate screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、queue-edit、
  agents-overview、focus-palette、resize-reflow、reconnect 与 terminal restore 均为 `ok`；编译
  期间仍有 App Server 既有 `lower_turn_start_params`/`lower_runtime_options` dead-code warning，
  非本切片引入。总体计划保持 `in-progress`。

本轮 A3 visual-wrap preferred-column 补充（2026-09-13）：

- `TextArea` 新增与 Codex 同语义的 `preferred_col`，有 wrapping cache 时 `Up/Down` 按 visual
  row 导航，短行、尾部 sentinel row、制表符和宽字符均在 grapheme 边界上钳位；缩放后保留
  已保存的显示列，水平移动、编辑、模式切换和内容替换会清除旧列。无 wrapping cache 时
  继续使用逻辑行 fallback，不改变首次渲染前的输入行为。
- Vim Normal 的 `j/k` 复用同一 TextArea visual owner，避免 Vim 与 Insert 两套垂直导航语义
  分叉；未引入配置 schema、协议字段、第二套 runtime 或本地存储。
- 新增 Codex-shaped 回归：`vertical_navigation_preserves_preferred_column_across_short_wrapped_rows`、
  `vertical_navigation_preserves_destination_tab_columns`、
  `vertical_navigation_clamps_saved_column_after_resize`。本切片分类为 `current`；完整
  `RuntimeKeymap` 配置化、Vim search/text-object/find/till/dot-repeat 和 ChatWidget owner
  迁移继续保持 `partial/defer`。
- 本轮变更后的最低验证已完成：TUI library `748/748`、TUI integration `15/15`、manager
  regression `1/1`、TUI Clippy `-D warnings`、workspace fmt check、`git diff --check`、
  structure/snapshot inventory `18/18`、`npm run test:contracts` 和真实
  `npm run smoke:tui-gate-b` 均通过。Gate B 线程为 `01a09ae4-25b4-7ba3-9668-a5c1fe65032f`，
  回合为 `turn_53ed4b41815a4a96929ca31cce2d0990`；PTY、alternate screen、stdio App Server
  JSON-RPC、canonical Thread/Turn/Item、queue-edit、agents-overview、focus-palette、
  resize-reflow、reconnect 与 terminal restore 均为 `ok`。编译期间仍有 App Server 既有
  `lower_turn_start_params`/`lower_runtime_options` dead-code warning，非本切片引入。

本轮 A3 composer 历史边界清理补充（2026-09-13）：

- 对照 Codex `ChatComposerHistory` 的 reset/restore 语义，断线态 Enter/Tab 现在也会清理
  `history_index`、`last_history_text` 和保存草稿，避免重连后把旧召回文本误判为可继续历史导航。
- 图片附件变更和文件/skill popup 补全统一视为外部草稿编辑，清理历史导航状态；Vim 开启时
  popup 替换也进入同一 pending transaction。历史浏览期间 popup 同步直接退出并取消待处理
  文件搜索，避免 slash/@/$ 历史文本抢走后续 Up/Down 输入。
- 纯文本历史遇到 attachment-only 草稿时 fail closed，不用文本条目覆盖图片草稿；新增
  `attachment_only_draft_does_not_enter_text_history` 回归，等附件历史条目 contract 完整后
  再迁移 Codex 的富历史恢复语义。
- 新增 `history_navigation_clears_completion_popups_for_recalled_text`、
  `attachment_edit_exits_history_navigation` 和
  `disconnected_submit_keys_clear_history_recall_state` 回归。该切片只修改 TUI current
  composer owner，无协议、schema、兼容包装或生产 mock 变化。
- 验证已完成：TUI library `754/754`、integration `15/15`、TUI all-targets Clippy
  `-D warnings`、`npm run test:contracts` 和 `git diff --check` 通过。真实 TUI Gate B 的
  `complete`、`approval`、`user-input`、`interrupt` 单场景均通过，证明 PTY、alternate
  screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、请求交互和 terminal
  restore 主链未回归；默认多场景连续 runner 及 `failure` 单场景偶发在首次 `ready` 前
  关闭 PTY，单独 composer/runtime 测试仍稳定通过，暂按既有 Gate B fixture 启动竞态记录，
  不把它归因于本轮代码。
- 附件取出路径补充后，`complete` 场景再次通过：thread
  `01a09b4c-8549-7ff2-aac3-b1e5dba6904c`、turn
  `turn_42554e2130f141cdb58a0be4ce67384a`，事件为
  `turn.started,message.delta,item.started,item.completed,turn.completed`，并再次证明
  `focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 为 `ok`。

本轮 A2 首屏 paginated history contract 收口（2026-09-14）：

- 对照 Codex `app/history_pagination.rs` 与 `history_completion.rs`，首屏
  `thread/items/list` 不再直接作为无元数据 item 列表投影；`AppServerSession` 现在在同一
  canonical thread identity 下按 item page 的 `turnId` 查询 `thread/turns/list`，返回
  `InitialHistoryPage`，由 startup、resume、reconnect 三条入口与 older-page 共用 grouped
  projection。completed Turn 的 separator 只落在该 Turn 最后 item，review prompt 只按
  canonical UserMessage ID 过滤。
- Turn 查询是 enrichment contract：旧 App Server 缺少 `thread/turns/list`、目标 Turn 或
  前序 Turn 时不猜测状态，保持 item-only/fail-closed；不新增本地 history store、协议字段
  或 mock fallback。重连后的首屏也不再绕过相同过滤/完成边界。
- 新增 TUI regression 覆盖首屏 completion/review filtering、缺失 Turn metadata 的
  item-only 行为，以及 Codex `merge=702` 对应的跨页重叠 answer 去重与 footer 边界；新增
  App Server JSON-RPC contract
  `paginated_history_jsonrpc_preserves_canonical_thread_turn_item_identity`，断言
  `thread/resume`、`thread/turns/list`、`thread/items/list` 返回同一 canonical thread/turn/item
  identity 与 answer 内容。
- 已验证 TUI library `758/758`、integration `15/15`、TUI Clippy `-D warnings`、workspace
  `cargo fmt --check`、`git diff --check`、`npm run test:contracts`。App Server Rust contract
  测试本机因 `rusty_v8` 150.4.0
  没有当前 `aarch64-apple-darwin` 预编译包而无法编译，失败发生在 V8 下载阶段，未归因于
  contract 代码；后续具备 V8 构建/缓存后必须补跑该单测与 `npm run test:contracts`。
- 该切片推进 A2 `history/transcript/pager` 主链，分类为 `current`；总体计划仍保持
  `in-progress`，A2 的跨页 nested-review 完整 Gate B 与其余 A3/A4/C/D 缺口不宣称完成。

本轮 A2 transcript overlay older-page 触顶加载（2026-09-14）：

- 对照 Codex `pager_overlay` 的 transcript 顶部历史加载语义，Lime `PagerOverlay` 在启用
  older page 的 transcript 且滚动到顶部时返回专用 `LoadOlderHistory` 动作；`App`/runtime
  复用现有 `thread/items/list` older-page loader 与 Turn enrichment，不在 overlay 内持有
  第二套 history store。静态 status pager、resume picker 的 text-only transcript preview
  保持原有消费语义，不会误发分页请求。
- `Ctrl+T` 打开 transcript 时从 `scrollback_has_older_history` 初始化可加载护栏；每次 older
  page 完成后同步最新 `has_older_history`，加载中由 App Server cursor 状态抑制重复请求。
- 新增 pager 与 App 输入路由回归，覆盖有/无 older page、Home/PageUp 触顶和静态 pager
- 验证：TUI library `762/762`、pager/App 定向测试、TUI all-targets Clippy `-D warnings`、
  workspace fmt check 与 `git diff --check` 通过；Gate B 与 App Server Rust contract 仍按
  上一切片记录执行，V8 预构建包阻塞状态不变。
- `npm run verify:local` 已启动但 Rust changed-scope 链接阶段因本机磁盘剩余约 1.2 GiB、
  报 `No space left on device` 中止；该失败不是本轮代码诊断，待释放构建空间后补跑。

本轮 A2 Home 全历史与跨页 reconciliation 收口（2026-09-14）：

- `PagerAction::LoadOlderHistory` 进入统一 App history owner 后，Home 会沿 canonical
  `thread/items/list` cursor 连续加载全部 older pages；普通 PageUp/ScrollUp 仍保持单页加载，
  不在常规滚动时预取整段历史。全量加载完成后清除旧的 transcript anchor，保证视口停在真正
  的历史起点。
- 初始 item-only 投影与后续 Turn metadata 现在复用同一页合并 helper；当相邻 completed
  review turn + interrupted duplicate turn 到达时，按 canonical UserMessage ID 移除先前已显示
  的 nested review prompt，再插入 older page，避免跨页重复和选中索引漂移。
- 新增 `older_page_reconciles_nested_review_prompt_from_adjacent_turn_metadata` 与 pager
  anchor 回归；结构 inventory 已重新生成。真实跨页 fixture/Gate B 仍待补齐，不能据此宣称
  A2 完成。该切片属于 `current`，没有新增协议字段、兼容包装、生产 mock 或本地存储。
- 验证：本轮可运行的格式、结构/snapshot inventory `18/18` 与 `git diff --check` 通过；Rust
  定向编译因本机磁盘仅剩约 219 MiB 而报 `No space left on device`，待释放构建空间后补跑。

本轮 A2 MCP canonical inventory 窄切片（2026-09-14）：

- 对照 Codex `/mcp` inventory 语义，TUI slash catalog 新增 `/mcp`；`/mcp` 请求
  `mcpServerStatus/list` 的 `ToolsAndAuthOnly` 详情，`/mcp verbose` 请求 `Full` 详情，未知
  参数在本地化 usage 中 fail-closed。App Server session 复用现有 JSON-RPC request boundary，
  沿 `nextCursor` 最多读取 16 页；重复 cursor 或超页数立即失败，不引入本地 MCP 状态存储、
  第二套 transport 或 provider-specific 解析。
- inventory 仅消费 canonical `McpServerStatus`，服务器按名称排序并渲染连接状态、工具计数；
  `Full` 额外展示 Auth、工具、资源和资源模板名称/URI，工具、资源和模板空集合统一显示
  本地化的 `(none)`，资源与模板保持 App Server 返回顺序。未知状态与 `None + NotLoggedIn`
  按 Codex 语义安全降级。结果通过现有静态 `PagerOverlay` 展示，
  不改变 transcript pager 的 older-history 动作路由。
- 新增 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` 文案、slash catalog/action/detail
  回归及 inventory 排序、Full 详情、空状态单测。该切片分类为 `current`，但 MCP resource body、
  rmcp transport、Node/CUA REPL 与完整真实 MCP inventory PTY fixture 仍为 `contract/defer`，
  未宣称 A2 或 MCP Gate B 完整完成。
- 本轮验证已完成：`cargo fmt --all --check`、TUI library `772/772`、TUI all-targets
  Clippy `-D warnings`、`git diff --check`、`npm run test:contracts`、
  `npm run inventory:tui-structure` 均通过；真实 `npm run smoke:tui-gate-b` 通过，thread
  `01a09d7a-ca8c-7081-af24-b12dcda1828d`、turn `turn_a2c1056951f3414c91a6be570c012f4d`，
  证明 PTY、alternate screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、
  queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 与 terminal restore
  主链未回归。该 Gate B fixture 未发送 `/mcp` 请求，因此不能作为 MCP inventory 的真实交互
  证据。App Server Rust contract 仍受本机 `rusty_v8` 150.4.0 Apple ARM 预构建包缺失阻塞。

本轮 A2 跨页 nested-review 真实 Gate B 收口（2026-09-14）：

- `thread/fork` 仅允许已知且带 review 文本的 `enteredReviewMode`/`exitedReviewMode` 扩展项，
  其他 Extension/Unknown 仍 fail-closed；provider history lowering 对这两个边界项显式忽略，
  不将 UI review 标记误送给模型。新增 runtime 单测覆盖合法、缺失 review 文本和未知扩展。
- 新增 `scripts/app-server/tui-history-pagination-fixture.mjs` 与真实 PTY suite，使用 external
  backend 仅作为显式测试夹具：51 个 completed turns 形成 >100 item 分页，真实 review turn、
  steer duplicate prompt、fork 中断尾回合，再以 `lime resume` 驱动 transcript Home/End。夹具
  证明 `SEED_000`/`SEED_050` 可见、`NESTED_REVIEW_PROMPT` 按 canonical UserMessage ID 隐藏、
  completion separator 无相邻重复且 alternate screen 恢复。
- 新增 npm 入口 `smoke:tui-history-pagination`；清理 TUI history enrichment 临时 debug 输出。
- 验证：真实 `LIME_KEEP_TUI_HISTORY_PAGINATION_TMP=1 node scripts/app-server/tui-history-pagination-fixture.mjs`
  通过；`cargo fmt --manifest-path lime-rs/Cargo.toml --all --check`、`node --check`、
  `npm run test:contracts`、`npm run governance:scripts` 通过；TUI history_filter、history_pagination、
  pager_overlay 定向测试全部通过。App Server Rust tests 在当前机器仍受 rusty_v8 150.4.0
  Apple ARM 预编译包缺失（HTTP 404）阻塞，需具备本地 V8 archive 后补跑。

本轮 A3 status indicator widget 收口（2026-09-14）：

- 对照 Codex `status_indicator_widget.rs` 的唯一绘制 owner 语义，Lime 将耗时、可中断提示、
  inline context、hook 状态溢出和 details wrapping 收拢到
  `tui/src/status_indicator_widget.rs`；状态行宽度测量与渲染共用同一 `lines` 路径，hook
  文案无法放入首行时移到第二行，details 按显示宽度截断并保留省略号。
- `ConversationProjection::hook_status_message()` 作为 hook display-ready 文案事实源，
  `view::screen_chunks` 使用 `desired_height_with_status` 与渲染传入相同输入，避免窄终端或
  hook 活动时覆盖队列/编辑器。旧 `status_indicator.rs` 仅保留兼容委托和历史测试，不再持有
  绘制算法；没有新增 runtime、协议字段、mock 或本地状态存储。
- 迁移并补齐 Codex 同名 status 测试：无动画状态、重映射 interrupt hint、hook reflow、
  details overflow/capitalization，以及五语言文案和窄宽度边界。该切片分类为 `current`；
  旧模块为 `compat`，完整 Codex `StatusTimer`/spinner/shimmer、可配置 keymap 与 frame
  requester 仍为 `partial/defer`，待独立 owner 和真实交互需求确认后再迁移。
- 验证：TUI status 定向测试 `10/10`（含暂停感知 `StatusTimer`）、TUI library `782/782`、
  TUI integration `16/16`、TUI Clippy `-D warnings`、workspace fmt、结构/snapshot inventory
  `18/18`、`npm run test:contracts`、`npm run governance:scripts` 与 `git diff --check` 均通过。
  完整
  `smoke:tui-gate-b` 未在本切片重复执行；上一切片已有真实 PTY/alternate-screen/stdio
  App Server JSON-RPC 证据，后续若接入动态 timer/animation 必须补跑 Gate B。

本轮 A3 footer 单行布局折叠收口（2026-09-14）：

- 在 bottom_pane/footer.rs 唯一 current owner 中补齐 Codex 形状的 SummaryLeft、SummaryHintKind、single_line_footer_layout、can_show_left_with_context、right_aligned_x 和 render_context_right。活动回合草稿优先显示 Tab queue hint，窄终端先隐藏 active agent context，再降级短 queue hint；非活动草稿显示本地化 draft 状态；无草稿保留 turn/context 左右布局与 Vim indicator。
- 布局统一使用 line_width/display_width，覆盖中日韩和 emoji 宽度边界；新增 queue_message_hint、queue_short_hint、draft_ready_hint，覆盖 zh-CN、zh-TW、en-US、ja-JP、ko-KR。未复制无 Lime consumer 的 Codex shortcuts overlay、voice、IDE context、动态 status-line 和完整 RuntimeKeymap。
- 分类：footer queue/context 单行折叠为 current；完整 Codex footer mode、voice、外部编辑器提示和配置化 keymap 为 partial/defer。未新增协议字段、runtime、兼容包装、生产 mock 或本地存储。
- 验证：footer 定向测试 9/9、TUI library 786/786、TUI Clippy（tui lib no-deps，D warnings）、workspace fmt、结构 inventory、git diff check、npm run test:contracts 与 npm run smoke:tui-gate-b 均通过。Gate B 证明 PTY、alternate screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 和 terminal restore 正常。workspace 全量 Clippy 仍受并行既有 agent-protocol lint 阻塞；verify:gui-smoke 未重复执行，footer 不触达 Electron bridge。

本轮 A3 selection-row / Agents Overview 对齐（2026-09-14）：

- 新增 selection_row_layout.rs 作为选择行唯一 current display-layout owner，按 Codex 语义统一名称、前缀、描述列、disabled reason、UTF-8 grapheme/CJK/emoji 显示宽度和窄终端堆叠；model_picker.rs、app/agent_picker.rs 复用该 owner，保留各自筛选、导航、Enter/Esc、App Server 数据和路由边界。
- Agents Overview 列表行迁移到同一 owner：状态 marker、current 标记、localized 状态与 cwd/project 说明共享显示宽度与窄终端折叠逻辑；不改变 AgentsOverviewView 选择、搜索、重命名、停止、派发和 App Server refresh 主链。新增可见行回归锁定 marker、current、状态和 cwd 事实。
- selection_list.rs 当前仅剩自身测试和模块注册，未发现生产 consumer；在未取得高风险删除确认前不直接移除，分类为 dead-candidate/defer，后续需先确认是否迁移其测试语义并补回流守卫。完整 Codex ListSelectionView 的 toggle/tab/shortcut、side-content、配置化 keymap 等能力因无 Lime current consumer 继续为 contract/defer，不机械复制第二套状态机。
- 分类：selection_row_layout、model/agent picker 与 Agents Overview 行渲染属于 current；没有新增 compat 或 deprecated surface；无 Lime consumer 的完整 ListSelectionView 能力为 contract/defer；selection_list.rs 为 dead-candidate/defer，待确认后删除或迁移测试。
- 验证：Agents Overview 定向测试 17/17；TUI library 790/790；TUI integration 16/16；manager dependency regression 1/1；cargo clippy -p tui --all-targets --no-deps -- -D warnings、cargo fmt --all -- --check、git diff --check、npm run inventory:tui-structure、npm run test:contracts 与真实 npm run smoke:tui-gate-b 均通过。Gate B 新证据线程 01a09e2d-3459-7712-91ab-aff245585a72、回合 turn_a33e37bb3a204017a4a9b96a935b12d0，证明真实 lime、PTY/alternate screen、stdio App Server JSON-RPC、canonical Thread/Turn/Item、agents-overview、queue-edit、focus-palette、resize-reflow、reconnect 与 terminal restore 正常。
- 本轮仍未执行 verify:gui-smoke（未触及 Electron/GUI bridge），App Server Rust contract 仍受本机 rusty_v8 150.4.0 Apple ARM 预构建包缺失阻塞；总体计划继续保持 in-progress。下一刀回到 A3 剩余 current composer/bottom-pane owner，或在确认真实 consumer 后再处理 selection_list.rs。

本轮 A3 completion-target owner 收口（2026-09-14）：

- 对照 Codex `bottom_pane/chat_composer/completion_target.rs` 与同名测试，Lime 将 `@` 文件和 `$` 技能的 cursor-neighborhood 解析统一到 `chat_composer/completion_target.rs`；横向空白保留同一行 affinity，换行是硬边界，光标位于新 token 起点时优先右侧目标，shell-like `$` 左目标在右侧可补全目标存在时让位。解析器使用 UTF-8 安全 byte range，不跨越普通文本或嵌套 `$` 前缀误切 token。
- `skill_query_is_candidate` 改为消费 `DollarQueryKind`：空/小写或冒号限定 skill 可补全，常见环境变量、确定 positional parameter、非法语法拒绝，数字或 `-` 前缀的歧义参数仅在 catalog 存在精确 skill 时放行。删除 `chat_composer.rs` 中旧 `current_at_token_range`、`current_dollar_token_range`、`is_common_shell_variable` 生产实现，测试 helper 仅委托 current owner。
- 新增 completion-target 回归覆盖相邻 `$`/`@` 目标、separator affinity、换行与尾随空白、UTF-8 非边界光标、`$HOME`、`$1`、`$1_suffix`、`$-x`、`$-`、`$_` 和嵌套 `$HOME/$USER`。Codex atomic text-element binding 在 Lime 没有 current canonical consumer，继续分类为 `contract/defer`，未伪造第二套 text-element API。
- 分类：completion-target、ChatComposer 接线和 shell 语法 arbitration 属于 `current`；Codex 完整 atomic mention binding、plugin/connectors 与更丰富 completion UI 继续 `contract/defer`。未新增协议字段、兼容包装、生产 mock、runtime 或本地存储。
- 验证：completion-target 定向测试 `10/10`，TUI library `800/800`，TUI all-targets Clippy `-D warnings`、`cargo fmt --all`、`npm run inventory:tui-structure`、`git diff --check` 均通过；`npm run test:contracts` 退出码 `0`（协议类型生成无漂移、App Server client contract 299 checks、command contracts、harness、modality、scripts、Electron release、desktop/CLI/docs boundary 均通过）。真实 `npm run smoke:tui-gate-b` 退出码 `0`，thread `01a09e65-4e34-7033-97f3-d8cfe34f53a6`、turn `turn_168e63af64e0442498a7a8bd45e3badf`；事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 terminal restore 均为 `ok`。Gate B 编译期间的 `lower_turn_start_params`、`lower_runtime_options` dead-code warning 为既有 App Server 警告，非本切片引入。总体计划继续保持 `in-progress`，下一刀回到 A3 剩余 composer/bottom-pane current owner。

本轮 A3 popup-state owner 收口（2026-09-14）：

- 对照 Codex `bottom_pane/chat_composer/popup_state.rs` 与同名测试，Lime 将文件/技能 dismissal token 及文件搜索重复 query 状态从 `ChatComposer` 聚合字段迁入唯一 `PopupState` owner；command/file/skill popup 的可见性与 transient dismissal/query 生命周期由同一状态对象承接。文件搜索 generation/request 仍保留在 `ChatComposer`，因为它属于 App Server 请求边界，不在 popup owner 内伪造 transport 状态。
- 保持现有行为：取消文件/技能 popup 仍按 token occurrence 抑制当前实例；完成或切换 token 清理对应 dismissal；相同文件 query 不重复发请求；history navigation、空 `@` 和 slash popup 互斥逻辑不变。未新增协议字段、runtime、history store、生产 mock 或兼容包装。
- 分类：`PopupState` 与 ChatComposer 接线属于 `current`；Codex atomic text-element dismissal、MentionV2、voice strip 与完整 ChatWidget popup layout 在 Lime 没有 current canonical consumer，继续 `contract/defer`，不机械复制。
- 验证：popup-state 定向测试 `3/3`、TUI library `800/800`、TUI all-targets Clippy `-D warnings`、`cargo fmt --all -- --check`、`git diff --check` 与 `npm run inventory:tui-structure`（`870` 个文件）均通过。真实 `npm run smoke:tui-gate-b` 退出码 `0`，thread `01a09e6d-b932-79d1-b774-2f0cccbc6478`、turn `turn_dfaf2afbaac44897a6eda38067c65725`；事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，`queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和 `terminal=restored` 均为 `ok`。Gate B 编译期间的 `lower_turn_start_params`、`lower_runtime_options` dead-code warning 为既有 App Server 警告，非本切片引入。总体计划继续保持 `in-progress`，下一刀回到 A3 其余 composer/bottom-pane current owner。

本轮 A3 agents-navigation owner 收口（2026-09-14）：

- 对照 Codex 当前 bottom_pane/chat_composer/agents_navigation.rs 语义，Lime 新增该模块作为空草稿 Agents Overview 导航的唯一 composer owner。ChatComposer 仅在本地 stdio 会话启用无修饰 Left，返回 OpenAgentsOverview；App 统一映射为 open_agents_overview() 与 AppAction::RefreshAgentsOverview，嵌套 request_user_input composer 对该结果 fail-closed 忽略。remote session 默认关闭，不引入第二套导航状态机。
- 导航可用性严格要求空文本、无附件、无 popup、无 history search、无 Vim operator pending，且新增 vim_search_active() 护栏；Alt/其他修饰键不会窃取编辑器输入。新增 6 项 owner 回归与 2 项 App 路由回归，覆盖默认/remote 关闭、popup、附件、Vim operator、活动 Vim search、修饰键和空编辑器 Left。
- 分类：agents_navigation.rs、ChatComposer 接线与 App Action 路由属于 current；remote session 保持 fail-closed；Codex 完整 focus/input-enabled/runtime keymap 等 Lime 尚无 canonical consumer 的能力继续 partial/contract-defer，未新增协议字段、runtime、history store、生产 mock 或 compat 包装。
- 验证：agents-navigation 定向测试 6/6、空编辑器 Left 路由 2/2；TUI library 808/808、integration 16/16、manager regression 1/1；TUI all-targets Clippy --no-deps -- -D warnings、workspace fmt check、git diff --check 与 npm run inventory:tui-structure（871 个文件）通过。真实 npm run smoke:tui-gate-b 通过，thread 01a09e88-2b74-7560-a388-00d9a41c3ced、turn turn_41f872bac11d4a3cbf02bd12469a5b0a；事件为 turn.started,message.delta,item.started,item.completed,turn.completed，queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 和 terminal=restored 均为 ok。Gate B 编译期间的 lower_turn_start_params、lower_runtime_options dead-code warning 为既有 App Server 警告，非本切片引入。未触及 Electron/GUI bridge，未运行 verify:gui-smoke；总体计划继续保持 in-progress。

本轮 A3 request_user_input 焦点与问题导航对齐（2026-09-14）：

- 对照 Codex 当前 bottom_pane/request_user_input/mod.rs 与 async_questions 交互语义，Lime RequestUserInputOverlay 为每个问题保存独立的备注草稿、选项选择和 Options/Notes 焦点；Ctrl-P/Ctrl-N、PageUp/PageDown 以及 Options 焦点下的 h/l、Left/Right 可循环切换问题，切换不会丢失其他问题的编辑状态。Options 按 Tab 进入 Notes 时先恢复当前草稿再显式持久化 Notes 焦点，避免旧缓存覆盖新状态。
- 选项题支持 Other 两阶段 Enter：首次进入备注编辑，第二次提交 Other 及可选 user_note: ...；空备注仍只提交已选项。Notes 焦点下 Esc、空 Backspace 或 Tab 清空备注并返回 Options；Options 焦点下普通字符保持 Codex 的 Options 焦点，j/k 与 Up/Down 移动选项、h/l 与 Left/Right 导航问题、空格不提交，数字快捷键按选项提交。v2 answers 结构保持不变，没有伪造 Codex 私有字段。
- 新增回归覆盖逐题 draft/selection 保留、Other 两阶段提交、Options/Notes Tab 往返、Esc/空 Backspace fail-closed、Options 输入不打开 Notes 以及 j/k 选项导航；该切片分类为 current。Codex 完整 async_questions 队列/确认未答题、自动解析、中断后持久化、可配置 keymap 与私有 composer draft 仍因 Lime canonical contract 不承载而分类为 partial/contract-defer，不得通过本地 history store 或新增协议字段补造。
- 验证：cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check、request_user_input 定向测试 12/12、TUI library 812/812、integration 16/16、manager regression 1/1、TUI Clippy --all-targets --no-deps -- -D warnings、git diff --check 与 npm run inventory:tui-structure（871 个文件）均通过。真实 npm run smoke:tui-gate-b 通过，thread 01a09ec7-4003-7240-8068-aec662bd70c6、turn turn_bca42a7b300640b78bde736af2e579ff；事件为 turn.started,message.delta,item.started,item.completed,turn.completed，queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 和 terminal restore 均为 ok。本轮未触及 Electron/GUI bridge，未运行 verify:gui-smoke；Gate B 证明 TUI/CLI current 主链未回归，不等同于完整 async_questions contract 完成。总体计划继续保持 in-progress。

本轮 A3 request_user_input 非阻塞协议与自动解析子集（2026-09-14）：

- `ToolRequestUserInputParams` 新增 current `isBlocking` 字段；手写反序列化对缺少字段的旧请求 fail-closed 为 `true`，`autoResolutionMs` 保留为 deprecated 协议兼容字段。App Server action payload 同时读取 camelCase/snake_case 并默认阻塞，`RequestUserInputRunRequest`、`RequestUserInputAction` 与 Agent bridge 全链路透传，bridge 发出 `isBlocking`。v2 DTO、App Server schema、TypeScript generated client 与相关 fixture 已同步，未建立第二套协议或生产 mock。
- `CurrentTurnToolExecutor` 按 canonical collaboration mode 推导语义：`Plan` 阻塞、`Default` 非阻塞、缺少协作模式时阻塞，避免未知上下文自动放行。新增 Plan/Default/缺省判定回归。
- TUI `RequestUserInputOverlay` 对 `isBlocking=true` 保持人工回答；`false` 使用 60 秒隐藏 grace，随后 60 秒可见倒计时，到期提交空 answers。任意键或粘贴会 snooze 自动解析；倒计时通过既有 `FrameRequester` 驱动，并覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`。这只是 Codex async_questions 的 current 子集，队列确认未答题、可配置 keymap、恢复持久化和更完整私有 composer 状态仍为 `partial/contract-defer`。
- 分类：`isBlocking` 协议字段、App Server/Agent bridge 透传和 TUI 自动解析状态机属于 `current`；`autoResolutionMs` 为协议兼容 `deprecated` 字段；没有新增 compat 包装、local history store、生产 mock 或 Electron bridge。
- 验证：`npm run test:contracts` 退出码 `0`；Rust runner 定向测试通过（agent-runtime request_user_input 5/5、lime-agent 3/3、app-server approval parser 定向测试含显式 `isBlocking=false`、app-server-protocol 133/133、TUI 816/816），`cargo clippy --locked --manifest-path lime-rs/Cargo.toml -p tui --all-targets --no-deps -- -D warnings`、workspace fmt check、`npm run inventory:tui-structure`（871 个文件）与 `git diff --check` 均通过。真实 `npm run smoke:tui-gate-b` 退出码 `0`，thread `01a09f1e-18b0-7ae2-aa21-6d0ce9807ac6`、turn `turn_3609a06f81fd4c689e88bd729e375c83`；事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 和 terminal restore 均为 `ok`。Gate B 编译期间的 `lower_turn_start_params`、`lower_runtime_options` dead-code warning 为既有 App Server 警告，非本切片引入；未触及 Electron/GUI bridge，未运行 `verify:gui-smoke`。总体计划继续保持 `in-progress`，A1/A2 其余 history contract、A3/A4 剩余 owner、CLI partial 与 Cloud transport 仍未完成。

本轮 A3 pending-input preview current owner 收口（2026-09-14）：

- 对照 Codex `bottom_pane/pending_input_preview.rs` 的 bottom-pane owner 边界，Lime 将
  `pending_input_preview.rs` 的生产实现固定在 `tui/src/bottom_pane/pending_input_preview.rs`；
  `view`、`app` 和输入路由继续直接消费该 current owner。根模块只保留无业务逻辑的
  `compat` 重导出，避免根聚合文件与 bottom-pane 形成第二个事实源；未引入 Lime 当前协议
  不承载的 Codex pending/rejected steer 状态、voice 或 RuntimeKeymap。
- `can_restore_submission`、队列多模态摘要、窄终端折叠和五语言文案仍由 current owner
  统一提供；根 compat 不新增行为。当前 Codex 完整 steer 分段与动态 binding 因没有 Lime
  canonical consumer，继续 `partial/contract-defer`，不通过本地状态或 mock 补造。
- 分类：`bottom_pane/pending_input_preview.rs` 为 `current`；根
  `pending_input_preview.rs` 为 `compat`，只委托；未删除文件、未新增协议字段、runtime、
  持久化或生产 mock。
- 验证：pending preview 定向测试 `4/4`、TUI all-targets Clippy `-D warnings`、workspace
  fmt check、`git diff --check`、`npm run inventory:tui-structure`（`872` 个文件）和
  `npm run test:contracts` 均通过。真实 `npm run smoke:tui-gate-b` 通过，thread
  `01a09f72-dd15-7df2-8ad7-847719488c8b`、turn `turn_a500254a14394c049b80594535fe508f`；
  事件为 `turn.started,message.delta,item.started,item.completed,turn.completed`，
  `queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 与
  `terminal=restored` 均为 `ok`。Gate B 编译期间的 `lower_turn_start_params`、
  `lower_runtime_options` dead-code warning 为既有 App Server 警告，非本切片引入；本轮未
  触及 Electron/GUI bridge，未运行 `verify:gui-smoke`。总体计划继续保持 `in-progress`，
  下一刀回到 A3 `chatwidget` input/interrupt/turn lifecycle，或继续收敛其它 bottom-pane
  current owner。

本轮 A3 input-flow owner 收口（2026-09-14）：

- 对照 Codex `chatwidget/input_flow.rs` 的路由边界，Lime 将 App 键盘输入实现迁入
  `tui/src/app/input_flow.rs`，由该模块作为唯一 current owner；全局滚动、Agent 切换、
  collaboration mode、interrupt、图片/复制/Transcript 快捷键、队列编辑和 composer action
  映射均保留既有 App Server/Thread/Turn/Item 主链，不新增第二套状态机或本地存储。
- 旧 `tui/src/app/input.rs` 已降为无业务逻辑的历史边界文件，且不再由 `app.rs` 注册；生产
  路径只注册 `mod input_flow`，避免旧实现与 Codex-shaped owner 并存。该旧路径分类为
  `compat/dead-candidate`，后续若结构守卫确认无外部源码 consumer，再按仓库删除政策处理。
- 本轮未机械复制 Codex 尚无 Lime canonical consumer 的完整 `chatwidget` runtime keymap、
  voice、IDE context、atomic text-element submission 或 transport；这些继续分类为
  `contract/defer`。没有新增协议字段、兼容包装、生产 mock 或第二套后端。
- 验证：`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、TUI library
  `818/818`、`cargo clippy --locked --manifest-path lime-rs/Cargo.toml -p tui --all-targets
--no-deps -- -D warnings`、`npm run inventory:tui-structure`（`873` 个文件）、
  `npm run test:contracts` 与 `git diff --check` 均通过。未重复运行真实 `smoke:tui-gate-b`
  或 `verify:gui-smoke`；本轮仅重命名/收敛现有输入 owner，之前 Gate B 证据仍有效。总体计划
  保持 `in-progress`，下一刀优先对照 `chatwidget/input_submission.rs` 与 `turn_lifecycle.rs`
  的 Lime current 子集。

本轮 A3 input-submission owner 收口（2026-09-14）：

- 对照 Codex `chatwidget/input_submission.rs`，Lime 新增
  `tui/src/app/input_submission.rs`，承接当前可由 Lime canonical contract 支持的提交边界：
  `InputResult` 到 `AppAction` 的映射、Ctrl-C 草稿优先级、queued submission 列表维护、
  远程/本地图片提取与恢复，以及按 `UserInput` 顺序进行无损队列编辑。真实 transport 执行
  仍归 `runtime` 与 `AppServerSession`，未在 TUI 复制 provider 或第二套 turn runtime。
- `app.rs` 不再持有上述实现，只保留状态与全局路由；`input_flow.rs` 通过 current
  `map_composer_action` 接入新 owner。旧 `app/input.rs` 继续为空的历史边界，未重新注册。
  Codex 的 atomic text-element、mention binding、shell/provider/auth 和完整 queued steer
  能力因没有 Lime current canonical consumer，保持 `contract/defer`，不伪造协议字段或本地
  history store。
- 分类：`app/input_submission.rs` 为 `current`；`app/input.rs` 为 `compat/dead-candidate`；
  完整 Codex submission/turn lifecycle 为 `partial/contract-defer`。
- 验证：TUI library `818/818`、TUI all-targets Clippy `-D warnings`、workspace fmt、
  `git diff --check`、`npm run inventory:tui-structure`（`874` 个文件）和真实
  `npm run smoke:tui-gate-b` 均通过。Gate B 线程
  `01a09f81-90b5-73a1-8253-25927ab60443`、回合 `turn_64bedc90177f48ce8d20b35f9dd5abbb`；
  编译期间的 `lower_turn_start_params`、`lower_runtime_options` dead-code warning 为既有
  App Server 警告。总体计划仍为 `in-progress`，下一刀继续读取 Codex `turn_lifecycle.rs`
  与 Lime projection/app event lifecycle，先收敛不引入第二套状态机的 current 子集。

本轮 A3 turn-lifecycle owner 收口（2026-09-14）：

- 直接复制 Codex `chatwidget/turn_lifecycle.rs` 的状态职责到
  `tui/src/app/turn_lifecycle.rs`，保留 `agent_turn_running`、`last_turn_id`、预算受限回合
  集合、完成标签集合和活动回合计时；Lime 没有 `SleepInhibitor`，因此移除该平台依赖，
  不伪造新的系统休眠控制。
- `App::start_turn`、`hydrate_thread`、`set_thread_id`、`thread_events::apply_notification`
  和 `active_turn_elapsed` 已统一委托该 owner。回合开始、canonical `turn.completed`、
  reconnect/hydrate 与线程切换都通过同一状态转移更新计时，projection 仍是唯一
  Thread/Turn/Item 事实源。
- 分类：`app/turn_lifecycle.rs` 与 App 接线属于 `current`；不适用于 Lime 当前协议的
  Codex 睡眠抑制、完整预算/完成标签消费继续 `partial/contract-defer`；没有新增协议、
  runtime、history store、生产 mock 或 compat 包装。
- 验证：turn-lifecycle 定向测试 `3/3`，TUI library `821/821`，`cargo fmt` 对本切片通过，
  `git diff --check` 对本切片通过。Clippy 已编译通过本切片，但全量 `-D warnings` 被工作树
  既有 `history_cell/session.rs` 的 `clippy::obfuscated_if_else` 阻断；格式检查同样只发现
  该外部改动，未覆盖或回滚并行修改。`Cargo.lock` 的未关联变更保持原样。总体计划仍为
  `in-progress`，下一刀回到 Codex `interaction.rs` / `interrupts.rs` 或 `tool_lifecycle.rs`。

本轮 A3 interrupts policy owner 收口（2026-09-14）：

- 直接抽取 Codex `chatwidget/interaction.rs` 的中断判定子集到
  `tui/src/app/interrupts.rs`，由 `should_interrupt_turn` 统一判断活动 canonical turn 与
  Vim search 护栏；`input_flow.rs` 的 Esc 路由改为消费该 owner。
- Codex `InterruptManager` 的交互请求队列没有机械复制：Lime 已由 `BottomPane` 负责可见
  请求队列、`pending_interactive_replay` 负责跨线程/恢复生命周期，新增队列会形成双事实源。
  因此该部分保持 current owner 不变，未新增协议、runtime、history store、生产 mock 或
  compat 包装。
- 分类：`app/interrupts.rs` 与 Esc 判定接线属于 `current`；完整 Codex interrupt queue、
  steer-after-interrupt、review interrupt 语义因 Lime contract 不承载，继续
  `partial/contract-defer`。
- 验证：interrupts 定向测试 `3/3`、TUI library `835` 个测试编译并执行；本次新增与
  生命周期相关测试均通过。全量测试仍受工作树已有 `view.rs` 改动影响：
  `test_backend_renders_remote_images_with_selection_highlight` 与
  `transcript_page_size_tracks_resize` 失败；真实 `smoke:tui-gate-b` 的 `ready` 启动标记也
  因该 view 改动不再出现。该热区属于并行修改，本轮未覆盖或回滚。格式检查仅剩已有
  `history_cell/session.rs` 排版差异，Clippy 仅剩其既有 `obfuscated_if_else`。总体计划仍为
  `in-progress`，下一刀回到不触碰 view 热区的 Codex `tool_lifecycle` / streaming owner。

本轮 A3/S4 composer 视觉收口（2026-09-15）：

- 对照 Codex `bottom_pane/chat_composer.rs` 的输入锚点语义，`view.rs` 移除 composer 的全宽
  上下边框，改用 `›` prompt、同基线 placeholder 与现有 textarea 状态；空态 placeholder
  使用 `Locale` 五语言文案（英文为 `Ask Lime to do anything`），输入、历史搜索高亮、Vim、
  光标和 popup 仍复用原 `ChatComposer` owner，不新增第二套 draft 状态。
- 输入区按 transcript + 活动态 status + queue preview + composer + footer 的弹性布局计算；
  idle 不再占用伪状态行，running status 仅在活动回合存在时占高。附件行先绘制，placeholder
  只绘制到文本子区域，避免空草稿覆盖远程/本地图片编号；窄终端继续通过现有高度裁剪保持
  可见输入区。
- `locale.rs` 新增 composer/model/queue/footer 相关本地化入口，并补齐 MCP inventory 与自动
  解析文案的五语言断言；本轮未修改 App Server protocol、RuntimeCore、provider 或持久化。
- 分类：`view.rs` composer geometry、`locale.rs` placeholder 属于 `current`；Codex 完整
  composer keymap、voice、atomic text-element 与私有 provider/auth 能力仍为
  `partial/contract-defer`，不通过 mock 或本地状态补造。
- 验证：`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check` 通过；TUI library
  `845/845` 通过，新增 idle placeholder、transient status 与远程图片选择回归通过，
  `git diff --check` 通过。真实 `npm run smoke:tui-gate-b` 默认矩阵通过，覆盖
  complete/queue-edit/agents-overview/focus-palette/resize-reflow/reconnect 与 terminal restore。
  TUI Clippy 仍被并行改动 `history_cell/session.rs` 的既有
  `clippy::obfuscated_if_else` 阻断；本轮未运行 `verify:gui-smoke`，也未将历史 Gate B 证据
  误作本轮新证据。总体计划保持 `in-progress`，下一刀继续 S4 status/footer 窄屏矩阵或回到
  A3 `tool_lifecycle`/streaming owner。

本轮 A3 tool-lifecycle / streaming 边界收口（2026-09-15）：

- 对照 Codex `chatwidget/tool_lifecycle.rs` 与 `chatwidget/streaming.rs`，将 Lime 的
  `ItemStarted/ItemCompleted` 多 Agent 生命周期观察从 `app/thread_events.rs` 拆到唯一的
  `app/tool_lifecycle.rs`；该 owner 只更新既有 `AgentNavigationState` 的 parent-owned 与
  liveness，不创建第二套工具队列、线程状态或 projection。
- `ReasoningSummaryPartAdded` 以前在 Lime 路由层被丢弃，现由 canonical `ConversationProjection`
  保留 streamed reasoning section 边界；已完成 reasoning item 对迟到通知保持不变，后续
  `item/completed` 仍是权威文本修复点。新增多 Agent lifecycle、reasoning section 和迟到
  边界回归，协议与 RuntimeCore 不变。
- 分类：`app/tool_lifecycle.rs` 与 reasoning streaming 边界属于 `current`；Codex 完整
  stream controller、interrupt queue、provider/private realtime 与系统副作用仍为
  `partial/contract-defer`，无 compat 包装、生产 mock 或本地 history store。
- 验证：`cargo test --manifest-path lime-rs/Cargo.toml -p tui tool_lifecycle`（2/2）、
  `cargo test --manifest-path lime-rs/Cargo.toml -p tui reasoning_summary`（1/1）、
  `cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check` 通过；结构 inventory 已
  更新至 878 个文件。完整 TUI/Gate B 未在本刀重复执行；当前工作树既有 `view.rs` 两项
  测试失败与 `history_cell/session.rs` Clippy 阻塞保持原样，未覆盖并行修改。

本轮 A3 streaming 终态护栏补充（2026-09-15）：

- 对照 Codex `chatwidget/streaming.rs` 的 stream flush 语义，`ConversationProjection` 的
  `append_delta` 现在只接受仍处于 streaming 状态且类型匹配的条目；`item/completed` 替换
  后的迟到 assistant/reasoning/command/plan delta 会被忽略，不再改写 canonical 文本。
- `TurnCompleted` 的终态收敛同时关闭所有 provisional `streaming` 尾部，即使该条目没有
  `status=Running`；这使中断/失败后到达的旧 delta 不能重新创建可见的活动尾部。canonical
  turn item 仍可在后续 `item/completed` 或 turn repair 中正常替换，未新增 item/turn store。
- 新增 `late_agent_delta_does_not_reopen_completed_item`、迟到 reasoning delta 回归，以及
  `terminal_turn_closes_unrepaired_stream_tail_against_late_delta`；改动仅落在既有
  `projection.rs` owner，分类为 `current`，Codex provider/private stream controller 仍为
  `partial/contract-defer`。
- 验证：三项定向 projection 测试与 `cargo fmt --manifest-path lime-rs/Cargo.toml --all
-- --check`、目标文件 `git diff --check` 通过；完整 TUI all-targets 继续作为本刀收尾门槛。

本轮 A3 streaming 终态集合补充（2026-09-15）：

- `ConversationProjection` 增加轻量 `closed_turn_ids` 集合；hydrate 的已完成/失败/中断回合
  与实时终态 `turn.completed` 均登记回合身份，所有 assistant/reasoning/plan/command
  delta 以及 patch/diff/plan 临时更新在创建或替换前 fail-closed。这样完全未知 item 的迟到
  通知也不会在终态回合后凭空制造 streaming transcript 行。
- `TurnStarted` 清除对应旧身份，允许新回合正常建立 provisional item；canonical
  `ItemCompleted`/turn repair 仍不受该集合限制，继续作为权威文本来源。未新增 item/turn
  store、协议字段、兼容包装或生产 mock。
- 新增 `terminal_turn_rejects_late_delta_for_unknown_item` 与
  `a_new_turn_can_create_a_streaming_item_after_a_terminal_turn` 回归。该切片属于 `current`，
  Codex 私有 stream controller、provider/private realtime 和完整 interrupt queue 仍为
  `partial/contract-defer`。
- 验证：`projection::tests` 49/49、`cargo fmt --manifest-path lime-rs/Cargo.toml --all
-- --check`、目标文件 `git diff --check` 通过；完整 TUI all-targets 待本刀收尾执行。

本轮 A3 reasoning status projection 补充（2026-09-15）：

- 对照 Codex `chatwidget/streaming.rs` 的 `latest_summary_line`，`ConversationProjection`
  增加唯一 reasoning status 投影：活动回合中的最新可用粗体/标题行进入 status row，空行和
  HTML 注释不覆盖已有标题；Hook display message 仍优先，显式 `set_status`、错误和回合终态
  会清除 reasoning 标题。hydrate、实时 item completion 和 reasoning delta 复用同一提取规则。
- 该能力只使用现有 `status`/`active_turn_id` 与 canonical reasoning entry，不新增 ChatWidget
  私有状态、provider stream controller、history store 或协议字段；分类为 `current`，完整
  reasoning replay/voice handoff 继续 `partial/contract-defer`。
- 新增 `reasoning_summary_updates_running_status_with_latest_usable_line` 与
  `explicit_status_clears_reasoning_summary_header` 回归。
- 验证：projection 定向测试 `52/52`、`cargo fmt --manifest-path lime-rs/Cargo.toml --all
-- --check`、TUI all-targets `clippy -D warnings`、目标文件 `git diff --check` 均通过。

本轮 S4 status/footer 窄屏矩阵收口（2026-09-15）：

- `bottom_pane/footer.rs` 对齐 Codex 空闲 footer：无草稿且无活动回合时保留本地化快捷键入口
  （英文 `? for shortcuts`），同时修正右侧 context 超宽时的整段折叠，避免窄屏残词或越界。
- `view.rs` 与 `status_indicator_widget.rs` 增加五语言 × `40/80/120` 列运行态、队列、hook、
  details 几何回归，确保 transcript/status/queue/composer/footer 五区连续且每行按 display
  width 安全截断；不修改 ChatComposer 状态模型。
- 分类：footer 快捷键提示、status/footer 几何属于 `current`；Codex context 百分比、完整
  statusline 配置和私有 provider 状态因 Lime 无 canonical 事实源，继续 `partial/contract-defer`，
  不通过 mock 或第二状态 owner 补造。
- 验证：TUI library `853/853`；TUI Clippy `-D warnings`、workspace fmt check、
  `npm run inventory:tui-structure`（878 files）、`git diff --check` 与
  `npm run smoke:tui-gate-b` 均通过。Gate B 真实 PTY/alternate screen/stdio JSON-RPC 事件链为
  `turn.started,message.delta,item.started,item.completed,turn.completed`，并验证
  `queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 和
  `terminal=restored`。
- A3/S4 当前退出：composer、status、footer 的 Codex 核心视觉合同已有 Lime owner 与窄屏回归；
  下一刀进入 S5 popup/picker 统一（slash/file/skill/model/agent/approval/request_user_input），
  不扩大到 Codex 私有 account/update/marketplace/storage。

本轮 S5 slash popup 锚定收口（2026-09-15）：

- 对照 Codex `bottom_pane/command_popup.rs`，Lime slash command popup 限制为最多 8 个可见行，
  上下导航时移动可见切片，保证选中项始终可见且弹层继续贴合 composer；命令 catalog、输入
  parser 与 App Server contract 均未复制或修改。
- 选中项使用统一 Lime `accent_style`，描述使用 `muted_style`，每行按终端 display width
  截断；新增长目录 TestBackend 回归验证 72x16 终端中选中行可见与行数上限。
- 分类：popup geometry/style 属于 `current`；Codex 私有 service-tier/account 命令继续
  `excluded`，不建立 compat 或第二命令状态源。
- 验证：command popup 定向测试 `6/6` 通过；随后完整 TUI library 达到 `854/854`，Clippy、
  fmt、`git diff --check`、inventory `878 files` 与新一轮真实 `smoke:tui-gate-b` 均通过。
  最新 Gate B 继续覆盖 `queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、
  `reconnect` 与 `terminal=restored`。
  下一刀扩展 model/agent/resume picker 及 approval/request_user_input overlay 的窄屏布局。

本轮 S5 picker 语义样式补充（2026-09-15）：

- `model_picker.rs` 与 `app/agent_picker.rs` 复用 Lime 语义样式 owner：选中行使用
  `accent_style`，标题、描述和 footer 使用 `muted_style`；不改变 popup 尺寸、导航快捷键或
  App Server catalog。
- 保留 ModelPicker 现有 Enter 索引合同，同时完成选中态与文案样式收口；navigation/control-
  binding 回归与既有 picker 多语言窄屏测试一并通过。
- 验证：完整 TUI library `862/862`、TUI Clippy `-D warnings`、fmt 与 `git diff --check` 均通过。
  随后重新运行真实 `npm run smoke:tui-gate-b`，`queue-edit/agents-overview/focus-palette/`
  `resize-reflow/reconnect/terminal=restored` 全部通过；下一刀继续 model/agent/resume overlay
  的行数和锚定矩阵，再处理 approval/request_user_input。

本轮 A3 streaming/projection 收尾证据（2026-09-15）：

- `npm run inventory:tui-structure` 刷新结构账本为 `878` 个文件；真实
  `npm run smoke:tui-gate-b` 通过，thread `01a0a253-7f84-7670-80a5-0599efba75ed`、turn
  `turn_a34330e0fd5f4f358df65145ea90b8c4`，事件为
  `turn.started,message.delta,item.started,item.completed,turn.completed`，并证明
  `queue-edit`、`agents-overview`、`focus-palette`、`resize-reflow`、`reconnect` 与
  `terminal=restored` 均为 `ok`。
- TUI all-targets 在本轮达到 `852` 通过、`1` 失败；唯一失败为并行既有
  `bottom_pane::footer::tests::queue_hint_shortens_before_it_disappears` 的
  `show_context` 断言，单测复跑仍稳定复现，未触及本轮 projection 写集。该失败不归因于
  本轮代码，也未覆盖或回滚并行 footer 改动；本轮自身 projection `52/52`、all-targets
  `clippy -D warnings`、fmt、Gate B 与 `git diff --check` 均通过。

本轮 S5 picker 导航合同补充（2026-09-15）：

- 对照 Codex `bottom_pane/list_selection_view.rs`、`resume_picker.rs` 与 picker 测试，
  `ModelPicker`、`AgentPicker`、`resume_picker::PickerState` 的可搜索列表现在保留普通
  `j/k`（以及其它无修饰字符）作为查询输入；上下箭头和 Ctrl-P/N/K/J 才执行列表导航，
  resume picker 仍保留 PageUp/PageDown 分页。模型/Agent picker 上下导航按 Codex 列表规则
  循环，resume picker 的已加载行继续使用原有分页边界，不伪造远端数据。
- 未映射的 Ctrl/Alt 字符不再污染模型或 resume 查询；command popup 同步接受 Ctrl-P/N/K/J
  导航。所有改动只落在已有 picker/composer owner，没有新增协议字段、第二套 selection
  state、runtime 或本地存储。
- `model_picker` 定向测试 `5/5`、`agent_picker` 定向测试 `4/4`、`command_popup` 定向测试
  `10/10`、resume picker 新增导航/查询回归通过。完整 TUI all-targets 仍需在并行 footer
  热区修复后收口；本轮未覆盖其既有 `queue_hint_shortens_before_it_disappears` 失败。

本轮 S5 approval/request_user_input 窄屏合同补充（2026-09-15）：

- `bottom_pane/render.rs` 的高度测量改为使用带上下边框交互面的真实文本宽度；之前错误扣除
  两列会让窄终端的 CJK/emoji 换行行数被低估。approval 与 request_user_input 选项共同复用
  `selection_row_layout::visible_item_window` 和 `MAX_POPUP_ROWS=8`，长目录导航时窗口跟随
  选中项，保留原始 option index/提交语义，不增加第二套 selection state。
- request_user_input 的 Up/K 与 Down/J 在 Options 焦点下按 Codex 列表语义循环；Notes 焦点仍由
  同一 ChatComposer 处理。footer 在本地化主提示无法容纳时按 `Enter · Esc`、`↵ · Esc`、
  `↵Esc`、`Esc` 逐级压缩，保证取消入口不被中间截断；宽度足够时继续追加已有次要提示。
- 新增回归：12 项 request_user_input 末项选中时只渲染 8 行且选中行可见；窄宽度高度测量与
  Paragraph 实际行数一致；选项上下导航首尾循环；五语言极窄 footer（3/4/7/12/18 列）不越界
  且保留 Esc。分类：approval/request_user_input 窄屏窗口、footer 与导航均为 `current`；
  Codex 完整 ScrollState、可配置 keymap 和完整 async_questions layout 仍为 `partial/contract-defer`。
- 验证：定向回归 `3/3`；`cargo test --locked --manifest-path "lime-rs/Cargo.toml" -p tui --all-targets`
  `879` library、`16` integration、`1` dependency regression 全部通过；
  `cargo clippy --locked --manifest-path "lime-rs/Cargo.toml" -p tui --all-targets --no-deps -- -D warnings`、
  workspace fmt、`git diff --check`、`npm run test:contracts` 均通过。真实
  `npm run smoke:tui-gate-b` 通过，thread `01a0a289-f0d4-7b11-8fb4-cff598078b55`、turn
  `turn_7baeb791a896424cacc61e48fcc4ad52`，事件为
  `turn.started,message.delta,item.started,item.completed,turn.completed`，并证明
  `queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored` 均为 `ok`。
  本轮未触及 Electron/GUI bridge，未运行 `verify:gui-smoke`；workspace 全量 Clippy 仍可能受
  并行 `agent-protocol` lint 影响，不作为 TUI 写集阻塞。
- 这一步继续推进 `TUI Host -> App Server JSON-RPC -> RuntimeCore -> canonical
Thread/Turn/Item projection` 主链的可操作交互；下一刀回到 S5 余项（MCP elicitation/统一
  selection footer）或 A2 history/transcript contract，不复制 Codex 私有 runtime/store。

本轮 S5 approval/request_user_input 窄屏布局补充（2026-09-15）：

- approval 与 request_user_input 继续复用现有 BottomPane 和 App Server typed request，不新增
  协议、RuntimeCore 或 mock 状态。approval 选项统一编号和 `accent_style` 选中态，底部 footer
  固定保留 `Enter confirm · Esc cancel`；request_user_input footer 按宽度优先保留 `Enter
submit` 与 `Esc cancel`，次级选择/备注/问题导航提示仅在有空间时出现。
- 问题标题、说明和选项使用 grapheme-safe 宽度重排；request_user_input 选项窗口最多展示 8
  项并保证当前选择可见，编辑输入行保持单行截断，光标定位跟随重排后的实际输入行。
- `view.rs` 新增五语言 × `40/80/120` 列审批/问答 TestBackend 回归，覆盖标题、选项、主
  操作和行宽边界；locale 新增 overlay controls 全语言文案回归。
- 分类：窄屏 approval/request_user_input presentation 属于 `current`；Codex guardian、
  account 与未映射的完整 async_questions 字段保持 `contract/defer`，无 compat/mock fallback。

验证：TUI library `879 passed`、TUI Clippy `-D warnings`、workspace fmt check、
`git diff --check`、`npm run inventory:tui-structure`（878 files）与真实
`npm run smoke:tui-gate-b` 均通过；Gate B 事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并继续覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。App Server
仍有既有 `lower_turn_start_params`/`lower_runtime_options` dead-code warning，不影响本刀。

本轮 S5 resume picker 窄屏矩阵补充（2026-09-15）：

- 对照 Codex `resume_picker.rs` 的搜索行、选中行和 bounded list 语义，resume picker 标题
  收敛为单一动作标题，列表选中标记由 row owner 显式绘制 `❯ `，普通行预留同等宽度，避免
  ratatui `List` 内建高亮符号造成行首跳动；展开详情按扣除标记后的实际宽度渲染。
- 垂直布局改为从终端高度动态分配 header/search/list/footer，极短终端下 footer 不再把列表
  推出可视区域；metadata、transcript loading/failed/empty 提示和标题均采用 grapheme-safe
  截断，宽度为 0 时 fail-closed。
- 新增 TestBackend 回归覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` × `40/80/120`
  列，组合长标题、长路径、长搜索词、选中末项和展开 transcript，确认渲染行数、选中行和
  Unicode cell 均保持在终端边界内。
- 分类：resume picker 的动作标题、列表 marker、动态 chrome 和窄屏截断属于 `current`；
  Codex 私有 state DB fallback、provider/account 过滤与完整 toolbar 持久化继续
  `contract/defer`，不建立本地 history store 或 compat 路径。

验证：resume picker 定向回归 `41/41`；TUI library `882/882`；TUI Clippy `-D warnings`、
workspace fmt、`git diff --check`、`npm run inventory:tui-structure`（878 files）和真实
`npm run smoke:tui-gate-b` 均通过。Gate B 事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并继续覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。

本轮 S3 provider notice 视觉收口（2026-09-15）：

- `ConversationProjection` 将 typed `WarningNotification` 与 typed `ErrorNotification` 映射为
  独立的 `EntryKind::Warning`/`EntryKind::Error`；普通 system activity 仍保留 `System`。
- `entry.rs` 按 Codex notice 形状渲染 `⚠ ` attention 与 `■ ` failure，正文使用同一
  grapheme-safe wrapping owner；401/Unauthorized 原始错误文本保持不变，错误后 composer
  恢复路径与 App Server JSON-RPC 合同不变。
- 技能加载摘要/详情改用 warning/error 语义；导出和 history 渲染同步覆盖新 kind，未新增
  协议字段、runtime、store 或生产 mock。

分类：provider warning/error presentation 与 typed projection 属于 `current`；Codex 私有
guardian/account 错误元数据仍为 `contract/defer`，不在本刀伪造。

验证：TUI library `893/893`、TUI Clippy `-D warnings`、workspace fmt、`git diff --check`、
`npm run inventory:tui-structure`（878 files）及真实 `npm run smoke:tui-gate-b` 均通过。
本轮未触及 Electron/GUI bridge，未运行 `verify:gui-smoke`。下一刀继续 S5 统一 MCP
elicitation/selection footer，或扩大 A2 history/transcript contract 证据。

本轮 S5 MCP elicitation 窄屏补充（2026-09-15）：

- `bottom_pane/mcp_server_elicitation.rs` 继续作为唯一交互 owner，复用 App Server typed
  elicitation request 和既有 response mapping；不新增协议、RuntimeCore、provider 或本地
  状态源。
- MCP 选项保持 8 行 bounded viewport，footer 在窄宽度逐级压缩且保留 `Esc`；文本输入在
  宽度投影前先按显式换行拆成物理行，再进行 grapheme-safe 截断，确保多行 CJK/emoji 草稿的
  可见行与光标坐标一致。
- 新增 12 列 TestBackend 回归，覆盖中文、emoji、显式换行、输入行宽度和光标物理行；现有
  五语言 controls、长选项 bounded window 与极窄 footer 回归继续有效。
- 本切片分类为 `current` presentation/interaction；Codex 私有 async_questions、完整
  keymap/guardian/account 与未映射 MCP transport 继续 `partial/contract-defer`，不恢复任何
  retired runtime/store/fallback。

验证：MCP elicitation 定向测试 `11/11`；已执行 `cargo fmt --all`、`git diff --check`。完整
TUI all-targets、Clippy、结构 inventory 与真实 `npm run smoke:tui-gate-b` 作为本轮收尾门禁
继续执行；未触及 Electron/GUI bridge，因此不运行 `verify:gui-smoke`。

本轮 S6 streaming pager anchor 补充（2026-09-15）：

- `pager_overlay.rs` 的 transcript 手动滚动现在识别 streaming active line 原地替换：在
  canonical 行数量不变、且存在共同前缀/后缀（或单行 transcript）时，保留原逻辑行索引，
  再按当前宽度计算新的 wrapped height。delta 增长不会把用户锚点留在旧的视觉行号。
- 没有共同邻接行的同长度 hydrate/replacement 继续 fail-closed；prepend history、width
  reflow、底部 pinned 和 overlay 生命周期沿用既有 owner。没有新增 protocol/runtime/store
  或生产 mock。
- 新增 `transcript_overlay_remaps_manual_anchor_when_streaming_line_grows_in_place` TestBackend
  回归，锁定 canonical anchor 在 streaming redraw 后保持不变。

分类：S6 streaming pager anchor 为 `current`；主聊天 terminal-native scrollback 的完整
source-backed reflow、Codex live-cell commit 与跨 runtime VT100 contract 仍为
`partial/contract/defer`。

验证：pager 定向测试 `13/13`；TUI all-targets `884` library、`16` integration、`1`
dependency regression；TUI Clippy `-D warnings`；workspace fmt；`git diff --check`；
`npm run inventory:tui-structure`（878 files）；真实 `npm run smoke:tui-gate-b` 均通过。
Gate B 事件仍为 `turn.started,message.delta,item.started,item.completed,turn.completed`，
并证明 `queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
本轮未触及 Electron/GUI bridge，因此不运行 `verify:gui-smoke`。

本轮 S5 选择标记统一补充（2026-09-15）：

- 对照 Codex `history_cell/messages.rs` 与 `selection_list.rs`，canonical 用户消息及
  slash command、model、agent、skill、file picker 的选中/用户 gutter 统一为 `› `；未修改
  Markdown blockquote 等语义性的 `> `，也未新增协议、runtime、store 或 mock。
- 同步更新 `history_cell`、slash popup、view 的稳定断言，保留窄终端逐行截断和原有 popup
  锚定行为；所有选择器继续复用各自 current owner。

分类：Codex marker/选中态为 `current` presentation；未映射的 Codex onboarding/mentions
专用 `>` marker 继续保持原语义并不纳入主聊天 marker 合同。

验证：TUI library `891/891`；TUI Clippy `-D warnings`；workspace fmt；`git diff --check`；
`npm run inventory:tui-structure`（878 files）；真实 `npm run smoke:tui-gate-b` 均通过。Gate B
事件链为 `turn.started,message.delta,item.started,item.completed,turn.completed`，并继续覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。

本轮 S6 主视图 viewport anchor 补充（2026-09-15）：

- `transcript_reflow.rs` 新增唯一 `TranscriptViewport` owner，主 `view.rs` 通过它把
  `App::transcript_scroll` 的距底部请求解析为 canonical wrapped-row offset。上一帧行内容、
  宽度和实际 offset 会在 streaming tail 增长、active line 原地替换或 width reflow 时重映射，
  手动滚动不再因新 delta 重新落到尾部。
- 距底部为 0 的 pinned 语义继续跟随新内容；thread 切换与 `hydrate_thread` 清除 viewport
  锚点并回到底部，防止跨会话污染。所有数据仍来自 App Server canonical Thread/Turn/Item
  projection，没有新增协议、runtime、history store 或生产 mock。
- 新增 `TranscriptViewport` 回归覆盖 streaming 尾部增长、宽度 reflow、pinned tail-follow，
  以及 thread 切换回到底部；旧 pager overlay anchor 规则继续保留并独立覆盖 overlay 场景。

分类：主视图 scroll anchor、streaming tail-follow 和 width reflow 为 `current`；terminal-native
scrollback 的完整 source-backed rebuild、Codex live-cell commit 与跨 runtime VT100 contract
仍为 `partial/contract/defer`。

验证：`transcript_reflow` 定向测试 `6/6`；TUI all-targets `888` library、`16` integration、
`1` dependency regression；TUI Clippy `-D warnings`；workspace fmt；`git diff --check`；
`npm run inventory:tui-structure`（878 files）；真实 `npm run smoke:tui-gate-b` 均通过。Gate B
事件仍为 `turn.started,message.delta,item.started,item.completed,turn.completed`，并证明
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。本轮未触及
Electron/GUI bridge，因此不运行 `verify:gui-smoke`。

本轮 S5 MCP elicitation 元数据与选项描述补充（2026-09-15）：

- 对照 Codex `mcp_server_elicitation.rs` 的 `McpToolApprovalDisplayParam` 和单选项描述语义，
  Lime 继续在唯一 `McpServerElicitationOverlay` owner 内消费 App Server `_meta`：工具审批
  的 `tool_params_display` 保持服务端显式顺序，缺失时从 `tool_params` 按名称稳定排序，最多
  展示 3 项，值复用 canonical JSON compact 与 grapheme 截断；未知或 malformed 元数据仍
  fail-closed，不改变响应 action/content/meta 合同。
- `oneOf` 单选 schema 现在保留每个选项的 `description`，在选项行中按两空格分隔显示，并
  复用已有窄屏单行省略和 `MAX_POPUP_ROWS=8` 边界；标题、字段和 footer 的既有五语言布局不
  变更。未引入 tool suggestion consumer、第二套 selection state 或本地 fallback。
- 结构守卫同步到当前 `input_flow`/`input_submission` 与 `tool_lifecycle` owner，修复守卫对
  已迁出 `app/input.rs` 和 `thread_events::observe_item` 的过期正向断言，避免错误阻塞后续
  Codex owner 收敛。

验证：MCP elicitation 定向回归 `14/14`、TUI all-targets `895` library、`16` integration、
`1` dependency regression；TUI Clippy `-D warnings`、workspace fmt、`git diff --check`、
`npm run inventory:tui-structure`（878 files）及结构守卫 `16/16` 通过。该切片只触及 Rust
TUI presentation/structure owner，未触及 Electron/App Server protocol，因此未运行
`verify:gui-smoke`；真实 `smoke:tui-gate-b` 沿用最近一次通过证据，下一刀继续 A2
history/transcript contract 或 S5 selection footer 的 remaining Codex keymap/defer 项。

本轮 S5 overlay Ctrl-C 草稿边界补充（2026-09-16）：

- 对照 Codex `request_user_input::on_ctrl_c` 与 `mcp_server_elicitation` 的文本编辑边界，
  Lime 的 request-user-input notes 和 MCP 文本字段在有非空草稿时，首个 Ctrl-C 只清空当前
  草稿并保留交互；空草稿或选项字段才发送既有 typed cancel/empty response。该行为复用
  当前 `ChatComposer`/`TextArea` 状态，不新增协议字段、runtime、history store 或 mock。
- 新增 `ctrl_c_clears_notes_before_cancelling_request`、
  `ctrl_c_clears_text_draft_before_cancelling_elicitation` 和
  `ctrl_c_on_select_field_cancels_without_mutating_selection` 回归，覆盖二次 Ctrl-C 取消、
  选项焦点 fail-closed 以及草稿清除后的状态保持。

分类：overlay 草稿/取消边界属于 `current`；Codex 完整 keymap、异步队列和 interrupted
answer persistence 仍为 `partial/contract-defer`。未新增 `compat`/`deprecated` surface。

验证：定向 TUI 回归 `5/5`（`ctrl_c_clears` 过滤）、`cargo fmt --all -- --check` 通过；
完整门禁见下方收尾记录。该切片未触及 Electron/App Server protocol，因此不运行
`verify:gui-smoke`。

收尾验证：TUI all-targets `897` library、`16` integration、`1` dependency regression；TUI
Clippy `-D warnings`、workspace fmt、结构/快照 inventory `18/18`、`npm run test:contracts`、
`npm run governance:scripts`、`npm run governance:legacy-report`、`git diff --check` 和真实
`npm run smoke:tui-gate-b` 均通过；legacy report 摘要为零引用候选 0、分类漂移候选 0、边界
违规 0。
Gate B 线程为 `01a0a618-f0eb-76c2-98c5-a5d305b9177d`，回合为
`turn_dfa8a3a8e67b464eb71b04b943f7e6dd`；App Server 的既有
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 非本切片引入。

本轮 A2 resume transcript preview bounded scan 补充（2026-09-16）：

- 对照 Codex `resume_picker_transcript_preview.rs`，将 Lime resume picker 的 preview 从完整
  transcript loader 中拆出为独立 current owner。分页 history 首页请求 6 个 item，后续按
  `HISTORY_ITEM_PAGE_LIMIT=100` 翻页，最多扫描 `HISTORY_ITEM_SCAN_LIMIT=400` 个 item；重复
  cursor、空 cursor 或扫描预算耗尽均 fail-closed，并保留最近 6 行的 canonical item 顺序。
- 完整 transcript、pager 和 `/export` 仍继续使用 `thread_transcript.rs` 的全量 canonical
  projection，不把 bounded preview 限制错误带入导出或完整历史；legacy history 继续走既有
  `thread/read(include_turns=true)` 兼容路径。新增 `HISTORY_ITEM_SCAN_LIMIT` 归属
  `app_server_session/history.rs`，没有新增 history store、协议字段、runtime 或 mock。
- `resume_picker.rs` 只委托给 preview owner，删除重复的 entries-to-preview 转换；新增
  repeated-cursor 与 400-item budget 回归，锁定 Codex 的 bounded/fail-closed 语义。

分类：resume preview bounded pagination 属于 `current`；完整 legacy rollout tail、Codex 私有
rollout scanner、完整 ChatWidget/history keymap 仍为 `partial/contract-defer`。未新增
`compat`/`deprecated` surface，未删除现有主链入口。

验证：TUI all-targets `900` library、`16` integration、`1` dependency regression；TUI
Clippy `-D warnings`；workspace fmt；结构/快照 inventory `18/18`；`npm run test:contracts`；
`git diff --check` 均通过。本轮未触及 App Server protocol 或 Electron bridge，真实 Gate B
已复跑并通过：Gate B 线程为 `01a0a775-498b-7d22-a3e8-e078f75c25ba`，回合为
`turn_dec78edeb1dd4f178b1f4510e832dea2`，继续证明
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`；
App Server 的既有 `lower_turn_start_params`/`lower_runtime_options` warning 仍非本切片引入。
下一刀回到 A2 history/transcript contract 证据或 S5 footer/keymap 的 remaining partial 项。

本轮 S5 request-user-input option position footer 补充（2026-09-16）：

- 对照 Codex `request_user_input/render.rs` 在选项 viewport 被截断时插入 `option n/m` 的语义，
  Lime 在唯一 `RequestUserInputOverlay` owner 内根据真实选项数量和当前选择生成位置提示；
  `Other` 选项计入总数，选中索引按边界钳制，不读取渲染文本或维护第二套 selection state。
- 提示纳入现有 footer 优先级：Enter/Esc 主操作始终优先，窄屏压缩仍沿用既有
  `footer_hint_for_width`，并为 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` 提供本地化文案。
  没有改变 overlay 高度、App Server 协议、RuntimeCore、持久化或生产 mock。
- 新增长选项列表位置提示和五语言覆盖回归；已有 Ctrl-C 草稿清理语义保持不变。

分类：长选项列表的 selection position footer 属于 `current` presentation；Codex 完整
多行 FooterTip/keymap 系统、异步 question queue 和 interrupted answer persistence 仍为
`partial/contract-defer`。未新增 `compat`/`deprecated` surface。

验证：TUI all-targets `902` library、`16` integration、`1` dependency regression；TUI
Clippy `-D warnings`；workspace fmt；结构/快照 inventory `18/18`；`git diff --check`；真实
TUI Gate B 均通过。最新 Gate B 线程为 `01a0a8bd-875f-7d11-8be0-485cc5732a65`，回合为
`turn_d98e14c2e3e14428a33fd344c287afa1`，事件链继续为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
本轮未触及 App Server protocol 或 Electron bridge，因此不运行 `verify:gui-smoke`；下一刀
回到 A2 history/transcript contract 证据或 S5 footer 的多行布局 remaining partial 项。

本轮 S5 request-user-input 多行 footer 补充（2026-09-20）：

- 对照 Codex `request_user_input::{footer_tip_lines,footer_required_height}`，Lime 在唯一
  `RequestUserInputOverlay` owner 内按完整提示单元排布 footer；提交/取消作为不可拆分的首要
  操作，选项位置、选择、备注和问题导航按真实显示宽度换行，单个过长提示使用既有
  grapheme-safe ellipsis，不维护第二套 keymap 或 selection state。
- `BottomPane` 暴露统一的 footer lines/required height，`view::screen_chunks` 只在活动的
  request-user-input 交互中分配多行 footer；普通聊天、approval 与 MCP 仍保持既有高度和
  contract。footer 在高度变化时清理完整分配区域，输入边框、宽字符 continuation cell 与
  提示行不会重叠。
- 新增 Codex-shaped `footer_wraps_hints_without_splitting_individual_hints`，并扩展五语言
  `40/80/120` TestBackend、极窄宽度和 screen geometry 回归；不新增 App Server 协议、
  RuntimeCore、持久化或生产 mock。

分类：request-user-input footer wrapping/height 属于 `current` presentation；Codex 动态
ShortcutHint/完整 RuntimeKeymap、异步 question queue 和 interrupted answer persistence 仍为
`partial/contract-defer`。未新增 `compat`/`deprecated` surface。

验证：request-user-input 定向回归 `23/23`；TUI all-targets `903` library、`16`
integration、`1` dependency regression；TUI `--no-deps` Clippy `-D warnings`；workspace fmt；
结构/快照 inventory `18/18`（878 files / 991 snapshots）；`git diff --check`；真实 TUI
Gate B 均通过。最新 Gate B 线程为 `01a0bbfb-492c-7cb0-aa74-13dcc55243c4`，回合为
`turn_08e36e9ca96842d0a148f5a3286963a5`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
全依赖 Clippy 仍被写集外 `agent-protocol` 的既有 `large_enum_variant` 与
`derivable_impls` 阻断；本轮未越界修改。未触及 Electron/GUI bridge，因此不运行
`verify:gui-smoke`；下一刀回到 A2 history/transcript contract 证据或 S5 剩余动态 keymap
contract/defer 项。

本轮 A2 双 history mode 完整 transcript contract 证据（2026-09-20）：

- 扩展真实 App Server fixture，分别通过公共 `thread/start` 创建 `paginated` 与 `legacy`
  线程，显式断言响应中的 `historyMode`；paginated 写入 101 个 completed turn，形成
  207 个 canonical item / 3 个 item page，legacy 写入 51 个 completed turn，形成 102 个
  canonical item / 2 个 item page。fixture 使用与 TUI 相同的 `experimentalApi` capability，
  并在 PTY 启动前通过公共 `thread/items/list` 验证页数、item 数与 cursor 不重复。
- 对齐 Codex `resume_picker_loads_complete_paginated_and_legacy_transcripts` 场景，通过两个真实
  `lime resume` PTY 分别执行 Home/End 键盘输入，并验证首尾 `SEED_000/100` 与
  `LEGACY_000/050` 可见；paginated 的 Home 跨越全部 3 页，同时覆盖 Codex
  `transcript_home_loads_every_older_history_page`。该路径继续覆盖 review turn、重复 nested
  prompt 和 fork interrupted tail，`NESTED_REVIEW_PROMPT` 由 canonical transcript
  projection 过滤。
- 两条路径都验证 completion separator 无重复，并在退出后断言 alternate screen restore。
  fixture 经过真实 stdio App Server、initialize/initialized、公共 JSON-RPC、同一
  Thread/Turn/Item read model 和终端投影，不引入第二套 history store、runtime 或生产 mock。

分类：双 history mode 的完整 transcript contract 与真实 resume PTY 证据属于 `current`；
inventory 中其余 136 个 Codex transcript/history contract 场景仍为
`partial/contract-defer`，后续按 owner 与产品风险逐项迁移，不以私有 rollout scanner 或
测试侧 projection 冒充 current 主链。

验证：真实 `npm run smoke:tui-history-pagination` 通过，paginated 线程为
`01a0bc76-0f17-70e1-be94-3e7d83aa7f62`（207 items / 3 pages），legacy 线程为
`01a0bc75-de12-7423-b6c4-7f33bcf41d31`（102 items / 2 pages）；TUI all-targets `903` library、`16`
integration、`1` dependency regression；TUI `--no-deps` Clippy `-D warnings`；
`npm run test:contracts`、`npm run governance:scripts`、workspace fmt、`git diff --check`、
结构/快照 inventory `18/18`（878 files / 991 snapshots）均通过。App Server 的既有
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 非本切片引入；全依赖
Clippy 仍受写集外 `agent-protocol` 的既有 lint 阻断。本轮未触及 Electron/GUI bridge，
因此不运行 `verify:gui-smoke`。

本轮 A2 underfilled main scrollback 自动补页（2026-09-20）：

- 对齐 Codex `underfilled_scrollback_fetches_older_pages_without_opening_the_transcript`，新增
  `history_ui::rendered_transcript_row_count`，直接复用 canonical transcript cell 与
  `HyperlinkParagraph` wrapping 计算当前宽度下的真实行数，不维护第二套高度或渲染模型。
- `history_pagination::top_up_underfilled_history` 在主 transcript 行数不足当前 viewport 时，
  通过既有 `thread/items/list` cursor 连续加载 older pages，直到填满 viewport 或到达历史
  起点；启动 resume、in-app resume、agent switch、reconnect 和 resize 共用一个 runtime
  trigger，full-screen picker/pager 活动时不后台抢拉。
- 新增 Codex 同名真实 PTY 回归：将终端扩展到 400 行后启动三页 paginated thread，不打开
  transcript overlay、不发送任何滚动键，主视图直接同时显示 `SEED_000` 与 `SEED_100`；退出
  后继续验证 alternate screen restore。该路径只消费 App Server canonical Thread/Turn/Item，
  未新增 history store、协议字段、生产 mock 或 terminal-height 配置副本。

分类：underfilled main scrollback 的 viewport-aware auto-fill 属于 `current`；Codex
terminal-native scrollback row cap、完整 source-backed reflow/notice 与跨 runtime VT100 contract
仍为 `partial/contract-defer`，不在 Lime ratatui 主视图中复制私有 rollout owner。

验证：wrapped-row 定向回归 `1/1`；TUI all-targets `904` library、`17` integration、`1`
dependency regression；TUI `--no-deps` Clippy `-D warnings`；`npm run test:contracts`、
`npm run governance:scripts`、结构/快照 inventory `18/18`、workspace fmt 与
`git diff --check` 均通过。专用 `npm run smoke:tui-history-pagination` 通过，paginated 线程为
`01a0bc9a-b3e0-7ad3-b2a0-4662701b789f`（207 items / 3 pages），legacy 线程为
`01a0bc9a-83e7-7982-8afd-3bd8291d79bd`（102 items / 2 pages），证据包含
`underfilled=auto-filled`；通用 `npm run smoke:tui-gate-b` 亦通过，线程为
`01a0bc9b-1ee2-71a0-b8aa-efb4333cd98e`、回合为
`turn_67c7d96d041346919664aaccb802a5cf`，继续覆盖 queue-edit、agents-overview、
focus-palette、resize-reflow、reconnect 与 terminal restore。本轮未触及 Electron/GUI bridge，
因此不运行 `verify:gui-smoke`。

本轮 A2 older-history stale cursor guard（2026-09-22）：

- 对照 Codex `app_server_session/history.rs` 的 `is_older_history_page_pending` 与
  cursor-scoped cancellation，Lime 的 older-page 请求现在同时校验 `thread_id + cursor`。
  旧线程、旧 cursor 或已被新请求替换的响应会在投影前 fail-closed；旧响应也不会清除当前
  cursor 的 loading 状态，避免重连、切线程和快速滚动时污染 canonical transcript。
- `begin_older_history_page`、`apply_older_history_page`、`cancel_older_history_page` 与
  `App::request_older_history_page` 共用同一 pending 判定；没有新增协议字段、runtime、
  history store、兼容包装或生产 mock。该切片属于 `current`，A2 其余 history/transcript
  contract 仍按 App Server canonical Thread/Turn/Item 逐项收口。

验证：history 相关定向测试 `94/94`；完整 TUI all-targets `905` library、`17` integration、
`1` manager regression；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、
`git diff --check` 与结构守卫 `16/16` 通过。真实
`npm run smoke:tui-history-pagination` 通过（paginated `207 items / 3 pages`、legacy
`102 items / 2 pages`、`underfilled=auto-filled`、`alternate-screen=restored`）；
`npm run smoke:tui-gate-b` 通过，继续覆盖 queue-edit、agents-overview、focus-palette、
resize-reflow、reconnect 与 terminal restore。未触及 Electron/GUI bridge，因此不运行
`verify:gui-smoke`。

本轮 A2 stale completion surface guard（2026-09-23）：

- 对照 Codex `history_pagination.rs` 的 owned-transcript stale completion 语义，Lime 在
  `handle_older_history_page_with_turns` 中先验证 `thread_id + cursor + loading` 仍属于当前
  请求，再判断 transcript pager 是否已经耗尽 older history；如果显式 transcript overlay
  已没有 older page，旧响应在投影前 fail-closed 并仅取消匹配的 pending cursor。inline/main
  transcript 仍允许在 availability flag 刷新窗口接收响应，避免把同步 top-up 误判为 stale。
- 抽出纯状态判定 `transcript_history_surface_is_current`，补回归覆盖 transcript overlay
  exhausted、overlay with older page 和 inline refresh 三种边界。失败路径继续由
  cursor-scoped cancellation 释放 loading，后续 `begin_older_history_page` 可重试；没有新增
  协议字段、runtime、history store、兼容包装或生产 mock。

分类：older-history completion ownership 与 transcript fail-closed boundary 属于 `current`；
Codex owned transcript 的异步 viewport/search/keymap 状态在 Lime 没有同构 canonical consumer，
仍为 `partial/contract-defer`，未借此引入第二套状态机。

验证：新增定向回归与既有 pending-cursor 回归均通过；TUI 全量 `906/906` library、`17/17`
integration、`1/1` manager regression；TUI `--all-targets --no-deps` Clippy `-D warnings`、
workspace fmt、`git diff --check` 通过。真实 `npm run smoke:tui-history-pagination` 通过
（paginated `207 items / 3 pages`、legacy `102 items / 2 pages`、review filtering、
underfilled auto-fill、alternate-screen restore）；`npm run smoke:tui-gate-b` 通过，继续覆盖
queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 与 terminal restore。
未触及 Electron/GUI bridge，因此不运行 `verify:gui-smoke`。

本轮 A2 history pagination pure state ownership（2026-09-23）：

- 将 `ThreadHistoryPagination` 的 `begin`、pending cursor 判定、cursor-scoped cancel 和 page
  apply 收回同一纯状态 owner；`AppServerSession` 只负责按 `thread_id` 查找并委托，不再在
  session facade 重复维护 loading/cursor 转移逻辑。
- 新增 `stale_completion_preserves_new_cursor_and_failed_page_can_retry` 回归：旧 cursor
  的 late completion/cancel 不会清除新 cursor 的 loading；当前页失败只释放 loading，保留同一
  cursor 供下一次请求重试。item 仍按 canonical page 的 descending payload 逆序投影，重复
  cursor 继续 fail-closed。
- 该切片只收敛 current 状态 owner，没有新增协议字段、runtime、history store、compat 包装或
  生产 mock；Codex owned transcript 的异步 viewport/search/keymap 仍保持
  `partial/contract-defer`。

验证：history 定向测试 `9/9`、TUI 全量 `907/907` library、`17/17` integration、`1/1`
manager regression、TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt 与
`git diff --check` 均通过。首次 Gate B 的既有 `resize-reflow` PTY 用例发生一次 5 秒退出超时，
按同一入口重跑后通过；最终 Gate B 覆盖 queue-edit、agents-overview、focus-palette、
resize-reflow、reconnect、terminal restore。`npm run smoke:tui-history-pagination` 通过，
paginated `207 items / 3 pages`、legacy `102 items / 2 pages`、review filtering 和
underfilled auto-fill 均通过。未触及 Electron/GUI bridge，因此不运行 `verify:gui-smoke`。

本轮 A2 transcript pager failure/retry surface（2026-09-23）：

- 对照 Codex `TranscriptHistoryState::{LoadingOlder, Failed}` 与失败后保留 viewport 的语义，
  Lime 在唯一 `PagerOverlay` owner 内增加最小 `HistoryLoadState`：旧历史请求开始、完成和失败
  均由 runtime 明确转移；失败只更新 pager footer，不改变 scroll/pinned/anchor，也不写第二套
  transcript 数据。
- transcript footer 在 loading 时显示五语言加载提示，失败时显示 `Home` 重试和关闭入口；
  现有 Home 事件继续返回 `LoadOlderHistory`，因此失败后可从同一 App Server cursor 重新请求。
  由于 Lime 当前历史请求仍是同步 await，loading 状态不会在 await 中途触发独立 redraw，故不复制
  Codex 异步 frame scheduler；状态仍作为下一帧的 current presentation owner，失败路径明确
  fail-closed 并保持 anchor。
- 普通 status/MCP pager 不进入 transcript history state；`set_older_history_available(false)`
  会清理残留失败状态，避免线程切换或历史耗尽后继续显示重试提示。没有新增协议字段、RuntimeCore、
  history store、compat 包装或生产 mock；现有 runtime 只接入既有 App Server 请求的状态转移，
  成功重试时仅清理此前的 history-page error，不覆盖活动回合状态。

分类：transcript pager 的 loading/failed/retry footer 与 anchor 保持属于 `current`；Codex
owned transcript 的异步 viewport/search/keymap、动态 shortcut hints 仍为 `partial/contract-defer`，
不在 Lime 同步 transport 上伪造第二套状态机。未新增 `compat`/`deprecated` surface。

验证：新增 pager failure/retry、成功重试清理错误和五语言 footer 回归；TUI 全量 `909/909` library、`17/17`
integration、`1/1` manager regression；`cargo clippy --locked --manifest-path lime-rs/Cargo.toml
-p tui --all-targets --no-deps -- -D warnings`、workspace fmt、`git diff --check` 均通过。
真实 `npm run smoke:tui-history-pagination` 与 `npm run smoke:tui-gate-b` 均通过；最新 history
fixture 为 paginated `01a0cb59-238a-7442-8f9b-d72c79b92885`（`207 items / 3 pages`）与 legacy
`01a0cb58-f434-74a3-8183-9eddd00510f1`（`102 items / 2 pages`），并通过
`review=nested-filtered/underfilled=auto-filled/alternate-screen=restored`。最新 Gate B
线程为 `01a0cb57-c55e-7542-8564-5bc880211095`，回合为
`turn_97038a466efb4ab29c8efd6fdca40b79`，事件链继续为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
本轮仅触及 Rust TUI runtime/presentation 与本地化，未触及 Electron/GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A2 真实 PTY history failure/retry evidence（2026-09-23）：

- 扩展历史分页 Gate B 的 PTY harness，支持 `lime resume <thread> --remote <ws-url>`，并将
  macOS 测试运行时动态库路径显式传入 PTY 子进程；local App Server 参数仍只在 local
  `tui/resume` 模式传递，避免 remote fixture 意外启动第二个 sidecar。
- 新增真实 remote WebSocket JSON-RPC fixture：`initialize`、`thread/resume`、canonical
  `thread/items/list`、turn/settings/catalog 等公开方法均走同一 TUI client。初始页保持足够
  viewport 行数，避免启动阶段 underfilled auto-fill 提前消费故障；用户在 transcript overlay
  按 Home 时，`history-cursor` 首次返回 JSON-RPC error，失败 footer 保留 anchor 并显示
  `History load failed / Home retry`，再次 Home 使用同一 cursor 成功返回 `older-history`。
- 回归验证 transcript 关闭、Ctrl-D 退出和 alternate screen restore；fixture 通过一次性失败
  原子状态确认注入故障确实经过真实 PTY。没有新增生产协议字段、App Server mock fallback、
  history store、compat/deprecated surface 或平行 runtime；所有数据仍来自 canonical
  Thread/Turn/Item projection。

分类：remote PTY failure/retry fixture 与 transcript pager failure surface 属于 `current`；
Codex 异步 viewport/search/keymap 仍为 `partial/contract-defer`，未在同步 TUI transport 上
伪造第二套状态机。

验证：TUI `cargo test --locked --manifest-path lime-rs/Cargo.toml -p tui` 通过，`909` library、
`18` integration、`1` manager regression；新增 failure/retry 测试单独通过；
`cargo clippy --locked --manifest-path lime-rs/Cargo.toml -p tui --all-targets --no-deps -- -D warnings`、
workspace fmt 与 `git diff --check` 通过。真实
`npm run smoke:tui-history-pagination` 通过：paginated `01a0cc04-8fc0-72a1-b8b9-2d7ecee58755`
（`207 items / 3 pages`）、legacy `01a0cc04-5ca1-7b23-ac2e-de4caa128629`
（`102 items / 2 pages`），并包含 `review=nested-filtered/underfilled=auto-filled/
alternate-screen=restored`。`npm run smoke:tui-gate-b` 通过：thread
`01a0cc05-e23f-78e2-8da3-5acbfd8666b3`、turn `turn_fba87792fd334de3ac962536987443b8`，
继续覆盖 queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 与
terminal restore。本轮未触及 Electron/GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。

本轮 A1 OSC 8 宽字符 diff 几何回归（2026-09-23）：

- 对照 Codex `terminal_hyperlinks` 的
  `buffer_hyperlinks_preserve_visible_cell_width_for_ratatui_diff`，在 Lime 唯一
  `terminal_hyperlinks` owner 补同名回归。测试使用半宽音标 `ｶﾞ`，验证 OSC 8 装饰后首个
  ratatui cell 仍保留双列宽度、`ForcedWidth` diff 标记，以及后续 `diff_iter` 坐标从第 3
  列继续；这同时锁定 UTF-8/grapheme 边界不会把 hyperlink 控制序列计入可见宽度。
- 仅补 current 纯渲染回归，没有改 Markdown/diff 协议、runtime、history store、兼容包装或
  生产 mock；现有 `mark_buffer_hyperlinks` 继续作为唯一 OSC 8 buffer lowering owner。

分类：OSC 8 与宽字符/半宽音标的 ratatui diff 几何属于 `current`；Codex 终端私有的完整
snapshot gallery、平台 terminal backend 和异步 presentation 状态仍为 `partial/contract-defer`，
不在 Lime 中复制第二套渲染后端。

本轮同时补 `diff_render` 的 `narrow_wrap_preserves_emoji_and_cjk_graphemes`，锁定
emoji/CJK grapheme 不被窄宽度切成半个字符，并验证每个 fragment 的 display width 不超过
边界。两条新增定向测试均通过；随后完整 TUI `911` library、`18` integration、`1`
manager regression，TUI `--all-targets --no-deps` Clippy、workspace fmt、`git diff --check`、
结构 inventory `16/16` 与 `npm run governance:scripts` 均通过。真实
`npm run smoke:tui-gate-b` 通过：thread `01a0cde7-d92a-7540-b497-fcb4c20861a7`、turn
`turn_98205c1fea774e0591cb6493ddacee95`，覆盖 queue-edit、agents-overview、focus-palette、
resize-reflow、reconnect 与 terminal restore。App Server 的既有
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 未由本切片引入。

本轮 A1 buffer hyperlink / diff 宽度回归补充（2026-09-23）：

- 对照 Codex `terminal_hyperlinks` 的
  `buffer_hyperlinks_follow_word_wrapping`、`buffer_hyperlinks_follow_wrapped_wide_glyphs`、
  `buffer_hyperlinks_follow_wrapped_halfwidth_dakuten`，在 Lime 唯一 buffer lowering owner
  补齐同名 TestBackend/Buffer 断言。测试分别覆盖 URL 跨词换行、CJK 宽字符和半宽音标在
  `Paragraph` 实际换行后的 OSC 8 目的地与可见文本一致性。
- 对照 Codex `diff_render::fallback_wrapping_uses_display_width_for_tabs_and_wide_chars`，
  补 Lime diff fallback 的 tab/CJK/emoji 窄宽度上限回归；现有 `hard_wrap`、tab 归一化和
  continuation gutter owner 不变，没有复制第二套 wrapping 实现。

分类：上述纯终端 buffer/diff geometry 回归属于 `current`；Codex trusted file hyperlink、
平台 terminal backend 和完整 snapshot gallery 没有 Lime canonical consumer，继续保持
`partial/contract-defer`，不新增协议、runtime、history store、compat 包装或生产 mock。

验证：hyperlink 定向回归 `5/5`、diff 定向回归 `38/38` 均通过；完整 TUI `915` library、
`18` integration、`1` manager regression，TUI `--all-targets --no-deps` Clippy、workspace
fmt、`git diff --check`、结构 inventory `16/16`、`npm run governance:scripts` 均通过。
真实 `npm run smoke:tui-gate-b` 通过：thread `01a0ce82-d3d5-7882-bee5-1d75407c931b`、turn
`turn_6e1e3cecfe154d2984c4f78e79e08450`，覆盖 queue-edit、agents-overview、focus-palette、
resize-reflow、reconnect 与 terminal restore。App Server 的既有
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 未由本切片引入。

本轮 A1 Markdown 文件链接与 anchor 边界（2026-09-24）：

- 对照 Codex `markdown_render/local_links.rs` 与 `markdown_render_tests.rs`，Lime 的 current
  Markdown owner 现在接收 canonical session cwd：cwd 内绝对文件目标按词法前缀缩短，cwd 外、
  `~/`、Windows drive 与 UNC 目标保留稳定显示，不访问文件系统、不引入 trusted-file object。
- 补齐 `#L12C3`、`#L12C3-L14C9`、冒号行列范围与 Unicode en-dash 范围解析，避免范围末端重复
  冒号；file URL 的 Windows drive、UNC、一次 percent decode、非法 percent spelling 和
  literal `%2520` 标签比较均收回 `markdown/local_links.rs` 唯一 owner。
- Markdown 列表中 local file link 后的软换行只在后续文本以 `:` 开头时保持同一逻辑行，其余
  情形仍按原有换行；local-link label 的 soft/hard break 以空格缓冲，避免多行标签提前脱离，
  transcript wrapping 回归证明窄终端不会把文件目标与后续正文拆开。
  没有新增协议字段、RuntimeCore、history store、compat 包装或生产 mock。

分类：cwd-aware Markdown local-link lowering、anchor normalization 与列表软换行属于
`current`；Codex trusted file object、完整 Markdown snapshot gallery、私有 terminal backend
和异步 presentation 状态在 Lime 没有 canonical consumer，继续保持 `partial/contract-defer`；
本轮未新增 `compat` / `deprecated` / `dead` surface。

验证：Markdown/local-link 定向 `46/46` 与 full TUI library `923/923` 通过；TUI all-targets 同样为
`923` library、`18` integration、`1` manager regression；TUI `--all-targets --no-deps`
Clippy `-D warnings`、workspace fmt、`git diff --check`、结构 inventory `16/16`、
`npm run governance:scripts` 均通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d0c6-5327-73d3-b4d8-3560469025ce`、turn `turn_a763d84ab75541568b2ed87d80d19941`，
事件链为 `turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。本轮
仅触及 Rust TUI Markdown/transcript presentation 与结构 inventory，未触及 Electron/GUI
bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A2 transcript search 最新命中与精确高亮收口（2026-09-24）：

- 对齐 Codex `transcript_view/search.rs` 的初始扫描方向，搜索查询首次建立命中时定位到当前
  已加载 transcript 的最新命中；Enter 到达 newer 边界不循环，Shift+Enter/Ctrl+P 向更旧
  命中移动，并在边界继续复用 older-history 请求。查询为空或加载失败时仍保持既有
  `PagerOverlay` fail-closed 行为。
- `highlight_search_lines` 改为按 extended grapheme 拆分 Span，仅对实际匹配的 grapheme
  添加 selected/non-selected modifier，保留原始 span 样式与 OSC 8 hyperlink columns；不再
  将包含命中的整行或整 span 误标记为高亮。新增回归验证 prefix/suffix 不高亮、匹配区域
  高亮以及 hyperlink destination 不变。

分类：最新命中方向与 grapheme 级高亮属于 `current` presentation；Codex source-backed
selection snapshot、异步 bounded scheduler 和跨 revision reading restore 仍为
`partial/contract-defer`。未新增协议、runtime、history store、compat/deprecated surface。

验证：新增 pager 定向回归通过；TUI library `928/928`、integration `18/18`、manager
regression `1/1`、TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、
`git diff --check` 均通过。Gate B 首次复跑遇到 PTY fixture 提前关闭且未出现 completion
标记，按同一入口重跑后通过：thread `01a0d134-28b0-7013-a48a-1ee1b3a97dbd`、turn
`turn_7dd02827c93a41489d45ada179ab8972`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
首次失败属于真实 PTY 启动/退出竞态，第二次完整通过；App Server 的
`lower_turn_start_params`/`lower_runtime_options` warning 仍为既有 dead-code warning。
本轮未触及 Electron/GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。

本轮 A2 transcript search grapheme 编辑边界补充（2026-09-24）：

- 搜索退格改用 `UnicodeSegmentation::grapheme_indices`，一次删除完整 extended grapheme；
  粘贴截断也只落在 grapheme 边界，避免组合音标、emoji ZWJ 或宽字符被拆成不可见半字符。
  该逻辑仍只作用于 `PagerOverlay` 查询编辑器，不改变 canonical transcript 文本或 App
  Server contract。
- 新增组合音标 + ZWJ emoji 粘贴/连续退格回归；此前的最新命中、局部高亮、hyperlink 保留和
  history retry 语义保持不变。

验证：TUI library `929/929`、integration `18/18`、manager regression `1/1`、Clippy
`-D warnings`、workspace fmt、`git diff --check`、结构守卫 `16/16` 通过；真实 Gate B
通过：thread `01a0d13b-d20a-7703-bfac-e45b5ace6adb`、turn
`turn_bbb8a2b83d6e499f97a38eb4dad78eff`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
未触及 Electron/GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。

本轮 A1 wrapped-row geometry 唯一 owner 收口（2026-09-24）：

- 对照 Codex `terminal_hyperlinks/paragraph.rs` 与 transcript/pager 的共同行高语义，将
  `wrapped_line_starts` 收回 Lime `terminal_hyperlinks` 唯一纯渲染 owner；
  `pager_overlay.rs` 与 `transcript_reflow.rs` 不再各自复制同一套
  `HyperlinkParagraph::line_count` 累积算法。滚动锚点仍使用与 OSC 8 可见文本完全一致的
  ratatui display geometry。
- resume picker 的普通文本省略也改为委托既有 `line_truncation` owner，移除本地 grapheme
  截断算法；picker、footer、pager 与 diff 现在共享同一 display-width/ellipsis 语义。
- 结构 inventory 增加 `wrapped_line_starts` current symbol 守卫，避免后续重新出现平行
  wrapped-row owner；未新增协议字段、RuntimeCore、history store、compat 包装或生产 mock。

分类：`terminal_hyperlinks::wrapped_line_starts` 及 pager/transcript 接线属于 `current`；
Codex 私有 terminal backend、完整 snapshot gallery 和 source-backed terminal scrollback
仍为 `partial/contract-defer`，本轮未新增 `compat` / `deprecated` / `dead` surface。

验证：`terminal_hyperlinks` `11/11`、`pager_overlay` `14/14`、`transcript_reflow` `6/6`、
`resume_picker` `42/42`；TUI `923/923` library、`18/18` integration、`1/1` manager
regression、TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、
`git diff --check`、结构/snapshot inventory `18/18`、`npm run governance:scripts` 均通过。
真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d0e1-e925-7d73-a99f-eb3db04738a4`、turn `turn_16b8f6e30033422db937c70ebbdbf9bb`，
覆盖 `queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
本轮仅触及 Rust TUI 纯渲染 owner 与结构守卫，未触及 Electron/GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A2 transcript pager 搜索 current 子集（2026-09-24）：

- 对照 Codex `transcript_view/search.rs` 的用户可见行为，在 Lime 唯一 `PagerOverlay` owner
  增加 transcript 搜索：`/` 与 `Ctrl+F` 进入查询，普通字符/退格/粘贴编辑查询，Enter、
  Shift+Enter、Ctrl+N、Ctrl+P 在当前 canonical `HyperlinkLine` projection 中循环下一/上一
  命中，Esc/Ctrl+C 退出并保留当前浏览锚点。命中按 Unicode 不区分大小写 literal lowering，
  通过原始 UTF-8 byte range 映射到 span style，避免宽字符和 OSC 8 hyperlink geometry 漂移。
- 搜索 footer、命中计数、无匹配和操作提示补齐 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`；
  搜索只消费 `render_transcript_content_lines` 已生成的 canonical projection，不建立第二份
  transcript/history store，也不新增 App Server JSON-RPC 字段或 mock fallback。
- 命中切换仅在当前已加载 projection 内进行；Codex 的增量扫描、历史页联动和异步 search
  scheduler 仍归 `partial/contract-defer`，当前同步 TUI transport 不伪造第二套状态机。历史
  `Home` 分页仍由既有 `LoadOlderHistory` owner 处理。

分类：transcript pager 的本地搜索编辑、命中高亮、循环导航与五语言 footer 属于 `current`；
Codex source-backed transcript search 的 bounded scan、历史分页联动、selection/presentation
snapshot 恢复属于 `partial/contract-defer`。未新增 `compat` / `deprecated` / `dead` surface。

验证：pager 定向 `17/17`、TUI library `926/926`、integration `18/18`、manager regression
`1/1`；`cargo clippy --locked --manifest-path lime-rs/Cargo.toml -p tui --all-targets
--no-deps -- -D warnings`、workspace fmt、`git diff --check`、结构 inventory `16/16` 和
`npm run governance:scripts` 通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d10b-1a97-7f71-82b1-d7c1580b85ab`、turn `turn_a253cee1b07f484d81e8beb95d4e671d`，
事件链为 `turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。本轮未
触及 Electron/GUI bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A2 transcript pager 搜索与既有 history pager 接线（2026-09-24）：

- 在上一刀当前页搜索的基础上，`PagerOverlay` 现在把“当前页无命中”接到既有
  `LoadOlderHistory -> request_all_older_history_pages -> canonical projection` 链路。Enter、
  Ctrl+N、Ctrl+P 和 Home 在搜索边界请求 older page；没有更多页时不循环 wrap，而是显示
  `No more matches`。搜索请求不会创建第二套 transcript store 或本地 history cache。
- 搜索期间复用 transcript pager 的 loading/failed/retry 状态：加载中阻止重复请求，失败保留
  查询、命中游标和滚动锚点，Home/Enter 可用同一 cursor 重试；历史页成功后由当前
  `render_transcript_content_lines` canonical projection 重新计算命中。这样搜索联动仍共享
  App Server JSON-RPC history contract，而不是在 TUI 端扫描 rollout/history DB。
- 五语言 footer、命中高亮、Unicode literal folding、窄终端截断和边界提示保持不变；新增
  `transcript_search_requests_older_history_and_retries_after_a_failed_page` 回归，覆盖无命中
  自动加载、loading 去重、失败重试和旧页命中重算。Codex source-backed selection snapshot、
  异步 search scheduler、完整 selection/copy/export 仍无 Lime canonical contract，继续
  `partial/contract-defer`。

分类：当前页搜索 + 既有 history pager 接线属于 `current`；Codex 私有 source-backed search
snapshot、异步 scheduler 与未映射 selection/export 继续 `partial/contract-defer`。未新增
`compat` / `deprecated` / `dead` surface。

验证：pager 定向回归 `18/18`；TUI library `927/927`、integration `18/18`、manager
regression `1/1`；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、
`git diff --check`、结构守卫 `16/16` 均通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d127-f482-7be0-b2b5-865367715991`、turn `turn_f72f7ec5e2904ce382c5a06f9d8e764f`，
事件链为 `turn.started,message.delta,item.started,item.completed,turn.completed`，并继续
覆盖 `queue-edit/agents-overview/focus-palette/resize-reflow/reconnect/terminal=restored`。
Gate B 编译期间 `lower_turn_start_params`/`lower_runtime_options` 为既有 App Server
dead-code warning，非本切片引入。本轮仅触及 Rust TUI 与本地化，未触及 Electron/GUI
bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A2 transcript search grapheme 编辑与修饰键边界补充（2026-09-24）：

- 搜索退格改用 `UnicodeSegmentation::grapheme_indices`，一次删除完整 extended grapheme；
  粘贴截断也只落在 grapheme 边界，避免组合音标、emoji ZWJ 或宽字符被拆成不可见半字符。
  可见字符允许 Shift 编码输入，同时继续拒绝 Ctrl/Alt/Super 控制组合，避免大写输入被误吞
  或快捷键污染查询；这些逻辑只作用于 `PagerOverlay` 查询编辑器，不改变 canonical
  transcript 文本或 App Server contract。
- 新增组合音标 + ZWJ emoji 粘贴/连续退格及 Shift 字符输入回归；此前的最新命中、局部高亮、
  hyperlink 保留和 history retry 语义保持不变。

验证：新增 pager 定向回归通过；Clippy `-D warnings` 通过。此前完整 TUI library
`929/929`、integration `18/18`、manager regression `1/1`、fmt、diff、结构守卫与真实
Gate B 已通过，最新证据为 thread `01a0d13b-d20a-7703-bfac-e45b5ace6adb`、turn
`turn_bbb8a2b83d6e499f97a38eb4dad78eff`；未触及 Electron/GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。

补充真实 history fixture 验证（2026-09-24）：`npm run smoke:tui-history-pagination` 通过，
paginated thread `01a0d157-bc92-76e3-814b-be0972984c29` 为 `207 items / 3 pages`，legacy
thread `01a0d157-8c64-71b1-904d-3d0ee59a3d7b` 为 `102 items / 2 pages`，并继续证明
`review=nested-filtered`、`underfilled=auto-filled` 与 `alternate-screen=restored`。

最终 Gate B 复核（2026-09-24）：最后的 Shift/grapheme 查询编辑补丁后再次运行
`npm run smoke:tui-gate-b` 通过，thread `01a0d15a-5381-7713-a47a-53702bc4e2d7`、turn
`turn_153baf3dc2344828a05abb8a8a127b04`，事件链仍为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit=ok`、`agents-overview=ok`、`focus-palette=ok`、`resize-reflow=ok`、
`reconnect=ok`、`terminal=restored`。

本轮 A3 action-required presentation owner（2026-09-24）:

- 对照 Codex `bottom_pane/action_required_title.rs`，新增 Lime 唯一
  `bottom_pane/action_required_title.rs` owner。`build_action_required_title_text` 只连接
  已本地化的 approval、user input、MCP elicitation 值，支持排除项和空值 fail-closed，不持有
  request id、运行状态或新的队列。
- `BottomPane::action_required_title` 以当前 App Server reverse request 为事实源，统一把
  action-required 行接入现有 `bottom_pane/render.rs`；approval、request-user-input 与 MCP
  elicitation 继续使用原有交互和 typed v2 response，未复制 Codex backend banner、终端标题
  配置或第二套 selection state。
- 新增五语言 action-required/input-required 文案和窄终端兼容回归；结构 inventory 纳入
  `action_required_title.rs` 与 `build_action_required_title_text`。该切片属于 `current`
  presentation，Codex backend-owned actionable banner、rate-limit CTA 和 terminal-title
  persistence 因缺少 Lime canonical contract 继续 `partial/contract-defer`。

验证：action-required 定向测试与 TUI library `932/932`、integration `18/18`、manager
regression `1/1` 全部通过；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace
fmt、`git diff --check`、结构 inventory `16/16` 均通过。真实
`npm run smoke:tui-gate-b` 通过：thread `01a0d17c-c0f2-77e3-9e0a-04a809d36163`、turn
`turn_03aa06ea823c4f72a96f736adc344541`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖
`queue-edit=ok`、`agents-overview=ok`、`focus-palette=ok`、`resize-reflow=ok`、
`reconnect=ok`、`terminal=restored`。Gate B 编译期间的 App Server
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警，非本切片
引入。本轮仅触及 Rust TUI/presentation/localization，未触及 Electron/App Server protocol，
因此不增加 `npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A3 interaction owner 与 composer mouse selection current 切片（2026-09-24）：

- 对照 Codex `chatwidget/interaction.rs`，将 `App::handle_tui_event` 与 paste newline
  normalization 从 `app.rs` 收回新增的 `app/interaction.rs` 单一 owner。输入优先级保持为
  disconnected、pager/export/bottom pane、startup protected request、picker/overview、Vim
  query、completion popup、history search、Vim insert Escape、普通 composer；未复制 runtime、
  Thread/Turn/Item state 或 App Server transport。
- `TuiEvent::Mouse`、event stream 与 terminal lifecycle 现在转发并启停真实 mouse capture；
  `Tui::enter()` 的部分失败路径逐项 best-effort 恢复 bracketed paste、focus、mouse、alternate
  screen 与 raw mode，external editor、正常 restore、panic restore、手动 enter/leave alternate
  screen 继续共用同一终端 owner。
- 新增 `text_selection.rs`、`bottom_pane/textarea/mouse.rs` 与
  `bottom_pane/chat_composer/mouse.rs`：composer 支持 grapheme/UTF-8 安全 hit testing、wrapped
  row、宽字符、组合字符、emoji、tab、空行、拖拽选择、双击选词、三击选逻辑行、反色渲染、
  普通编辑与 Vim Replace 的选择原子替换，以及右键或 Ctrl/Cmd copy。OSC 8 hyperlink 在选择
  反色后仍保留完整 destination。copy 仍委托现有 clipboard owner；右键复制成功后清除选择，
  键盘复制保留选择，completion popup 与 remote-image selection 不建立平行状态。
- 结构 inventory 锁定 `app/interaction.rs`、`text_selection.rs`、composer/textarea mouse 文件及
  `SelectionUnit`、`handle_mouse`、`mouse_selection_range`、`copy_selection_request`、
  `clear_mouse_selection`，并把 input routing 守卫改为检查新的 interaction owner。

分类：interaction routing、composer/TextArea mouse selection/copy、`TuiEvent::Mouse` 与 terminal
mouse capture lifecycle 均为 `current`；未新增 `compat` / `deprecated` / `dead` surface。
source-backed transcript selection/copy/export、transcript mouse browsing、scroll hover 与全部
overlay mouse contract 仍为 `partial/contract-defer`，不能把本切片声明为完整 Codex mouse 对齐。

验证：TUI library `942/942`、integration `18/18`、manager regression `1/1`、TUI
`--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、`git diff --check` 与结构
inventory `16/16`、`npm run governance:scripts` 通过。真实 `npm run smoke:tui-gate-b`
通过：thread
`01a0d1ab-7f16-7583-840b-3c35a8d96cd0`、turn
`turn_0c53128c7af0400fa08fbcad6b955bb8`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`；`complete` 场景实际向
PTY 写入 SGR mouse down/up，在 composer 中间插入字符、观察可见编辑并恢复原 prompt，同时
断言 `1000h/1000l` mouse capture 与 `1049h/1049l` alternate screen 成对恢复。门禁继续覆盖
`queue-edit=ok`、`agents-overview=ok`、`focus-palette=ok`、`resize-reflow=ok`、
`reconnect=ok`、`terminal=restored`。Gate B 编译期间 App Server 的
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警，非本切片引入。
本轮未触及 Electron/App Server protocol，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。

本轮 A3 transcript mouse selection/copy current 切片（2026-09-24）：

- 对照 Codex `transcript_view/{input,selection,text}.rs`，新增 Lime
  `transcript_view/selection.rs` 唯一交互 owner。selection 只消费
  `render_transcript_content_lines -> Vec<HyperlinkLine>` 当前 canonical 展示投影；左键
  down/drag/up、双击词、三击逻辑行、右键复制、Ctrl/Cmd/Ctrl+Shift+C、Esc 和 Enter
  copy-and-follow 均由该 owner 处理，不新增 App Server 字段、history store、runtime 状态机或
  生产 mock。
- selection 开始时以 `Arc<Vec<HyperlinkLine>>` 冻结当前已加载展示快照；streaming tail 替换或
  older-history prepend 期间 pager 继续展示和命中同一 revision，复制成功后才释放，失败继续
  保留以供重试。wrapped-row 命中复刻 ratatui `WordWrapper(trim=false)` geometry，并用稳定回归
  对比 `HyperlinkParagraph::line_count`；复制取源 UTF-8 范围，只在 canonical 逻辑行之间加入
  hard newline，不复制 terminal padding/soft wrap，保留 tab 并去除其他控制字符。
- selection 反色直接 patch 已渲染 Buffer cell style，保留原 OSC 8 destination；搜索激活时
  selection/copy 优先且不修改 query。`PagerAction -> AppAction -> runtime clipboard` 接线只传递
  已选文本与 follow 意图；clipboard 成功确认后清 selection，Enter 同时恢复 tail following，
  失败保留 selection。App 内嵌 resume picker 通过显式 `TranscriptSelectionTarget` 复用同一
  runtime clipboard helper；独立 resume picker 也直接委托既有 `clipboard_copy` owner，并持有
  Linux clipboard lease，不复制新的 clipboard 实现。
- `tui-structure-inventory` 锁定 `transcript_view.rs`、`transcript_view/selection.rs`、测试文件、
  `TranscriptSelection`/`TranscriptSelectionAction` 以及 canonical projection/clipboard 边界；真实
  PTY Gate B 的 complete 场景在 Ctrl+T overlay 内定位 canonical completed text，发送 SGR
  mouse down/drag/up，并由 VT100 cell `inverse()` 证明选区可见后再关闭 overlay。

分类：当前已加载 canonical transcript projection 上的 mouse selection、快照冻结、copy、
copy-and-follow 与 clipboard 成功/失败生命周期属于 `current`；Codex 跨完整 source cell 的稳定
identity、跨未加载 page 的异步 selection persistence、edge-drag auto-scroll、键盘扩选、静止
hyperlink click/open、disclosure control，以及 terminal-only clipboard request 的
confirmed/unconfirmed 结果区分继续属于 `partial/contract-defer`。未新增 `compat`、`deprecated`
或 `dead` surface。

验证：selection/pager/app/runtime 定向回归通过；TUI library `956/956`、integration `18/18`、
manager regression `1/1`；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、结构
inventory `17/17` 与 Gate B 源码守卫 `3/3` 通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d1d0-7ad9-77b0-b73e-fe2716927a38`、turn
`turn_94c9d0f8b27d44fb95aa1a0750e45339`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖 transcript SGR
selection、`queue-edit=ok`、`agents-overview=ok`、`focus-palette=ok`、`resize-reflow=ok`、
`reconnect=ok`、`terminal=restored`。Gate B 编译期间 App Server 的
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警，非本切片引入。
本轮未触及 Electron/App Server protocol/GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。

本轮 A3 transcript input/keyboard/link current 切片（2026-09-24）：

- 对照 Codex `transcript_view/input.rs`，新增 Lime 同名 owner，并把事件路由从
  `selection.rs` 收回 input；`selection.rs` 只保留 snapshot、source anchor、wrapped visual-row
  geometry、文本提取与反色渲染。Ctrl+Space 从当前 viewport 左上建立空 selection；无修饰或
  Shift + Left/Right 按 grapheme 扩选并可跨 canonical hard newline，Up/Down 按 wrapped visual
  row 移动且保留 preferred display column，endpoint 离开 viewport 时只向 `PagerOverlay` 发
  `RevealRow`，没有复制第二套 scroll owner。
- transcript content 内鼠标滚轮每次移动 3 个 visual rows，继续由 `PagerOverlay` 限幅并维护
  tail-following；普通 HTTP(S) hyperlink 只有在同一 cell 按下/释放且未 drag/scroll 时打开，
  Ctrl/Super click 立即打开。link hit testing 复用 `HyperlinkLine` 的 display-column ranges，并
  统一经过既有 `web_destination` 控制字符过滤、长度限制和 HTTP(S)-only 校验；selection 反色与
  OSC 8 destination 继续共存。
- `PagerAction::OpenLink -> AppAction::OpenLink -> runtime` 是唯一副作用链；主 pager、App 内嵌
  resume picker 与独立 resume picker 共享该行为。runtime 使用 workspace `webbrowser` 依赖，
  通过可注入 `open_link_with` 覆盖成功、非法 scheme fail-closed 与浏览器失败；manifest、lock
  与结构 inventory 已同步，打开成功/失败状态覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、
  `ko-KR`。未增加 App Server method、Electron bridge、生产 mock 或本地 history store。
- 真实 PTY Gate B 的 complete 场景在既有 SGR mouse drag 可见断言后，发送 NUL 编码的
  Ctrl+Space 与 Right，使用 VT100 cell `inverse()` 证明键盘扩选经过真实 PTY、crossterm、
  alternate screen 和 TUI draw；终端恢复断言保持不变。

分类：当前已加载 canonical transcript projection 上的 keyboard selection、preferred column、
pager reveal、3-row wheel scroll、stationary hyperlink release、Ctrl/Super immediate open 与共享
browser effect 属于 `current`；edge-drag 连续 auto-scroll、disclosure control、跨未加载 page 的
稳定 cell identity，以及 terminal-only clipboard request 的 confirmed/unconfirmed 区分仍为
`partial/contract-defer`。未新增 `compat`、`deprecated` 或 `dead` surface。

验证：transcript 定向回归 `81/81`；TUI library `968/968`、integration `18/18`、manager
regression `1/1`；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、结构
inventory `17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts` 与
`npm run verify:app-version`、`git diff --check` 通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d1e8-8fb6-7532-aa66-666840ca7e45`、turn
`turn_182f540b1edc4e06b302b56e97b751cf`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖 transcript SGR
mouse selection、Ctrl+Space keyboard selection、`queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`。Gate B 编译期间
App Server 的 `lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警，
非本切片引入。本轮未触及 Electron/App Server protocol/GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A3 transcript edge-drag 连续自动滚动 current 切片（2026-09-24）：

- 对照 Codex transcript selection 的 edge-drag 行为，在 Lime 唯一
  `transcript_view::{input,selection}` owner 内补齐连续自动滚动：只有真实发生过垂直移动的
  drag 停在内容区顶/底边时，才在每个 Draw tick 推进一个 wrapped visual row；纯水平边缘拖拽
  不滚动，wheel 会暂停自动滚动，下一次真实 Drag 才恢复。render 更新 layout 后使用相同的
  pointer screen position 重新扩展 endpoint，到达 transcript 顶/底即停止续帧。
- `PagerOverlay` 继续是唯一 transcript scroll owner；`FrameRequester` 继续是唯一帧调度 owner。
  `PagerAction::ContinueTranscriptSelection -> AppAction::ScheduleFrameIn` 只复用现有
  `schedule_frame_in(TARGET_FRAME_INTERVAL)`，没有新增 timer、线程、事件循环或第二套 viewport
  状态。主 transcript pager、App 内 resume transcript pager 与独立 resume picker 共用该实现。
- `FocusLost` 与 `Resume` 结束 drag 但保留非空 selection；空鼠标 selection 只在原本处于
  dragging 时清除，空键盘 selection 仍可继续扩展。真实 PTY harness 同步移除两个时序猜测：
  打开 transcript 前等待 canonical `item.completed` 与 `turn.completed` completion separator，
  composer 点击后等待真实 cursor position，不再依赖固定 100ms sleep 或要求未变化的 marker
  必须重新出现在 PTY 字节流。
- Gate B complete 场景使用 `TUI_EDGE_ROW_00..39` 的长 canonical assistant projection，Home
  回到顶部后发送真实 SGR mouse down/drag 并保持在内容区底边；连续 Draw 将 viewport 滚到
  `TUI_GATE_B_COMPLETED`，VT100 `inverse()` 同时证明 endpoint 保持可见，随后发送 mouse release。
  该证据经过真实 `lime`、PTY、alternate screen、App Server JSON-RPC、RuntimeCore 与同一
  Thread/Turn/Item projection。

分类：edge-drag auto-scroll、one-row Draw tick、共享帧调度、focus/resume drag termination 与
三种 transcript surface 复用均为 `current`；未新增 `compat`、`deprecated` 或 `dead` surface。
disclosure control、跨未加载 page 的稳定 cell identity，以及 terminal-only clipboard request 的
confirmed/unconfirmed 区分继续属于 `partial/contract-defer`。

验证：edge-drag/FocusLost 定向回归通过；完整 TUI `976/976` library、`18/18` integration、
`1/1` manager regression；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、
结构 inventory `17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts`、
`npm run verify:app-version`、locked Cargo metadata 与 `git diff --check` 全部通过。
真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d216-90ed-7822-956d-19b71a3344c0`、turn
`turn_645d892baccf4c2b92121a2e5df119db`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖 transcript mouse
selection、keyboard selection、edge-drag auto-scroll、`queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`。Gate B 编译期间
App Server 的 `lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警，
非本切片引入。本轮未触及 Electron/App Server protocol/GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A3 transcript activity disclosure current 切片（2026-09-24）：

- 对照 Codex `transcript_view/{disclosure,layout,text}.rs` 与 `HistoryCell` activity contract，
  在 Lime `transcript_view/disclosure.rs` 新增本地 presentation owner。结构化
  `TranscriptContent` 只携带 source/compact/expanded render 与 canonical activity IDs；
  `TranscriptEntry.id` 以 `entry:<id>` 命名空间作为稳定 identity，展开集合、焦点和 scroll
  anchor 仍归 `PagerOverlay` 本地状态，不进入 App Server、ThreadStore、canonical projection
  或通用 `HyperlinkLine` 业务字段。
- `HistoryCell` 补齐 `compact_hyperlink_lines`、`expanded_hyperlink_lines`、`activity_ids` 与
  `has_hidden_activity_details`；Command/Patch/Mcp/Plan/MultiAgent/Tool 的 compact 展示保留现有
  invocation/title 首行，expanded 继续复用完整 `text + summary` renderer。主 Ctrl+T transcript
  pager、App 内 resume pager 与独立 resume picker 共用同一 presentation；older-history prepend
  和 resume replay 后按 entry ID 保留展开状态与焦点，不复制 transcript store。
- `+ Show details` / `− Show less` 是 synthetic row：物化时记录独立 excluded-line metadata，
  search、mouse/keyboard selection、highlight 与 copied source 均显式跳过控制行；键盘 selection
  横向/纵向跨过控制行时直接落到相邻 source row。鼠标点击 control 可展开/收起；F4 进入
  activity focus，Up/Down/PgUp/PgDn/Home/End 导航，Enter/Space 切换，Left/Right 定向收起/展开，
  Esc 返回。toggle 使用 activity ID 与 viewport row bias 保持可见 anchor。
- disclosure label、focus footer 与 pager affordance 覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、
  `ko-KR`。结构 inventory 锁定 disclosure owner、HistoryCell contract、excluded source 边界，
  并禁止其依赖 App Server session 或 ThreadStore。
- 真实 PTY Gate B 在 canonical `item.completed + turn.completed` 后打开 Ctrl+T transcript，实际
  观察 `+ Show details`，发送 xterm F4 序列与 Enter，观察 `− Show less` 和 canonical
  `terminal-gate-b` tool output；随后原有 SGR mouse selection、Ctrl-Space keyboard selection、
  edge-drag auto-scroll 与 terminal restore 继续通过。

分类：full-screen 主 transcript pager、App 内/独立 resume pager 的 activity disclosure、稳定
entry identity、synthetic source exclusion、mouse/keyboard control 与五语言文案均为 `current`；
未新增 `compat`、`deprecated` 或 `dead` surface。Codex grouped/live activity 多 member identity 的
完整过渡，以及 terminal-only clipboard request 的 confirmed/unconfirmed 区分继续属于
`partial/contract-defer`。

验证：定向 disclosure/selection 回归通过；完整 TUI `983/983` library、`18/18` integration、
`1/1` manager regression；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、结构
inventory `17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts` 与
`npm run verify:app-version` 通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d235-6fc8-7ce2-8976-a660b68b6cfe`、turn
`turn_255a984b9e854449af1a976ea87685f2`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`；并覆盖 disclosure、
transcript mouse/keyboard selection、edge-drag、`queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`。Gate B 编译期间 App
Server 的 `lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警，非本
切片引入。本轮未触及 Electron/App Server protocol/GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A3 clipboard acknowledgement current 切片（2026-09-24）：

- 对照 Codex `clipboard_copy.rs`、`tui/selection_clipboard.rs` 与
  `app/owned_transcript.rs`，Lime 既有 `clipboard_copy.rs` 继续作为唯一 clipboard owner，并新增
  显式 `CopyOutcome::{Copied,Requested}` 与 `CopyStatus::{Confirmed,Unconfirmed}`。native clipboard
  与 WSL PowerShell 的成功写入属于 `Confirmed`；tmux/OSC52 只有发送结果、没有 delivery
  acknowledgement，因此属于 `Unconfirmed`。SSH/tmux 不再跳过 native/WSL：先尝试可确认写入，
  同时按需向 terminal 转发；terminal 失败不覆盖已经确认的 native 结果。
- `CopyOutcome::store` 只在 backend 返回新 lease 时替换 Linux clipboard owner；
  `Copied(None)` 和 `Requested` 都保留已有 lease。`/copy`、composer selection、transcript
  selection 和 `/export` 全部消费同一 outcome，不再从 `Option<ClipboardLease>` 猜测结果，也
  没有新增第二套 clipboard backend。
- 主 Ctrl+T pager、App 内 resume pager 与独立 resume picker 都把 copy 结果回送同一
  `PagerOverlay::apply_transcript_copy_result` presentation owner。只有 `Confirmed` 清 selection；
  copy-and-follow 也只有在 `Confirmed` 时关闭搜索并跳到最新。`Unconfirmed` 和失败保留冻结的
  selection/search/scroll，便于用户粘贴验证或重试；composer 右键 selection 同样只在确认后
  清除。pager footer 的 confirmed/unconfirmed/failed 反馈与 App 状态覆盖 `zh-CN`、`zh-TW`、
  `en-US`、`ja-JP`、`ko-KR`。
- 分类：clipboard outcome/status、native/terminal routing、lease retention、三种 transcript
  surface 的 acknowledgement lifecycle 与五语言反馈均为 `current`；未新增 `compat`、
  `deprecated` 或 `dead` surface。此前 terminal-only confirmed/unconfirmed 缺口已收口；Codex
  grouped/live activity 的多 member identity 完整过渡仍为 `partial/contract-defer`。

验证：clipboard routing 定向回归 `7/7`；完整 TUI library `985/985`、integration `18/18`、
manager regression `1/1`；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、locked
Cargo metadata、结构 inventory `17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts`、
`npm run verify:app-version` 与 `git diff --check` 通过。真实 `npm run smoke:tui-gate-b` 首次在
既有 external-editor 恢复后的 mouse cursor 等待处发生一次时序失败，保留目录
`tui-gate-b-dmohlL`；未修改该无关 harness，原命令复跑通过：thread
`01a0d24a-090b-7c90-bb54-531147cc95fb`、turn
`turn_560b9ebf5991412aa49d1c8fc8667028`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖 disclosure、
transcript mouse/keyboard selection、edge-drag、`queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`；通过目录
`tui-gate-b-oQ8C8U` 同样保留。App Server 的 `lower_turn_start_params`/
`lower_runtime_options` dead-code warning 为既有告警。本轮未触及 Electron/App Server
protocol/GUI bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。

本轮 A3 grouped/live activity identity current 切片（2026-09-24）：

- 对照 Codex `exec_cell/model.rs`、`exec_cell/render.rs`、
  `history_cell/computer_activity.rs`、`chatwidget/{activity_groups,command_lifecycle,
tool_lifecycle}.rs` 与 `transcript_view/disclosure.rs`，Lime 不再从 command 文案或 MCP summary
  猜测分组。TUI `ConversationProjection` 直接消费 canonical `CommandExecution.source`、
  `CommandExecution.commandActions` 与 `McpToolCall.server`：只有非 `UserShell` 且 actions 非空并全部属于
  Read/ListFiles/Search 的命令进入 exploration group；只有 `server=cua_repl` 的 MCP 调用进入
  computer group。Unknown/write/user-shell/普通 MCP 均 fail closed。
- `ActivityGroupKey` 是 TUI 内 render-only key，由 activity kind 与 canonical turn scope 组成，
  不进入 App Server protocol、ThreadStore 或 export。完整 Thread hydrate 与实时
  item.started/item.completed 使用真实 turn id；分页 group 缺少公开 turn id 时只使用该 canonical
  group 的首个 item id 作为局部 scope，因此不会跨页或跨回合臆测合并。
- `app/history_ui.rs` 只合并相邻且完整 key 相同的 entry；completion boundary 会显式截断 group。
  主 Ctrl+T pager、App 内 resume pager 与独立 resume picker 共用该 composition。每个成员仍保留
  `entry:<item-id>` identity；单成员 live cell 过渡为多成员 committed group 时，disclosure 通过
  member identity overlap 保留展开状态、焦点与 anchor，不新增 mutable active-cell 后端。
- 分类：canonical activity 分类、turn-scoped adjacent grouping、multi-member disclosure identity
  与 live/committed presentation 过渡均为 `current`；未新增 `compat`、`deprecated` 或 `dead`
  surface。Codex 把 transcript-only reasoning 吸收到 exploration/computer group，以及跨分页边界
  拼接同一未完成 group 的能力仍为 `partial/contract-defer`：现有公开分页输入没有可证明的 turn
  identity，本轮不通过 summary 文本、本地缓存或伪造协议字段补齐。

验证：activity classification/grouping/live-transition 定向回归通过；完整 TUI library
`988/988`、integration `18/18`、manager regression `1/1`；TUI `--all-targets --no-deps` Clippy
`-D warnings`、workspace fmt、locked Cargo metadata、结构 inventory `17/17`、Gate B 源码守卫
`3/3`、`npm run governance:scripts` 与 `npm run verify:app-version` 通过。真实 Gate B 前三次分别在
既有 external-editor composer cursor 时序点、resize-reflow 的 5 秒 terminal restore 等待、以及
同一 external-editor cursor 时序点抖动；external-editor 失败现场包括
`tui-gate-b-JNkbVt`、`tui-gate-b-1T6Nik`，均未删除，也未修改无关 harness。对应真实 PTY 单测
随后独立复跑通过，第四次原命令完整通过：thread
`01a0d25e-82f0-7173-b87f-f6f91f0dc75c`、turn
`turn_438d1263443a42a38c364c5d2023886e`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖 disclosure、
transcript mouse/keyboard selection、edge-drag、`queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`。App Server 的
`lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警。本轮未触及
Electron/App Server protocol/GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。

本轮 A3 activity compact presentation current 切片（2026-09-24）：

- 对照 Codex `exec_cell/{render,compact}.rs`、`history_cell/computer_activity.rs` 及对应
  exploration/computer snapshots，在上一刀 canonical grouping key 之上新增唯一结构化展示事实：
  exploration 直接保存 `CommandAction + exit_code`，computer 直接保存 bounded title、截图数量与
  error。renderer 不解析 command 文案或 summary，也不把 presentation state 写入 App Server、
  ThreadStore、export 或第二套 history model。
- exploration compact 统一为 `Exploring/Explored`，相邻成功 Read 去重合并，List/Search/Read 保留
  canonical action 顺序；compound command 只在最后一个 action 显示 exit code，Search exit 1 可见但
  不使用 failure 色，compact 最多保留两行 detail 并显示失败计数。computer compact 统一为
  `Using/Used computer · N actions · M failed`，完成态优先展示 failure 和 screenshot，active 态展示
  当前 call；所有行在窄终端按 grapheme/display width 截断。
- `app/history_ui.rs` 成为四个 surface 的唯一 composition owner：主 transcript、Ctrl+T pager、App
  内 resume pager 与独立 resume picker 均消费同一 grouped compact renderer；expanded 仍逐条保留
  canonical invocation/output/summary。单成员 live group 也使用 grouped compact，扩为多成员
  committed group 后通过成员 ID overlap 保留 disclosure；completion boundary 截断 group。旧测试
  fixture 或无法证明 structured facts 的条目 fail closed 回退原单项 renderer。
- 新增 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` 的 exploration/computer/action/count/failure/
  capture/exit 文案与稳定回归；缺失 computer title 的 `Computer action` fallback 在非英文 locale
  也不泄漏英文。新增回归覆盖 Codex 英文 shape、failure/screenshot 选择、Search exit 1 样式、
  main transcript 聚合、跨 turn 边界、live-to-committed disclosure identity 与窄宽度。
- 分类：structured activity presentation facts、四 surface compact composition、五语言文案与
  live/committed display transition 均为 `current`；未新增 `compat`、`deprecated` 或 `dead` surface。
  Codex transcript-only reasoning absorption 与缺少公开 turn identity 时的跨分页未完成 group 拼接仍为
  `partial/contract-defer`，不通过 summary 文本、本地缓存或伪造 canonical 关系补齐。

验证：完整 TUI library `996/996`、integration `18/18`、manager regression `1/1`；TUI
`--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、locked Cargo metadata、结构 inventory
`17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts`、`npm run verify:app-version` 与
`git diff --check` 全部通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d290-5cb5-7fc0-a70f-9d72d12d83a2`、turn
`turn_f4d6fadeeddd4344b950a00b4058d8d3`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖 disclosure、
transcript mouse/keyboard selection、edge-drag、`queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`。Gate B 编译期间 App
Server 的 `lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警。本轮未
触及 Electron/App Server protocol/GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。总体计划保持 `in-progress`；下一刀继续评估同 turn transcript-only
reasoning 是否具备可证明的 presentation-only 吸收关系，否则转入下一个 Codex A3 history-cell
owner，不建立猜测式分组。

本轮 A3 transcript-only reasoning activity absorption current 切片（2026-09-24）：

- 对照 Codex `chatwidget/activity_groups.rs`、`history_cell/{activity_group,activity_details}.rs`、
  `thread_transcript.rs` 与 `computer_activity_keeps_reasoning_in_order_live_and_replayed` snapshot，
  Lime 在既有 canonical activity key 上为 reasoning 增加仅含 turn scope 的 presentation fact。
  live `item.started/item.completed`、reasoning delta、完整 Thread hydrate、turn completion repair 均
  直接使用 canonical turn id；不解析 reasoning/summary 文本，也不把该事实写入 App Server、
  ThreadStore、export 或第二套 history model。
- 只有前方已存在 exploration/computer group 且 reasoning scope 与 group turn scope 相同时才吸收；
  trailing reasoning 留在前组。reasoning 不参与 action 数、failure 数、active 状态或 compact
  preview 选择，compact 完全隐藏 reasoning；expanded 按 canonical 原序显示，并保持 Codex 的
  call 后空行、reasoning 间空行、最后一段 reasoning 后紧接下一 call 的布局。不同 turn、无 scope、
  可见非 reasoning item 或不同 activity kind 都立即结束 group，保持 fail-closed。
- 主 transcript、Ctrl+T pager、App 内 resume pager 与独立 resume picker 继续共享
  `app/history_ui.rs` composition。completion boundary 位于 trailing reasoning 后时仍只形成一个
  compact group，并在整个 group 后显示 separator；streamed reasoning 被 canonical completed item
  替换时保留相同 item identity、位置和 scope，disclosure identity 不漂移。
- 带 Turn 元数据的分页历史不再以首 item id 代替 scope：`HistoryItemGroup` 显式携带真实 turn id，
  completed/failed/interrupted/in-progress 相邻回合按 canonical identity 分组，同一 turn 跨页仍可用
  相同 key 拼接；无法映射 Turn 的 legacy flat page 与 `prepend_items` 保持无 scope，因此不会臆测
  reasoning 关系。该收口复用已有 `thread_turns_for_items` 数据，没有新增协议字段或兼容后端。
- 分类：同 turn transcript-only reasoning absorption、四 surface compact/expanded composition、
  live/replay/pagination scope 与 completion placement 均为 `current`；未新增 `compat`、`deprecated`
  或 `dead` surface。standalone transcript-only reasoning 在 Lime 默认 transcript 中仍可见；Codex
  默认 compact 会隐藏它、只在 detailed/search presentation 中展示，而 Lime 尚无完整全局
  detailed/raw mode owner，因此该项明确保留为 `partial/contract-defer`，不在本刀伪造全局模式。

验证：activity 定向回归 `27/27`、reasoning 定向回归 `11/11`、projection `54/54`；完整 TUI
library `1003/1003`、integration `18/18`、manager regression `1/1`；TUI
`--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、locked Cargo metadata、结构 inventory
`17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts`、`npm run verify:app-version` 与
`git diff --check` 全部通过。真实 `npm run smoke:tui-gate-b` 通过：thread
`01a0d2a3-2d41-78f2-bd52-3113ce6b1504`、turn
`turn_724805769bfb42ebbb448d097f9a5753`，事件链为
`turn.started,message.delta,item.started,item.completed,turn.completed`，并覆盖 disclosure、
transcript mouse/keyboard selection、edge-drag、`queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`。Gate B 编译期间 App
Server 的 `lower_turn_start_params`/`lower_runtime_options` dead-code warning 为既有告警。本轮未
触及 Electron/App Server protocol/Electron/GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。总体计划保持 `in-progress`；下一刀评估 standalone reasoning 的全局
detailed/search presentation owner，若 owner 边界尚不成立则继续下一个 Codex A3 history-cell 缺口。

本轮 A3 standalone transcript-only reasoning compact/detailed current 切片（2026-09-24）：

- 对照 Codex `ReasoningSummaryCell` 的 compact transcript 与 retained transcript 合同，Lime 主
  transcript 明确作为 compact surface：`app/history_ui.rs` 在 composition 边界隐藏所有 standalone
  `EntryKind::Reasoning`，而 Ctrl+T pager、Find 使用的 retained transcript、resume transcript 与
  canonical export 数据继续保留 reasoning。该 presentation 决策不进入 App Server、ThreadStore、
  export 或第二套 history model。
- compact composition 使用独立 body 缓冲后再追加 completion separator；reasoning-only transcript
  不再留下伪造空白行，但 completed turn 的 `Worked for 61s` 等 canonical completion boundary 仍然
  可见。带 canonical turn scope 的 standalone reasoning 与 legacy flat/no-scope reasoning 均不会泄漏
  到 compact 主面；后者仍按上一刀合同拒绝参与 activity absorption，只影响 presentation 隐藏。
- 新增回归分别锁定 scoped standalone reasoning、flat/no-scope reasoning 与 hidden reasoning 后的
  completion separator。真实 terminal fixture 的 complete 场景新增 canonical Reasoning item，事件链
  因此扩展为
  `turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed`；
  PTY 在 Ctrl+T 打开前断言当前 screen 不含 reasoning marker，打开 retained transcript 后断言该
  marker 可见，证明同一 canonical item 在 compact/detailed surface 的投影差异。
- 分类：主 compact transcript 隐藏 standalone reasoning、retained transcript/Find 数据源保留详情、
  flat/no-scope fail-closed 与 completion separator 保留均为 `current`；未新增 `compat`、
  `deprecated` 或 `dead` surface。Codex 完整 owned `TranscriptView`、全局 detailed/raw presentation
  mode 与 compact 主面的 activity disclosure 尚未完整同构，继续标为 `partial/contract-defer`。

验证：新增 history 回归后 `app::history_ui::tests` 为 `22/22`；完整 TUI library `1006/1006`、
integration `18/18`、manager regression `1/1`；TUI `--all-targets --no-deps` Clippy
`-D warnings`、workspace fmt、locked Cargo metadata、结构 inventory `17/17`、Gate B 源码守卫
`3/3`、`npm run governance:scripts`、`npm run verify:app-version` 与 `git diff --check` 全部通过。
complete-only 真实 Gate B 先证明 reasoning compact/detailed 投影；随后不裁剪场景的完整 Gate B 通过：
thread `01a0d2b7-0221-7d91-9b97-c54146b10441`、turn
`turn_571980295d5d4f21a836557345c4848f`，事件链为上述七事件，并覆盖 `queue-edit=ok`、
`agents-overview=ok`、`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、
`terminal=restored`。完整 Gate B 的默认预构建连续两次因 GitHub rusty-v8 release 返回 HTTP 500 未
进入产品场景；最终显式复用时间戳晚于本轮 TUI 源码的真实 `lime` 二进制与本轮未变更的真实
`app-server` 二进制，只跳过重复下载，没有裁剪场景或降低 PTY/App Server/runtime 证据等级。本轮未
改 App Server protocol、Electron 或 GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。总体计划继续保持 `in-progress`；下一刀审计 Codex owned
`TranscriptView` 与全局 detailed/raw presentation owner，或转入下一个 A3/A2 明确缺口。

本轮 A3 global raw scrollback presentation current 切片（2026-09-24）：

- 审计确认 Lime 已有 `HistoryRenderMode::{Rich, Raw}`、`HistoryCell::raw_lines` 与各 cell raw
  contract，但此前没有 App 状态、渲染 consumer 或产品入口。现由 `App` 持有唯一 session-local
  presentation mode；`/raw` 与全局 `Alt+R` 共用同一 toggle，即使 Ctrl+T pager 打开也只切换底层
  主 scrollback mode，不关闭或劫持 overlay。切换反馈覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、
  `ko-KR`，slash catalog、popup、settings parser exhaustiveness 与回归同步更新。
- 主 transcript 的 Rich 路径继续使用 grouped compact/disclosure；Raw 路径逐项消费 canonical
  `TranscriptEntry` 的 copy-friendly source，不做 Markdown/table/diff 富渲染，不携带样式或 OSC 8
  hyperlink，不重新分组，也不改 canonical projection。user source 仍经过 control-sequence sanitize，
  summary 按原始行追加；transcript-only reasoning 在 Raw 主面与 Rich compact 主面都隐藏。
  completion separator 继续保留并使用 cell raw contract；切换提示只复用既有 transient UI status，
  不改变 canonical Thread/Turn/Item。
- Ctrl+T retained transcript、Find、resume transcript 与 export 不消费 App raw mode，因此仍保留完整
  rich/detailed reasoning 和 activity disclosure；raw mode state 不进入 App Server、ThreadStore、
  runtime event、export 或第二套 history model。真实 PTY complete 场景新增 Markdown source marker：
  Rich 主面看不到字面 `**...**`，发送真实 `Esc+r` 后 Raw 主面看到 canonical source，同时 reasoning
  仍不可见；随后 Ctrl+T 继续看到 retained reasoning，证明 Rich/Raw 与 compact/detailed 是正交的
  presentation 维度。
- 分类：App session-local raw mode、`/raw`、全局 `Alt+R`、canonical raw source、五语言反馈及
  Rich/Raw 与 retained detail 边界均为 `current`；未新增 `compat`、`deprecated` 或 `dead`
  surface。Codex 可配置 keymap、local-settings 持久化、owned `TranscriptView` 的 compact/detailed
  双 position/bookmark 与所有 specialized cell 的完整 raw 文本形状仍为 `partial/contract-defer`；
  在 Lime 出现对应配置 owner 前不把 presentation 偏好写入 App Server 或项目配置。
- 文件尺寸退出条件：`app/history_ui.rs` 现为 `1295` 行且大部分为 inline 回归，`locale.rs` 为既有
  `3290` 行单一 i18n owner。本切片只在现有事实源接线；再次扩展 history composition 前先把
  `history_ui` 测试迁到专用测试模块，再添加新的业务分支。i18n 继续只允许在 `Locale` owner
  补产品文案，不新增第二套 locale catalog；后续若新增成组 presentation 文案，先拆 locale
  domain impl/test 模块并保持 `Locale` 为唯一 catalog。

验证：raw 定向回归 `17/17`；完整 TUI library `1010/1010`、integration `18/18`、manager
regression `1/1`；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、locked Cargo
metadata、结构 inventory `17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts`、
`npm run verify:app-version` 与 `git diff --check` 全部通过。真实 CLI 通过 `cargo build --locked -p
cli` 重建。complete-only Gate B 首次在提交前命中既有 external-editor composer cursor 时序抖动，
原样复跑通过：thread `01a0d2c9-3d56-7fa1-a2ba-5044bb563407`、turn
`turn_6218a351df1f4beb97ada2746230996d`。随后不裁剪场景的完整 Gate B 通过：thread
`01a0d2c9-9cc7-7fa3-bd38-9e3b68d02e55`、turn
`turn_ddbe2112aafb44cd9866ceb77dce6419`，事件链为
`turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed`，
并覆盖 raw source、retained reasoning、activity disclosure、selection/edge-drag、
`queue-edit=ok`、`agents-overview=ok`、`focus-palette=ok`、`resize-reflow=ok`、
`reconnect=ok`、`terminal=restored`。本轮仍未改 App Server protocol、Electron 或 GUI bridge，
因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。总体计划保持 `in-progress`；
下一刀先执行上述 history composition 文件拆分退出条件，再继续 Codex owned `TranscriptView` 的
双 presentation position/bookmark，或推进下一个 A3/A2 明确缺口。

本轮 A2/A3 transcript compact/detailed 双阅读位置 current 切片（2026-09-24）：

- 已兑现上一刀的文件尺寸退出条件：`app/history_ui.rs` 的 inline tests 原样迁入
  `app/history_ui_tests.rs`，业务 owner 收缩到 `353` 行，专用测试模块为 `934` 行；拆分后
  `app::history_ui::tests` `23/23` 与后续 TUI 全量均通过，没有在超千行业务文件继续堆叠。
- 对照 Codex `transcript_view.rs::set_presentation`、`transcript_view/bookmark.rs` 与
  `search_preserves_both_presentation_positions`，新增短领域 owner
  `app/transcript_presentation.rs`。compact 位置继续由 `App::transcript_scroll` 唯一持有；Ctrl+T
  detailed pager 关闭后由同一 App session-local owner 保留 scroll/anchor、pinned 状态、reflow
  cache 与 activity disclosure 展开状态，重开不再强制跳回最新。presentation state 不进入
  App Server、ThreadStore、canonical projection、runtime event 或 export。
- detailed 关闭边界统一清除 search/query/matches、mouse/keyboard selection、drag、activity focus、
  copy feedback 与 history-load 短生命周期状态；展开 identity 与阅读位置保留。用户 Ctrl+T
  关闭、App Server disconnect、当前 thread reverse request 和 buffered request replay 共用同一
  dismiss owner，不再由分散的 `pager_overlay = None` 丢失 bookmark。同 thread reconnect 可恢复；
  `set_thread_id` 在 identity 变化时同时清 active/retained detailed state，禁止跨 thread 泄漏。
- 新增四组稳定回归，锁定 detailed close/reopen、compact/detailed 独立位置、search/selection 不
  复活、disclosure 展开保留但 focus 清除、thread switch 清 bookmark。真实 complete PTY 在
  edge-drag 后 Home 到 `TUI_EDGE_ROW_00`，关闭再 Ctrl+T 重开并再次观察同一 marker；Gate B
  source guard 同步锁定该交互，不以 reducer 或 TestBackend 冒充终端证据。
- 分类：App session-local compact/detailed reading position、detailed bookmark、统一 dismiss/reset
  lifecycle 与 PTY reopen 证据均为 `current`；未新增 `compat`、`deprecated` 或 `dead` surface。
  Codex 基于 retained cell identity/source offset 的完整 owned `TranscriptView` bookmark、搜索期间的
  双 presentation position 交换、可配置 keymap 与 local-settings 持久化仍为
  `partial/contract-defer`；Lime 当前 pager 以 logical-line/reflow anchor 保证现有 canonical
  projection 下的等价阅读位置，不伪造 Codex retained-cell store。

验证：transcript presentation 定向回归 `4/4`；完整 TUI library `1014/1014`、integration
`18/18`、manager regression `1/1`；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace
fmt、locked Cargo metadata、结构 inventory 与 Gate B guard `20/20`、`npm run governance:scripts`、
`npm run verify:app-version`、`git diff --check` 和 `cargo build --locked -p cli` 通过。真实
complete Gate B 通过：thread `01a0d2d9-87c0-7611-9824-4aa09aa6abcf`、turn
`turn_72882847eb48404e905fd52dcec6d24b`，事件链为
`turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed`，
并证明 detailed bookmark 重开与 terminal restore；证据目录
`tui-gate-b-bR3zxI` 保留。其余 approval/user-input/interrupt/failure/queue-edit/agents-overview
矩阵随后通过，代表 thread/turn 为 `01a0d2d9-fb7a-7020-a84d-d8cae18637a2` /
`turn_132bbea7aa5b4b0f9d00b40be306a211`，并覆盖 `queue-edit=ok`、`agents-overview=ok`、
`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok`、`terminal=restored`；证据目录
`tui-gate-b-z5n3t2` 保留。本轮未改 App Server protocol、Electron 或 GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。总体计划继续保持 `in-progress`；下一刀
回到 Codex owned transcript/history 对照，选择仍有真实产品影响且能由 Lime canonical 数据证明的
A2/A3 缺口，不把本切片提升为 TUI 总体完成。

本轮 A2/A3 transcript follow control / unseen activity current 切片（2026-09-24）：

- 对照 Codex `transcript_view/follow_control.rs`，新增 `transcript_view/follow_control.rs` 单一展示
  owner。`TranscriptViewport` 只持有 session-local 的 `tail_visible`、`unseen_activity` 与
  `suppress_next_activity`：用户暂停阅读时，canonical append 或尾部 revision 会显示
  `New activity`；older-history prepend 不误报；回到底部或 viewport 扩大至尾部可见时清除提示。
  Rich/Raw 切换只触发 presentation 重绘，并通过一次性 suppression 避免伪报新活动。
- follow control 占用 composer 顶部 gap，并按可用宽度选择完整或短标签；支持 hover、同一 hit target
  内按下/释放、拖出取消，并在隐藏时释放 hit target。主 transcript 已上滚时，`Escape` 优先回到底部，
  再考虑 interrupt 当前 turn；BottomPane、command/file/skill popup、model picker、Agents Overview 与
  agent picker 活跃时隐藏 control，避免覆盖现有交互 owner。thread identity 变化或 hydrate 会清理
  control，不把旧 thread 的展示状态带入新投影。
- 用户可见标签和 unseen 文案覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`；英文稳定形状为
  `↓ Back to bottom · esc` 与 `New activity · ↓ Back to bottom · esc`。新增定向回归覆盖 unseen
  生命周期、older-history、revision、reflow/tail visibility、窄终端、hover/click/drag-cancel、popup
  隐藏与 Escape 路由。
- 真实 PTY 暴露 external editor 恢复后输入流竞争：删除 Lime `runtime.rs` 中不属于 Codex owner 的
  `pending_tui_event` 和 `with_restored()` 后 eager `poll_crossterm_event`。恢复后统一由 async event
  loop 重建并轮询输入源，避免旧 crossterm reader 退出与新同步 poll 竞争、把 transient EOF 当成
  主输入流终止。Gate B composer 鼠标回归改为从可见 prompt 定位确定性行列、等待 prompt 末尾光标，
  用 Left/Right 事件确认输入循环恢复，再分别发送 SGR mouse down/up；不使用固定 sleep。源码守卫
  明确禁止 `poll_crossterm_event` 回流。
- 分类：follow/unseen、control hit target、Rich/Raw suppression 与 external-editor 输入恢复均为
  `current`；未新增 `compat`、`deprecated` 或 `dead` surface。follow/unseen 只属于 TUI local
  presentation，不进入 App Server、ThreadStore、canonical projection、runtime event 或持久化。
  Codex owned TranscriptView 的其余 bookmark/search/keymap 细节及 A2/A3 其他缺口继续为
  `partial/contract-defer`，不为本地 control 扩展协议事实。

验证：follow control 定向回归 `2/2`、transcript reflow 定向回归 `9/9`、locale/view follow 集成
`3/3`；完整 TUI library `1022/1022`、integration `18/18`、manager regression `1/1`、event stream
定向 `10/10`；TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、locked Cargo
metadata、结构 inventory `17/17`、Gate B 源码守卫 `3/3`、`npm run governance:scripts` 与
`npm run verify:app-version` 全部通过。CLI 与 App Server 使用仓库 `resolveRustyV8CargoEnv` 成功重建；
直接 Cargo 构建曾因上游 Deno `rusty_v8` URL 返回 404 失败，不属于产品路径失败。完整真实 TUI
Gate B 矩阵通过：thread `01a0d2f8-0267-7be1-8a77-bb8b41b3c091`、turn
`turn_0f5e9038c6bc4b0b8bc747a23d66a15c`，覆盖 complete、approval、user-input、interrupt、failure、
queue-edit、agents-overview、focus-palette、resize-reflow、reconnect 与 terminal restore；证据目录
`tui-gate-b-bt5T2X` 保留。本轮未触及 App Server protocol、Electron 或 GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。该切片已达到 TUI reducer/render/composer 与
真实 PTY 的风险匹配门槛，但总体计划仍为 `in-progress`：顶层 checklist 保持 `21/50（42%）`，
下一刀继续选择可由 canonical 数据证明的 A2/A3 缺口，不把 follow control 收口提升为 TUI 总体完成。

本轮 A2/A3 main transcript selection / composer gap current 切片（2026-09-24）：

- 对照 Codex `transcript_view/{selection,input,composer_gap}.rs`，主 compact transcript 现在直接复用
  Lime 唯一 `TranscriptSelection` owner，不再只有 Ctrl+T detailed pager 和 resume pager 可选择。
  主面支持 SGR 鼠标单/双/三击与拖选、右键复制、`Ctrl+Space` 键盘选择、grapheme-aware 方向键、
  PageUp/PageDown、edge-drag、stationary hyperlink release 和 modifier link open；事件优先级位于
  composer copy/edit 之前，但 popup、BottomPane、picker 等更具体 surface 仍先消费输入。
- 选择开始时冻结当帧 `HyperlinkLine` source 与 visual scroll；canonical projection 继续实时更新。
  `TranscriptViewport::resolve_frozen_anchor` 独立跟踪 canonical logical row，使 tail append/revision
  产生 unseen activity、older-history prepend 不误报，并在宽度 reflow 后保持恢复锚点。选择期间
  只绘制 frozen source；结束后按最新 canonical max scroll 恢复同一阅读位置，不把 source snapshot
  写入 history store。鼠标 wheel 走新的精确三行 runtime action，并在向上时继续触发现有真实
  App Server history page 请求，不建立本地历史 fallback。
- clipboard 结果保持 truth-aware：只有 `CopyStatus::Confirmed` 清除选择；普通 copy 保留阅读位置，
  Enter copy-and-follow 回到最新；terminal `Unconfirmed` 与失败都保留选择。新增 Codex-shaped
  `transcript_view/composer_gap.rs`，在 composer 顶部 gap 右对齐显示确认/未确认/失败反馈，复用
  `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR` 既有 copy 文案；反馈显示期间释放 follow-control
  hit target，并由现有 `FrameRequester` 在五秒 expiry 触发恢复，不使用 sleep 或 projection status
  作为计时事实源。
- thread identity 变化、hydrate 会 reset 主选择与 copy feedback；Rich/Raw 切换和打开 detailed
  transcript 会先结束选择并保留 compact 阅读位置。selection、frozen source、resume distance、
  feedback deadline 与 follow-control target 全部属于 TUI session-local presentation，不进入 App
  Server、ThreadStore、canonical Thread/Turn/Item、runtime event、export 或持久化。
- 分类：主 transcript mouse/keyboard selection、frozen/canonical 双锚点、truth-aware copy、composer
  gap feedback、wheel history paging 和真实 PTY interaction 均为 `current`；未新增 `compat`、
  `deprecated` 或 `dead` surface。Codex retained-cell/source-offset 完整 `TranscriptView`、sticky
  prompt header、main Find/footer/keymap 与 local-settings persistence 仍为 `partial/contract-defer`，
  下一刀继续从这些可证产品缺口中选择，不以本次选择接线宣称 owned TranscriptView 已完整同构。

验证：`transcript_view` owner 回归 `28/28`、main transcript 定向 `5/5`；完整 TUI library
`1028/1028`、integration `18/18`、manager regression `1/1`；TUI `--all-targets --no-deps`
Clippy `-D warnings`、workspace fmt、locked Cargo metadata、结构 inventory `17/17`、Gate B 源码守卫
`3/3`、`npm run governance:scripts` 与 `npm run verify:app-version` 全部通过。结构 inventory 已按
当前 Codex commit `5c07856e25b565c86c6266ff51edff58299fd4e6` 刷新为 `1191` files；CLI 与 App
Server 使用仓库 `resolveRustyV8CargoEnv` 成功重建，编译仅有 App Server 既有
`lower_turn_start_params`/`lower_runtime_options` dead-code warning。complete-only TUI Gate B
先通过：thread `01a0d30f-10f7-77f1-8eea-50ab1ef7d739`、turn
`turn_46c582a696a542aba5c59ff6f7c8dc97`，证据目录 `tui-gate-b-PCwAkb` 保留。当前源码对应的
完整矩阵随后通过：thread `01a0d312-9420-70c0-821c-98f14f272902`、turn
`turn_289f9ac04ee94dc49031f2a20efe3fdb`，覆盖主 compact transcript SGR 选择、complete、approval、
user-input、interrupt、failure、queue-edit、agents-overview、focus-palette、resize-reflow、reconnect
与 `terminal=restored`；证据目录 `tui-gate-b-ecTfBp` 保留。本轮未触及 App Server protocol、
Electron 或 GUI bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。该切片
达到 Rust TUI reducer/render/composer 与真实 TUI Gate B 风险门槛；总体计划仍为 `in-progress`，
顶层 checklist 保持 `21/50（42%）`，不能据此标记“完整对齐 TUI”完成。

本轮 A2/A3 sticky prompt header current 切片（2026-09-24）：

- 对照 Codex `transcript_view/{prompt_header,prompt_header_tests}.rs`，新增
  `transcript_view/prompt_header.rs` 唯一 presentation owner。主 compact transcript composition
  现在同时返回原始 `HyperlinkLine` 与 canonical entry logical-line ranges；metadata 直接来自
  `TranscriptEntry.kind/id/text/summary`，不从 `› ` 等渲染前缀反推 User prompt，也不建立第二套
  history/transcript model。header 只绘制在保留的顶部一行，不进入 selection source、copy、search、
  export、ThreadStore 或 App Server projection。
- sticky prompt 在宽度 `<16`、当前首个可见 cell 本身是可见 User prompt、没有前序可见 prompt 或
  transcript 高度 `<4` 时隐藏；否则选择前方最近的 canonical User prompt。读取最多 512 chars，复用
  `sanitize_user_text` 清 terminal controls、折叠 whitespace，并按 display width 省略。附件-only
  fallback 在 `en-US` 保持 Codex `[attachments]`，同时覆盖 `zh-CN`、`zh-TW`、`ja-JP`、`ko-KR`。
  样式由 `history_prompt_style()` 统一承接。
- header reservation 使用未提交的 viewport preview 做两阶段布局，最终只向
  `TranscriptViewport` commit 一次；当保留 header 后下一 turn 的 User prompt 恰好进入 viewport，
  suppression 以 outer viewport、canonical entry key 和 entry 内 wrapped row 为键固定该边界，直到
  scroll 或 resize。selection 活跃时复用与 frozen `HyperlinkLine` 配对的 prompt metadata，hit-test
  area 从 header 下方开始；普通 copy 结束后继续保持阅读位置和 header reservation。
- older page 在稳定 session header 之后插入时，`TranscriptViewport` 现在识别“公共前缀 + 全部旧后缀”
  的纯插入并重映射逻辑行；仅当插入点位于当前阅读锚点之前时抑制 unseen activity。真实 tail
  append/revision 仍产生 `New activity`，避免用宽泛的内容相等判断吞掉新输出。
- 分类：sticky prompt、canonical entry range mapping、turn-boundary suppression、selection header
  reservation 与 stable-prefix history prepend remap 均为 `current`；未新增 `compat`、`deprecated`
  或 `dead` surface。架构仍是 `CLI/TUI Host -> App Server JSON-RPC -> RuntimeCore -> canonical
Thread/Turn/Item -> terminal projection`，未改变 public boundary，因此不更新架构图。
- 聚合文件退出约束：`view.rs` 已超过 1000 行；本切片把 header 决策放在独立
  `transcript_view/prompt_header.rs`，`view.rs` 只保留 composition/viewport wiring。下次继续扩展
  `view.rs` 测试前，先把其 `#[cfg(test)]` 大模块迁至独立测试文件；禁止继续向生产 render 聚合新的
  transcript 状态机。

验证：prompt-header/主视图定向回归 `8/8`、viewport 定向 `7/7`；related Rust unit 为 CLI
`8/8`、TUI library `1037/1037`，integration `18/18`、manager regression `1/1`；TUI
`--all-targets --no-deps` Clippy `-D warnings` 通过。Gate B 源码守卫 `3/3` 通过，完整真实 TUI
Gate B 通过：thread `01a0d32f-f113-7473-b72a-e6a61fdd8ceb`、turn
`turn_8f54439f06d9449c969f41d89aaf44b3`，覆盖 sticky prompt 顶行、主 transcript SGR selection、
complete、approval、user-input、interrupt、failure、queue-edit、agents-overview、focus-palette、
resize-reflow、reconnect 与 `terminal=restored`；证据目录 `tui-gate-b-zI56wF` 保留。结构 inventory
按 Codex `5c07856e25b565c86c6266ff51edff58299fd4e6` 刷新为 `1193` files：Codex TUI src
`997 files / 14991 symbols`，Lime TUI src `196 files / 3538 symbols`，missing 降至
`835 files / 11684 symbols`。本轮未触及 App Server protocol、Electron 或 GUI bridge，因此不运行
`npm run test:contracts` 或 `npm run verify:gui-smoke`。该切片达到 Rust TUI
reducer/render/composer 与真实 TUI Gate B 风险门槛；总体计划仍为 `in-progress`，顶层 checklist
保持 `21/50（42%）`，remaining blocker 仍是 retained-cell `TranscriptView` 其余
bookmark/search/keymap、A2/A3 owner、CLI partial 与 Cloud transport，不把 prompt header 收口提升为
“完整对齐 TUI”完成。

本轮 A2/A3 main transcript Find / footer current 切片（2026-09-24）：

- 对照 Codex `transcript_view/{search,footer}.rs`，新增 Lime 唯一共享 owner
  `transcript_view/search.rs` 与 `transcript_view/footer.rs`。主 compact transcript 当前以 `F3` 打开
  Find；detailed pager 支持 `F3` 与 `/`，`Ctrl+F` 恢复为向下翻页；原先 pager 内联的
  query/match/navigation 状态已
  迁出，不再维护第二套搜索实现。query 上限为 `4096 bytes`，每个扫描窗口至多 `16 KiB`，每帧推进
  至多 `8` 条 logical lines；Unicode 大小写不敏感 literal matching 保留源 UTF-8 byte offset。
- Enter / `Ctrl+N` 定位更新命中，Shift+Enter / `Ctrl+P` 定位更旧命中；Esc / `Ctrl+C` 关闭。
  搜索当前加载 projection 耗尽时只发出既有 `LoadOlderHistory`，继续经过 App Server history pager；
  failed page 可由后续导航重试，没有本地 loader、store 或 synthetic history fallback。main Find 打开
  前保存 compact `transcript_scroll`，关闭后恢复；source prepend、revision 与 resize 会重启 bounded
  scan，并按匹配文本和 source offset 尽量保留当前命中。
- selection 活跃时暂停增量搜索，selection 高亮优先于 Find 高亮；搜索高亮按原 Span/grapheme
  拆分，保留既有样式和 OSC 8 hyperlink geometry。query footer 占用 composer gap，普通 footer
  展示 match/loading/failure/selection hint；文案覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`。
  `view.rs` 只保留 source/viewport/footer 组合接线，search 状态机和专用测试均位于短领域 owner，
  未继续向超千行 render 文件堆叠业务逻辑。
- 真实 PTY complete 场景在 canonical `turn.completed` 后发送 F3，输入
  `TUI_GATE_B_COMPLETED`，断言 `Find: TUI_GATE_B_COMPLETED`、主 transcript 匹配区域 inverse
  highlight、sticky prompt 仍固定第 0 行，并在 Esc 后确认高亮清除。该证据经过真实 `lime`、PTY、
  alternate screen、键盘输入、App Server JSON-RPC、RuntimeCore/read model 与终端恢复，不以
  TestBackend 或 source-string guard 冒充 TUI Gate B。
- 分类：bounded shared search、main Find、pager 委托、history pager 联动、阅读位置恢复、selection
  priority 与 footer 均为 `current`；未新增 `compat`、`deprecated` 或 `dead` surface。状态只属于 TUI
  session-local presentation，不进入 App Server protocol、ThreadStore、canonical Thread/Turn/Item、
  export 或持久化。Codex retained-cell/source-offset 的完整 `TranscriptView` bookmark、可配置 keymap
  与 local-settings persistence，以及其余 A2/A3 owner 仍为 `partial/contract-defer`。

验证：shared search owner `7/7`、pager search `6/6`、main Find TestBackend `2/2`、footer `2/2`、
pager overlay `26/26`；最终完整 TUI library `1048/1048`、integration `18/18`、manager regression
`1/1`，related Rust 依赖扩展后 CLI `8/8` + TUI `1048/1048`。TUI `--all-targets --no-deps`
Clippy `-D warnings`、workspace fmt、locked Cargo metadata、Gate B 源码守卫 `3/3`、
`npm run governance:scripts` 与 `git diff --check` 通过。结构 inventory 按 Codex
`5c07856e25b565c86c6266ff51edff58299fd4e6` 刷新为 `1197` files：Codex TUI src
`997 files / 14991 symbols`，Lime TUI src `200 files / 3603 symbols`，missing 为
`831 files / 11675 symbols`。

保留的 complete-only Gate B 通过：thread `01a0d381-d82c-7242-95e0-b837533cfdfb`、turn
`turn_5155a21ceb0b407dae7b0ba97a70c365`，证据目录 `tui-gate-b-8TEPgr`。保留证据的完整矩阵首次
在既有 `resize-reflow` 用例命中 5 秒退出超时，失败目录 `tui-gate-b-0upaET` 保留；同一入口复跑
通过：thread `01a0d383-26a0-7a02-8cfb-8e38e6d939c3`、turn
`turn_a312ba6761bb4be8bf4b225f049bc8b7`，并覆盖 `queue-edit=ok`、`agents-overview=ok`、
`sticky-prompt=ok`、`main-find=ok`、`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok` 与
`terminal=restored`；证据目录 `tui-gate-b-OFAtku` 保留。编译仅出现 App Server 既有
`lower_turn_start_params` / `lower_runtime_options` dead-code warning。本轮未改 App Server protocol、
Electron 或 GUI bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。
该切片达到 Rust TUI reducer/render/composer 与真实 TUI Gate B 风险门槛；总体计划仍为
`in-progress`，顶层 checklist 保持 `21/50（42%）`。下一刀审计 Codex owned TranscriptView 的
keymap/local-settings persistence 与 retained-cell bookmark 边界，或继续下一个可由 Lime canonical
数据证明的 A2/A3 缺口；不得把 Find/footer 收口提升为“完整对齐 TUI”完成。

本轮 A2/A3 transcript 默认 keymap 纠偏切片（2026-09-24）：

- 重新对照当前 Codex commit `5c07856e25b565c86c6266ff51edff58299fd4e6` 的
  `tui/src/keymap.rs`、`keymap/global_find_tests.rs` 与 `app/owned_transcript.rs`，确认上个切片采用的
  `Ctrl+F` Find 默认值已偏离当前 Codex：global `find_transcript` 应为 `F3`，pager `find` 应为
  `F3`/`/`，pager `page_down` 应为 `PgDn`/`Space`/`Ctrl+F`。本切片直接替换错误默认值，不保留
  `Ctrl+F -> Find` compat 双轨。
- `tui/src/keymap.rs` 新增短领域 `TranscriptKeymap` owner。`open_transcript`、`find_transcript`、
  pager `find/page_down/close/close_transcript` 的匹配与显示标签都从同一组 binding slices 生成；
  `app/input_flow.rs`、`app/interaction.rs` 与 `pager_overlay.rs` 不再各自比较固定键。C0 控制字符归一
  仍覆盖真实 PTY 发送的 Ctrl chords，不建立第二套输入 registry。
- 主 compact transcript 只由 `F3` 打开 Find；`Ctrl+F` 继续交给 composer editor。在 detailed
  transcript 中，`F3` 与 `/` 打开 Find，`Ctrl+F`、Space 和 PgDn 均向下翻一页。BottomPane、
  resume/agents/model pickers 与 composer popup 仍按既有优先级先消费事件，Find 不抢更具体 context。
- detailed transcript 的普通 footer 与 activity footer 都从 `TranscriptKeymap` 读取
  `PgDn·Space·Ctrl+F`、`F3·/`、`Ctrl+T·Esc·Q` 标签；五语言只负责动作文案格式化。该变更保持
  单行、低装饰、信息优先的 terminal footer，不引入新颜色、层级或额外面板。
- 真实 PTY complete 场景改为发送 xterm F3 序列 `ESC O R`；源码守卫禁止继续寻找 Ctrl-F Find。
  第一次复测由 activity footer 仍显示旧的硬编码 close 标签暴露同源遗漏，失败证据目录
  `tui-gate-b-ySMydY` 保留；补齐 activity footer 后 complete-only 与完整矩阵均通过。
- 分类：上述默认 bindings、dispatcher、pager 翻页语义、五语言 hint 与 PTY F3 evidence 均为
  `current`；未新增 `compat` 或 `deprecated`。旧 `Ctrl+F -> Find` 为 `dead / deleted /
forbidden-to-restore`，只允许出现在本计划历史说明或负向回归中。持久化 `tui.keymap`、两段 chord、
  explicit unbind、冲突校验、runtime snapshot 与 `local_settings` 仍为 `partial/contract-defer`；后续若
  实现必须完整同步 core config schema、App Server `config/read`、TUI startup consumer、文档与合同，
  不得使用环境变量或 TUI 私有配置文件建立第二套事实源。

验证：keymap/default-hint 定向 `1/1`、main Find `3/3`、transcript pager `7/7`；完整 TUI library
`1052/1052`、integration `18/18`、manager regression `1/1`，related Rust 依赖扩展后 CLI `8/8` +
TUI `1052/1052`。TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt、locked Cargo
metadata、结构/snapshot/Gate 守卫 `22/22`、`npm run governance:scripts` 与 `git diff --check` 通过。
带依赖的 `cargo clippy -p tui --all-targets -- -D warnings` 被既有 `agent-protocol` 的
`large_enum_variant` 与 `derivable_impls` 两条 lint 阻断；本切片未修改该 crate，TUI 自身 Clippy
全绿。结构 inventory 刷新为 `1197` files：Codex TUI src `997 files / 14991 symbols`，Lime TUI src
`200 files / 3623 symbols`，missing 为 `831 files / 11672 symbols`。

保留的 complete-only Gate B 通过：thread `01a0d39e-820f-7a51-8085-029862909b37`、turn
`turn_5e92839be5044630b0a018f5a7774253`，证据目录 `tui-gate-b-oK7ZgA`。当前源码的完整矩阵通过：
thread `01a0d3a1-99fb-7d52-8727-fd7db689c42c`、turn
`turn_4320bfa14b85426780b3448d8bd9d815`，覆盖 complete、approval、user-input、interrupt、failure、
queue-edit、agents-overview、真实 F3 `main-find=ok`、focus-palette、resize-reflow、reconnect 与
`terminal=restored`；证据目录 `tui-gate-b-vlmCRz` 保留。编译仅出现 App Server 既有
`lower_turn_start_params` / `lower_runtime_options` dead-code warning。本轮未改 App Server protocol、
配置 schema、Electron 或 GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。该切片达到 Rust TUI interaction 与真实 TUI Gate B 风险门槛；总体计划
仍为 `in-progress`，顶层 checklist 保持 `21/50（42%）`。下一刀优先完整接入 Codex-shaped
`tui.keymap` runtime snapshot/local-settings 边界，或选择 retained-cell bookmark；不得把默认键纠偏
提升为“完整对齐 TUI”完成。

本轮 A2/A3 Codex-shaped `tui.keymap` 持久化切片（2026-09-27）：

- `lime_core config.yaml` 成为唯一配置 owner，新增 `tui.keymap` 的 strict schema，只公开已有真实
  consumer 的 `global`、`pager` 与 `agents` context。每个 action 支持单键、最多两段 chord、有序
  alternatives 和空数组 explicit unbind；未知字段、非法键名和超过两段 chord 在 core 解析时
  fail closed。同 context 重复键、single/chord prefix 冲突以及会截获普通文本的 printable chord
  prefix 在 TUI runtime snapshot 构建时 fail closed。
- TUI 主入口与独立 resume picker 均在进入 alternate screen 前经现有 App Server `config/read` 读取
  `LocalSettings`，再生成一次不可变 `RuntimeKeymap`；没有 TUI 私有配置文件、环境变量配置面、第二套
  transport 或 production mock fallback。dispatch 与 detailed pager footer hint 消费同一 snapshot；
  Agents refresh 保留启动期自定义 keymap，不回退默认绑定。
- global、pager 与 Agents 各自持有独立 chord matcher。Paste、Mouse、FocusLost、Resize、Draw 等
  非键盘边界会清除 pending chord，避免前缀跨焦点或粘贴泄漏到下一键；对应回归覆盖三个 surface。
  尚未接线的 composer/editor/Vim keymap 不提前暴露，继续为 `partial/defer`。
- 真实 PTY Gate B 的测试 YAML 配置 `global.find_transcript: ctrl-x f`，complete 场景实际发送
  `Ctrl+X`、`f` 打开 main Find，证明
  `config.yaml -> config/read -> LocalSettings -> chord matcher -> main Find`。remote reconnect fixture
  同步实现 public `config/read`，并锁定启动只读取一次、重连复用原不可变 snapshot；缺失 response
  时 TUI 保持 fail closed，不增加默认 fallback。
- `internal/aiprompts/commands.md`、`docs/ops.md` 与 `packages/cli/README.md` 已同步唯一 owner、支持的
  context/action、单键/chord/alternatives/unbind 和启动期 snapshot 合同。结构 inventory 加入
  `keymap/tests.rs`、`local_settings.rs` 并刷新到 Codex commit
  `5c07856e25b565c86c6266ff51edff58299fd4e6`：总计 `1199` files，Lime TUI 为
  `202 files / 3665 symbols`，missing 为 `830 files / 11661 symbols`。

验证：core keymap schema `3/3`、RuntimeKeymap `6/6`、LocalSettings `2/2`、新增非键盘 chord
边界 `3/3`、最终 TUI library `1060/1060`、App Server public `config_jsonrpc` `1/1`、TUI
`--all-targets --no-deps` Clippy `-D warnings`、Gate B 源码守卫 `3/3`、结构 inventory 守卫
`17/17`、`npm run test:contracts`（含 scripts governance）与 `git diff --check` 通过。
complete-only Gate B 通过：thread `01a0e15a-5e03-77c1-b315-10c902969f6b`、turn
`turn_417dc5daa2504539b3799c8b8809c73a`，证据目录 `tui-gate-b-DI4tod`；完整矩阵通过：thread
`01a0e15a-ef7e-7b23-8014-fef97b214f24`、turn `turn_fb2d349cd8014e0db874d7d40dc2db7d`，
覆盖 complete、approval、user-input、interrupt、failure、queue-edit、agents-overview、
`sticky-prompt=ok`、自定义 chord `main-find=ok`、focus-palette、resize-reflow、reconnect 与
`terminal=restored`，证据目录 `tui-gate-b-3DKDE0`。App Server 仅出现既有
`lower_turn_start_params` / `lower_runtime_options` dead-code warning。相关 Vitest smart runner 首次
命中既有 `EISDIR .../electron` 与退出超时，直接 target 已通过，不记为源码失败。

取得明确确认后已执行 `cargo fmt --manifest-path "lime-rs/Cargo.toml" --all`；workspace fmt check、
TUI `--all-targets --no-deps` Clippy `-D warnings`、结构/snapshot inventory `19/19` 与
`git diff --check` 均通过，格式变化后的 structure inventory 已重新生成且总量仍为 `1199` files。
`npm run verify:local` 的 smart changed-scope 连续两次在同一既有 MCP 并发用例
`bridge_client::tests::concurrent_callers_receive_only_their_request_progress` 停滞超过 60 秒，均人工中止；
该用例通过仓库 `resolveRustyV8CargoEnv` 入口隔离复跑为 `1/1`、`0.05s`，说明当前 remaining blocker
是宽范围同进程并发门禁挂起，而不是稳定的 TUI/keymap 逻辑失败。裸 Cargo 隔离复跑还会命中已知
`rusty_v8 v150.4.0` GitHub archive 404，因此只采用仓库统一 Rust 测试入口作为有效证据。

分类：上述配置 schema、App Server 读取、TUI snapshot/dispatch/hint、chord boundary、文档和 PTY
evidence 均为 `current`；未新增 `compat`、`deprecated` 或 `dead-candidate`。完整
composer/editor/Vim keymap、retained-cell bookmark、A2/A3 其余 owner、CLI partial 与 Cloud transport
继续为 `partial/defer`。总体计划仍为 `in-progress`，顶层 checklist 保持 `21/50（42%）`，不得提升为
“完整对齐 TUI”完成。

本轮 A2 Codex-shaped stable transcript bookmark 切片（2026-09-27）：

- 对照 Codex `transcript_view/bookmark.rs` 的 retained reading position 语义，新增
  `transcript_view/{bookmark,bookmark_tests}.rs` 短领域 owner。`TranscriptBookmark` 记录 canonical
  source key、source 内逻辑行偏移和 wrapped-row 偏移；`TranscriptFrame` 保存本次 materialized
  transcript 的行、稳定 anchor ranges 与宽度。它只属于 App session-local presentation，不进入 App
  Server、ThreadStore、canonical Thread/Turn/Item、export 或持久化。
- `app/history_ui.rs` 为 session header、group separator、canonical entry、activity group 和 completion
  separator 生成稳定 key；`TranscriptContent` / `MaterializedTranscript` 只把这些 identity 投影为
  `TranscriptAnchorRange`，没有建立第二套 transcript store。`PagerOverlay` 先按 stable source 恢复，只有
  source 不存在时才回退既有 prefix/suffix logical-line remap；因此 older-history prepend、canonical
  group/entry replacement、内容收缩 clamp 与终端宽度 reflow 后仍保留相同阅读位置。
- `TranscriptPresentation` 仍是 detailed pager 唯一 session-local owner：关闭时显式捕获 bookmark，重开
  后在下一次真实 materialization 恢复；following bookmark 继续定位最新输出。search、selection 与
  disclosure 沿用既有 owner：关闭仍清 search/selection/focus，disclosure expansion 仍按 canonical
  identity 保留，bookmark 不复制这些状态。thread identity 变化继续清理 retained presentation，禁止
  bookmark 跨 thread 泄漏。
- 真实 PTY complete 场景在长 canonical transcript 中到达稳定 source 顶部，关闭 detailed transcript
  后用 `Ctrl+T` 重开并再次等待 `TUI_EDGE_ROW_00`；该条件是测试内硬断言，同时覆盖真实 `lime`、PTY、
  alternate screen、键盘输入、stdio App Server JSON-RPC、RuntimeCore/read model 与终端模式恢复。
- 分类：stable source anchor、pagination/replacement/reflow remap、close/reopen restore、following-to-tail
  和 canonical key projection 均为 `current`；未新增 `compat` 或 `deprecated`。仅供测试调用且已无生产
  consumer 的 `TranscriptContent::push_line` 为 `dead / deleted`，测试统一使用现有 `push_lines`，不以
  lint allow 保留冗余 API。Codex 私有 retained-cell store、Lime canonical 无法证明的 specialized cell
  identity、A2 的其余 history/transcript contract 场景与 A3 其他 owner 继续为 `partial/contract-defer`。
  本切片没有改变 public boundary 或依赖方向，因此不更新架构图。

验证：bookmark 定向回归 `6/6`；最终完整 TUI library `1065/1065`；TUI
`--all-targets --no-deps` Clippy `-D warnings`、workspace fmt check、结构/snapshot inventory `19/19`
与 `git diff --check` 均通过。结构 inventory 按 Codex
`5c07856e25b565c86c6266ff51edff58299fd4e6` 刷新为 `1201` 个 TUI src 文件：Codex TUI src
`997 files / 14991 symbols`，Lime TUI src `204 files / 3688 symbols`，missing 为
`828 files / 11656 symbols`；结构守卫锁定 `transcript_view/bookmark.rs`、
`transcript_view/bookmark_tests.rs`、`TranscriptAnchorRange`、`TranscriptBookmark` 与
`TranscriptFrame`。

真实 `npm run smoke:tui-gate-b` 最终保留证据的完整矩阵通过：thread
`01a0e1cf-f63a-7201-b5fa-e75ff4780370`、turn `turn_e5ec8401798b45b298d8f9baf3f0f02b`，事件链为
`turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed`，
并覆盖 detailed bookmark 重开、complete、approval、user-input、interrupt、failure、queue-edit、
agents-overview、`sticky-prompt=ok`、自定义 chord `main-find=ok`、focus-palette、resize-reflow、
reconnect 与 `terminal=restored`；证据目录 `tui-gate-b-6b8Jkt`。编译仅出现 App Server 既有
`lower_turn_start_params` / `lower_runtime_options` dead-code warning，非本切片引入。本轮未改变
App Server protocol、配置 schema、Electron 或 GUI bridge，因此不重复运行 `test:contracts` 或
`verify:gui-smoke`；上一 `tui.keymap` 切片的 contracts 证据继续有效。该切片达到 Rust TUI
reducer/render 与真实 TUI Gate B 风险门槛，但总体计划仍为 `in-progress`，顶层 checklist 保持
`21/50（42%）`；下一刀回到 A2 history/transcript contract 场景或 A3 composer/bottom-pane current
owner，不把 stable bookmark 收口提升为“完整对齐 TUI”完成。

本轮 A3 Codex-shaped composer layout 切片（2026-09-29）：

- 对照 Codex 当前 checkout 的 `codex-rs/tui/src/bottom_pane/chat_composer/composer_layout.rs`，在
  `bottom_pane/chat_composer/layout.rs` 建立 Lime 唯一 `ComposerLayout` owner。它统一计算 composer
  内部区域、附件行、prompt gutter、textarea 区域和总高度，并对窄终端做宽高钳制；`ChatComposer::layout`
  与 `desired_height_for_width` 共享同一几何源。
- `view.rs` 的 screen split 与 composer render 均消费 `ComposerLayout`，不再分别推导附件行、gutter
  和 textarea 宽度，避免测量与渲染在附件存在、textarea 宽度为零或终端极窄时发生漂移。该 owner 只保存
  session-local presentation geometry，不进入 App Server、ThreadStore 或 canonical Thread/Turn/Item。
- 测试覆盖无附件/有附件布局、prompt gutter、极窄终端和零 textarea 宽度；结构 inventory 锁定
  `bottom_pane/chat_composer/layout.rs` 与 `ComposerLayout`。分类为 `current`，未新增 `compat`、
  `deprecated` 或 `dead`。Codex composer 的 attachment/draft/history/popup/slash/vim/footer 其余
  子 owner、CLI partial 与 Cloud transport 仍为 `partial/contract-defer`。

验证：composer layout 定向测试 `3/3`、附件渲染回归、窄终端回归和当前 TUI library `1068/1068` 均已通过；
结构 inventory 已刷新为 `1202` 个 TUI src 文件，结构 Vitest 守卫 `17/17`、完整 contracts 门禁、TUI
`--all-targets --no-deps` Clippy `-D warnings`、workspace fmt check 与 `git diff --check` 均通过。真实
`npm run smoke:tui-gate-b` 通过，thread
`01a0ec50-a759-7533-8194-bbf41c32b8d8`、turn
`turn_3f6897b7220347a2b5cb60e76e5dc331`，覆盖 `queue-edit=ok`、`agents-overview=ok`、`sticky-prompt=ok`、
`main-find=ok`、`focus-palette=ok`、`resize-reflow=ok`、`reconnect=ok` 与 `terminal=restored`。本切片未改变
App Server protocol、Electron 或 GUI bridge；总体 Codex CLI/TUI 对齐仍为 `in-progress`，不得宣称完整同步。

本轮 A3 Codex-shaped non-bracketed PasteBurst 切片（2026-09-29）：

- 对照 Codex 当前 checkout commit `c248f6d48b97eb4a2aa56147a0b11b7d763278b9` 的
  `codex-rs/tui/src/bottom_pane/paste_burst.rs` 与
  `codex-rs/tui/src/bottom_pane/chat_composer/paste_input.rs`，在 Lime 建立
  `bottom_pane/paste_burst.rs` 与 `bottom_pane/chat_composer/paste_input.rs` 两个唯一
  `current` owner。状态机保持 presentation-local，不进入 App Server、ThreadStore 或
  canonical Thread/Turn/Item。
- 快速键盘流按 Codex 语义识别为 paste burst：首字符短暂保留以抑制 flicker，连续字符
  聚合成 paste，Tab/Enter 在 burst 窗口内作为草稿文本而不是 queue/submit；显式 bracketed
  paste 会先接回仍未确认的 typed prefix，避免首字符丢失。`ChatComposer::handle_key_event`
  作为确定性测试入口临时禁用 timing；实时 `app/input_flow.rs`、`app/interaction.rs` 与
  `runtime.rs` 统一使用带 `Instant` 的 `handle_key_event_at` /
  `handle_tui_event_runtime`，并由 `pre_draw_tick`/`FrameRequester` 驱动 due flush。
- `map_composer_action` 在 PasteBurst 仍 active 时请求下一帧，确保首字符和缓冲内容在无新输入
  时仍会 flush；这保持 Codex `handle_input_basic -> should_request_frame` 的时序合同。真实
  PTY fixture 的键盘文本改为逐字符、跨越 burst interval 发送，避免测试写入本身被正确识别为
  非 bracketed paste；paste 行为仍由专门单测覆盖。
- 结构 inventory 与守卫同步锁定 `PasteBurst`、`CharDecision`、`FlushResult`、
  `handle_paste_burst_flush` 及两个 current owner。运行时新增入口没有改变 App Server
  JSON-RPC、ThreadStore、canonical projection 或 Electron bridge。
- 分类：PasteBurst 状态机、composer paste integration、实时 runtime frame scheduling、
  PTY 时序适配与回归均为 `current`；未新增 `compat`、`deprecated` 或 `dead`。Codex 私有
  auth/account/rollout DB/Cloud-only surface 继续按治理规则 excluded/defer。

验证：PasteBurst/Tab/Enter/explicit-prefix 定向测试通过；完整 TUI library `1075/1075`；
TUI `--all-targets --no-deps` Clippy `-D warnings`、workspace fmt check、`git diff --check`
均通过；`tui-structure-inventory.test.mjs` `17/17` 通过。真实
`npm run smoke:tui-gate-b` 完整矩阵通过，thread
`01a0ecf7-9df3-7782-8742-e00dd7cffbc6`、turn
`turn_ea2b64838ed740c4ba23cc7a8a7ec157`，覆盖 complete、approval、user-input、interrupt、
failure、queue-edit、agents-overview、sticky prompt、main Find、focus-palette、resize-reflow、
reconnect 与 `terminal=restored`；编译仅出现既有 App Server
`lower_turn_start_params` / `lower_runtime_options` dead-code warning。本轮未改 App Server
protocol、配置 schema、Electron 或 GUI bridge，因此不运行 `npm run test:contracts` 或
`npm run verify:gui-smoke`。本切片达到 Rust TUI composer/interaction 与真实 TUI Gate B
风险门槛；总体 Codex CLI/TUI 对齐仍为 `in-progress`，下一刀回到 A2 history/transcript
contract 或 A3 其余 composer/bottom-pane owner，不得宣称完整同步。

本轮 C1 Codex-shaped permission options 切片（2026-09-29）：

- 对照 Codex `SharedCliOptions`、TUI approval flags 与 `exec` precedence，Lime `ConnectionArgs`
  新增 `--sandbox`、`--ask-for-approval`、`--approve-for-me`（隐藏 alias `--not-so-yolo`）和
  `--dangerously-bypass-approvals-and-sandbox`（alias `--yolo`）。root 参数会继承到 `tui`、
  `exec` 和 `resume`；子命令显式权限组覆盖 root，保持 Codex 的 late override 语义。
- CLI lowering 只进入既有 current App Server settings contract：`approve-for-me` 映射为
  `approvalPolicy=on-request`、`approvalsReviewer=auto_review`、`sandboxPolicy=workspace-write`；
  dangerous bypass 映射为 `approvalPolicy=never`、`sandboxPolicy=danger-full-access`；普通
  `--sandbox` / `--ask-for-approval` 分别映射对应 canonical string。没有新增第二套权限 runtime，
  也没有把 `approve-for-me` 粗暴伪装成 `:workspace` profile。
- `AppServerSession::update_settings_with_policy` 复用 `thread/settings/update`，startup、`exec`
  和 bounded reconnect 都写入相同 canonical 字段。TUI 运行中切换 `/permissions` profile 后会
  清除 session-local explicit sandbox/reviewer，避免断线重连把初始 CLI policy 与新 profile 双传；
  App Server 继续负责 profile/sandbox 互斥、权限 lowering 和持久化/read model。
- 文档事实源同步到 `internal/aiprompts/commands.md` 与 `packages/cli/README.md`；没有改 protocol
  schema、Electron bridge 或 renderer gateway，因为本切片完全复用已有 v2 settings fields。

验证：CLI `command_tests` `30/30` 通过，覆盖 alias/lowering、dangerous bypass、互斥 fail-closed、
root→exec 继承和子命令 override；TUI library `1075/1075`、`cargo clippy --locked --manifest-path
"lime-rs/Cargo.toml" -p cli -p tui --all-targets --no-deps -- -D warnings`、workspace fmt、
`git diff --check` 均通过。真实 `npm run smoke:cli-gate-b` 通过，thread
`01a0ed5f-1add-7ad0-923d-0ce5ecbb8a04`、turn `turn_76c013f7ee9a4f7f91fb93ecc4fa35d5`，外部
backend ledger 捕获 `approvalPolicy=on-request`、`approvalsReviewer=auto_review`、
`sandboxPolicy=workspace-write`，并覆盖 JSON、JSONL、stdin、错误退出码和 zsh completion；CLI
Gate B 事件链为 `turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed`。
真实 `npm run smoke:tui-gate-b` 也通过，thread `01a0ed49-a5e5-76f0-b197-36fbb4601eba`、turn
`turn_c8e5c2617a0140ec80abf80ef606c2b6`，覆盖 queue-edit、agents-overview、sticky-prompt、main-find、
focus-palette、resize-reflow、reconnect 与 `terminal=restored`。`npm run test:contracts`（299 个
App Server client checks、CLI boundary、scripts/docs governance）与 CLI Gate B Vitest `2/2` 通过。
编译仅出现既有 App Server `lower_turn_start_params` / `lower_runtime_options` dead-code warning。
本切片分类为 `current`，未新增 `compat`、`deprecated` 或 `dead-candidate`；总体计划仍为
`in-progress`，不能宣称完整 Codex CLI/TUI 同步。

本轮 C1 Plugin local discovery / available flag 切片（2026-09-29）：

- 对照 Codex `plugin list --available` 与 repo-local marketplace discovery，Lime CLI `plugin list`
  新增 `--available`（强制 `--json`）和 `--plugin-cwd <DIR>`。后者只把指定目录下真实存在的
  `.agents/plugins/marketplace.json` 作为显式 `plugin/list.marketplacePaths`，路径去重后仍由
  App Server Plugin v3 catalog 校验、解析和投影；CLI 不直接读取 manifest，也不创建本地缓存。
- 当前 App Server list contract 已同时返回 installed/available 状态，因此 `--available` 只表达
  Codex 形状的调用意图，不新增第二种 JSON schema 或伪造远程刷新；默认 raw `plugins` 响应保持
  既有 CLI surface 和 Desktop Plugin catalog 兼容。Codex 远程 marketplace/cache refresh 与
  `marketplace add/remove/upgrade` 仍按产品范围 `excluded / forbidden-to-restore`。
- 真实 `cli-surface-gate-b` 增加 repo-local `plugin list --available --json --plugin-cwd` 断言，
  并在安装前确认未安装候选不会出现在默认 JSON installed 投影，证明 CLI -> stdio App Server ->
  RuntimeCore -> PluginDataSource -> local plugin_catalog 的同一 current 主链；没有新增 protocol、
  Electron bridge、runtime 或生产 mock。

验证：CLI plugin parser 定向测试 `3/3`、`npx vitest run scripts/app-server/cli-surface-gate-b.test.mjs`
`2/2`、真实 `node scripts/app-server/cli-surface-gate-b.mjs`、`npm run test:contracts`、CLI
Clippy `-D warnings`、`cargo fmt --check` 与 `git diff --check` 均通过。分类为 `current`，未新增 `compat`、`deprecated` 或 `dead`；
下一刀回到 A2 history/transcript contract 或 A3 composer/bottom-pane current owner，CLI 继续处理
MCP OAuth、queue error matrix 和 sandbox/profile contract partial。

本轮 A2 Codex-shaped transcript activity output disclosure current 切片（2026-09-29）：

- 对照 Codex `history_cell::ActivityDisclosure`、`exec_cell::command_disclosure` 与 transcript
  layout 语义，Lime 新增 `ActivityDisclosure::{Generic,OutputLines(usize)}` current owner。
  `TranscriptHistoryCell` 对 Command activity 复用 `exec_cell::CommandOutput::line_counts()`，只
  统计仍保留、可通过展开看到的 output 行；head/tail storage limit 丢弃的行不计入提示，避免把
  不可恢复数据误报为可展开内容。没有新增 transcript/history store 或第二套输出缓存。
- `TranscriptContent` / `PagerOverlay` 的 disclosure 控件继续是 synthetic presentation row，
  不进入 canonical source、selection copy 或 search；收起态显示 `+ N line(s)`，展开态保留
  `− Show less`。文案覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`，并在宽度不足时隐藏
  `open_transcript` runtime keymap hint；显式 unbind 时不显示快捷键，默认/自定义 chord 仍从
  同一 `TranscriptKeymap` snapshot 读取。
- direct activity 由 `app/history_ui.rs` 把 disclosure metadata 送入既有 `TranscriptContent`；
  grouped exploration/computer activity 保持既有 generic disclosure，避免把 grouped compact
  preview 的已显示行重复计入。分类为 `current`，未新增 `compat`、`deprecated` 或 `dead`。

验证：新增 output-line retained/storage-truncation、summary generic、五语言、窄宽度 shortcut
隐藏和 keymap default/unbind 回归；TUI library `1078/1078`、integration `18/18`、manager
regression `1/1`；`cargo clippy --locked --manifest-path "lime-rs/Cargo.toml" -p tui
--all-targets --no-deps -- -D warnings`、`cargo fmt --check` 与 `git diff --check` 通过。
`npm run inventory:tui-structure` 通过并刷新结构 inventory；真实 `npm run smoke:tui-gate-b`
通过，thread `01a0eda8-3ec2-75c1-ba02-51199b4d0060`、turn
`turn_d7cd8b1d0f2b49a4960950c422a7ba22`，覆盖 complete、approval、user-input、interrupt、failure、
queue-edit、agents-overview、sticky-prompt、main Find、focus-palette、resize-reflow、reconnect
与 `terminal=restored`。编译仅出现既有 App Server `lower_turn_start_params` /
`lower_runtime_options` dead-code warning；本切片未改 App Server protocol、配置 schema、Electron
或 GUI bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。总体计划保持
`in-progress`，下一刀继续 A2 history/transcript contract 或 A3 composer/bottom-pane current
owner，不把 output disclosure 收口提升为完整 Codex CLI/TUI 同步。

本轮 A2 Codex `d9487a2930` modal transcript wheel current 切片（2026-09-29）：

- 对照 Codex “Allow transcript wheel scrolling while a modal is open” 的交互边界，在
  `app/interaction.rs` 增加 modal transcript wheel 路由。`BottomPane` active 时，仅把命中既有
  `TranscriptSelection.layout.area` 的 `ScrollUp/ScrollDown` 转为 canonical `AppAction::ScrollRows`；
  wheel 在 approval/user-input footer、popup 或 transcript 区域外仍归 `BottomPane`，不向主 transcript
  穿透。键盘、点击、拖拽和 modal submit/dismiss 继续由 BottomPane 拥有，没有新增 overlay 或第二套
  scroll state。
- 交互仍沿用 `TranscriptSelection::handle_event` 的 selection snapshot / edge-scroll 语义；有活动
  selection 时只更新 selection layout，未改变 canonical Thread/Turn/Item、App Server JSON-RPC 或
  composer ownership。该切片只修改 TUI interaction current owner，没有新增 `compat`、`deprecated`
  或 `dead` 入口。
- 回归覆盖 approval 与 request_user_input 两类 modal：transcript 内上/下滚轮可滚动、modal 外滚轮
  不滚动、键盘字符不进入 composer；结构 inventory 同步记录当前 TUI source graph。

验证：TUI library/all-targets `1080/1080`、integration `18/18`、manager regression `1/1`；
`cargo clippy --locked --manifest-path "lime-rs/Cargo.toml" -p tui --all-targets --no-deps -- -D warnings`、
workspace `cargo fmt --check`、`git diff --check` 均通过；`npm run inventory:tui-structure` 写入
`1256` 个 TUI src 文件；真实 `npm run smoke:tui-gate-b` 通过，thread
`01a0edce-3742-7a32-9d21-cf150f788f62`、turn `turn_a355a096569b4e92857ab9da7972d73b`，覆盖
complete、approval、user-input、interrupt、failure、queue-edit、agents-overview、sticky-prompt、
main-find、focus-palette、resize-reflow、reconnect 与 `terminal=restored`。编译仅出现既有 App Server
`lower_turn_start_params` / `lower_runtime_options` dead-code warning；本切片未改 App Server protocol、
配置 schema、Electron 或 GUI bridge，因此不运行 `npm run test:contracts` 或 `npm run verify:gui-smoke`。
总体计划保持 `in-progress`，不能将单一 TUI 交互切片宣称为完整 Codex CLI/TUI 同步。

本轮 A2 Codex `99f7758a57` short turn duration current 切片（2026-09-29）：

- 对照 Codex completion footer 从“仅长回合显示”改为“只要有已知 duration 就显示”，移除 Lime
  `FinalMessageSeparator` 对 `elapsed_seconds > 60` 的过滤。1–59 秒回合现在和长回合一样保留
  既有多语言 `Worked for` / 本地化耗时标签；无 duration 仍不制造空的 transcript 行。
- 同步 Codex 对小于 1 秒回合的表达：`0` 秒现在显示为本地化的 `<1s` 语义，而不是误导性的
  `0s`；其余既有秒数格式保持不变，避免扩大到未审计的日期/运行时指标改造。
- 改动仅位于 TUI history-cell presentation owner，沿用现有 completion boundary 与 canonical
  projection，不新增 protocol、runtime、兼容入口或第二套耗时状态。

验证：completion separator 定向测试 `5/5`、TUI all-targets `1080/1080`、integration `18/18`、manager
regression `1/1`、TUI Clippy `-D warnings`、`cargo fmt --check` 与 `git diff --check` 均通过；真实
`npm run smoke:tui-gate-b` 复跑通过，thread `01a0edd7-7e01-7ef1-b2e3-505decba1c80`、turn
`turn_0274d886f1274a088d5af2598d2ef62f`，并保持 `terminal=restored`。该切片仍属 `current`，总体
Codex CLI/TUI 对齐保持 `in-progress`。

本轮 A2 Codex `c6c7c8d270` quoted selection copy current 切片（2026-09-30）：

- 对照 Codex “Omit blockquote markers when copying quoted selections” 的 selection contract，
  `TranscriptSelection::selected_text` 现在识别 Markdown renderer 生成的绿色 synthetic quote
  prefix；当选区全部由 quoted lines（可含 nested quote 与空行）组成时，移除渲染用 `> ` marker，
  保留真实内容、换行、task-list marker 和 literal `>`。只要选区混合 quoted/unquoted，继续保留
  原始渲染结构，避免误删用户文本。普通未着色 `> literal` 行 fail-closed，不被当成 blockquote。
- 改动仅位于既有 transcript selection presentation owner，不新增 LogicalLine/Markdown copy
  store、协议字段或第二套 selection 状态；selection snapshot、synthetic disclosure 排除和
  copy action contract 保持不变。
- 新增回归覆盖 nested quote、mixed quoted/unquoted、literal marker 与整行跨行选择。Codex
  quoted table 的语义元数据在 Lime 当前 renderer 不可证明，继续按现有 table contract
  `partial/contract-defer`，没有用启发式重建表格。

验证：selection 定向测试 `11/11`、TUI library/all-targets `1082/1082`、integration `18/18`、
manager regression `1/1`、TUI Clippy `-D warnings`、workspace fmt check、
`npm run inventory:tui-structure`（`1256` 个文件）与 `git diff --check` 通过；真实
`npm run smoke:tui-gate-b` 通过，thread `01a0edea-1cec-7d61-ace3-b749715a1612`、turn
`turn_217cc76a8d544722a3ae28bf5c0ab5f5`，覆盖 complete、approval、user-input、interrupt、failure、
queue-edit、agents-overview、sticky-prompt、main-find、focus-palette、resize-reflow、reconnect 与
`terminal=restored`。未改变 App Server protocol、Electron bridge 或 CLI contract。总体计划仍为
`in-progress`，不能将 quote copy 单项提升为完整 Codex CLI/TUI 同步。

本轮 A2 Codex `596f8c5c3c` pinned prompt header style current 切片（2026-09-30）：

- 对照 Codex sticky transcript header 与原始 user prompt 的视觉合同，`TranscriptPromptHeader`
  现在复用 user prompt 的 `› ` marker（bold + dim）并保留既有 history prompt background；宽度
  截断为 marker 与正文预留空间，避免 pinned header 比原始 prompt 多显示一列或溢出。
- 附件 fallback（如 `[attachments]`）也走同一 marker；控制字符、sticky suppression、selection
  excluded row、canonical prompt source 均不改变。Lime 当前没有 Codex voice/spoken prompt
  canonical field，因此不伪造红色 spoken 分支。
- 改动仅位于 transcript prompt-header presentation owner；没有新增协议字段、Thread/Turn/Item
  状态或第二套 UI state。

验证：prompt-header 定向测试 `5/5`、TUI all-targets `1082/1082`、integration `18/18`、manager
regression `1/1`、Clippy `-D warnings`、workspace fmt、inventory `1256` files 与 diff check 均通过；
真实 `npm run smoke:tui-gate-b` 在一次既有 PTY 时序抖动后复跑通过，thread
`01a0edf6-1239-7d01-ac85-6adac7e4ff78`、turn `turn_de6fa9c2a03f41a59b501fb6dcd823f7`，覆盖
complete、approval、user-input、interrupt、failure、queue-edit、agents-overview、sticky-prompt、
main-find、focus-palette、resize-reflow、reconnect 与 `terminal=restored`。总体计划保持
`in-progress`，不能把 pinned header 单项视为完整 TUI 同步。

本轮 A2 Codex `8f6517772b` Agents Overview 分页 current 切片（2026-09-30）：

- 首次 Agents Overview refresh 改为只请求一页 `thread/list` 并保留 `nextCursor`；列表末尾新增
  可上下键选中的虚拟 `Show more` 行。搜索过滤、状态分组和详情面板只消费真实 Thread 行，
  虚拟行不会进入 `selected_thread_id` 或详情渲染。
- 新增独立 `LoadMoreAgentsOverview` action 与 current App Server `thread/list` 请求链。加载中
  禁止重复 Enter，网络失败保留既有 rows 并显示五语言 retry 文案；成功后按 thread id 去重追加、
  更新 cursor，通知在加载窗口内缓冲并在合并后重放。刷新与加载更多串行化，刷新请求在加载期间
  合并为 pending，避免旧页面响应覆盖新 refresh。
- cursor 历史集合拒绝重复或跨页回环 cursor，fail-closed 后保留当前 cursor 供用户重试；未新增
  App Server protocol、第二套 thread store、compat/deprecated/dead surface 或生产 mock。
  `AgentsOverviewState`、view、renderer、interaction、event dispatch 和 runtime 继续属于同一
  TUI current owner。
- 文案覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`：显示更多、加载中、失败重试；虚拟行
  使用稳定 selection marker，窄终端沿用既有 SelectionRow 折叠布局。

验证：Agents Overview 定向测试 `24/24`，TUI library `1086/1086`、integration `18/18`、
manager regression `1/1`；`cargo clippy --locked --manifest-path "lime-rs/Cargo.toml" -p tui
--all-targets --no-deps -- -D warnings`、workspace `cargo fmt --check`、`git diff --check` 均通过。
真实 `npm run smoke:tui-gate-b` 首次受既有 PTY 时序抖动影响失败，单测重跑与第二次 Gate B 均通过，
最新线程 `01a0ef85-6ea4-78f1-a107-305a504edbe6`、回合 `turn_b4d7eb12f5c34196860189dac2a649c0`，
事件为 `turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed`，
并证明 queue-edit、agents-overview、sticky-prompt、main-find、focus-palette、resize-reflow、
reconnect 与 `terminal=restored`。完整 workspace Clippy 仍受既有 `agent-protocol` 两项 lint
阻塞，本切片未触及 App Server protocol、Electron bridge 或 GUI，因此不运行 contracts/GUI smoke。
分类为 `current`，总体计划保持 `in-progress`；下一刀回到 A2 history/transcript contract 或
A3 composer/bottom-pane current owner。

本轮 A3 Codex `4773a132c3` MCP OAuth login current 切片（2026-09-30）：

- TUI `/mcp login <name>` 现在沿用 App Server JSON-RPC 主链：命令解析只生成
  `StartMcpLogin`，OAuth 请求在后台 task 中发出，浏览器打开不阻塞 PTY 事件循环；登录尝试由
  `loginId + threadId` 绑定，completion 在传输、线程缓冲和 replay 三个阶段都 fail-closed
  过滤 stale attempt。completion 只有真正投影到所属 active thread 时才清理 active owner，避免
  切换线程或重放时丢失归属判断。
- App Server v0 OAuth params/response 与 v2 completion notification 增加可选 `threadId`、
  `loginId`；processor 为每次尝试生成同一 UUID，响应与 completion 使用同一 `loginId`，runtime
  对显式 thread 做非空和 canonical thread 存在性校验。CLI 继续显式发送 `threadId: None`，不
  复制第二套登录后端。
- `app-server-client` protocol types、schema fixtures、strict notification validator 与
  direct-notifications fixture 已同步；五语言状态文案覆盖 session-required、in-progress、
  browser-open、success、failure。登录结果使用 canonical projection status，不新增 transcript
  伪条目。
- 现有 `app/tests.rs` 补齐 typed active-login owner；pending completion、stale loginId、线程
  切换/replay、线程归属和成功状态回归保持在同一 `app` owner。未恢复旧 CLI/TUI runtime、未
  新增 mock production path。

验证：TUI MCP 定向测试 `35/35`；`cargo clippy --locked --manifest-path "lime-rs/Cargo.toml"
-p tui --all-targets --no-deps -- -D warnings` 通过；CLI 定向编译/测试通过；app-server-protocol
`133` 单元测试与 schema fixture 测试通过；`npm test --workspace @limecloud/app-server-client`
`139/139` 通过；`npm run test:contracts` 通过（299 项 contract checks）；`cargo fmt --check`
和 `git diff --check` 通过。真实 `npm run smoke:tui-gate-b` 首轮发生既有 PTY overlay 时序抖动，
exact PTY 重跑及第二次完整 Gate B 均通过，证据覆盖 queue-edit、agents-overview、sticky-prompt、
main-find、focus-palette、resize-reflow、reconnect、`terminal=restored`。
`npm run inventory:tui-structure` 已更新到 1257 files，配套 inventory Vitest `17/17` 通过。

App Server processor 的独立测试 profile 仍受本机 `rusty-v8 v150.4.0` 缺少
`librusty_v8_ptrcomp_sandbox_release_aarch64-apple-darwin.a.gz`（HTTP 404）阻塞；这不是本轮
协议或 TUI 编译错误，production `app-server` 构建已由 Gate B 完成。分类为 `current`，但整体
Codex CLI/TUI/UI 重构计划仍为 `in-progress`；下一刀继续 A2 history/transcript contract 或
A3 composer/bottom-pane owner。

本轮后续 A3/A2 UI 对齐（2026-09-30）：

- 对照 Codex `222e24b737` follow-up directive 语义，`markdown_render::followup_labels` 仅在非
  literal Markdown 区域把 `:codex-followup[标签]{prompt=...}` 降为标签；标签内 Markdown、嵌套
  方括号和 inline code 保留，代码块、链接/图片、转义和 malformed directive 原样保留。`runtime`
  的最后响应复制复用同一 lowering，因此内部 prompt 不进入 clipboard；没有改 App Server
  protocol、canonical Thread/Turn/Item 或新增渲染副本。
- 对照 Codex `64bf4e7e62` fullscreen Plan footer 交互，空闲且无 popup/overlay/活动回合时，Plan
  模式 footer 在宽屏显示 `Plan mode (shift+tab to cycle)`，窄屏自动降级为仅显示 Plan mode，
  以免遮挡快捷入口；活动回合、approval/user-input、slash/file/skill popup 和历史搜索时隐藏
  提示。五语言文案在 `Locale` 唯一 owner 中提供，Plan 模式仍来自 App Server 广播的
  `CollaborationMode`，没有在 TUI 本地创建第二套模式状态。
- `markdown_render`、runtime copy 和 footer 回归已加入现有 TUI owners；未新增 compat/deprecated
  surface，也未引入协议字段或生产 mock。该批仍属于 `current`，总体计划保持 `in-progress`。

验证：TUI library `1095/1095`、footer 定向测试 `13/13`、TUI Clippy
`--all-targets --no-deps -- -D warnings`、workspace `cargo fmt` 和 `git diff --check` 通过。
真实 `npm run smoke:tui-gate-b` 亦通过：thread `01a0f07b-17ed-7922-b099-736ef2810953`、turn
`turn_bf9f36d5aede407a8073d3f85cd49941`，事件链完整，`queue-edit`、`agents-overview`、
`sticky-prompt`、`main-find`、`focus-palette`、`resize-reflow`、`reconnect` 和
`terminal=restored` 均为 `ok`。构建期间仅出现既有 App Server `lower_turn_start_params` /
`lower_runtime_options` dead-code warning。

follow-up parser 随后按 Codex `followups_tests` 补强：支持匹配/不匹配反引号、嵌套方括号、转义
边界和带 `}` 的 quoted prompt；重复属性、未闭合属性、代码/链接/HTML literal 继续 fail-closed，
并防止相邻 malformed directive 吞掉后续有效 follow-up。相关 `markdown_render` 定向测试为
`6/6`，TUI library 计数更新为 `1096/1096`，Clippy 与 `git diff --check` 保持通过。
follow-up parser hardening 后再次运行 `npm run smoke:tui-gate-b` 通过：thread
`01a0f084-eb7c-7113-924b-dd4706c07d18`、turn `turn_cd9328a2665443bc98e36c9ec05ba938`，完整
事件链、queue-edit、agents-overview、sticky-prompt、main-find、focus-palette、resize-reflow、
reconnect 与 `terminal=restored` 均为 `ok`；仍只有既有 App Server dead-code warning。
随后针对重叠 nested follow-up 的 fail-closed 修正再次通过真实 Gate B：thread
`01a0f089-695a-7e53-926e-3b15c1661261`、turn `turn_3d6f56a86ae74cafb97992750a98c784`，
同一完整场景矩阵全部为 `ok`。

本轮 C1 Codex MCP OAuth logout current 切片（2026-09-30）：

- 对照 Codex `mcp_cmd.rs::run_logout` 与 `delete_oauth_tokens` 语义，Lime 沿唯一
  `PersistentCredentialStore` owner 增加 `McpOAuthRegistry::logout`/manager API，并通过
  `mcpServer/oauth/logout` 暴露 `name -> { removed }` contract。LocalAppDataSource 先从当前
  MCP catalog 解析配置，再由 MCP manager 清理匹配 server name + URL 的凭据；没有 token 时
  保持幂等 `removed=false`，未注入 root、stdio transport、损坏凭据和未知 server 均 fail closed。
- v0 method catalog、serialization scope、schema fixtures、Rust registry、TS generated types、
  App Server client wrapper、CLI `mcp logout` 和 current OAuth fixture 已同步。CLI 先走
  `mcpServer/list` 验证 server 与 `streamable_http` transport，再请求 App Server logout，禁止
  直接访问本地凭据文件；`mcp list` 同步识别 `type`/`transport` 两种 current config 字段。
- 该批没有新增 compat/deprecated/dead surface，分类为 `current`；Codex keyring、多种
  client-registration、远程 Cloud OAuth 和 uncertain receipt 仍保持 `partial/contract-defer`，
  不伪造到 Lime。

验证：`cargo test -p app-server-protocol --lib` 133/133；`cargo test -p cli --lib` 8/8；
`npm run test:contracts` 通过（299 项）；`npm --prefix packages/app-server-client test`
139/139；MCP current smoke guard 7/7；workspace `cargo fmt` 与 `git diff --check` 通过。
`lime-mcp`/App Server 独立测试受本机 `rusty-v8 v150.4.0` 缺少
`librusty_v8_ptrcomp_sandbox_release_aarch64-apple-darwin.a.gz`（HTTP 404）阻塞，未将其误报为
通过；下一刀回到 TUI A2 history/transcript contract 或 A3 composer/bottom-pane 子 owner，
并补真实 CLI OAuth Gate B。

本轮 A3 Codex `0196495288` 右键/中键粘贴 current 最小切片（2026-09-30）：

- Composer 在已有选区上保持右键复制优先；无选区右键产生 CLIPBOARD 粘贴 action，中键产生
  X11 PRIMARY 粘贴 action。两条路径都经 `AppAction -> runtime -> ChatComposer::handle_paste`，
  与 bracketed paste 共用 draft、Vim search 和 slash popup lowering，不创建第二套输入缓冲。
- `clipboard_paste` 新增单一 `ClipboardTextSource`、换行归一化和 fail-closed session guard：
  PRIMARY 仅在 Linux + DISPLAY + 非 Wayland/SSH/tmux/WSL 下启用；CLIPBOARD 在 SSH 下拒绝，
  不把远程终端误判为本地系统剪贴板。中键在非 X11 平台保持不可用。
- 该切片暂未迁入 Codex 的 session-lived clipboard worker、PRIMARY selection publication、
  5 秒 deadline 和 stale-read cancellation；当前 native read 是同步 helper，若要继续收口，
  下一刀应把读取迁到 worker 后再补 pending owner/Draw poll，而不是在 UI 线程增加更多阻塞读取。

验证：TUI library `1104/1104`、`cargo clippy --manifest-path "lime-rs/Cargo.toml" -p tui
--lib --no-deps -- -D warnings`、workspace `cargo fmt --all -- --check`、`git diff --check`、
`npm run inventory:tui-structure`（1258 files）及 inventory Vitest `17/17` 通过；真实
`npm run smoke:tui-gate-b` 通过，thread `01a0f0ef-f5e0-7fa0-9541-1e4e5df7de7f`、turn
`turn_0924f6cac8c04a3cbf352a5ab24feb10`，事件链完整，queue-edit、agents-overview、
sticky-prompt、main-find、focus-palette、resize-reflow、reconnect 与 `terminal=restored`
均为 `ok`。本轮未触及 App Server protocol、Electron bridge 或 GUI，未运行 contracts/GUI
smoke；整体 Codex CLI/TUI/UI 重构计划继续保持 `in-progress`，下一刀优先迁移 clipboard
worker，或回到 A2 history/transcript contract。

本轮继续 A2/Codex `3226512d47` provider-default history filter current 切片（2026-09-30）：

- Resume picker 与 `/resume` overlay 现在保存显式 `--provider` 选择，并把它作为
  `thread/list.modelProviders` 过滤传给 App Server；空值、空白值和未指定 provider 不发送过滤，
  让服务端解析自身默认 provider，避免客户端隐式 provider 覆盖服务端配置。
- Fork/Resume 的实际 thread start/fork 请求继续传递显式 provider；未指定时保持 `None`，不在
  TUI 本地创建 provider catalog、history DB 或第二套 session owner。分页后续请求复用同一过滤器。
- 分类为 `current`；Codex projectless workspace defaults、managed-provider config-layer
  resolution 和私有 rollout/state-db lookup 在 Lime 没有等价 current contract，继续
  `partial/contract-defer`，不通过猜测默认值补齐。

验证：provider-filter 定向测试 `1/1`，Rust fmt check 通过；完整 TUI library、Clippy、inventory
和真实 PTY Gate B 在本批代码收口后重跑。整体计划保持 `in-progress`，下一刀继续对齐可由
App Server canonical contract 证明的 history/provider 或 composer/UI owner。

本轮继续 A3/Codex `0196495288` clipboard worker current 切片（2026-09-30）：

- 新增 `clipboard_paste/worker.rs` 作为会话级唯一文本读取 owner；native CLIPBOARD/PRIMARY
  读取从 TUI 事件循环迁移到独立线程，UI 只在 Draw 边界消费结果。worker 只允许一个 in-flight
  native read，避免慢 broker 形成请求队列；结果回到原始 request id 后才可写入同一
  `ChatComposer` draft。
- 每次读取共享五秒 deadline；超时先向 UI 返回失败，迟到的 native response 仍会被后台 drain
  后丢弃。新键盘/鼠标输入会取消 pending owner，避免 stale clipboard text 抢占用户新草稿；worker
  response 会主动请求下一帧，确保取消后仍能释放 busy 状态。
- `Tui` 持有 session-lived `ClipboardWorker`，保留现有 `AppAction -> runtime ->
ChatComposer::handle_paste` 单一输入链。未新增 clipboard/history store 或生产 mock fallback。
  Codex 的 PRIMARY selection publication、copy lease 与读取 worker 的统一 owner 仍需后续切片，
  当前列为 `partial/contract-defer`。

验证：clipboard worker/runtime 定向回归 `3/3`；完整 TUI library `1108/1108`、TUI Clippy
`-D warnings`、workspace fmt check、`git diff --check`、结构 inventory Vitest `17/17` 均通过，
inventory 刷新为 `1259` 个文件。真实 `npm run smoke:tui-gate-b` 通过，thread
`01a0f120-2706-7501-a6c4-1cff906b5bdd`、turn `turn_c305b58ded0349ee819402dfdad44df`，事件链完整，
queue-edit、agents-overview、sticky-prompt、main-find、focus-palette、resize-reflow、reconnect 与
`terminal=restored` 均为 `ok`。编译仅出现 App Server 既有 `lower_turn_start_params` /
`lower_runtime_options` dead-code warning。本轮未触及 App Server protocol、Electron bridge 或 GUI，
因此未运行 contracts/GUI smoke。计划继续保持 `in-progress`，下一刀优先补 worker 的真实 PTY
鼠标粘贴证据与 PRIMARY publication/copy lease，或回到 A2 history/transcript contract。

本轮继续对齐 Codex `1983c48fd1`/`e8fdbf1f7c`/`819cdb726d` 的 TUI 视觉与编辑交互（2026-09-30）：

- Composer 多行 Markdown 粘贴在当前行以 `> ` 开头时，跨空行和尾行继续引用前缀，并在粘贴后追加
  两个未引用换行，让光标落到下一个 Markdown block；非 blockquote、Vim search 和现有粘贴突发
  路径保持原语义。上下文检查以 selection 起点为准，避免替换选区时读取错误行。
- Session header 按 Codex 最新 borderless banner 收口：Rich/compact transcript 只保留品牌标题、
  版本和工作目录，移除模型/推理/`/model` 提示及外围边框；模型、推理和权限事实继续保留在
  raw transcript/status owner，未创建第二份 session state。`/status` 静态页同步加入同一类轻量
  品牌标题，保持字段事实与滚动行为不变。
- 同步更新窄屏、多语言、TestBackend、reconnect PTY 和 Gate B 断言，动态 transcript 快捷键
  统一使用 `ctrl+t·esc·q` 紧凑标签；未把静态多语言文案误替换为动态 keymap owner。

验证：TUI library `1117/1117`、TUI reconnect integration 定向 `1/1`、TUI Clippy
`--lib --no-deps -- -D warnings`、workspace fmt check、`git diff --check` 和真实
`npm run smoke:tui-gate-b` 均通过；Gate B 覆盖真实 PTY、alternate screen、stdio App Server
JSON-RPC、canonical Thread/Turn/Item、queue-edit、agents-overview、sticky-prompt、main-find、
focus-palette、resize-reflow、reconnect 和 terminal restore。编译仍有 App Server 既有
`lower_turn_start_params`/`lower_runtime_options` dead-code warning。本轮没有 Electron/GUI bridge
改动，未运行 `verify:gui-smoke`/contracts；Codex CLI/TUI 全量重构仍保持 `in-progress`，下一步
继续补 A2 history/transcript contract、PRIMARY publication/copy lease 或 status/reasoning
settings 的真实 App Server owner 对齐。

本轮继续对齐 Codex `819cdb726d` 的 `/status` presentation（2026-09-30）：

- 新增 `tui/src/status/{mod,format}.rs` 作为唯一 status presentation owner；`PagerOverlay` 只
  负责生命周期、滚动和输入，状态事实仍来自 App 当前 session/projection，不复制账户、usage
  limit、server reasoning summary 或 verbosity 状态。
- `/status` 现在使用无边框字段列，长 Thread ID、工作目录、权限描述与状态值按显示宽度安全
  续行；宽度降到 7 列仍不会越界或丢失原始路径/ID。raw status lines 保留完整值，展示换行不
  改变复制/检查事实。
- 新增 CJK、半宽字符、超窄列宽与空状态 ready fallback 回归，并在结构 inventory 中锁定
  `status/mod.rs`、`status/format.rs`。没有新增 protocol、RuntimeCore、provider 或持久化字段。

分类：无边框 status presentation、字段续行和窄屏边界为 `current`；Codex account/usage
provider、server reasoning summary/verbosity、完整 status snapshots 继续 `contract/defer`。
异步 clipboard worker、copy-on-select 与真实 X11 中键 paste 仍为 `partial/platform-defer`。

验证：TUI library `1121/1121`；TUI clippy `-D warnings`、workspace fmt、`git diff --check`、
结构 inventory `17/17`、真实 `npm run smoke:tui-gate-b` 均通过。首轮 PTY 因输入时序抖动失败，
复跑通过；Gate B 继续证明 `turn.started,message.delta,item.started,item.completed,turn.completed`、
queue-edit、agents-overview、sticky-prompt、main-find、focus-palette、resize-reflow、reconnect
和 terminal restore。App Server 仅保留既有 `lower_turn_start_params`/`lower_runtime_options`
dead-code warning；计划仍为 `in-progress`。

本轮继续收口 Codex `12fd929f72` clipboard responsiveness 与 `0196495288` PRIMARY owner（2026-09-30）：

- 新增 `tui/src/clipboard_copy/worker.rs`，把 CLIPBOARD 写入迁移到 session-lived 单 in-flight
  worker；worker 负责五秒 setup deadline、迟到 response drain、busy 防队列和 Draw 边界 completion，
  不让慢的 X11/Wayland/桌面 clipboard broker 阻塞输入事件循环。
- transcript 选区在同一 worker 中并行语义地处理普通 CLIPBOARD 与独立 X11 PRIMARY publication，
  completion 分开携带两份 lease；PRIMARY 不可用时不破坏普通 copy，线程切换后的迟到 completion
  只保留普通 clipboard lease，不回写旧 UI 的 PRIMARY/selection feedback。
- 主 TUI 的最后回复、composer/transcript 选区、导出到 clipboard 和 resume picker transcript copy
  全部切换到该 worker；同步 `copy_*_with` helper 仅保留给确定性单测，未新增第二套 clipboard
  owner、history store 或 production mock fallback。

分类：session-lived copy worker、CLIPBOARD/PRIMARY 双 lease 和 stale completion guard 为 `current`；
真实 X11 中键粘贴仍为 `platform-defer`，Codex account/usage、server status snapshots 和
完整 history contract 继续 `contract/defer`。

验证：TUI library `1124/1124`、TUI Clippy `--lib --no-deps -- -D warnings`、Rust fmt check、
`git diff --check` 均通过；真实 `npm run smoke:tui-gate-b` 通过，thread
`01a0f1b5-b042-79a2-8b8a-d306ec366f6a`、turn `turn_26796a9f9a8b4406ac8ac6bf36dbc2eb`，事件链完整，
queue-edit、agents-overview、sticky-prompt、main-find、focus-palette、resize-reflow、reconnect
和 `terminal=restored` 均为 `ok`。App Server 仍仅有既有 `lower_turn_start_params`/
`lower_runtime_options` dead-code warning；整体计划继续保持 `in-progress`。

同轮补 Codex `89bf86d0bd` Agents Overview task-row current badge（2026-09-30）：

- 移除任务行描述里的 `current` 徽标，让标题/项目元数据不再为旧 badge 预留空间；当前线程仍参与
  默认选中与详情上下文，未改变 App Server thread 事实或导航语义。
- 定向 `overview_render` 回归 `4/4` 通过，覆盖窄屏、show-more/retry 与 current 默认定位。

继续对齐 Codex Agent Center 的 fullscreen UI 重构（同轮）：

- Agents Overview 从居中带边框 popup 改为占满 TUI surface 的无边框清屏布局；标题、摘要、任务列表、
  详情和 footer 仍复用原有 View/Action owner，不复制线程状态或引入新导航后端。
- 极窄终端仍 fail-closed，宽/窄 TestBackend 与 Agents Overview 行为测试通过；任务行不再显示旧的
  `current` badge，当前线程只保留默认选中与详情上下文语义。
- 修正 fullscreen Agent Center 与外层 transient status 的 owner 边界：新建任务/搜索输入时由
  Agent Center 自己持有 footer，完成 dispatch 后才恢复 app-scoped 状态反馈；真实 PTY Gate B
  的 `Ctrl-N -> New task -> dispatch` 场景重新通过。

最新验证：全量 Gate B 通过，thread `01a0f1c9-1859-7371-8ad2-f05beab3cf03`、turn
`turn_2fe2ec79257144dc8f1f07fd65092f56`，queue-edit、agents-overview、sticky-prompt、main-find、
focus-palette、resize-reflow、reconnect 和 `terminal=restored` 均为 `ok`；App Server 仍只有既有
`lower_turn_start_params`/`lower_runtime_options` dead-code warning。

## 2026-10-02 ChatWidget 输入 owner 第一阶段

对照公开 Codex `tui/chatwidget.rs`，先收敛真实的输入/交互 owner，而不是把整个 App 机械改名。
新增 `tui/src/chatwidget.rs`，`ChatWidget` 直接持有唯一 `BottomPane`；App 的字段由旧的
`bottom_pane: BottomPane` 改为 `chat_widget: ChatWidget`，所有主输入、审批/问答队列、popup、
paste、Vim、draft snapshot、渲染和 timer 调用统一经过 `chat_widget.bottom_pane`。旧的
`BottomPaneAction`、`map_bottom_pane_action` 和 `map_composer_action` 命名删除，改为
`ChatWidgetAction`、`map_chat_widget_action` 和 `map_input_result`，避免把 current surface
暴露成旧的平行 composer owner。

本阶段没有新增 App Server method、protocol/schema、runtime/provider、GUI backend 或兼容别名；
`App` 仍负责 host/global navigation、Thread/transport action 与 canonical transcript。
`ChatWidget` 的 transcript presentation、collaboration scope 和其它 Codex session state 尚未
迁入，继续列为下一刀，不把当前输入 owner 收敛误报为完整 ChatWidget。分类：ChatWidget/
BottomPane 输入 owner 为 `current`；旧 App 级 `bottom_pane` 字段及旧 action/mapper 命名为
`dead / deleted`；无新增 `compat/deprecated`。

验证：TUI all-targets `1457 library + 18 integration + 1 dependency guard` 全部通过；strict
all-target Clippy、Rust fmt、`git diff --check`、结构/夹具守卫 `39/39`、`npm run test:contracts`、
`npm run governance:legacy-report` 均通过。fresh `npm run smoke:tui-gate-b` 真实重建并通过全部
场景（thread `01a0f839-f01b-7832-9307-0dc8821a8353`，turn `turn_585cb6874baf4e079448d696e0502704`，
含 queue-edit、Agent Center、thread draft/edit lifetime、notes keymap、恢复与 terminal restore）；
同一 fresh binary 的 `npm run smoke:cli-gate-b` 通过（thread `01a0f83b-7b2b-7e91-9dc8-4cca2de7dc72`，
turn `turn_305ad017c4b1484fb32c106ac8e748ec`）。没有修改 GUI/shared protocol/runtime/provider，
因此未把 TUI Gate B 当作 Desktop Gate B；Windows/X11/live provider 与 `verify:gui-smoke` 仍是
后续风险项。责任开发者 root 确认架构图，2026-10-02；主链仍为
`Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection`。

## 2026-10-02 ChatWidget transcript presentation owner 第二阶段

在第一阶段收敛 `ChatWidget.bottom_pane` 后，本轮继续按公开 Codex `tui/chatwidget.rs` 完成同一
surface 的 session-local presentation 边界。`ChatWidget` 现在直接持有 `pager_overlay`、
`TranscriptPresentation`（含 retained pager/bookmark）、transcript scroll/viewport/follow
control/composer gap/footer/prompt header/search/selection；`App` 只保留 host/session 的
`scrollback_has_older_history`，通过 `app/transcript_presentation.rs` 做生命周期接线，并继续
负责 Thread/transport/canonical projection。所有清理、滚动、搜索、选择边缘滚动、pager 恢复与
transcript footer/header 渲染均从 `chat_widget` 读取真实 current owner，不新增 getter、Deref、
平行状态或第二份 transcript/read model。

这次迁移是直接 owner 收敛：旧 App 字段定义已删除，`PagerOverlay::transcript_selection` 等
pager 自身内部状态不误迁；`RequestUserInputOverlay.composer` 仍是独立题目 notes editor，
不属于主 ChatWidget draft。结构守卫新增 ChatWidget transcript 字段与 App 反向回流断言，inventory
更新至当前 TUI 文件树。分类：ChatWidget transcript presentation 为 `current`；App 级 transcript
字段为 `dead / deleted / guard-only`；旧 notes editor 继续 `current` 独立 owner；无新增
`compat/deprecated`。协作 scope、replay-seeded history 与其它 Codex session state 仍为
`partial/defer`，因此不把本阶段误报为完整 ChatWidget 对齐。

本阶段最低退出条件：

1. `cargo fmt`、`git diff --check`、TUI all-targets 与 strict all-target Clippy 通过；
2. composer/ChatWidget 结构守卫与 inventory 守卫通过，App 不再定义迁移字段；
3. fresh TUI Gate B 和同 binary CLI Gate B 重新构建并通过，证明真实 PTY/stdio、canonical
   Thread/Turn/Item、可见 transcript 状态和终端恢复；
4. 记录未触达 GUI/protocol/runtime/provider 的边界，TUI Gate B 不冒充 Desktop Gate B。

验证结果：TUI Gate B 重跑通过，thread `01a0f861-a0eb-7421-942f-fa2ff940f737`、turn
`turn_2967ba5145834f00ae6cef4d73462188`，包含 queue-edit、Agent Center、thread draft/edit
lifetime、notes keymap、history/search、Vim、images/mentions、resize/reconnect 与
`terminal=restored`；CLI Gate B 使用同一 fresh binary 通过，thread
`01a0f862-a38a-7051-ae8d-e38334970573`、turn `turn_13c6522417d24baf8a4f9c6f41fffcd0`，
jsonl/stdin/error-exit/completion 全部符合合同。首次 TUI PTY 抖动仅作为失败日志，不升级为
证据；没有放宽 timeout、复用旧 binary 或合成完成态。当前阶段4/4退出条件完成，整体仍
`partial/in-progress`；GUI/protocol/runtime/provider 未触达，TUI/CLI Gate B 不冒充 Desktop
Gate B。责任开发者 root，架构图确认 2026-10-02。

## 2026-10-02 ChatWidget Agent Center surface 第三阶段

继续对照公开 Codex ChatWidget 的 transient surface：Agent Center 的 `AgentsOverviewState`
现在由 `ChatWidget.agents_overview` 单一持有，App 不再定义该字段。输入、全屏渲染、取消/选择、
分页、refresh coalescing 和 notification buffer 均读取同一 ChatWidget state；App 保留
App Server `thread/list`、rename/stop/dispatch 请求及 canonical Thread notification 接线，
没有复制 view、线程数据或第二个 Agent Center backend。旧 `App.agents_overview` 字段/直接消费
已删除为 `dead / deleted / guard-only`，无新增 `compat/deprecated`；`AgentsOverviewState::view`
仍是唯一交互 owner。

结构守卫新增 ChatWidget Agent Center owner、App 反向字段和 transport/view 接线断言，inventory
保持当前 1412 个 TUI 源文件。Rust all-targets 1457 library +18 integration +1 dependency
guard、strict all-target Clippy、fmt/diff check 与 41/41 结构/inventory 守卫通过。fresh TUI
Gate B 通过，thread `01a0f874-c3d7-7202-89fd-6eb4ffc151b5`、turn
`turn_2d16c54cd3434222b5f9391659ec8b33`，`agents-overview=ok` 及 thread draft/edit lifetime、
Vim/mentions/history、resize/reconnect、`terminal=restored` 全部通过；同一 fresh binary 的
CLI Gate B 通过，thread `01a0f876-db3c-7cf1-9dde-0f3e44a79eef`、turn
`turn_0d9b52c883c943abae4d6998f11d55ea`，jsonl/stdin/error-exit/completion 合同通过。

本阶段没有修改 GUI、App Server protocol、RuntimeCore、provider 或持久化；TUI/CLI Gate B 不
冒充 Desktop Gate B。ChatWidget collaboration scope、replay seed、其它 session state 与
settings/catalog 事实源的进一步 ChatWidget 化仍是 `partial/defer`，总体对齐继续 `in-progress`。

## 2026-10-02 ChatWidget transient picker surfaces 第四阶段

继续收敛 Codex ChatWidget transient UI：`model_picker`、`agent_picker`、`resume_picker` 与
`export_picker` 已从 `App` 迁入 `ChatWidget`。App 仍负责打开动作、App Server model/thread
请求、选择结果和 canonical Thread/turn projection；`view`、input routing、footer/shortcut
visibility、transcript frame scheduling 与 picker 生命周期统一读取 `chat_widget`，没有新增
getter、Deref、compat 壳、第二 renderer 或第二 settings/catalog owner。旧 App picker 字段和
直接访问归类为 `dead / deleted / guard-only`，无新增 `compat/deprecated`。

结构守卫新增四类 picker/export owner 与 App 反向字段断言，inventory 保持 1412 个 TUI 文件。
Rust all-targets 1457 library +18 integration +1 dependency guard、strict all-target Clippy、
fmt/diff check 与 42/42 structure/inventory tests 通过。fresh TUI Gate B 通过，thread
`01a0f9cb-676e-7c92-a9d4-3b276e9c7a6a`、turn `turn_335708194d8643569bb7303bd1e8eb40`，覆盖
queue-edit、agents-overview、history/search、Vim、mentions、resize/reconnect 和
`terminal=restored`；同一 fresh binary 的 CLI Gate B 通过，thread
`01a0f9cc-64d1-7423-864c-adeda11f6277`、turn `turn_36ae4a2d2b914ab0961035f8afac615e`，
jsonl/stdin/error-exit/completion 合同通过。

本阶段没有修改 GUI、App Server protocol、RuntimeCore、provider 或持久化；TUI/CLI Gate B 不
冒充 Desktop Gate B。collaboration scope、replay seed、其它 session state 与 settings/catalog
事实源的进一步 ChatWidget 化仍为 `partial/defer`，总体对齐继续 `in-progress`。

## 2026-10-02 ChatWidget session settings owner 第五阶段

继续对照公开 Codex `tui/chatwidget.rs` 收敛 ChatWidget 的 session-local 控制面：
`model_catalog`、`collaboration_mode`、当前 `model`/`model_provider`、`reasoning_effort`、
`permissions` 与 `permission_profiles` 已从 `App` 的平行字段迁入 `ChatWidget`。启动、重连和
App Server notification 仍由 App/`AppServerSession` 读取 canonical settings/catalog，再通过
同一 owner 注入；model/agent picker、`/status`、reasoning/permission 快捷键、历史摘要和
协作模式切换全部读取 ChatWidget 的 projection。App 保留 transport、Thread/Turn/Item
projection 与 action lowering，不新增 TUI provider/catalog、持久化或兼容壳。

这次是直接 owner 收敛：旧 App settings/catalog 字段与直接消费归类为 `dead / deleted /
guard-only`；`ChatWidget` session settings 为 `current`；无新增 `compat/deprecated`。App
Server 的 `thread/settings/update`、`collaborationMode` 和 typed `model/list` 仍是 canonical
事实源，TUI 不复制 provider readiness、模型配置或 runtime 状态机。GUI 与 TUI 继续共享同一
App Server JSON-RPC、RuntimeCore 和 Thread/Turn/Item projection；本阶段没有触及 Electron
bridge、GUI settings owner 或 protocol schema。

结构守卫新增 ChatWidget settings/catalog owner、App 反向字段和历史/事件/线程设置接线断言，
inventory 刷新为 `1412` 个 TUI 源文件；结构/inventory Vitest 为 `43/43`。TUI all-targets
为 `1457` library + `18` integration + `1` dependency guard，strict all-target Clippy、
`cargo fmt --check` 与 `git diff --check` 均通过。fresh `npm run smoke:tui-gate-b` 首次仅因
PTY 时序抖动在首个 prompt 前关闭，未修改 timeout 或测试语义；按规则复跑后通过，thread
`01a0fa1b-16b8-7f30-86d3-4297f4461d2e`、turn `turn_48b9a1a7a3a34bb19530ae0a4efef821`，
包含 settings 迁移涉及的真实 PTY/alternate screen、stdio App Server JSON-RPC、canonical
Thread/Turn/Item、queue-edit、Agent Center、history/search、Vim/mentions、resize/reconnect
与 `terminal=restored`。同一 fresh binary 的 `npm run smoke:cli-gate-b` 通过，thread
`01a0fa1e-1eb4-7200-b19d-320a0c0a6909`、turn `turn_14a5b277d5b445e6a47b0d781af07974`，
`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。

`npm run governance:legacy-report` 通过：扫描 `2068` 个文件，零引用候选 `0`、分类漂移 `0`、
边界违规 `0`。本阶段没有修改 GUI、Electron bridge、App Server protocol、RuntimeCore、
provider 或持久化，因此 TUI/CLI Gate B 不冒充 Desktop Gate B，`verify:gui-smoke` 不纳入本轮
必跑集合。整体 Codex 对齐继续 `partial/in-progress`，下一刀回到 collaboration/replay seed、
history contract 或其它仍有 canonical 缺口的 ChatWidget session owner。

## 2026-10-02 ChatWidget transcript mode owner 第六阶段

在 settings/catalog 迁移后继续收掉一处仍留在 `App` 的 session presentation 状态：
`HistoryRenderMode`（rich/raw transcript）已迁入 `ChatWidget.history_render_mode`。历史渲染、
`/raw` 切换与状态反馈读取同一字段；App 只负责 host action，不保留平行 presentation flag。
这使 transcript mode 与既有 scroll/viewport/follow/search/selection 同属 ChatWidget surface，
没有复制 canonical projection 或引入新的历史存储。

分类：ChatWidget transcript mode 为 `current`；旧 App `history_render_mode` 字段/读取入口为
`dead / deleted / guard-only`；无新增 `compat/deprecated`。结构守卫补充反向字段断言。
定向结构/inventory 为 `43/43`，`cargo test -p tui --lib --no-run`、strict
`cargo clippy -p tui --lib --no-deps -- -D warnings`、workspace fmt check 与 `git diff --check`
均通过。fresh TUI Gate B 首轮为 PTY 时序抖动（图片编辑场景等待 cursor 时关闭，输出已含
`EDITOR_JOB_CONTROL_OK`），复跑稳定通过，thread `01a0fa2b-c96f-75e3-a72b-b8d6cb6aa52a`、
turn `turn_5ffaabb105e0423797371f6dc7abe0bf`，覆盖 transcript mode 相关的 rich/raw 可见面、
history/search、resize/reconnect 与 `terminal=restored`；同一 fresh binary 的 CLI Gate B
通过，thread `01a0fa2c-cb1d-7560-ab0c-6b41ce4813ba`、turn `turn_e37103466ffc41f4920459fb40b97f04`，
`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。整体对齐仍为
`partial/in-progress`，下一刀继续处理 collaboration/replay seed、history contract 或其它
未收敛的 ChatWidget session owner。
额外尝试 `npm run verify:gui-smoke` 仅完成 Electron/renderer/host/App Server 资源构建，
最后的 `shell-01-electron-smoke` 结构化 `summary.json` 未生成，Desktop Gate B 因此仍为
`unverified/harness-blocked`，不能用本阶段 TUI/CLI 证据替代。

## 2026-10-02 ChatWidget navigation/history owner 第七阶段

继续收敛 Codex ChatWidget 的 transient/session surface：Agent navigation 的稳定顺序、liveness、
parent-owned 标记以及 transcript older-history availability 已从 `App` 迁入 `ChatWidget`。
Thread start/close/status、sub-agent tool observation、Agent picker/footer、history pagination、
runtime scroll/reconnect 和 TestBackend fixture 全部改为读取同一个 `ChatWidget` projection；
App 仍只负责 transport、Thread/notification routing、App Server history 请求和 canonical
projection，不新增 navigation store、daemon 或本地 history backend。

分类：ChatWidget agent navigation/history surface 为 `current`；旧 App 字段与直接消费为
`dead / deleted / guard-only`；`ReconnectState` 中的短生命周期 transport snapshot 仍是
`compat` 边界，只负责把 App Server 返回值交给 ChatWidget，不承载 UI 业务逻辑；无新增
`deprecated`。结构守卫扩展为 `44/44`，inventory 仍为 `1412` 个 TUI 源文件。

验证：TUI all-targets `1457` library + `18` integration + `1` dependency guard、strict
all-target Clippy、fmt/diff check 均通过；fresh TUI/CLI Gate B 需在本阶段收尾后重跑。整体
对齐仍为 `partial/in-progress`，下一刀继续迁移 runtime keymap/clipboard/queued input 或
turn lifecycle 等仍留在 App 的 session-local owner，并继续保持 App Server canonical 主链。

## 2026-10-02 ChatWidget remaining session-local owner 第八阶段

沿第七阶段路线继续收回剩余 session-local TUI owner，避免 `App` 重新膨胀为第二个 ChatWidget。
本阶段窄写集覆盖 runtime keymap/global chord matcher、CLIPBOARD/PRIMARY lease、right-click paste
pending identity、queued submissions、per-thread `BottomPaneInputState`、turn lifecycle 与 skill/MCP
startup warning presentation。未迁移 `ConversationProjection`、App Server transport/session、Thread/Turn/Item
canonical projection、RuntimeCore、provider、tool authority。

实现结果：

- `ChatWidget` 新增并唯一持有 `RuntimeKeymap`、`KeyChordMatcher`、clipboard leases、`RightClickPaste`
  policy、`PendingPaste`、`QueuedSubmission` projection、thread input snapshots、`TurnLifecycleState`
  和两类 startup warning state；`BottomPane` 仍是 composer/interactive request owner。
- `App` 保留 `set_runtime_keymap`/`set_right_click_paste` 作为 host 配置入口，但只委托到 ChatWidget；
  生产消费者、render/view、runtime clipboard completion、thread handoff、history/queue edit 和 notification
  接线均读取 ChatWidget 字段，不保留旧字段或 getter/Deref 兼容壳。
- `app/right_click_paste.rs` 的 pending paste 校验现在以 `ChatWidget` 的 thread/draft snapshot 为准；
  queue preview/edit 继续消费 App Server canonical list，不新增本地 queue backend。
- 结构守卫扩展为 `23/23`，新增 App 反向字段断言和 keymap/clipboard/thread snapshot/turn-warning 接线断言；
  TUI inventory 重生成：`1412` 个源文件，Codex snapshot `1346`（direct 77 / merge 949 / contract 200 /
  defer 30 / dead 90）。

验证结果：

- `cargo test --manifest-path lime-rs/Cargo.toml -p tui --all-targets --no-default-features`：`1457` library +
  `18` integration + `1` dependency guard 全部通过。
- `cargo clippy --manifest-path lime-rs/Cargo.toml -p tui --all-targets --no-default-features --no-deps -- -D warnings`、
  Rust fmt、Prettier/ESLint、`git diff --check` 通过。
- `npx vitest run scripts/app-server/tui-composer-structure.test.mjs`：`23/23`；
  `npm run governance:legacy-report`：扫描 `2068` 文件，零引用候选 `0`、分类漂移 `0`、边界违规 `0`。
- fresh `npm run smoke:tui-gate-b` 通过：thread `01a0fa50-bac4-7a31-8654-4d16321f2791`、turn
  `turn_53f929c861df44d69c1ab23b798a7286`；thread-input stdio、typed queue/edit、Agent Center、history/search、
  Vim/mentions、resize/reconnect、terminal restore 全部通过。
- fresh `npm run smoke:cli-gate-b` 通过：thread `01a0fa51-92be-72f3-8180-6d04b7e9a95b`、turn
  `turn_0ad6a3928150485aa3a84180306abbd4`；`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。
- 本阶段没有修改 GUI、Electron bridge、App Server protocol、RuntimeCore、provider 或持久化；TUI/CLI Gate B
  不冒充 Desktop Gate B。`verify:gui-smoke`/Windows/X11/live provider 未在本刀新增证据，Desktop 状态继续
  `unverified/harness-blocked`。

本阶段退出条件 4/4 完成；整体 Codex 对齐仍为 `partial/in-progress`。下一刀优先检查 replay seed/history
contract 与其它未收敛 ChatWidget session state，再决定是否清理剩余 App-local warning/startup 边界。

## 2026-10-02 ChatWidget external editor lifecycle owner 第九阶段

继续对照公开 Codex `chatwidget.rs` 的 session-local owner：外部编辑器生命周期状态此前仍由
`App` 持有，输入占用判断、异步 editor launch 与 runtime 恢复路径因此保留了 App 级平行状态。
本阶段将 `ExternalEditorState` 与 request/active/reset 操作直接迁入 `ChatWidget`，输入提交、推理
快捷键和 runtime editor loop 统一读取同一 owner；`App` 不再提供旧 getter/setter 包装，也不改变
外部编辑器的 host 生命周期、草稿传递或 terminal restore 语义。

分类：`ChatWidget.external_editor_state` 及其生命周期方法为 `current`；旧 App 字段、getter 和
setter 为 `dead / deleted / guard-only`；无新增 `compat/deprecated`。`ConversationProjection`、
App Server transport/session、Thread/Turn/Item canonical projection、RuntimeCore、provider 与 GUI
bridge 均未触达，TUI 仍通过既有 App Server 主链运行。

结构守卫新增 ChatWidget external-editor owner 与 App 反向字段断言。验证：TUI library
`1457/1457`、结构守卫 `24/24`、strict all-target Clippy、Rust fmt、`git diff --check`、
`npm run governance:legacy-report`（扫描 `2068` 文件，零引用候选/分类漂移/边界违规均为 `0`）
和 `npm run test:contracts` 均通过。fresh TUI Gate B 通过，thread
`01a0fa5a-fe87-78b1-a845-48ef6138eaf2`、turn `turn_507d7c94311744c7a577474c0fd129cc`，
覆盖 queue/edit、Agent Center、history/search、Vim、mentions、resize/reconnect、terminal restore
及 editor keymap/chord 场景；同一 fresh binary 的 CLI Gate B 通过，thread
`01a0fa5b-bd19-7673-a7fe-8a74d8302e04`、turn `turn_2d5417f633d7413ab7e1947958cb76ed`，
`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。Desktop Gate B 继续
`unverified/harness-blocked`，不以终端证据替代 GUI 验收。

本阶段退出条件 `4/4` 完成：1) editor request/active/reset 只有 ChatWidget 一份状态；2) Ctrl-G、
reasoning shortcut blocking 与 async runtime editor loop 回归通过；3) fresh TUI Gate B 与同 binary
CLI Gate B 重新通过；4) replay seed/history contract 与其它 ChatWidget session 缺口仍明确为
`partial/defer`。下一刀回到 A2 history/transcript contract 或 startup/replay owner。

## 2026-10-03 ChatWidget interaction presentation owner 第十六阶段（已完成）

沿 A3 interaction 收口继续对照 Codex `chatwidget/interaction.rs`：App 原先仍直接编排审批详情
pager 创建、modal transcript wheel 的 selection mutation，以及 FocusLost/Resume 时 pager、resume
picker 和 selection 的 drag 收尾。它们虽然已经访问 `ChatWidget` 字段，但 presentation 行为仍
散落在 host router，容易重新形成第二套 interaction owner。

本刀新增 `chatwidget/interaction.rs`，由 ChatWidget 统一承接：

- `end_interaction_drag`：selection、transcript pager、resume picker 的 drag 收尾；
- `open_approval_details_pager`：审批详情标题/行数据、transcript keymap 和 pager 构造；
- `route_modal_transcript_wheel`：受保护交互期间 transcript wheel 的 hit-test 与滚动 mutation；
- `handle_main_transcript_selection` / `finish_main_transcript_selection_if_active`：主 transcript
  selection 事件和结束恢复。

`app/interaction.rs` 现在只保留连接状态、surface 优先级、`AppAction` 映射和 host boundary；不再
直接调用 `approval_details_for_key`、`transcript_selection.handle_event` 或回写
`pager_overlay`。没有新增 protocol、schema、transport、provider、mock backend 或第二 history
store；App 仍拥有 thread routing、transport channels、startup host boundary 与 canonical
projection。

分类：`ChatWidget` interaction presentation 为 `current`；App 直接编排的旧 mutation 为
`dead / deleted / guard-only`；无新增 `compat/deprecated`。

验证结果：

- `cargo test -p tui --all-targets --no-default-features`：`1462` library + `18` integration +
  `1` dependency guard 全部通过；
- `cargo clippy -p tui --all-targets --no-default-features --no-deps -- -D warnings`、Rust fmt、
  `git diff --check` 通过；
- 结构守卫与 inventory：`54/54` 通过；
- `npm run test:contracts` 通过；
- `npm run governance:legacy-report`：扫描 `2068` 文件，零引用候选、分类漂移、边界违规均为 `0`；
- fresh `npm run smoke:tui-gate-b` 通过：thread `01a0fdc3-d32f-7801-b7da-da25cd9a9d16`、turn
  `turn_e392a56d4ff0434db9a02c37481a2975`；thread-input stdio、typed queue/edit、Agent Center、
  history/search、Vim/mentions、resize/reconnect、terminal restore 全部通过；
- 同一 fresh binary 的 `npm run smoke:cli-gate-b` 通过：thread `01a0fdc3-d213-7f20-9eb2-329a41afbbc5`、
  turn `turn_ed2be5f924564bcd9c8c9cc003a199f4`；`jsonl=ok`、`stdin=ok`、`error-exit=1`、
  `completion=zsh`。

本阶段退出条件 `4/4` 完成：1) modal/pager/selection presentation mutation 只有 ChatWidget
owner；2) 审批详情 pager、modal wheel、FocusLost/Resume drag cleanup 回归通过；3) fresh TUI Gate B
与 CLI Gate B 重新通过；4) App transport/routing 与 startup boundary 未被迁移。Desktop Gate B 仍为
`unverified / harness-blocked`，不能用 TUI/CLI 证据替代 GUI 验收。整体 Codex 对齐仍为
`partial / in-progress`；下一刀优先继续收口 ChatWidget interaction 中 picker/resume/export
分支的 mutation，或回到剩余 A2 transcript/history contract，不恢复旧 composer、旧
`thread_settings` 或第二 history store。

## 2026-10-03 ChatWidget picker/export lifecycle owner 第十七阶段（已完成）

继续第十六阶段的 interaction owner 收口：`app/interaction.rs` 原先仍直接持有并修改
`export_picker`、`resume_picker`、`agents_overview`、`model_picker`、`agent_picker`，包括 picker
关闭、选择结果提取和 resume transcript pager 分支。它们属于 ChatWidget 的 session-local
presentation，不应由 App host router 维护第二套生命周期。

本刀将生命周期行为迁入 `chatwidget/interaction.rs`：

- `handle_export_picker_event` 负责 export picker 消费、取消/复制/保存路径提取和关闭；
- `handle_resume_picker_event` 负责 resume picker 的 transcript pager 与列表事件分派，并在取消时
  关闭 picker；
- `handle_agents_overview_event` 负责 Agent Center action、选中 thread identity 捕获以及关闭
  overview/agent picker；
- `handle_model_picker_event` 负责 model selection lowering、取消和关闭；
- `handle_agent_picker_event` 负责 agent thread selection/cancel 与关闭。

App 现在只消费这些 ChatWidget interaction result 并映射为 `AppAction`；取消语义保持 Codex/Lime
既有合同（`/resume` cancel 仍为 `AppAction::None`）。未新增 protocol/schema、transport、provider、
mock backend 或第二 history store，App 继续拥有 thread routing、transport channels、startup host
boundary 与 canonical projection。

分类：picker/export lifecycle 为 `current`；App 直接 mutation、字段关闭和选择提取为
`dead / deleted / guard-only`；无新增 `compat/deprecated`。

验证结果：

- `cargo test -p tui --all-targets --no-default-features`：`1462` library + `18` integration +
  `1` dependency guard 全部通过；
- `cargo clippy -p tui --all-targets --no-default-features --no-deps -- -D warnings`、Rust fmt、
  `git diff --check` 通过；
- 结构守卫与 inventory：`55/55` 通过；
- `npm run test:contracts` 与 `npm run governance:legacy-report` 通过（2068 文件，零引用候选、
  分类漂移、边界违规均为 `0`）；
- fresh `npm run smoke:tui-gate-b` 通过：thread `01a0fdce-14fb-7820-9adc-a18fdaf5f919`、turn
  `turn_5d432c7ec5664cdd86d4405a33e0041a`；typed queue/edit、Agent Center、history/search、
  structured/persistent history、Vim/mentions、resize/reconnect、terminal restore 全部通过；
- 同一 fresh binary 的 `npm run smoke:cli-gate-b` 通过：thread `01a0fdce-10c9-7073-956d-bf2e44b3226a`、
  turn `turn_18cf7aebcfa34eeb894e59384b0ec6d8`；`jsonl=ok`、`stdin=ok`、`error-exit=1`、
  `completion=zsh`。

本阶段退出条件 `4/4` 完成：1) 五类 picker/export mutation 只有 ChatWidget owner；2) 选择、取消、
resume pager 和 export path 语义回归通过；3) fresh TUI Gate B 与 CLI Gate B 重新通过；4) App
transport/routing、startup boundary、canonical projection 未被迁移。Desktop Gate B 继续
`unverified / harness-blocked`；整体 Codex 对齐仍为 `partial / in-progress`。下一刀优先回到
剩余 A2 transcript/history contract，或审计 ChatWidget interaction 中仍可下沉的 keymap/scroll
presentation 分支，不恢复旧 composer、旧 `thread_settings` 或第二 history store。

## 2026-10-03 ChatWidget transcript interaction mutation closure 第十八阶段（已完成）

第十七阶段后继续审计 `app/interaction.rs` 的 presentation mutation，发现 picker/export 已收口，
但主 pager event close、selection scroll/reveal、transcript search 关闭时恢复 scroll，以及 follow
control 返回 latest 仍由 App 直接修改 ChatWidget 内部字段。本刀补齐最后一组 interaction mutation
边界：

- `handle_pager_event`：ChatWidget 自己处理 pager event，并在 Close 时 retain/dismiss；
- `scroll_main_selection` / `reveal_main_selection_row`：selection 的滚动与可见行 reveal；
- `handle_transcript_search_event`：搜索事件与 close 时 scroll 恢复；
- `handle_transcript_follow_mouse`：follow control 命中与 return-to-latest scroll。

App 只保留 `PagerAction`、`SearchAction`、selection action 到 `AppAction` 的映射，不再直接调用
`pager.handle_event`、`transcript_search.handle_event`、`transcript_follow_control.handle_mouse` 或
selection mutation。无新增 protocol/schema、transport、provider、mock backend 或第二 history store。

验证：TUI `1462 + 18 + 1` 全绿；结构/inventory `55/55`；strict all-target no-deps Clippy、Rust
fmt、`git diff --check`、contracts、legacy report（2068 文件，零引用候选/分类漂移/边界违规均为
`0`）通过。最终 fresh TUI Gate B 通过：thread `01a0fdd6-6375-7590-a15e-af3a0b5d2294`、turn
`turn_2b36f3d0080643eb9a351acf1d7c814d`，覆盖真实 PTY/alternate screen、thread input、typed
queue/edit、Agent Center、history/search、Vim/mentions、resize/reconnect、terminal restore；同一
fresh binary CLI Gate B 通过：thread `01a0fdd6-489c-7891-893e-7df99f367563`、turn
`turn_821879da96d04eb49255faa85ebf80f7`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。

退出条件 `4/4`：1) transcript interaction mutation 只有 ChatWidget owner；2) pager/search/follow/
selection 回归保持；3) 最终 TUI/CLI Gate B 通过；4) App Server/runtime/projection 主链未被触达。
Desktop Gate B 仍为 `unverified / harness-blocked`；整体对齐继续保持 `partial / in-progress`。

## 2026-10-03 ChatWidget global keymap/startup presentation owner 第十九阶段（已完成）

继续清理 App host interaction 中最后一组可变 presentation 入口：global key chord matcher 的
reset/dispatch、shortcut overlay 关闭、transcript search begin/follow reset，以及 startup
protected-request pending 标记的 set/clear/read。它们不属于 App Server transport 或 thread routing，
统一收回 ChatWidget。

新增 ChatWidget owner 方法：`reset_global_key_chord`、`dispatch_global_key`、
`dismiss_shortcut_overlay`、`begin_transcript_search`、`startup_protected_request_pending`、
`set_startup_protected_request_pending`、`clear_startup_protected_request`。App 仅保留
`startup_protected_input_boundary` host gate、thread-event buffer 检查和 global action 到
`AppAction` 映射；不再直接回写 `global_key_chord_matcher`、`transcript_search`、follow control 或
`startup_pending_protected_request`。

分类：ChatWidget global keymap/search/startup presentation 为 `current`；App 直接 mutation 为
`dead / deleted / guard-only`；无新增 `compat/deprecated`，无协议、schema、provider、mock 或
第二 history store。

验证：TUI `1462 + 18 + 1`、strict all-target no-deps Clippy、Rust fmt、结构/inventory `55/55`、
`git diff --check` 全部通过；最终 fresh TUI Gate B 通过：thread `01a0fddd-6980-76d2-a7f2-3266fd32a012`、
turn `turn_1639079023004f46a278f4f43fc660de`，真实 PTY/alternate screen、thread input、typed
queue/edit、Agent Center、history/search、Vim/mentions、resize/reconnect、terminal restore 全部
通过；同一 fresh binary CLI Gate B 通过：thread `01a0fddd-6525-7de1-84b3-6f3a484ff227`、turn
`turn_a8b4f194b5a7427ab143980abc154e9e`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。
`npm run test:contracts`、`npm run governance:legacy-report`（2068 文件，零引用候选/分类漂移/边界
违规均为 `0`）也已通过。

退出条件 `4/4`：1) global keymap/search/startup presentation 单 owner；2) startup gate 与
transport ownership 未混淆；3) 最终 TUI/CLI Gate B 通过；4) 守卫阻止 direct mutation 回流。Desktop
Gate B 继续 `unverified / harness-blocked`；整体 Codex 对齐保持 `partial / in-progress`。

## 2026-10-02 ChatWidget startup protected-request pending owner 第十阶段

沿第九阶段继续区分 host startup gate 与 chat presentation pending：
`startup_pending_protected_request` 已从 `App` 迁入 `ChatWidget`，成功 thread handoff、交互回应、
pre-draw timer、断线清理和 startup request 接线全部读写同一 UI pending owner；
`startup_protected_input_boundary` 仍归 App 的 terminal host 生命周期，不能把 host gate 误迁为
第二个 transport/session owner。现有 queued protected-request 检查仍合并当前 Thread bounded
event channel，未复制 request queue 或业务 waiter。

分类：ChatWidget pending presentation 为 `current`；旧 App pending 字段与直接消费为
`dead / deleted / guard-only`；无新增 `compat/deprecated`。TUI library `1457/1457`、结构守卫
`25/25`、strict all-target Clippy、Rust fmt 和 `git diff --check` 通过；fresh TUI/CLI Gate B
待本阶段收尾后重跑。GUI/protocol/runtime/provider 未触达，Desktop Gate B 继续
`unverified/harness-blocked`。最低退出条件：pending 状态单 owner、host boundary 保持、交互/断线/
thread-switch 回归与 fresh Gate B 通过。整体对齐仍为 `partial/in-progress`；下一刀优先回到
A2 remaining history/transcript contract 或 replay-seeded history。

## 2026-10-02 replay-seeded composer history 第十一阶段（已完成）

本阶段回到 Codex `ChatComposerHistory::record_replayed_submission` 语义：resume/hydrate 与
paginated transcript 的 canonical `ThreadItem::UserMessage` 现在进入同一个 BottomPane 主
composer history owner，Up/Down 与 Ctrl-R 不再只看到本地提交或独立的 text-only prompt
history。`HistoryEntry::from_user_inputs` 保留 TextElement byte range、local/remote image
detail 与 Skill/Mention binding；legacy Turn 先使用 `hidden_user_message_ids` 过滤 review
prompt/nested duplicate，paginated older page 以 prepend 保持 chronological recall，persistent
prompt history 与 replay entries 在现有 owner 内按 text/mention identity 去重。

无 Turn enrichment 的 flat paginated page 只允许进入 transcript projection，不 seed composer
history（fail closed），避免从 item-only 页面猜测并暴露 agent-only review prompt。没有新增
protocol、schema、App Server 方法、mock backend、第二 history store 或 compat 包装；App 仅把
canonical replay facts 交给 BottomPane，持久化 prompt history 仍由 App Server `promptHistory/*`
提供。

分类：`ChatComposerHistory` replay seed、canonical input lowering 与 BottomPane 接线为
`current`；旧的“只从 local submit recall”的缺口为原位重构，不新增 `compat/deprecated`。
结构守卫已扩展 replay owner、hydrate/page 接线和 no-Turn fail-closed 断言；新增 history
conversion、review filter、older-page order、persistent duplicate 与 flat-page guard 回归。
退出条件已完成：replay/history 定向 13/13，TUI all-targets `1461/1461`（含 integration/
dependency guard）、strict all-target Clippy、Rust fmt、结构守卫 `25/25`、contracts、legacy
report（2068 文件，零引用候选/分类漂移/边界违规均为 0）和 `git diff --check` 全部通过。
fresh TUI Gate B 通过：thread `01a0fc6e-83f0-7123-9209-dccf08038ac2`、turn
`turn_935636cdea7e4b2cb7518ce97acd21f4`，`structured-history`、`persistent-history`、Vim/
mentions、resize/reconnect 和 `terminal=restored` 全部通过；同一 fresh binary 的 CLI Gate B
通过：thread `01a0fc6f-86a4-7da0-b73a-b77b1d255c00`、turn
`turn_2fbb761cde5c4dd4bfc31b49dba4687b`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、
`completion=zsh`。受控 external backend，非 live provider。Desktop Gate B 继续
`unverified/harness-blocked`，不能用 TUI/CLI 证据替代 GUI 验收。整体对齐保持
`partial/in-progress`；下一刀继续回到 ChatWidget collaboration scope、其它 session state
或剩余 A2 transcript contract，而不是恢复旧 composer/第二 history store。

## 2026-10-02 ChatWidget collaboration/settings owner 第十二阶段（已完成）

继续对照公开 Codex `tui/chatwidget/settings.rs` 收敛协作控制面：Lime 原先把模型 catalog、
线程设置快照、permission profile 归一化、默认 collaboration mode 推导、Plan/BackTab 选择
和 model picker 构造全部写在 `app/thread_settings.rs`，使 App 仍承担 ChatWidget 业务规则。

本刀将这些规则直接迁入新增的 `chatwidget/settings.rs`：ChatWidget 成为唯一的
model/provider/effort/permission/collaboration projection 与 derivation owner；旧 App 的
`thread_settings` 委托文件已删除，启动、重连及 App Server 返回值直接调用 ChatWidget，不新增协议、schema、
transport、provider 或第二份 settings store。生产输入与 runtime 直接消费
`chat_widget.next_collaboration_mode()`、`plan_mode()` 和 `set_collaboration_mode(...)`，
独立问答 notes editor、canonical Thread/Turn/Item、App Server `thread/settings/update` 与
`collaborationMode` authority 保持不变。

结构守卫新增 ChatWidget settings owner、App 窄委托和 runtime/event/input 接线断言；旧的
App 内协作推导逻辑归 `dead / guard-only`，没有新增 `compat/deprecated`。本阶段验证已完成：
TUI `1462` library + `18` integration + `1` dependency guard、strict TUI Clippy
(`--all-targets --no-deps`)、Rust fmt、结构/inventory `51/51`、`npm run test:contracts`、
`npm run governance:legacy-report`（2068 文件、零引用候选/分类漂移/边界违规）与
`git diff --check` 均通过。fresh `npm run smoke:tui-gate-b` 通过，thread
`01a0fc9c-6f34-7cc2-9db8-96aa8f41f264`、turn `turn_36dbbc5f0e624f328110ee9900bddaff`，
包含真实 PTY、alternate screen、typed input、history/reconnect 与 `terminal=restored`；同一
fresh binary 的 `npm run smoke:cli-gate-b` 通过，thread `01a0fc9c-6ac6-7ca1-b19a-9b8fd1e3dc48`、
turn `turn_e95d8a8508a145ca85679e0de3f1f063`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、
`completion=zsh`。完整 workspace Clippy 仍会命中既有 `agent-protocol` 的
`large_enum_variant` 与 `derivable_impls` 基线告警，本阶段以 owner 级 no-deps 严格检查为准。
Desktop Gate B 继续 `unverified/harness-blocked`，整体对齐仍为 `partial/in-progress`。

## 2026-10-02 ChatWidget locale presentation owner 第十三阶段（已完成）

继续审计 ChatWidget 剩余 session-local presentation state：App 原先持有 `Locale`，导致
history、pager、footer、shortcut、MCP 状态文案和 view 渲染读取第二个宿主级 presentation
owner。本刀将 `locale: Locale` 收回 `ChatWidget`；`App::set_locale` 仅作为启动 host 配置委托，
所有用户可见文案、历史/分页/快捷键/状态渲染以及 MCP 登录反馈统一读取
`app.chat_widget.locale`。未迁移 `cwd`、Thread transport、MCP login request lifecycle、
canonical projection 或 App Server authority；这些仍是 App/transport current owner，不伪造
ChatWidget 业务状态。

分类：ChatWidget locale 与所有读取接线为 `current`；旧 App `locale` 字段/直接消费为
`dead / deleted / guard-only`；`App::set_locale` 仅是 current host 配置入口并委托 ChatWidget；无新增
`compat/deprecated`、协议、schema、provider 或 GUI backend。新增结构守卫要求 App 不再声明 locale，
view/history/MCP 文案只从 ChatWidget 读取；TUI inventory 已刷新至 `1412` 文件。

验证：TUI `1462` library + `18` integration + `1` dependency guard、结构/inventory
`52/52`（含 MCP OAuth transport owner 负向守卫）、locale 相关 TestBackend/五语言回归、strict TUI Clippy
(`--all-targets --no-deps`)、`npm run test:contracts`、`npm run governance:legacy-report`、
`git diff --check` 均通过。locale 迁移后的 fresh `npm run smoke:tui-gate-b` 再次通过，thread
`01a0fcb7-9d08-7fc0-8894-dfd894f8cc26`、turn `turn_92eb7cb50f504f77aa9b0ab6f8458741`，
`images=ok`、`structured-history=ok`、`resize/reconnect`、`terminal=restored`；同一 fresh
binary 的 `npm run smoke:cli-gate-b` 通过，thread `01a0fcb7-87ee-7050-a89f-8c4c3e7fd9a7`、
turn `turn_dbbd4bf3a419450c8c1e17fb2c5faaf5`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、
`completion=zsh`。整体对齐仍为 `partial/in-progress`；下一刀优先审计 MCP login transient state
是否保持 App-scoped transport owner，并回到剩余 A2 history/transcript contract，不恢复旧
composer、旧 `thread_settings` 入口或第二 history store。

## 2026-10-02 ChatWidget settings single-owner 第十四阶段（已完成）

继续对照 Codex `ChatWidget` settings owner 收敛 TUI 的模型、provider、推理强度、权限和
协作模式快照。此前 `App::runtime` 与 `app/thread_settings.rs` 共同持有并回写同一组可变
settings，形成第二套 settings owner；启动、resume、model picker、快捷键和 App Server
返回值也因此需要在宿主层传递多组可变引用。

本刀将 settings patch、模型/推理/权限/协作模式更新、model catalog、permission profile
归一化与 collaboration derivation 全部收回 `ChatWidget` 的 `settings.rs`。`EventContext`
不再携带四组 runtime settings 引用；startup/session lifecycle 只保留 terminal host policy
并直接委托 ChatWidget；runtime reconnect、picker 与 settings command 也只消费
`chat_widget`。旧 `app/thread_settings.rs` 已物理删除，不新增 compat 包装层、协议、schema、
transport、provider 或第二份 settings store；App Server `thread/settings/update` 仍是
canonical authority，MCP OAuth request/generation 状态继续留在 App 的 transport owner。

分类：ChatWidget settings snapshot、model catalog、permission/collaboration projection
及其接线为 `current`；旧 App/runtime settings 字段、`thread_settings` 实现和直接可变引用
为 `dead / deleted / guard-only`；无新增 `compat/deprecated`。结构守卫新增 settings
single-owner、App 窄委托、runtime/event/input 不得回持 settings 的负向断言。

本阶段已通过结构守卫 `53/53`、Rust fmt check、`git diff --check`、`npm run test:contracts`
与 `npm run governance:legacy-report`（2068 文件，零引用候选/分类漂移/边界违规均为 0）。
fresh `npm run smoke:tui-gate-b` 通过，thread `01a0fd18-398e-7470-8f17-50bfd0110687`、
turn `turn_3c442bc7fc1e484c9398f9112f6a411f`，包含真实 PTY、alternate screen、typed input、
history/reconnect、resize、structured/persistent history 与 `terminal=restored`；同一 fresh
binary 的 `npm run smoke:cli-gate-b` 通过，thread `01a0fd18-3878-7713-9abd-5f9f1644bdae`、
turn `turn_d019d493c44446508d6bae3eecbe06ad`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、
`completion=zsh`。TUI `1462` library + `18` integration + `1` dependency guard 与 strict
all-target no-deps Clippy 已在实现阶段通过。Desktop Gate B 继续 `unverified/harness-blocked`，
TUI/CLI 证据不能替代 GUI 验收；整体对齐保持 `partial/in-progress`。下一刀回到剩余 A2
transcript contract 或其它仍未收敛的 ChatWidget session-local state，不恢复旧 composer、
旧 `thread_settings` 或第二 history store。

## 2026-10-02 ChatWidget transcript presentation owner 第十五阶段（已完成）

继续沿 Codex `ChatWidget` transcript/pager owner 收口 App 中残留的用户界面状态变更。此前
`App` 虽已不再声明 transcript 字段，但仍直接修改 `pager_overlay`、scroll、selection、
clipboard lease、follow/reflow、turn lifecycle，并在 App 内创建 status/MCP pager，行为 owner
仍然分裂。

本刀新增 `chatwidget/transcript.rs`，由 ChatWidget 统一承接 raw/rich render mode 切换、
transcript pager 打开/关闭/重置、status/MCP inventory pager 创建、scroll 上下/首尾、selection
结束、thread switch reset 与 hydrated-thread reset。`app/transcript_presentation.rs` 保留为
窄 host 委托；`App` 的 thread routing、startup boundary、transport、`ConversationProjection`
和 canonical Thread/Turn/Item 仍保持原 owner。没有新增 protocol/schema、第二 history store、
compat/deprecated 包装或生产 mock。

分类：`ChatWidget` transcript/pager 行为与 `chatwidget/transcript.rs` 为 `current`；App 中
直接操作 ChatWidget presentation 字段为 `dead / deleted / guard-only`；MCP login request
生命周期仍是 App-scoped transport current。结构守卫扩展为要求 transcript 方法集中在
ChatWidget，并禁止 App 直接创建 pager 或回写 pager overlay。

验证：结构/inventory `53/53`、TUI `1462` library + `18` integration + `1` dependency guard、
strict all-target no-deps Clippy、Rust fmt、`git diff --check` 均通过。fresh
`npm run smoke:tui-gate-b` 通过，thread `01a0fd2d-ce14-7170-906b-7bb8824c842f`、turn
`turn_8ac005ff10164b2895ce91c50982a0c7`，覆盖真实 PTY、alternate screen、typed input、
history/search/resize/reconnect、pager 相关投影与 `terminal=restored`；同一 fresh binary 的
`npm run smoke:cli-gate-b` 通过，thread `01a0fd2d-c9ec-71d1-9eef-b3fdcfad51ba`、turn
`turn_8dd81adc61d648dba36184615e701572`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、
`completion=zsh`。Desktop Gate B 继续 `unverified/harness-blocked`，整体对齐仍为
`partial/in-progress`；下一刀继续处理 A3 ChatWidget input/interaction 或剩余 A2
transcript contract，不恢复旧 composer、旧 `thread_settings` 或第二 history store。

## 2026-10-03 ChatWidget queued input / clipboard pending owner 第二十阶段（已完成）

继续审计 ChatWidget 迁移后的瞬态输入边界：队列字段虽然已经位于 ChatWidget，但 App 的
`input_submission` 仍直接替换、upsert、删除并重建 queued submission；`input_flow` 和
`view` 也直接读取字段。异步右键粘贴的 pending completion 同样由 App 直接写字段，形成
宿主与 ChatWidget 的第二个可变入口。

本刀在 `chatwidget/input.rs` 收口 `queued_submissions()`、
`replace_queued_submissions`、`upsert_queued_submission`、
`restore_queued_submission_for_edit`，并收口 `set/pending/take/clear_pending_clipboard_paste`
及 source 读取。队列编辑恢复（文本元素 byte range、图片 detail、Skill/Mention binding）
现在和主 BottomPane editor 一样由 ChatWidget input owner 负责；App 只保留 host 委托、线程
与 canonical projection 语义。右键粘贴仍由 App 负责线程/草稿一致性检查和 worker 结果落地，
但 pending 生命周期不再 direct mutation。未新增协议、schema、transport、provider、mock
backend、第二 history store 或 compat/deprecated 包装。

分类：ChatWidget queue/edit/pending clipboard API 为 `current`；App 对 queued/pending 字段
的直接读写为 `dead / guard-only`；既有 `App::set_queued_submissions`、
`upsert_queued_submission`、`restore_queued_submission_for_edit` 仅为 host 委托入口，不承接
业务逻辑。结构守卫扩展为要求 queue/paste mutation 只在 ChatWidget input owner，并禁止
`app/input_submission.rs`、`app/input_flow.rs`、`view.rs`、`app/right_click_paste.rs` 回写字段。

验证：TUI all-targets `1462` library + `18` integration + `1` dependency guard 全绿；strict
all-target no-deps Clippy、Rust fmt、`git diff --check`、ChatWidget/composer 结构守卫 `31/31`、
`npm run inventory:tui-structure`（`1415` 文件）、`npm run test:contracts`、
`npm run governance:legacy-report`（2068 文件，零引用候选/分类漂移/边界违规均为 `0`）通过。
fresh TUI Gate B 通过：thread `01a0fe72-5247-7331-a264-a4b62ddb126c`、turn
`turn_a768918b44d1417d838ea3a00c502092`，queue/edit、structured/persistent history、Vim/
mentions、resize/reconnect、terminal restore 全部通过；同一 fresh binary 的 CLI Gate B 通过：
thread `01a0fe73-1f71-7a23-9232-2775728acf85`、turn `turn_d26820a6c46a48c5b5f7e155b2d13d9d`，
`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。两者均为受控 external backend，
非 live provider。
本刀未触及 App Server/protocol/runtime/provider/Electron 主链，未宣称 Desktop Gate B；整体 Codex
对齐仍为 `partial / in-progress`，Desktop Gate B 继续 `unverified / harness-blocked`。

下一刀回到 A2 transcript/history contract：优先统一 resume/full transcript、preview 与
incremental pagination 的 canonical lowering/失败语义，继续禁止第二套 history store 和
text-only prompt history。

## 2026-10-03 ChatWidget lifecycle availability owner 第二十一阶段（已完成）

继续清理 runtime/session lifecycle 对 ChatWidget 交互状态的直接赋值。resume picker、agent
picker、agents overview、model picker 的创建/关闭以及 transcript/pager older-history
availability 的写入口统一收回 `chatwidget/interaction.rs` 与 `chatwidget/transcript.rs`；
启动、resume、reconnect、history hydrate 和 Agent Center 只保留 host routing 与 App Server
生命周期委托。`agents_overview_threads.rs` 的 mutable overview 业务 owner 仍按领域保留，
没有用无意义 setter 覆盖真实 owner。

分类：ChatWidget lifecycle/pager availability API 与接线为 `current`；runtime/app 对上述
字段的散落赋值为 `dead / guard-only`；未新增 `compat/deprecated`、协议、schema、provider、
mock backend 或第二 history store。`resume_picker_mut` 只作为真实 picker 业务 owner 的
受控 mutable accessor，不伪装成完整行为迁移。

验证：TUI `1462` library + `18` integration + `1` dependency guard、strict all-target
no-deps Clippy、Rust fmt、结构/inventory `55/55`、`test:contracts` 与
`governance:legacy-report`（2068 文件，零引用候选/分类漂移/边界违规均为 0）通过。该阶段
代码尚未单独产生新的 Gate B 证据，不能复用第二十阶段的 smoke 结果作为本阶段最新证据。

## 2026-10-03 Codex-style asynchronous transcript pagination 第二十二阶段（已完成）

修复 A2 history/transcript 的可见交互缺口：旧实现从 runtime 直接 `await` item page、Turn
enrichment 和全量历史循环，加载期间阻塞键盘、重绘、Esc/退出与 App Server 通知。本刀在现有
`AppEvent` 管道新增 `OlderThreadHistoryLoaded` 与 `OlderHistoryLoadMode`（单页、全量、可视区
补齐），后台 task 只移动克隆的 `RequestHandle`，完成后由主循环校验 thread/cursor、应用
canonical item/Turn 投影、刷新 availability，并按模式继续下一页或进入失败可重试状态。

启动、resize、reconnect 的 underfilled transcript top-up 也改为同一异步事件流；旧的同步
`request_all_older_history_pages`、terminal top-up 入口和滚动内同步 history await 已删除。
App Server 仍是唯一历史事实源，Turn enrichment、review hidden filtering、replay seed、
stale response cancellation 与 cursor repeat 防护保持不变，没有新建 TUI history store 或
text-only fallback。

分类：`AppEvent` history completion、App Server request-handle lowering 和 ChatWidget transcript
projection 为 `current`；同步分页入口为 `dead / deleted / guard-only`；旧 prompt history
事件仍是独立 composer history current owner，不与 Thread transcript 混合。

验证：TUI `1462` library + `18` integration + `1` dependency guard、strict all-target
no-deps Clippy、Rust fmt、`git diff --check`、结构守卫 `56/56`、`npm run test:contracts`、
`npm run governance:legacy-report`（2068 文件、零引用候选/分类漂移/边界违规均为 0）通过。
最新 fresh TUI Gate B 通过：thread `01a0fe90-5b5e-7472-8523-5a5b4126ac65`、turn
`turn_4d2ae218a15f4b379f66073d643baf00`，覆盖真实 PTY、alternate screen、typed input、
queue/edit、structured/persistent history、history/search、resize/reconnect、terminal restore；
同一 fresh binary 的 CLI Gate B 通过：thread `01a0fe91-300a-7161-bafa-1daf90bdecd8`、turn
`turn_0df40b8e2da14165a0e1d2e5e93b1a53`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、
`completion=zsh`。两者均为受控 external backend，非 live provider；Desktop Gate B 仍为
`unverified / harness-blocked`，整体 Codex 对齐保持 `partial / in-progress`。

下一刀继续 A2 canonical history lowering：审计 `thread_transcript` 完整历史、resume picker
preview 与增量分页在失败、Turn filtering、边界锚点和重连后的 read model 是否完全共享同一
投影语义；不恢复旧 composer、第二 history store 或同步阻塞入口。

## 2026-10-03 Resume preview canonical Turn lowering 第二十三阶段（已完成）

补齐 resume picker 的 bounded transcript preview：分页 preview 之前只把局部 item 页交给
`ConversationProjection`，只能依据页内 Entered/ExitedReviewMode 推断状态；跨页 review 或
中断嵌套 review 会与完整 transcript、增量分页产生不同的隐藏用户消息语义。本刀保留
preview 的扫描上限和展示行数，但同时收集 item page 的 canonical turn ids，通过现有
App Server request handle 获取 Turn metadata，再用 `hidden_user_message_ids` + canonical id
过滤后生成 preview；Turn 读取失败时保持已有 item-only fail-closed 展示，不创建第二历史源。

分类：resume preview 的 Turn lowering 与 `thread_transcript`/incremental pagination 共用的
history filter 为 `current`；原 page-local preview 逻辑仅作为无 Turn metadata 的受控降级，
不新增 compat/deprecated owner。新增结构守卫禁止 bounded preview 绕过 Turn facts。

验证：TUI `1463` library + `18` integration + `1` dependency guard、strict all-target
no-deps Clippy、Rust fmt、`git diff --check`、结构守卫 `57/57` 通过。最新 fresh TUI Gate B
通过：thread `01a0fe96-89d1-72d1-92df-0b7ada58ffbf`、turn
`turn_919150b5b80145ac9fc83cf6604e31f9`，覆盖真实 PTY、输入/队列编辑、structured/persistent
history、history/search、resize/reconnect 与 terminal restore；同一 fresh binary 的 CLI Gate B
通过：thread `01a0fe97-3fe9-78b0-a099-7e3dfe796c5f`、turn
`turn_c572eb92021e4a9381cc43e6858e2eee`，`jsonl=ok`、`stdin=ok`、`error-exit=1`、
`completion=zsh`。两者为受控 external backend，非 live provider；Desktop Gate B 仍为
`unverified / harness-blocked`，整体对齐保持 `partial / in-progress`。

下一刀优先验证历史请求失败后的 UI 状态恢复（pager/search retry、stale completion、session
切换）并继续收敛 App Server read model lowering，不恢复旧 composer、第二 history store 或
生产 mock fallback。

## 2026-10-03 History retry/session-race contract 第二十四阶段（已完成）

继续收口历史加载期间的竞态：单页滚动请求尚未完成时触发 Pager/Search 全量加载，旧逻辑会
把 cursor 正在使用误判成不可用，提前把 Loading 重置为 Idle；线程切换或 reconnect 也可能
让旧 completion 覆盖新 surface 的状态。本刀新增 `OlderHistoryLoadStart::{Started,Pending,
Unavailable}`，由 `AppServerSession` cursor owner 区分真实无历史与已有请求；runtime 保留
`history_load_all_requested` 意图，Pending 时不重置 UI，单页 completion 后自动接续全量加载。
线程 resume/switch/reconnect 会清除旧的全量意图，completion 仍先校验当前 Thread/cursor，
失败路径统一进入 Pager/Search Failed 并保留 Home/Enter retry。

分类：cursor pending/result 状态与 retry 意图为 `current`；同步阻塞/无差别布尔判断为
`dead / deleted / guard-only`；没有新增 compat/deprecated、协议、schema、mock backend 或
第二 history store。结构守卫补充 `OlderHistoryLoadStart` 与异步 history owner 约束。

验证：TUI `1463` library + `18` integration + `1` dependency guard、strict all-target
no-deps Clippy、Rust fmt、结构守卫 `57/57`、`git diff --check` 全部通过。最新 fresh TUI
Gate B 通过：thread `01a0ff61-fd3e-7323-a100-93224f817097`、turn
`turn_42fc152a1dbc4b689a68148f28d082db`，覆盖队列编辑、历史搜索/结构化历史、resize/reconnect
和 terminal restore；同一 fresh binary 的 CLI Gate B 通过：thread
`01a0ff62-d9e6-7720-a6f0-c292a5846d9c`、turn `turn_ad252cbce1704e989c8b39177e9a62a4`，
`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`。两者均为受控 external backend，
非 live provider；Desktop Gate B 仍为 `unverified / harness-blocked`，整体对齐保持
`partial / in-progress`。

下一刀继续补充真实失败注入的 PTY 回归，覆盖 item page/Turn enrichment 分别失败、线程切换
期间 stale completion，以及 Pager/Search 的 retry 后 cursor 是否保持可推进。

本阶段同步更新 `internal/aiprompts/architecture.md`，明确 history completion/event flow 与
resume preview lowering 复用 App Server canonical Thread/Turn/Item，不把异步任务或 preview
缓存升级为新的业务 owner。

## 2026-10-03 TUI history failure fixture config contract 第二十五阶段（已完成）

真实 history pagination fixture 在进入 item page 失败注入前，会先通过 remote App Server
transport 启动 TUI。该 fixture 漏掉了 current `config/read` v2 响应，默认分支返回空对象，导致
TUI 在读取 immutable keymap/settings snapshot 时错误退出，掩盖了后续 Home retry、Turn
enrichment 和 stale completion 场景。本刀只补齐 fixture 的 `config/read -> {config, origins}`
响应，不在 TUI 内增加文件读取或 mock fallback；remote transport 仍复用同一 App Server
JSON-RPC/config contract。

分类：`config/read` fixture 响应为 `current test-only` 合同；空对象 fallback 为
`dead / deleted / guard-only`；没有新增 compat/deprecated、协议、schema、生产 mock 或
第二 history store。现有 `history_failure_response` 现在覆盖 initialize、thread/resume、
config/read、thread/items/list 所需的最小公共入口。

验证：fresh `npm run smoke:tui-history-pagination` 通过，paginated `207 items / 3 pages`、
legacy `102 items / 2 pages`，并覆盖 item page failure + Home retry、Turn enrichment 一次失败
后的 item-only fallback、underfilled scrollback top-up、nested review filtering、stale/session
boundary 与 alternate-screen restore（paginated `01a0ff88-676d-7df1-bcef-940bdfb8d19a`，legacy
`01a0ff88-39e8-74a1-895e-a2f1c877cde5`）；
`npm run test:rust:related -- lime-rs/crates/tui/tests/suite/history_pagination.rs` 通过
（CLI 8 + TUI 1463 library tests）；`npm run test:contracts`、
`npm run governance:legacy-report`（2068 文件，零引用候选/分类漂移/边界违规均为 0）、
`npm run inventory:tui-structure`、`npx vitest run scripts/app-server/tui-gate-b.test.mjs`
（23/23，包含 config/read fixture 回流守卫）、workspace Rust fmt 与 `git diff --check` 均通过。
fresh `npm run smoke:tui-gate-b` 通过（thread `01a0ff84-4fa1-7fb0-88cf-e596434c953a`、turn
`turn_c74cf5e05ac94a52b56aa44aabde4fc5`，`history/search`、queue/edit、resize/reconnect、
terminal restore）；同一 fresh binary 的 `npm run smoke:cli-gate-b` 通过（thread
`01a0ff85-21d4-7b03-b1b9-0ebaebcc9529`、turn `turn_100eefe8e2b748c99375622a6fc030c6`，
`jsonl=ok`、`stdin=ok`、`error-exit=1`、`completion=zsh`）。
Desktop Gate B 仍为 `unverified / harness-blocked`；整体 Codex 对齐继续为
`partial / in-progress`。

下一刀继续真实失败注入下的历史 UI 语义审计：分别验证 item page、Turn enrichment、重连和
线程切换后的 retry footer/anchor/cursor；不恢复旧 composer、第二 history store 或生产
mock fallback。

## 2026-10-03 History stale completion PTY boundary 第二十六阶段（已完成）

补齐真实 PTY 下的 history stale completion 边界。新增线程切换 fixture：旧线程的 older-page
请求在用户打开 `/resume` 并切换到另一条 canonical Thread 后才释放，随后验证旧 page item
不会进入新线程 projection，也不会把当前状态改成 `History load failed`。新增重连 fixture：旧
连接在 older-page 请求进行中断开，TUI 通过同一 remote App Server contract 重连并 hydrate
最新 page，验证旧请求失败不会污染重连后的 transcript 或 retry footer；两条场景都断言
alternate screen 恢复。

测试 helper 只扩展现有 `history_pagination.rs` suite 与 PtyLime 的输入 pacing，没有新增
harness、history store、生产 mock 或兼容入口。结构守卫同步要求线程切换/重连测试与 fixture
server 存在，防止失败边界回退为静态单测。

分类：stale completion thread/cursor/surface rejection 与 PTY fixture 为 `current test-only`；
旧同步 history 入口、第二套 projection 与 mock fallback 仍为 `dead / deleted / guard-only`；
GUI/TUI/App Server JSON-RPC/RuntimeCore 共享主链不变。

验证：`npm run smoke:tui-history-pagination` 通过，覆盖 paginated `207 items / 3 pages`、
legacy `102 items / 2 pages`、item page failure + Home retry、Turn enrichment failure fallback、
线程切换 stale completion、重连 stale completion、underfilled top-up、nested review filtering 与
alternate-screen restore；Rust fmt、`git diff --check`、TUI history suite 编译通过；结构守卫
`tui-gate-b.test.mjs` 已补对应测试标记。Desktop Gate B 仍为 `unverified / harness-blocked`，
整体 Codex 对齐保持 `partial / in-progress`。

下一刀继续审计 history search 与 pager retry 在多次 reconnect/切线程后的 anchor/cursor 复用，
再回到 CLI/TUI 输入框和可见状态的 Codex UX 差异；不恢复旧 composer、第二 history store 或
生产 mock fallback。

## 2026-10-03 History search retry/session-race PTY boundary 第二十七阶段（已完成）

补齐主 transcript Find（非 pager overlay）的真实交互证据。此前 history failure/stale
completion 只证明 pager surface；主搜索虽然已有 `SearchHistoryState::{Loading,Failed}` 和
Home/Enter retry 逻辑，却没有经过真实 PTY、remote App Server JSON-RPC 和 alternate screen
的跨层回归。本刀复用现有 `history_pagination.rs` fixture server，不新增 history store、
mock backend 或第二套 harness：新增 item page failure 后保留 Find query/cursor 并用 Home
重试，新增线程切换期间旧搜索 completion 被拒绝，新增 reconnect hydrate 后旧搜索 surface、
query 和 failure state 被清理。所有断言仍以 canonical thread/item projection 和用户可见
footer 为准；PTY fixture 先等待初始 canonical history marker，再用 bracketed-paste 一次性
写入完整 query，避免把启动 hydrate 竞态或逐字输入期间的 bounded scan 误判为 search owner
回归。

分类：主 transcript Find 的搜索状态、retry 和 thread/reconnect 清理为 `current`；旧同步
history 入口、第二套搜索/历史 projection 和生产 mock fallback 仍为 `dead / deleted /
guard-only`；新增 fixture 与结构守卫为 `current test-only`，无 `compat/deprecated`。

验证：fresh `npm run smoke:tui-history-pagination` 通过，覆盖 paginated `207 items / 3
pages`、legacy `102 items / 2 pages`、Pager item page failure + Home retry、Turn enrichment
failure fallback、主 Find failure + Home retry、主 Find 线程切换 stale completion、主 Find
reconnect stale completion、underfilled top-up、nested review filtering 和
alternate-screen restore；`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check` 通过，
历史 suite 编译/执行通过（真实 smoke 中 8 场景），Gate B 结构守卫新增 3 个主搜索场景和
race query 标记。Desktop Gate B 仍为 `unverified / harness-blocked`，整体 Codex 对齐保持
`partial / in-progress`。

下一刀回到 CLI/TUI 输入框、footer 和可见状态的 Codex UX 差异，继续清理旧 composer/重复
surface；不恢复旧 composer、第二 history store 或生产 mock fallback。

## 2026-10-03 FooterProps presentation boundary 第二十八阶段（已完成）

把 footer 的状态收集从底栏 renderer 收回 `ChatWidget`：新增
`chatwidget/footer.rs` 作为唯一 `FooterProps` lowering owner，统一从 ChatWidget、BottomPane
和 canonical turn-running fact 生成 draft、Plan、active-agent、agents shortcut 与 shortcut
toggle 状态；`view.rs` 只把快照传给 `bottom_pane::render_footer`。BottomPane 仅新增窄的
footer 读取接口，输入文本、popup、历史搜索与附件仍由现有 `ChatComposer` 单一 owner 持有。
这与 Codex 的 `FooterProps` / pure footer layout 边界对齐，没有恢复旧 composer、没有新增
compat/deprecated 平行层，也没有改变 GUI/TUI 共享 App Server JSON-RPC、RuntimeCore 和
Thread/Turn/Item projection 的业务主链。

分类：`ChatWidget::footer_props`、纯 footer layout 与窄读取接口为 `current`；旧的 App
直接穿透 composer 推导 footer 状态为 `dead / deleted / guard-only`；没有新增
`compat/deprecated`。结构守卫同步要求 footer renderer 消费 `FooterProps`，并锁定
`chatwidget/footer.rs` owner，防止状态逻辑回流到 view 或 renderer。

验证：`npm run test:rust:related -- lime-rs/crates/tui/src/bottom_pane/footer.rs
lime-rs/crates/tui/src/bottom_pane/composer.rs lime-rs/crates/tui/src/chatwidget/footer.rs
lime-rs/crates/tui/src/view.rs` 通过（CLI 8 + TUI 1463）；`cargo fmt ... -- --check`、
`git diff --check`、`npx vitest run scripts/app-server/tui-gate-b.test.mjs
scripts/app-server/tui-composer-structure.test.mjs` 通过（54/54）；fresh
`npm run smoke:tui-gate-b` 通过，覆盖真实 lime、PTY、alternate screen、输入/排队、history
search、resize、reconnect 与 terminal restore；`npm run governance:legacy-report` 通过
（2068 文件，零引用候选/分类漂移/边界违规均为 0）；结构 inventory guard 同步采用当前
异步 history owner 的 `spawn_older_history_page_load` /
`handle_older_history_page_loaded` 命名并通过（80/80，含 composer/gate/结构三组），未把本轮 footer 代码标为失败；
Desktop Gate B 仍为 `unverified / harness-blocked`，整体对齐保持 `partial / in-progress`。

下一刀继续收口输入框可见状态：对照 Codex `ChatComposer::FooterMode` 与 composer layout，
补齐输入禁用/运行中/弹层/Plan 状态的统一测量与渲染快照；不恢复旧 composer，不把
`RequestUserInputOverlay.composer` 误并入主输入框。

## 2026-10-03 FooterMode snapshot lowering 第二十九阶段（已完成）

继续收口输入框可见状态：将 `FooterMode` 提升为 `bottom_pane::footer` 的共享 presentation
类型，保持 transient mode 的实际状态仍由 `ChatComposer` 持有；新增 `ChatComposer::footer_mode()`
作为唯一有效模式解析入口，按 Codex 的优先级处理历史搜索、Vim 搜索、shortcut overlay、
附件与草稿基态。`ChatWidget::footer_props` 现在传递显式 `mode`，footer renderer 只消费
快照，不再反向探测 composer 是否打开快捷键层；删除无消费者的 `BottomPane::shortcut_overlay_visible`
和 `footer_has_draft` 读取壳，避免恢复旧的双重派生状态。

分类：`FooterMode`、`ChatComposer::footer_mode`、`FooterProps.mode` 与纯 footer renderer 为
`current`；旧的 renderer 直接探测 overlay、`has_draft`/`footer_has_draft` 派生入口为
`dead / deleted / guard-only`；没有新增 `compat` 或 `deprecated`，没有恢复旧 composer、
第二套 history store、生产 mock 或平行业务后端。`RequestUserInputOverlay.composer` 仍为
独立 notes editor owner，不纳入主输入框。

验证：`npm run test:rust:related -- lime-rs/crates/tui/src/bottom_pane/footer.rs
lime-rs/crates/tui/src/bottom_pane/chat_composer/footer_state.rs
lime-rs/crates/tui/src/chatwidget/footer.rs` 通过（CLI 8 + TUI 1463）；Rust fmt、
`npx vitest run scripts/app-server/tui-structure-inventory.test.mjs
scripts/app-server/tui-composer-structure.test.mjs scripts/app-server/tui-gate-b.test.mjs`
通过（80/80）；fresh `npm run smoke:tui-gate-b` 通过，覆盖真实 `lime`、PTY、alternate
screen、queue/edit、history search、Plan/shortcut/resize/reconnect 与 terminal restore，
thread `01a1017c-c1ee-77a0-88a4-076c2ba96ecf`、turn `turn_5b306e66a07f44c2bf5f510c8ae28ab4`。
Desktop Gate B 仍为 `unverified / harness-blocked`，整体 Codex 对齐仍为 `partial /
in-progress`。

下一刀继续补齐 Codex 的 `EscHint`/quit reminder 与运行中禁用态的 footer mode 测量，随后
审计输入框窄宽度、多语言、remote image rows 的统一 snapshot；不把独立问答 notes editor
误并入主 composer。

## 2026-10-03 Footer interaction snapshot lowering 第三十阶段（已完成）

本刀先收口第二十九阶段遗留的 renderer 反向读取：当前 `bottom_pane::footer` 虽已消费
`FooterProps`，但 active approval/user-input footer 仍直接从 `App -> ChatWidget -> BottomPane`
读取，shortcut overlay 关闭文案也在 renderer 侧重新解析 locale/key availability。按 Codex
`FooterProps` 边界，将交互 footer 的已测量 hints 与 shortcut close 文案在 `ChatWidget` 统一
lower 成快照，renderer 只负责宽度内裁剪、清屏和绘制；不改变队列、协议 response、主
`ChatComposer` 或 `RequestUserInputOverlay.composer` owner。

窄写集：`chatwidget/footer.rs`、`bottom_pane/footer.rs`、`bottom_pane/shortcut_overlay.rs`、
`view.rs`、footer/结构回归。退出条件：1) footer renderer 不再读取 App/BottomPane；2) active
interaction 与 shortcut close hints 仍覆盖五语言和窄宽度；3) FooterProps lowering 与
`screen_chunks` 使用同一 width；4) TUI related/all-target、结构守卫、fmt/diff/governance
通过；5) fresh TUI Gate B 保持输入、history、resize、reconnect、terminal restore 通过。
Desktop Gate B 仍不因本刀升级。

实现与验收：`ChatWidget::footer_props(width, ...)` 现在一次性 lowering active interaction
footer hints（approval/user-input）和 shortcut overlay close hint；`bottom_pane::footer` 不再
依赖 `App`、`BottomPane`、`footer_hint_lines` 或 `render_close_hint`，只消费快照并按同一
screen width 做最后裁剪。删除无生产消费者的 `shortcut_overlay::toggle_available` wrapper，
由 `ChatWidget::shortcut_toggle_available` 作为唯一 owner；窄屏 close hint 仍先降级为
`esc close`，避免 renderer 截断成不可执行的 `? / esc cl…`。`RequestUserInputOverlay.composer`
与交互队列 owner 未改变。

分类：`FooterProps` 的 interaction/shortcut presentation lowering、纯 footer renderer 与
窄屏 fallback 为 `current`；旧 footer 反向读取 App/BottomPane、旧 close/toggle wrapper 为
`dead / deleted / guard-only`；没有新增 `compat/deprecated`、第二 history store、生产 mock
或平行业务后端。

验证：`npm run test:rust:related -- lime-rs/crates/tui/src/bottom_pane/footer.rs
lime-rs/crates/tui/src/bottom_pane/shortcut_overlay.rs lime-rs/crates/tui/src/chatwidget/footer.rs
lime-rs/crates/tui/src/view.rs` 通过（CLI 8 + TUI 1463）；`cargo fmt --manifest-path
lime-rs/Cargo.toml --all -- --check`、`git diff --check` 通过；TUI 结构/Composer/Gate 守卫
`80/80`；`npm run test:contracts` 通过（protocol 1036 类型无漂移、命令 299、治理脚本与
docs boundary 全绿）；`npm run governance:legacy-report` 通过（2068 文件，零引用候选、
分类漂移、边界违规均为 0）；fresh `npm run smoke:tui-gate-b` 通过，真实 PTY/alternate
screen、输入/排队、history/Vim search、resize、reconnect、terminal restore 全绿，thread
`01a101a6-5b1c-77c2-9e23-e67dda70eb47`、turn `turn_9b91843008b345c292e798f62eb466fb`。
Desktop Gate B 仍为 `unverified / harness-blocked`，整体 Codex 对齐保持 `partial /
in-progress`。

下一刀继续审计输入框禁用态、popup/status/input 的统一测量以及 remote image rows/cursor
geometry；只有 Lime 存在对应真实交互 owner 时才实现 Codex `EscHint`/quit reminder，不添加
空壳 enum 或兼容层。

## 2026-10-03 Composer input-disabled / remote-image cursor geometry 第三十一阶段（已完成）

按 Codex `ChatComposer` 的 `input_enabled` 语义补齐 Lime 主 composer 的禁用态边界。新增
`DraftState.input_enabled` 与禁用 placeholder，由 `ChatComposer` 统一负责开关、shutdown
presentation、popup 清理和 cursor lowering；`BottomPane` 仅提供窄 host 配置入口，不新增第二个
editor owner。禁用时键盘、paste burst、显式粘贴、断线编辑和鼠标编辑全部 fail closed，现有
rich draft、atomic elements、local/remote attachments 和 per-thread snapshot 保留；渲染使用
同一 `ComposerLayout`，显示 dim prompt/禁用提示并隐藏 cursor。remote image selection 继续
独占 row focus，选中时 cursor 隐藏，Down 返回 textarea 后恢复。

`FooterProps` 同步带 `input_enabled` presentation fact：被禁用的 passive footer 会清屏，交互
请求 hints 仍优先保留，避免 shutdown/reconnect 状态继续显示可执行 shortcuts 或 Plan 提示。

分类：`input_enabled`、禁用态渲染/输入边界、统一 cursor geometry 和 remote-image selection 为
`current`；原先无禁用 guard 的编辑/粘贴/鼠标入口为 `dead / deleted / guard-only`；没有新增
`compat/deprecated`、第二 composer、协议/schema、生产 mock 或平行业务后端。独立
`RequestUserInputOverlay.composer` 未迁移。

验证：composer 定向 181 项通过；`npm run test:rust:related -- lime-rs/crates/tui/src/bottom_pane/chat_composer lime-rs/crates/tui/src/bottom_pane/composer.rs lime-rs/crates/tui/src/bottom_pane/chat_composer/render_tests.rs` 通过（CLI 8 + TUI 1465）；`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、`git diff --check` 通过；TUI 结构/Composer/Gate 守卫 80/80；fresh `npm run smoke:tui-gate-b` 通过，覆盖真实 lime、PTY、alternate screen、输入/排队、history/search、images、resize/reconnect 与 terminal restore，thread `01a101bd-3aa9-7511-9231-fb86f668aa1f`、turn `turn_6f8cf48ea3b34b5ca8ae40848c017386`，同轮 thread-input/typed-input fixture 也通过。Desktop Gate B 仍为 `unverified / harness-blocked`，不以 TUI 证据替代。

下一刀回到 popup/status/input 统一测量：对齐 Codex popup overlay 与 composer desired-height 的裁剪关系，补五语言 CJK/emoji display-width 稳定快照；继续清理无真实 consumer 的旧 wrapper，不恢复旧 composer 或空壳 `EscHint`/quit reminder。

## 2026-10-03 Popup overlay clipping / Unicode width / dead wrapper 第三十二阶段（已完成）

对照 Codex `ChatComposer::render_with_options` 的 overlay 裁剪语义，收敛 Lime popup 的屏幕边界：
`BottomPane::render_popups` 现在接收 transcript surface 的 top 作为唯一 clip top，command/file/skill
popup 共享 `available_above` 计算，避免越过屏幕上界；status、queued-input preview 与 shortcut rows
仍由同一 screen split / composer owner 统一测量，popup 不另起布局。composer 的
desired-height 仍由现有 `ComposerLayout` 提供，不新增第二套测量器。新增五语言 CJK/emoji 与 popup
窄宽度回归，按 Ratatui continuation cell 语义校验实际显示宽度，避免中文/emoji 造成行溢出。

治理清理：删除无生产消费者的顶层 `tui/src/command_popup.rs`、`pending_input_preview.rs`、
`reconnect.rs`、`highlight.rs` 兼容转导及对应 `lib.rs` 模块声明；唯一 owner 分别保留在
`bottom_pane/command_popup.rs`、`bottom_pane/pending_input_preview.rs`、`app/reconnect.rs`、
`render/highlight.rs`，结构守卫明确禁止 wrapper 回流。没有
新增 compat/deprecated、第二 composer、协议/schema、生产 mock 或平行业务后端，独立
`RequestUserInputOverlay.composer` 保持不变。

分类：popup clip geometry、Unicode display-width 回归和 BottomPane owner 为 `current`；顶层
command/pending-input/reconnect/highlight wrapper 为 `dead / deleted / guard-only`；历史 inventory
记录只作为 evidence，不再作为 current owner。主链仍为 `Product Surface -> App Server JSON-RPC -> RuntimeCore ->
Thread/Turn/Item projection`。

验证：popup/Unicode 定向回归 4/4；完整 `npm run test:rust:related -- ...` 为 CLI 8/8、TUI
1468/1468；TUI 结构/Composer/Gate 守卫 81/81；`npm run inventory:tui-structure`、
`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、`git diff --check` 与
`npm run governance:legacy-report`（2068 文件、零引用候选/分类漂移/边界违规）均通过；
`cargo clippy -p tui --lib --no-default-features --no-deps -- -D warnings` 与
`cargo test -p tui --all-targets --no-default-features`（1468 library、23 integration、1
dependency guard）通过。fresh
`npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、App Server stdio、
canonical Thread/Turn/Item、popup 相关输入、history/search、images、resize/reconnect 与
terminal restore；thread `01a101f9-37f3-7400-82f9-3edea3bf59ad`、turn
`turn_a4661d41bc8248c1aeeab3e42839eb15`，`terminal=restored`。Desktop Gate B 继续为
`unverified / harness-blocked`，不以 TUI 证据替代 GUI 验收。下一刀继续检查 popup/footer/input
的统一 owner 以及剩余无真实 consumer 的 wrapper。

## 2026-10-03 Shortcut owner / platform key-label convergence 第三十三阶段（已完成）

完成第三十二阶段后遗留的 wrapper 审计：`shortcut_help.rs` 与 Codex 同名且仍被
`bottom_pane/shortcut_overlay.rs`、`app/agent_center/hints.rs` 的生产路径共同消费，属于
`current` 共享布局 owner，不是可删除的兼容壳；因此没有误删或新增平行实现。移除
`lib.rs` 中误导性的 compatibility delegate 注释，并把 shortcut overlay 与 Agent Center
里散落的固定键位统一收回 `keymap::shortcut_label`，覆盖 Tab/Shift+Tab、Ctrl/Alt、F4、
Ctrl+Space 等显示，平台标签和已有 dispatch 规则保持同一事实源。

分类：`shortcut_help`、`shortcut_label` 和两处 help surface 为 `current`；此前已删除的
顶层 command/pending-input/reconnect/highlight/status wrapper 继续保持 `dead / deleted /
guard-only`；没有新增 `compat/deprecated`、第二 composer、协议/schema、生产 mock 或平行
业务后端。结构守卫新增 current `shortcut_help::group_lines` 断言和 compatibility 注释回流
检查，防止共享 owner 被错误降级为 wrapper。

验证：`npm run test:rust:related -- lime-rs/crates/tui/src/bottom_pane/shortcut_overlay.rs
lime-rs/crates/tui/src/app/agent_center/hints.rs lime-rs/crates/tui/src/keymap.rs` 通过
（CLI 8 + TUI 1465）；`npx vitest run scripts/app-server/tui-composer-structure.test.mjs
scripts/app-server/tui-structure-inventory.test.mjs scripts/app-server/tui-gate-b.test.mjs`
通过（81/81）；`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、
`cargo clippy --manifest-path lime-rs/Cargo.toml -p tui --lib --no-default-features --no-deps
-- -D warnings`、`git diff --check` 通过；`npm run governance:legacy-report` 通过（2068
文件，零引用候选/分类漂移/边界违规均为 0）。删除 `status_indicator.rs` 后的最新 fresh
`npm run smoke:tui-gate-b` 通过：真实 `lime`、PTY、alternate screen、App Server stdio、
canonical Thread/Turn/Item、输入/排队、history/search、images、resize/reconnect 和
terminal restore 全绿，最新 shortcut-label 变更后的 thread `01a10217-8380-7d71-b456-97475c437edb`、turn
`turn_369e796a88ee4edd859f74bfe3ae53c8`，`terminal=restored`。Desktop Gate B 仍为
`unverified / harness-blocked`，整体 Codex 对齐保持 `partial / in-progress`。

下一刀继续沿 Codex status/pending-input presentation 对照，重点检查 interrupt hint 是否与
统一 keymap label、运行中禁用态和 queued preview 共用同一事实源；只有确认存在真实 Lime
owner 才迁移，不恢复旧 composer、兼容 wrapper 或空壳 `EscHint`。

## 2026-10-03 Status timer dead-surface cleanup 第三十四阶段（已完成）

继续审计 status/pending-input presentation：Lime 的状态耗时事实由
`App::active_turn_elapsed` 与 `TurnLifecycleState` 提供，`status_indicator_widget/timer.rs`
只有测试引用，生产 `view.rs` 从未创建或读取 `StatusTimer`。直接删除该脱离构建消费图的死
支线及 `timer_tests.rs`，保留 `StatusIndicatorWidget`、`summary_shimmer` 和现有统一
`screen_chunks` 测量；没有为了对齐 Codex 而恢复第二套 timer 状态机。

分类：`StatusIndicatorWidget`/`summary_shimmer` 与 `TurnLifecycleState` 为 `current`；
独立 `StatusTimer` 文件及测试为 `dead / deleted / guard-only`；没有新增 `compat/deprecated`、
第二 composer、协议/schema、生产 mock 或平行业务后端。inventory 守卫新增 timer 文件负向
断言，防止死 status 支线回流。

验证：`npm run inventory:tui-structure` 刷新 TUI inventory 至 1409 files；
`npm run test:rust:related -- lime-rs/crates/tui/src/status_indicator_widget.rs` 通过
（CLI 8 + TUI 1464）；`npx vitest run scripts/app-server/tui-structure-inventory.test.mjs
scripts/app-server/tui-composer-structure.test.mjs scripts/app-server/tui-gate-b.test.mjs`
通过（81/81）；`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、
`cargo clippy --manifest-path lime-rs/Cargo.toml -p tui --lib --no-default-features --no-deps
-- -D warnings`、`git diff --check` 通过。删除 timer 后 fresh `npm run smoke:tui-gate-b`
仍通过：真实 `lime`、PTY、alternate screen、App Server stdio、canonical Thread/Turn/Item、
输入/排队、history/search、images、resize/reconnect 和 terminal restore 全绿，thread
`01a1021f-71d0-7ea3-8b51-01386222af3f`、turn `turn_aadd8ac94844489ebfaf732f405a6b9f`，
`terminal=restored`。Desktop Gate B 仍为 `unverified / harness-blocked`，整体 Codex 对齐
保持 `partial / in-progress`。

下一刀继续对照 Codex 的 status/pending-input 可见文案与动态快捷键绑定，优先把真实存在的
`Alt+Up` queued-edit hint 纳入统一 `keymap::shortcut_label` 测量；如果协议/运行时没有
pending steer owner，则保持 queue-only 语义，不伪造 Codex 状态。

## 2026-10-03 Status presentation dead API cleanup 第三十五阶段（已完成）

继续收窄 status presentation owner：`StatusIndicatorWidget` 中仅供本文件单测使用的
`update_details`、`set_interrupt_hint`、`status_line` 与 capitalization enum 已改为
`cfg(test)`；未被生产调用的顶层 `render` helper、`update_header` 和
`set_interrupt_hint_visible` 直接删除。生产路径现在只保留 `view.rs` 实际消费的
`render_with_messages`、`desired_height_with_messages`、统一 `lines`/height lowering，避免
测试 setter 演化成第二套 status 控制面。

分类：`StatusIndicatorWidget`、`summary_shimmer`、`TurnLifecycleState` 和 view 的 status
split 为 `current`；`StatusTimer`、旧 status helper/setter 为 `dead / deleted / guard-only`；
没有新增 `compat/deprecated`、第二 composer、协议/schema、生产 mock 或平行业务后端。

验证：`npm run test:rust:related -- lime-rs/crates/tui/src/status_indicator_widget.rs`
通过（CLI 8 + TUI 1464）；`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、
`cargo clippy --manifest-path lime-rs/Cargo.toml -p tui --lib --no-default-features --no-deps
-- -D warnings`、`npm run governance:legacy-report`（Rust 1744 文件、零引用候选/分类漂移/
边界违规均为 0）和 `git diff --check` 通过。最新 fresh `npm run smoke:tui-gate-b` 通过真实
`lime`、PTY、alternate screen、App Server stdio、canonical Thread/Turn/Item、输入/排队、
history/search、images、resize/reconnect 和 terminal restore 全绿，thread
`01a10226-38f4-73a0-9e5a-0892d9471f64`、turn `turn_a306b98f60d74059a3553d161366e9a0`，
`terminal=restored`。Desktop Gate B 仍为 `unverified / harness-blocked`，整体 Codex 对齐
保持 `partial / in-progress`。

下一刀继续检查 queued preview 的 `Alt+Up` 文案是否应由统一 keymap owner lowering；若不引入
真实可配置 binding，则只做显示宽度/五语言快照收口，不恢复 Codex 不存在于 Lime 协议的
pending-steer 假状态。

## 2026-10-04 Queued preview shortcut lowering 第三十六阶段（已完成）

完成 queued preview 遗留的跨平台快捷键收口：`keymap` 现在同时拥有固定 host action 的
`queued_input_edit_matches` 与 `queued_input_edit_shortcut_label`，`app/input_flow.rs` 不再
重复内联 `Alt+Up` 判定；`bottom_pane/pending_input_preview.rs` 通过同一 keymap lowering
展示编辑提示。Locale 只负责五语言句子拼接，移除 `Alt+Up` 硬编码，使 macOS 显示 `⌥↑`、
其他平台显示 `alt+↑`，窄屏仍沿用既有 display-width 截断。真实 PTY 断言按目标平台校验
符号，不依赖测试构建中的固定标签。

分类：queued-edit keymap、Locale lowering、queued preview presentation 与输入 dispatch 为
`current`；原先各处硬编码的快捷键文案为 `dead / deleted / guard-only`；没有新增
`compat/deprecated`、第二 composer、pending-steer 假状态、协议/schema、生产 mock 或平行
业务后端。queue-only 语义保持不变，`RequestUserInputOverlay.composer` 仍是独立 notes editor。

验证：`npm run test:rust:related -- lime-rs/crates/tui/src/keymap.rs
lime-rs/crates/tui/src/app/input_flow.rs lime-rs/crates/tui/src/bottom_pane/pending_input_preview.rs
lime-rs/crates/tui/src/locale.rs lime-rs/crates/tui/src/runtime_pty_tests.rs` 通过（CLI 8 +
TUI 1466，新增五语言窄宽度 queued-edit display-width 回归）；`npx vitest run scripts/app-server/tui-composer-structure.test.mjs
scripts/app-server/tui-structure-inventory.test.mjs scripts/app-server/tui-gate-b.test.mjs` 通过
（81/81）；`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、Clippy `-D warnings`、
`git diff --check` 与 `npm run governance:legacy-report`（2068 文件、Rust 1744 文件、零引用
候选/分类漂移/边界违规）均通过。fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、
alternate screen、App Server stdio、canonical Thread/Turn/Item、queue-edit、history/search、
images、resize/reconnect 与 terminal restore；thread `01a1048b-9429-7161-b627-d35b4348171c`、
turn `turn_5e974ee9c02e43d9a4406dff98539ef1`，`terminal=restored`。Desktop Gate B 仍为
`unverified / harness-blocked`，不以 TUI 证据替代 GUI 验收，整体 Codex 对齐保持 `partial /
in-progress`。

下一刀回到 Codex status/pending-input presentation 与统一测量，继续审计 interrupt hint、运行中
禁用态和 queued preview 的窄宽度组合；只迁移 Lime 已有真实 owner，不恢复旧 composer、兼容
wrapper 或不存在于协议的 pending-steer 状态。

## 2026-10-04 Status interrupt presentation dead-field cleanup 第三十七阶段（已完成）

继续对照 Codex status row 后确认，Lime 的 `StatusIndicatorWidget` 始终显示活动回合的
interrupt hint；`show_interrupt_hint` 只有构造默认值和渲染分支，没有生产 setter、配置来源或
真实 consumer。直接删除该字段与不可达双分支，保留 `interrupt_hint`、本地化文案、测试专用
remap setter 和同一 `lines`/height lowering，不引入 Codex 不存在于 Lime keymap 的空壳
interrupt binding。

分类：`StatusIndicatorWidget`、`interrupt_hint`、`TurnLifecycleState` 与 view status split 为
`current`；`show_interrupt_hint` 字段/分支为 `dead / deleted / guard-only`；没有新增
`compat/deprecated`、第二 composer、pending-steer 假状态、协议/schema、生产 mock 或平行
业务后端。独立 `RequestUserInputOverlay.composer` 保持 notes editor owner。

验证：`npm run test:rust:related -- lime-rs/crates/tui/src/status_indicator_widget.rs
lime-rs/crates/tui/src/view.rs lime-rs/crates/tui/src/view/tests/composer.rs` 通过（CLI 8 +
TUI 1466）；TUI 结构/Composer/Gate 守卫 81/81、fmt、Clippy `-D warnings`、`git diff --check`
均通过；`npm run governance:legacy-report` 通过（2068 文件、Rust 1744 文件、零引用候选/
分类漂移/边界违规）。fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate
screen、App Server stdio、canonical Thread/Turn/Item、queue-edit、history/search、images、
resize/reconnect 与 terminal restore；thread `01a104b9-6f8b-7882-aa95-1e2871183071`、turn
`turn_beee82d2def44384a2d2a6c72ebdafea`，`terminal=restored`。Desktop Gate B 仍为
`unverified / harness-blocked`，不以 TUI 证据替代 GUI 验收，整体 Codex 对齐保持 `partial /
in-progress`。

下一刀继续检查 status/pending-input 在 request-user-input、approval 和 disabled composer
之间的统一 footer/shortcut lowering；只收敛真实 owner，优先删除无生产 consumer 的 fallback
分支和重复测量。

## 2026-10-04 Interactive footer lowering convergence 第三十八阶段（已完成）

继续收口 Codex 风格的 pending-input presentation：approval 与 request-user-input 之前各自
维护一份窄屏 primary action fallback，导致同一套提交/取消语义在不同 overlay 上可能出现不同
的降级顺序。新增 `bottom_pane::fit_primary_action_hint` 作为共享 lowering owner，统一候选顺序
为完整本地化文案、`Enter · Esc`、`↵ · Esc`、`↵Esc`、`Esc` 和空字符串；approval 与
request-user-input 只保留各自真实的 content width 边界（approval 仍扣除自身缩进，request-user-input
使用调用方传入宽度）。

request-user-input 的 notes editor 继续是独立 `RequestUserInputOverlay.composer` owner；disabled
composer 仍由 `FooterProps.input_enabled` 清理被动 footer，不引入 approval/input 的第二套 composer
或虚假的 Codex pending-steer 状态。3 列 request-user-input 回归中曾因过度压缩导致 `Esc` 丢失，
已通过共享候选序列修复，并补齐 approval/request-user-input 超窄宽度与五语言显示宽度断言。

分类：共享 primary-action footer lowering、approval/request-user-input footer presentation 与
disabled composer 清空语义为 `current`；两处重复 fallback 为 `dead / deleted / guard-only`；无新增
`compat/deprecated`、协议/schema、生产 mock、平行业务后端或旧 composer 入口。

验证：`cargo fmt --manifest-path lime-rs/Cargo.toml --all -- --check`、TUI Clippy
`-D warnings`、`git diff --check`、TUI 结构/Composer/Gate 守卫 `81/81` 和
`npm run governance:legacy-report`（扫描 2068 文件、Rust 1744 文件，零引用候选/分类漂移/边界违规
均为 `0`）通过；相关 TUI/CLI 定向测试与 footer 超窄回归通过。fresh
`npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、App Server stdio、canonical
Thread/Turn/Item、queue/edit、history/search、images、resize/reconnect 与 terminal restore；thread
`01a104c2-2eb4-7502-a6e5-1dd275889dd2`、turn `turn_af166d322c4d491cabf24cf3de83a700`，
`terminal=restored`。

Desktop Gate B 继续为 `unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex
对齐仍为 `partial / in-progress`。下一刀继续审计 MCP elicitation、disabled composer 与普通
footer 的 key-label/width owner 是否存在真实重复，只在确认 current consumer 后收口，不恢复旧
composer、兼容 wrapper 或不存在于协议的状态。

## 2026-10-04 Shutdown composer dead-wrapper cleanup 第三十九阶段（已完成）

沿 disabled-composer 审计继续清理旧入口：`BottomPane::show_shutdown_in_progress` 与
`ChatComposer::show_shutdown_in_progress` 在生产、测试和 Gate B 构建图都没有消费者，只会把
历史的 “Shutting down...” 文案路径作为不可达第二套输入控制面保留下来。直接删除这两个 dead
wrapper；`set_composer_input_enabled` / `set_input_enabled` 仅由 disabled-footer 单测使用，收为
`cfg(test)`，生产仍由 current `FooterProps.input_enabled` 读取真实 composer 状态并清空被动 footer。

分类：`ChatComposer.input_enabled`、`FooterProps.input_enabled` 与 disabled footer rendering 为
`current`；shutdown wrapper 与未使用的生产 setter 为 `dead / deleted / guard-only`；无新增
`compat/deprecated`、第二 composer、协议/schema、生产 mock 或平行业务后端。结构守卫新增不可达
shutdown wrapper 回流断言。

验证：Rust related CLI `8/8`、TUI `1466/1466` 通过；Rust fmt、Clippy `-D warnings`、
`git diff --check` 通过；TUI 结构/Composer/Gate 守卫 `82/82` 通过；
`npm run governance:legacy-report` 扫描 2068 文件、Rust 1744 文件，零引用候选/分类漂移/边界违规
均为 `0`。fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、App Server
stdio、canonical Thread/Turn/Item、queue/edit、history/search、images、resize/reconnect 与 terminal
restore；thread `01a104c9-8062-7d90-b7aa-428d48fb63b3`、turn `turn_a23cd48d9234482ca1f922c42e36187b`，
`terminal=restored`。

Desktop Gate B 仍为 `unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex
对齐仍为 `partial / in-progress`。下一刀继续审计 MCP elicitation 的 footer compacting 是否能
复用同一 display-width/primary-action lowering owner；若语义确有差异则保持独立 current owner，
只删除确认无消费者的 fallback。

## 2026-10-04 Turn lifecycle dead-state cleanup 第四十阶段（已完成）

继续审计运行中状态后确认，`TurnLifecycleState` 的 current owner 只有
`agent_turn_running`、`last_turn_id`、`active_turn_started_at` 以及 projection transition/elapsed
lowering。`budget_limited_turn_ids`、`mark_budget_limited`、`take_budget_limited` 和
`rendered_completion_turn_ids` 在生产代码、App Server 投影、TUI/CLI Gate B 中均无消费者，只由
自身单测维持，属于预建的 Codex/旧 runtime 状态空壳。直接删除字段、清理逻辑和正向测试，避免
为 Lime 协议没有的 budget/completion 控制面保留第二套状态机。

分类：ChatWidget `TurnLifecycleState` running/elapsed projection 为 `current`；budget-limited 与
rendered-completion dead fields/methods/tests 为 `dead / deleted / guard-only`；无新增
`compat/deprecated`、协议/schema、生产 mock、平行业务后端或旧 composer 入口。结构守卫补充
四个 dead symbol 的负向回流断言。

验证：Rust related CLI `8/8`、TUI `1465/1465` 通过；Rust fmt、Clippy `-D warnings`、
`git diff --check`、TUI 结构/Composer/Gate 守卫 `82/82` 通过；精确 PTY 回归
`real_pty_restores_terminal_after_visible_turn_completion` 通过。fresh
`npm run smoke:tui-gate-b` 最终通过真实 `lime`、PTY、alternate screen、App Server stdio、canonical
Thread/Turn/Item、queue/edit、history/search、images、resize/reconnect 与 terminal restore；thread
`01a104d4-efdb-7d00-b201-90311f10681b`、turn `turn_dd7bdd00b6274e6f96574f9f11191dd9`，
`terminal=restored`。中间一次失败仅为并发构建锁/超时，复跑已确认产品测试通过。

Desktop Gate B 仍为 `unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex
对齐仍为 `partial / in-progress`。下一刀继续回到 MCP elicitation footer 与普通 footer 的
primary-action/width owner 审计，只有真实重复或无消费者才做删除/重构。

## 2026-10-04 Replay filter dead-code exemption cleanup 第四十一阶段（已完成）

继续清理迁移残留后确认，`app/replay_filter.rs` 的
`snapshot_has_pending_interactive_request` 与 `event_is_notice` 都由
`app/thread_events.rs` 的生产回放路径真实消费，之前保留的
`#[cfg_attr(not(test), allow(dead_code))]` 已经失真。删除两处豁免并增加结构守卫，保持 replay
authority 仍在既有 ThreadEventSnapshot/notification projection owner，不新增 replay store、旁路
状态或兼容包装。

分类：replay filter 的 pending-interaction/notice lowering 为 `current`；过时 dead-code 豁免为
`dead / deleted / guard-only`；无新增 `compat/deprecated`、第二 composer、协议/schema、生产
mock 或平行业务后端。

验证：Rust related CLI `8/8`、TUI `1465/1465` 通过；Rust fmt、Clippy `-D warnings`、
`git diff --check`、TUI 结构/Composer/Gate 守卫 `82/82` 通过。fresh
`npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、App Server stdio、canonical
Thread/Turn/Item、queue/edit、history/search、images、resize/reconnect 与 terminal restore；thread
`01a104da-0e0f-7902-8490-b23d96d00c58`、turn `turn_399498afcf8b47cea37ce41a3536715f`，
`terminal=restored`。治理扫描仍为 2068 文件、Rust 1744 文件，零引用候选/分类漂移/边界违规均
为 `0`。

Desktop Gate B 继续为 `unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex
对齐仍为 `partial / in-progress`。下一刀回到 MCP elicitation footer 与普通 footer 的
primary-action/width owner 审计，若没有严格重复则保持两个 current surface 的语义边界。

## 2026-10-04 Agent navigation dead-method cleanup 第四十二阶段（已完成）

继续审计 ChatWidget 的 Agent navigation owner：`AgentNavigationState` 只需要
`upsert/record_sub_agent_activity/mark_running/mark_stopped/mark_closed`、有序列表、相邻线程和
当前 agent label；`set_agent_path`、`clear`、`remove`、`ordered_path_backed_subagent_threads` 以及
`is_empty` 均无生产消费者，之前被整个 impl 的 `#[allow(dead_code)]` 隐藏。直接删除这些旧 API 和
豁免，保留 Agent Center/Thread events/ChatWidget footer 当前真实消费链；不新增第二套导航 store
或跨线程删除旁路。

分类：`AgentNavigationState` current navigation/liveness/label owner 为 `current`；四个无消费者
方法与过时 dead-code 豁免为 `dead / deleted / guard-only`；无新增 `compat/deprecated`、协议/schema、
生产 mock、平行业务后端或旧 composer 入口。结构守卫补充五个 dead symbol 的负向回流断言。

验证：Rust related CLI `8/8`、TUI `1465/1465` 通过；Rust fmt、Clippy `-D warnings`、
`git diff --check`、TUI 结构/Composer/Gate 守卫 `82/82` 通过。fresh
`npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、App Server stdio、canonical
Thread/Turn/Item、Agent Center、queue/edit、history/search、images、resize/reconnect 与 terminal
restore；thread `01a104df-87c0-7472-ba10-0d141930f605`、turn `turn_d204aadd70944b6c973fc7addedc7b81`，
`terminal=restored`。治理扫描仍为 2068 文件、Rust 1744 文件，零引用候选/分类漂移/边界违规均
为 `0`。

Desktop Gate B 继续为 `unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex
对齐仍为 `partial / in-progress`。下一刀继续审计 MCP elicitation footer 与普通 footer 的
primary-action/width owner，优先处理真实重复或无消费者的 fallback，不扩展协议没有的状态。

## 2026-10-04 MCP overlay footer ownership cleanup 第四十三阶段（已完成）

确认 MCP elicitation 的控制提示已经由其自身 overlay 内容负责渲染；外层普通 footer 之前因
`interaction_hint_lines=None` 继续显示全局 composer 快捷键，形成重复 footer 和竞争焦点。将
`FooterProps.interaction_hint_lines` 的 `Some(empty)` 明确定义为清空外层 footer 的 presentation
projection，MCP current owner 返回该空投影；普通 composer 继续使用 `None` 的既有策略。补充
footer renderer 与 BottomPane projection 回归，未改 MCP 协议、locale controls 或独立 notes
editor，也未新增 compat/deprecated wrapper。

分类：MCP overlay 控制提示与 outer-footer blanking 为 `current`；MCP 下误显示的全局 footer
路径为 `dead / deleted / guard-only`；没有新增 `compat/deprecated`、第二 composer、生产 mock
或平行业务后端。

验证：Rust related CLI `8/8`、TUI `1467/1467`；Rust fmt、TUI Clippy `-D warnings`、
`git diff --check`、TUI 结构/Composer/Gate 守卫 `82/82` 和
`npm run governance:legacy-report`（2068 文件、Rust 1744 文件，零引用候选/分类漂移/边界违规
均为 `0`）通过。fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、
App Server stdio、canonical Thread/Turn/Item、queue/edit、history/search、images、
resize/reconnect 和 terminal restore；thread `01a1055a-e0cc-7d90-85ac-c2538194b436`、
turn `turn_04ffb4db03aa42cbb90ba523df04f061`，`terminal=restored`。Desktop Gate B 仍为
`unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex 对齐保持
`partial / in-progress`。下一刀继续检查 MCP/approval/request-user-input 的动态 keymap owner
与显示 hint 是否仍存在真实硬编码，优先迁移已有 current keymap，不伪造协议外状态。

## 2026-10-04 MCP select keymap dispatch convergence 第四十四阶段（已完成）

继续对照 Codex 的 `ListKeymap` owner：MCP elicitation 之前只把 `RuntimeKeymap` 传给文本
编辑器，select 字段仍由 `Enter`、`Esc`、`↑/↓`、`j/k` 的局部 `match` 直接处理。新增
`ListKeymap`/`KeyChordMatcher` 快照到 MCP overlay，select 的 accept、cancel、上下移动以及
自定义左右字段导航现在统一经过 current keymap dispatch；Ctrl-C 的清稿/取消边界与文本编辑器
仍保持独立。未把 list keymap 套到 notes editor，也未伪造新的 submit binding 或协议状态。

分类：MCP select keymap snapshot/dispatch 与字段导航为 `current`；select 内原有的 Enter/Esc/
↑↓/j/k 直接分支为 `dead / deleted / guard-only`；没有新增 `compat/deprecated`、第二
composer、生产 mock 或平行业务后端。

验证：Rust related CLI `8/8`、TUI `1468/1468` 通过；覆盖 MCP select 自定义 F10/F11/F12
导航/取消/确认以及既有 Ctrl-C 边界；fmt、Clippy `-D warnings`、TUI 结构/Composer/Gate 守卫
`82/82`、`git diff --check` 和 `npm run governance:legacy-report`（2068 文件、Rust 1744 文件，
零引用候选/分类漂移/边界违规均为 `0`）通过。fresh `npm run smoke:tui-gate-b` 通过真实
`lime`、PTY、alternate screen、App Server stdio、canonical Thread/Turn/Item、queue/edit、
history/search、images、resize/reconnect 和 terminal restore；thread
`01a10569-503f-7260-ab58-3f4f0ca9e431`、turn `turn_04673f396d0f4afd8546c5f0f8438f1811`，
`terminal=restored`。下一刀继续把 MCP 与 request-user-input 的可见 hint 迁移到
同一 keymap snapshot，消除“实际按键已可配置但 footer 仍显示 Enter/Esc”的事实漂移。

## 2026-10-04 Interactive overlay keymap-hint convergence 第四十五阶段（已完成）

继续收口第四十四阶段留下的 footer 事实漂移：MCP select 已经使用 `ListKeymap` 派发，但其
footer 仍由 locale 固定拼接 `Enter/Esc/↑↓`；request-user-input 的选项焦点则同时使用固定
按键处理和固定 footer，备注编辑时还会继续显示不适用的左右切题提示。两个 overlay 现在都
在创建/恢复时接收同一 `RuntimeKeymap` snapshot：request-user-input 的选项焦点通过
`ListKeymap` 派发 accept/cancel、上下移动和左右切题；MCP select 的左右/分页字段导航也
通过相同 owner，Tab 与文本 editor 仍保留各自真实的固定边界。

footer lowering 改为从实际 snapshot 生成 key label，再交给既有五语言 locale label 和共享
窄屏 projection；未绑定 action 不再伪造默认键，custom `f9/f10/f11/f12` 不会在窄屏压缩时
错误降级为 Enter/Esc。request-user-input 在 notes editing 时只显示真实 Enter/Esc/Tab，
不再宣称左右键能切题。旧固定 `request_*_hint()` 与 `mcp_elicitation_controls()` locale
组合 helper 直接移除，无新增 compat/deprecated、协议/schema、mock 或平行业务后端。

分类：RuntimeKeymap 到 interactive overlay 的 snapshot 接线、动态 dispatch 和 footer
projection 为 `current`；overlay 内固定 Enter/Esc/↑↓/左右的重复分支与固定 locale controls
组合为 `dead / deleted / guard-only`；独立 notes composer/editor 仍为 `current`，没有恢复旧
composer。结构守卫增加 request keymap snapshot/dispatch 与动态 hint 断言，并保留 MCP 外层
footer blanking 的既有回归。

验证：request-user-input 定向 37/37、MCP 定向 17/17；TUI library `1471/1471`；TUI
Clippy `--all-targets --no-deps -D warnings`、Rust fmt、`git diff --check`；结构/inventory/
Gate 脚本 `82/82`；`npm run governance:legacy-report` 扫描 2068 文件、Rust 1744 文件，零引用
候选/分类漂移/边界违规均为 `0`。fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、
alternate screen、App Server stdio、canonical Thread/Turn/Item、queue/edit、history/search、
images、resize/reconnect 与 terminal restore；thread `01a1059d-16cb-72e0-afa7-f6a1bba4c003`，
turn `turn_3b46fa5f26de44519065247bddc8fcb7`，`terminal=restored`。

Desktop Gate B 仍为 `unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex
对齐仍为 `partial / in-progress`。下一刀回到 approval/MCP/request-user-input 三类 overlay
是否共享同一 primary-action width owner 的剩余重复审计，或继续收敛 CLI/TUI 其它固定 key label；
不恢复旧 composer、兼容 wrapper 或协议外状态。

## 2026-10-04 Approval overlay keymap/footer convergence 第四十六阶段（已完成）

继续收口三类 interactive overlay 的 Codex keymap owner：Approval overlay 之前仍由固定
`Enter`/`Esc` 分支驱动确认/取消，footer 也固定显示同一组按键。现在 Approval 与 MCP/request-user-input
一样接收启动时的 `RuntimeKeymap` snapshot，通过 `ListKeymap` dispatch 上下移动、确认和取消，footer
从实际 accept/cancel binding lowering；未绑定动作不再恢复隐藏的 Enter/Esc 默认行为，`y`/`n` 专属
快捷动作和 Ctrl-C 取消边界保持不变。Gate B approval PTY 回归同步改为断言 fixture 配置的
`f9 confirm · ctrl+x q cancel`，不再把旧固定文案当成 current 合同。

分类：Approval `ListKeymap` snapshot/dispatch、动态 action footer 与 request/MCP 的统一接线为
`current`；Approval 内固定 Enter/Esc 控制和 PTY 固定 footer 断言为 `dead / deleted / guard-only`；
无新增 `compat/deprecated`、协议/schema、生产 mock、平行业务后端或旧 composer 入口。

验证：Approval 定向 `22/22`、request-user-input `37/37`、MCP `17/17`，TUI library `1472/1472`；
TUI Clippy `-D warnings`、Rust fmt、`git diff --check`、结构/inventory/Gate 守卫 `82/82` 通过；
`npm run governance:legacy-report` 保持扫描 2068 文件、Rust 1744 文件，零引用候选/分类漂移/边界
违规均为 `0`。fresh `npm run smoke:tui-gate-b` 在 Approval PTY 断言同步后通过真实 `lime`、PTY、
alternate screen、App Server stdio、canonical Thread/Turn/Item、queue/edit、history/search、images、
resize/reconnect 与 terminal restore；thread `01a105b1-0fe7-7943-9591-5642d8824755`、turn
`turn_135863ceab1f4092bac4dd01a65eedf9`，`terminal=restored`。

Desktop Gate B 仍为 `unverified / harness-blocked`，不能用 TUI 证据替代 GUI 验收；整体 Codex
对齐仍为 `partial / in-progress`。下一刀继续审计 CLI/TUI 其它 overlay 与 picker 的固定 key label
和窄屏 lowering，只迁移已经存在的 current keymap owner，不恢复旧 composer、兼容 wrapper 或协议外
状态。

## 2026-10-05 Atomic interactive footer hints 第四十七阶段（已完成）

主目标仍为 GUI/TUI 共用底层的 Codex 功能、命名、目录与 UI/UX 对齐。对照 Codex
`footer_hint.rs` 的完整 hint 选择与整项排布，本轮修复 Approval/request-user-input 窄屏共享 helper
仍硬编码 Enter/Esc、解除绑定后 request footer `.skip(2)` 误删导航、MCP 按本地化字符串识别
动作并截断组合键的问题。新增回归已证明前两项失败；前序第四十五/四十六阶段的动态窄屏完整性
结论不覆盖这些场景，必须由本轮 fresh evidence 补齐。

窄写集：TUI `footer_hint` owner、lib 接线、三个 interactive footer 的 presentation lowering、
locale key 显示 owner、定向 keymap/footers 回归、既有 Approval PTY 夹具、结构守卫及本计划。
已有 release 执行计划改动避让；App Server/GUI/runtime/protocol/provider/持久化保持只读。
退出条件：1) 绑定、单侧/双侧解绑在五语言和窄屏上真实显示；2) 组合键保持完整，不能伪造默认
键或显示半个 chord；3) 解除主操作绑定不丢导航，MCP 无本地化文案解析；4) Rust related、fmt、
Clippy 与结构守卫通过；5) 真实 Approval 窄屏 PTY 与 fresh TUI Gate B 通过。仅满足本切片
退出条件时标完成，不代表整体 Codex 对齐率。此刀仅收敛 TUI presentation helper，不改变共享
业务边界或增加第二后端。

实现：新增 Codex 同名 `tui/src/footer_hint.rs`，以 `ShortcutHint` 分离实际 key 与本地化文案，
`first_fitting_line` 只选择可完整显示的候选，`wrap_hint_rows` 以整项排布；Approval、
request-user-input、MCP 共用此 owner。request 主操作与次要导航分别构造，删除 `.skip(2)`；
MCP 删除 `contains_submit_hint/contains_cancel_hint/compact_control_segment`，不再解析翻译或
截断 chord，单侧左右字段绑定也真实显示。删除旧 `fit_primary_action_hint` 与没有生产消费者
的 `approval_controls`，同步 locale、测试与结构守卫。五语言回归覆盖窄屏、函数键、完整组合键、
主操作单侧/双侧解绑以及导航保留；不强行把 Codex 自身独立的 slash/file/skill completion
输入边界迁成普通 `ListKeymap`。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；
`codex-rs/tui/src/footer_hint.rs` SHA256
`25711ac66254caeb48db58e07cc4d5aa697be6ecdc70858a7ff26c3402f76a20`。
`npm run inventory:tui-structure` 已更新两侧源码 inventory，共 1410 文件。

验证：bottom-pane 定向 `418/418`；最终 Rust related CLI `8/8`、TUI `1475/1475`；
Rust fmt、TUI Clippy `--all-targets --no-deps -D warnings`、结构/inventory/Gate 守卫 `83/83`
及修改脚本的 Prettier/ESLint 均通过；inventory 更新后额外确认其守卫 `26/26` 通过。
`npm run governance:legacy-report` 扫描 2068 文件、Rust 1745 文件，零引用候选/分类漂移/边界
违规均为 `0`。最终审阅确认旧 helper 无生产引用，仅负向守卫与历史计划保留名称；
`git diff --check` 通过。

fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、键盘输入、
App Server stdio 与 canonical Thread/Turn/Item 投影，覆盖 queue/edit、history/search、images、
resize/reconnect 和 terminal restore。新增 Approval 场景证明解绑的 Enter 不批准请求，18 列
仍显示完整 `f9 · ctrl+x q`，恢复 100 列后由配置的 F9 批准；thread
`01a10b41-231e-7400-9d0a-a52ac06f9db2`、turn `turn_8c3c161ae72f4e3d91fb0538b3d52c37`，
`terminal=restored`。使用受控 external fixture backend，不调用 live provider。

分类：共享完整 shortcut hint owner 与三个交互面板的 keymap presentation 为 `current`；旧
固定默认键回退、文案识别/组合键截断 helper 和位置式 `.skip(2)` 为
`dead / deleted / guard-only`；无新增 `compat/deprecated`、旧 composer、生产 mock 或第二后端。
遵循 DRY 收敛真实重复，以独立语义 owner 保持单一职责，不为未发现的差异预建抽象。

本切片退出条件全部满足，完成度 `100%`；整体 Codex 对齐保持 `partial / in-progress`，没有
可核验的统一分母，不能据本轮推算总体百分比。Desktop Gate B 继续为
`unverified / harness-blocked`；GUI、Windows 与 live provider 未由本轮证明。
下一刀回到其它 picker/overlay 的固定 key label、组合键与窄屏显示审计，优先修复实际派发和
显示不一致的 current 路径，再清退重复 helper；继续保持 GUI/TUI 共享业务主链。

## 2026-10-05 Footer measurement/render convergence 第四十八阶段（已完成）

主目标继续为 GUI/TUI 共用底层的 Codex CLI/TUI 全面对齐。本轮发现普通/interactive footer
测量已扣缩进，paint 再扣缩进后又把缩进拼入内容，导致边界宽度上完整 hint 被省略号截断；
passive agent context 无宽度选择就追加 key label，Vim indicator 也在候选选择后追加，可能裁断
真实组合键；shortcut close helper 在短候选仍溢出时直接返回该候选。对照 Codex footer 的
`inset_footer_hint_area` 与完整候选选择，修正同一 current presentation owner 的布局合同。

窄写集：`bottom_pane/footer.rs`、`approval_render.rs` 与其定向测试、`shortcut_overlay.rs` 与
其测试、`chatwidget/footer.rs` 接线、既有 footer_hint owner（仅必要复用）、结构守卫、inventory
及本计划；`bottom_pane/mod.rs` 导出、`view.rs` footer 高度测量与既有 Approval PTY 夹具同步
消费同一内容区域，真实窄屏回归收紧到刚好容纳组合键的 14 列。
`width.rs` 中已无生产消费者的旧 content-width helper 与专属测试直接删除，并补回流守卫。
release 执行计划继续避让；共享 App Server/runtime/protocol/provider/GUI 与持久化
只读。不恢复旧 composer 或新增 compat；本轮不是共享业务架构变更。

退出条件：1) 实际 painted footer 在五语言的刚好可容纳宽度保留完整提示；2) interactive
shortcut 与 close hint 不发生半个 chord/默认键回退；3) Agent context 和 Vim 组合不会把实际
快捷键挤断，passive copy 可以按宽度裁剪；4) 定向/related Rust、fmt/Clippy、结构守卫与治理
通过；5) fresh TUI Gate B 证明真实 PTY/stdio/canonical projection 与 terminal restore。

实现：新增 Codex 同名 `inset_footer_hint_area` 到既有 footer owner，ChatWidget props、view
footer 高度测量、shortcut overlay 的测量/paint 统一消费同一 content rectangle。普通与
interactive footer 不再把缩进拼进 hint 后再次扣减宽度；Approval helper 接收实际内容宽度，
解除额外预留。interactive/close hint 只绘制完整候选，shortcut close 在完整本地化提示、
`esc` 裸键、空行间选择，不能返回溢出字符串。Vim context 在选择 action hint 前预留实际宽度；
passive Agent label 允许裁剪，但附加 agents hint 只能完整显示，不显示部分组合键。
两个无生产消费者的 `usable_content_width/usable_content_width_u16` 与两条专属测试直接删除；
Clippy 首次指出的 dead-code 已收掉，无 dead-code 豁免或替代包装。

先增加五条真实 TestBackend/close-hint 回归，原实现全部失败：包括 `ctrl+x q` 在 9 列总宽
被画成 `ctrl+x…`、五语言快捷键提示刚好容纳仍被截断、Agent context 的半条 hint、Vim
附加后的边界溢出及 close hint 返回溢出字符串。修复后 bottom-pane 定向 `423/423` 通过；
清理两个旧 width helper 专属测试后最终 related CLI `8/8`、TUI `1478/1478`，
结构/inventory/Gate 守卫 `84/84`、Clippy `--all-targets --no-deps -D warnings`、Rust fmt、
修改脚本的 Prettier/ESLint 与 `git diff --check` 均通过。源码 inventory 已更新为 1410 文件。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；
`codex-rs/tui/src/bottom_pane/footer.rs` SHA256
`101110f738896098133ea1d7c951356a2c3d21584ace96f6e796cad7fa88da62`。

最终治理扫描 2068 文件、Rust 1745 文件，零引用候选/分类漂移/边界违规均为 `0`。
fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、键盘输入、App Server
stdio 和 canonical Thread/Turn/Item projection，包含实际运行的 14 列 Approval 回归、队列/
编辑、Agent Center、thread draft、history/search、Vim/editor keymap、图片、resize/reconnect
与 terminal restore；thread `01a10b52-0d59-7782-9bfc-26a7d625ad3b`、turn
`turn_20a8007581ca4665a09c9ef833579e2d`，`terminal=restored`。Approval 在 14 列完整绘制
`f9 · ctrl+x q`，解绑的 Enter、详情开关和 resize 均不产生 `actionRespond`，恢复 100 列后
由实际配置的 F9 完成批准；本轮使用受控 external fixture backend，不调用 live provider。

分类：统一 footer content rectangle、实际宽度候选选择和上下文预留为 `current`；重复扣减/
拼接缩进、溢出 close hint 回退以及两个无消费者 width helper 为
`dead / deleted / guard-only`；无新增 `compat/deprecated`、第二 composer 或平行业务后端。
以 DRY 收敛测量/paint 的真实重复，以既有 FooterProps 的单一职责隔离 presentation 与业务。
本切片退出条件全部满足，完成度 `100%`；整体仍为 `partial / in-progress`，不能从切片测试
数推算总体对齐率。Desktop Gate B 保持 `unverified / harness-blocked`；本轮仅证明 macOS TUI
与受控 fixture，未证明 GUI、Windows 或 live provider。

下一刀继续回到 `ListSelectionView`/Agent Center 的独立 footer 候选与普通 composer 显示
差异，审计多 stroke 快捷键是否仍被拼成含混序列、单侧解绑是否提前命中空候选；只按真实
消费者迁入共享完整 hint owner，保留 picker 和 completion 各自输入语义，不增加长期兼容层。

## 2026-10-05 Picker atomic shortcut hints 第四十九阶段（已完成）

主目标继续为 GUI/TUI 共用底层的 Codex CLI/TUI 功能、命名、目录与 UI/UX 对齐。本轮审计
`ListSelectionView` 与 Agent Center footer：前者在窄屏候选用空格合并两个 chord，显示成含混
连续序列；后者主操作解绑时空 essential 候选提前命中，遮蔽仍可执行的 help/new key；空列表
仍显示无实际动作的 accept/select hint。共享 interactive primary helper 也需要在取消 chord
放不下时继续尝试较短的 accept，不能由空取消候选终止选择。

窄写集：`footer_hint.rs`、`bottom_pane/list_selection_view.rs`、`app/agent_center/hints.rs`、
`locale/pickers.rs` 与其测试消费者，Agent/Model picker、Agent Center 和 interactive keymap
回归，既有 picker PTY 夹具、结构守卫、inventory 与本计划。release 执行计划改动继续避让；
共享 App Server/runtime/protocol/provider/GUI/持久化只读。不新增 composer、compat 或第二后端。

退出条件：1) 多语言 footer 的 chord 始终完整且两个动作有明确分隔；2) 主动作单侧/双侧解绑
不会伪造按键，仍可执行的 secondary hint 不被空候选遮蔽；3) 空列表不提示不可执行的选择，
真实派发保持不变；4) 复用 Codex 同名完整候选/shortcut 样式 owner，清退重复 locale 组合 API；5) 定向/related Rust、fmt/Clippy、结构守卫/治理与 fresh TUI Gate B 通过。

实现：Codex 同名 `footer_hint::shortcut` 统一 key token 与本地化 label 的样式，
`first_fitting_line` 跳过空候选并用实际 display width 选择整项。ListSelectionView 删除无分隔
的 `keys.join(" ")` 降级，移除 footer paint 的二次 ellipsis 裁剪；空 Agent/Model 列表不显示
无消费者的 accept hint。Agent Center 删除本地 `.find(line.width)` 排布，将当前选中行/
input mode/分页加载事实用于 accept hint；空结果不宣称 open/move，正在加载的 Show more
不宣称确认，NewTask/可执行分页操作保持可见，Show more 文案沿用既有五语言标签。
主操作解绑时仍选择真实可执行的 help/new key。interactive primary helper 在 cancel chord
放不下时继续选择完整 accept，取消仍优先。locale 的 `selection_picker_footer` 组合 API
已删除，迁入 `picker_select_label/picker_back_label`，所有生产与测试消费者直接迁移。

原实现四条回归全部失败；补充 Agent Center 空结果/分页/input 回归也失败，已由 current
presentation owner 修复。验证：picker 定向 `115/115`、footer 定向 `46/46`；最终 related
CLI `8/8`、TUI `1485/1485`；结构/inventory/Gate 守卫 `85/85`、Clippy
`--all-targets --no-deps -D warnings`、Rust fmt、修改脚本 ESLint/Prettier、
`git diff --check` 均通过。通知不覆盖控件的旧 TestBackend 夹具补充明确可选任务行，
不再让无任务的空状态宣称 f9 open。inventory 已更新，两侧仍共 1410 文件；治理扫描
2068 文件、Rust 1745 文件，零引用候选/分类漂移/边界违规均为 `0`。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；`footer_hint.rs` SHA256
`25711ac66254caeb48db58e07cc4d5aa697be6ecdc70858a7ff26c3402f76a20`，
`app/agent_center/hints.rs` SHA256
`e3dccc50fb82f7435d52ff61faf5b211e4a67ee0287e3cd61e85e2505f99830b`。

fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、键盘输入、
App Server stdio 与 canonical Thread/Turn/Item projection。新增 subagents 16 列缩放场景
只显示完整 `ctrl+x q`，恢复 100 列后显示明确分隔的双操作，未改变 canonical root；同时覆盖
14 列 Approval、queue/edit、Agent Center、history/search、Vim/editor keymap、images、
resize/reconnect 与 terminal restore。thread `01a10bc0-9e4e-7312-b26a-1a79eefa8e92`、
turn `turn_0b7867e664d1455b8e21c5176e4a62cf`，`terminal=restored`。
使用受控 external fixture backend，不调用 live provider。

分类：完整 styled shortcut owner 与 picker/Center 的可执行动作提示为 `current`；无分隔
chord 合并、空候选遮蔽、无作用 accept 提示和旧 locale 组合 API 为
`dead / deleted / guard-only`；无新增 `compat/deprecated`。遵循 DRY 收敛实际重复，保持
presentation 与真实输入/业务 owner 分离，不增加平行业务后端。
本切片退出条件全部满足，完成度 `100%`；整体为 `partial / in-progress`，无可核验总体分母。
Desktop Gate B 保持 `unverified / harness-blocked`；GUI、Windows 与 live provider 本轮未证明。

下一刀继续迁移 Resume picker 的同类 footer 残留：无分隔 chord 候选、空列表 accept 提示、
secondary hint 二次裁剪，以及高度为 1 时测量/绘制区域不一致；保持共享业务底层只读。

## 2026-10-05 Resume footer atomic presentation 第五十阶段（已完成）

主目标继续为 GUI/TUI 共用底层的 Codex CLI/TUI 全面对齐。Resume picker 仍有独立的空格
合并 chord 候选、空列表 accept 提示、secondary 字符串二次裁剪；高度为 1 时测量扣缩进，
paint 却用原区域。对照 Codex `PickerFooterHint`、`hint_line_for_row` 的完整 hint 选择和
样式，将其迁入既有 `footer_hint` owner，并直接删除混合 key/copy 的旧 locale 组合 API。

窄写集：`resume_picker/render.rs`、`resume_picker/tests/keymap.rs`、`tests/toolbar.rs`、
`locale/pickers.rs` 与 `locale.rs` 的对应方法/回归消费者，既有
`runtime_pty_tests/resume_picker.rs`、两个结构/Gate 守卫、inventory 和本计划。
已有第 47—49 阶段改动保留，release 执行计划避让；共享业务主链和 GUI 保持只读。
本轮仅 TUI presentation/test 收敛，不构成共享业务架构变更。

退出条件：1) 五语言 primary/secondary 的每个快捷键完整，动作之间明确分隔；2) 空列表
和解绑不伪造恢复/默认键，仍可执行的短键不会被空候选遮蔽；3) 高度为 1 和完整 footer
使用一致的实际内容区域，按键强调与标签分离；4) 旧 locale key/copy 组合入口删除并补守卫；5) 定向/related Rust、fmt/Clippy、结构/inventory/治理和 fresh TUI Gate B 通过。

实现：以 Codex 同名 `PickerFooterHint`、`hint_line_for_row`、`footer_hint_lines` 分离实际
key、五语言 label 和展示优先级，复用 `footer_hint::shortcut/first_fitting_line`。
primary/secondary 都只选择完整项，紧凑模式保留明确 `·` 分隔；长高优先级 chord 不能遮蔽
可执行短键。空结果不提示 resume/fork/restore；无目录候选的当前 Filter 不提示 change。
密度操作使用真实目标视图文案，保留 ctrl+c、transcript、expand 各自输入 owner。
单行和完整 footer 先计算同一个内容区域，再用该区域测量/paint。
旧 `resume_enter_hint/resume_escape_hint/resume_controls_hint/resume_expand_hint/
resume_transcript_hint` 五个 key/copy 组合 API 直接删除，生产与测试消费者直接迁移，无包装层。

先补五条行为回归，原实现全部失败；修复后追加解绑短键/单侧 option/不可切换 filter 回归。
Resume 定向 `78/78`，最终 Rust related CLI `8/8`、TUI `1492/1492`；结构/inventory/Gate
守卫 `86/86`、TUI Clippy `--all-targets --no-deps -D warnings`、Rust fmt、修改脚本
Prettier/ESLint 与 `git diff --check` 通过。inventory 仍共 1410 文件；治理扫描 2068 文件、
Rust 1745 文件，零引用候选/分类漂移/边界违规均为 `0`。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；`resume_picker.rs` SHA256
`c92d93de52b85a397bcf2b5dba3851ce336b7845303070123c378e7e33ab9ccd`。
fresh `npm run smoke:tui-gate-b` 通过真实 PTY/alternate screen/键盘/App Server stdio 与同一
canonical projection。新增 `/resume` 8 行 × 10 列场景证明实际 footer 保留缩进和完整
`ctrl+x q`，恢复 100 列后同一 canonical row 显示 `f9 resume · ctrl+x q close`，实际 F9 恢复
完成态，未提交新 turn；thread `01a10bce-f7eb-7f12-9fa8-2566e76e4067`、turn
`turn_85d3aa41bd3c48d7a8073503abe64657`，`terminal=restored`。
fixture 同时覆盖既有 Approval/subagents 窄屏与 queue/edit、Agent Center、history/search、
Vim/editor keymap、images、resize/reconnect；使用受控 external backend，无 live provider。

分类：Resume 完整 styled hints 与实际内容区域为 `current`；无分隔合并、secondary action
裁剪、空结果 accept 提示、无作用 change 文案和五个旧组合 API 为
`dead / deleted / guard-only`；无新增 `compat/deprecated`。遵循 DRY 复用已有样式/宽度 owner，
以单一职责区分 display copy 和 key facts，不预建通用业务框架。
本切片完成度 `100%`；整体仍 `partial / in-progress`，无可核验总体分母。
Desktop Gate B 仍 `unverified / harness-blocked`；GUI、Windows 与 live provider 本轮未证明。

下一刀回到 `/export`：Codex 已由 `chatwidget/transcript_export` 使用通用 SelectionView，
Lime 仍把独立 destination picker、固定默认键和 filename UI 放在 app 的导出业务模块。
优先直接迁移界面 owner、复用 current ListSelectionView 与启动 keymap，再清理旧渲染/提示。

## 2026-10-05 Transcript export surface owner 第五十一阶段（已完成）

主目标继续为 Codex CLI/TUI 功能、命名、目录、设计模式与 UI/UX 对齐。Codex 的导出界面
由 `chatwidget/transcript_export` 使用通用 SelectionView 和 current prompt/editor；Lime
仍把独立 destination/filename UI 与 Markdown/file 导出放在 `app/transcript_export`，
且 destination 的固定 Enter/Esc/j/k 绕过启动 ListKeymap，filename 未消费 editor snapshot。

窄写集：`chatwidget/transcript_export.rs`（新 current owner）、`chatwidget.rs`/interaction
接线、`app/transcript_export.rs` 与 App slash 接线、view 接线、相关 UI/host 回归，
locale 的旧 export hint 方法，新增 PTY export 夹具与既有接线、结构/Gate 守卫、inventory、架构图
与本计划。第 47—50 阶段改动保留；release 计划及 App Server/GUI/runtime/provider/protocol/
持久化 owner 避让。不恢复旧 composer、Compat facade 或 production mock。

退出条件：1) destination 的输入和显示共用 current ListKeymap/SelectionView，配置/解绑/
chord/page/direct number 与五语言真实一致；2) filename 消费同一 TextArea editor snapshot，
pending chord 先于 prompt submit/cancel，普通 Enter/Esc 保持 Codex prompt 语义；3) 导出界面
直接迁到 ChatWidget，app 导出模块只保留 canonical Markdown/file owner；4) 旧独立 row/
固定提示删除并补守卫；5) Rust 定向/related、fmt/Clippy、结构/inventory/治理与 fresh PTY
Gate B 证明真实 /export 选择/filename 编辑/取消且不提交新 canonical turn。

架构图确认：由当前责任开发者 root 确认 terminal presentation owner 迁移；最终图随实现
写入 `internal/aiprompts/architecture.md`。业务仍走共享 App Server/canonical projection，
不改变 GUI/TUI 的 runtime、协议或持久化边界。

补充写集：既有 `view/tests/presentation.rs` 的 ExportPicker 类型消费者直接迁移；五语言
export matrix 在极窄窗口暴露 `ListSelectionView` 的不可分双宽 grapheme 超过一列后触发
debug width assertion，故在其既有 `rows` lowering 对 passive row copy 做最终宽度归一化，
测量/paint 使用同一 bounded rows。footer action hints 不参与该裁剪，shared wrap 算法不变。

实现：导出 UI 直接迁到 Codex 同名 `chatwidget/transcript_export.rs`；
`ChatWidget::show_transcript_export_popup` 注入实际启动 RuntimeKeymap。destination 复用
`ListSelectionView` 的 row composition、width/height 与真实 viewport，configured ListKeymap
承接 accept/cancel/navigation/chord/page/jump；非搜索列表支持 wrap 与直接数字选择。
旧硬编码 Enter/Esc/j/k 和会抢占配置 page-down 的 Ctrl-D cancel 删除；Ctrl-C 仍为 protected
exit。filename 复用 current TextArea/editor snapshot，pending editor chord 优先处理 Enter/Esc；
paste/resize 等非键盘事件清 pending，普通 Enter/Esc 沿用 Codex custom prompt 的 submit/back
语义，列表的 F9 不冒充文件名 prompt 的确认键。filename render/cursor 共用 input rectangle，
TextAreaState 由同一 view 保存；空文件名不显示无效 save 提示。

两种 export view 均落在 bottom input 区域，保留 canonical transcript 和原 composer draft；
删除居中 fullscreen early-return、旧 cyan/竖线独立 row 画法、`export_option_line` 与
`export_picker_hint/export_prompt_hint` 固定翻译组合 API，所有调用和测试直接迁移。
`app/transcript_export.rs` 从 614 行收敛为 257 行，仅承接 canonical Markdown 和 noclobber
file owner；没有 reexport、compat facade、第二 writer 或其它业务后端。

原实现三条 App/ChatWidget 行为回归全部失败。最终 export 定向 `16/16`，Rust related
CLI `8/8`、TUI `1501/1501`；结构/inventory/Gate 守卫 `88/88`，TUI Clippy
`--all-targets --no-deps -D warnings`、Rust fmt、修改脚本 Prettier/ESLint 与
`git diff --check` 均通过。完整 library 同时覆盖保留的 Markdown/file 业务回归，五语言
viewport matrix 覆盖 1/2/4/10/14/24/40/100 列与 1/2/3/4/8/24 行，无 panic，宽窗口保留
同一 canonical body；
解绑、共享 prefix、Enter/Esc editor completion、paste reset、短 footer、page/jump/direct number
和 draft retention 有稳定行为回归。inventory 共 1413 文件；治理扫描 2068 文件、Rust
1748 文件，零引用候选/分类漂移/边界违规均为 `0`。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；
`chatwidget/transcript_export.rs` SHA256
`8d75ac0d51a1c2a1c61eded71d6bdb1ae859ba2abe4c1f1d91d1ad5714ac98ff`，
`bottom_pane/custom_prompt_view.rs` SHA256
`4880cc36f6b58d1358159193cdb6f43f0cb448c4eca50a5fe1633680419c3456`。

fresh `npm run smoke:tui-gate-b` 通过真实 `lime`、PTY、alternate screen、键盘输入、App Server
stdio 与 canonical Thread/Turn/Item。新增 `/export` 场景实际覆盖 14 列完整取消 chord、恢复
100 列、解绑 Enter 不触发复制、Down/F9 打开 filename、当前 `ctrl+q k` editor chord 清空输入、
真实 bracketed paste、Esc 返回 destination、配置的 `ctrl+x q` 取消；整个流程 canonical
完成文本始终可见，ledger 中 complete 场景只有 1 次 turnStart。thread
`01a10be5-5018-7493-ab40-12981aeacad5`、turn `turn_6e779d58aa414df18da3912b8db263e1`，
`terminal=restored`。fixture 同时回归 Resume/Approval/subagents 窄屏、queue/edit、Agent Center、
history/search、Vim/editor keymap、images 与 resize/reconnect；使用受控 external backend，
不调用 live provider。生产协议/bridge/GUI 未修改，无需重跑其全量门禁。

架构影响：`/export` terminal UI owner 从 App 导出模块迁到 ChatWidget，共享业务 owner 不变。
架构图已更新：`internal/aiprompts/architecture.md` 的 2.1 多 Surface 主链/导出 owner 段。
责任开发者确认：root，2026-10-05。
确认内容：已核对目录归属、数据流、依赖方向、协议边界和验证门禁。

分类：ChatWidget export surface、共享 ListSelectionView/TextArea 与 App canonical exporter 为
`current`；旧 App UI 类型/渲染、独立 option row、固定 hint、Ctrl-D 隐藏取消和 fullscreen
early-return 为 `dead / deleted / guard-only`；无新增 `compat/deprecated`。
DRY 复用现有 row/editor/shortcut owner，单一职责分离用户交互与文件导出，不为单个输入预建
平行 prompt 框架。避让 release 执行计划及共享 App Server/GUI/runtime/provider/protocol/持久化。
本切片退出条件全部满足，完成度 `100%`；总体仍 `partial / in-progress`，无可核验总体分母。
Desktop Gate B 仍 `unverified / harness-blocked`；本轮未证明 GUI、Windows 与 live provider。

下一刀继续对照 Codex `custom_prompt_view/picker` 的输入区高度、长文本滚动与 Vim/paste
行为；当前 export filename 仍为受限高度的专用表单，不能把本轮 editor snapshot 接入宣称为
完整 CustomPromptView 对齐。优先以真实输入/显示差异推进 current surface，再清理重复入口。

## 2026-10-06 Custom prompt input/picker 第五十二阶段（已完成）

主目标仍为 Codex CLI/TUI 的功能、命名、目录、设计模式和 UI/UX 对齐。本轮直接把
`/export` filename 迁入 Codex 同名 `bottom_pane/custom_prompt_view.rs` 与 `picker.rs`，
复用 current TextArea/PasteBurst，清理固定五行高度、单行 header 截断和删除粘贴换行的专用实现。

窄写集：上述新 prompt owner、`bottom_pane/mod.rs` 接线、`chatwidget/transcript_export.rs`
及其行为回归、locale prompt 模式 label、既有 export PTY fixture、结构/Gate 守卫、inventory、
本计划与架构文档 export owner 段。第 47—51 阶段脏改动保留；release 计划避让；GUI、
App Server、runtime、provider、protocol 与持久化只读。不恢复旧 composer 或增加 compat。

退出条件：1) filename 使用同一 generic prompt 的输入/render/cursor owner，长文本动态高度
1..8、header wrap 与 bounded scroll；2) 启动 Vim 设置继承、insert Esc→normal、normal Esc
返回、pending operator/editor chord 优先，提示与实际动作一致；3) bracketed paste 原文保留、
快速非 bracketed Enter 不误提交，modifier Enter 由 editor owner 处理；4) 五语言/narrow/resize
稳定回归和负向守卫；5) related Rust、fmt/Clippy、inventory/治理及 fresh PTY Gate B。

事实源：CustomPromptView 仅负责 terminal text prompt；ChatWidget 负责 export destination
与 submit/back 流转；App 仍为 canonical Markdown/file 导出 owner。不复制 Codex callback/
suggestion 框架，使用 Lime 已有 action gateway，不改变共享业务边界。
架构图将在实现落定后更新，并由当前责任开发者 root 确认；未验收前不标记完成。

实现已落定：CustomPromptView 持有 TextArea、viewport state 和共享 PasteBurst，目录/类型/
方法沿用 Codex `custom_prompt_view/picker`；export filename 直接消费，不保留 wrapper。
输入高度按实际宽度动态增长至八行，header wrap，游标与绘制复用同一 bounded rectangle；
footer 选完整 hint，Vim mode 仅在完整 action hint 与 mode 同时容纳时放在右侧。
启动 Vim 状态从 current composer 继承并进入 Insert，Esc 切 Normal、pending operator/search/
editor chord 消费完成/取消，再由 idle Normal Esc 返回 destination。Ctrl-C 保持 protected exit。
modifier Enter 进入同一 editor keymap；快速非 bracketed chars/Tab/Enter 使用既有 PasteBurst
的 direct-insert 路径，不另建 timer 或 buffering owner。bracketed paste 原文保留，submit
只 trim value 边界。旧固定五行高度、header ellipsis、filename 独立 render/state 与删除换行
分支直接删除，`chatwidget/transcript_export.rs` 由 320 行收敛为 234 行。

三条新增产品回归在旧实现上均失败：height `5 -> 5`、换行丢失与 Vim 未继承。相关 Rust
CLI `8/8`、TUI `1510/1510` 通过；新增 prompt 的确定性时钟回归覆盖 burst timeout、显式
paste/navigation reset、modifier Enter、key release、pending Vim/search/chord 与 protected
Ctrl-C。五语言覆盖 wrap、mode/back 文案、offset viewport、1/2/4/5/10/14/24/40/100 列、
1/2/3/4/8/16 行、14 行 Unicode scroll 与 resize；App export 继续覆盖同一 canonical body。
Clippy `--all-targets --no-deps -D warnings`、Rust fmt、脚本 Prettier/ESLint、diff check 通过。
结构/inventory/Gate 守卫 `89/89`；inventory 共 1416 文件；治理扫描 2068 文件、Rust 1751
文件，零引用候选/分类漂移/边界违规均为 `0`；scripts governance 通过。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；
`bottom_pane/custom_prompt_view.rs` SHA256
`4880cc36f6b58d1358159193cdb6f43f0cb448c4eca50a5fe1633680419c3456`；
`bottom_pane/custom_prompt_view/picker.rs` SHA256
`cd2100c65094f0331b0e1a9eda9b457815cf32b464f8cd079842f69d3008e2da`。

架构影响：terminal prompt 的输入/显示直接收敛到 CustomPromptView，export 与文件写入仍
分属 ChatWidget/App。架构图已更新 `internal/aiprompts/architecture.md` 的 2.1 export owner
段，责任开发者 root，2026-10-06，确认目录归属、数据流、依赖方向、共享业务边界与验证门禁。
分类：CustomPromptView、TextArea/PasteBurst 与 export current consumer 为 `current`；专用
filename renderer/state、固定高度/header 截断/粘贴 flatten 为 `dead / deleted / guard-only`；
无新增 `compat/deprecated`。DRY 复用现有编辑/粘贴 owner，单一职责分离 UI 和文件导出，
不预建未消费的 review callback/suggestion/event 框架。

fresh `npm run smoke:tui-gate-b` 通过真实 lime、PTY、alternate screen、App Server stdio 与
同一 canonical 投影。新增场景证明 12 行 Unicode bracketed paste 保留换行、输入动态增长/
tail scroll、24/100 列 resize/reflow、Up 回到首行、继承 Vim Insert、Esc→Normal、配置 z
prefix 的 pending Escape 与 idle Normal 返回、取消恢复主 composer；complete ledger 始终
只有一个 turnStart。thread `01a11065-2af8-7641-b222-350d3f177c37`、turn
`turn_04a4a35b74d74661894534113d2de10e`，`terminal=restored`。使用受控 external backend，
不调用 live provider；fixture 同时回归 prior Resume/Approval/subagents、queue/edit、history/
search、Vim/editor、images、resize/reconnect 等主路径。本切片退出条件满足，完成度 `100%`；
整体仍 `partial / in-progress`，无可核验总体分母。Desktop Gate B 仍
`unverified / harness-blocked`；GUI、Windows 与 live provider 本轮未证明。

下一刀为 Vim 光标形态：Codex TextArea 的 `uses_vim_insert_cursor` 驱动 SteadyBar，Normal/
Replace 与非 editor surface 使用用户默认形态，并在退出/外部编辑器交接恢复；Lime current
Renderable 虽有 cursor_style 合同，实际 Ratatui draw/terminal restore 尚未消费。

## 2026-10-06 Focused cursor style 第五十三阶段（已完成）

继续主输入显示对齐。窄写集：TextArea 的 mode flag、ChatComposer/CustomPromptView 的
cursor_style、BottomPane/view 的 focused surface 选择、Tui draw/restore owner、runtime 与
Resume host 的绘制接线、定向 view 行为回归、既有 PTY export/Vim 夹具与 cursor style 观察
helper、结构/Gate 守卫、inventory、本计划和架构段。runtime 大文件只直接迁移两个 draw
调用，不堆叠业务逻辑；release 计划与共享 App Server/GUI/runtime core/provider/protocol/
持久化避让。

退出条件：1) Vim Insert 为 SteadyBar，Normal/Replace 为 DefaultUserShape，hidden main
editor 不泄漏 shape 到 picker/pager/approval；2) production draw 统一消费 focused view style，
普通退出、panic、初始化失败和外部 editor handoff 都恢复用户默认形态；3) 稳定输入状态
回归、真实 PTY 最新 DECSCUSR 命令与 terminal exit 证据，Rust related/fmt/Clippy、结构/
inventory/治理通过。仅修改 terminal presentation/host，不改变 canonical 业务边界。

实现：采用 Codex 同名 `TextArea::uses_vim_insert_cursor`，只判定 enabled + Insert；
ChatComposer/CustomPromptView 按该事实 lowering cursor_style。BottomPane 选择 active notes
自己的 composer，其余交互使用默认形状；view 根据实际 render 优先级选择 export/picker/
pager/approval/主输入，不让隐藏的 Vim Insert 泄漏到其它 surface。Tui 新 current `draw`
直接消费 style 参数，在同一 backend 绘制和发送 SetCursorStyle；runtime 常规/断线 redraw
与 Resume 独立 host 全部直接迁移，旧 `terminal_mut().draw` production 路径删除并封守卫。
`terminal_mut` 仍为 screen-size 等真实读取的 current API，不误删整个入口。

正常 restore、panic restore、初始化失败 cleanup 和 external editor handoff 都显式发
DefaultUserShape + Show。保留 Ratatui 的 current Frame/Terminal，不复制 Codex custom_terminal；
该依赖差异只由 Tui host 的 display 参数承接，不增加平行 terminal/event/runtime owner。

四条 focused view 输入回归通过：main Insert→Normal→Replace→Insert；export destination/
filename/back/cancel 与 retained main Insert；pager/approval 遮挡后恢复。Rust related CLI
`8/8`、TUI `1514/1514`；结构/inventory/Gate 守卫 `91/91`；TUI Clippy all-targets/no-deps/
`-D warnings`、fmt check、脚本 Prettier/ESLint 和 diff check 通过。inventory 共 1418 文件；
治理扫描 2068 文件、Rust 1752 文件，零引用候选/分类漂移/边界违规均为 `0`。

fresh `npm run smoke:tui-gate-b` 再次通过真实 lime、PTY、alternate screen 与 App Server stdio。
既有 main Vim/export 输入场景新增 latest DECSCUSR 观察：真实 Insert 发 `6 q`，Esc/Normal
发 `0 q`，所有场景退出最新 shape 为用户默认，external editor marker 前同样为默认形状。
等待来自实际 PTY 字节和屏幕 predicate，无固定 sleep 或测试侧合成命令。thread
`01a1106f-42ca-7720-ba0f-24c27dcaa51a`、turn `turn_bc4dafaed55c45aeaa7f1b2c0d778ec9`，
`terminal=restored`。该 fixture 同时重新证明第 52 阶段 Unicode multiline/resize/Vim prompt
及此前的其他主路径。使用受控 external backend，不调用 live provider；panic/failed-enter
恢复分支由实现与结构守卫覆盖，本轮未通过真实崩溃/初始化失败 PTY 故障注入。

参考 Codex HEAD 仍为 `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；
`bottom_pane/textarea.rs` SHA256
`28497a7a1dc24ed593b0de14da2b154086d150638a7b6d1805fb501cccdb4b50`；
`custom_terminal.rs` SHA256
`80345bf2f46bc2f063cd49ff226a49b488a081d4d3d278a13a817fad1d241350`；
`tui.rs` SHA256 `02f52eb34718102087da2cb44b9fde37188a70b885410b5142f5479e43eb8e82`。
架构图已写入 `internal/aiprompts/architecture.md` 2.1 focused cursor 段，root 于 2026-10-06
确认 terminal presentation/host 数据流、依赖方向、生命周期和共享业务边界。

分类：mode flag、focused cursor projection、Tui draw/restore 为 `current`；绕过 host 的三处
production raw draw 为 `dead / deleted / guard-only`；无新增 `compat/deprecated`。
遵循 KISS 只加当前有消费者的形状 API，DRY 复用同一 mode owner与 current terminal backend，
不复制底层终端库、不引入第二业务后端。避让 release 执行计划与 GUI/App Server/runtime core/
provider/protocol/持久化。本切片完成度 `100%`；总体仍 `partial / in-progress`，无可核验
总体分母。Desktop Gate B 仍 `unverified / harness-blocked`，GUI/Windows/live provider 未证明。

下一刀回到主界面状态栏：Codex 已有 `bottom_pane/status_line_setup`、StatusLineItem 与
multi-select picker 的选择/排序/preview；Lime current slash catalog 仍只有 `/status` 信息
pager，没有 `/statusline` 或 status-line config owner。需先核对 shared config/current facts
与真实 footer，再按有事实来源的项目直接迁移；不能把没有 provider/read-model 来源的数据
做成静态占位，也不能用扩展 Busy status indicator 冒充持久 status line。

## 第五十四阶段：StatusLineSetupView 与共享状态栏配置（功能/终端验收完成，仓库门禁阻塞）

主目标仍为 Codex CLI/TUI 全面对齐，本轮补 `/statusline` 的选择、排序、搜索、真实预览、
确认/取消与重启恢复。唯一配置事实源是 core TuiConfig，经既有 App Server config/read 与
config/batchWrite 读写同一个 config.yaml；不新增 method、IPC、私有存储或平行业务后端。
仅接入有真实来源的 model/effort/cwd/permissions/thread/raw-output 项，不伪造 usage/额度/Git。

窄写集：core config/tui_keymap，TUI LocalSettings/session、StatusLineSetupView 与 multi-select
owner、ChatWidget status controls、App action/dispatch/interaction、footer/view/slash/locale，
配置 public JSON-RPC 与定向/PTY 回归，既有结构/Gate 守卫和 inventory，ops、架构与本计划。
已有本任务改动保留；未知 release-v1.150.0-plan.md 避让。超千行宿主只加模块接线，业务逻辑
进入独立 status owner；不继续向大文件堆叠。配置协议的 JSON value 形状保持原边界。

退出条件：默认/显式空列表与 ordered list 对齐；预览与 footer 同一 facts renderer；确认原子
写两项且版本冲突拒绝，取消零写；未知/不可用 facts 省略；真实 list bindings/chord/unbind
不回落硬编码；active overlay/search/queue hints 优先；五语言与 narrow/resize 回归通过；
真实 PTY 保存/取消/重开、stdio shared config 与 canonical ledger 证据通过。Desktop Gate B、
Windows、live provider 仍未证明。全局对齐保持 partial，无可核验总体分母。

第五十四阶段实现和终端验收已完成：TUI `1527/1527`、core TUI config `7/7`、public
`config_jsonrpc` `1/1`、GUI shared config `14/14`、结构/inventory/Gate 守卫 `93/93` 通过。
TUI Clippy all-targets/no-deps/-D warnings、fmt、TS typecheck、受影响 ESLint、contracts 与
diff check 通过；inventory 已更新为 1428 文件。扩展窄写集为 `src/lib/api/appConfigTypes.ts`、
`appConfig.ts` 与 `appConfig.test.ts`：只声明共享 TuiConfig 并证明 GUI 差异写语言设置时不
覆盖有序列表/false/keymap，返回值 clone 不污染缓存，fresh read 保留显式 []。

fresh TUI Gate B thread `01a110e2-dd9e-71d0-b7ea-5a55bc00adfe`、turn
`turn_96ac8241c0714650b6cfdd4c3a5f3cf8`，`terminal=restored`。真实 PTY 覆盖 F9 保存、
ctrl-x q 取消、Enter unbind、Space 勾选、12/100 列 reflow、关闭/重开、恢复默认顺序/颜色；
新真实 stdio App Server 从同一配置重新读取 []/false，陈旧版本被拒绝并刷新版本，没有部分
写入或新增 canonical turn。首轮 fixture 只在 Cargo artifact lock 等待中超时，串行重跑
通过；public config 初次 V8 下载受 DNS 限制，用仓库校验缓存后通过，未变更依赖/fallback。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；status_line_setup SHA256
`474a540a88dfa0ac12e0774a07b775e2a3bc6e520492837a588257508a1c12ec`；multi_select_picker
`09dfa0c948ad4d43432cffa71fac83a73ffb6542c4e19130fde2ef28eaecc684`；status_surface_preview
`425252cb58c0a5a56ffd2c81f28c81ce84d761e5135de4006e62814a5fb49b36`。root 已在架构文档
确认共享配置与 facts owner、依赖方向和确认后写入边界。分类：shared config/status picker/
preview/footer 为 current；私有 right_click_paste snapshot 和原 session 根 read_config 为
dead / deleted，直接迁移消费者；无 compat/deprecated。KISS 只开放真实可用 facts，DRY
复用列表 geometry/renderer 与共享配置 transport，UI 与持久化职责分离。

仓库交付门禁尚未全绿：`verify:local` 在本轮未改的 GUI 资源中发现 26 个未引用 key
（navigation.sidebar.account 20、scheduledTasks 6），停止后续任务；不扩展本切片删除这些
资源。独立运行的 typecheck/contracts/定向回归已通过。`verify:gui-smoke` 首轮 renderer
构建因 ENOSPC 中断，未进入 Electron；仅以 cargo clean -p tui 清理本任务可再生成的 TUI
编译产物（Cargo 报告 125840 files / 56.9 GiB，磁盘可用空间恢复），源文件和用户数据未
删除。重跑 renderer/host/client/sidecar 构建均通过，但 Electron smoke 仍未生成
`.lime/qc/project-gates/standalone-shell-01-20261006111128-11513/shell-01-electron-smoke/summary.json`；
Desktop Gate B 仍 unverified / harness-blocked，不以构建成功替代交互证据。本切片
功能/终端退出条件 `100%`，仓库交付仍 blocked；整体仍 partial / in-progress。

## 第五十五阶段：默认终端标题与 managed OSC 生命周期（功能/终端验收完成，仓库门禁阻塞）

下一刀对齐真实窗口/标签标题。范围是 Codex 默认 activity/thread-name/project-name 的
显示和 managed title 清理；使用现有 App canonical projection、BottomPane pending request
与 status_surface_data，不新增业务状态机、timer、配置空框架或私有 IO。`/title` 的交互
配置仍列为后续明确缺口，本切片不宣称整个 title 能力完成。

窄写集：terminal_title 输出 owner、App terminal-title projection、Tui draw/restore/handoff、
runtime 两处 draw 与 Resume host 的直接调用迁移、定向/PTY 回归、结构/Gate 守卫、inventory、
ops/architecture 与本计划。共享 config/GUI/App Server/provider/持久化和未知 release 计划避让。
退出条件：默认顺序与 available facts 对齐；running spinner 使用现有 100ms redraw；等待
审批/问答/MCP 显示同一 pending request 的五语言 Action Required；idle 无 spinner，线程
切换/name 更新不串台；OSC 移除控制/不可见格式字符，折叠空白并限制 240 字符；重复值
零输出，失败可重试；正常退出/panic/external editor 清除本进程已管理的标题，未管理时不
清掉 shell 标题；真实 PTY 观察 OSC 字节、运行/阻塞/恢复与 terminal exit，相关门禁通过。

实现：`app/terminal_title` 从共享 status facts 读取当前 canonical Thread 的名称与 server cwd，
无项目根读取合同时使用 cwd basename fallback；没有名称时直接省略。active turn 的现有
clock 计算 Codex 十帧 Braille spinner，既有 100ms redraw 驱动；pending request queue 驱动
本地化 `[ ! ] / [ . ]` Action required，处理后回到 activity，canonical terminal 后恢复 idle。
不从 transcript 猜名字、不读取磁盘或复制业务状态。foreign name notification 留在既有
Thread buffer，真实切换/hydrate/replay 后才参与当前 title。projection 与低层输出职责分离。

`terminal_title::ManagedTerminalTitle` 持有最后成功输出的 sanitised 字符串，输出前移除
control/bidi/invisible 格式字符、折叠空白并限制 240 个 Unicode 字符，OSC 0 使用 BEL 结束。
相同 sanitised 值不重复写入，empty/no-visible-content 只清本进程已管理标题，失败不推进
cache、下次 frame 可重试。Tui draw 直接消费 optional title；正常退出和 external editor
handoff 清标题，编辑器返回后可重写同一 context；panic hook 只保留 managed flag，未设
标题时不清 shell 标题。跨 surface 数据仍来自同一 App Server/read model，未新增配置键。

TUI `1533/1533` unit、现有 suite `23/23`、focus integration `1/1` 通过；新增六条行为回归
覆盖 Unicode/控制注入/240 字符边界、去重/只清 managed/重新应用、set/clear 失败重试、
canonical name/foreign buffer/thread switch/unset、100ms turn clock 与 completed、五语言
pending request 到 response。结构/inventory/Gate 守卫 `95/95` 与 GUI config `14/14` 通过；
TUI Clippy all-targets/no-deps/-D warnings、fmt check、脚本 ESLint/Prettier、diff check 通过。
inventory 共 1433 文件。治理 runtime=2068、Rust runtime=1767、test=1356、Rust test=197，
零引用候选/分类漂移/边界违规均为 0；未改的 release 计划仍为原 numstat 13/10。

fresh TUI Gate B 第一次 thread `01a110f2-2efa-7cd3-94d7-90c5571af4eb`、turn
`turn_a5c37f40f43248149044fe505f0196e1` 通过；补 canonical terminal 后 idle-title 观察后再跑
一次，thread `01a110f4-89d3-7d00-a6c7-243723dfb65c`、turn
`turn_6b49bf2258c94b2289b8445aa67f2d18`，`terminal=restored`。真实 OSC observer 证明初始
cwd/idle、interrupt/queue-edit activity、approval/user-input Action required、完成/失败后的
idle、root/background 命名与多次 thread handoff、外部 editor marker 前清空/返回后重写、
每个 scenario 退出最后 OSC payload 为空。observer 只观察 PTY，不合成命令、无固定 sleep。
同一 fixture 同时重验第 54 阶段 status-line save/cancel/restore/version conflict，canonical
ledger 未新增 turn。backend 为受控 external fixture，不调用 live provider。panic 清理仅有
实现与结构守卫，本轮没有真实 panic 故障注入；Windows/GUI/live provider 不由本轮证明。

参考 Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；terminal_title.rs SHA256
`252814d012d681c7cefc96cc7e5cd677b8bd54fb770c03a6ad8f4b1d0848a848`；
chatwidget/status_surfaces.rs SHA256
`e96ac7db77866266a5b146b885f03487bf801511295bd35474877783537e6200`。root 已在 architecture.md
确认 canonical facts -> title projection -> current Tui host -> managed OSC -> restore/handoff
数据流、依赖方向与生命周期。分类：默认 title projection、managed OSC、当前 host 为
current；本切片无新增 compat/deprecated，无第二业务 backend。现有 focused raw-draw 入口
保持 dead / deleted / guard-only，不恢复旧 renderer/composer。

默认标题切片功能/终端退出条件完成度 `100%`；可配置 `/title`、provider usage/额度、Git
facts 等仍是明确未对齐项，整体仍 partial / in-progress，不用测试数推算总体完成率。仓库
交付门禁沿用第 54 阶段阻塞：verify:local 的 26 个未引用 GUI i18n key，以及 Desktop smoke
缺 structured summary；两者不是本切片通过项。下一刀为 `/title` TerminalTitleSetupView，
要直接复用 current MultiSelectPicker、共享 TuiConfig/config version 与同一 facts projection，
并把重复 selection layout 收敛到一个真实 owner，避免复制状态栏或另建 title 私有存储。

## 第五十六阶段：TerminalTitleSetupView 与共享多选布局（功能/终端验收完成，仓库门禁阻塞）

主目标继续为 Codex CLI/TUI 全面对齐；本轮补 `/title` 的选择、排序、搜索、实时 OSC
预览、取消恢复与共享配置持久化。事实源为 core TuiConfig，经现有 config/read 与
config/batchWrite 保存；标题和状态栏继续使用同一 canonical facts，不新增业务后端。

窄写集：core TuiConfig、GUI shared config 类型/回归、public config_jsonrpc、TUI 当前
multi-select/status/title/setup/locale/action/view/modal 接线与定向/PTY 回归，既有结构/Gate
守卫、inventory、ops/architecture 和本计划。此前本任务改动保留，release-v1.150.0-plan.md
避让。超千行宿主只加模块/variant 接线，领域逻辑进入独立 owner。

退出条件：None 默认、[] 关闭、ordered selection/alias 去重与不可用事实省略；共享多选
布局直接替换旧 status renderer；真实 resolved list bindings/chord/unbind、五语言/narrow/
resize；预览零配置写、取消恢复 saved selection，Enter 只产出 host action，确认成功才
应用，版本冲突拒绝并重读；真实 PTY 观察预览/取消/保存/清空/重开和 fresh stdio 持久化，
不增加 canonical turn。相关定向/契约/治理门禁通过并记录仓库阻塞；整体仍 partial。

实现完成：`TerminalTitleItem/TerminalTitleSetupView` 对齐 Codex 同名 owner，开放 11 个有
真实来源的项目，保留 Codex canonical ID/alias、configured order 优先/去重、None 默认和
[] 关闭。未命名 thread-title 使用 canonical Thread ID，thread-name 继续省略；普通项目
用 `|`，activity 两侧空格，等待操作且选中 activity 时前置五语言提醒并省略重复 run-state。
长 project/thread/其它 segment 分别按 Unicode 字素限制 24/48/32，最终仍走既有 240 字符
managed OSC sanitizer。无 Git/usage/额度伪造，无项目根合同时明示 cwd basename 来源。

`MultiSelectPicker` 直接接管原 status setup 的 checkbox/ListSelectionView/控制提示/preview
布局和 page rows，两种 setup 仅持有领域选择与委托，不保留独立 renderer 双轨。通用
save/toggle/reorder/preview labels 直接迁到 locale/pickers，并补“没有匹配的项目”五语言。
`app/status_controls::write_tui_preferences` 为唯一 expectedVersion/config batch/recovery
owner；status/title 各自选择 edits 和成功投影。取消/断线/hydrate 只移除临时选择，保存
成功前不改 shared preferences；preview 不发请求，不创建 canonical turn。GUI gateway
声明 terminal_title additive field，差异保存其它设置不覆盖有序列表/[]，缓存 clone 独立。
共享 config wire 仍是原 JSON value，无新增 method/IPC、schema-generated type、依赖或锁文件。

TUI `1542/1542` unit、suite `23/23`、focus integration `1/1`；core TUI config `8/8`、
public config_jsonrpc `1/1`、GUI config `14/14`、结构/inventory/Gate 守卫 `97/97` 全通过。
TUI Clippy all-targets/no-deps/-D warnings、fmt check、TS typecheck、ESLint/Prettier、
test:contracts 与 diff check 通过。inventory 更新为 1439 文件；治理 runtime=2068、
Rust runtime=1773、test=1356、Rust test=197，零引用候选/分类漂移/边界违规均为 0。
未改 release 计划仍为原 numstat 13/10。新增 slash 后的 bounded catalog 回归改断言实际
可见 `/title`，完整 TUI 回归已重验，不依赖旧固定 catalog 行数。

fresh 完整 `npm run smoke:tui-gate-b` thread `01a11145-0c21-7483-914f-76a92d521b07`、turn
`turn_49910cd2d54c49e7a7b07ce0f307c0b8`，`terminal=restored`。真实 PTY 证明打开/实时
ordered OSC preview、preview 零持久化、12/100 列 resize、Enter unbind、完整 ctrl-x q
取消并恢复实际标题、F9 有序保存/重开、[] 清 managed OSC/读回、Ctrl-C 只关配置器并
恢复 saved disabled title、从同一产品 UI 恢复默认项。共享 fresh stdio fixture 同时检验
状态栏与标题的陈旧版本拒绝/重读，没有部分写入，没有增加 canonical turn；公共 JSON-RPC
还证明 ordered/[] 持久化及非法 shape 拒绝。backend 为受控 external fixture，无 live provider。
原 approval/user-input/activity/thread handoff/external editor/exit 标题观察与完整其它场景
同次重验。Windows/GUI/live provider 和真实 panic 故障注入不由本轮证明。

Codex HEAD `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`；title_setup SHA256
`9f2899f5926d0e8b017cf147c53ccae06b8ed542b77fcb4350463ea3c77fc007`；multi_select_picker
`09dfa0c948ad4d43432cffa71fac83a73ffb6542c4e19130fde2ef28eaecc684`；status_surfaces
`e96ac7db77866266a5b146b885f03487bf801511295bd35474877783537e6200`。root 于 2026-10-06
在 architecture.md 确认共享 config/multi-select/facts/OSC owner、依赖方向与临时/持久状态边界。
分类：title setup、shared picker/layout/config writer 为 current；旧 status 独立布局与重复
config-write/recovery 代码为 dead / deleted / guard-only；无新增 compat/deprecated。
KISS 只开放有真来源的项目，DRY 收敛真实双消费者的布局与保存，SOLID 分离选择/事实投影/
共享存储/terminal IO。此前任务改动保持，未知 release 热区避让。

本切片功能/终端退出条件完成度 `100%`；全局仍 partial / in-progress，无可核验总体分母。
`verify:local` 本轮实际重跑，仍在 26 个未引用 GUI i18n key（navigation 20、scheduledTasks 6）
阻塞。Desktop Gate B 继续沿用前阶段 smoke 缺 structured summary 的 unverified /
harness-blocked；本轮仅同步 GUI 配置类型与回归，未变 GUI 交互路径，不重复无变化的大型
Desktop 构建/失败 harness。仓库交付未全绿，不用终端验收代替 Desktop 或 Windows 证据。

下一刀优先核对 status/title 的 structured task-progress 与 token-usage canonical facts。
已有 TurnPlanUpdated 与 ThreadTokenUsageUpdated 协议，但 TUI 当前只把 plan 降成文本、
未消费 usage 通知；需要先明确 current read model/replay 来源，再补有真实依据的显示和
恢复，不能解析 transcript 猜进度或伪造 context/额度。

## 第五十七阶段：结构化 task-progress 与计划投影 owner（功能/终端验收完成）

主目标继续为 Codex CLI/TUI 显示/命名/设计模式对齐；本轮把既有 TurnPlanUpdated 的
completed/total 投影供 status/title 的 task-progress 消费。计划文本与计数从同一 typed
notification 更新，不能解析 transcript；只展示已观察到的 current Thread facts，空计划
清除、closed turn late update 拒绝、foreign Thread 先 buffer，hydrate 清空后复用现有 replay。
当前历史 ThreadItem::Plan 是文本，不伪造缺失的 durable checklist 计数。

窄写集：TUI projection/plans 新领域模块与 root 仅 field/mod/dispatch/reset 接线、status
facts/item/title/locale、定向/PTY 回归与既有结构/Gate/inventory；受控 terminal external
fixture 追加 canonical turn.plan.updated 事件，ops/architecture/本计划。避让 release、
GUI、App Server/protocol、config schema 和依赖。projection.rs 已 1462 行，本轮只迁出
现有 plan branch/marker，新增逻辑全进 plans，退出条件为持续拆分其它领域而非继续堆叠。

退出条件：canonical plan 文本与 typed count 同步；零/未观察/foreign/closed/hydrate 回归；
五语言 status/title/preview 同一 formatter；真实 PTY 可选择 task-progress 并观察 shared
config/footer/OSC 真实来源、不新增 turn；此前全部 TUI/title/status 退出条件保持。

执行期环境变化：其它工作将 workspace/npm 版本改为 1.151.0，并产生 release-v1.151.0-plan.md；
本轮不修改/认领这些 manifest、lockfile 或新发布计划，原 release-v1.150.0-plan.md 仍为
13/10。Codex HEAD 更新到 `4aaee872e31abefe0d32e91faab23b09b6968824`，只读复核 task
progress 的 completed/total 与 Tasks 格式仍一致。当前版本真实 CLI Gate B 通过：thread
`01a11412-696d-76a3-b027-2626993700c0`、turn `turn_ad4e07c2340f4dc68c756b83db7edb43`，
JSONL/stdin/error-exit/completion 与原事件合同保持。新 TUI Gate 首轮只在 Cargo artifact
lock 排队超时，没有进入 PTY；先串行完成当前版本 crate 校验，再重跑 fresh Gate，不把
锁等待失败当交互证据。当前 stage 尚未标记完成。

实现与验收完成：`projection/plans` 直接接管原 plan branch/marker，typed status 计数与
计划文本同步，status/title/preview 共用 task-progress value。TUI 当前版本 `1545/1545`
unit、suite `23/23`、focus integration `1/1` 通过；结构/inventory/Gate/fixture 守卫
`101/101` 通过。Clippy all-targets/no-deps/-D warnings、fmt、脚本 ESLint/Prettier、docs
boundary 与 diff check 通过。inventory 为 1442 文件；治理 runtime=2068、Rust=1776、
test=1356、Rust test=197，零引用候选/分类漂移/边界违规均为空。

2026-10-07 fresh 完整真实 TUI Gate B 通过：thread
`01a115eb-24ab-7381-a1e6-c438413b4723`、turn
`turn_7ad8d487a55c4dd992a8dbd737a8f599`，`task-progress=ok`、`terminal=restored`。
真实键盘完成选择/排序、footer/OSC preview/cancel/save、fresh stdio shared config/conflict、
恢复原选择且 ledger 无新增 turn。前一次真正 PTY 失败来自长 cwd 将末尾 progress preview
正常裁切；fixture 已经通过真实排序键将 progress 移首，并核验保存顺序，未改产品截断规则。
CLI 默认 fixture 不添加计划事件，显式 TUI complete scenario 才启用 typed plan。

Codex HEAD `4aaee872e31abefe0d32e91faab23b09b6968824`；status_surfaces SHA256
`97b1698b8cd73c5cc9b4ee2cbf1d99183c6cdfd8561571cc23dcc6f6c22f0321`，turn_runtime
`537e60fac75d995a0ce662432d6186d04cabde727bc4d379d42fcbefe8d0d8a9`。root 已确认
architecture.md 的 typed plan/facts/shared formatter 依赖与历史缺口。
分类：plans/status/title current；原 plan branch/marker 已迁出，不保留双轨；无新增
compat/deprecated。KISS 不解析历史文本补假计数，DRY 共用 formatter，SOLID 将计划投影
从大宿主拆出。本切片退出条件 `100%`；总体仍 partial / in-progress，没有可核验总体分母。
Windows/live provider/Desktop/panic 注入未由本轮证明。仓库门禁沿用前阶段记录，后续需按
当前工作树重核，而不能把原阻塞或其它发布工作状态视为本轮已验证。

## 第五十八阶段：token usage 与上下文状态显示（功能/终端验收完成）

主目标继续为 Codex CLI/TUI 全面对齐，本轮接入已存在的 canonical
`thread/tokenUsage/updated`，供状态栏、标题配置预览和 `/status` 共同消费。唯一来源为
App Server typed ThreadTokenUsage；不在 TUI 重算 provider 累计、不读本地日志、不解析
transcript、不伪造未观察到的 usage 或额度。GUI 继续消费同一既有通知，无新协议或后端。

窄写集：TUI projection/token_usage、status/token formatter、status/title item/locale、
App facts/pager 最小接线、定向/PTY 回归；既有 terminal external fixture/Gate 守卫、
inventory、ops/architecture/本计划。发布 manifest、lockfile、i18n GUI 热区与发布计划避让。
projection root 超千行只接 field/reset/dispatch，不追加业务算法；status 的重复 field
构建顺便收敛为同一 owner。

退出条件：used-tokens 为 non-cached input + output，input/output 保持服务端累计；
context 使用 last.total_tokens 与真实 window，按 Codex 12000 baseline 算剩余/使用百分比。
未知或非正 window 省略，不复制无来源的 100% 默认；负值/溢出安全、已观察零值与 unknown
可区分；Thread handoff/hydrate/replay 隔离、旧 Turn 通知不覆盖新 Turn，允许当前最后 Turn
的终态 usage 到达；五语言/窄屏/status copy 与真实 PTY 证明同一事实源，配置不新建 Turn。

实现完成：`projection/token_usage` 保存 typed snapshot，并同时接请求 acknowledgement 与
TurnStarted 的身份；新 Turn 后拒绝旧 Turn 用量，当前最后 Turn 的终态通知仍可消费。
hydrate 清空用量并从 canonical 最后 Turn 初始化身份，不从历史文本制造统计。Thread
buffer rebase 保留最后一份已观察 typed usage；切换后 replay 最后快照，不累加通知。
冷恢复的 thread/read 尚无 durable usage 合同，仍等待新通知，明确保留此能力缺口。

`status/helpers.rs` 对齐 Codex 的 format_tokens_compact/blended_total/上下文百分比，统一
驱动 status/title/setup/pager；临时 status/token_usage 路径直接迁走，原重复字段构建收敛
为 fields()。新增六个 status 项目及五个 title 项目，五语言共享标签与值，无新协议、GUI
业务路径、依赖、锁文件或配置存储。projection root 仅接线，退出条件继续为拆分领域逻辑。

当前版本 1.151.0：TUI unit `1553/1553`、suite `23/23`、integration `1/1`；结构/Gate/
fixture/inventory 守卫 `104/104` 全通过。Clippy all-targets/no-deps/-D warnings、fmt、
脚本 ESLint/Prettier、contracts、docs boundary、diff check 通过。inventory 共 1484 文件
（Codex 1084、Lime 400；独立 test 树另 18/11）。治理 runtime=2068、Rust=1782、
test=1356、Rust test=197，零引用候选/分类漂移/边界违规均为 0。verify:local 实际通过，
smart 检测 32 文件，执行 cli/tui 范围测试。并行工作已清除此前 GUI 的 26 个未引用翻译
key，本轮只读重核 i18n:unused=0；不认领该改动，不继续将历史 i18n 阻塞视作当前阻塞。

2026-10-07 完整真实 TUI Gate B：thread `01a11605-2daf-77a3-99f0-c098dd804f51`、turn
`turn_c306bd4372bd4a32b9272454b419acde`，task-progress=ok、token-usage=ok、
terminal=restored。真实 /status、选择/排序/保存、footer、OSC preview/cancel/save、fresh
stdio 配置/conflict 与恢复，ledger 无新增 Turn；全部既有输入/编辑/审批/线程/draft/
history/images/skills/reconnect 场景同次通过。此前两次失败分别为 fixture 的 cwd 搜索词
匹配到 Context window、扩展完整场景触及总 60s；已改真实 working directory 搜索与该
场景 120s 总时限，其它场景仍 60s、screen predicate 仍 10s，没有固定 sleep 或合成终态。
真实 CLI Gate B：thread `01a11606-a497-7810-9ece-a5cdc0218a9b`、turn
`turn_e5f0ba26194c490f96ef73001b6fd7be`，JSONL/stdin/error-exit1/zsh completion 通过；
usage 仅显式 TUI fixture 注入，CLI 默认事件序列保持。

Codex HEAD `4aaee872e31abefe0d32e91faab23b09b6968824`；status/helpers.rs SHA256
`7a0536c9854def413c0d20516cd9850c69bc85753902d01fcacc71753bfd210d`；protocol.rs
`54f175eeb1410f1b1937df7466da2dc73258ccc5e2b6f09bd6172868a19c23b7`。root 于
2026-10-07 已在 architecture.md 确认 typed usage/bounded buffer/projection/shared formatter
的数据流与缺失 durable snapshot 边界。分类：typed projection/helpers/shared facts 为
current；重复字段构建与临时 formatter 路径为 dead / deleted，无新增 compat/deprecated。
KISS 不补伪事实，DRY 共用显示算法，SOLID 分开身份校验、展示与 transport owner。

本切片功能/终端退出条件 `100%`；总体仍 partial / in-progress，无可信总体分母。
Desktop Gate B 仍 unverified / harness-blocked（此前 GUI smoke 缺 structured summary，
本轮没有新 Desktop 证据）；Windows/live provider/panic 故障注入未由本轮证明。

## 第五十九阶段：普通 composer 底栏上下文与 canonical 配置名（功能/终端验收完成）

主目标继续为 Codex CLI/TUI 全面对齐；下一刀补普通底栏右侧上下文及 Vim 排布，直接
消费同一 typed usage 的 immutable FooterProps。状态栏 passive 布局不重复显示 context；
未知事实为空，已观察用量但无有效 window 时用服务端累计 total_tokens（不是 blended
计费统计），与 Codex 的普通 footer 语义一致。配置保存 canonical run-state/thread-id，
只保留 Codex 自身的解析 alias，不加 compat wrapper。

窄写集：bottom_pane/footer 与纯 context/layout owner、既有 inline tests 迁出、view/
chatwidget 最小 snapshot 接线、status item/消费者命名、locale token 文案、定向/PTY 回归、
既有结构/Gate/inventory、ops/commands/architecture/本计划。避让发布计划、manifest、
锁文件、GUI/App Server/protocol。footer 近 800 行先迁出 tests，不在大宿主堆业务逻辑。

退出条件：真实百分比/total fallback/unknown/zero 五语言；右侧完整显示并保留边距与间隔，
Unicode 宽度正确；窄屏先保全 queue/cycle 操作提示，必要时隐藏 context；passive status、
history/Vim search/shortcuts/interactive overlays 无 context 泄漏；Vim 模式右对齐，足够宽时
context 与 Vim 用分隔符组合；canonical 配置选择/保存/alias 去重；真实 PTY keyboard/
resize/恢复及同一 stdio 配置和 canonical ledger 验证，相关门禁通过后登记证据。

实现与最终验证：普通 footer 的 context/window/total fallback、Vim 组合、queue/cycle 窄屏
优先级均由 pure footer owner 承接；447 行 production 与 602 行独立 tests，原 inline
tests 位置直接迁出。App 只传 immutable FooterProps，不在 composer 累计用量。
run-state/thread-id 保存 canonical ID，五语言选择器使用准确名称；Status/SessionId enum
及 Codex 自身解析 alias 保持原语义。history/Vim search/shortcuts/interactive modes 隔离。

TUI unit 1561、suite 23、integration 1 全通过；结构/Gate/fixture/inventory 105/105，
最终 inventory 守卫 26/26。Clippy all-targets/no-deps/-D warnings、fmt、ESLint、Prettier、
contracts、diff check 通过。inventory 1486 文件（Codex1084、Lime402）；治理 runtime2068、
Rust1784、test1356、Rust test197，零引用候选/漂移/违规均0。最新 verify:local 通过，
smart39文件、版本1.151.0、Rust范围cli/tui（CLI8、TUI1561）。无版本、依赖或锁文件变更。

2026-10-07 完整真实 TUI Gate B：thread `01a11628-2ffd-79b0-8cbe-6d0afbe6c135`、turn
`turn_fcd95d75acd54710b420ea089b098c88`，task-progress/token-usage/context-footer/
canonical-status-ids=ok、terminal=restored，既有全部场景同次通过。focused complete：
thread `01a11624-8fad-70d2-9b9f-37f505118ef0`、turn
`turn_c2bc2aeae34540e5ba25a3f93a420c7e`。同次 thread-input stdio root
`01a11629-511c-7272-bd2d-6817ea7b1366`、child `01a11629-513c-7660-b3f3-289d26c4f5d8`；
typed-input stdio thread `01a11629-6b6d-7b51-b73a-883c2b182877`、turn
`turn_fc05cdd182914089b94f96842fe4d3ef`、queue `27c40ffe-7581-4a80-9065-7971b7389d7d`。
本阶段未新增 CLI Gate，不能冒充第五十八阶段证据为本阶段验收。

PTY 证明真实16/100列 resize、context/Vim query/cancel、快捷键隔离、canonical设置保存与
ledger同一Thread UUID、fresh stdio配置重读/version conflict和恢复，且无新增Turn。
夹具使用可见 checkbox 状态屏障及实际catalog数量，不靠固定 sleep；16列完整提示和
context都放不下时允许留空。架构由root于2026-10-07确认。避让release-v1.151.0-plan.md
的并行改动（当时numstat6/4）。KISS保持纯布局，DRY共享usage与typed配置，SOLID分开
展示和事实接线。current为FooterProps/pure layout/canonical writer；原普通左侧Vim拼接、
inline tests位置与旧canonical writer名称为dead/deleted；无新增compat/deprecated。

本切片功能/终端退出条件100%；总体partial/in-progress，无可信总体分母。Desktop Gate B
本阶段未新增，原GUI smoke structured summary harness缺口未重验；Windows/live provider/
panic注入未证明。下一刀为Esc历史回退编辑，复用既有thread/revert与typed输入恢复。

## 第六十阶段：Esc 历史回退编辑与 canonical 输入恢复（功能/终端验收完成）

主目标不变。current事实源为现有App Server thread/turns/list、thread/revert与同一
Thread/Turn/Item投影。TUI新增Codex-shaped app_backtrack状态机，不解析transcript文本
重建输入；复用HistoryEntry::from_user_inputs和composer历史恢复，不建立第三套lowering。

窄写集：TUI app_backtrack及输入/overlay/session最小接线、pager领域拆分、footer EscHint、
五语言、typed历史请求/回退worker与稳定回归、现有PTY/Gate/结构/inventory、架构/命令/
ops/本计划。避让GUI、协议/backend、manifest/锁文件及发布计划。pager_overlay原1912行，
先迁出tests并按领域拆分；宿主只接field/mod/dispatch，不继续堆业务逻辑。

退出条件：空输入首次Esc提示、再次Esc进入最近用户prompt预览；左右选择、不循环；Esc
取消恢复阅读起点，Enter经现有thread/revert回退至所选Turn之前，再从typed UserInput
恢复文本/elements/图片/Skill/Mention。异步分页/失败/重连/切Thread不得污染新会话或丢
草稿；未知/不可编辑输入fail closed。保留运行中interrupt、Vim/搜索/modal输入优先级。
thread/reverted及回退响应均刷新canonical历史，不留被删除Turn；相关单测/结构/contracts/
local与真实PTY+stdio回归通过后登记证据，不把切片完成冒充总体完成。

2026-10-07 接续发现并修复：thread/revert 只允许 Paginated Thread，原 CLI/TUI 创建仍为
Legacy，新建 TUI 又仅设置状态栏名字、没有 hydrate 服务端 Thread。现在创建显式请求
Paginated，fresh startup 与 resume 共用 hydrate_thread；现存 Legacy 不伪造可回退支持。
focused complete 真实 PTY 已通过（thread 01a11650-66f6-7130-a18e-1b45c005d7b9，
removed turn turn_70e47f17956a419d919d63cedbcdc04c），此证据早于后续事件缓冲补丁，
最终收尾必须重跑。mode 改动也影响 exec，需本轮 CLI Gate B。

回退刷新重用 bounded ThreadEventStore：从 thread/reverted 边界清旧事件，读取期间保留
新通知与 exact-id 未决请求，canonical hydrate 后重放；失败重试不清这些新事件。只读
preview 随 TurnStarted/ThreadClosed 失效，mutation 不由 UI 取消中止。目标只取 Full 且
已结束 Turn 的第一条 UserMessage，拒绝把 steer、残缺记录或 hidden review 当独立回退。
窄屏 footer 按 first-fitting 候选保留 Enter/Esc。新增真实 stdio 三轮选择/保留前缀/typed
TextElement/文件不变/冷恢复/live-refresh 测试，Gate 强制提取 evidence marker；仍待验收。

最终验收（2026-10-07，1.151.0）：TUI unit1572、suite23、integration1；结构/Gate/fixture/
inventory108/108。Clippy all-targets/no-deps/-D warnings、fmt、ESLint/Prettier、contracts、
docs boundary、diff check均通过。verify:local smart检测73文件，CLI8/TUI1572通过。
inventory1498（Codex1084、Lime414），治理runtime2068/Rust1796/test1356/Rust test197，
零引用候选/分类漂移/边界违规均0。无版本、manifest、依赖或锁文件改动。

完整真实TUI Gate B：thread `01a11664-7ee0-7990-bbc3-cc1983642dbd`，removed turn
`turn_c02161ff93b54c0098ae1a6dbbd259cb`；backtrack/cold-revert-resume/typed-revert/files/
live-refresh/refresh-retry与既有全部场景通过、terminal=restored。同次真实stdio前缀验收
thread `01a11665-bd29-7113-bd62-b0cf8212241b`、preserved turn
`turn_f3d921e0e5304091be5f9d824234b96c`，三轮中选择第二轮回退，原第一轮保留，第二/三轮
删除，TextElement恢复且workspace文件未变；显式新回合真实通知跨刷新/失败重试重放。
IO失败是在UI owner处注入，服务端通知/终态来自真实external backend；旧generation成功
回包不能完成新retry。notification先于response的prompt恢复顺序由稳定unit覆盖。

真实CLI Gate B：thread `01a1165f-9854-7323-a5f9-7e9a0dd6e90c`、turn
`turn_c9978be81f754a2684f931511ffa1b7c`，JSONL/stdin/error-exit1/zsh completion通过。
完整TUI首跑被Cargo编译/锁等待40秒挤占120秒外层时限，未有交互assertion失败；重跑
通过，runner再将cargo test --no-run移到PTY计时前。该runner focused重核通过：thread
`01a11666-a775-76b2-a103-dda5f4cc69ae`、turn `turn_8a3e23b1d12142d597ade224b8ef8a41`；
stdio thread `01a11667-fb0f-7b43-bf9c-2dafa53998f9`，preserved
`turn_f483697fb23f4f2b825f29c6abed87c9`。多轮fixture原固定reasoning/tool ID曾触发canonical
拒绝，现按Turn唯一，unit防回流；没有放松服务端身份校验或延长产品timeout。

Codex HEAD `4aaee872e31abefe0d32e91faab23b09b6968824`；app_backtrack.rs SHA256
`0046e0ab6514b582787f373bf67c20ff95377eec2c62ef9c2191571e1674ae66`。root已确认
architecture.md的host状态/共享typed恢复/原bounded事件store/同一App Server数据流。
current为app_backtrack/history_replacement/shared UserInput conversion/pager领域owner；
原inline pager tests位置与queue重复lowering为dead/deleted，无新增compat/deprecated。
KISS不重建历史文本，DRY共用输入和事件owner，SOLID拆分state/render/IO。发布并行文件
继续避让，本进程未提交/推送/建分支。切片退出条件100%，总体partial/in-progress，无可信
总体分母；Desktop/Windows/live provider/panic未由本轮证明。下一刀：统一历史分页读取。

## 第六十一阶段：历史读取去双轨与分页 owner 收敛（功能/终端验收完成）

主目标继续Codex CLI/TUI全方面对齐。本轮事实源仍为同一App Server metadata、
thread/items/list与thread/turns/list；服务端已支持分页读取Legacy与Paginated存量Thread，
TUI不再以historyMode决定是否走全量thread/read(includeTurns=true)。mode仍由服务端
提供，thread/revert的Paginated限定不变，不伪造存量Thread转换。

窄写集：TUI app_server_session/history、startup/session_lifecycle/reconnect、history_pagination、
projection/history 与生命周期接线、thread_transcript、composer replay page API、
resume_picker_transcript_preview及实际调用、对应定向/真实history/reconnect PTY fixture、
focus_palette 既有 PTY 观察 helper、既有结构/
inventory守卫、architecture/commands/ops/本计划。App Server/backend/protocol只读，
GUI、发布manifest/锁文件/发布计划继续避让。

退出条件：resume初始页、picker预览和完整transcript/导出都采用bounded canonical分页，
删除旧Legacy全量分支与未使用包装/重复入口，不新增compat；存量历史仍可读；跨页顺序/
review/完成态/游标/失败/切Thread保持原合同。分页metadata一致性失败不得回退未经
验证的完整历史或猜测事实。定向Rust、真实Legacy+Paginated history PTY、结构/contracts/
local通过后登记证据；本阶段未验收完成。

实现接续：所有存量 mode 统一 canonical 分页；旧全量 reader、无引用包装与 flat
fallback 直接删除。Turn metadata IO 失败作为整页失败，初始页和 older event result
将 items/Turn Vec 一起传递，不再允许成功页缺元数据。projection/history 恢复 active/
closed identity、隔离旧 delta 和 usage；review 过滤先于 preview 六行预算。history suite
原 1132 行拆成 scenario root 与 fixtures；fake remote 返回与 item 页一致的 Full Turn
facts，并覆盖 item IO 与 metadata IO 两种失败。reconnect fixture 迁为 metadata-only
resume + canonical items/turns，禁止依靠 response 内嵌 turns 通过。

初轮真实 history Gate 已通过：Paginated `01a116a1-61f6-7c20-bfe8-795ca22de1de`，
3页207items；Legacy `01a116a1-338c-7570-8a27-5ad1084c6b95`，2页102items；
review=nested-filtered、underfilled=auto-filled、alternate-screen=restored。
此证据早于 required Vec 接口与 reconnect fixture 改动，最终验收须重跑。当前 unit1573/
suite23/integration1、定向结构83通过，完整 Gate/Clippy/contracts/local 尚待完成。

复跑夹具修复：race 初始一条短消息会触发真实 startup underfill，可能在 Find 打开前
提前断线；改为填满初始视口，让显式 Home 触发旧页 IO，underfill 仍由真实 stdio 单独
覆盖。搜索重连以最终“reconnected”footer作重绘屏障，不能只等顶部新历史 substring。
既有 PTY helper 在 child exit 后先读到 reader EOF，再检查恢复序列；不放宽恢复断言或
用 sleep 合成成功。v2-v4 的真实失败保留在 /tmp 日志；v5 的 helper import 编译失败已修正，
最终验收使用 v6 及 fresh full Gate。

最终验收（2026-10-07，1.151.0）：TUI unit1573/suite23/integration1，结构/Gate/fixture/
inventory109/109；Clippy all-targets/no-deps/-D warnings、fmt、ESLint/Prettier、contracts、
docs boundary、diff check与verify:local全部通过。local smart87文件，CLI8/TUI1573；
inventory1500（Codex1084、Lime416），治理runtime2068/Rust1798/test1356/Rust test198，
零引用候选/分类漂移/边界违规均0。manifest、版本、依赖、锁文件无变更。

真实 history Gate v6：Paginated `01a116b1-fd77-74e3-a5a6-f6f4886e0a3f`，3页207items；
Legacy `01a116b1-cf08-7921-b94a-aae94d27051e`，2页102items；nested review、underfill、
item/Turn metadata失败重试、切Thread/reconnect竞态与alternate-screen恢复通过。
完整 fresh TUI Gate：thread `01a116b2-694c-79d0-ae78-58ea822800aa`，turn
`turn_ad8e8a5f10844ab6a9a432834ea391f0`，既有全部场景、reconnect与terminal=restored；
同次 backtrack stdio thread `01a116b3-92f7-7c30-9ec8-2804ec3033ba`，preserved turn
`turn_61bc641c5e594813ae2bee43c093d013`，canonical前缀/typed恢复/live-refresh/retry通过。
真实CLI Gate：thread `01a116b4-2637-7111-aebb-61f19944e327`，turn
`turn_b632d4a59f134a7eb8b4f45dc61bb49e`，JSONL/stdin/error-exit1/zsh completion通过。

Codex HEAD `4aaee872e31abefe0d32e91faab23b09b6968824`；thread_transcript SHA256
`2edb024b1c844d345ba207fe9be7755d6fec2bc578ae5d2e2366ff28726162a1`；preview SHA256
`44f987898876ef457a7a915dcf566570bc138b235f3f53a44705bde25cb492c8`。
root已确认architecture.md的统一分页/required Turn facts/lifecycle接线，无新业务后端。
current为canonical page/projection facts/单一reader；旧Legacy全量分支、无引用包装、
optional元数据与flat fallback为dead/deleted；PTY夹具和观察helper为test-only。
无新增compat/deprecated。KISS拒绝猜测metadata，DRY统一成功页shape，SOLID分离IO/
投影与PTY观察。切片100%，总体partial/in-progress，无可信总体分母；Desktop/Windows/
live provider/panic本轮未新增证据。

## 第六十二阶段：推理摘要事实与默认隐藏原文（功能/终端验收完成）

下一刀直接服务显示对齐。Codex默认隐藏raw reasoning，Lime当前把ReasoningTextDelta
追加到摘要，并在summary为空时用content替代，会污染status/pager/export。
本轮只对齐默认显示语义，不假称已支持Codex的显式show_raw_agent_reasoning配置。
事实源仍为App Server typed summary/content；不改GUI、provider、protocol或后端。

窄写集：TUI projection/items与streaming拆分、root最小dispatch、entry空摘要绘制、
专用unit/既有结构守卫、inventory、架构/ops/本计划。projection root原1446行，先迁出
canonical lowering与streaming职责，使其回到1000行以内；旧位置直接删除，无包装层。
退出条件：raw delta不修改摘要/status，raw-only历史不显示或导出原文；summary在live/
canonical hydrate后一致，完成/closed Turn拒绝迟到事件；专用回归/crate/结构/Clippy/
contracts/local与fresh终端Gate通过后登记。显式raw配置及其它未对齐项继续partial。

实现：canonical lowering原位迁到projection/items，delta/摘要分段/status标题迁到
projection/streaming，root1446 -> 814行；items536行，streaming118行，旧位置直接删除。
ReasoningTextDelta默认不修改摘要或status，canonical只读取summary；raw-only项保留
identity但不渲染空bullet，export跳过空内容。三条typed回归证明raw-first/interleaved、
完成与closed后迟到事件、live/cold hydrate与实际entry renderer/export的默认隔离。
没有引入无consumer的RawReasoningVisibility::Visible、私有config或第二read model。

最终验收（2026-10-07，1.151.0）：TUI unit1576/suite23/integration1、结构/Gate/fixture/
inventory110/110；Clippy all-targets/no-deps/-D warnings、fmt、ESLint/Prettier、contracts、
docs boundary、diff check、verify:local全部通过。local smart92文件、CLI8/TUI1576；
inventory1503（Codex1084、Lime419），治理runtime2068/Rust1801/test1356/Rust test198，
零引用候选/分类漂移/边界违规0。manifest、版本、依赖与锁文件未变。

fresh完整TUI Gate：thread `01a116bd-04d6-72e1-b8d8-10c57f6f0b42`，turn
`turn_6356d0b61141423390b02a460906bc64`；所有既有输入/摘要详情/typed历史/回退/重连/
status/title/footer/PTY键盘及terminal=restored通过。stdio回退前缀thread
`01a116be-2814-74a0-9f5c-14ab87fe39f3`，preserved turn
`turn_8096f955268e4fdb9a12dd046cb56649`。raw隔离的专门证据为typed unit、renderer与export；
本阶段fresh PTY为总体回归，未注入raw delta，不升级成该场景的live provider证据。
CLI Gate仍为第61阶段同代码主链的证据，本阶段没有新增CLI或Desktop Gate。

Codex HEAD仍`4aaee872e31abefe0d32e91faab23b09b6968824`，chatwidget/protocol.rs SHA256
`46809d852877902c958f47d7f266ece94d59b0f863e3e9dd2673954ca0673a6e`；root已确认
architecture.md的items/streaming/default hidden policy数据流和GUI/TUI共享canonical合同。
current为领域projection/entry renderer；旧inline转换与streaming位置、summary为空时
raw fallback为dead/deleted；无新增compat/deprecated。KISS不把原文伪装摘要，DRY单一
canonical lowering，SOLID分开事实转换、流式状态与绘制。
本切片100%，总体partial/in-progress，无可信总体分母。显式raw配置、Desktop/Windows/
live provider/panic及其余defer未由本轮完成；下一刀核对推理摘要布局与显式显示配置owner。

## 第六十三阶段：摘要分段与实际 HistoryCell 渲染对齐（功能/终端/桌面回归验收完成）

主目标仍为 Codex CLI/TUI 全方面对齐。本轮先补用户可见正文布局：Codex 的
split_reasoning_summary_parts 保留段落、移除独立空注释占位，并只拆首个带换行的
bold 标题。状态 latest_summary_line 已逐行核准一致，继续读原始结构化摘要；正文
不能反向成为状态事实。现有 ReasoningSummaryCell 没有生产消费者，应直接接入
TranscriptHistoryCell 的 expanded/transcript 渲染，删除原通用 adapter 壳和重复绘制。

窄写集：TUI projection/reasoning、streaming/items 与最小 dispatch、ActivityDetail
必要事实字段及既有测试机械迁移、history_cell/reasoning/messages/mod、entry 最小
渲染委托、专用摘要回归、真实 PTY 观察 helper、terminal external fixture、既有结构/
inventory 守卫和 architecture/commands/ops/本计划。共享 protocol/runtime/config、GUI、
manifest/锁文件只读；不新增 raw 配置 stub 或私有开关。

退出条件：canonical/live/reconnect 共用一个 parts -> body 转换；summaryIndex 保留
且重复 part-added 不破坏内容；空占位不泄露标题/空 bullet，bold-only 和 literal HTML
comment 不误删；raw 默认仍隐藏，canonical completion 与 closed Turn 拒绝迟到 delta。
实际 cell 保留 cwd/链接、窄屏包装和 transcript-only 行为；定向/crate/结构/Clippy/
contracts/local 及 fresh PTY/stdio 通过后登记证据。当前未完成，不宣称总体对齐完成。

真实 PTY 初跑发现重复正文/标题。只读 stdio 诊断证明 typed item/started 的四个 summary
parts 在 item/completed 和 thread/items/list 变成八个，根因在 App Server materializer：
canonical reasoning lifecycle payload 没有 envelope source_event_type，后续两个既有 merge
owner 将完整 snapshot 当 delta append。扩大窄写集到 App Server materializer 的
canonical reasoning metadata 边界及 incremental 专用回归；不改 protocol/schema、
GUI renderer、两个既有 merge owner，不在 TUI 去重正文。shared canonical 修复必须补
current runtime fixture/GUI smoke/contracts 与真实 stdio 读回证据。

PTY root 与 projection_tests 原已超过 1000 行，本轮仅做 helper dispatch/事实字段的必要
机械接线；新测试/观察逻辑独立进入 reasoning/专用文件，不向大文件追加业务。退出条件
是后续沿 runtime_pty_tests scenario 拆分继续压缩 root，当前不以此宣称整体结构已完成。

2026-10-08 接续：完整 fresh TUI Gate B v3 已通过，thread
`01a119a0-e5ab-7a43-aa7e-ec651fbec98d`、turn
`turn_d73553de0c954b229b9e37b5c2ef095b`；reasoning-parts、既有全部场景与
terminal=restored。真实摘要 stdio thread `01a119a2-09b8-78e1-b555-a55efa0af3c7`、
turn `turn_b341d42b25b242a693b91c60bcf37156`，notification/canonical/cold-resume/raw-hidden
均通过，日志 `/tmp/lime-tui-stage63-full-gate-v3.log`。TUI strict Clippy all-targets 及
contracts 最终复核通过；App Server strict Clippy 当次有 158 项诊断，其中 materializer
文件的原有 is_read_file_marker 仍有 lint，本轮新增 snapshot metadata 语句无诊断，
不宣称全 workspace lint 全绿。
current runtime 聚合失败截图证明 Skills 页仍走隐藏旧顶部 tab；夹具现迁到真实可见
`app-sidebar-customization-skills`，同步既有守卫。最终 fresh 聚合已在第64阶段通过，
包括 Skills/Experts 的 current 侧栏点击；不是复用 BUILD_READY=1 的旧 sidecar 证据。

收口分类：indexed parts/正文转换/实际 ReasoningSummaryCell 与 shared materializer 为 current；
原 inline reasoning 位置、generic adapter 和隐藏旧 tab 的正向点击为 dead/deleted。
无新增 compat/deprecated。KISS 保留结构化 facts，DRY 共用正文转换，SOLID 分离正文绘制
与共享持久化。切片退出条件100%；总体 partial/in-progress，无可信总体分母。
Desktop 摘要默认隔离的独立证据由第65阶段给出，不能当成 sparse parts 的桌面专项证明。

## 第六十四阶段：运行中摘要 replay 与无 started 增量恢复（功能/终端/桌面回归验收完成）

主目标不变。Codex chatwidget/replay 只将 InProgress Turn 的尾部 Reasoning 暂存为
provisional；首次更新可以没有 item/started，新 non-user item 开始时收尾旧尾部。
Lime 分页路径只有 Turn 身份恢复，摘要 status 缺失且后续 delta 被 streaming=false 拒绝。
本轮在现有 projection/history 收敛 hydrate/replay 生命周期，复用同一 indexed parts
和 canonical completion；provisional 仅为 terminal host 状态，不伪造持久化完成事实。

窄写集：TUI projection/history、reasoning 恢复领域、root 最小生命周期/dispatch、
app/history_pagination 接线、专用 unit/真实恢复测试、既有 Gate/结构/inventory 守卫与
architecture/commands/ops/本计划。共享 App Server/protocol/config、GUI 产品组件、
manifest/锁文件/发布文件只读。前序脏文件继续保留。
退出条件：分页 resume/reconnect 的尾部摘要状态和正文一致，旧 Turn/非尾部已完成项
不能被旧 delta 重开；首次 summary/part/completion 无 started 可恢复；新 item/terminal/
切 Thread 清 provisional，重复/较旧 page 不覆盖 live 进度。raw 默认隐藏不变。
定向/crate、真实 PTY/stdio 恢复与结构/contracts/local 通过后登记，未验收前不标完成。

真实 stdio 首轮暴露共享通知文本 trim：summary delta `" STDIO_RESUMED_DELTA"`
被投影为 `"STDIO_RESUMED_DELTA"`，live 正文与 canonical 读回不一致。扩大写集到
App Server v2_notifications 的 reasoning/text parsing owner：identity parsing 仍独立 trim，
body/summary/raw delta 原样保留空白和空 delta；不让 TUI 补空格或放宽正文断言。
原 v2_notifications.rs 1993 行，先迁 reasoning projector，并将既有 inline tests 按
reasoning/model/core 分开，旧位置直接删除；所有新 owner 必须低于 800 行。
GUI fixture Skills 和 Expert Plaza 两条导航从隐藏旧顶部 tab 迁到 current 侧栏，旧正向
guard 同步替换，无 GUI 产品组件或兼容入口改动。剩余聚合场景按原配方续跑。

实现与初核：TUI root hydrate 迁到 projection/history，root 760 行，history 190 行左右；
只恢复 Full/InProgress 的尾部摘要，Summary preview 不推断 active tail。新增 replay
回归覆盖无 started 的 delta/part/completion、重复 start、旧页、非尾部/closed item 和
不同 item 收尾。App Server root 1993 -> 700 行，tests/core 729、model 364、reasoning 196、
reasoning producer 87，旧位置删除。53 项 shared notification 回归、195 项结构/fixture
守卫、contracts、governance 均通过；ESLint/diff check 通过。全 crate 初核1591/23/1通过，
后补 Summary view guard 尚待最终 local 重验。初轮新 Gate 的 borrow/2024 let-chain 编译
问题已改为 2021 兼容写法；focused v2 的文本空白失败保留于日志，用 shared owner 修复，
没有降低断言。最终真实 stdio 已见恢复成功 marker，完整 Gate 尚在运行。

GUI 聚合的失败已分段续验：Skills、MCP structuredContent、media reference、Expert Plaza/
Expert Panel、typed-error success/failure、content-factory article 均通过各自真实 Electron
配方。Skills 证据 `claw-chat-current-fixture-skills-runtime-stage63-summary.json`，专家等
续跑日志 `/tmp/lime-tui-stage63-runtime-fixture-tail-v2.log`。这些证明原隐藏标签导航缺口
已修复；证据早于本阶段 shared whitespace 最终补丁，最终 GUI/current-fixture 门禁待补。

完整 Gate 首轮的真实 stdio parts/resume 均通过，但新 PTY restore status 失败：runtime
重连成功后的 set_status("reconnected") 清空了刚恢复的 reasoning_status。现在使用 history
owner 的 on_reconnected 保留 canonical 摘要优先级，原非摘要场景的 reconnected 文案仍
保留；runtime 仅一行接线，专用 replay unit 同步覆盖。首轮失败日志保留，最终必须重跑。

最终终端接续（2026-10-08，1.151.0）：完整 fresh TUI Gate B 通过，日志
`/tmp/lime-tui-stage64-full-gate-final.log`；PTY thread
`01a119c6-00e9-7511-87aa-f808d3505a77`、turn
`turn_ff484eb64fe24d4ebb497cdcaffc3205`，reasoning-parts 与所有既有场景、terminal=restored。
真实摘要 stdio thread `01a119c7-1a59-7fd0-97af-21ceb3d0dfde`、turn
`turn_0b0ba01f826a4fbb965c62d51f337cba`，notification/canonical/cold-resume/raw-hidden 通过；
真实恢复 stdio thread `01a119c7-1f18-7c12-891f-aed2cbc1f320`、turn
`turn_dae1f333ba62497e9b3cf5d3cf70b2c8`，metadata-resume/page/no-started/canonical/terminal
通过。恢复 PTY 证明 snapshot status、无 started 增量、Ctrl+T detail、raw 隐藏和终端恢复；
它使用真实 PTY + test-only WebSocket server，实际 App Server 由前述独立 stdio 场景证明，
不能冒充同一次 PTY 经过真实 App Server 的专项摘要恢复证据。

真实 CLI Gate B 同步通过，日志 `/tmp/lime-tui-stage64-cli-gate-final.log`；thread
`01a119c7-d8fe-73c0-8e06-4ef5cc31c96b`、turn
`turn_543b85ad3eea4539894966936bb15e71`，JSONL/stdin/error-exit1/zsh completion 通过。
最新结构/fixture 守卫196/196（含 shared notification owner 行数守卫）；verify:local
通过 App Server1791、CLI8、TUI1592；TUI strict Clippy all-targets/no-deps/-D warnings 通过。
App Server strict Clippy 最终为 lib122/lib-test152 项诊断，日志
`/tmp/lime-tui-stage64-clippy-server-final.log`；reasoning 通知 owner 和迁出的测试无诊断，
materializer 的原有 is_read_file_marker lint 未清理，不提升为 workspace lint 全绿。
GUI 聚合重新构建 renderer/host/App Server，未使用 BUILD_READY 跳过 freshness；最终
`npm run smoke:agent-runtime-current-fixture` 整体通过，日志
`/tmp/lime-tui-stage64-current-runtime-final.log`。覆盖22项真实 Electron 配方，包括首页
首发、Coding Workbench、图片、停止/继续、审批、rich draft/steer、Plan、Skills、MCP、media、
Experts、typed error retry success/failure 与 Article Editor；liveProviderUsed=false。
最后 article Thread `01a119cf-3b6d-7a13-b4ef-f57db30e8382`。这是最新共享后端的桌面回归，
不冒充桌面运行中摘要 reconnect 的专项证据；独立 reasoning 显示专项见第65阶段。

current 为 projection/history 生命周期/同源 indexed parts、shared reasoning notification owner；
旧 root hydrate、inline reasoning projector/tests 位置为 dead/deleted；恢复屏障、WebSocket
server 和 PTY observer 为 test-only。无新增 compat/deprecated，无 protocol/schema、版本、
manifest、依赖或锁文件变更。root 已确认 architecture.md 的数据流，GUI/TUI 共享同一
canonical owner；KISS 不猜完成态，DRY 统一 replay 与正文保真，SOLID 分离历史和通知职责。
切片退出条件100%；总体 partial/in-progress，无可信总体分母。App Server strict lint 基线、
显式 raw 配置、Windows/live provider/panic 与桌面运行中摘要恢复专项仍未完成。

## 第六十五阶段：桌面推理专项夹具与默认显示策略收敛（验收完成）

第64阶段最新 renderer/host/App Server 重建后的 current-runtime 聚合已通过，额外执行
reasoning-first-visible 真实 Electron 专项暴露旧正向断言：展开详情必须显示 raw content。
当前 GUI reasoningDisplayText 与 AgentThreadTimeline.reasoning 回归已经明确只显示摘要，
包括展开/冷 hydrate；失败截图中摘要/最终回答可见、输入可用、终态正常、raw 未显示。
该夹具属于 rewrite，不恢复已清理的 raw fallback，也不把失败报告提升为产品通过。

窄写集：现有 GUI completion waits 的推理观察逻辑迁到 scripts/agent-runtime/reasoning-fixture，
scenario-flow 的推理 read-model 汇总一起迁出；现有 runtime-surface-assertions、smoke guard
和新增专用夹具回归、执行计划。产品 GUI、Rust、协议、配置和发布文件只读。
原 waits1245/scenario-flow1018 行，不继续在大文件追加分支；旧位置直接删除，调用直迁，
无 compat re-export。read model 保留完整 summary/content，DOM 默认隐藏 raw。

退出条件：真实 Electron 证明摘要先于回答可见、完成后可展开、摘要只出现一次、raw 在
展开后的 DOM 中也不存在，canonical read model 仍保留原文；纯 predicate 回归拒绝原文
泄漏/重复摘要/未展开，结构守卫防旧断言回流；定向 fixture 与 GUI shell smoke 通过。
current-runtime 已验证的其它场景不受该 test-only owner 迁移影响，无新业务后端。
退出后仅本切片可标100%，显式 raw 配置和其余 Codex 差异继续 partial。

最终验收（2026-10-08）：新 reasoning-fixture 354行，generic waits1245 -> 972，
scenario-flow1018 -> 965，旧位置直接删除，调用直接迁移。完成/展开的 predicate 要求
summary occurrences=1、raw visible=false、raw DOM=false；read model 原文完整性仍为
必需断言。5项专用回归、83项既有 fixture guard 和15项 GUI reasoning 组件回归，103/103
通过；ESLint、Prettier、scripts governance、fmt/diff check 通过。Rust/product/protocol 未改，
沿用第64阶段相同源码的 local/contracts/Clippy 与真实终端证据，不无差别重跑 crate。

独立真实 Electron Gate B controlled fixture 通过，Thread
`01a119d3-cc1d-7d72-8ba4-96215831e541`；摘要在最终回答前可见，完成后真实点击展开，
正文只出现一次，raw visible=false/raw DOM=false，canonical summary/content 均保留，
console/page/invoke errors=0。证据
`.lime/qc/gui-evidence/claw-chat-current-fixture/claw-chat-current-fixture-reasoning-stage65-final-summary.json`，
日志 `/tmp/lime-tui-stage65-reasoning-electron-final.log`；页面为真实 Electron 的
`file:///.../dist/index.html?nativeStartup=1`，截图已人工视读。旧失败证据仍保留为 stage64-final，
没有覆盖失败或恢复 raw fallback；本证据不证明显式 raw 开关或 live provider。

`npm run verify:gui-smoke` 通过，run_id
`standalone-shell-01-20261008044553-43631`；当前 shell、Claw reload、三种 viewport 与 memory
settings 均通过，结构化 summary 为 pass，日志 `/tmp/lime-tui-stage65-gui-smoke-final.log`。
它是通用 shell 回归，独立 reasoning 场景由前述专项证据证明。

current 产品显示仍由既有 reasoningDisplayText/AgentThreadTimeline 承接；新的 Electron
observations/predicate/read-model summary 为 test-only；旧 raw-expanded 正向断言、两个
大文件中的重复 owner 位置为 dead/deleted，无新增 compat/deprecated。KISS 区分完整事实
与可见摘要，DRY 共用一个观察 owner，SOLID 分开通用等待与推理领域。
本切片100%；总体仍 partial/in-progress，无可信总体分母。下一刀迁移该专项 backend
仍混用的 reasoning.started/final/ended 与 flat item.updated fixture 到 canonical typed Item
lifecycle，并替换旧正向 guard；当前 read-model collector 在专项报告中计数2，不能用
DOM 摘要一次冒充“仅一条 canonical Reasoning Item”已被证明。显式 raw 配置、桌面运行中
摘要恢复、Windows/live provider/panic 与其余 UI/结构差异继续待办。未提交、推送或建分支。

最终边界复核：test:contracts（含 docs boundary/scripts governance）与 legacy-report 均通过；
日志 `/tmp/lime-tui-stage65-contracts-final.log`、`/tmp/lime-tui-stage65-governance-final.log`。
治理扫描2068/Rust1810、test1356/Rust-test198，零引用候选/分类漂移/边界违规均0。
本轮技能分别约束 current/dead 分类、按风险续验与 Gate B claim boundary；没有扩张为
生产 mock、私有配置或第二业务后端。

## 第六十六阶段：桌面推理 canonical Item 身份与历史恢复（验收完成）

主目标仍为 Codex CLI/TUI 全方面对齐、GUI/TUI 共享后端。本轮将 reasoning-first-visible
external fixture 的 reasoning.started/final/ended 与 flat item.updated 双入口直接替换为
canonical typed Item 生命周期。Codex HEAD 仍为 4aaee872e31abefe0d32e91faab23b09b6968824，
其 protocol/replay 以同一 Item ID 处理 started、摘要增量与 completed；raw content 默认隐藏。

窄写集：scripts/agent-runtime 的 reasoning backend/observations、scenario-flow 最小委托、
runtime-surface assertions、constants assertion keys、smoke guard、专用回归与本计划。
共享产品 GUI/Rust/protocol/config/manifest/锁文件只读。唯一业务事实源仍是 App Server
canonical Thread/Turn/Item；新模块只承接 test-only producer/观察，不建立兼容包装。

先用公共 thread/read 记录 canonical turns/items 的真实 ID 与顺序，核实第65阶段计数2
是否源自 collector 重复或实际不同 Item；不得文本去重、选取一条掩盖重复或降低断言。
producer 从超1000行 backend-script 迁出，旧分支直接删除；当前 v2 typed Reasoning 没有
status/sequence wire，终态从所属 Turn 与同 ID lifecycle 验证，顺序使用 canonical Item 排列。
增加真实 Electron renderer 重载、侧栏恢复与 fresh thread/read，核对同一 Thread/Turn/Item、
summary/content 原样保持、摘要一次且展开后 DOM 无 raw。

退出条件：无旧 reasoning lifecycle producer；每个 canonical Turn 恰好一个推理 Item、
同 ID started/indexed summary delta/raw delta/completed；冷 renderer 恢复身份/顺序/内容
与 live 完成一致。v2 没有 item/updated 通知，不能用 snapshot update 冒充 live 摘要；
增量只使用现有 reasoning.summary/reasoning.delta lowering，终态用完整 typed snapshot。
定向 fixture/结构守卫、真实 Electron 专项、contracts/scripts governance/legacy-report 通过，
按风险补 local/GUI smoke。该切片验收前不标完成；总体仍 partial/in-progress。

当前环境为1.152.0，已不同于第65阶段1.151.0历史证据。初次fresh基线因官方V8产物
下载120秒超时/retry失败，未到达Electron，不判定旧canonical计数根因。使用同一官方URL
完整下载后，通过仓库resolveRustyV8CargoEnv的SHA256校验；未改下载实现/依赖/锁文件。
随后fresh sidecar触发仓库1.95.0工具链准备，持续验收中。92项定向回归、ESLint/Prettier、
contracts与legacy-report通过。verify:local smart成功但为脚本改动选中0项任务，只算入口
通过，不冒充额外Rust/GUI测试。backend原1257 -> 1130行、router965 -> 938行；新业务已
迁出大文件，backend余下场景待后续按owner继续拆，不宣称整个文件结构已收口。

最终验收（2026-10-08，1.152.0）：旧 producer 隔离重放证明计数2是实际两个不同
canonical ID，非 collector aliases 重复：`turn_31ba9723fea547d79d04d448baebb8c4:reasoning:first-visible`
与 `reasoning-turn_31ba9723fea547d79d04d448baebb8c4`。原 reasoning.final 仅传 reasoningId，
materializer explicit_item_id 不消费该旧字段，落到 family fallback；flat item.updated 又
提供另一条显式 ID。诊断从 git history 只读提取旧 producer 到隔离 external fixture，
current 源码未恢复旧入口。严格断言按预期拒绝该4-Item历史，证据
`.lime/qc/gui-evidence/claw-chat-current-fixture/claw-chat-current-fixture-reasoning-stage66-old-producer-diagnostic-summary.json`；
日志 `/tmp/lime-tui-stage66-old-producer-diagnostic-v2.log`。该失败为有意重现，不计为current通过。

新 test-only reasoning-backend 110行：typed item.started、明确 itemId/summaryIndex 的
reasoning.summary、明确 itemId/contentIndex 的 reasoning.delta、完整 typed item.completed。
这些增量直接 lowering 到 current v2 indexed通知，不使用旧 reasoning.started/final/ended
或 flat item.updated，不添加 compat。canonical completion snapshot 原样保留 summary/content；
raw delta 实际经过通知链，GUI默认仍隐藏。reasoning-fixture474行，原backend1257 -> 1130、
router965 -> 938；旧 inline producer与正向guard已删除，归属单一领域owner。

最终真实 Electron Gate B controlled fixture 通过，Thread
`01a11c08-469f-7ba0-9f26-0dfdab7315ea`、Turn `turn_94711233509d44ba87782d17e403c928`。
公共 thread/read 的唯一目标Turn恰好3个Item（user/reasoning/final），Reasoning ID为
`turn_94711233509d44ba87782d17e403c928:reasoning:first-visible`；身份与GUI Thread/backend Turn
逐项匹配，summary/content精确相等，顺序1/2。Renderer document reload后从真实侧栏恢复，
fresh thread/read的Thread/Turn/Item IDs、顺序与完整内容保持不变；真实点击展开、摘要一次、
rawVisible=false/rawInDom=false，console/page/mock/legacy命中为0。8项scenario assertions
全通过，截图已视读。证据
`.lime/qc/gui-evidence/claw-chat-current-fixture/claw-chat-current-fixture-reasoning-stage66-final-v4-summary.json`，
日志 `/tmp/lime-tui-stage66-reasoning-electron-final-v4.log`。该恢复为Renderer冷hydrate，
未重启App Server，不冒充后端进程冷恢复或live provider证据。

验收继续使用freshness检查，未设置BUILD_READY跳过；renderer/host重建，sidecar复用
检查确认fresh的1.152.0 packaged App Server/code-mode-host，显式APP_SERVER_BIN只选同一
current二进制。第一次源码target构建因隔离HOME重复下载Rust而中止；随后使用host Cargo/
Rustup缓存的target构建也需补缺失crates，已中止，未改变依赖/锁文件或产品配置。
标准npm verify:gui-smoke的强制target重建路径因此未完成；经同一ensureElectronFixtureBuild
重新确认所有packaged artifacts fresh后，直接执行该入口的scripts/electron/smoke.mjs通过：
run `standalone-shell-01-20261008145831-46292`，shell/Claw reload/三viewport/memory settings
全部pass，日志 `/tmp/lime-tui-stage66-gui-smoke-fresh-artifacts.log`。不把中止的标准命令写成通过。

最终11项专用回归（含真实generated backend JSON stdin/stdout）、83项fixture结构守卫，
94/94通过，日志 `/tmp/lime-tui-stage66-reasoning-tests-final.log`。contracts（含docs boundary）、
scripts governance、legacy-report、ESLint/Prettier/diff check通过；治理零引用候选/分类漂移/
边界违规0。verify:local smart为0项任务，产品Rust/GUI/protocol未改，不重跑无关crate或
22项聚合配方。未新增用户文案、配置/schema、版本、manifest、依赖或锁文件。

current 产品owner/GUI-TUI共享架构不变；新producer/观察/identity predicates为test-only；
旧双入口及guard为dead/deleted，无新增compat/deprecated。KISS单一生命周期，DRY复用
同一观察与内容验证，SOLID分开producer/GUI观察/通用router；属于测试边界迁移，未变更
public owner或架构依赖方向。本切片100%；总体partial/in-progress，无可信总体百分比分母。
下一刀回到TUI推理显示的显式raw配置与实时/replay消费对齐，必须落共享配置owner并验证
GUI/TUI兼容，不预建私有开关。桌面运行中摘要恢复、Windows/live provider/panic以及其余
输入框/显示/命名/目录差异仍待推进。未提交、推送或建分支。

## 第六十七阶段：共享原始推理显示策略（专项验收完成；全量前端续跑完成）

主目标仍为 Codex CLI/TUI 全方面对齐。本轮对齐 Codex 的全局
`show_raw_agent_reasoning`：默认 false，显式 true 才把 canonical content 接入实时、
历史恢复、分页和导出；摘要与原文保留各自索引，不混成另一套 canonical Item。
核准 Codex 的 `hide_agent_reasoning` 只被 exec human-output 消费，本轮不预建无消费者字段。

窄写集：core Config 字段/default、App Server config 根字段与公开协议测试、TS Config
与 GUI display policy/真实消费者、TUI LocalSettings/projection/history/streaming、相关
stdio/PTY 与 Electron fixture，以及 commands/ops/本计划。第66阶段已知改动保留。
唯一事实源为共享 core Config 和 canonical Thread/Turn/Item；已有 config/read、
config/value/write、config/batchWrite 承接，不新增命令、Host 白名单或私有偏好存储。

超1000行的 core/config/types.rs 只同步字段/default，不追加业务分支；后续按配置领域
迁出类型/default 为退出条件。runtime.rs 只接入启动期已解析 snapshot，不堆逻辑，
后续运行循环与 exec owner 拆分仍为退出条件。GUI 大 handler 仅更新过时注释，raw 增量
已由 current conversationProjection reducer 保留，不另写一套流状态。

退出条件：默认 GUI/TUI/raw-only/恢复不泄漏；显式配置在 live indexed raw delta、
completed canonical snapshot、运行中恢复、旧页与 export 一致；非法配置 fail closed。
先跑定向 Rust/TS、公开 config JSON-RPC，再补真实 stdio/PTY 和 Electron current fixture、
contracts/治理/本地门禁。切片证据分级记录，总体仍 partial/in-progress。

2026-10-09续跑：共享配置/GUI/TUI实施完成。旧ReasoningSummary原位改为ReasoningText，
summary/raw独立索引，默认隐藏、显式允许才展示；live、canonical completion、运行中
resume、旧页、完整记录和导出共用同一策略。GUI仅用显示context消费既有canonical
projection；异步revision防旧读取覆盖，读取失败隐藏，不创建流缓冲或第二store。
config/read、value/write、batchWrite继续承接；公开write的null是删除键、恢复false默认，
非法string/number被拒绝。GUIgateway形状校验不宽松转换boolean。

本轮target源码构建成功，真实stdio双策略标记通过，日志
`/tmp/lime-tui-stage67-raw-gate-b-v3.log`。false Thread
`01a11e9e-cadc-7830-a426-7ac3ef2e7ced`/Turn `turn_7b329ec6bf254687b5766bf088178066`；
true Thread `01a11e9e-ceb2-70d3-ae71-6de76b2c55b4`/Turn
`turn_7492d4482b0b491db7a935fbb16fc46f`；Item为`item_terminal-reasoning-<turnId>`。
live/resume/cold/export/canonical全部ok，raw通知实际到达。真实PTY的false/true均完成
live/Ctrl+T记录页唯一显示/alternate screen恢复/退出；前两轮失败仅为测试对记录页的
开关等待错误，已改用真实screen predicate，没有改产品按键、固定sleep或降低内容断言。

真实Electron Gate B使用本轮fresh App Server通过，Thread
`01a11e96-4c29-75a2-9c01-b9e99523b8c4`、Turn `turn_ba68b63c8d73416e8edfe0865abbea36`，
唯一Reasoning为`turn_ba68b63c8d73416e8edfe0865abbea36:reasoning:first-visible`。
默认摘要先可见、展开无raw；公共config/batchWrite开启raw后renderer重载/真实侧栏恢复，
summary/raw各一次，canonical IDs/顺序/完整内容保持；关闭再恢复后raw DOM/visible均false。
console/page/mock/legacy命中0，证据
`.lime/qc/gui-evidence/claw-chat-current-fixture/claw-chat-current-fixture-reasoning-stage67-summary.json`，
最终关闭raw截图已视读。日志`/tmp/lime-tui-stage67-electron.log`。开启raw的GUI证据是
历史恢复，未冒充另一轮GUI live输入。controlled external backend，不冒充live provider。

Agent Runtime聚合current fixture通过；标准`npm run verify:gui-smoke`通过，run
`standalone-shell-01-20261009030543-72836`，shell/Claw reload/三viewport/memory settings
全部pass，日志`/tmp/lime-tui-stage67-runtime-fixture.log`、`/tmp/lime-tui-stage67-gui-smoke.log`。
未设置BUILD_READY绕过，renderer/host与App Server/code-mode-host均检查fresh或重建。
完整TUI首次1595通过；最终reasoning41、配置公开JSON-RPC1、前端cleanup33通过。
contracts/typecheck/legacy/scripts governance通过；context/hook已从component拆出，
消除两项react-refresh警告，后续严格门禁重新验证。

标准verify:local发现既有13项unused错误，目标文件原为干净基线；窄补丁仅删除侧栏三份
tests中的12个unused imports及任务页已无UI consumer的formErrors镜像state/write/type，
现有纯validation与toast保留，Dialog仍拥有可见field errors。不新建规则/disable/假消费者。
相关已有测试和local门禁待最终结果；首次失败日志仍保留为`/tmp/lime-tui-stage67-local.log`。

## 第六十八阶段：非交互 exec owner 与推理输出（专项验收完成）

主目标继续为全维度Codex对齐。核准当前Lime CLI经`tui::run_exec`进入近2000行的
interactive runtime，再使用TUI ConversationProjection选择结果；human stdout只有最终
回答、stderr从不消费Reasoning。Codex exec有独立event processor，completed Reasoning
按hide_agent_reasoning/show_raw_agent_reasoning选择输出，raw允许时优先content，否则summary。
该语义与TUI的summary后接raw不同，不应复用TUI renderer。

窄写集：cli现有owner内的exec/event_processor/human_output与main最小接线；直接删除
tui runtime中的非交互实现、types/exports及迁走其专用gated测试；core Config追加有真实
exec consumer的hide_agent_reasoning、App Server config根字段/公共测试、TS shape与保留
回归；既有CLI Gate的真实双策略/隐藏/JSON/stdin证据及结构守卫；architecture/commands/ops
和本计划。不新增crate、外部依赖、method或GUI后端，不保留tui::run_exec委托包装。
phase-aware输出从TUI迁来，CLI新增对现有agent-protocol的直接workspace依赖，Cargo.lock
仅同步CLI依赖边，不更新任何版本。非交互fail-closed回应独立于BottomPane视图。

唯一业务事实源仍App Server canonical Thread/Turn/Item；exec只拥有单Turn输出状态，
直接使用app-server-client的共享stdio/remote transport。服务器继续决策权限、执行与
持久化；非交互client仅发送typed拒绝/空输入响应，不自动批准。本轮不把现有JSON/JSONL
envelope改动冒充Codex完整event JSON输出，后者仍单独待办。

退出条件：旧TUI exec owner/exports无生产consumer；默认stderr摘要、raw优先content、
hide覆盖raw、raw为空回摘要；stdout仅最终答案，JSON/JSONL不混入human文本；当前
Thread/Turn精确隔离，completed快照替换增量，不重复打印Reasoning，同Item ID保持；
failed/interrupted退出码与shutdown回收不回归。定向crate、共享配置协议、真实fresh CLI
stdio Gate、结构/契约/治理验证后才能关闭；GUI/TUI第67证据不冒充本阶段CLI证据。

2026-10-09最终接续：真实标准 `npm run smoke:cli-gate-b` 通过，日志
`/tmp/lime-tui-stage68-cli-gate-b-v4.log`。本轮 fresh CLI/App Server 双进程，七个 human
场景均核对真实 stdin/stdout/stderr/exit 与结束后另一进程 cold canonical thread/read。
default Thread `01a11ec0-c64a-7b73-b157-425bcc6f127a`，Turn
`turn_3021c1bc776b4917977947f1e75209b3`；raw Thread
`01a11ec0-d03c-7be1-9d14-4f3f0b84161b`，Turn `turn_86be75e581464f35962cb11e40b6fbae`。
hidden/hidden-raw/raw-empty 同样通过，Reasoning ID 恒为
`item_terminal-reasoning-<turnId>`，summary/content 顺序与完整内容保持。failed exit1、
interrupted exit130，stdout 不泄漏 partial answer；JSON/JSONL human stderr 为空，
unavailable 明确失败/exit1。前三轮真实失败日志保留；只修测试侧的 stdin 尾换行断言、
终态 event type（turn.failed/turn.canceled）及独立 backend 参数，不更改 runtime 终态。

完整 CLI/TUI crate 为 CLI lib8 + bin61（含新exec8/请求拒绝2）+ integration2，TUI
lib1595 + integration23 + dependency guard1，全通过，日志
`/tmp/lime-tui-stage68-terminal-crates-final.log`。最终 shared config JSON-RPC1 通过，
`/tmp/lime-tui-stage68-config-jsonrpc-final.log`；先前 direct cargo V8 默认下载404只算
环境失败。标准 resolver 校验缓存官方archive/binding后构建，不绕过freshness/更新版本。
CLI/TUI all-target Clippy/no-deps/-D warnings通过，
`/tmp/lime-tui-stage68-clippy-current-owners-v2.log`。广义含依赖Clippy遇到既有
agent-protocol large_enum_variant/derivable_impls，仍保留失败，不冒充workspace全绿；
本刀修了raw delta分支的collapsible_match，随后对应reasoning/full TUI由第69续验。

第67本地失败已按原状态继续：29～56通过后57遇到Codex source-origin gate漂移。
核准4aa中的StableEnvironmentTools OR has_environment及apply_patch model gate，
只迁移来源守卫，未修改生产tool authority或宣称新environment feature已实现。
57定向通过后，57～120全部续跑通过，状态文件120/120 passed，日志
`/tmp/lime-tui-stage68-test-resume-v2.log`，ESLint零warning和renderer/node typecheck通过。
相关侧栏22、任务页8与第67前端33通过。两次verify:local的失败不改写为标准整轮通过；
本次以同一全量状态续跑完成前端，再补受影响Rust、契约与真实产品证据。
contracts（含新增CLI boundary）通过，`/tmp/lime-tui-stage68-contracts-final.log`；
此前legacy/scripts治理0漂移/违规，最终第69同时重验。

标准 `npm run verify:gui-smoke` 使用fresh renderer/host/sidecars再次通过，
run `standalone-shell-01-20261009034415-73654`，shell/Claw reload/三viewport/memory settings
全部pass，日志`/tmp/lime-tui-stage68-gui-smoke.log`。第67raw专项Electron、真实PTY/stdio
证据仍有效；本轮不重复冒充GUI live raw、live provider或Windows。CLI/TUI共享App Server/
canonical read model，原TUI exec types/exports/runtime实现与BottomPane非交互拒绝均为
dead/deleted，CLI exec为current，没有新增compat/deprecated。架构图root已确认2026-10-09。
本切片退出条件100%；总体partial/in-progress，无可信总百分比分母。exec完整human
工具/错误/usage、event JSON、exec resume与更多输入/显示/动画差异继续待办。

## 第六十九阶段：输入框推理强度提示符（专项验收完成）

主目标继续为 Codex CLI/TUI 全维度对齐。当前 Codex 的 effort_ignition/EffortTier 在
Max 显示金色 ›、Ultra 显示紫色 »，其它档位为普通 ›；Lime composer 始终显示普通 ›。
本刀先直接对齐常驻提示符，消费已有 App Server settings snapshot，不推测模型能力或
改 provider 策略。一次性 ignition 动画和状态栏过渡仍单独待办，不把静态效果冒充完整动画。

窄写集：bottom_pane/effort_ignition、ChatComposer/render 与 BottomPane 接线、
ChatWidget/settings 的显示刷新、独立渲染/恢复回归、既有真实 PTY/model picker 验收、
结构inventory、commands/本计划。共享 GUI/protocol/core config/runtime/provider 只读。
不新增配置、依赖、业务后端、命令或用户文案。Max/Ultra 只读取服务端实际档位；未知
档位和未声明档位保持普通提示符，禁用输入恢复 dim ›。提示符宽度仍为一列，草稿、
附件、换行、cursor 和用户消息历史不承接 effort 状态。

退出条件：light/dark、truecolor/256/16/NO_COLOR 提示符符合 Codex 静态语义；settings
成功更新、model/collaboration 选择、启动及历史恢复消费同一刷新入口；草稿恢复不能
覆盖当前档位；完整 TUI crate、Clippy、结构守卫与 fresh PTY 输入/选择/终端恢复通过。
本刀仅改变已有 TUI presentation，owner 与架构依赖方向不变；root，2026-10-09。

2026-10-09最终：current EffortTier 位于 Codex 同名 bottom_pane/effort_ignition；
ChatWidget/settings -> BottomPane -> ChatComposer 为唯一刷新链，旧固定普通箭头选择
分支已原位替换，无compat/deprecated、私有配置或第二backend。提示符采用Codex的
Max/Ultra light/dark RGB、0.86前景混合、ANSI256量化与ANSI16/NO_COLOR降级。
测试覆盖实际Buffer颜色/字形/单列宽度、附件基线/cursor/禁用输入、settings/model与
mode override、rich draft handoff不复活旧档位。普通settings中的None沿用既有“保留
mode override”语义，首次full crate发现错误清除后已修正产品分支，保留旧正向回归，
新增显式mode clear回归；未通过改断言掩盖该行为。

完整TUI最终1599 library +23 integration +1 dependency guard通过，日志
`/tmp/lime-tui-stage69-tui-crate-final.log`。CLI/TUI strict all-target/no-deps Clippy通过，
`/tmp/lime-tui-stage69-clippy.log`；fmt/diff check、边界ESLint/Prettier与97项
结构/config回归通过。inventory最终1511 src文件；legacy-report分类漂移/边界违规/
零引用候选0、scripts治理通过，日志`/tmp/lime-tui-stage69-governance.log`、
`/tmp/lime-tui-stage69-scripts.log`、`/tmp/lime-tui-stage69-guards-final.log`。

标准fresh `smoke:tui-gate-b` 的complete场景通过，明确要求并打印
`TUI_EFFORT_PROMPT_OK ultra=double-arrow max=single-arrow status=preserved keyboard=ok`，
日志`/tmp/lime-tui-stage69-tui-gate-b-final.log`。真实/model picker/Alt按键选择Ultra、
/status核对档位、关页保持»、降档Max为›，随后还原High，未凭普通gated return冒充
PTY验收。Thread `01a11ece-6721-7f20-9387-8c74a9731f6b`/Turn
`turn_d783ba0984614ba6ae47034436a1b2d2`；同fresh binary的stdio推理/cold read/运行中
resume/backtrack、PTY输入/editor/history/附件布局相关主链、alternate screen与终端恢复
保持通过。本轮只选择受影响complete，未冒充重跑其它10个场景。

第68完整120批前端与桌面/CLI Gate证据仍有效，本刀无GUI/protocol/config/schema/文案
生产改动，因此不重复22项聚合GUI或前端全量。KISS保留单列几何，DRY单一settings刷新，
SRP档位样式与editor draft分离。本切片100%；总体partial/in-progress，没有总分母，
一次性ignition/状态栏过渡、其余输入/显示/目录、exec事件输出继续待办。

## 第七十阶段：文件/技能补全弹窗 owner 目录（专项验收完成）

主目标继续为功能/UI/命名/目录/设计模式全维度Codex对齐。当前file_search_popup与
skill_popup各自已有真实列表/key/render职责，却被定义在chat_composer子模块并经其
re-export供BottomPane使用。Codex对应owner直接位于bottom_pane，composer只拥有
token/lifecycle state。本刀直接迁移两个文件及全部imports，不保留旧路径或包装。

窄写集：两个popup文件迁到bottom_pane根；bottom_pane/mod、chat_composer模块声明/
imports、popup_state消费者；既有结构守卫/inventory、commands/本计划。主runtime/
GUI/shared protocol/provider/config/锁文件只读。保留原有行为和全部已有popup回归，
不复制keymap/render或引入新业务API。旧路径为dead/deleted/forbidden-to-restore，
新路径为current，同一state实例继续由composer持有。

退出条件：旧文件/模块/re-export无消费者，当前模块唯一；既有文件/技能列表和
completion/mentions回归、strict Clippy与结构守卫通过；真实fresh PTY complete/files
输入路径与skills场景继续保持canonical输入/附件/terminal恢复。本刀presentation内部
目录移动，不改变业务主链或public依赖方向；root，2026-10-09。

2026-10-09最终：两个文件直接迁移，旧chat_composer/file_search_popup.rs及skill_popup.rs
物理删除，action不再经composer转出；imports已迁至同一current模块，无path alias或
compat。原有popup回归61/61、结构守卫81/81、CLI/TUI strict Clippy all-target/no-deps、
fmt/diff、边界ESLint、contracts、legacy治理（漂移/违规0）通过。inventory1511更新真实
路径/源码digest，历史snapshot evidence保持不可变，不伪造同路径实现全量等价。

标准fresh `smoke:tui-gate-b` 选择complete,skills通过，日志
`/tmp/lime-tui-stage70-tui-gate-b.log`。真实文件搜索结果上下选择/Tab插入未截短完整路径，
技能结果滚动/Tab选择/原子delete/cancel/history recall/提交和cold canonical内容通过，
skill-mentions=ok；同fresh binary的前序Ultra/Max prompt、stdio推理/resume/backtrack与
alternate screen/终端恢复保持通过。主complete Thread
`01a11ed5-f829-7063-a876-9334524710b5`/Turn `turn_10556f2f740143b1aabe0a79e2be18c0`。
gate实际核对另一个skills Thread/Turn/Item的typed输入/Skill路径，stdout聚合未另印其ID，
不把主complete身份冒充skills身份。受控external backend，无live provider/Windows。
本刀未无理由重跑全TUI或前端120批；保留第69full crate1599+23+1与本刀贴边界回归。

分类current两列表owner，dead旧模块/re-export已删，无新增compat/deprecated；SRP由
列表owner持有scroll/render，composer持有token/lifecycle，DRY继续消费同一shared rows。
本切片100%；总体partial/in-progress。下一刀是popup抢占带修饰键Enter：当前三个
popup把Shift/Alt/Ctrl+Enter都当选择，偏离Codex普通Enter才接纳结果、其余走编辑器语义。

## 第七十一阶段：补全弹窗的修饰 Enter 路由（专项验收完成）

Codex file/skill popup 与 chat_composer/slash_input 均明确限定普通 Enter 才接纳选择，
其它 Enter 交给已有编辑器/keymap。Lime 三个列表当前仅检查 key.code，会把换行或
未绑定的组合键误当成补全/执行命令。本刀在 current 列表 key routing 原位替换，
不新增平行 composer、keymap 或兼容入口。

窄写集：bottom_pane 三个 popup、input_tests、既有 runtime_pty_tests/suggestions 与
tui-gate-b marker、结构 inventory/本计划。GUI、shared protocol/config/runtime/provider
只读。保持 Tab、普通 Enter、文件无匹配 Enter 关闭并继续提交的既有语义；Ctrl+Enter
默认无绑定时不改稿、不选择，显式绑定换行时消费相同 editor。附件/已选 mention 不丢失。

退出条件：真实 BottomPane 接线回归覆盖 Shift/Alt 换行、Ctrl 默认与自定义 keymap、
有/无文件结果及普通选择；fresh PTY 实际 CSI-u 修饰键在三种 popup 中换行，草稿清理
和无额外 canonical turn 可观察；TUI crate、strict Clippy、fmt/结构守卫通过。
本刀只改 TUI presentation 输入路由，业务边界与架构依赖不变；root，2026-10-09。

2026-10-09最终：三个 current popup 原位限定普通 Enter；修饰 Enter 直接交还已有
editor，无包装/compat/deprecated。BottomPane实际接线覆盖四种状态（文件有/无结果、
技能、命令）、Shift/Alt换行、Ctrl默认无绑定与显式绑定，以及普通Enter选择和附件。
测试首次读取私有草稿字段导致编译失败，已改为opaque完整快照比较，未扩大生产可见性。
最终10项input回归、完整TUI1602 library +23 integration +1依赖守卫、81结构守卫与
CLI/TUI strict all-target/no-deps Clippy通过。日志`/tmp/lime-tui-stage71-input-tests-v2.log`、
`/tmp/lime-tui-stage71-tui-crate.log`、`/tmp/lime-tui-stage71-guards.log`、
`/tmp/lime-tui-stage71-clippy.log`；fmt、diff、ESLint通过。

fresh标准TUI Gate B complete通过，`/tmp/lime-tui-stage71-tui-gate-b.log`强制消费
`TUI_POPUP_ENTER_OK slash=ok file=ok skill=ok shift-alt=newline turns=none`。
三种popup各自经真实CSI-u Shift/Alt+Enter保持原token、出现新行、关闭popup；Ctrl-C
清整段多行草稿，ledger无额外turnStart。已有文件Tab、技能选择、effort/model、
canonical/stdio恢复、backtrack和terminal恢复仍通过。Thread
`01a11ee5-0d1f-7f40-8dff-2d8d130f537b`/Turn `turn_549b88e789064de5a8e6b59950775d96`。
受控external fixture，不冒充live provider/Windows/Desktop；无GUI/shared边界改动，
不无理由重跑120批前端。本切片100%；总体partial，无可信总体百分比分母。

## 第七十二阶段：斜杠补全的编辑 owner 与参数保留（专项验收完成）

Codex slash_input 在Tab或第二个普通 `/` 接纳选中命令，并在支持inline args的命令
中只替换前缀、保留draft tail/text elements。Lime缺少 `/` 接纳；BottomPane直接
replace整个草稿，已输入的参数/图片/skill/paste identity被清除。本刀直接迁移编辑
职责到ChatComposer/slash_input，BottomPane仅派发popup动作，不留旧编辑实现。

窄写集：slash_command的既有参数能力声明、command_popup、BottomPane/input、
ChatComposer/slash_input与独立回归、既有PTY suggestions/gate marker、结构guard/
inventory/本计划。仅对实际已有参数消费者（model/effort/permissions/mcp/export/pwd）
保留tail；不让无参数命令自动新增参数能力，不改变模型/权限业务决策或公开协议。
退出条件：Tab与 `/` 可补全文本且不执行，普通Enter沿用已有命令派发；UTF-8 cursor、
参数尾部、多行、图片/已选skill/折叠paste和Vim undo identity稳定；旧BottomPane编辑
helper删除；定向与full TUI、Clippy/结构守卫及fresh PTY的真实args补全通过。
presentation内部owner收敛，业务架构不变；root，2026-10-09。

实施时发现TextArea尚无Codex同名remove_element_range，前缀跨原子元素时不能安全
解除标记。因此窄写集补入既有textarea/elements与独立回归：只取消精确range的标记，
保留文本/cursor/其它ID，UTF-8边界按同一editor clamp；不复制editor或放宽atomic删除。

2026-10-09最终：current slash_input唯一负责命令前缀编辑，BottomPane旧编辑helper
物理删除，popup只选择动作，catalog声明实际参数能力。第二个普通 `/` 与Tab接纳
文本、不执行；Enter保持既有dispatch合同。支持参数的命令保留tail及原子ID，未给
其它命令新增参数语义。新增textarea同名unmark消费链已覆盖UTF-8 clamp与相邻ID。
rich回归验证图片、已选技能、折叠paste的range平移/identity/typed提交，以及Vim完整
undo/redo快照；首轮因TextArea缺失API与旧import编译失败，补入current owner并清掉
旧import后验证通过，无compat/deprecated或第二backend。

460项BottomPane定向回归、完整TUI1607 library +23 integration +1依赖守卫、82结构
守卫、contracts、legacy治理（0漂移/违规/零引用候选）、CLI/TUI strict all-target/
no-deps Clippy、fmt/diff/ESLint/Prettier通过。日志`/tmp/lime-tui-stage72-pane-tests-v2.log`、
`/tmp/lime-tui-stage72-tui-crate.log`、`/tmp/lime-tui-stage72-guards.log`、
`/tmp/lime-tui-stage72-contracts.log`、`/tmp/lime-tui-stage72-governance.log`、
`/tmp/lime-tui-stage72-clippy.log`。inventory1512 src文件，新增独立slash输入测试owner。

fresh标准Gate B complete通过：真实PTY编辑`/effo high`的prefix，Tab、`/`、Enter
均保留`/effort high`，关闭popup且无额外turnStart；强制marker
`TUI_SLASH_COMPLETION_OK tab=ok slash=ok enter=ok args=preserved turns=none`。
第71修饰Enter、model effort、真实stdio/read model/resume/backtrack与终端恢复仍通过，
日志`/tmp/lime-tui-stage72-tui-gate-b.log`，Thread
`01a11ef1-80e8-7452-8302-cd9b69541b7c`/Turn `turn_7e149716ddab47dc91ec47164cf8d915`。
无live provider/Windows/Desktop本轮证据；本切片100%，总体partial/in-progress。

## 第七十三阶段：空补全列表的接纳与关闭（专项验收完成）

Codex文件列表无选择时Tab关闭且不提交，普通Enter关闭并继续普通提交；技能列表
无选择时Tab/普通Enter关闭且不提交。Lime文件空结果Tab和技能空结果的接纳键仍
保留popup。本刀在唯一completion lifecycle owner修正，不增加dismiss wrapper或
重写selection/render。窄写集：chat_composer/completion、BottomPane/input_tests、
既有PTY suggestions/gate marker、inventory/本计划。退出条件：空文件/技能接纳键
保持原draft/附件，普通Enter的两种提交差异不混同，修饰Enter保持第71语义；迟到
file响应不复活已关闭popup；定向/完整TUI、Clippy/结构守卫和真实PTY空列表Tab通过。
业务架构不变；root，2026-10-09。

2026-10-09最终：current completion lifecycle 在文件空列表Tab、技能空列表Tab/普通
Enter时关闭popup，保留同一rich draft；文件普通Enter继续原提交路径，修饰Enter
沿用第71editor语义。未新增wrapper/compat/deprecated。BottomPane回归精确区分
提交与关闭、保持图片与草稿，并验证取消file generation后迟到响应不能重开列表。
PTY经真实文件搜索与skills catalog得到空结果，真实Tab（文件/技能）和Enter（技能）
关闭列表，保留token并清理草稿，ledger无额外turnStart；不把普通文件Enter刻意
新增canonical回合塞进“无额外回合”证据，已由真实pane提交action与既有PTY提交链覆盖。

仓库标准related-first入口通过：`test:rust:related`为CLI lib8 +TUI1609；
`test:rust:integration:related`扩展CLI bin61 +integration2、TUI integration23 +依赖
守卫1（并重复库测试），最终唯一测试数1704，未把两次库运行重复累计。日志
`/tmp/lime-tui-stage73-related-crates.log`、`/tmp/lime-tui-stage73-related-integration.log`。
82结构守卫、strict CLI/TUI all-target/no-deps Clippy、legacy治理（漂移/违规/零引用
候选0）、fmt/diff/ESLint/Prettier通过，日志`/tmp/lime-tui-stage73-guards.log`、
`/tmp/lime-tui-stage73-clippy.log`、`/tmp/lime-tui-stage73-governance.log`。
inventory1512保持最新；Gate脚本将四组重复marker检查合为唯一循环并保留fail closed，
未添加平级runner或新脚本目录。

fresh标准`smoke:tui-gate-b` complete通过，强制marker
`TUI_EMPTY_COMPLETION_OK file-tab=closed skill-tab-enter=closed draft=preserved turns=none`，
第71/72及原有effort、stdio、cold read、reconnect、backtrack、canonical状态与terminal
恢复均保持通过。日志`/tmp/lime-tui-stage73-tui-gate-b.log`，Thread
`01a11efa-36d8-7613-997c-8929332f5850`/Turn `turn_4ac6e1c347ee4c4e83802500e60c4587`。
第72contracts继续有效，本刀未改变公开协议/GUI/shared config；不无理由重复前端
120批或Desktop smoke。本轮全部使用受控external fixture，未验收live Provider/Windows。
本切片100%；总体partial/in-progress，不虚报总对齐率。

下一主线回到显示层：effort_ignition一次性Wave/Aurora/Pulse、status-line transition，
需要补齐首帧起算、baseline（启动/resume/thread handoff不重放）、取消与reduced
animation/color capability、保护draft glyph和单一frame requester。当前只有常驻prompt
accent，不能标为完成动画；Lime尚无共享tui.animations配置，后续如引入必须同步core/
public config/GUI消费者/schema/文档与契约，不能偷偷放进TUI私有配置。exec完整human
tool/error/usage、event JSON、resume及其它输入/显示/目录差异继续在主计划待办。

## 第七十四阶段：推理档位一次性动画与状态栏过渡（专项验收完成）

主目标仍是CLI/TUI功能、显示、输入与owner结构完整对齐Codex。当前静态effort accent
直接替换为Codex同名effort_ignition/styles与effort_status_line；Composer拥有效果状态，
view仅提供canonical状态栏props，复用现有FrameRequester，禁止第二timer或业务后端。
共享tui.animations默认true，由core TuiConfig校验、config/read/batchWrite持久化，GUI
类型/gateway保留同一字段；animations=false与低色能力只保留静态accent。

窄写集：TUI既有bottom_pane/composer/footer/render、effort动画模块与独立回归；
ChatWidget settings、startup/resume/hydrate基线、runtime帧调度注入；core TuiConfig、
公共config JSON-RPC回归、GUI appConfig类型/回归；TUI manifest/lock、既有PTY/gate、
结构inventory/guard、commands/ops/本计划。已有脏写集沿用前序任务，避让无关GUI改动。
退出条件：三style不连续重复、首个可见render起算、draft/附件glyph保护、modal隐藏不
提前消耗、palette缺失取消、降档/重复/baseline取消；status outgoing/label/fade和单帧
调度真实消费；启动/resume/thread handoff不重放；共享配置默认/false/非法值/冷读取
通过；定向TUI/core/App Server/GUI回归、契约/治理/Clippy与fresh真实PTY通过。
本刀仅增加presentation状态与既有共享配置字段，业务架构不变；root，2026-10-09。

实施补入既有status_indicator_widget/shimmer配置消费，避免animations=false仍播放运行
文字效果；Agents Overview改为fullscreen早返回，避免被遮挡的Composer提前起算。
runtime_pty_tests.rs为既有1740+行host夹具，本刀仅追加palette probe接线；新交互断言
继续放在独立reasoning_shortcuts，不堆入host文件，后续按既有场景模块持续拆分。

验收接线核准：公共config写入null表示删除覆盖，恢复animations=true；字面YAML/JSON
null仍由core拒绝。首轮公共回归错误地将reset当非法值，现按既有合同补reset/冷读/再次
false保存。related前端入口遇到electron目录EISDIR解析错误，使用同一API测试文件定向
运行；新增GUI fixture首轮漏default_provider，补完整公共配置形状后18项通过。
标准Rust integration runner同时选中了巨大App Server lib test；中止该超范围编译，改用
同一config_jsonrpc独立target+仓库V8 env resolver，未降低公共协议/持久化验收。

首轮complete接入palette后，vt100投影在既有export ZWJ emoji重排断言丢失末尾laptop
glyph，未判为产品已修复或放宽原回归。本轮将palette/真实tint/Ultra标签/恢复状态断言
接到已有diff-display富色场景；complete保持原综合编辑条件，两组分别fail closed。
仅回应实际cursor/OSC10/11探测，不额外宣称keyboard capability；目录/runner数量不增加。

2026-10-09最终：current effort_ignition/styles、effort_status_line和Composer/effort为
唯一效果owner，Wave/Aurora/Pulse随机且不连续重复，首个可见render起算；背景穿过文本，
glyph避开草稿/附件保护区。passive footer保留原样快照，旧状态右滑、MAX/ULTRA收拢、
淡出及新状态淡入统一复用FrameRequester。启动/resume/hydrate显式baseline，modal/
fullscreen不提前启动，降档、palette缺失和animations=false取消。旧静态效果选择已原位
替换，无新增compat/deprecated或第二timer/runtime。共享animations配置经core、公共
config/read/batchWrite和GUI shape保留；TUI仅声明既有workspace rand 0.8，不升级依赖。

实际唯一Rust回归2314项：core library583、TUI library1635 +integration23 +依赖守卫1、
CLI library8 +binary61 +integration2、公共config JSON-RPC1；未重复累计初轮定向41或
旧TUI1633。GUI API18、结构/快照守卫83、contracts、typecheck、strict CLI/TUI
all-target/no-deps Clippy/-D warnings、fmt/diff、ESLint/Prettier全部通过。治理零分类漂移/
边界违规/零引用候选；inventory1517 src文件。有效日志：
`/tmp/lime-tui-stage74-crates.log`、`/tmp/lime-tui-stage74-related-integration.log`、
`/tmp/lime-tui-stage74-config-jsonrpc-v2.log`、`/tmp/lime-tui-stage74-frontend-v2.log`、
`/tmp/lime-tui-stage74-guards-final.log`、`/tmp/lime-tui-stage74-contracts.log`、
`/tmp/lime-tui-stage74-governance.log`、`/tmp/lime-tui-stage74-typecheck.log`、
`/tmp/lime-tui-stage74-clippy-final.log`、`/tmp/lime-tui-stage74-eslint-v2.log`。

fresh标准Gate B选择complete,diff-display通过，日志
`/tmp/lime-tui-stage74-tui-gate-b-v5.log`强制消费
`TUI_EFFORT_ANIMATION_OK palette=probed ignition=tinted ultra=assembled status=restored frames=shared`。
真实PTY回应实际cursor/OSC10/11探测，经真实catalog/F9选择Ultra，检查输入框RGB变化、
ULTRA收拢标签和恢复状态，随后降为High；cold thread/resume核对同一model/provider/
effort且仅一个Turn。complete Thread `01a11f23-5da6-7573-8218-c40b6d57fe2f`、Turn
`turn_b91ac87c1032444ea9ad0d42ef479ff4`；backtrack prefix Thread
`01a11f25-3a4a-7bd0-9bde-8fb28d96d4d7`、preserved Turn
`turn_f72dc0338a744b4982a14720d821b06e`。原reasoning通知/冷恢复、reconnect/backtrack、
输入/历史/Vim、title/status、focus/resize和terminal恢复仍通过。

complete综合场景120秒超时后，整体预算改180秒，单步10秒predicate与断言保持原值；
只读sample确认时间主要消耗于VT100全量解析，未扩大本刀为缓存/增量projection改造。
尝试diff-display优先执行触发旧composer fixture共享ledger“尚无turn”假设，最终沿用
原complete先、diff-display后的顺序验收通过。前序失败日志保留，不把它们改写为通过。

本切片100%；总体partial/in-progress，goal active，无可信总体百分比分母。证据使用
受控external backend；本轮没有live Provider、Windows或Desktop GUI Gate B，未重跑
完整verify:local及前端120批。下一刀回到CLI human tool/error/usage显示和owner命名；
event JSON/resume及其它输入/显示差异继续待办。

## 第七十五阶段：exec 工具、错误、计划与用量输出（专项验收完成）

主目标继续为Codex功能、UI/UX、目录/命名及设计模式完整对齐。当前CLI human owner
只消费completed Reasoning，忽略CommandExecution/FileChange/MCP/WebSearch、运行错误、
plan/diff和token usage，失败退出只剩空stdout。本刀迁到Codex同名
exec/event_processor_with_human_output，消费既有typed notifications，不扩展业务协议。

窄写集：cli/src/exec内的参数/人类输出/locale/事件隔离与独立回归，main最小导入和
locale继承；CLI manifest/lock仅声明既有workspace终端样式依赖；既有CLI Gate reasoning
矩阵和terminal fixture，CLI boundary/inventory、architecture/commands/ops/本计划。
TUI、GUI、App Server/protocol/runtime/provider生产源码只读，前序脏改动保留。

退出条件：同Thread/Turn隔离的工具开始/终态/输出、错误/中断、plan/diff、warning与
最后一次canonical usage真实可见；duplicate Item通知与terminal快照不重复打印，漏通知
可由terminal修复；stdout仅成功最终答案，双TTY避免重复，JSON/JSONL无human文本；
--color auto/always/never和五语言文案有真实consumer/回归；旧human_output路径直接
删除且补禁止恢复守卫；CLI crate/strict Clippy、contracts/治理及fresh stdio Gate B通过。
不把本刀视为完整event JSON、exec resume、配置摘要或全部Codex feature已完成。
presentation owner与共享业务依赖方向不变；root，2026-10-09。

2026-10-09最终：current为同名exec/cli、event_processor_with_human_output及CLI
presentation locale。旧main内ExecCli声明与human_output路径直接迁出/删除，CLI boundary
禁止旧路径恢复，无新增compat/deprecated。EventProcessor唯一执行Thread/Turn过滤；
human renderer消费CommandExecution开始/终态/exit/duration/聚合输出、FileChange、
MCP错误、WebSearch、collab开始、compaction、plan/diff、config/runtime/Guardian warning、
error、hook和model reroute。Item ID去重，terminal补漏，canonical最终正文优先于增量；
失败/中断不把partial snapshot变成最终回答。usage仅保留最后服务端累计快照，排除
cached input并以饱和运算显示千位分隔数，不新建usage累计owner。

--color auto/always/never与五语言实际接线，root locale被exec继承；pipe stdout仅成功
最终答案，双TTY只显示一次，JSON/JSONL仍是原envelope且human renderer不创建。
crossterm只新增既有workspace直接依赖，不升级版本；ANSI使用Codex对应基础色、
dim/italic/bold，不把工作目录一起加粗。CLI结构inventory补入Codex exec与Lime exec
真实源树，8树独立记录路径/digest；只在comparison中使用owner-relative路径，未把
Lime exec.rs伪装成上游lib.rs。JSON event owner、exec_events和ResumeArgs缺口保持显式。
Codex来源HEAD `4aaee872e31abefe0d32e91faab23b09b6968824`，human output SHA-256
`cc3a4cb49aeaf02556b16ea565f16e5ecef0fe70ae2f2c8bf3447bd00301f06e`，cli SHA-256
`66643e8b3d5964b70cb8f231fb309312376272fb3ea87bcb6849f44cf112f8f6`。

Rust related-first入口library8通过；integration related完整library8 +binary74 +integration2
通过，唯一84项，不重复累计最后exec23定向重验。日志
`/tmp/lime-tui-stage75-related-crates.log`、`/tmp/lime-tui-stage75-cli-tests-final.log`、
`/tmp/lime-tui-stage75-exec-tests-final.log`。结构/Gate/inventory回归11项、contracts、
strict CLI all-target/no-deps Clippy/-D warnings、ESLint零warning、Prettier、fmt/diff
通过；legacy治理2070文件、1828 Rust文件，零引用候选/分类漂移/边界违规均0。
日志`/tmp/lime-tui-stage75-guards-final.log`、`/tmp/lime-tui-stage75-contracts.log`、
`/tmp/lime-tui-stage75-clippy-final.log`、`/tmp/lime-tui-stage75-eslint-final.log`、
`/tmp/lime-tui-stage75-governance.log`。首次编译发现Rust2021不能使用let-chain与Lime
query为Option，已按既有edition/协议修正；测试fixture补started/completed时间戳。
Clippy指出stdout boolean非最简后原位改写，再重验exec23及fresh Gate，未加allow。

fresh标准CLI Gate B最终通过，日志`/tmp/lime-tui-stage75-cli-gate-b-pty-v2.log`。
主Thread `01a11f3c-9632-76d1-a835-dc92f37f91a0`、Turn
`turn_7c234abce8a74452b9bf8238931e8a7d`；7个human矩阵均核对实际stdin/stdout/stderr/
exit并从另一进程cold thread/read核对唯一Reasoning和CommandExecution身份、状态、
cwd/output/exitCode/durationMs。failed为exit1、interrupted为exit130，stdout空；2个
JSON格式stderr空，5个locale实际root继承，3个color在管道及NO_COLOR下验证，
unavailable继续fail closed。即时Error及终态Error分别输出，与Codex一致；首轮夹具
只预期一次而失败，改正期望后通过，未改变runtime错误/重试语义。

真实macOS原生script PTY强制标记
`CLI_HUMAN_TTY_OK platform=darwin real-pty=ok both-streams=tty final-answer=once tools=visible`，
stdout/stderr都接同一TTY，最终答案仅一次且工具仍可见。原生script由参数直接启动，
无shell拼接；SIP清除DYLD_LIBRARY_PATH曾令App Server transport关闭，验收helper
通过既有isolatedEnvironment解析同一库路径，再经env参数在PTY内恢复，仅改测试host，
不修假生产fallback。非macOS或外层stdin非TTY明确打印NOT_RUN，不冒充TTY证据。
前序失败日志保留为stage75 CLI gate v1/final/pty-final，不改写为通过。

root已核对architecture传递图；KISS不新建事件协议/输出backend，SRP参数与presentation
归各自owner，DRY复用同一过滤/通知/配置事实源与同一isolatedEnvironment。
本切片100%；总体partial/in-progress，goal active，无可信总体分母。TUI生产源码、GUI、
App Server/protocol/runtime/provider只读，前序dirty写集保留。本轮未重跑完整TUI/GUI
Gate B、verify:local/120批前端，也未验收Windows/live Provider；第74受影响边界证据
保持独立，不冒充本刀。下一刀为Codex exec event JSON/exec_events与resume，必须同步
实际脚本消费者，删除旧single-envelope入口，不建立第二套runtime或兼容输出双轨。

## 第七十六阶段：exec JSONL 事件输出与旧 envelope 清理（专项验收完成）

上一goal turn为progress：第75 current CLI owner、真实stdio/cold read/macOS PTY和
仓库证据均已落地。本轮核准Codex exec_events与event_processor_with_jsonl_output，
直接把--json改成逐事件JSONL，删除--jsonl及旧render_json_envelope，不保留双格式兼容。
CLI业务继续通过同一App Server，不迁出/复制runtime或canonical持久化。

窄写集：cli/src/exec的typed exec_events、JSON owner/Item lowering/独立回归、既有
EventProcessor scope/typed terminal result、main删除旧helper/专属测试；CLI manifest/lock
只追加现有schemars版本以同步机器schema；packages/cli内生成schema及npm staging/文档/
回归；CLI Gate及reasoning矩阵、surface Gate种子consumer、CLI boundary/inventory，
architecture/commands/governance/ops/scripts导航/本计划。GUI/TUI及App Server/protocol/
runtime/provider生产源码只读，保留前序dirty改动。

退出条件：thread/turn开始、命令/文件/MCP/协作/搜索/摘要/计划Item、warning/error及
usage终态符合Codex snake_case合同；每条即时flush，单一renderer不混human/envelope；
逐Item ID在生命周期内稳定，重复/迟到通知不重开，canonical terminal修复漏通知；
failed输出error/turn.failed且exit1，中断无成功终态且exit130，preflight输出error；
全部真实消费者迁移，旧flag/helper/serializer及DTO仅测试字段删除并禁止回流；schema
与npm实际tarball同步、CLI/crate/Clippy/契约/治理与fresh真实stdio输出验收通过。
event编号映射属于CLI presentation，cold read继续核对原canonical identity，不能把
item_0等显示编号当持久化ID。exec resume、output-last-message、其余feature下一刀继续。
root，2026-10-09；业务架构方向不变，JSON输出owner图需同步并确认。

2026-10-09：current为同名exec_events、event_processor_with_jsonl_output及typed Item
lowering，human/JSON enum互斥，共用EventProcessor scope。旧jsonl flag、envelope helper、
DTO的single-result序列化与仅服务envelope的identity字段已删除，无compat/deprecated。
机器摘要始终可见、原文不输出；todo来自typed plan，usage取最后total五字段，不自行
累加。display编号稳定，duplicate/late start不重开，terminal补漏/正文修复；失败
error/turn.failed+exit1，中断无成功终态+exit130，preflight单error。Lime canonical Plan
正文投影为agent_message；WebSearch v2没有typed results，保持省略，不猜metadata；
flatten Item只输出一个id，避免上游样例重复key。ResumeAgent按上游lower为wait。

所有exec JSON消费者已迁：CLI Gate、reasoning矩阵、surface queue seed与npm launcher
安装态fixture。schema按schemars serialize方向生成；最初required attribute误去掉
nullable类型，被实际event/schema测试发现并修正，未放宽测试。每种Item/事件roundtrip、
null/可选字段、unknown search action闭合与schema drift有回归，npm真实tarball包含
同源schema；安装态helper也复制并检查schema，不只声明package files。

Rust related library8先通过；integration related最终library8+binary84+integration2，
唯一94项，不重复累计中间exec34定向验证。strict all-target/no-deps Clippy/-D warnings、
13脚本回归、npm9项、contracts、ESLint零warning、fmt/diff、app-version通过；legacy
扫描2070文件/1833Rust文件，零引用候选/分类漂移/违规均0。日志为
`/tmp/lime-tui-stage76-cli-tests-final.log`、`/tmp/lime-tui-stage76-clippy.log`、
`/tmp/lime-tui-stage76-guards.log`、`/tmp/lime-tui-stage76-npm-tests.log`、
`/tmp/lime-tui-stage76-contracts.log`、`/tmp/lime-tui-stage76-governance.log`。
前序失败日志exec-tests/v2保留；旧constructor/flag测试、schema nullable与io错误kind
均原位修正，不加allow、不写fallback。仅声明已有schemars/jsonschema版本并同步lock。

fresh CLI Gate B日志`/tmp/lime-tui-stage76-cli-gate-b-pty.log`：主Thread
`01a11f5d-9a97-78f1-b614-423455476145`、Turn
`turn_4cdda3e303e445e994369486ee089cc3`。external backend屏障在收到command item.started
之前绝不完成，证明逐事件flush；cold read核对原canonical identity/output。7human+4JSON
矩阵、five-locale/color、错误/中断/不可用、stdin/completion和原生macOS双流PTY均通过。
真实surface Gate日志`/tmp/lime-tui-stage76-cli-surface-gate-b.log`通过，queue消费新事件。
npm安装态CLI与既有packaged Gate的TUI complete均通过，日志
`/tmp/lime-tui-stage76-cli-npm-gate-b.log`，aarch64-apple-darwin，sibling App Server；
alternate-screen/键盘/恢复来自该Gate，不提升其它平台结论。
root已确认architecture输出owner图，KISS/SRP/DRY仍共用
App Server协议/runtime，不新增业务后端。CLI JSON切片100%，整体partial/in-progress，
无可信总体分母；Windows/live Provider、Desktop GUI与完整verify:local未重跑。

## 第七十七阶段：exec resume、stdin 与最终消息文件（专项验收完成）

下一刀对齐同名Command/ResumeArgs/ExecSharedCliOptions、resolve_resume_thread_id和
handle_last_message：exec resume通过thread/list/resume恢复同一canonical Thread，再
发起新Turn；--last按updated_at倒序、默认cwd筛选，--all取消cwd筛选，UUID优先、名称
精确匹配，不直接读取数据库或rollout。未找到last/name沿用Codex新建线程语义，实际
thread/resume失败不fallback。root/exec/resume共享连接与权限参数，旧variadic prompt
迁为Codex单PROMPT；root参数+pipe stdin追加stdin块，省略/-读取stdin，resume显式
prompt不追加pipe。UTF-8 BOM/UTF-16输入解码按上游，不复用错误的字符串read_to_string。

窄写集：exec/cli、exec/prompt、exec/thread及各自测试、exec orchestration与输出
processor的last-message helper，main只删旧read_prompt/旧test及修调用；真实CLI Gate
既有fixture补resume/stdin/file矩阵，结构inventory/守卫、commands/ops/architecture/npm
文档/本计划。GUI/TUI、App Server/protocol/runtime生产只读，保留前序dirty改动。
退出条件：参数同前后位置均有效，跨进程resume保持Thread并新增Turn，last/all/name
选择与cold canonical一致；成功最终消息文件不含工具/推理或JSON，failed/interrupted
保留旧文件，写失败显式报错；binary回归、Clippy/契约/治理与fresh stdio验收。
不把exec fork/review、图片输入、output-schema或完整交互UI宣称已完成；继续保持总goal。

安装态首次CLI矩阵全部通过，随后TUI complete在usage setup预览超时：实际只有Context
remaining被勾选并移到首位，Used tokens未观察到。保留stage77-cli-npm-gate-b失败日志，
不能沿用第76通过结论。本轮增加窄测试写集runtime_pty_tests/{config,token_usage,
status_line,footer,task_progress}：将批量键盘写入改为筛选/勾选/清空/排序逐步screen predicate，
每步仍为既有10秒预算，不加sleep、不放宽业务断言。TUI生产owner暂时只读；如发现真实
事件/状态错误，先在对应owner补回归再修。最终必须重新取得安装态CLI+TUI完整证据。

逐步观察首次仍失败，实际query为Task progress且checkbox已启用，但选中箭头丢失；
不放宽选中断言。审计发现PTY reader发送任意字节chunk，所有observer逐chunk lossy
decode，Unicode跨read边界会被替换并改变VT100几何。增加test-only output reader owner
与分片回归，复用两个既有PTY reader；不改生产终端/选择器。runtime_pty_tests host仅
替换reader实现并导入模块，reasoning fixture复用同一reader，禁止第二UTF8解析策略。

2026-10-09最终：current为同名exec/cli参数、exec/prompt、exec/thread和共享
EventProcessor last-message owner。旧main read_prompt/variadic prompt及专属测试原位
删除，CLI boundary禁止恢复；无新增compat/deprecated。只有model/provider和输出参数
global化，权限仍逐层inherit_from，保留显式子组覆盖。真实v2 thread/resume不接受
model/cwd override，因此恢复仅thread_id/exclude_turns，模型/权限走既有settings/update，
cwd/roots走turn/start；不扩展App Server/protocol，也不恢复私有DB/rollout读入口。
last按更新时间倒序且默认cwd，all取消cwd；UUID优先、精确名称、跨provider名称检索、
分页重复cursor拒绝均有回归。last/name无匹配新建，实际UUID恢复失败不fallback。
stdin行为及UTF-8 BOM/UTF-16双端序与非法编码拒绝由同一prompt owner承接。
成功最终消息文件仅canonical正文；failed/interrupted不覆盖。文件写失败在runtime
turn.completed之后输出本地artifact error并exit1，不改canonical Turn终态；Codex上游
此处仅stderr报错，Lime显式失败是已记录差异，机器消费者不可把先前completed当进程成功。

Rust CLI唯一103项（library8/binary93/integration2）、picker8与UTF8 reader分片1通过；
不将ordinary gated PTY early return或中间重跑重复累计。CLI/TUI strict all-target/
no-deps Clippy/-D warnings、123结构/PTY/CLI脚本守卫、contracts、ESLint零warning、
Prettier、fmt/diff通过。治理2070 source/1838 Rust，候选/分类漂移/违规均0。
有效日志stage77-cli-tests-final、clippy-final、tui-clippy、guards-final、contracts、eslint、
governance、picker-tests、output-tests、prettier-final均在/tmp/lime-tui-前缀下；失败日志
cli-tests/v2、cli-gate-b-pty与cli-npm-gate-b/v2保留，不改写为成功。

fresh源码CLI日志`/tmp/lime-tui-stage77-cli-gate-b-pty-v2.log`：主Thread
`01a11f73-a6c9-7603-8b48-407166dcb157`、Turn `turn_e48ab7c5bf694efb9ffd5bb4e8f7519a`；
resume Thread `01a11f73-e89f-77b3-9641-86344e199ef7`，原Turn
`turn_303709317ef84718b3bd9f5a7c08ec8d`、新Turn `turn_b4048fb0560e4ad9b8195907b6a3be50`。
UUID/title/cold、last/all、stdin/BOM/UTF16、文件保护/写失败以及原human/JSON/macOS
双流PTY均通过；all真实backend ledger另核对workingDir/workspaceRoot。
TUI源码complete日志`/tmp/lime-tui-stage77-tui-gate-b-v3.log`通过：Thread
`01a11f89-374d-7fd3-a95a-807388a84935`、Turn `turn_83eb3d9cf1f74ae5973835410d1b3c79`。
选择器helper逐步观察与同一UTF8 reader保留原选中/排序/usage断言，未加sleep/延长预算；
每个字节分片回归覆盖箭头/中文/ZWJ/ANSI/OSC和VT100屏幕/游标，真实完整场景含
task/usage/title/status、编辑/历史/backtrack、focus/resize/reconnect与terminal恢复。

最终npm安装态日志`/tmp/lime-tui-stage77-cli-npm-gate-b-v3.log`通过，aarch64-apple-darwin，
真正根包launcher+optional平台包+sibling App Server，CLI和TUI complete均通过。
CLI主Thread `01a11f8b-a8f2-7303-a54e-9f7495fe053a`、Turn
`turn_be1ae212350a4c7faf3e089fe354b943`；TUI Thread
`01a11f8c-a231-71b0-a56f-cc668971af69`、Turn `turn_727a6f662ee64b36a246b8d2e7b71d17`。
安装态resume Thread `01a11f8c-1938-7090-8070-71092a0480b5`，原Turn
`turn_9e801d7993624485adbd24c20e0dfccc`、新Turn `turn_d30c166021a04ffe972c513e236db176`。
该安装态使用第77binary与第78新键盘断言引入前已编译fixture，不冒充第78验收。
root已确认architecture输入/恢复/输出图；KISS/DRY共用参数、协议、runtime、canonical
投影与文件行为，SRP将prompt/thread迁出main。切片100%，总体partial/in-progress，
goal active，无可信总体百分比分母。本轮未验收Windows/live Provider/Desktop GUI或
完整verify:local/前端120批。下一刀回到补全列表键盘UI/UX；exec fork/review、图片输入、
output-schema和其余全维度差异仍为明确未完成项。

## 第七十八阶段：补全列表 Repeat 与修饰键输入（已完成）

继续服务输入框UI/UX对齐。公开Codex ChatComposer忽略Release但处理Repeat；三个补全
popup的Ctrl+P/N仅匹配CONTROL。Lime现有owner只处理Press，Ctrl+Alt+P/N被误吞；
command popup还将Ctrl+J/K当导航，抢占既有editor newline/kill-line。直接修三个owner，
删除无上游依据的J/K导航，不保留别名或compat层。
窄写集：bottom_pane/{command_popup,file_search_popup,skill_popup,input_tests}、既有
PTY suggestions场景/接线守卫、commands/ops与本计划、结构inventory。GUI和共享业务
后端只读；无schema、依赖、配置、文案或协议变化，保留前序脏写集。
退出条件：Press/Repeat导航/确认同义，Release不改变draft/selection；Windows AltGr文本、
Unix Ctrl+Alt控制chord均不抢Ctrl+P/N，Ctrl+J/K到达既有editor，无错误执行/提交；owner/pane回归、TUI crate/Clippy/结构守卫
与fresh真实PTY的Repeat/release/编辑证据通过。架构方向不变，root，2026-10-09。

首次bottom_pane回归490通过/1失败为本刀fixture错误地把Unix Ctrl+Alt当成AltGr，
公开Codex与Lime既有key_hint均仅Windows启用AltGr。保留失败日志并按平台语义修正：
Windows插入字符、Unix保持控制chord，三popup均不误当Ctrl+P/N。PTY在Unix用组合
控制键+后续实际选择/完成确认没有导航；不宣称macOS证据证明Windows AltGr实机。

安装态stage78-cli-npm-gate-b首次CLI全矩阵和新TUI_POPUP_KEYBOARD_OK通过，随后
既有resize/reflow退出检查失败，进程仍显示draft且未恢复alternate screen；保留日志，
不能将局部marker当完整验收。扩展窄测试写集suite/resize_reflow：删除连续三次Ctrl-C
盲发，改为第一键清draft、观察placeholder、第二键退出，保持既有5秒预算与恢复断言。
若单步仍失败再定位生产owner；不加sleep、不延长timeout、不改quit语义。

## 第七十九阶段：exec fork 与共享图片输入（功能/终端验收完成）

对齐公开Codex Command::Fork/ForkArgs和InitialOperation::ForkOnly/UserTurn：UUID优先、
名称精确匹配且跨cwd查源，未找到源显式失败；thread/fork生成新Thread，沿用canonical
history/lineage。无PROMPT仅分叉，不读取pipe、不启动Turn；显式PROMPT或-才继续，
无PROMPT携带图片/最终消息文件显式拒绝。root/resume/fork的-i/--image使用同一
LocalImage输入合同，图片先于Text，不增加CLI私有媒体或runtime后端。
窄写集：exec/cli、prompt、thread及其测试、exec orchestration/locale；既有CLI session
Gate/守卫、commands/ops/npm文档/architecture/结构inventory及本计划。main仅保留现有
root参数继承，GUI/TUI与App Server/protocol/runtime生产只读；保留前序dirty改动。
退出条件：参数前后位置与权限覆盖有效；跨进程fork-only/UUID/name/stdin/image/cold
canonical/source不变均有证据；缺源不fallback，fork-only无合成Turn事件；crate定向测试、
Clippy、contracts、治理和真实stdio/安装态Gate通过。review/output-schema/worktree与
完整UI对齐仍未完成，整体继续in-progress。架构主链不变，root，2026-10-09。

首次stage79-cli-gate-b-pty在fork fail closed：旧terminal fixture仅message.delta+
turn.completed，canonical assistant Item保持非terminal，共享fork正确拒绝复制。没有放宽
生产fork校验；扩展test-only terminal-gate-fixture可选completeAgentMessage（默认false），
本刀exec session显式启用真实message.completed lifecycle，保留原缺通知修复场景不变。
修正后重跑真实Gate，失败日志保留。

v2/v3进一步证明fork成功、turn/start回应已到，但transport没有后续notification：
App Server spawn_request_task的subscription_method只包含start/resume，漏掉fork。
扩展窄生产写集app-server/src/lib.rs仅为既有判定补METHOD_THREAD_FORK，不在超长root
堆叠新逻辑；测试放thread_listener_tests/fork.rs并只在旧test host注册模块。退出条件是
通过真实transport证明fork响应先到、订阅target非source、首个Turn通知可见及终态闭合；
执行App Server定向测试/strict Clippy/契约/治理和fresh CLI Gate。该共享修复同时服务
GUI/TUI，禁止CLI私有resume绕行。public fork复制历史只改thread/session身份，保留原
历史Turn/Item ID；纠正fixture错误的全局ID重建假设，不改既有canonical合同。

v4真实Gate已通过fork订阅与初次继续，cold fork再次fork触发Projection turn identity
conflict：fork_source无条件进入generic repair，重放保留原Turn ID的fork seed到旧全局
projection。扩展窄写集runtime/thread_fork.rs、thread_fork/hydration.rs、thread_read.rs及
thread_fork_jsonrpc/nested.rs；既有超长fork root仅迁出约125行恢复实现并替换调用，
resume与fork统一由hydrate_thread_session选择canonical public-fork恢复，普通及AgentControl
仍走原owner，不改Turn/Item ID或放宽projection约束。integration root仅注册子模块，不
堆新测试；退出条件为nested cold fork保留历史/lineage、source不变、无多余Turn及继续
provider history无重复，并通过共享JSON-RPC/源码/安装态/GUI回归。失败日志保留。
App Server严格Clippy当前158条既有问题阻断（stage79-shared-clippy.log），不得宣称通过；
CLI/TUI严格检查已通过。大文件后续退出条件为继续按fork media/history职责拆分到<800行。

## 第八十阶段：exec output-schema（已完成）

对齐Codex ExecCli.output_schema与InitialOperation::UserTurn.output_schema及load_output_schema：
root/resume/fork前后参数位置均有效，读取UTF-8 JSON文件后lower到既有TurnStartParams
output_schema，由共享runtime/provider处理。不新增CLI schema解释器、后端或全局设置。
无PROMPT的fork携带schema在建立连接前拒绝；缺文件/非法JSON显式error，不能默默忽略。
窄写集exec/{cli,prompt及测试}、exec.rs接线、既有exec Gate/守卫、文档和inventory；
共享生产backend只读，沿用第79独立恢复修复与回归。退出条件：参数、读取/错误、
fork-only拒绝及root/resume/fork真实stdio到external backend合同验证；crate/strict CLI
Clippy/守卫/安装态Gate通过。结构差异仍显式记录，review与全面UI对齐继续未完成。

stage80源码Gate先通过第79全部fork矩阵，随后image夹具错误读取RuntimeReplyInputImage.url
导致startsWith失败；真实共享合同为uri/media_type/provider_data。只修test-only断言为
sidecar引用、精确PNG字节与canonical URL一致性，不修改生产媒体路径或放宽断言。
共享nested fork JSON-RPC最终5/5通过（含两history mode、冷分叉/重启继续/前缀唯一）。

2026-10-09最终验收记录：

- CLI全crate唯一110项通过（lib 8、bin 100、integration 2），日志
  `/tmp/lime-tui-stage80-cli-tests.log`；第79的108项为此前版本，不重复累加。
- 共享listener 10项通过（`stage79-listener-tests.log`），fork JSON-RPC 5项通过
  （`stage79-fork-jsonrpc-tests-v5.log`），fork单元5项及compaction/midturn各1项通过
  （`stage79-fork-related-final.log`）。新增nested回归实际覆盖legacy/paginated两模式。
- CLI/TUI strict Clippy通过（`stage80-clippy.log`）；App Server最新窄scope普通Clippy通过，
  122条既有lib警告，新增hydration/nested文件无诊断（`stage80-app-server-clippy.log`）。
  早期all-target strict Clippy的158条基线错误未治理，不伪称仓库strict通过。
- 7文件128项守卫通过（`stage80-guards.log`）；image夹具修正后再跑2文件9项通过
  （`stage80-guards-v2.log`），后者包含于128项，不重复累加。ESLint/fmt/diff通过。
- contracts与legacy-report通过（`stage80-contracts.log`、`stage80-governance.log`），
  scripts/doc/CLI/App Server current边界通过，治理违规0。
- 最新源码CLI真实stdio/PTY全矩阵通过（`stage80-cli-gate-b-pty-v2.log`）：主Thread
  `01a11ffa-6b1f-7ce1-9b7f-51035a35c998`，Turn `turn_0cec0855b743499291e8f22788d70b11`；
  fork源Thread `01a11ffb-0266-71c3-9052-d6757f4ae3e9`，fork-only
  `01a11ffb-369d-7851-a62e-8dacc12aa833`，continued Thread
  `01a11ffb-3d55-72f2-8950-0969b1ba635b`，Turn `turn_c6d88473c71d422cb89120ef3f3e5d76`。
  root/resume/fork图片字节、canonical引用、outputSchema精确值及下一Turn无schema均通过。
- Agent Runtime current aggregate通过（`stage79-runtime-fixture.log`，external fixture，
  liveProviderUsed=false）；latest GUI smoke重新构建共享sidecar后通过
  （`stage80-gui-smoke.log`），run_id `standalone-shell-01-20261009092444-35670`，
  summary `.lime/qc/project-gates/standalone-shell-01-20261009092444-35670/shell-01-electron-smoke/summary.json`。

分类：exec fork/images/output-schema和共享transport/hydration是current；旧无条件fork
source generic repair路径、重复resume恢复选择为dead/deleted；没有新增compat/deprecated。
SRP迁出125行恢复到155行hydration owner，DRY让fork/resume只用一个选择，KISS/YAGNI
复用既有协议/runtime/media，不增加wrapper或schema解释器。其余前序dirty写集保留，
本进程没有提交、推送或建分支。Windows/live Provider、完整verify:local与前端全量未跑；
本轮证据不升格为跨平台、live输出约束或全局Codex完成度。整体partial/in-progress，
无可信总体百分比分母。下一刀已只读核准exec ReviewArgs、ReviewTarget和review/start
current owner；尚未实现，不计为对齐完成。

最终安装态Gate B完整通过（`/tmp/lime-tui-stage80-cli-npm-gate-b-pty.log`，exit 0）：
真实npm root launcher+optional darwin-arm64 platform package，App Server为同目录sibling；
CLI主Thread `01a11ffc-e595-74c2-af88-90c3cc16399b`，Turn
`turn_8941f3d093fe4fbcadfd6e0101c509ef`；fork源Thread
`01a11ffd-af46-7e93-94b7-ac3828ca2cfd`，fork-only
`01a11ffd-d39c-7160-8cee-55f49692264e`，continued Thread
`01a11ffd-d757-72f0-b90f-fdc246227797`，Turn `turn_1c8afdba1820401c8adfdbf9121c3e04`。
同一安装态CLI包含CLI_EXEC_FORK/IMAGES/OUTPUT_SCHEMA_OK与真实macOS双TTY证据。
TUI主Thread `01a11ffe-c568-7b10-80ed-dedc8f08aa33`，Turn
`turn_fbd3999bf07140a3a1f4151e2b9c4375`；TUI_POPUP_KEYBOARD_OK实际证明Repeat导航/
完成、Release忽略、精确CONTROL、Ctrl+J换行、Ctrl+K到editor，无额外Turn；整套
backtrack/typed revert/草稿/find/history/Vim/工具进度/用量/reasoning/footer/focus/
resize-reflow/reconnect均通过，terminal=restored。第78原安装态resize失败已由真实
状态驱动的两次Ctrl-C退出修复闭环；没有延长timeout或合成终态。

第78输入框交互与第80CLI输出合同切片退出条件100%；第79功能/共享恢复与终端退出
条件100%，仓库App Server all-target strict基线仍阻断，明确保留而非假称交付全绿。
总体仍partial/in-progress，无可信总体百分比分母。安装态为macOS受控external backend
fixture，不等于Windows/live Provider或正式发布证据；未执行commit/push/branch/release。

## 第八十一阶段：exec review（已完成）

继续对齐Codex Command::Review/ReviewArgs/build_review_request与InitialOperation::Review：
--uncommitted/--base/--commit/custom互斥，--title要求commit；不指定target显式失败，
custom '-'经同一stdin解码并trim，空指令拒绝。只请求既有review/start，选择review target/
构造provider prompt/EnteredReviewMode与ExitedReviewMode仍由共享runtime拥有。输出沿同一
EventProcessor、JSONL/human renderer及output-last-message，不建立CLI审查后端或git读取。
窄写集exec/{cli,prompt,thread及其测试}、exec.rs接线，既有exec Gate/结构守卫、文档与
inventory；App Server/GUI/TUI生产只读。保持第78—80最新通过证据，不计为第81验收。
退出条件：CLI参数/target/stdin回归、canonical review边界及目标、cold read/最终文件、
真实stdio/安装态CLI Gate、全CLI/strict Clippy/contract/guard通过。root已确认
Product Surface -> review/start -> RuntimeCore -> canonical投影方向，2026-10-09。

首轮CLI回归发现Clap对--base+--title会因commit与base冲突而豁免requires(commit)，
造成title被静默忽略。保留失败日志，title显式声明与uncommitted/base/custom冲突，
落实既定“title要求commit”语义；不新增参数兼容或恢复私有审查入口。

第81编译期间检测到并行workspace/package版本更新1.152.0 -> 1.153.0，未覆盖/回滚
该变更。第78—80完成证据仍对应1.152.0；第81采用current 1.153.0源码重建并检查
版本一致性，不能复用旧binary冒称fresh，也不能将前一轮GUI/安装态证据升格为新版本。

## 第八十二阶段：空输入导航与编辑按键 owner（已完成）

继续输入框UI/UX主线。Codex handle_empty_prompt_shortcut仅Press打开Agents Overview，
agents_navigation_key_available同时尊重editor/Vim move_left绑定。Lime原先在普通输入
fallback及editor bypass两处重复判断Left，Repeat误触导航、重绑/解绑后footer仍提示。
直接把Left移到空输入快捷键owner，删除两处重复分支；navigation availability读取当前
textarea的已解析动作，复用相同判定给footer，不建立第二套keymap或compat层。
窄写集chat_composer/{input,footer_state,agents_navigation及测试}、既有PTY suggestions与
tui Gate/守卫、commands/ops/inventory及本计划；GUI/App Server/runtime/版本文件只读，
保留其它dirty写集。退出条件：Press打开、Repeat/Release不打开；editor/Vim重绑与解绑
保留编辑语义且无失效hint，pending chord/paste/search/附件/disabled/remote不抢导航；
composer/host回归、TUI crate/strict Clippy、真实PTY与fresh安装态CLI/TUI Gate通过。
架构主链不变，root，2026-10-09。第81真实review marker已到，整套与安装态仍待收齐。

第81源码验收已通过：CLI唯一113项（lib8/bin103/integration2，stage81-cli-tests-final.log），
strict CLI Clippy（stage81-clippy.log，exit0），16项守卫、contracts、legacy-report、
fmt/ESLint/Prettier/diff及verify:app-version通过。current 1.153.0源码Gate完整exit0
（stage81-cli-gate-b-pty.log），Thread `01a1201c-bb69-7763-9d7d-4f94532525fc`、Turn
`turn_c162f152c0bc4b4b94284df518308f70`；CLI_EXEC_REVIEW_OK证明四类target、BOM stdin、
显式prompt忽略pipe、canonical Entered/Exited review、cold读取及plain最终文件，错误在
连接前fail closed。安装态将在第82fresh TUI binary完成后同时验收，尚不关闭此退出条件。

第82删除普通input fallback与editor bypass两处Left导航，统一空输入shortcut返回typed
InputResult，editor/Vim绑定、pending chord、disabled及paste burst共用availability。
没有新增协议/依赖/全局状态；footer复用原消费链。114项结构/PTY夹具守卫通过
（stage82-guards.log），Rust crate与真实PTY仍等待共享artifact锁，不用1.152或未重建
binary冒称证据。既有超长tui Gate root仅增加marker注册，guard仅扩展已有同一场景断言；
后续逻辑继续迁入现有领域helper，root退出条件是按scenario/验证职责拆到<800行。

## 第八十三阶段：顶层 review 与审查夹具拆分（已完成）

对齐Codex Subcommand::Review/ReviewCommand：顶层review与exec review都复用同一
ExecCli/InitialOperation::Review与App Server review/start。root只接受既有ReviewArgs，
输出默认human，连接/权限/locale继承原root合同，不增加第二套审查后端或target解析。
窄写集cli/src/review_cmd.rs、exec/cli默认构造、main仅module/variant/委托注册；已只读
核对main脏diff属于原exec迁出及接线，新增补丁避开既有块，保留全部原修改。main超长
root不加业务逻辑/测试，实现与回归全部进入独立review owner；后续退出条件为迁出
connection/features/debug/thread职责及root测试到<800行。既有cli-exec Gate的review矩阵
迁到cli-review-gate-b helper并扩展顶层真实human/stdin/cold/errors，保持单一fixture owner。
GUI/TUI/shared backend/版本文件只读。退出条件：四target/冲突/默认输出、root参数继承、
canonical单Turn及Entered/Exited身份、源码与安装态Gate、CLI crate/strict Clippy/契约/
治理通过。仅完成声明/代码不关门禁；架构业务方向不变，root，2026-10-09。

第82/83最新Rust检查：navigation定向11通过（stage82-navigation-tests.log，包含于全量），
TUI1646 lib +23 integration +1 dependency guard唯一1670项通过（stage82-tui-tests.log），
CLI8 lib +106 bin +2 integration唯一116项通过（stage83-cli-tests.log）；CLI/TUI strict
Clippy通过（stage83-clippy.log）。130项8文件守卫、contracts、legacy-report及fmt/ESLint/
diff通过，零边界违规。本轮验证的是current dirty tree，不表示全部改动属于本进程。

首轮真实Gate失败日志保留：stage82-tui-gate-b-pty.log的新增navigation场景已证明
Repeat/Release留在composer、Press打开/cancel、draft Repeat移动；随后clear_draft原只
用Ctrl-U，新增场景光标在aXb中间，依正常语义残留b。只修fixture先Ctrl-E移行末再Ctrl-U，
不改生产清理/退出行为或缩弱断言。stage83-cli-gate-b-pty.log在既有color auto场景
exit1，原assert仅打印exit；给test-only human Gate补stdout/stderr诊断，原因仍待重跑核准。
两套完整Gate和安装态仍未通过，不把局部marker或Rust全量当终端验收。

进一步只读确认共享target/debug/lime已经不识别新增顶层review，同时并行发布校验
frozen-cli-build/frozen-tui-build使用同一target；不能将被替换的可执行文件当current源码。
扩展窄test-only写集terminal-gate-binaries/helper test、CLI/TUI Gate初始化与守卫：本地
构建完成后snapshot到已创建的场景temp目录，保留同目录可用runtime sibling/loader library；
显式LIME_CLI_BIN/APP_SERVER_BIN保持安装包launcher/sidecar上下文，不改生产Host/protocol。
新增真实文件回归证明替换源文件后snapshot字节不变，以及partial/双explicit路径语义；
CLI增加与TUI一致的keep-temp诊断开关。父Gate只注册准备调用，copy归唯一helper。
CLI初次color原因仍无完整stderr，产物串用为已确认的验收风险，不冒称已定位该exit1原因。
v2重建进行中；最终证据需新helper生效且完整Gate/安装态通过。

第82/83源码最终Gate已有完整exit0：stage83-cli-gate-b-pty-v3.log使用scenario冻结binary，
Thread `01a120af-cac9-79a0-9a82-f1980631d8d9`、Turn `turn_16797a071345445b880a290da2215482`；
stage82-tui-gate-b-pty-v3.log的Thread `01a120b0-5800-77d3-b051-d10c3b5480c4`、Turn
`turn_aee85e8ca2204fb49f77db4abdb61a71`，新导航/补全marker与整套focus/resize/reconnect/
backtrack/config/footer/terminal restored通过。v2的旧color exit1和statusline筛选等待未
再出现，根因无完整证据，不谎称copy修复了其业务原因；已确认的shared binary覆盖风险
由snapshot守卫关闭。snapshot专项40项通过（stage83-snapshot-guards-v2.log）；最终9文件
唯一135项守卫通过（stage83-final-guards.log），不累计子集。最初Vitest也匹配.lime/release
candidate旧测试造成1失败，重跑显式exclude .lime/\*\*，没有改旧发布副本或放宽current断言。
final contracts/legacy/ESLint/fmt/diff通过；安装态CLI全矩阵已通过但TUI仍在运行，保持未关闭。

## 第八十四阶段：Vim 空输入 slash command（已完成）

Codex handle_key_event在empty、无query/popup/operator且plain '/'解析为Vim search时
先enter_vim_insert_mode，随后使用同一slash popup。Lime原空草稿直接Vim query，阻止命令
补全；直接对齐同一条件，不做全局slash fallback，显式remap/unbind和pending chord仍归
已解析动作。窄写集composer/input、vim_search/agents_navigation测试、既有PTY vim_keymap
与Gate marker/守卫、commands/ops/inventory及本计划；shared backend/CLI/GUI/版本只读。
退出条件：empty '/'命令补全/Insert，非空和chord保持search，release/disabled不变；
composer/host/TUI crate/strict Clippy、fresh真实PTY与安装态完整Gate通过。
本刀不把第82/83冻结binary冒称新增Vim验收。root，2026-10-09，架构主链不变。

第81—83安装态最终exit0（stage83-cli-npm-gate-b-pty.log）：npm root launcher、optional
darwin-arm64 platform包、sibling App Server保持原上下文；payload来自已验收冻结目录
cli-gate-b-hwBRdz/binaries。CLI Thread `01a120b2-74c6-70e3-9749-203089758e8c`、Turn
`turn_e75740abbc2c43448870927f4f3f53e8`，全部exec/root review marker通过；TUI Thread
`01a120b3-d103-7751-89fd-3ff0a2c44d13`、Turn `turn_bdf43172075c4443945f618787ef6daf`，
新empty navigation、popup键盘与完整backtrack/config/footer/focus/resize/reconnect通过。
三切片退出条件100%，整体仍partial/in-progress，无可信总百分比分母。current为统一
exec/review/empty shortcut/keymap owner；重复Left fallback/editor bypass及shared target
直接重复消费路径为dead/deleted，无新增compat/deprecated。SRP拆review fixture（exec Gate
745->660行），DRY复用ReviewArgs/ExecCli/shared runtime与footer availability，KISS不加协议
或backend，YAGNI不加fallback。未验证Windows/live Provider/本轮GUI及verify:local全量；
第80 GUI证据仍为1.152.0，不升格1.153.0。本进程未commit/push/branch/release，保留并行
版本/GUI/配置写集及staging；第84新增Vim行为尚未计入上述证据。

第84 composer定向200通过；全TUI首次1648通过/1失败为app/interrupts测试仍以空草稿'/'
启动search的旧假设。扩展只改该clean测试fixture，先放非空草稿继续证明搜索期间不interrupt；
生产should_interrupt_turn未改、不放宽断言。日志stage84-tui-tests.log保留，修正后重跑全crate。
114项结构/PTY守卫与ESLint/fmt/diff已通过；fresh真实PTY/安装态仍待闭环。

第84完整TUI最终1673项（1649 lib、23 integration、1 dependency guard）及strict Clippy
通过，日志stage84-tui-tests-final.log/stage84-clippy.log。fresh首轮新增Vim marker通过，
随后footer旧fixture仍用empty '/usage'启动search；改为先输入非空usage并等待Normal，再
保留同一query/footer/context断言，取消后显式清draft。v2被既有180秒完整场景门禁终止，
不延长timeout、不弱化canonical断言；v3追加local-status/external-editor/restored-editor
阶段和output bytes诊断。进程sample只读显示footer等待在vt100屏幕解析中，尚无完整失败
screen，不据此改生产输入策略。所有失败日志与isolated temp保留，验收条件仍未关闭。

第84源码完整场景exit0：stage84-tui-gate-b-pty-v3.log，Thread
`01a120c7-8e91-7290-9c46-a2f89ab2ffc4`、Turn `turn_4f620384e4bd4d13995c105c785f6d90`，
使用本轮tui-gate-b-0t8Sk1/binaries冻结产物。安装态CLI＋TUI完整exit0：
stage84-cli-npm-gate-b-pty.log，CLI Thread `01a120ca-e8ac-7c61-9ea7-d138df72f27e`、Turn
`turn_18f0bd24580540e3813204c71574ea46`；TUI Thread `01a120cd-2dff-73f3-8829-e9725079785d`、
Turn `turn_0c0d5064b7894f198968e13897445ab2`。新empty slash marker与complete、canonical
stdio/replay/backtrack、配置/footer/resize/focus/reconnect和terminal restored全通过。
最终4文件64项守卫、Prettier通过；footer仅格式修正后inventory与fmt继续更新，Rust生产
检查沿用本轮1673项/strict Clippy，真实PTY实际执行更新后的fixture。v2超时根因未充分
确认，不宣称诊断marker修复了性能或业务逻辑。current为统一Vim/命令输入owner，旧空草稿
搜索fixture假设为test-only/rewrite，无新增compat/deprecated。本切片退出条件100%；整体
partial/in-progress，无可信全局百分比分母。Windows/live Provider/本轮GUI与完整verify:local
未验收；前序GUI证据不升级至本轮版本。

## 第八十五阶段：备注 composer 配置与结构化草稿（实施中）

Codex RequestUserInputOverlay使用ChatComposerConfig::plain_text与相同粘贴管线；Lime仍
默认启用补全，将每题草稿flatten为String并用insert旁路粘贴处理。在既有composer owner
引入实际被消费的配置、将备注切至plain_text、保存同一ComposerDraft并复用handle_paste，
统一长粘贴展开/blockquote/游标恢复，防止literal命令/文件/skill内容成为隐藏popup或附件。
main composer保持默认行为；不复制runtime、协议、答案提交或canonical身份。生产实施须
先收齐第84源码PTY，再从其冻结产物验安装态（均已exit0）；新切片重新构建与验证，不沿用
旧binary。窄写集chat_composer/config、root module/constructor、completion/input/paste、draft
和request_user_input生产/独立paste tests，既有PTY notes fixture及Gate marker/守卫，
architecture/commands/ops/inventory与本计划。保留已有脏diff，避让release/backend/GUI写集。
退出条件：plain notes保持literal且无popup/image，主输入默认不变；长粘贴/blockquote与
逐题cursor/atomic payload恢复/拒绝保留；TUI crate、strict Clippy、守卫与fresh源码notes
PTY和安装态通过。仅接入字段不算完成。root，2026-10-09。

实现已落current owner：ChatComposerConfig/new_with_config/plain_text使用同名语义；仅接入
popups/slash/image_paste/blockquote四项实际消费策略，不补未消费字段。trim保持已有同一
提交规则，shell分发与Vim接受时机继续沿原owner，完整Codex配置/命令解析仍partial。
question_drafts直接替换为ComposerDraft；replace_draft开启新编辑生命周期，旧跨题undo
不复活；handle_paste复用规范化/blockquote/atomic payload。locale从唯一主composer配置
注入enqueue、排队和thread恢复，不复制host配置进snapshot。SRP保留独立paste_tests，DRY
共用prepare_submission_text/expand_pending_pastes，KISS/YAGNI不加第二textarea或业务后端。
旧String flatten/notes insert旁路为dead原位删除，无新增compat/deprecated。

第85新增8个稳定回归含真实PNG路径、Unicode长粘贴逐题cursor/payload、展开后长度拒绝、
Markdown规范化、跨题Vim undo、plain空slash与五语言host注入；全部纳入当前全TUI1657 lib
+23 integration+1 dependency guard（唯一1681项）通过，strict all-target Clippy通过。
前序notes定向40项只作为子集，不累计最终测试数。4文件64项守卫、contracts、legacy-report、
ESLint通过；marker文字调整后定向守卫与inventory最终再更新。源码完整11场景fresh Gate
运行中，安装态Gate扩为complete,user-input，并核对完整canonical长答案而非仅marker。
本轮扩展BottomPane composer/input_state的locale接线，已核准原文件干净且为相同输入owner。
超长TUI Gate/guard root只补既有场景注册与断言，后续退出条件为按composer/notes/export/
terminal职责迁到独立owner，每个<800行；不继续把新交互矩阵堆入root。

下一刀只读证据：RequestUserInputOverlay收到InputResult::Submitted时composer已take，随后
commit调用save_current_state把accepted问题的rich draft覆盖为空；PageUp返回后无法继续
编辑原备注，重新提交还会覆盖已有答案。Codex用pending_submission_draft保存提交前输入
并在结果接受时保留可逆状态。应在同一notes owner接入该提交快照，覆盖已接受问题返回/
修改/再次接受的完整对象回归与真实双题PTY；保持final response由既有App Server request
完成，不创建额外Turn或复制答案业务后端。本轮只读核准，尚未实施，不计入第85验收。

第85首轮fresh完整Gate在images外部编辑器场景失败，complete及新notes marker已通过，
失败日志stage85-tui-gate-b-pty.log保留。图片正文已经回显，Left后终端游标仍在行末；
fixture原仅等待正文便发导航键，没有同主complete一样等待初始游标恢复。仅补初始cursor
position观察点，保留原Left/Right与图片canonical完整断言，不改生产输入/图片owner或延长
timeout。扩展test-only images.rs写集，先用本轮冻结binary定向复验，再核对相关输入场景；
fixture同步问题尚未充分证明为唯一根因，未把首轮marker当最终完整Gate成功。

第85图片定向使用同一tui-gate-b-79MkYe/binaries冻结产物exit0（stage85-images-gate-b-pty.log），
Thread `01a120de-d548-76c1-b4d6-be20ae95bcff`、Turn `turn_b84a5929b2be4e9eb89b9094d74c3686`，
image输入完整bytes/owned occurrence/cold canonical与terminal恢复通过。第85生产实现与
Rust/strict Clippy已通过；为避免重复安装态验收，将同一备注流的第86提交快照修复合并为
latest证据闭环。第85未独立关闭安装态条件，不将旧冻结产物当新增第86证据。

## 第八十六阶段：已接受备注的可逆编辑（实施中）

按Codex同名pending_submission_draft/handle_composer_input_result收敛：在composer消费
Enter前捕获完整draft，只有Submitted将其交给commit保存，query/noop/queued/rejected清除
pending；commit保存提交前cursor/elements/payload后再移动到下一题。原答案map和final
App Server response保持唯一authority，不复制后端。accepted长备注回访/修改/再次接受保留
另一题draft与cursor；本刀不宣称Codex完整unanswered确认或answer_committed状态机已对齐。
新增回归还暴露empty Enter在query/modified key之前被notes shortcut提前接受，原位修为
只有plain Enter且无Vim/history/query owner才接受；Shift/Alt Enter继续编辑换行。
窄写集沿第85notes owner/tests、既有真实双题PTY、terminal-gate-fixture的test-only可选
followupQuestion与Gate完整答案断言、docs/inventory/本计划；App Server/GUI/backend/版本只读。
退出条件：回访accepted rich draft与再次接受exact答案，query/拒绝不留pending，双题真实
PTY及源码/安装态都响应一次、无额外Turn、terminal restored；TUI crate/strict Clippy/guards
通过。首轮新回归42 pass/1 fail为empty Vim query Enter被提前commit，保留失败日志，
生产输入shortcut已修，待latest重跑。root，2026-10-09，架构业务方向保持。

第86 notes最新定向44通过（stage86-notes-tests-final.log，含第85子集），完整TUI1660 lib
+23 integration+1 dependency guard唯一1684项通过（stage86-tui-tests.log）。strict Clippy
首轮仅测试多余clone失败，改为borrowed slice后stage86-clippy-final.log退出0，不加allow。
5文件69项守卫/实际generated backend测试、ESLint/Prettier/fmt/diff通过；纯测试借用调整后
inventory与守卫latest刷新，Rust行为未更改，不累计重复子集。第85共用contracts与legacy
检查仍有效，shared method/schema/config无生产变更。

fresh第86双题PTY两个新marker均通过，随后stdio thread-handoff fixture期望单题立即回应，
却复用了新增双题backend，导致原完整响应断言失败。stage86-tui-gate-b-pty.log保留；只在
PTY进程完成之后，复用同一backendOptions/生成owner为既有stdio场景生成单题配置，不改
session_lifecycle测试或生产策略。第86冻结tui-gate-b-1txdZB/binaries字节不变，v2复验中；
canonical两题完整答案/exactly-once与整套terminal/stdio条件仍须最终完整exit0再关闭。

v2双题PTY与既有stdio线程往返均已完成；后续complete的pre-turn fixture读取共享ledger，
未区分先执行的user-input Turn，错误报告extra Turn。该失败来自本次为优先诊断新场景而
手动调整的场景顺序；恢复仓库默认complete-first顺序验收，不改生产策略、不删除真实
ledger、不放宽pre-turn断言。stage86-tui-gate-b-pty-v2.log保留，默认完整v3运行中。

后续已核准的问答状态缺口（尚未实施）：Lime仍分散维护question_drafts/selections/editing
三组镜像及answers map；Codex AnswerState统一每题draft/option focus/answer_committed。
accepted备注编辑后不再次接受就切走时，当前answers仍可能保留旧文本；跳过未接受问题
到最后一题则直接finish，没有Codex unanswered确认。下一刀应统一每题state、仅在正文/
option变化时撤销acceptance（cursor移动不撤销），并复用当前list keymap提供未接受问题
确认与返回编辑。必须覆盖五语言、键盘query优先级、完整response及真实双题PTY，不能
用自动提交空答案掩盖状态差异。这里作为明确defer，不计入第85/86的100%专项条件。

v3双题PTY通过，随后reconnect测试的最终/pwd尚留在composer便发送Ctrl+D，退出失败。
目录wait匹配的是已有header，不能证明command已消费。仅扩展test-only reconnect.rs：
先观察/pwd实际显示，再发送Enter并等待draft消失，原恢复目录、无额外Turn、canonical
分页与alternate-screen恢复断言均保留。冻结第86产物定向exit0
（stage86-reconnect-pty.log）；完整默认顺序v4运行中，不扩大timeout、不改production。

v4源码与首轮npm的TUI complete均触发既有180秒总超时；npm完整CLI矩阵已exit0，不能
据此关闭安装态TUI。短采样stage86-pty-cpu-sample.txt观察到test线程在footer的VT全trace
重解码，尚不足以证明唯一根因。将screen/cursor/marker观察迁到test-only terminal_observer，
仅为同一append-only trace增量处理全部bytes；prefix变化/截短重建parser。保留全部
screen/cursor/cell/canonical断言与原timeout，补每个Unicode/escape边界和trace切换的fresh
parser等价回归；后续用冻结第86binary完整复验。本刀不修改产品输入或共享协议。

增量observer首轮完整复验22.68秒暴露export窄屏还原Unicode尾部失败，未放宽原字符断言。
旧观察器始终24x100，没有随真实PTY resize调整emulator几何；现在7个既有resize夹具
（approval/agent_picker/status_line/title_setup/resume_picker/export/footer）在同一观察owner
同步真实rows/cols，保留原PTY调用与每个键盘/viewport断言。新增resize/repaint等价回归，
observer共3项通过；旧v5与npm失败日志保留，完整v6运行中。测试治理只服务真实UI验收。

v6仍失败：export窄屏观察predicate与原宽屏相同，resize还未处理便立即恢复宽屏。
补观察窄屏独有完整footer enter/esc，再恢复；v7全部PTY/stdio交互完成，最终full backend
对象核对暴露fixture期待followup数组错误。现有App Server approval_server_request的
RuntimeActionResponse::user_input把单答案lower为String、多个答案lower为Array；原位修正
expected followup为精确String，不改production lowering，option+notes的完整Array仍保留。
第86npm v2完整CLI再次exit0；它的TUI编译与本轮第87接线重叠暴露两处旧字段消费者和
测试作用域，均已直接迁移，无wrapper。第85/86仍待冻结产物最终aggregate通过，不升格。

## 第八十七阶段：逐题接受状态与未回答确认（实施中）

目标为Codex同名AnswerState/answer_committed/confirm_unanswered语义，直接替换question_drafts/
question_selections/question_editing与预生成答案map。每题唯一保存draft/options_state/focus/
explicit acceptance；内容或选项改变撤销接受，cursor/focus导航不撤销。末题提交存在未接受
问题时使用current list keymap确认继续或返回首个未回答项；仅显式接受的内容进入最终response，
未接受项为空数组，不把旧接受文本或highlight当答案。生产不新增runtime/method/schema，GUI
继续共用既有response边界；本刀保持既有freeform答案形状，完整Codex前缀语义另行核准。
窄写集request_user_input/{mod,state,confirmation,render,tests,paste_tests,render_tests}、同一
ComposerDraft展开方法、locale独立模块、既有双题PTY与Gate markers/guards、文档/inventory。
避让release/CLI/backend/GUI改动。先保持第85/86冻结产物验收，其证据不得作为第87生产验收。
退出条件：镜像数组/map删除；修改后未再次接受不提交旧答案；unanswered确认可返回并保持
rich draft/cursor；五语言、query/配置键/Release优先级、全TUI/strict Clippy/守卫通过，fresh
源码与npm双题真实PTY完整response/exactly-once/terminal restored通过。root，2026-10-09。

current接线与旧消费者已直接迁移：AnswerState独占ComposerDraft/ScrollState/Focus/acceptance，
confirm_unanswered使用共享SelectionRow与实际list keymap。标题/说明按宽度换行，确认期间不显示
notes cursor；五语言、空/窄尺寸、query/配置chord/unbind/Release均有稳定回归。旧三组镜像数组、
预生成answers map和直接editing字段为dead/deleted，无新增compat/deprecated。SRP拆分state与
confirmation，DRY复用draft展开和selection owner，KISS/YAGNI未增加业务协议或第二答案缓存。
责任开发者root已核对architecture.md中Product Surface -> App Server -> shared runtime方向，
本刀仅改变TUI presentation state，GUI/TUI协议、runtime和持久化owner继续共用。

最新全TUI1671 lib+23 integration+1 dependency guard唯一1695项通过
（/tmp/lime-tui-stage87-tui-tests-latest.log），TUI strict all-target Clippy
--no-deps -D warnings通过（stage87-clippy-latest.log）；依赖owner既有lint不由本刀掩盖。
inventory已刷新，当前5文件69项守卫、ESLint、legacy和scripts治理通过。首轮Vitest文件filter
同时匹配.lime/releases/v1.153.0/candidate历史副本，旧副本3项失败，源码69项均通过；限定
--exclude .lime/\*\*的stage87-guards-current.log完整exit0，不修改并行release副本。

本轮fresh构建已立即冻结到
`/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage87-frozen-Kk56u2/binaries`，
build记录stage87-build-freeze.log。源码默认完整11场景和npm完整CLI+TUI complete,user-input
均从同一冻结目录启动；当前等待并行Cargo构建释放锁，最终Gate未返回，不能据此关闭85/86/87。
第86npm v3已exit0（stage86-cli-npm-gate-b-pty-v3.log），但第86源码v9仍在images editor返回后
Left cursor等待失败；保留失败记录，第87完整矩阵将检查该问题是否重现，不延长timeout或放宽断言。

下一刀已核准：notes调用ChatComposer::handle_key_event临时关闭paste burst，而主输入的
handle_key_event_at与帧调度已使用共享检测器。Codex request_user_input同一composer检测和
active-view flush覆盖普通快速粘贴；Lime目前仅bracketed paste充分接入。后续应把检测、计时
flush和question handoff作为同一输入生命周期迁移，覆盖Enter/Tab仍属paste、held字符不丢、
accepted答案变更和真实非bracketed PTY；当前未实施，不添加针对不存在held-state的推测性修复。

第87首轮源码与npm均在Go back夹具失败：真实list配置accept=f9，夹具却发送Down+Enter，
screen已选中Go back并显示f9 submit。产品正确忽略未绑定Enter；仅改测试输入为Down+F9，
保留完整draft/cursor/exact response断言，首轮日志保留。第87源码默认完整11场景v2 exit0
（/tmp/lime-tui-stage87-source-gate-b-pty-v2.log），notes Thread
`01a12127-16a6-7fa1-94e3-3ff7b7ee4fe8`、Turn `turn_887b4042b815467c9958fb0afb495d52`，
ledger恰好一次turnStart和actionRespond；images/完整typed stdio/cold恢复/terminal restored均通过。
npm v2完整CLI与complete,user-input exit0（stage87-npm-gate-b-pty-v2.log），notes Thread
`01a12128-30da-7a00-8d63-b9210c12ee3d`、Turn `turn_6e327197c38441ff936b13b84befa483`，
相同完整答案与一次响应、Node launcher/platform sibling App Server/终端恢复通过。
contracts通过（stage87-contracts.log），无protocol/schema/config/dependency生产变更。
85/86/87约定的备注专项退出条件100%闭环；本节标题保留实施历史，总体仍partial/in-progress。
第86images游标失败未被证明根因已消除，虽然第87完整矩阵通过，继续作为稳定性观察项保留。
Windows/live Provider/本轮GUI和完整verify:local未执行，此证据只覆盖macOS terminal主链。

## 第八十八阶段：备注普通快速粘贴生命周期（实施中）

参考Codex request_user_input的共享composer/is_in_paste_burst/flush_paste_burst_if_due，直接
让notes消费ChatComposer计时输入、同一PasteBurst和FrameRequester调度。Enter/Tab在burst中
归正文，不走notes空答案或焦点shortcut；modified/navigation在同一输入owner先flush，切题
保存完整草稿。普通typing idle flush不误接受问题，内容落入draft后撤销旧acceptance。
窄写集notes mod/state/paste tests、新独立burst tests、shared paste preparation命名和现有
BottomPane消费者、同一双题PTY/guard、architecture/commands/ops/inventory/本计划。
不改GUI/backend/runtime/protocol/config/依赖或版本，不增加第二粘贴检测器及compat入口。
退出条件：single held字符与长Unicode burst均不丢；Enter/Tab字节保留；导航和提交snapshot
包含完整payload；query/Release不误提交；active notes idle由共享帧刷新，真实非bracketed PTY
与fresh源码/npm完整canonical/一次response/terminal恢复通过，定向及全TUI/Clippy/守卫通过。
责任开发者root确认业务架构方向不变，后续更新仅描述TUI交互生命周期。2026-10-09。

第88首轮7项新增回归与完整TUI唯一1702项、strict scoped Clippy、69守卫通过；fresh产物
冻结于tui-stage88-frozen-XHycOr/binaries。但源码真实raw notes长输入未形成atomic placeholder，
原位保留stage88-source-gate-b-pty.log。npm同一raw notes与完整答案通过，随后portable-PTY
resize_reflow清空草稿等待失败（stage88-npm-gate-b-pty.log），不得用notes marker替代整套通过。
只读对照Codex chatwidget/interaction::handle_paste_burst_tick核准，Lime runtime每事件都draw，
捕获burst期间仍反复渲染，与Codex暂缓burst绘制不同；该差异可造成输入处理间隔放大，尚不
宣称它是唯一根因。接入同名ChatWidget tick与BottomPane统一flush/is_in_paste_burst，空闲
落入草稿后请求下一帧，burst未结束时调度同一FrameRequester并跳过本帧。只扩展原本干净的
chatwidget/input.rs与runtime.rs三行delegate写集；不改变event broker、协议或终端模式。
Runtime root超过1000行，本刀仅替换draw delegate，退出条件仍为后续按session/history/
clipboard/terminal职责拆到既有runtime模块，禁止继续堆叠业务逻辑。责任开发者root确认
architecture.md继续只有terminal presentation调度变化，GUI/runtime/data事实源不变。
追加一条ChatWidget->BottomPane->完整答案回归，时间从同一handle_event_at贯通notes，不靠
固定sleep；真正生产notes只走计时入口，旧无时间入口限定test-only。latest待再次闭环。

第88 latest全TUI1679 lib+23 integration+1 dependency guard唯一1703项通过
（stage88-tui-tests-v3.log），strict all-target no-deps Clippy、5文件69守卫、ESLint/format/diff
通过，inventory刷新。新增8项回归只计入全套一次。fresh v3冻结目录
`/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage88-v3-frozen-PPAbUg/binaries`。
npm完整CLI+complete,user-input及stdio/focus/resize/reconnect全部exit0
（stage88-npm-gate-b-pty-v3.log），真实raw Enter/Tab+Unicode完整答案与一次response通过。
源码v3在complete外部editor后首个Left等待失败，定向raw notes同时执行时也发生分段，两个
日志保留（stage88-source-gate-b-pty-v3.log、stage88-notes-gate-b-pty-v3.log）。暂缓绘制
并非充分根因，不能用npm通过掩盖源码稳定性问题；第88保持partial，不标100%。
当前单独串行raw notes复核用于区分负载，仍不放宽whole atomic label/canonical/终端断言。
crossterm旧patch与Codex新patch只读对照，stream Drop仍异步唤醒shutdown且无join，未找到
足够依据本刀升级核心依赖或改EventBroker；不能靠推测修改reader或增加sleep来规避Gate。

无并行Gate负载时，同一v3冻结产物定向user-input完整exit0
（stage88-notes-gate-b-pty-serial.log），Thread `01a12141-be6b-77f0-ba4b-4529158b873e`、
Turn `turn_18ceb1da2e3d40e6ab048449952818cd`，raw burst/Enter+Tab/Unicode/atomic展开/
双题修订/未回答确认/一次response/stdio/终端恢复均通过。此证据证明current接线和完整答案，
不证明负载下稳定性已解决。继续串行源码默认11场景，用于核对最新普通composer与editor
恢复路径；仍保留前述负载分段与外部编辑器首键失败为open，不靠重复绿灯关闭它们。

串行源码默认矩阵最终exit1（stage88-source-gate-b-pty-serial.log）：complete已越过
external/restored-editor及usage流程，停在footer canonical-config，命中既有总超时，不能
关闭源码aggregate退出条件。短sample只有2个有效采样，看到screen_chunks/Layout/Solver
不足以判定性能根因。npm v3与定向notes成功仍仅保留各自证据范围；第88稳定性partial。

补核npm v3的notes identity：Thread `01a1213f-2338-7772-b5d0-dcbbbabcd86f`、
Turn `turn_4d41d41839084329b99cfe63be10ffe8`；独立ledger恰好一次turnStart与一次
actionRespond。此记录补全前述安装态证据关联，不改变第88稳定性partial分类。

## 第八十九阶段：MCP 表单共用结构化 composer（终端专项验收完成；总体 partial）

对照既定Codex基线的mcp_server_elicitation，移除独立TextArea/String草稿和直接insert粘贴
旁路，使用ChatComposerConfig::plain_text、ComposerDraft、同一计时PasteBurst及active-view
帧调度。每字段保存cursor/atomic payload，接受后可回访；仅内容变化撤销接受，query/chord
优先且Release不参与提交。长输入拒绝走现有五语言消息；MCP typed response、schema与
App Server router继续唯一，不增加第二backend或compat包装。
窄写集mcp_server_elicitation.rs及其input/render/tests、BottomPane既有active-view接线与
render路由、TUI守卫/inventory、本计划和相关架构说明；真实fixture仅进入既有测试目录。
避让CLI/review/release/backend/GUI并行写集。退出条件为rich draft回访、raw/bracketed paste、
Enter/Tab正文、cursor-only接受保持、oversize拒绝、五语言窄屏与共享接线稳定回归，TUI crate/
strict Clippy/守卫、fresh真实stdio和PTY证据；没有MCP专属进程证据不宣称MCP Gate B完成。
root，2026-10-09。第88两项稳定性仍open，下一刀不以重复绿灯替代根因修复。

第89生产输入与9条新增确定性回归已通过完整TUI1712项及scoped strict Clippy；新增stdio/
PTY opt-in夹具的普通cargo运行只证明编译，不计真实进程证据。97项源码守卫、ESLint、
contracts、legacy和scripts治理通过。真实MCP首轮等待超时（stage89-mcp-gate-b.log）；
将等待改为并行观察真实调用结果后v2立即暴露服务端自动decline，而非TUI输入失败。
只读确认mcp manager/tools的call_tool一律传scope=None，client_service因此直接decline；
exact App Server mcpServer/tool/call正走这条已有路径。扩展原本干净的mcp/src/manager/tools.rs
窄写集：只有固定runtime_owner的线程连接建立turn_id=None的同一McpCallScope，管理连接
保持None。沿用McpBridgeClient的connection-local lease/router，不添加协议、fallback或另一
工具执行owner；GUI/TUI同时获得该共享修复。新生产变更必须重新mcp/TUI测试、Clippy和
fresh构建冻结，不能用首轮stage89-frozen-BpJCEc证明修复后结果。root，2026-10-09。

2026-10-10续跑：新增manager/tests/elicitation.rs两条真实RMCP duplex边界回归，覆盖
thread owner且turn=None的显式调用与management连接拒绝；只使用公开客户端构造入口，
不为测试扩大production API。直接cargo首轮因未注入仓库V8制品解析环境返回上游404，
后续统一经resolveRustyV8CargoEnv；发布candidate目录中的旧Vitest被路径子串误选，
显式排除.lime后当前5文件119项守卫通过（stage89-guards-v5.log）。这两项首轮失败为
验证环境/选集问题，保留日志，不作为产品通过证据。manager新增测试首轮私有接口编译
失败已改用公开构造入口；latest MCP/TUI全套、Clippy与fresh stdio/PTY仍待本轮结果。
inventory已更新1530个源文件；本切片尚未满足真实MCP Gate B退出条件，不标完成。

latest v6全套MCP174项与TUI1690 lib+23 integration+1 dependency guard（TUI唯一1714项）
通过，contracts/legacy、ESLint/Prettier/diff通过。跨MCP strict Clippy暴露6项原有lint，
失败日志stage89-validate-build-v6.log保留；未开始freeze，不以该轮证明fresh Gate。
扩展原本干净的elicitation.rs、elicitation_tests.rs四个调用点与oauth_tests.rs窄写集：
删除仅测试消费的request入口和拆散provenance的10参数入口，唯一request_with_scope
直接消费完整McpCallScope；生产owner降到800行以内。OAuth测试只做contains机械替换
和await前释放查询锁，不修改OAuth生产行为；不新增allow或兼容层。超长elicitation_tests
仅机械迁移旧调用、不增加业务矩阵，后续按router/lifecycle/response拆分独立测试owner。
该收敛直接服务本轮共享MCP表单作用域，不以通用lint治理替代真实stdio/PTY退出条件。

v8已通过MCP174与TUI1714项、跨两crate strict all-target no-deps Clippy并fresh构建冻结：
`/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage89-v8-frozen-aTBWbK/binaries`。
v7遗留cfg(test)令正常构建缺少scope入口，Clippy拦截后已移除，失败日志保留。
v8/v9 stdio真实通过，PTY夹具启动失败：其重复传入TUI已提供的stdio/backend参数；v9
尝试直接Node入口也不符合TUI默认先追加runtime参数的合同。最终夹具使用直接Node shebang
relay且仅追加隔离data路径，并记录relay stderr/exit；不改产品transport或延长等待。
stage89-mcp-gate-b-v10.log最终exit0，stdio Thread `01a12178-8445-7c21-b102-fbfcb6920796`，
PTY Thread `01a12178-8ced-7d92-ac5c-7d5e051c5d00`，raw atomic/完整rich draft/cursor/
完整typed response恰好一次/真实tool result/cold canonical turns=[]/alternate screen与终端
恢复均通过。两条证据均使用v8冻结产物；后续仅调整test-only夹具，未改生产binary。
第88负载粘贴分段、editor首键与complete总超时仍open，不能因MCP专项绿灯关闭。

## 第九十阶段：问答编码与兜底选项语义（终端专项验收完成；总体 partial）

核准Codex submit_answers统一将已接受的自由文本编码为user_note，合成选项wire label为
None of the above；Lime当前自由文本裸值/Other与合成标签说明混排仍不一致。直接改同一
request_user_input response owner，迁移完整答案断言与真实notes Gate canonical期待；
不在App Server修改任意用户字符串，不改schema或另建后端。展示文案保留五语言，并把
合成选项的名称和可选备注说明交给同一SelectionRow布局，不改变作者提供的选项label。
窄写集为request_user_input mod/state/render及相关tests、BottomPane输入接线tests、
locale/request_user_input（从超长locale.rs迁出旧文案方法）、既有notes Gate断言及docs/
inventory/本计划；GUI/runtime/protocol/CLI/release只读。退出条件：所有问题模式的完整
response一致、作者label不被替换、五语言窄屏合成行、最新TUI/strict Clippy/守卫、fresh
真实notes PTY完整canonical答案与一次response。总体保持partial，无可信总体百分比分母。
root，2026-10-10。

第90生产编码/五语言SelectionRow与两条新增完整serialized response回归已落地；定向60项
通过（stage90-notes-tests-v2.log）。完整TUI首轮1689 pass/3 fail为thread handoff和queued
keymap测试仍期待自由文本裸值，实际返回正确user_note；核准两文件原本干净后仅迁移三处
答案断言，保留原rich draft、cursor、identity与跨题接线断言。窄写集补入
app/thread_interaction_tests.rs与bottom_pane/keymap_tests.rs，不改其生产owner。
119项守卫、ESLint/Prettier通过；latest全套、Clippy、fresh notes PTY与安装态待本轮结果。

第90最终完整TUI1692 lib+23 integration+1 dependency guard，唯一1716项通过；两条新
serialized response回归只计入一次。第89 MCP174项仍为同一生产scope实现的有效证据。
latest跨MCP/TUI strict all-target no-deps Clippy、fmt、119唯一守卫、ESLint/Prettier、
contracts（含scripts治理）、legacy（零候选/零漂移/零违规）与diff check通过。
最终31项Gate守卫为119子集，不重复累计。inventory1530源文件刷新；新生产/测试owner
均低于800行（MCP router793、form root558、notes root592），超长历史tests只做机械消费者迁移。

fresh冻结产物：`/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage90-v2-frozen-mtV66I/binaries`，
stage90-validate-build-v2.log记录全套/Clippy/build；source user-input Gate exit0
（stage90-source-gate-b.log），Thread `01a12181-e91e-7b93-a1ff-1c4de34a56e4`、
Turn `turn_2ea94f54eb3a42d59a099d27a38ed2e3`，完整notes编码、raw Enter/Tab、atomic展开、
回访修订/未回答确认/一次response及真实stdio handoff、focus/resize/reconnect/terminal恢复通过。

同一latest冻结产物的最终串行Gate exit0（stage90-final-gate-b.log）：真实MCP stdio
Thread `01a12187-8f0d-74b0-9055-bba8ad796607`，真实MCP PTY Thread
`01a12187-96e5-7de3-b128-7c1fef3e2b31`；均完整响应一次、canonical turns=[]，PTY包含
raw atomic/逐字段rich draft和cursor/alternate screen/终端恢复。随后经实际npm根launcher
与sibling App Server完成CLI及固定complete,user-input矩阵；npm入口实际固定这两个TUI
场景，本轮不宣称MCP安装态验收。首轮stage90-npm-gate-b.log已通过；为补足独立notes
identity，Gate只新增在完整答案与一次response断言通过后打印TUI_NOTES_RESPONSE_OK，
最终npm notes Thread `01a12188-dbc1-7380-aa22-e85b4cbbf651`、
Turn `turn_3a839e27c84f4b81aa1f84cbfc056aaf`，user_note编码与exact响应通过；complete
Thread `01a12188-7d9c-7b80-810d-289d28f1e134`另列，不能混充notes身份。
CLI human TTY颜色未执行（outer stdin非TTY），其它安装态fixture按实际marker记录。

分类：共享ChatComposer/ComposerDraft/PasteBurst、thread-owned McpCallScope/router与
统一notes response为current；旧MCP TextArea/String/insert/render旁路、旧request/
request_with_provenance、freeform裸值分支与混合Other文案为dead/deleted，不新增compat/
deprecated。SRP拆input/render/tests，DRY共用composer与scope，KISS/YAGNI删除重复路径，
不新建协议、配置、依赖或GUI/TUI第二backend。责任root确认架构图继续
Product Surface -> App Server -> shared runtime -> canonical Thread/Turn/Item，2026-10-10。
两专项既定退出条件已满足，各100%；总体仍partial，无可信总体百分比分母。Windows、
本轮Desktop Gate B/GUI、live Provider、MCP npm及完整verify:local未验，不能作为release evidence。
下一刀回到第88稳定性根因：负载下raw分段、editor返回首键与complete aggregate总超时；
需捕获事件/flush/绘制与reader恢复的关联证据，不增加sleep/扩大timeout/放宽atomic或cursor断言，
不以本轮安装态complete绿灯关闭前序失败，也不把文件同名率当产品完成度。

## 第九十一阶段：终端绘制调度与布局缓存（局部终端验收完成；稳定性仍 partial）

继续第88稳定性退出条件。先采集真实PTY的事件/flush/绘制/editor恢复关联时间，区分输入
owner与终端观察问题；只记录事件类别、计数、时间和cursor，不记录用户正文。临时诊断
插桩在归因后移除，不新增production日志配置或第二输入reader。对照Codex的Draw事件消费，
重点核对当前每轮事件都draw是否绕过FrameRequester并放大8ms粘贴识别间隔。
窄写集runtime的既有draw接线、tui/event_stream、共享paste owner、PTY观察/对应测试与
本计划；具体修复按证据收缩，不碰CLI/review/release、GUI或共享业务协议。不得增加sleep、
扩大timeout、放宽atomic/cursor/canonical断言；失败日志原位保留。root，2026-10-10。

已确认两项Codex差异：runtime每轮事件直接draw绕过FrameRequester；workspace关闭Ratatui
default features却未启用Codex已有的layout-cache。直接移除前者，常规draw只消费调度的Draw
事件；键盘、resume/load、server notification和reconnect结果只请求帧。断线关闭旧session前
的显式绘制仍由同一Tui owner负责。workspace只追加layout-cache，不升级版本；锁文件仅在
ratatui-core依赖表增加已有critical-section。GUI/protocol/schema/config及业务owner不变。

诊断单次同场景数据：before完整PTY1463帧、绘制累计11538ms、绘制p95=11443us、全场景
18688ms；仅收敛调度890帧/7015ms/10812us/14708ms；再启用布局缓存901帧/5045ms/
8675us/13805ms。这是插桩诊断样本，不是统计基准或任意负载性能保证。before原始trace
`/tmp/lime-stage91-before-45018.log`，after `/tmp/lime-stage91-after-64298.log`，
cache `/tmp/lime-stage91-cache-80402.log`；
相应完整Gate日志stage91-diagnostic-gate/diagnostic-after/diagnostic-cache均exit0。
额外并行complete与user-input的before诊断也通过，记录stage91-load-before-complete/notes；
本轮未复现前序首Left丢失或raw分段，不把重复通过当作三项历史失败的充分根因。
editor pause/returned/resumed与首Left事件关联记录已获得；reader未改、不升级crossterm。

临时trace owner、所有事件/flush/draw插桩及wait日志已删除。新增回流守卫进入独立
scripts/app-server/tui-render-scheduling.test.mjs，不继续扩充超长composer guard。
runtime root只做draw接线、不扩展业务逻辑；其超长退出条件仍为按host/session/history/
clipboard/terminal职责迁出既有runtime模块。architecture/commands/scripts README同步。
责任root确认架构图仍为Product Surface -> App Server -> shared runtime -> canonical
Thread/Turn/Item；本刀只涉及terminal presentation与同版本依赖特性，2026-10-10。

初次临时诊断编译因误用test-only/private快照被编译器拒绝，已删除该临时调用；
stage91-diagnostic-build.log保留失败及修正后成功记录，不计作最终生产验证。
当前最终生产源码：TUI1692 lib+23 integration+1 dependency guard=1716、CLI8 lib+106 main+
2 integration=116，合计1832项通过，ansi-escape编译通过（0测试）。最终119项相关守卫、ESLint/
Prettier、contracts、legacy、app-version通过；inventory1530文件刷新。最终strict all-targets
Clippy与--locked build/freeze均exit0（stage91-final-validate-build.log）；无插桩默认PTY/npm
Gate结果见下方最终验收。冻结目录tui-stage91-final-CSWesg/binaries使用latest CLI，App Server及其
业务实现沿用第90同一已验收产物，不宣称本轮重新编译了backend。第88稳定性保持partial，总体无可信
百分比分母，不宣称全Codex对齐或release readiness。

最终无插桩默认矩阵v1在portable resize/reflow退出清稿阶段2/4失败，日志
stage91-final-gate-b.log保留；complete、raw notes与其它此前步骤已通过，后续MCP/npm未执行。
核对PtyLime::resize发现它先用旧几何解析resize首批repaint，再设置parser size；这会让VT100
clamp光标/折行并保留错误行。扩展原本干净的tests/suite/focus_palette.rs与resize_reflow.rs
窄写集：parser先采用新尺寸再请求PTY resize；退出在同一screen等待placeholder存在且完整
DRAFT/TAIL均消失，仍5s，不使用固定sleep。既有超长tui-gate-b guard只机械迁移旧split等待
断言到combined predicate，新几何顺序守卫进入独立小文件。该test-only修复不改生产binary。
同一冻结产物定向4/4真实resize通过（stage91-resize-repair.log），随后combined predicate
再次进入默认矩阵v2；fixture fmt/strict Clippy与119守卫最终通过。119首轮有一项旧source
guard仍要求已删除wait_for_screen_without，已同步到更严格DRAFT/TAIL断言，失败日志保留。
这解释本轮resize验收缺陷，不证明第88三项历史稳定性根因全部消除。

fixture最终fmt/scoped strict Clippy通过（stage91-fixture-checks.log），119项守卫v3通过。
完整矩阵v2的后续60s场景被本进程并行Clippy占用Cargo artifact lock阻塞，日志明确仅有
Blocking waiting for file lock，未进入对应PTY测试；stage91-final-gate-b-v2.log保留。
修正验证编排为等待全部Cargo检查退出后串行Gate，不扩大timeout，不将该环境/编排失败
作为产品通过或产品根因。v3使用既有MCP helper直接跑stdio+PTY，避免把两项MCP标签组合
误当作默认矩阵入口；没有修改tui-gate或cli-npm helper生产合同。

最终串行v3整套exit0，日志`/tmp/lime-tui-stage91-final-gate-b-v3.log`：

- source默认11场景通过；complete Thread `01a121ad-2e2d-7ce1-a263-3f59844de902`、
  Turn `turn_6b770fb5b9114dc5ac95f2670d61bc5d`。typed stdio、queue edit、Agent overview、
  images/skills、canonical status/footer、focus/resize/reconnect及terminal=restored均ok。
  独立notes Thread `01a121ad-f470-7d12-b7b6-18a743bb116f`、
  Turn `turn_e77e66d63f2d40ee9184f08869b85fa4`，完整user_note编码答案、raw burst、
  Enter/Tab、Unicode、双题修订/未回答确认与exactly-once response均通过。
- MCP helper的真实stdio与PTY通过，Thread分别为
  `01a121af-2561-7d92-b52d-8d23c8e75e72`、`01a121af-302b-7063-8f67-7dfca218576b`；
  raw=atomic、drafts=restored、response=complete、exactly-once=true、turns=none，
  PTY terminal=restored。不把无Turn的MCP表单请求虚构成Agent回合。
- npm根launcher解析实际macOS arm64平台包及sibling App Server通过。
  CLI Thread `01a121af-58ab-72b2-951b-fd3a07a9178b`、
  Turn `turn_eafdd297ce8647aab8bfff53ea9e88e9`；安装态TUI complete Thread
  `01a121b1-87e8-7d22-98e4-673e473370ef`、Turn `turn_67dc728ecc2541968845ae86cf463783`；
  独立notes Thread `01a121b1-ede2-7301-b742-72b984508ce7`、
  Turn `turn_916f7de76d534abe97f9393fb08cd087`。CLI当前工作树exec/review/resume/fork/
  images/schema/stdin/output-file与TUI complete,user-input、stdio/resize/reconnect/终端恢复
  全部exit0；验证并行CLI行为不等于认领其改动。外层stdin非TTY，CLI human TTY颜色专项
  明确NOT_RUN；TUI本身经过真实PTY。MCP npm未运行。

最终fixture fmt/scoped strict Clippy、119守卫、ESLint/Prettier、contracts、legacy（零候选/
漂移/违规）、scripts、app-version、docs boundary及diff check均通过，日志保留于
`/tmp/lime-tui-stage91-{fixture-checks,guards-v3,contracts,legacy,scripts,app-version,docs}.log`。
本轮既定三组终端验收3/3（100%，仅该切片）。第88三项历史失败本轮未稳定复现，仍partial；
诊断样本表明绘制开销下降，但不证明它们的根因全部消除，不将v1/v2真实失败覆盖为通过。

分类：current为FrameRequester/Draw调度、Ratatui库内layout-cache与正确PTY几何观察；
dead/deleted为逐事件常规draw旁路、旧几何解析顺序和临时插桩，无新compat/deprecated。
KISS/DRY复用既有帧与库内缓存，SRP将新增守卫放独立小文件，YAGNI不新增reader、配置或
业务后端。生产写集仅runtime调度与workspace同版本依赖特性；fixture修复限focus_palette/
resize_reflow及对应守卫，CLI/review/release并行写集继续避让。责任root确认业务架构不变。
Windows、Desktop Gate B/GUI、live Provider、MCP npm、完整verify:local与CLI human TTY专项
未由本轮验收，不能标release readiness。下一刀继续第88负载raw分段/editor首键/aggregate
超时的可重复事件关联证据；不增加sleep、扩大timeout或放宽atomic/cursor/canonical断言。

## 第九十二阶段：Windows Terminal Shift+Enter 输入解码（实现及macOS回归完成；Windows验收待补）

继续核对terminal输入owner时发现独立且明确的Codex差异：Windows Terminal显式sendInput
映射`ESC[13;2u`经Win32 backend成为逐个Key事件，Lime直接转发，Esc会进入取消/导航逻辑且
余下字符污染正文；Codex在tui/windows_key_sequence.rs以单一有界状态机解码为Shift+Enter。
该缺口直接影响输入框换行，先补齐这项有确定语义的交互差异；第88三项历史稳定性保持open，
不将Windows解码变更归因到macOS外部editor或负载raw问题。

root窄写集：原本干净的tui.rs模块声明、tui/event_stream.rs平台事件源、同名独立
windows_key_sequence与tests、architecture/commands/本计划及生成inventory；CLI/review/
release、GUI、App Server/runtime/protocol/config和核心依赖只读。使用既有crossterm与Tokio，
不升级依赖、不新建reader、不改变非Windows生产输入，不新增业务后端或compat wrapper。
仅完整且无修饰的Press序列接受映射，成对Release合并；普通文字、Paste、原生按键与失败
前缀完整原序重放。50ms为Codex的单次候选解码deadline，非Gate超时或sleep；已经就绪的
后缀优先消费，固定deadline不因分片重置，pause/drop随事件源丢弃半个序列。

退出条件：

1. 确定时钟覆盖完整/分片/过期候选、release、错误/EOF、连续就绪流及原样重放。
2. 解码后经过BottomPane进入真实ChatComposer渲染与显式提交合同。
3. TUI crate、strict Clippy/fmt及结构inventory通过。
4. latest binary真实stdio/PTY host回归。
5. Windows/MSVC与Windows Terminal实际映射、取消、外部editor handoff和终端恢复。

macOS可以验证纯解码和共享composer，但不得冒充Windows Gate B，第91PTY也不能替代
latest host回归。
Windows Console强制input-record mode及原模式恢复尚未迁入；Codex windows_console的
VT input修复是另一个明确缺口，不把本刀的Shift+Enter decoder描述成完整Windows输入对齐。
责任root确认架构图仍为Product Surface -> App Server -> shared runtime -> canonical
Thread/Turn/Item，新增状态仅归terminal event source，不下沉业务状态，2026-10-10。

实现沿用Codex同名WindowsKeySequence/new/accept/flush/poll_next与同目录tests，按当前
Rust 2021语法展开let chains。生产模块153行，独立tests261行；没有在composer/textarea
新增Windows特判。CrosstermEventSource持有单一平台events字段，Windows包裹现有stream，
非Windows直接使用原stream；EventBroker仍唯一负责pause/resume与stdin交接。

新增10项确定性回归通过（其中35种修饰/非Press破坏候选在同一回归中比较完整事件数组）；
共享输入集成沿BottomPane真实timed入口与默认PasteBurst进入ChatComposer，不暴露private
editor、不新增test-only生产API。TestBackend证明两次映射产生空白行并保留字面`[13;2u`，
最终普通Enter才提交完整多行正文与空text_elements。完整TUI1702 lib+23 integration+
1 dependency guard=1726，新增10项已计入一次；strict all-targets no-deps Clippy、fmt与
--locked CLI build通过（`/tmp/lime-tui-stage92-validate.log`）。普通gated PTY early-return
不算真实交互。inventory刷新1532文件，119结构/fixture守卫通过（stage92-guards.log），
legacy零候选/漂移/违规，docs boundary通过；首次文档Prettier指出inline编号格式，已格式化。
latest无插桩CLI已冻结，App Server沿用第91/90已验收产物，source默认11场景最终exit0。

最终真实host验收日志`/tmp/lime-tui-stage92-source-gate-b.log`，CLI冻结于
`/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage92-final-8Mt7d0/binaries`；
complete Thread `01a121be-aeb1-7700-950f-336114eec034`、
Turn `turn_8cc0925dfe5b4f29aba387acf4e4d077`；独立notes Thread
`01a121bf-1325-75b2-b348-1fb713eade54`、Turn `turn_4fa4584ac66c4a6b9561ede0b2d36cbc`。
typed stdio、thread handoff、queue edit、images/skills、外部editor/Vim/history、raw notes、
canonical status/footer、focus/resize/reconnect及terminal=restored全部通过，完整答案仅一次
response。它证明latest macOS host回归，不证明Windows平台分支；解码本身及共享输入集成
由10项测试执行。当前机器仅安装aarch64-apple-darwin target，无Windows/MSVC实跑环境。
本刀没有升级核心依赖、安装target或调用远端CI来替代本地证据。

分类：current为Codex同名事件源解码与既有BottomPane/ChatComposer；旧Windows映射逐字符
透传分支被原位替换（dead/deleted），无新增compat/deprecated，普通事件仍由原stream处理。
SRP让解码状态只归事件源，DRY复用输入框换行/渲染/提交，KISS/YAGNI不在composer加平台
分支、不扩展协议/配置/依赖。architecture/commands与inventory同步，docs boundary、
Prettier及diff check通过；退出条件1-4完成，5待Windows实际验收，4/5（80%，仅本专项）。
总体partial/in-progress，无可信全局百分比分母。GUI/Desktop Gate B、live Provider、完整
verify:local及本刀npm/MCP未重跑；第91对应平台/受控backend证据只保留原范围。
下一刀继续Windows Console input-record mode/原模式恢复，以及第88三项失败的可重复根因
证据；不得用本次解码或macOS绿灯关闭它们，不放宽atomic/cursor/canonical或Gate timeout。

## 第九十三阶段：Windows Console 输入模式生命周期（代码与macOS验收完成；Windows未验）

主目标继续为Codex CLI/TUI全维度对齐，GUI/TUI共用业务后端。下一刀衔接第92事件源：
Codex在tui/windows_console.rs清除ENABLE_VIRTUAL_TERMINAL_INPUT，确保crossterm接收
Win32 input records，并按原VT位恢复；Lime尚无此owner，外部console client修改模式后
导航可能成为字面escape字符。新增同名模块及input_record_mode/restored_input_mode/
set_input_record_mode/ensure_input_record_mode/restore_input_mode，使用现有windows-sys
0.52 API，不升级依赖。第88三项稳定性独立保持open，不归因到Windows Console。

root窄写集：tui.rs的initial enter/set_modes与四类恢复路径、tui/event_stream.rs的Windows
poll前/Pending后模式重申、独立windows_console与tests、独立terminal-modes守卫、
architecture/commands/scripts README/本计划和生成inventory。第92同一进程的tui.rs/
event_stream改动直接续改；CLI/review/release、GUI、App Server/runtime/protocol/config/
provider与核心依赖只读，保留所有并行改动，不提交/推送/建分支。

终端模式唯一owner仍为Tui/windows_console：只保存原VT输入位，不缓存整份console mode
覆盖其它client的变更；只在SetConsoleMode成功后保存原位，恢复失败保留记录。没有console
的stdin为no-op。初始化、external editor keep-raw handoff、正常退出、panic和失败初始化
必须配对恢复，crossterm reader启动前与返回Pending后重申不新增snapshot。windows-sys
0.52 HANDLE是isize，沿既有平台API检查0/INVALID_HANDLE_VALUE，不照搬Codex较新版本
pointer方法。不引入第二reader、输入fallback或GUI/后端模式分支。

退出条件：1) 原位往返及外部client其它mode变化的portable回归；2) 四类host恢复与poll
前/Pending后配对守卫；3) TUI crate、strict Clippy/fmt、inventory和治理通过；4) latest
binary真实macOS stdio/PTY host回归；5) Windows/MSVC compile与Windows Terminal实际
导航/Shift+Enter/editor handoff/终端恢复。条件5需真实Windows环境，不把纯位运算或
source guard冒充Windows运行证据。root确认架构图继续Product Surface -> App Server ->
shared runtime -> canonical Thread/Turn/Item，变化只在terminal mode owner，2026-10-10。

实现：同名windows_console生产110行，独立portable tests46行。新增3项测试覆盖所有
16位console flags组合的清位/恢复/幂等，以及editor修改其它位和高位后的正确恢复；3项
计入完整TUI1705 lib+23 integration+1 dependency guard=1729，不重复累计。现有第92
Shift+Enter解码及共享BottomPane输入回归同时通过。runtime和composer没有新增平台特判。
初次进入若set API失败，在尚未持有snapshot时只撤raw mode；后续四条退出/交接路径恢复
已持有原位，poll重申不push记录。额外修复terminal构造后size错误直接`?`返回的清理缺口，
使该失败进入同一cleanup；其余初始化、标题、cursor/alternate screen owner不变。

最终crate、strict all-targets no-deps Clippy、fmt与--locked CLI build通过，日志
`/tmp/lime-tui-stage93-validate.log`。新增独立tui-terminal-modes guard4项与既有相关守卫
共6文件123项通过（stage93-guards.log）；inventory刷新1534源文件。ESLint/Prettier、
legacy（零候选/漂移/违规）、scripts governance、docs boundary和diff check通过。

为检查macOS通常不编译的WinAPI分支，额外在隔离临时crate中直接引用生产windows_console
文件，对现有windows-sys0.52/Windows API生成metadata并以-Dwarnings检查，通过。
该check仅在leaf crate启用Windows cfg，依赖仍按host构建，无Windows ABI链接或运行，
不能替代Windows/MSVC全crate检查。首轮--offline因registry archive缺失失败，改用已存在
的同版本registry源码path dependency后通过，失败与成功原位保留于
`/tmp/lime-tui-stage93-winapi-typecheck.log`；临时manifest/lock未写进仓库，不下载或升级依赖。
TUI/Cargo manifest、schema、配置和锁文件本刀没有变更。

latest CLI冻结于tui-stage93-final-sQ5mJM/binaries，App Server沿用第91/90已验收产物。
source默认11场景在user-input raw notes失败，exit1，日志
`/tmp/lime-tui-stage93-source-gate-b.log`。长Unicode原始输入显示为正文及
PTY_NOTES_BURST_TAIL，未形成断言要求的完整atomic placeholder；复现第88负载粘贴
分段缺口。Windows分支在macOS不启用，尚无证据将失败归因到本刀Windows模式改动。
首次验收时条件1-3已通过，条件4失败，条件5未验，当时专项3/5（60%）；本刀不标完成。
下一刀定位共享PasteBurst输入间隔、notes草稿保存和host循环开销，不放宽断言、
增加等待时间或把raw fixture改成bracketed paste。

## 第九十四阶段：ASCII/IME输入顺序与粘贴分段归因（输入专项验收完成；历史稳定性partial）

沿第88/93真实失败继续定位；共享PasteBurst与ChatComposer仍为唯一输入owner。
窄写集为runtime/paste_input的临时计时、根因对应输入owner及回归和本计划。只读Codex、
CLI/MCP/发布/GUI和共享业务后端；不覆盖工作树其它改动。临时探针只记录事件类别、
输入间隔、循环与handler耗时和flush长度，不记录输入正文，归因后全部移除。
Codex同样在字符处理前flush_if_due，不将这一相同调用误判为Lime独有根因；阈值不变。
初次独立user-input插桩样本exit0，包含raw atomic与canonical notes回答；
`/tmp/lime-tui-stage94-probe-gate.log`。后续gate内其它PTY子场景覆盖了固定名计时文件，
因此该计时不能代表最初notes处理；已改为进程隔离文件，再采集默认11场景。
一次通过不关闭历史分段/首键/aggregate失败，不用扩大timeout或降低atomic断言验收。

默认11场景计时样本exit0（stage94-probe2-gate.log），notes进程34155记录2189事件，
其中2004个Unicode事件，最大Unicode事件间隔1199us、循环前段1147us、handler525us；
两次完整flush分别1038/1045字符，未复现8ms超时分段。此为单次诊断样本，非性能基准，
也不能证明历史负载失败已修复。全部runtime/paste临时插桩原位移除，无新增配置/reader。

另发现可确定复现的Codex输入差异：held ASCII后立即收到IME字符，Lime先插入IME而
继续保留ASCII，造成顺序错误。新增定向回归在旧实现稳定失败：actual「界」、expected
「a界」，日志`/tmp/lime-tui-stage94-mixed-red.log`。修复使用Codex同名
try_append_char_if_active续写既有buffer；未成burst时先materialize held ASCII再立即插入
IME。续写时沿Lime已有计时语义刷新last_plain_char_time，避免连续Unicode只按首字符
超时；不扩大8ms/60ms阈值，不把独立输入顺序缺陷归因成历史负载分段根因。
主composer/notes共用同一修复，补owner顺序、持续Unicode idle及question handoff/canonical
回答回归，并在真实PTY新增ASCII+中文+emoji顺序检查。初版handoff测试错误假定末尾b
仍held，被实际即时插入行为拒绝，已删除该实现细节断言，保留完整draft/canonical断言。
本刀退出条件：1) 定向及完整TUI/strict Clippy/fmt；2) inventory、治理与docs；3) 无插桩latest binary默认11场景真实stdio/PTY。当前验证中，总体仍partial。

完整TUI1708 lib+23 integration+1 dependency guard=1732、strict Clippy/fmt、--locked CLI
build及123守卫通过。无插桩latest CLI冻结tui-stage94-final-rNnVtU/binaries，App Server
复用第91冻结产物，默认11场景exit0（stage94-source-gate-b.log）。MCP专用stdio与PTY
各自通过，但组合mcp-stdio,mcp-elicitation随后因普通ledger未创建而ENOENT/exit1；
不是MCP业务失败。该日志原位保留，root扩展窄写集到既有tui-gate-b与其守卫：专用
runner只消费selectedScenarios，普通fixture/ledger/assertions只消费regular scenarios，
无regular时在全部专用runner完成后返回，清除旧scenarios.length===1早退判断和重复过滤。
并把PTY新增IME顺序marker纳入必需证据，接着验证相同组合及专用+user-input混合选择。

最终mcp-stdio,mcp-elicitation组合与mcp-stdio,user-input混合选择均exit0，日志
`/tmp/lime-tui-stage94-combination-gate-b.log`。前者含真实MCP stdio/PTY、raw atomic、
rich draft、exactly-once与终端恢复；后者显式输出IME顺序marker、完整notes与canonical
答案关联及Exactly-once。默认11场景通过记录在stage94-source-gate-b.log的首段exit0；
同文件末尾保留修复前MCP聚合ENOENT/exit1，不能把整份文件写成全绿或覆盖失败。
本刀3项owner回归仅在全TUI1732中计入一次；123守卫通过，gate路由/marker变更后又定向
复验该文件31项，不叠加为154。ESLint/Prettier、inventory1534文件、scripts、legacy
（零候选/漂移/违规）、docs boundary与diff check通过，无production诊断探针残留。
分类：current为共享PasteBurst/ChatComposer与真实场景路由；旧错序交接及临时插桩已原位
替换/删除，未新增compat/deprecated、第二reader或业务后端。责任root确认架构仍为
Product Surface -> App Server -> shared runtime -> canonical Thread/Turn/Item，2026-10-10。
第94限定输入/门禁退出条件3/3（100%）；第93条件4在本轮latest macOS Gate补验通过，
连同条件1-3为4/5（80%），Windows/MSVC实机条件5仍未验。第88三项历史稳定性仍open，
本轮没有其可重复性能根因；下一刀继续raw分段/外部editor首键/aggregate预算的事件关联。
GUI、live Provider、完整verify:local、npm平台重新打包及真实Windows未在本刀执行；
不把TUI真实PTY或WinAPI metadata冒充这些证据，也不宣称总体完全对齐。

## 第九十五阶段：外部编辑器命令与输入接线（代码与macOS验收完成；Windows未验）

继续Codex全维度对齐，参考基线4aaee872e31abefe0d32e91faab23b09b6968824。
已核对新旧crossterm EventStream仍为异步Drop唤醒，没有证据支持升级依赖能修复首Left。
明确差异在external_editor：旧command_parts吞掉单引号内反斜杠和空quoted参数，
Windows路径也被同一Unix风格解析器破坏；命令解析发生在terminal handoff后，
空正文被当成失败而保留旧草稿，与Codex允许清空及trim_end语义不符。

窄写集：external_editor与同名独立tests、TUI Cargo manifest及锁中对应依赖、
app/input.rs与app.rs注册、runtime的editor调用点、locale/external_editor与注册、
独立editor回流守卫、architecture/commands/scripts README/本计划和生成inventory。
既有inventory守卫中editor seed/apply两处断言同步迁到app/input，不保留旧App委托入口。
app/input.rs当前是脱离构建的历史空文件，本刀直接替换为真实launch_external_editor
owner，不恢复旧input routing；既有input_flow继续负责按键路由。CLI/MCP/release、GUI、
App Server/runtime/protocol/provider只读，保留所有已有改动，不提交/推送/建分支。

唯一current链：ChatWidget editor state -> App::launch_external_editor ->
resolve_editor_command -> Tui::with_restored -> run_editor -> BottomPane external edit。
按Codex收敛EditorError、resolve_editor_command、resolve_windows_program、run_editor命名；
Unix复用现有shlex，Windows新增Codex同源winsplit，不升级核心依赖。先解析再终端交接，
成功编辑包括空文本，经trim_end后回写同一rich draft；失败五语言提示且不覆盖草稿。
测试通过注入环境值与真实子进程，不修改进程全局环境。

退出条件：1) 旧解析器红灯、Unix参数/错误/空正文回归与Windows平台测试落地；2) 生命周期与旧入口回流守卫；3) 全TUI、strict Clippy/fmt、locked CLI build、inventory/治理/docs；4) latest CLI真实
stdio/PTY complete场景含editor首Left/canonical提交/终端恢复；5) Windows/MSVC及Windows
editor/shim真实验收。本机无Windows环境，条件5不得以portable parser回归冒充完成。
Codex policy-aware editor_directory与KeepScreen上一帧恢复尚未对齐：前者需共享文件系统
policy事实源，后者需Ratatui terminal能力接线，本切片不在TUI另建权限策略或伪造同构。
第88raw notes分段、首Left与aggregate总超时仍open，单次通过不证明根因已修复。
责任root确认架构图继续Product Surface -> App Server -> shared runtime -> canonical
Thread/Turn/Item，本刀只改变terminal editor交互owner，2026-10-10。

实现与证据：旧parser在code --wait ''稳定失败，actual仅[code,--wait]，expected含末尾空
参数；`/tmp/lime-tui-stage95-editor-red.log`。新独立editor tests覆盖VISUAL优先级/空值拒绝、
反斜杠/空quoted参数/错误quote、真实shell进程精确argv与seed、完整正文/清空、失败/启动
错误/空命令的TempPath清理；全局环境零修改，Windows专用路径/空参数测试已落地但未执行。
App input回归覆盖trim_end保留前导空白、清空附件草稿、Requested/Active失败保留完整rich
draft并生成一条可见错误；五语言回归覆盖配置指引、typed解析错误及进程错误链。
定向12项通过（stage95-editor-related.log），均包含在全量1738中，不重复累计。

全TUI1714 lib+23 integration+1 dependency guard=1738，strict all-targets/no-deps Clippy
-Dwarnings、fmt及--locked CLI build全exit0；`/tmp/lime-tui-stage95-validate.log`。
依赖仅TUI新增thiserror.workspace与Windows winsplit0.1.0（与Codex锁checksum一致）；
锁中对应引用同步，保留前序ratatui critical-section改动，没有核心依赖升级。协议/schema/
配置未改变。独立editor guard4项+既有六文件共127项最终通过；首轮inventory两条断言仍
指向旧runtime seed/App委托，直接迁到app/input后通过，无恢复旧入口。初次失败与最终
通过同存`/tmp/lime-tui-stage95-guards.log`，不得称整份日志全绿。inventory1537源文件，
ESLint/Prettier、legacy零候选/漂移/违规、scripts governance、docs boundary/diff check通过。

latest CLI冻结于
`/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage95-final-yIMrek/binaries/lime`，
App Server复用第91冻结产物。真实complete stdio/PTY exit0，
`/tmp/lime-tui-stage95-source-gate-b.log`，fixture保留tui-gate-b-u8FSI6。
主Thread 01a123d2-1222-73d0-b689-5405233305a2，Turn turn_032872ae91d94eb4b39d421e42558c03；
真实编辑器前台TTY、返回首Left/Right、同一canonical提交、footer/status/title、focus/resize/
reconnect和终端恢复通过。该次绿灯是本切片macOS运行证据，不能关闭第88偶发首键缺口。

分类：current为App editor launch、平台标准parser、ChatWidget状态与BottomPane rich edit；
旧edit_draft/command_parts/resolve_editor_executable、空正文拒绝、App委托及历史空壳注释为
dead/deleted/forbidden-to-restore；无新增compat/deprecated。SRP将命令/进程与App交互分开，
DRY复用平台parser/既有输入owner，KISS/YAGNI不留双parser、fallback wrapper或第二后端。
条件1-4完成，条件5待Windows/MSVC及shim/editor实机，专项4/5（80%），总体仍partial。
GUI/Desktop Gate B、live Provider、完整verify:local、npm重新打包与真实Windows本刀未验。
下一刀继续Codex TerminalHandoff::KeepScreen可见帧恢复，以及共享policy-aware
editor_directory接线；第88raw分段/首键/aggregate仍open，保留原失败且不放宽断言或timeout。

## 第九十六阶段：外部编辑器KeepScreen终端交接（macOS已验收；Windows待验）

继续Codex全维度UI/UX与host设计对齐，参考基线仍4aaee872e31abefe0d32e91faab23b09b6968824。
明确差异：Lime with_restored始终离开alternate screen，独立窗口editor等待时用户只能看见
主屏幕；Codex TerminalHandoff::KeepScreen恢复两屏输入模式，再在alternate screen重绘
上一可见帧，交出输入，返回时强制回主屏幕并重新进入。原editor fixture立即退出，不能证明
编辑期间屏幕保留，本刀先加入阻塞editor/真实VT屏幕断言，并用第95冻结CLI获得红灯。

窄写集：tui.rs终端交接/帧捕获与同名tui/tests.rs、app/input.rs editor接线、runtime PTY
editor调用点及独立external_editor helper、tui-gate-b必需marker与相关三类守卫，
images PTY共用同一阻塞editor fixture，启动/可见性/释放接线随调用一起迁移，避免留下等待旧即时退出的旁路。
architecture/commands/scripts README/本计划及生成inventory。延续本人前序改动，保留CLI/
MCP/release/共享后端/GUI全部并行写集，不提交/推送/建分支，不修改核心依赖或协议/配置。

唯一owner仍为Tui：TerminalHandoff/with_restored按Codex命名，ChatWidget/App只请求editor。
Ratatui没有公开previous_buffer，采用draw_for_handoff经同一draw入口捕获一帧，存为仅该次
交接持有的visible_frame；普通帧零复制，不缓存第二份长期render/projection事实。用既有
crossterm synchronized update包裹leave/restore/enter/repaint/release，返回继续配对原Windows
Console VT位、清title/cursor并恢复终端。不创建custom_terminal包装层或第二renderer。

退出条件：1) 旧binary真实PTY红灯与阻塞期间alternate screen/composer可见性断言；2) 可见帧Unicode/style/缩小裁切/扩大留白定向回归与host生命周期守卫；3) 全TUI、strict
Clippy/fmt、locked CLI build、inventory/治理/docs；4) latest真实complete stdio/PTY，包括
editor主动离开alternate screen后首Left/canonical提交/终端恢复；5) Windows/MSVC及真实
Windows editor/模式交接。条件5仍需Windows实机，macOS证据不能替代。policy-aware
editor_directory独立defer，待共享文件系统policy owner接线；第88三项历史缺口仍open。
责任root确认架构图为ChatWidget/App -> Tui handoff -> external editor -> BottomPane；
业务图仍Product Surface -> App Server -> shared runtime -> canonical Thread/Turn/Item，2026-10-10。

红灯证据：stage96-keep-screen-red.log保留第95冻结CLI失败。首轮不可见OSC被通用visible
marker等待剥除，是fixture等待错误；已改用本地原始OSC握手。第二轮实际产品红灯为editor
等待期间主屏空白、alternate=false，不把首轮fixture失败当产品根因。
实现已落地：TerminalHandoff::KeepScreen按上述两屏顺序交接，仅App editor启动时经
draw_for_handoff捕获一帧并take；三项TestBackend定向回归通过（stage96-related.log），
保持Unicode/style/atomic标签、缩小原坐标裁切与扩大留白。旧root内editor配置直接迁入
runtime_pty_tests/external_editor，complete/images共用同一阻塞fixture与VT观察，editor
主动离开alternate screen后检查重新进入。KeepScreen marker已纳入两场景必需evidence，
输入首Left/Right、canonical与恢复断言原样保留。全量/Clippy/build和fresh Gate验证中。

最终验收：全TUI1717 lib+23 integration+1 dependency guard（唯一1741项）通过，三项定向
已包含其中，不重复累计；strict all-target Clippy --no-deps -D warnings、fmt与locked CLI
build通过，日志/tmp/lime-tui-stage96-rust-validation.log。inventory生成器实际1539文件；
七文件守卫唯一131项通过（首轮130通过，editor守卫误要求images helper内重复配置；配置
真实统一在root按scenario注入，修正断言后editor7项通过，不修改产品或放宽VT断言）。
ESLint/Prettier、legacy/scripts/docs与git diff --check通过。

新CLI冻结于/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage96-final-H0VhlC/binaries，
App Server复用第91既有验收产物及完整包上下文。全部Cargo检查结束后串行运行complete/images，
stage96-final-gate-b.log exit0，两次消费TUI_EDITOR_KEEP_SCREEN_OK；真实阻塞期间alternate
screen和composer可见，stdin继承前台PTY，editor主动退出主屏后TUI重新进入。原首Left/Right
cursor、同一canonical用户输入/图片、Thread/Turn/Item与终端恢复断言均通过；reasoning
notification/cold read/resume、typed backtrack及既有complete附带focus/resize/reconnect通过。
该Gate使用受控external backend，无live Provider，不宣称默认11场景或Desktop GUI本轮验收。
保留fixture目录/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-gate-b-gjuSwv。

分类：current为App捕获接线、Tui同名handoff与一次帧所有权、既有Ratatui renderer；旧始终
Restore的editor调用与root重复editor配置为dead/deleted/guard-only，无compat/deprecated。
KISS不自建custom_terminal，DRY共用draw/view及complete/images editor fixture，SRP将
终端交接留在Tui、业务状态继续共享App Server。条件1-4完成，条件5真实Windows未验，
专项4/5（80%）；总体partial，没有可信总体百分比分母。下一刀为共享policy-aware
editor_directory接线；需先取得真实filesystem policy，不能仅按TUI权限名称猜测或在
TUI私有实现权限。第88raw分段/首键/aggregate三项仍open，不以本轮绿灯关闭。

## 第九十七阶段：外部编辑器canonical cwd收敛（macOS切片已验收；完整目录保护defer）

主目标仍是GUI/TUI共享底层的Codex全维度对齐。policy-aware editor_directory盘点确认
共享前置缺口：App Server permission_profile解析named filesystem/grantedPermissions并
落入thread metadata，公开start/resume/settings仅返回active profile id与sandbox标签，
没有Codex FileSystemSandboxPolicy与path/write-root判断合同。不能在TUI读取本地YAML、
按profile名称推断或重建权限表。完整目录保护继续defer，退出须共享tool-runtime权限
lowering及App Server有效策略投影、schema/client/GUI同步与真实跨端验收，不新开TUI后端。

本轮发现独立且确定的入口错位：startup/resume_target_session/reconnect已消费服务端cwd
写入App.cwd，但runtime启动editor仍把options.cwd传给App，线程跨目录恢复后临时正文
继续落在旧启动目录。Codex App输入入口读取当前config.cwd，不由runtime另传快照。
本刀删除外部cwd参数，launch_external_editor直接消费App.cwd；不新增wrapper/compat。

窄写集：app/input.rs、runtime.rs唯一editor调用、runtime_pty_tests/external_editor独立
真实跨目录resume验收及fixture探针、tui-external-editor/tui-gate-b守卫和门禁、
architecture/commands/scripts README/本计划及生成inventory。既有CLI/MCP/release/GUI/
shared runtime只读，保留未知改动。不新增协议/配置/依赖，不提交/推送/建分支。
退出条件：1) 第96冻结CLI跨目录resume真实PTY红灯；2) current editor入口无外部cwd
参数；3) 全TUI/strict Clippy/fmt/locked build/结构守卫/inventory/治理；4) latest真实
跨目录resume/editor/stdin/草稿/首Left-Right/canonical冷读/终端恢复，及complete/images。
Windows实机独立待验，workspace/system temp位置的权限保护不由cwd修复冒充完成。
责任root确认架构图App Server canonical cwd -> App.cwd -> App editor launch -> Tui handoff
-> external editor -> BottomPane；业务图保持shared Thread/Turn/Item，2026-10-10。

实现：App输入入口删除外部cwd参数，run_editor仅消费self.cwd，runtime仅保留启动时
初始化options.cwd。独立PTY回归在隔离storage用真实App Server thread/start创建含空格/
Unicode目录的线程，从不同--cd执行lime resume；阻塞editor探针记录实际buffer路径，
返回后检查首Left/Right、exactly-one canonical Turn、冷读正文/cwd和终端恢复。该回归
进入既有complete Gate并强制消费TUI_EDITOR_CWD_OK，不新增平行脚本或mock。132项
守卫、ESLint/Prettier、legacy/scripts/docs及diff check已通过，inventory仍1539文件。

环境记录：首轮Cargo锁等待后遇ENOSPC，写补丁也失败；检查源码完整且尚未应用该补丁，
未把环境失败当产品红灯。另一进程随后清除共享lime-rs/target并释放空间；本轮没有删除
文件或冻结产物。改用.lime/target/tui-stage97独立构建，dev/test debug=0、incremental=0、
jobs=4；仅本次进程环境，未修改workspace profile、用户环境或系统设置。仓库并行版本
变更保留不触碰。第96冻结CLI红灯回归重新冷编译中，全量及新binary验收仍待结果。

红灯闭环：新target首次连接第91冻结App Server时缺少@rpath voice动态库，是测试
loader环境失败；其完整包中动态库仍存在。显式把该包目录加入本次子进程DYLD_LIBRARY_PATH
后，第96冻结CLI真实resume/editor回归在路径断言失败：actual为launch，expected为
resumed thread 界（stage97-editor-cwd-red.log）。KeepScreen检查已通过，不把前两次环境
失败当cwd产品根因。没有改冻结二进制或本机loader/system配置。全TUI1718 lib+23
integration+1 dependency guard（唯一1742项）通过；定向真实回归必须继续在新binary实跑，
不将普通全量中的gated early return当跨层证据。strict Clippy和CLI build进行中。

Windows fixture同步考虑Unicode目录/正文：仅隔离PTY内临时切UTF-8 code page，写probe与
replacement后恢复原code page，避免cmd按OEM编码生成不可读UTF-8文件。此平台分支仍待
Windows/MSVC/Terminal实机验证；不能用macOS或source guard宣称通过。

最终验收：fixture最后的Unix quoting修复后，全TUI再次通过1718 lib+23 integration+
1 dependency guard（唯一1742项）；普通gated early return仍不算真实PTY。strict all-target
Clippy --no-deps -D warnings与fmt通过，stage97-final-rust-checks.log末尾
STAGE97_FINAL_RUST_OK；locked CLI build通过，stage97-rust-validation.log末尾
STAGE97_RUST_OK。首轮fixture将Cow<str>直接传env导致E0277，已用into_owned修复；
保留失败日志，不用此前结果冒充最终fixture版本。七文件守卫132唯一项通过，最后editor/
inventory子集33项再次通过但不重复累计；ESLint/Prettier、legacy/scripts/docs与diff检查通过。
architecture-confirmation脚本没有PR event/body-file，未执行责任确认检查，不记为通过；
本计划与architecture.md已由root记录本轮架构图及共享业务主链确认。

新CLI冻结于/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-stage97-final-mSxbkL/binaries，
App Server沿用第91完整冻结包及动态库。全部Cargo检查结束后，complete/images串行门禁
stage97-final-gate-b.log exit0。独立跨目录回归消费TUI_EDITOR_CWD_OK，thread
01a12537-bdb6-7292-bed1-e4f9f6ba1463；buffer parent等于服务端canonical cwd，返回后
临时文件删除，首次Left/Right保留Unicode宽度，exactly-one Completed Turn与完整
UserMessage冷读通过。该修复只对齐正文文件位置，不改变editor进程PWD，也不宣称实现
policy-aware目录保护。两场景各消费KeepScreen marker，草稿/图片可见、继承前台stdin、
editor主动离开alternate screen与TUI重入保持原断言；reasoning notification/cold read/
resume、typed backtrack与既有focus/resize/reconnect均通过。complete原180000ms与独立
cwd回归60000ms预算未放宽。受控external backend，无live Provider，不冒充默认11场景。
保留fixture目录/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-gate-b-gUkxYB。

分类：App.cwd及App::launch_external_editor为current；旧options.cwd参数注入为dead/
deleted/guard-only，未删除文件、无新增compat/deprecated。跨目录PTY/probe为test-only。
KISS删除重复参数，DRY复用server cwd与既有KeepScreen fixture，SRP维持App接线、Tui交接、
App Server共享Thread/Turn/Item边界。条件1-4全部完成，本轮macOS切片4/4（100%），总体
仍partial/in-progress且无可信对齐率分母。Windows实机、Desktop GUI、live Provider与
完整verify:local未验。下一刀仍需共享有效filesystem policy合同及GUI消费者同步后才能
对齐editor_directory；CLI/MCP/release/共享后端的并行写集保留。第88raw粘贴分段、editor
首Left偶发和complete aggregate总超时仍open，本轮单次绿灯不能替代稳定性根因闭环。

### 第97验收后续：第88输入稳定性定向复核

继续沿既有输入主链核对，不将目录权限前置缺口改成TUI私有策略。只读对照同一Codex
基线与current PasteBurst/notes state/event broker/runtime：平台8ms/60ms idle、8ms字符
间隔与轮询fairness均保持既有规则；notes每事件的ComposerDraft快照不包含待flush的
PasteBurst buffer，不能仅凭snapshot调用推断整个长burst逐字符复制。当前没有新的
可重复性能根因，不调整timeout/检测阈值、不更换raw为bracketed输入，不凭猜测重写reader。
生产写集不扩展；仅使用第97冻结CLI与第91冻结App Server串行跑现有user-input门禁，
补核raw Enter/Tab/Unicode、atomic label、双题修订/未回答确认、canonical完整答案、
exactly-once与终端恢复。通过也只能补定向证据，不能关闭第88三项历史失败。root，2026-10-10。

后续定向user-input实际exit1（stage97-notes-gate-b.log），在原raw atomic断言失败：长Unicode
正文及PTY_NOTES_BURST_TAIL直接显示，没有完整atomic label。复现第88历史缺口，第97
complete/images及canonical cwd验收仍保留各自范围，不能据此宣称问答全绿。隔离fixture
保留于/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/tui-gate-b-DZ3Fam。

## 第九十八阶段：终端geometry查询收回绘制owner（实施中）

沿同一输入主链只读对照Codex tui/screen_size.rs及app::handle_tui_event：普通Key/Mouse/
Paste/FocusLost消费last-known尺寸，几何策略归Tui。Lime runtime则每次loop都同步查询
backend尺寸，包括每个raw粘贴字符；这不是共享业务需要，也不应由runtime重复管理。
本刀原位移除loop中的sync_viewport，放进既有Tui::draw，在实际绘制前同步；Resize仍
立即使用事件尺寸更新viewport，draw_for_handoff复用同一draw，editor进入/返回既有
alternate-screen尺寸刷新保持。不加空ScreenSizePolicy包装、自定义renderer或新缓存。
本刀明确只收敛geometry owner/减少逐输入事件同步IO，不声称找到第88分段的唯一根因。

窄写集：runtime.rs移除三行调用、tui.rs在draw新增一行、既有render scheduling守卫、
architecture/commands/本计划及生成inventory；CLI/MCP/release/GUI/共享业务后端继续避让。
不新增方法/协议/配置/依赖/文案，不提交/推送/建分支。退出条件：1) 旧逐事件调用防回流
守卫与Resize/handoff接线保持；2) 全TUI/strict Clippy/fmt/locked CLI build、结构守卫/
inventory/治理；3) latest真实complete/images/cwd/首键/终端恢复；4) latest现有raw
user-input/canonical完整答案/once/终端恢复。历史失败只按可重复根因证据闭环，不能因一次
通过关闭。Windows/Desktop/live Provider独立未验。root确认架构图为TuiEvent::Resize ->
ViewportState、scheduled draw -> Tui::draw -> viewport sync -> Ratatui，业务图仍shared
App Server -> RuntimeCore -> Thread/Turn/Item，2026-10-10。
