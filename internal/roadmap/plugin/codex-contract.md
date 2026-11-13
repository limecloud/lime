# Codex 插件目标合同

更新时间：2026-10-18。实现状态见[执行计划](../../exec-plans/codex-plugin-reconstruction.md)。本文件描述目标，未通过对应验证的条目不能宣称完成。

目录安装事实切片见 [P04b13e](../../exec-plans/codex-plugin-catalog-installed-facts.md)：
远端目录按 scope/opaque ID 关联同一账号完整 installed 快照，不索要下载 URL，不用本地
物化摘要覆盖。version 为目录版本，localVersion 为 installed release 版本，installedAt
为 Unix 秒；enabled 还受共享 plugins 配置限制。GLOBAL 补 installed-only，其余普通集合
不补；Shared 保持显式分享/链接安装分桶，空集合省略。此合同不核销目录缓存或 runtime readiness。

## 事实源

Codex 源码 `/Users/coso/Documents/dev/rust/codex`，基线 `4eb4a65407d98cebc4c83bf13be440b9fbc78a7c`。manifest/store/marketplace 参考 `codex-rs/core-plugins`，公开协议参考 `codex-rs/app-server-protocol/src/protocol/v2/plugin.rs`，技能选择参考 `codex-rs/ext/skills/src/selection.rs`。

桌面安装包 `/Applications/ChatGPT.app`，bundle ID `com.openai.codex`，版本 `26.1007.30912` / build `20156`，app.asar SHA256 为 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。REA 静态分析只覆盖所提取成员，不代表完整应用或运行验证。分享及技能预览/请求模块的成员摘要、Evidence ID、临时原件位置与限制见执行计划；旧 `.lime/qc` 证据目录已清理，不作为当前可复查原件入口。

## 包与资源

