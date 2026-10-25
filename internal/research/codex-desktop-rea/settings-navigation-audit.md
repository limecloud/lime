# Codex Desktop 设置导航对齐审计

> 2026-10-25 更新：用户已取消 Lime 主题/皮肤保留例外，旧皮肤及首页装饰段落仅为历史证据，现役实现与验收见 `internal/exec-plans/appearance-home-alignment-20261025.md`。

2026-10-25 current 纠正：下文本地 Profile/Soul 实施为历史证据，已退役。Codex 公共 Profile 为账号服务能力，本地 nickname/bio 表单不能替代；已删除表单、配置、搜索目标和专用 fixture，保留真实 Lime Account Center。个性化仅保留 Memory、AGENTS 与原版指令语义。旧公开 Profile 后续动作不再作为 Lime 当前产品待办。详见 [当前执行计划](../../exec-plans/browser-runtime-right-surface-plan.md)。


2026-10-18 布局纠正：本版legacy设置共用340px偏好侧栏，无全局rail及独立Settings标题；实际Back→search→groups，内容居中48rem/20px scroll padding/46px toolbar。旧railHome验收仅为历史，该用户路径已迁为Back回来源后Home。当前合同及待验状态见[窗口排版报告](../../exec-plans/artifacts/codex-shell-layout-rea-20261018/report.md)。下文旧布局对比均为实施前快照。

七 member 静态审计及后续切片的采用记录；章节 owner、公开 SettingsPage、canonical 路由与返回已交付。Memory配置/SOUL、独立笔记、Web Search、Environment、Execution Policy与Profile未保存导航保护已分别完成验收；公共Profile身份/可见性、内容搜索、其他表单与完整外部 dirty authority 仍待交付。下文保留各阶段历史事实，不以首屏读取证明写入或丢稿保护。

## 证据范围

目标实际位于 `/Applications/ChatGPT.app`，displayName 为 ChatGPT，但 bundleId 是 `com.openai.codex`，version `26.1007.30912`、build `20156`。此证据归 Codex Desktop，不归消费者 ChatGPT Desktop。ASAR SHA `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`，bytes `567757587`。下文 `evidence/` 路径相对恢复目录 `/var/folders/87/s6cpr7hd1_v43cs833x4s_900000gn/T/lime-code-nodeview-recovery-oulq764w/settings-navigation-audit-candidate/`；七 member 的原字节、hash、ASAR offset 见其中 `evidence/member-manifest.json`；格式化副本仅供阅读，定位以原压缩 JS byte offsets 为准。

REA full Evidence `ev_4bf8bfc7ccb14fb058096dd32864ae7f9ab83a8f0ad9acb46cfd79b5379ab36c`；summary Evidence `ev_6d2230454a838f113f4e61d100fb41d47ea6b241100765d84eb35674dcd71478`；输入 corpus SHA `2c618ae2c6acb241a854e3f71191626c857485ed664d43dc91a887d7f1730c35`。七 JS 全部解析，101646 bytes、25710 AST nodes、670 findings、0 parse failures。application complete 仅对这七个输入成立；semantic unknown，5265 unknowns，未执行 bootstrap 或包内代码。

仅确认公开导出原名 `SettingsPage`、`VisibleSettingsCommandMenuSectionItems`、`SettingsExternalSection`。`use-visible-settings-sections` 的导出只有压缩 alias `a/i/n/o/r/s/t`，不得声称已恢复内部 hook 或 sidebar 的原源码名。registry 来源是 app-initial，未提取完整 registry；不得使用 app-shared icon alias 做命名映射。

可下结论的范围：page shell、可见性/navigation 投影、section route/state、命令菜单共享消费、host filter、搜索入口/结果模型与未保存变更对话框。search-documents 内容 chunk、完整 registry/default page、外部 dirty authority、所有 mode/auth/host 的实际运行可见性仍 unknown。包内字符串不能当作当前帐号已启用功能，也不能据七 member 宣称整个设置应用或全量 dirty enforcement 完整。

以下映射和下一切片由 root 正式采用；全部15个 current 依赖、冻结摘要和 byte anchors 已核。source-only 审计完成度 100%；第一切片首屏读取已有真实 Electron 证据，设置完整交互完成度不量化。

## Profile 内容与入口补证（2026-10-16）

当前草稿安全切片与内容复刻分开验收。ASAR仍为本页基线摘要；7个Profile相关原成员已选择性读取并验证包内integrity，原字节/摘要/offset保存于`.lime/qc/settings-profile/validation-20261016/reference-profile*-members.json`。入口四member的REA parent为`ev_8a9fee92c25f04892deb551fb8c4511164400434dc7c9835f02b20b43d6b882b`；core/eligibility/use-visible三member的parent为`ev_2b4e6d08d1d979e0dcd2e6defa733fa149bd45f5b4d48b4ba05fb4f7938526fa`。两组均无parse failure，前者1356 semantic unknowns，后者触发100000节点上限、semantic partial/truncated且15294 unknowns。完整bundle已保存，静态解析不证明目标当前帐号的功能启用或运行。

| 可确认参考事实                                                                                                                                | Lime current owner与差距                                                                                               | 后续动作                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `profile-settings-6d54d51340da.js`公开导出`ProfileSettings`，props包含today，feature flag/loading决定是否渲染；委托共享Profile模块            | `account/profile/index.tsx`已同名，但实现是本地配置行内编辑；同名不能证明同义                                          | 保留确认的公开名称，继续恢复共享内容/可见性owner；内部压缩名和core alias不命名成原源码函数 |
| `use-visible-settings-sections`的profile为codex capability，visible还消费isProfileVisible、eligibility loading；appRoute可受eligibility移除   | current sections仅按OEM runtime决定本地资料表单；尚无等价Profile readiness投影                                         | 从已有真实能力/认证owner派生可见性，不能用flag字符串伪造可用，也不能复制账号后端           |
| wrapper消费header/children/isEditPaneOpen/isProfileV2Enabled/isError/ref/scrollRef，单一`data-profile-scroll`滚动区，宽度分支max-w-3xl或732px | 已迁移薄 wrapper/共享内容/字段编辑；732px，复用设置壳唯一滚动owner                                                     | 本地字段布局合同已验收；完整编辑pane/公共身份仍gap                                         |
| core可见displayName/bio表单、display_name/username资料投影、is_self、workspace_id、pins.items与编辑pane                                       | current displayName/bio显式映射本地nickname/bio；无消费者的avatar_url/email/tags已删；公共identity/pins/readiness仍gap | TS/Rust/consumer/fixture同步收缩；独立验证本地字段，不冒充公共身份                         |
| `ProfilePage`公开导出，处理`/profile`、`/u/:username`、preview与visit identity；CME有独立公开导出                                             | Lime没有相应公开ProfilePage/CME事实源                                                                                  | 登记gap；不能因包内存在就默认向所有用户显示或伪造远端数据                                  |

有界全文marker扫描仅针对260780-byte core：`tags`与`avatar_url`字面量出现0次，displayName/bio编辑有明确语法上下文。这不证明动态导入或整个安装包不存在其他资料字段；本地Tag/完成度/只读email的保留依据仍未建立，不增列为三项之外的特色。本轮删除了明确未实现的头像上传按钮及其8个专用文案/过期正向测试；其余内容差距继续由下一切片处理。现有草稿测试是安全合同证据，不是Profile功能/视觉等价证据。

Profile草稿安全合同已验收：页面892→381行，useProfileDraft拥有revision/锁/迟到保护，profileConfig仅合并latest提交字段和Tag增删；复用既有updateConfig与导航authority。实际DOM有效红例5失败/1通过；最终定向4suite56/56、翻译回归2suite11/11，默认verify:local整轮exit0、131/131批（1770文件）、contracts与标准GUI24/24通过。原生`settings-profile-native-20261016-1`整轮exit0，行内/Tag×四路导航加保存/读回/重开/完整配置保持与恢复9/9，1635 IPC、错误/mock0，同一Thread/Turn/Item且turnStart始终1，Main62813正常退出；83源码/3883目录产物/sidecar零漂移。四主题4/4另列，当前皮肤1440×1000截图已人工复核，system仅媒体模拟。