manifest 查找优先级为：声明 Agent Plugins schema 的根 `plugin.json`，随后 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.cursor-plugin/plugin.json`。无关根 JSON 不抢占原生 manifest；已声明但不支持的标准版本必须报错，不能回退原生格式。

标准 schema 为 `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`，使用固定 `skills/` 直接子目录和 `mcp.json`；其 Codex 扩展优先取 `extensions.com.openai`，其次 Codex 元数据文件。原生格式按声明的 Skills roots、MCP、Apps、Hooks 等资源加载，不猜测单一固定目录。资源解析、路径约束、默认值与错误隔离应与 Codex 对齐。

标准包缺省版本为 `1.0.0`；原生包缺省版本为 `local`。名称必须与已授权详情一致；远端 cache 版本使用 release version，按 Codex 保留非全局包原 manifest 版本，不把两种版本事实混为一谈。技能名称使用 `plugin:skill`，内部身份包含完整插件身份；选择以结构化路径和启用状态为事实源，不在 renderer 重建激活状态。

GLOBAL 在私有 staging 中将原生 manifest 版本覆盖为 release 版本，保留其其他原始字段；
受支持 portable `plugin.json` 原字节保持。GLOBAL `app_manifest` 采用完整 JSON，保留未知
字段；省略/null 不改包，显式空对象覆盖。写入取已解析 manifest 的 Apps 路径（包括 portable
inline/overlay extension），无有效路径取 `.app.json`；不得写包外。native Apps 缺省读取
`.app.json`，portable Apps 不启用组件，元数据落盘不等于 hosted access 或 runtime readiness。
USER/WORKSPACE 保留原包版本与 Apps。准备失败不进入 store 提交，原 cache/config 保持。

远端 bundle 使用 tar.gz，下载预算 60 秒、压缩上限 100 MiB、普通文件解包总量 512 MiB。
仅允许普通文件与目录，拒绝越界路径、符号/硬链接与特殊文件。LimeCore 的上传、扫描和
交付直接使用 gzip MIME 与 `.tar.gz` 对象名，删除 ZIP 分支，不迁移旧包；服务端额外的
512 entries、metadata 单文件 1 MiB/累计 8 MiB 是发布扫描配额，不代表 Codex 客户端限制。
服务端包格式通过不核销客户端或真实 Turn；P04b5 为受控服务端 tar.gz 验收，P04b6 已通过
客户端受限下载/安全物化及真实 Electron/stdio 安装、账号隔离、冷启和卸载。安装请求在
Electron Host/current DevBridge 的等待窗口为 150 秒，下载本身仍为 60 秒；模型 Turn、
实际 Core 发布闭环和完整 server installed/reconcile/share 不在上述通过范围内。

## 身份、缓存与配置

正文预览由 `plugin/model/skillPreviewQueries` 持有唯一、可丢弃的Renderer query投影：
五分钟staleTime，缓存原始nullable正文；过期重开重取，窗口聚焦不自动重取，最多3次
自动retry。有numeric HTTP status时按Desktop Bq仅重试408/425/429/5xx；状态缺失时沿
同一上限，不从文案猜HTTP状态。cloudAccount身份代际隔离换号、注销、会话变化与A→B→A，
账号变化错误立即终止；本地path仍优先走共享fs/readFile，remote-only走plugin/skill/read。
这不是安装/授权缓存，也不替代Core当前ACL。REA证据及本轮验收归执行计划P04b13c。

远端详情的技能enabled目标按installed.disabled_skill_names投影，未安装默认true；
Codex明确尚不把该远端偏好写入skills/list，本地skills.config仍为runtime启停来源。
该详情投影已由P04b13d补齐；P04b13f进一步依REA定位的端点持久化账号偏好。
不得将远端逐技能偏好误做跨仓强制runtime启停；普通技能开关UI仍需消费者证据。

旧 Lime 客户端 install-state 上报链及 bootstrap 签名可信根合同已删除，禁止用其实现远端
installed registry、renderer 安装或兼容回退。远端安装状态须按 Codex remote 合同在 current
owner 实现；服务端 release 发布校验不等于客户端安装事实。

市场来源归共享配置 `marketplaces.<name>`，字段为 `source_type`（`local`/`git`）、`source`、
`ref`、`sparse_paths`、`last_updated`、`last_revision`。本地市场引用原目录；Git市场暂存验证后
激活到 `<AgentRoot>/.tmp/marketplaces/<name>`。来源相同的重复添加幂等，同名不同来源拒绝；
删除市场只清配置与受管快照，不删除源目录、已安装插件cache或持久数据。升级单个/全部Git市场
逐项返回结果，配置或快照失败保持原状态；并发来源变化使提交失败，不覆盖新配置。

本地插件 ID 为 `name@marketplace`。安装缓存为 `<AgentRoot>/plugins/cache/<marketplace>/<plugin>/<version>`，从缓存枚举安装状态，共享配置 `plugins.<pluginId>.enabled` 决定启停，`plugins._default.enabled` 提供默认值。同名不同本地市场独立安装、启停和卸载。

远端 directory 的 backend ID 是独立的不透明身份，按 Codex 只接受 ASCII 字母数字和 `-_~`。
LimeCore 使用 `plg_` 加 SHA-256(`plugin-directory\0<name>\0<catalog marketplace>`) 的小写 hex，
不随 release、展示名或授权变化，不新增映射 registry。list/detail/registration 返回相同 ID，
详情仍从当前获准条目查找；旧含 `@` 的远端 ID 和分页 cursor 直接拒绝。Codex 将 WORKSPACE/LISTED
归入 `workspace-directory`，本地 cache 身份由 name 与 canonical market 决定；远端 ID 不碰撞不能
证明该 canonical 市场里的同名插件可共存，冲突处理继续由 P04b 跟踪。

同版本重装原子替换，失败恢复原缓存和配置。卸载删除插件缓存，持久数据遵循 Codex store 语义。标准包数据为 `plugins/data/agent-plugins/<identity hash>`；原生包数据为 `plugins/data/<plugin>-<marketplace>`。不读取、转换或清空真实用户的旧安装目录。

远端 cache base 使用 `.codex-remote-plugin-install.json` 记录 schema_version、opaque ID 与
issuer/tenant/user 的 fingerprint，不记录 token、URL 或个人展示字段。没有匹配来源记录的本地
同名缓存不得被投影为远端已安装。共享 installed 是 Skills/MCP/Hooks 的同一入口；注销、过期、
换号隐藏其他账号包，远端持久数据位于 `plugins/data/remote/<account fingerprint>/...`，不复用
另一账号数据。安装中的身份变化拒绝提交；失败保持原包和配置。本轮无旧缓存迁移或双读。
客户端现有 10000 entries 和 tar metadata/padding 32 MiB overhead 属于额外安全策略，
不能宣称是 Codex 上游限制。

## 公开协议与消费者

- `plugin/list`：`cwds`、`marketplaceKinds`、`forceRefetch`；返回 `marketplaces`、`marketplaceLoadErrors`、`featuredPlugins`（带市场位置和精确发布引用）。
- `plugin/installed`：`cwds`、`installSuggestionPluginNames`；返回 `marketplaces`、`marketplaceLoadErrors`。
- `plugin/reconcile`：可选 `reason`；返回 `changedPlugins`（旧/新声明分类并集）、`failedRemotePluginIds`、`failedMaterializationRemotePluginIds`。它不承诺 runtime readiness。
- `plugin/read`：`marketplacePath` 或 `remoteMarketplaceName` 与 `pluginName`；返回 `plugin` 详情。
- `plugin/install`：市场定位、`pluginName` 与可选 `installAttemptId`；返回 `authPolicy`、`appsNeedingAuth`。
- `plugin/uninstall`：完整 `pluginId`；返回空对象。启停走共享 `config/batchWrite`。
- marketplace、share、remote plugin 与授权能力按 Codex current 补齐，不再以旧产品范围裁决排除。

`marketplace/add` 使用 `source/refName/sparsePaths`，返回 `marketplaceName/installedRoot/alreadyAdded`；
`marketplace/remove` 使用 `marketplaceName`，返回同名与可空 `installedRoot`；
`marketplace/upgrade` 可选 `marketplaceName`，返回 `selectedMarketplaces/upgradedRoots/errors`。
CLI入口为 `plugin marketplace add/list/upgrade/remove`，同GUI/TUI经过App Server，不直读本地配置。

CLI 使用 `PLUGIN@MARKETPLACE` 或 `PLUGIN --marketplace MARKETPLACE`。GUI 与 TUI 消费同一 typed client；生成 schema、TS 类型、gateway、catalog、fixture 和守卫同时更新。禁止保留 `sourcePath` 安装、独立 enabled method 或旧返回对象作为兼容层。上述协议切换尚由 P03 跟踪，存储替换不等于协议完成。

## 唯一执行链与云端

```text
CLI / TUI / GUI -> App Server JSON-RPC
  -> plugin catalog / store / shared config
  -> immutable component snapshot -> Skills / MCP / Hooks
  -> RuntimeCore -> Thread / Turn / Item

LimeCore 发布与市场 -> 同一包和身份合同 -> 客户端 App Server
LimeCore gateway -> tenant-owned Rust App Server transport
```

LimeCore 负责发布、市场、租户与鉴权控制面，不复制 Agent loop。上传扫描验证选中的原始 manifest 字节并计算其摘要，不能把根同名文件或重序列化 JSON 当成选中 manifest。OpenAPI 修改 source fragments 后生成 bundle。

云端 release 组件摘要归同一发布记录的 typed `components`，单条/批量发布与更新、snapshot/SQL
和目录共用 owner；目录 release 展开 `app_ids/app_manifest/app_templates/skills/
onboarding_skill_name/mcp_servers/scheduled_tasks`。任务 schedule 使用上游 camelCase tagged
union（如 hourly.intervalHours），不改成外层 snake_case。非受控平台外部包省略 components
保留、显式空对象清空；内容摘要实际变化且未提供新组件时删除旧值，其下载/内容验证仍 pending。
受控上传包自动提取 Skills/onboarding/MCP key、原生 Apps 声明，绑定 package/manifest hash；
开发者审核前和平台单条创建/更新、bulk/preflight 对照，手填不一致拒绝，省略则填充。显式空对象
只清云端任务/模板，不能覆盖包内事实。标准包固定资源且不启用 Apps，onboarding 匹配实际发现
的 SKILL.md；路径、单文件/累计 metadata 预算与返回值隔离均在服务端边界验证。未发布技能
图标仅报 warning，不拼虚假 URL。摘要不是本地安装、授权或 runtime readiness。
完整 MCP/技能容错解析一致性、资源发布和客户端 HTTP/账号/安装/对账链仍由 P04b 跟踪。

远端技能正文按 Codex CLI 与 Desktop REA 的认证
`GET /ps/plugins/{plugin_id}/skills/{skill_name}` 合同实现，响应包含
`plugin_id/name/skill_md_contents`。Core P04b13a已落在当前目录授权及verified包owner，
未安装可读、普通包/分享包复用同一manifest和技能发现；返回原始正文，不签发下载URL。
托管包损坏报错；外部非托管正文不可得返回显式null是本地设计，闭源服务端内部未知。
客户端P04b13b已接线共享`plugin/skill/read`和GUI加载/重试/null/正文消费：本地path优先，
远端双身份校验及账号fence，正式协议/typed client/gateway共用唯一owner。DOM/严格TS已验，
最终正文公共JSON-RPC5/5、protocol crate142/142、完整contracts及新产物受控Electron/stdio
专项已验：未安装远端错误/重试/null/Markdown、本地路径优先、账号隔离与冷启共用store。
P04b13b普通壳历史轮exit0、24/24；P04b13c五分钟缓存的66项相关回归和真实Electron/stdio
专项已通过，最终正文GET7次及产物前后摘要一致。P04b13c当时通用壳23/24，小窗口首页输入区
越界导致布局门禁失败；此失败及未确认的included_files规则、逐技能偏好编辑继续跟踪，不以
Core测试、历史壳通过或局部专项通过核销完整正文能力。

P04b13d远端详情已替换为授权release与fresh installed分页投影：忽略调用方
marketplace label，以opaque ID及返回scope为准；installed读取不请求下载URL，也不物化包。
disabled_skill_names控制远端技能enabled，省略默认空、显式null拒绝、未安装默认true；
保留raw name、path=null及hooks=[]，已安装远端预览仍用远端正文query。本地插件详情的
真实path继续走fs/readFile。summary使用fresh安装事实与共享插件配置门禁，localVersion
遵循CLI/native的installed release版本，installedAt为Unix秒。远端偏好不改skills.config，
不改变skills/list或Turn的本地启停。P04b13d未包含偏好写入；后续P04b13f已用REA定位
四个启停端点，Core安装事实保存真实偏好，GUI远端开关经cloud/request写账号事实。
普通技能开关UI仍未完成。远端插件54/54、分享RPC7/7、完整
contracts及WORKSPACE/GLOBAL两组真实Electron＋stdio专项已过；同一冻结整合产物的通用GUI
24/24（含小窗口布局），4,642项完整产物原字节留存、前后摘要一致。测试及产品证据归同名
执行计划，不代表后来共享dist或真实Core/MySQL/Turn已验。

旧私有包 schema、独立 worker/runtime、renderer registry、v3 installed records 与旧规则为 `dead / deleted / forbidden-to-restore`。历史资料从 Git history 追溯。完成验收必须覆盖两仓包发布/下载、安装、真实 Turn 和三端消费；unit、stdio、CLI、PTY、Electron 与 Windows 证据分别报告。

## P04b9 远端 mutation 事务

Codex `core-plugins/src/remote_mutations.rs` 先验证、下载和物化包，再提交安装mutation。
Lime复用唯一PluginStore，把校验后的私有staging、远端POST确认和cache/config提交分开；
坏包不产生云端安装，远端错误不替换旧包/config。POST必须匹配opaque ID与enabled，
install_attempt_id使用snake_case，includeAppsNeedingAuth=true；uninstall先远端确认再本地删除。
跨进程gate先于store锁，换号后不提交。真实stdio/GUI、全scope installed对账、远端已提交
但本地提交失败的恢复、connector授权仍单独欠账，不能用mutation测试核销完整对齐。

P04b10 installed对账：共享App Server新增Codex同名plugin/reconcile，完整分页/身份验证后在
唯一PluginStore发布按账号隔离的无凭据安装投影。同版本保留、新版本复用tar.gz事务，清理
失败不恢复撤回插件的runtime可见性；本地override保留、显式mutation同步投影。字段、失败
分类、定向验证与真实产品缺口唯一记录在执行计划P04b10。plugin/share五方法已由P04b12c/d
接通同一store/account owner，checkout另有受控Electron/stdio可见与冷复用证据。基础分享GUI
已沿同一typed gateway实现首次PRIVATE创建、现有权限保存、复制链接、同ID版本更新、
checkout/编辑路径和撤销；P04b12d1真实Electron点击/五RPC及原生复制读回与恢复已通过，
依赖为受控Core形状HTTP及unavailable Turn backend。人员/组目录搜索与新增邀请、
组成员editor能力投影、非creator checkout冷重开定位、完整正文缓存/参考文件和真实Core同包Turn
仍planned。开发期缺少实现不作为excluded理由。

分享链接解析另归P04b12d2：Desktop REA显示认证`GET /ps/plugin-shares/{share_key}`读取
plugin_id再导航现役详情。Core当前share_url是API详情，复制成功不能核销链接访问闭环；
key生成/生命周期尚未观察，不假定任意shareKey等于插件ID，不引入旧URL兼容层。

P04b11b workspace 权限：catalog.directory 拥有 discoverability 与 targets，group 复用真实
Organization/OrganizationMember；private、unlisted链接访问、显式 shared 和 creator分享列表
分别授权，详情/安装/installed 重验撤权。Core owner-only ACL 与租户管理员发布门槛是设计
选择，上游源码证明 wire 与 bucket 合同。App Server 接入 SharedWithMe/vertical，PRIVATE/
UNLISTED 统一 canonical workspace-shared-with-me，两种展示桶不建立独立缓存；metadata
进入 PluginShareContext。范围、实际验证与剩余产品证据见执行计划，不能据此核销 share
上传/checkout/正文/cache/GUI 或完整目标。