冷启动`settings-profile-cold-20261016-2`整轮exit0、32/32，171 IPC、错误/mock0；三次Main76338/76666/77107正常退出，teardown阶段耗时720/224/338ms，强制回收0。独立同边界RPC probe核验IO原因，GUI安全错误、行内/Tag保稿与重试、两次冷重启读回分别通过。首轮因缺失forcedCleanup证据字段exit1原件保留；最终字段由真实teardown派生，未修改15秒期限或放松护栏。两个fixture都先经公开配置RPC建立隔离非null基线，完整配置比较不把null与空值混同。导航external backend、冷启动unavailable backend，均不证明live/provider执行；New仅组件证据。冻结收据`.lime/qc/settings-profile/final-20261016-1/receipt.json`只关闭草稿/持久化安全合同，Profile内容、参考实时、Windows/安装包与全GUI仍partial。

### Profile 写入与查询身份（静态补证）

沿core已校验import/export追到11MB `app-initial-6350d04672d0.js`，包内integrity SHA `604b5d2de4fbb41f3d0dc5b3662129c558e1c7b8aac8cc87225286f58dcfaf8f`。5个精确顶层定义的原字节、byte/UTF16范围与完整member保存在`.lime/qc/settings-profile/content-trace-20261016/`；子集2340 bytes的REA parent `ev_87b1f8de96c9b10e16b7303b0c59c6cac67506416c13e29c22a9dde803e5bbef`，756 AST、0 parse failure、141 semantic unknowns。未包含共享HTTP/上传依赖，也未执行任何参考代码或请求。core source-module view为`ev_e0a17e7831cc4351f87bf767347b9893a83db7de0859017b3f6dca92c54731fb`；压缩导出Fyt/xyt及其local alias只用于本版本追踪，不作为Lime新命名。

| 静态观察                                                                                                                                               | Lime含义与待办                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| query identity包含user/account及可选username/personal；GET `/profiles/me/page`或`/profiles/{username}/page`，传账号header/AbortSignal，后者预期403/404 | 当前user_profile配置对象缺少公共身份/readiness，不能把config/read结果冒充profile page               |
| V2 PATCH `/profiles/me`映射displayName→display_name、bio→description、photo→asset pointer；旧feature分支PATCH `/wham/profiles/me`                      | 接真实资料owner才可启用编辑；Lime typed OEM gateway当前没有这些同义方法，不能复制参考服务地址或凭证 |
| 成功只更新is_self的profile_details，取消相关page query并失效identity；core编辑门控is_self/can_edit/preview                                             | 单一认证/能力投影控制可见性与编辑；不增加第二配置或runtime事实源                                    |
| core名称最大64、bio最大140，bio换行归一化；共享Layout与编辑pane按可见模式分工                                                                          | 下一刀字段/布局迁移须同步行为测试，不能只换标题与class                                              |

Lime本地user_profile在src/lime-rs/packages非生成源码的有界查询中只有配置/页面消费者，没有发现prompt/runtime业务消费者。OEM session含真实displayName/username/avatarUrl，bootstrap.profileEditable仅影响打开User Center，当前gateway无bio/pins/page读写合同。只读结论不证明仓库外服务不存在实现；实际协议、资产上传、完整username流程和运行效果仍unknown。内容实现尚未迁移，Tag/完成度/email保持待删除候选，不增加保留差异。

## 迁移前映射（原始事实）

Lime 已有唯一 current 设置入口与真实页面；主要差距是导航事实分散、路由与局部选择脱节、搜索只过滤导航标题。目标证据是 bundle `com.openai.codex` 的 shipped artifact，不是消费者 ChatGPT Desktop。置信范围与 Evidence ID 见上文。

| 维度             | Codex Desktop 七 member 可确认事实                                                                                                                                                                 | Lime current 事实                                                                                                              | 差距与含义                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 页面入口/命名    | settings-page 原 byte 48070 公开导出 `SettingsPage`                                                                                                                                                | `src/components/settings-v2/index.ts:7` 将 `SettingsLayoutV2` alias 为 `SettingsPageV2`，`AppPageContent.tsx:298` 唯一生产入口 | current 可以直接导出短领域名 `SettingsPage`，不继续增加 V2/compat 外壳；内部目标原名未恢复的不强行对齐                        |
| 可见性与导航投影 | use-visible 原 byte 38628 的返回对象包含 visible/active/redirect/error/render/navigation 与 enterprise label；page/command menu 共享消费                                                           | `_layout/index.tsx:244` ACTIVE_SETTINGS_TABS、`:272` preload switch、`:321` render switch，category hook 另维护导航            | 先由一个章节 owner 同时派生可用页、导航、预加载和渲染；目前新增/删除页有多份名单漂移风险                                      |
| 分组             | settings-page 包内分组为 Personal、无 heading 的 Teams、Integrations、Coding；成员受 mode/auth/host 可见性过滤                                                                                     | `hooks/useSettingsCategory.ts:52` 固定 Overview/Account/General/Agent/System 五组                                              | 分组机制可借鉴；具体章节不可照搬为已启用功能。Lime 多模型/媒体等业务继续保留其 owner                                          |
| 章节路由         | page 从 `/settings/:section/*` 解析章节，同投影提供 active section 和 redirect；local-environments 可映射 `worktrees?tab=environments`，cloud-settings 可映射 `cloud-environments?tab=preferences` | `AppPageContent.tsx:300` 消费 PageParams 初始 tab；`_layout/index.tsx:475` local activeTab，`:487` 内部切页只 setState         | 内部导航应更新 canonical PageParams，统一直达、点击和重进恢复，避免 shell 路由仍指向旧章节                                    |
| 返回语义         | settings-route-state 有 `returnToPreviousHistoryEntry`，page `function si` 原 byte 47746 优先 history -1，其次 return path，最后 `/`                                                               | `_layout/index.tsx:515` handleBackHome 固定 agent Home                                                                         | 当前返回不能恢复来处；下一刀要保存真实进入上下文并由现有 navigation owner 处理，不另建第二套 history                          |
| 搜索模型         | settings-page messageTextGroups/terms/message IDs、section/path/hash、scrollText；键盘 highlight/select/Escape；搜索目标可落到具体内容                                                             | `SettingsSidebar.tsx:340` title/group substring filter，`:410` Ctrl/Meta+F focus；没有 row target 文档模型                     | 导航过滤只能定位页，无法定位具体设置。先收敛 owner，再建立可翻译的 row/section target，不猜未提取 search-documents 的覆盖内容 |
| 预加载           | page/命令导航存在 section prefetch 消费                                                                                                                                                            | Lime `_layout/index.tsx:497` prefetchedTabsRef + preloadSettingsTab；失败会移除缓存重试                                        | Lime 已具备页面预加载机制；缺口主要是清单收敛，不重复造 cache/loader                                                          |
| 未保存导航       | page 包含 requestNavigation gateway、pendingNavigation 与 unsaved dialog；external dirty authority 未在七 member 中完整展开                                                                        | current shell handleTabChange/handleBackHome 未提供统一 pending dirty 导航网关                                                 | shell 未具备可确认的统一保护，但不能推断所有具体页面都丢数据；需后续逐 owner 确认实际 dirty authority，再接统一导航入口       |
| host/帐号状态    | visibility projection 消费 local/remote host 和 mode/auth，存在 cloudPreferencesAccessError、shouldRenderRouteContent 等结果                                                                       | current category 固定；profile render 内有 OEM managed account 条件                                                            | 能确定机制差距，不能声称所有 target host/auth 功能可用；未来只把已有实际 readiness/capability 投影到设置 owner                |

所有 byte 值均为原 member 内 offset；绝对 ASAR offset 与验证过的 marker 见 `evidence/byte-anchors.json`。可读副本行号不用于原字节身份。

迁移前分类：`settings-v2`、`SettingsSidebar`、category hook、PageParams 入口和 preload/render 是 current，尽管名字仍有 V2。`Experimental -> Developer` 是现存 compat 直达委托，不新增第二个实验页。`SETTINGS_GROUPS` 在 `src/types/settings.ts:70` 只有定义、无生产消费者，是重复 dead 候选；`ExecutionTracker` 只剩 enum 与旧 fallback 测试，是 dead 候选。旧 `components/settings/**` 导入有负向 guard，继续禁止回流。上述为迁移前快照；SETTINGS_GROUPS、ExecutionTracker、V2 导出别名现已删除，详见下方正式采用收据。Experimental 仍仅委托 Developer。

不能下结论的范围：默认页是否应该永久保留 Home、完整章节 registry、搜索索引内容覆盖、所有 host/auth 分支和 dirty enforcement。无需为了本轮映射继续提取其他 chunk。后续实施涉及这些行为时再定向补证。

## 迁移合同与后续切片

主目标是让同一设置章节事实驱动导航、可用性、预加载、渲染与 canonical PageParams。章节收敛已正式采用并完成定向与真实首屏读取验证；后续推进 canonical 路由、返回与内容搜索。

已采用的 first slice 保持现有业务章节和默认页，通过短的领域模块承载 current section 清单；将 ACTIVE_SETTINGS_TABS、category hook 与 preload/render 的重复定义收敛为同一 owner 的派生结果。`SettingsPageV2` 直接迁移为公开 `SettingsPage`，同步唯一生产消费者与测试；不保留无消费者 alias。分组/页面中文文案不在本刀重做，也不扩展 MCP/Skills/模型业务。

窄写集应限定 `src/components/settings-v2/index.ts`、`_layout/index.tsx`、`hooks/useSettingsCategory.ts`、`src/types/settings.ts`、`src/components/AppPageContent.tsx` 和对应定向测试。新增领域文件进入现有 settings owner；若实际写集涉及 `_layout/SettingsSidebar.tsx` 或 navigation/PageParams，先在正式执行计划声明并避让脏区。当前 source hash 观察值见 manifest，不是未来实施可覆盖他人改动的授权。

完成单一 owner 后，second slice 再把当前内部切页接入现有 navigation/PageParams，保存返回上下文，统一直达、click、back 和重进投影。真实 dirty authority 尚未确认，不提前新造全局 dirty state；搜索 row target 也后置，需按当前已存在设置内容与五语言翻译定义索引，不能直接复制包内隐藏功能清单。

退出条件：所有 current 设置页只登记一次；导航、可用页、prefetch/render 无孤儿条目；现有 providerView/providerFocus/executionPolicyFocus 直达保真；Experimental 仅委托 Developer；删除无消费者 SETTINGS_GROUPS 与 ExecutionTracker 时同步测试；保留 legacy import 负向 guard。未知 tab/default Home 断言跟随明确决策改写，不能把旧测试当永久产品合同。

第一切片的定向验证覆盖 `_layout/index.test.tsx`、`_layout/SettingsSidebar.test.tsx`、`hooks/useSettingsCategory.test.tsx`、`legacy-import-guard.test.ts` 及 AppPageContent 消费测试。实施触及 GUI 后按仓库规则跑真实 current `npm run verify:gui-smoke`，并对受影响的 settings current smoke 使用真实 Electron/preload/App Server。已读可复用 consumers 为 `scripts/settings-all-pages-current-smoke.mjs`、`scripts/agent-qc/project-gate-settings-a.mjs`、`scripts/electron/settings-about-fixture-smoke.mjs`、`scripts/electron/mcp-config-fixture-smoke.mjs`；各真实验收入口结果单独记录，单凭静态审计或定向测试不宣称 Gate A/B。

KISS/DRY 通过单一登记避免四份名单；YAGNI 通过先收敛已有页、推迟未知 registry/dirty/search 行为；SOLID 通过章节 owner 负责事实、页面继续负责业务、现有 navigation owner 负责路由。source-only 审计与 first slice 源码迁移均 100%，该切片首屏读取已通过；后续路由、返回、搜索与 dirty authority 尚未交付。

## 第一切片正式采用（2026-10-15）

root核对冻结manifest/patch/29项证据与九源before/after后，正式采用单一sections owner、SettingsPage公开名和调用者迁移；删除重复可用性/preload/render名单、SETTINGS_GROUPS/ExecutionTracker与V2别名。业务页（含媒体脏区）未夹写。收据 `.lime/qc/settings-sections/formal-adoption.json` SHA `84a53337dac5103e9df8c5a28e0457a2b7c54b8eb2fc297949ab4543a4bbd1c8`；架构4.4由root确认。上文映射表保留迁移前事实，正式source采用100%，正式六suite78/78、九源lint/格式通过；receipt `.lime/qc/settings-sections/formal-directed-receipt.json` SHA `d9e7c32d6ad0a2c473e4fe55f356c910fe7544e2b1cfd289f07a8f034699df10`。设置验收清单已迁15current keys，补Skills删旧连接器/自动化，用唯一testid与active确认；core/states定向10/10 exit0，收据 `.lime/qc/settings-sections/formal-oracle-receipt.json`，真实首屏读取验收settings-current-native-20261015-2 exit0：15章节key/24可见状态、157原生bridge read、零console/page/trace errors，Main22039正常code0/signalnull；证据`.lime/qc/settings-sections/settings-current-native-20261015-2/summary.json`。这不证明写入、canonical内部路由、返回、内容搜索、dirty authority、live或Windows。

补充沿 registry 的实际消费者只读检查：Media Services 的 custom prompt 与图片数量是本地输入，在 blur / slider commit 才经既有 updateConfig 保存；不能把它们一概当成没有草稿的开关，也不能据静态代码声称保存失败或导航丢稿已复现。Appearance 的选择动作直接持久化并在失败时回滚，属于另一种保存时序。Developer -> Experimental 的 crashConfig 文本字段只改本地状态，显式 Save 才调用 persistCrashConfig，是新的手动保存候选。Skills -> SkillsPage -> RepoManagerPanel 的 owner/name/branch 在 Add 前属于本地表单，另有 Scaffold 对话框仍需逐一调查。Profile 内的 UserCenterSessionSettings 将登录表单交给 useOemCloudAccess；认证输入与应用配置编辑分开登记，不记录任何实际凭证。上述均未接入或验收统一 dirty gateway；完整表单、弹窗及在途 autosave 覆盖仍 unknown。本轮未修改这些业务文件。

## 第二切片只读预检（2026-10-15，实施前历史）

本轮尚未修改设置产品源码。`useAppNavigation` 已有 requested/committed 与 requestId，设置进入上下文应由它承接；不新增全局 history owner。`SettingsPage` 的 activeTab/providerView/developerLabTab 目前从 initial props 复制为局部状态，内部点击不更新 PageParams。下一刀应让同一 canonical 参数驱动章节与焦点，保留 providerView/providerFocus/executionPolicyFocus 和 Experimental 委托语义；离开章节后不重放旧焦点。

`SettingsNavigation` 当前将 rail Home 与页头返回共用 onBackHome；对齐返回来处时必须分开两种用户动作，Home 图标仍进入首页，返回按钮恢复进入设置前的已提交目标。恢复目标不能意外重放 newConversationRequest、初始发送或其他一次性 intent。精确返回会话应与现有 reload 最小会话参数投影配合，不能仅保存旧 params 后再次触发发送。

另一个必要合同：Home 首发 materialize 后，根 PageParams 未必已有真实会话 identity；App 已消费 `onAgentSessionChange` 的实际可见会话投影。单纯保存进入设置前的 PageParams 可能返回 Home 或重放旧初始输入。实施前须沿该 current 回调及真实 workspace 确认返回目标，覆盖“Home 首发后 → 设置 → 返回同一会话”和“已有会话 → 设置内部切章 → 返回”两条真实路径；不得把旧初始参数当成实际可见会话 authority。

该切片需要同步 `_layout/SettingsNavigation.tsx`、layout、useAppNavigation、App/AppPageContent 接线、五语言返回文案及稳定测试；现有 `settings-home-button` 消费者包括 settings-about Electron fixture、project-gate-settings-a 与 tool-surface-page smoke，必须按真实返回语义迁移，而非强制保留“永远回Home”的旧正向断言。当前 native15章节/24首屏证据仍只证明读取，不覆盖该后续导航合同。search 与 dirty authority 仍待实际 owner 调查。

进一步只读核实：`useWorkspaceContextSurfaceRuntime` 已同时拥有实际 `sessionId` 与 `runtimeWorkspaceId`，但现有 `onSessionChange` 只发布 sessionId；App 的 `activeAgentSessionId` 同样没有 workspace。第二切片应沿这条既有投影回调携带可见 workspace，或在同一 owner 提供等价的只读位置快照，避免用根 PageParams 的旧 projectId 代替当前 workspace。它属于导航显示上下文，不扩展为业务状态或第二 read model；实现与定向/真实路径验证尚未开始。

## Current dirty owner 只读预检（2026-10-15）

本次仅检索 `src/components/settings-v2` 与 `useAppNavigation` 中的 dirty/unsaved 命名并追踪命中的实际消费者，未修改设置产品代码，也不是完整表单清单。已确认两个 current 章节具有自己的未保存状态：Memory 比较本地 draft 与 snapshot，Cancel 恢复 snapshot，Save 经既有 saveConfig 成功后同步两者；Web Search 比较本地 draft 字段与已加载配置，Save 构造同一配置 owner 的更新。两者分别由 `sections.tsx` 直接渲染，当前章节回调未传递 dirty 导航接口。

`ChannelsDebugWorkbench` 也有 channels/gateway 与 initialJson 的比较，但唯一生产消费者位于 `components/channels/ImConfigPage`，不在这次15章节 registry 内。不能因文件位于 settings-v2 下就将其登记成当前设置章节，或用其 dirty 状态替代 Memory/Web Search。

当前已检查的 SettingsPage handleTabChange/handleBackHome 没有 pending-navigation/dirty gateway。后续保护应让现有表单 owner 报告当前编辑状态，并由唯一导航入口消费；不要在 shell 复制配置或重算业务 dirty。其他表单、弹窗、独立页面和参考应用外部 dirty authority 未穷举，完整覆盖仍 unknown。此预检不证明实际导航丢稿，真实失败/保存/取消路径仍须验证。

续检沿 `sections.tsx` 的实际 render/preload 追到另外三处 current 编辑 owner，不能仅凭 dirty 命名搜索确定保护范围：Environment 的 `updateEnvironment` 修改本地 config，`handleSave` 才调用 saveConfig 并重新读取，没有独立已保存 snapshot；Execution Policy 分别持有 fullConfig 与规范化 agentConfig，编辑只更新后者，保存成功才同步 fullConfig；Profile 的 editingField/editValue 是行内草稿，保存异步落配置，取消清除行内编辑。这三处属于后续 dirty 调查候选，尚未接入导航保护，也未用真实交互证明丢稿。媒体设置、provider/MCP 弹窗及其余编辑面尚未穷举；本轮不修改这些业务 owner。

继续沿current消费者只读核实：Providers章节经ApiKeyProviderSection进入ProviderSetting，apiKeyDraft/apiHostDraft各有dirty与显式保存动作，成功才清dirty；MCP章节经McpPanel -> McpPage -> useMcpPageEditorState，名称、描述、JSON和enabled编辑保存在hook本地，Save才add/update，Cancel退出编辑。两者尚无设置导航dirty报告，不能只保护Memory/Web Search。这里仅确认表单owner，未执行真实丢稿或保存/取消验收，也不保存任何凭证值。当前ProviderSetting为2004行、Memory为1010行、Web Search为1534行；下一刀应先在既有领域拆出编辑/保存职责，再接导航报告，不继续在巨型文件堆叠业务。媒体、模型添加和导入弹窗等仍未穷举。

## 第二切片实施（2026-10-15）

`SettingsPage` 现直接消费 `SettingsPageParams`，章节点击回写同一根导航；删除 initial props 到 activeTab/providerView/developerLabTab 的局部复制。焦点仅进入所属章节，切离清理；Experimental 仍委托 Developer。唯一返回快照位于 `useAppNavigation`，原workspace surface回调直接迁为 `onLocationChange({sessionId, workspaceId})`，App不再另存一份活跃session。requestId门禁拒绝旧回调，连续未提交导航保留实际来处，最小Agent恢复参数排除首发/附件/技能启动/新建intent。页头 `settings-back-button` 返回来处，可见rail Home始终进入首页；旧隐藏Home选择器按钮删除，所有current消费者迁可见入口。

Skills 弹窗续检：`SkillScaffoldDialog` 本地持有 target/directory/name/description，open 时由 initialValues 初始化；提交先验证，再等待 `SkillsWorkspacePage.handleCreateScaffold -> skillsApi.createSkillScaffold`，成功关闭，失败保留错误与当前输入。它只承接手工创建与专家注册预填，不从消息结果生成或回带草稿。`SkillContentDialog` 在本次源码检查中仅消费详情/资源投影，没有输入编辑；`SkillPackageInstallDialog` 持有检查结果、所选文件和安装在途状态，没有配置编辑草稿。两者不能因弹窗形状被误登记为同一 dirty 表单；安装在途关闭/迟到结果仍需独立验收。本轮未修改这些产品文件。

## 第二切片当前验证（2026-10-15）

本刀沿用上文 REA 七 member 与摘要身份，不重复分析安装包；Lime 实现方式和本地命名不冒充包内原始符号。canonical 章节/焦点由 `useAppNavigation -> AppPageContent -> SettingsPage` 驱动，已有 workspace surface 只发布真实 session/workspace 导航位置，requestId 拒绝迟到投影。返回恢复最小会话参数并剔除一次性 intent；页头返回和可见 rail Home 分工。旧 initial/local 章节双轨、隐藏 Home 选择器和 backHome 文案键已删除，消费者/测试迁至 current 语义。

定向 8 suite 108/108，位置测试单独 1/1 无警告通过（与前者重叠，不累加）；收据 `.lime/qc/settings-sections/navigation-targeted-final-receipt-20261015.json` SHA `9f72f1ef95f7f133790fa789c987df438dc6b82e1ffa7560eed90d25a9ca6d14`。真实返回暴露持久 workspace 解析捕获尚未建立的 Composer owner，使 source 身份过期；既有 `resolveInitialSessionSwitch.waitForResolution` 现等待 owner 建立，保留 generation/scope/epoch 与迟到结果守卫。组合回归先 2/2 红，后 5 suite 46/46 绿。

默认第 11 批另暴露 incoming service-skill 被新建 route reset 标为 dismissed。测试迁至真实 Home builder 和无会话投影后仍红；修复只让该 route reset 保留本次请求，普通 topic reset 继续取消，空任务路由清除旧 intent。目录加载试验已撤回。3 suite 11/11 通过，含目录迟到后旧表单不能复活；严格 lint 与标准 renderer/node typecheck 通过。第 61 批护栏要求精确登记新增受控 external backend fixture，补登记后定向 2/2 通过，不扩大生产默认许可。

标准 GUI 第 4 轮 `codex-settings-navigation-shell-20261015-4` wrapper exit0，24/24，全部错误计数为0。补护栏后 renderer 重建 exit0。原生第 14 轮 `settings-navigation-native-20261015-14` 整轮 exit0、4/4 合同通过：Home 首发后经设置切章返回、侧栏已有会话经设置返回、rail Home、public Electron open-url 技能表单进入后 New chat 清除。同一 Thread/Turn/Item/workspace，backend turnStart 始终1；223条原生IPC，console/page/trace/production mock 均为0。Main79440 在原15秒内正常 code0/signalnull，约5.593秒，无强制回收。35份声明源码、2828份目录产物及实际 sidecar 前后零漂移，freshness 前后 ready；目录含遗留 chunk，不代表全部被加载。sidecar 为 `lime-rs/target/debug/app-server`，SHA `d0780858f959f44a170ca11f803e20bfe9f5853d6d5b5a6c772ebd2621d0a2d0`。

原生 summary `.lime/qc/settings-sections/settings-navigation-native-20261015-14/summary.json` SHA `9626c25423ba7780708816dc548d7c01695bc4f6fb41286440d5ffc6c8c6b67b`；独立冻结13份证据见 `.lime/qc/settings-sections/navigation-final-20261015-1/native-evidence-manifest.json`。技能入口证明 Host open-url 事件及真实后续接线，不证明 OS URL dispatcher；受控 external backend 绕过生产 RuntimeBackend/provider 执行，不是 live 模型证据。第12/14轮被动 macOS sample 成功，但正常退出；旧退出超时根因仍 unknown，不能据此声称已修复。

| 保留失败轮次 | 实际失败与边界                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–4          | 问候终态marker/目录读取/projectId oracle错误、部分正常退出超时；第4轮 testFixtures 时间戳误判，未启动Electron。freshness针对testFixtures红绿32/32，真实源码仍会使产物失效。 |
| 5–6          | Home返回通过，已有会话返回卡恢复；第6轮确认最小目标正确，随后修复上述Composer owner竞态。                                                                                   |
| 7–9          | 三项业务通过但Main未在15秒内退出，整轮失败；8/9 sampler无有效采样，不能归因inspector。                                                                                      |
| 10–11        | 第10轮protocol检查重写源码mtime使前置freshness失败；第11轮业务/正常退出通过但并行源码修正使后验freshness失败，均不计通过。                                                  |
| 12–13        | 第12轮表单真实显示，但字段oracle漏“（必填）”，整轮失败；第13轮护栏testSupport源码mtime触发freshness，未启动Electron。重建后第14轮通过。                                     |

所有原失败 summary/log 保留且不覆盖；没有扩大Main期限、skip、手改续跑状态、私有退出绕过或生产mock fallback。默认前端续跑最终130/130批、exit0，1759个登记文件均存在；已过默认前置、contracts、标准GUI与本轮原生结果组成组合验收。最终收据 `.lime/qc/settings-sections/navigation-final-20261015-1/receipt.json`，格式/文档/脚本/链接/diff检查由其记录。原verify:local wrappers保留exit1，不冒充一次性全绿。本切片声明的4项真实合同4/4（100%），整体GUI仍partial；dirty/search、完整表单及弹窗、参考实时效果、live与Windows继续未验。

## Memory 未保存保护：定向静态复核与实施（2026-10-15）

复用既有七 member REA full `ev_4bf8bfc7ccb14fb058096dd32864ae7f9ab83a8f0ad9acb46cfd79b5379ab36c` 与 summary `ev_6d2230454a838f113f4e61d100fb41d47ea6b241100765d84eb35674dcd71478`，没有重新执行目标。直接读取同一保留成员属于普通源码锚点复核，不伪造新 Evidence。settings-page SHA `509c05cfd1d6e93488bcb7b7660f4fadd41a28d8a79aba7f93cc93ee0c170241`；unsaved dialog SHA `3d1843d161cdbc4e371088169719ff8bace1badbbb902cf9261b28fb7a849a4e`。

page 的 `requestNavigation` 在 dirty 集合非空时保存 continuation，空时执行；discard continuation 在已存在的 override 下运行，外部集合的注册类型仍未恢复。dialog 的关闭/Keep editing 清空 pending；Discard 先清空再执行 captured continuation。可见动作只有 Keep editing 与 Discard changes，没有保存按钮。这里证明静态代码与文案，不证明参考应用运行中的所有离开入口或 dirty 覆盖。

Lime 首批实现沿唯一 useAppNavigation 保护章节/返回/Home/根导航与新建入口，pending 不改变 canonical route/requestId/来处/restore。dirty/saving 从原表单报告，不在 shell 比较配置；保存中拒绝放弃。Memory 编辑与保存从原 1010 行组件拆到领域 hook，纯规范化分离，删除内联旧路。成功确认已提交 snapshot，保留在途新编辑；失败留稿，卸载后结果不通知新 owner。SOUL 未应用输入单独保护，Apply 消费、Cancel 清空，Save 不隐式应用。组件名与登记类型是 Lime 实现命名，不冒充恢复出的上游原类名。

原始8场景均在接线前失败，后首轮6 suite 102/102通过；后续新增五语言/Escape焦点、最后目标/来处、重复保存与卸载迟到回归。追加复现了旧 config 快照覆盖其他修改（1红3绿），已复用串行 updateConfig 合并 Memory 到最新配置并删除整份 config 本地状态；随后补回归复现旧导入预览未随原文变化失效（1红13绿），修复后最终7 suite 114/114通过；仅当前输入重新预览后才能应用并消费。最终默认前端130/130批（1761文件）、contracts、标准GUI24/24与原生第3轮均通过组合验收；原wrapper扫描超时exit1保留，非单次wrapper全绿。原生新增6/6、原有4/4，440 IPC且错误/mock为0，Main54663正常630ms退出；43原生源码/2934目录产物与sidecar零漂移。独立冻结收据 `.lime/qc/settings-unsaved/final-20261015-1/receipt.json`。第1轮未启动时的rustup metadata网络阻塞与第2轮错误会话列表定位失败均保留；第3轮只迁fixture的实际导航，不改产品或期限。其他手动草稿owner与搜索尚未交付，不能把本次gateway接入当作全部表单已经保护。

上述切片的范围只包含配置/SOUL；独立修正笔记由下节接续，不将两者混为同一次产品验收。审阅/维护操作、其他章节、窗口关闭和完整弹窗仍待逐owner核实，参考外部dirty registry与全量覆盖仍unknown。

## 页内修正笔记：同一导航保护的第二表单（2026-10-15）

复用上一节匹配版本的REA导航证据；没有同名参考笔记模块的证据，不把 Lime 的 MemoryNoteEditor 命名当作上游原符号。实际 Memory 页面10/10红例确认未注册的笔记可随导航丢失、同事件重复提交与卸载后迟到刷新；追加3红16绿确认切局部页签也会卸载笔记。当前独立组件只拥有输入版本/同步保存锁及dirty/saving投影，所有离开仍归唯一useAppNavigation。addNote继续归既有App Server memoryStore owner；原内联表单/保存删除，成功仅消费提交版本，新输入与失败稿保留，卸载结果忽略。

日常面板保留同一实例并在AI个性/高级时隐藏，配置保存/取消不能替代笔记保护。可见控件测试迁移后最终9 suite 126/126通过（新笔记integration 20项）；五语言名称/描述与主题token沿现有资源。标准verify:local整轮exit0，前端130/130批、1762登记文件均存在，标准GUI24/24、所有错误/mock计数0。审阅、索引、整理、重置为即时canonical操作，无本地表单草稿；它们的完整在途/迟到验收不属于本切片。

真实Electron第5轮整轮exit0：四类离开继续编辑/放弃不落盘、配置Cancel与两个局部页签保稿、显式保存单份文件并经真实preload/App Server的memoryStore/read核对完整Markdown，新增合同6/6。653原生IPC、console/page/trace/mock均0，同一Thread/Turn/Item/workspace，backend turnStart始终1；Main22858正常698ms退出，无强制回收，46源码/3039目录产物/sidecar前后零漂移。独立冻结收据 `.lime/qc/settings-note/final-20261015-1/receipt.json`。默认后仅两份fixture修正，无产品代码变化，不重复全量测试或构建。

前三轮失败均保留：helper目录误写已按Rust owner修正；工作区菜单候选项越界；错误地省略真实选择后workspace=null。最终恢复正常UI选择、先scrollIntoViewIfNeeded再click并记录几何/截图，保留workspace断言；未force、未JS click、未放宽120秒期限。第2轮越界根因仍unknown，未声称修复产品菜单。失败/重复/在途/迟到由组件证明；受控external backend绕过production RuntimeBackend/provider，不推广到其他表单、窗口关闭、参考实时效果、live或Windows。该笔记切片100%，整体GUI仍partial。

## Web Search 草稿 owner（2026-10-16，已验收）

继续复用同一REA导航证据，不从公开TUI推断Desktop表单。实际表单先11红2绿，已迁至独立useWebSearchDraft和纯webSearchConfig；四个页签只消费同一draft/change。仅修改字段经updateConfig合并最新配置，保留其他owner字段与MSE条目；字段版本避免在途新编辑被清理或未编辑旧值覆盖新baseline。失败留稿、重复提交、卸载迟到、加载失败重试、语言切换、局部页签与五类离开由实际页面integration回归，新增24项及纯合并5项、旧页面13项均通过，总定向5 suite 80/80。原内联副本直接删除；组件/函数为Lime职责名，上游同名符号仍unknown。默认verify:local整轮exit0，新前端130/130批、1764文件、contracts与标准GUI24/24通过。真实Electron首轮settings-web-search-native-20261016-1整轮exit0，Web Search合同6/6、849原生IPC，错误/mock均0；同一Thread/Turn/Item/workspace且turnStart始终1，Main54930正常358ms退出。57原生源码/3145目录产物/sidecar前后零漂移，freshness ready。笔记Save按钮72×32且文本单行、无裁切，截图复核通过；不代表全部宽度或主题。summary SHA `bfb14dfc8ee496bfee84bac7c298c4a949e657069231c5342c544187b179e0d6`，独立收据`.lime/qc/settings-web-search/final-20261016-1/receipt.json`。本切片6/6（100%），整体GUI仍partial；external backend不证明production RuntimeBackend/provider或live搜索，其他表单/内容搜索/窗口关闭/Windows/参考实时效果仍未验。

## Environment 草稿 owner（2026-10-16，已验收）

复用上面匹配的 REA full/summary Evidence，本轮重核两份 member SHA 和 requestNavigation/pendingNavigation/Keep editing/Discard 原字节，未重复分析或执行参考应用。此证据约束导航行为；Environment 原始组件、字段 registry 和类型仍 unknown。

Lime 原1015行Environment页面持有整份Config并在saveConfig后重读，未登记dirty/saving，会覆盖在途输入；变量行以可编辑名称为key，打字重建input。现直接迁为独立草稿/字段合并/预览/展示owner（页面598行），开关/原始超时/变量列表分别合并最新配置；接同一useSettingsDraft，拒绝重复保存、保存期间放弃、旧预览和卸载迟到，失败保稿，五语言切换不重载。固定浅色类替换现有语义token，不新增theme/runtime/config authority。

最终恢复证据：定向4suite51/51，默认前置+前端续跑131/131批（1766文件）+contracts+标准GUI24/24组合通过；恢复wrapper的Profile超时exit1保留，7/7定向与批次续跑通过，无期限/状态修改。原生第5轮整轮exit0，可见四路导航与保存/读回/重开/恢复5/5、主题投影4/4；1058 IPC，错误/mock均0，Main40864正常918ms退出，同一Thread/Turn/Item且turnStart始终1；64源码/3566目录产物/sidecar零漂移。收据`.lime/qc/settings-environment/final-20261016-3/receipt.json`，最终summary SHA `66302537bee3c066ee790eafddac53c5f0aa55c99d0355e0038c015b9f085fd3`。

原生前四轮失败保留：两次误用设置壳已卸载的AppSidebar按钮/快捷键；第2轮Main原15秒退出超时、强制回收不计通过；第3轮误把默认Environment省略与显式默认字段判成变化，按Rust默认值做语义比较后核对其余全部字段；第4轮主题/语言同名“跟随系统”严格定位失败，改完整主题可访问名称。产品源码未改，仅fixture校正。New的canonical保护保留组件证据，设置内无真实入口故原生未验；不能宣称五路原生通过。浅/深/system媒体模拟截图只证明当前皮肤/窗口，不证明OS事件、全skin、live或Windows。更早`.lime/qc`被外部清理的证据已标lost，前79批原状态幸存，历史日志不伪造恢复。整体GUI仍partial。

## Execution Policy 草稿 owner（2026-10-16，已验收）

复用上述REA导航/确认合同，保留settings-page与unsaved dialog原字节SHA及requestNavigation47186/pendingNavigation47422锚点。Execution Policy表单与外部dirty registry原始符号unknown；本轮不重复运行参考应用。`useExecutionPolicyDraft`管理七个owned字段及保存基线/版本/同步锁，`executionPolicyConfig`按字段合并latest；规则列表各为原子字段，未编辑沙箱开关、模型参数与其他工具覆盖保留，仅编辑bash才迁移legacy Bash。页面1215→420行，规则编辑、来源展示与纯presentation分离；语言不触发load，错误不展示后端值，dirty/saving禁reload。

实际表单初始18项中16红2绿，修复后定向5suite51/51通过（页面7、纯合并8、表单18、Windows状态4、共享导航14）；旧saveConfig fixture迁为串行updateConfig合同，原有效配置、focus和建议规则断言保留，完整字段保留另有精确对象比较。旧冷启动fixture同步迁安全错误、失败保稿和Save重试；删除空Host统计，GUI保存确认、配置写入请求与独立同边界JSON-RPC IO核验分别记录，成功IPC不冒充保存成功。9项证据护栏复验通过。

最终默认由已过前置、原生test:resume 131/131批（1768文件）、contracts和新标准GUI24/24组成；原wrapper第112批富输入恢复超时exit1保留，原文件3/3复验、超时项1525ms，原5000ms期限及续跑状态未修改。导航第2轮整轮exit0，可见四路加保存/读回/重开/恢复5/5、规则CRUD与完整配置保持通过；1291 IPC、错误/mock0，同一Thread/Turn/Item、turnStart始终1，Main589正常1050ms退出，75源码/3777目录产物/sidecar无漂移，freshness前后ready。四主题截图人工复核，规则控件文字最低对比度light11.1087/dark13.3466，system模拟对应相同值，均超过4.5:1且无控件横向溢出。

冷启动第2轮exit0、32/32，3次真实Electron/preload、76 IPC、3次GUI保存确认和4次写入请求；独立IO probe返回-32000且原因验证通过，GUI安全错误/保稿/Reload禁用/Save重试与冷读回分别成立。Main13301/13665/13996正常793/303/445ms退出，强制回收0，错误/mock0、freshness前后ready。安全错误截图人工复核，probe不冒充GUI响应捕获。收据`.lime/qc/settings-execution-policy/final-20261016-1/receipt.json`同时保留首轮主题缺口、旧cold失败与默认超时。New与诊断focus/建议仅组件证据；受控backend绕过production RuntimeBackend/provider，主题仅current skin/1440×1000与媒体模拟。工具执行、live、Windows/安装包/参考实时、全皮肤和完整GUI仍未验，整体partial。

## Profile 当前内容切片（2026-10-16，本地字段合同验收）

已删除本地 Tag、完成度、头像、只读 email、用途/提示卡与旧三份 presentation；五语言退役键和正向断言一起删除。ProfileSettings → ProfileContent → ProfileLayout / ProfileFieldEditor，内部命名为 Lime 职责名；displayName 显式映射 nickname 配置。64/140、名称非空 trim、简介换行转空格/trim 和 IME 行为已有实际 DOM 回归。Settings 壳拥有滚动，页面不复制 data-profile-scroll 或嵌套滚动。保留 revision/加载与保存锁、安全失败保稿、在途新输入和既有导航保护。

恢复后重新执行的定向7suite67/67、Rust配置129/129（含实际编译的退役字段JSON/YAML回归）、完整contracts、typecheck和strict lint均通过。

最终1.159.0标准GUI `standalone-shell-01-20261016160123-87137` 24/24；真实原生导航 `settings-profile-content-recovery-20261016-3` exit0，名称/简介×四路导航加保存/读回/重开/完整配置保持恢复共9/9（100%仅本地字段合同），四主题4/4另列。732px、嵌套滚动0、横向溢出0与DOM64/140检查通过；1627 IPC、console/page/trace/mock0，同一Thread/Turn/Item且turnStart=1，Main正常退出。冷启动 `settings-profile-content-recovery-cold-20261016-1` exit0、32/32，165 IPC、错误/mock0；双字段分别真实IO失败保稿/重试、两次冷读回、完整配置保持恢复和三次Main正常退出通过，独立RPC probe不冒充GUI响应。27声明源码/83原生源码/531目录产物和只读版本上下文后验无漂移，两份资源清单与实际sidecar SHA一致且均为1.159.0，freshness前后ready。7张最终截图人工复核，仅当前皮肤1440×1000；system为媒体模拟。新日志即时双份保存。

删除前已观察到默认前置检查、全量前端自动续跑131/131批（1770文件）、workspace --lib39组7121通过/0失败/5项既有ignored，以及标准GUI24/24通过；三个verify:local wrapper的exit1分别来自原5秒CLI超时、旧Codex feature正向护栏和并行message.rs拆分后的扫描名单遗漏，后两处护栏已按current语义迁移。随后外部整体删除.lime，使本轮这些成功/失败日志、smart state、早期原生原件和清理记录丢失；该部分只能作为历史观察，不伪造原件、不声称新定向等于全量重跑或wrapper exit0。三份旧冻结Profile草稿、Profile数据追踪与Execution Policy收据由独立备份恢复，SHA未变。

仅本地字段内容与安全持久化合同关闭；本地Config不是公共Profile服务。单独账号会话卡、远端GET/PATCH、eligibility/preview/is_self/can_edit、username/pins/upload仍gap；New仅组件证据，external/unavailable backend不证明live/provider/tool。参考运行、Windows、安装包和全GUI未验，整体partial且分母未完整枚举。 新收据 `.lime/qc/settings-profile/content-final-20261016-recovery-1/receipt.json`。

## Profile 本地与认证入口隔离（2026-10-17，已验收）

current OEM gateway 只有 session/bootstrap 和外部账户中心能力，`profileEditable` 仅选择按钮文案；没有与参考公共 page、bio、pins 同义的 typed query/mutation。继续保留此能力缺口，不复制参考远端 API、不伪造 eligibility 或公共身份 fallback。

唯一 settingsSections 现在按已有 runtime 判定互斥预加载/渲染本地 ProfileSettings 与 OEM UserCenterSessionSettings。无 OEM runtime 时移除账户摘要、未配置云服务卡及账户组件挂载；本地名称/简介的配置、草稿和导航 owner 继续复用。有 OEM 时保留现有认证 owner，完整账户内容仍待对齐。该条件是 Lime 当前能力边界决策，不是已复刻参考的 feature/loading/eligibility gate。

REA 复用既有 parent `ev_2b4e6d08d1d979e0dcd2e6defa733fa149bd45f5b4d48b4ba05fb4f7938526fa`；新 view `ev_d842243733886bd9ced33ce5cf6ea8094fd0b7ada2ed54fa4f16aba9a8a10fdf` 只确认 eligibility source-module 身份与静态关系，压缩导出仍为 n/t，不造原函数名。两个参考成员按旧包 manifest 复核原字节 SHA，parent semantic partial/truncated 与参考未运行限制不变。

五语言未挂载回归先取得5个有效红例。定向7 suite107/107、完整typecheck、严格lint/format通过；更新构建后的标准GUI `standalone-shell-01-20261016182210-58995` 24/24，错误/mock均0。真实Electron `settings-profile-entry-20261017-2` 整轮exit0：本地/OEM入口2/2仅指组件分支合同，本地入口额外观察9次、唯一页头1、账户/登录/Google入口0；原本地导航9/9、主题4/4继续通过。1640 IPC，console/page/trace错误及production mock均0，同一Thread/Turn/Item且turnStart始终1，Main正常code0/signalnull退出、强制回收0；83份声明源码/741份目录产物和sidecar前后零漂移，freshness两端ready。5张新截图人工复核通过，仅当前皮肤1440×1000，system为媒体模拟。

原生第1轮保留exit1：启动前Cargo metadata等待自行恢复，未中断进程或修改期限；场景完成后，最终freshness守卫因并行协议源码及生成产物变化拒绝验收。第2轮按标准入口更新构建，并通过已有APP_SERVER_BIN接口显式选择已校验manifest/SHA的sidecar；不放宽守卫、不改生产helper、不覆盖失败证据。

独立冻结收据 `.lime/qc/settings-profile/entry-final-20261017-1/receipt.json` 绑定本轮源码、文档与双份证据；仅关闭入口隔离切片。无新增compat/deprecated，删除旧双展示/双预加载路径及过期正向断言，无物理文件删除。OEM真实认证与账户内容、公共Profile query/mutation/eligibility、参考运行、live、Windows、安装包及完整GUI仍partial。

本轮仅章节接线，无新增命令/schema/config/Rust逻辑；verify:tasks包含并行P0改动，不将混合工作树规划视为本轮范围。不重跑默认全量verify:local、workspace或未修改的冷启动保存状态机，不宣称默认整轮/远端认证通过。

## 设置内容搜索文档补证（2026-10-17）

沿相同安装包摘要选择性提取 `_virtual_settings-search-documents-ea4141d234e9.js`，525711 bytes、SHA `f63906f31750633a6fb252894dfa84247883f5a79a1e0dfd008bb56919283fca`，包内integrity已核。REA parent `ev_c1fe1285584791d68b3fd0c52bf430325bb5da1758aefd3090feb75ba337e4b2`，source-module view `ev_34efb5366f4d9b0617273007cb751bc8764c71383e46d983b157745ce735b1a0` 确认唯一公开导出 `settingsSearchDocuments`。单成员解析47288 AST、0 parse failure；semantic达到100000节点上限，partial/truncated、5 unknowns，未解析rolldown依赖，未执行bootstrap。

纯AST字面量读取确认50个section key、5234条id/defaultMessage消息；此为包内索引覆盖，不代表50项当前可见设置。复用原settings-page证据：搜索合并本地化panel/terms/messageTextGroups，结果含section/path/scrollText并经既有导航gateway选择。内部压缩函数名不映射为原源码符号。Lime仍只有侧栏标题过滤，内容搜索、精确行定位、键盘选择及dirty路由接线尚未实施或验收。

下一刀在既有settingsSections、SettingsSidebar、SettingsPage和canonical导航owner建立可翻译的内容文档与稳定目标，仅登记current可用页/字段；不复制隐藏章节、另建history/dirty authority或使用账户数据填索引。实施前收窄实际写集和Verification Contract，再同步迁移旧标题过滤测试/fixture，验证五语言、键盘/焦点、导航保稿与真实Electron。静态补证及双份摘要收据 `.lime/qc/settings-content-search/audit-20261017/audit-receipt.json`，不计产品完成度；公共Profile缺口继续开放。

## 设置内容搜索首批目标（2026-10-17，首批9项已验收）

复用上方安装包/REA证据，公开导出对齐settingsSearchDocuments；内部压缩符号不另造上游名字。Lime由唯一settingsSections提供15个current章节标题，独立静态文档登记本地Profile2、Environment3、Execution Policy4，共9项。纯searchSettings按当前语言的标题/标签/说明匹配，NFKC与多词要求同一文档，标题优先，每章节只选一个最佳结果。没有复制参考50组功能或5234条消息。

SettingsSearch集中combobox/listbox、上下/Enter/Escape、IME、清空和无结果。Sidebar只共享一份query/results给桌面/窄屏；Ctrl/Meta+F聚焦可见输入。内容选择经过原onNavigate/useAppNavigation和navigationGuard；取消保持草稿与搜索，提交才清查询/浮动面板。已提交requestKey重建内容子树，保证同页明确放弃卸载旧草稿；配置不被隐式保存。原对话框无条件恢复旧焦点的冲突由有效集成红例捕获，修为仅继续编辑恢复、放弃由目标接管。

useSettingsSearchTarget只接受当前章节允许的稳定target，本地Profile受既有OEM条件过滤，拒绝未知/跨章节/选择器形状目标。MutationObserver等待异步DOM，路由变更/卸载清理，成功后只滚动main内容owner、聚焦非编辑外层并应用主题ring。稳定target替代参考scrollText扫描属于Lime实现决策，不声称原算法逐字等价。旧Sidebar内联标题过滤和重复搜索UI已替换，新增compat/deprecated为0。

有效五语言初始5红，补充discard焦点红例后修复。16suite198/198（含实际三类表单）已通过；最终搜索复验、完整typecheck、标准GUI及原生9目标/四主题/窄屏与后验摘要继续执行，证据目录.lime/qc/settings-content-search/implementation-20261017，独立备份见context.json。全仓file-size护栏exit1含既有Rust/前端超线文件，本轮新产品文件均未超线，未更改基线；此失败独立保留，不冒充默认门禁通过。

本轮只关闭声明的9项目标；完整设置内容、公共Profile/eligibility/认证、参考运行、production RuntimeBackend/provider/live、全皮肤/OS系统主题事件、Windows/安装包和全GUI仍partial。KISS/DRY复用章节/导航/翻译/草稿owner，SOLID分离静态文档、纯匹配、输入和定位，YAGNI不复制隐藏功能或新建业务后端。

最终验收：定向16suite198/198、最终搜索3suite27/27、完整Renderer/Node typecheck与strict lint通过；脚本治理、Desktop参考边界、docs边界通过。两次完整verify:gui-smoke exit0；最后同一隔离快照标准smoke `standalone-shell-01-20261016200249-26100` 24/24、错误/mock0。没有产品业务修改后无理由重跑全量前端/Rust；默认verify:local未跑，task selector含并行P0协议/Rust任务，全仓file-size既有失败原件保留、不改基线。

真实Electron第5轮 `settings-content-search-native-20261017-5` 整轮exit0，仅绑定记录的隔离源码/产物快照；本轮18份产品/测试/fixture源与原工作树后验SHA一致。9目标9/9（100%仅首批内容目标）、说明/重复选择、桌面保稿/同页明确放弃、600×900窄屏入口/保稿/目标接管与四主题4/4通过。1740 IPC，console/page/trace/production mock0，同一Thread/Turn/Item/workspace、turnStart始终1；Main26718正常code0/signalnull退出，强制回收0。91份声明源码/1161份产物和sidecar前后零漂移，freshness两端ready，8张截图人工复核；主题仅current skin/system媒体模拟，不覆盖OS系统主题事件。

结构/命名：公开settingsSearchDocuments直接对齐；searchSettings/SettingsSearch/useSettingsSearchTarget为Lime职责名，原压缩内部符号unknown。current为单一文档/纯匹配/输入/定位与既有settingsSections/useAppNavigation/Config owner；compat/deprecated新增0。dead/deleted为原Sidebar内联标题过滤、重复搜索样式/事件和对话框放弃后抢回焦点的旧路径，无物理文件删除。本轮最多613行产品文件；KISS/DRY复用现有导航/翻译/草稿，SOLID分离职责，YAGNI不复制隐藏设置或另造业务后端。

新独立冻结收据 `.lime/qc/settings-content-search/final-20261017-1/receipt.json` 保存本轮成功/失败原件、源码、审计、截图与后验检查；旧冻结件未追写。只关闭9项搜索切片，完整设置内容搜索、公共Profile/eligibility/认证、参考运行、production RuntimeBackend/provider/live、Windows/安装包/全皮肤及整体GUI仍partial；全产品分母未完整枚举，不提供伪完成百分比。下一刀沿同一索引/导航owner覆盖其余current设置内容与对应保稿场景，协议/Runtime并行热区继续避让。

## 设置搜索：联网搜索内部页签（2026-10-17，已验收）

沿用同一REA索引/导航Evidence；参考结果path的职责以Lime静态文档path表达，不把压缩符号或未知内部算法当成原源码。索引新增现有联网搜索15字段：search3、providers4、mse6、images2。已提交searchFocus在原SettingsPage中通过getSettingsSearchDocument白名单解析path，由唯一settingsSections传给WebSearchSettings的局部Tabs默认值。输入或dirty确认期间不切页签；确认放弃后复用requestKey卸载旧草稿，既有定位hook等待DOM。FieldBlock按现有htmlFor暴露非编辑外层，不聚焦密码框、不自动显示密钥。

有效红例22失败/1通过；新集成测试最初缺少lazy模块预取，随后直接await原section.preload，异步配置/取消仍另测。最终定向8suite133/133，覆盖15字段真实挂载/定位、5资源消息检索、隐藏页签继续编辑保稿/放弃不保存、重复打开、延迟加载和跨章节/伪造目标拒绝。完整Renderer/Node typecheck、strict lint、脚本治理、docs与Desktop参考边界通过。配置、认证、provider和runtime owner均未修改；新增compat/deprecated为0，直接替换固定search默认值，无双轨。

同一独立组合标准SHELL-01 24/24；原生`settings-web-search-targets-native-20261017-1`首轮整轮exit0：累计24/24、本批15/15及4/4页签，主题4/4、600px窄屏、保稿/放弃、重复打开和密钥遮罩通过。1683 IPC、错误/mock0，同一identity/turnStart=1，Main正常退出；91声明源/1376产物与sidecar零漂移、freshness两端ready；本批10份覆盖源码与原工作树SHA一致。10搜索截图和标准980px截图人工复核通过。验收基于首批冻结后端+本批源码及重建renderer/Host，不声明最新并行Rust通过。

快照准备曾遗漏图标源与PostCSS/Tailwind配置；首轮标准23/24的layout失败、未处理@tailwind的CSS与截图均原样保留，补齐原文件/时间戳后按标准入口重建，未改断言/期限/页面布局。原工作树verify:gui-smoke另因V8缓存缺失exit1，现有资产脚本已恢复并校验缓存，未重编并行Rust或宣称wrapper/default通过。新冻结收据`.lime/qc/settings-content-search/web-search-final-20261017-1/receipt.json`；仅本批100%，完整设置、公共Profile、production/live/search、参考运行、Windows/安装包与全GUI仍partial。下一刀先拆分Memory/Appearance过长presentation，再沿同一索引与导航扩展。
## 设置搜索：Memory / Appearance 内容与展示拆分（2026-10-17，已验收）

复用匹配ASAR的REA索引/导航Evidence，公开settingsSearchDocuments继续直接对齐。新增Memory开关/日常状态/口吻/模板/嵌入来源/SOUL导出与导入7项，Appearance主题/皮肤/界面语言/回复语言/推荐选区5项，累计36；这些是current页面的搜索接线，不代表参考Memory/Appearance整页或Soul业务已完整复刻。内部展示组件名称是Lime职责名，参考原始符号仍unknown。

MemorySettings由871行收敛为566行，SoulSettingsPanel/AdvancedMemorySettings只接值、翻译与回调；SOUL导入原文、预览与草稿保护留在原页面，日常笔记继续保持挂载。AppearanceSettings由993行收敛为418行，展示归AppearanceSettingsView，唯一配置、主题/皮肤事件和持久化owner不变；LanguageOption复用于界面/回复语言，删除重复类型。没有同名alias、新导航/历史/配置authority或保留差异。

12目标均聚焦非编辑外层；Memory初始页签仅接受canonical searchFocus经索引白名单解析的path，待确认期间保持局部页签与导入草稿。有效红例19失败/1通过；首次绿例50通过/1失败，是测试直接Enter选中了同名Provider章节，已改用原字段说明作查询，未修改标题优先规则。最终定向8suite105/105（含五语言、实际页面保存、隐藏笔记、异步/取消/伪造路径）和strict lint通过；完整Renderer/Node typecheck随后通过，进程证据见下方结算。证据`.lime/qc/settings-content-search/memory-appearance-20261017`；验收仍绑定既有已验收后端+本批覆盖源的独立快照，未声称最新并行Rust/default门禁通过。

最终原生`settings-memory-appearance-native-20261017-1`首轮整轮exit0：累计36/36，本批12/12、Memory3/3页签、导入预览/保稿/明确放弃与重复打开、四主题和600px窄屏通过；1757IPC、错误/mock0，同一identity且turnStart=1，Main30708正常退出、无强制回收。95源码/1481产物/sidecar无漂移，freshness两端ready，10覆盖源与原工作树后验SHA一致。标准SHELL-01 24/24、附加证据护栏8/8及格式/脚本/参考/docs边界通过；10张截图人工复核。两项辅助调用错误与首次Provider选择失败均保留，实际Vitest8/8与ready守卫复核通过，无期限/断言/状态修改。收据`.lime/qc/settings-content-search/memory-appearance-final-20261017-1/receipt.json`。仅此12目标与拆分合同100%，整页参考布局/业务和其他全GUI gap仍partial；不将冻结基线后端当作最新并行Rust或完整默认门禁通过。主题只为current skin/媒体模拟，reference/live/Windows/packaged未验。
