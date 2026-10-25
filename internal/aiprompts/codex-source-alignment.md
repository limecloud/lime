# 上游源码复制与 Lime 迁移准则

本规范执行根目录 [AGENTS.md](../../AGENTS.md) 的核心准则：复刻范围内能复制就复制，能整目录复制就整目录复制。上游事实源为 `/Users/coso/Documents/dev/rust/codex`；在许可证允许、目标能力属于 Lime 且依赖闭包可接入的前提下，默认复制实现及其目录、文件、模块、类型、函数与测试，不以逐文件手写或重新抽象代替复用。Lime 的产品边界优先于上游一致性，边界内的无品牌名称与组织沿用上游原样。

对 Codex 的第三方目标集成（例如技能包装到 `~/.codex/skills`、提示文件 `~/AGENTS.md`）按外部应用契约保留；这不授权把 Codex 品牌用于 Lime 自有产品、runtime 或发布。

禁止建立或恢复 `lime-rs/upstream/`；整树副本只允许作为一次性取样输入。现役复制目标是 `lime-rs/crates/**` 的唯一领域 owner，迁移完成度以真实消费者、编译图和 Gate B 证据为准，不以副本数量或摘要一致代替。目录删除、消费者切换和平台验收的实际状态记录在执行计划，不写成长期规则中的完成结论。

复制完成后按最小依赖闭包、Lime 品牌和服务端边界裁剪无消费者内容。“整目录复制”指直接迁入现役 owner 的批量迁移动作，不指保留 `upstream/` 或其他第二源码树。

GUI 同样执行复制优先：公开源码能复制的实现直接复用，缺失的 Desktop 实现按指定版本的 REA 证据还原页面结构、布局、交互和状态。明暗模式通过固定语义颜色接入，不以旧组件、旧设计规范或原型图改变复刻目标。规则入口为 [GUI 复刻事实源](design-language.md) 与 [lime-design-language](../../.codex/skills/lime-design-language/SKILL.md)；设计图服务于表达原版，不充当原版证据。

## 复刻注意项：Lime 保留边界

| 边界          | 必须保留的 Lime 能力                                                                    | 复制时的处理                                                                          |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 多模型/多协议 | Provider catalog、模型选择/切换、readiness、路由、retry/circuit breaker 与媒体 lowering | 复制 runtime 与工具行为，模型访问继续走 Lime `model-provider`，不收窄为上游单模型链路 |
| 产品品牌      | Lime 产品名、Logo、命令、bundle/package、配置根、扩展/加载项与发布标识                  | 仅适配带上游品牌的名称，无品牌的路径、文件、模块、类型与函数原名保留                  |
| 自有服务端    | Lime 认证接入、服务端协议、配置、Provider 控制面与发布合同                              | 接入现役 owner；不引入 Codex 登录、Cloud、账号、遥测、计费、发布或服务控制面          |

此处“不能使用 Codex 服务端功能”指 Codex 产品服务与其控制面，不排除公开源码中的本地 App Server JSON-RPC、runtime、协议、持久化和工具实现。后者是共享主链的复制目标，不能因名称包含 `server` 而误删；需要上游云服务的调用应裁剪或接到 Lime 现役边界，不能恢复第二套服务端。

复制前在迁移账本中记录以上边界的 current owner、消费者、保护写集和必要适配。共享 workspace manifest、锁文件、配置、schema 注册表、Provider catalog 与发布文件只做最小合并，生成物沿用 Lime 现役流程；目录内混有上游产品服务时，先确定排除路径和调用点，再批量迁移可复用部分。

复制后分别检查品牌和服务依赖：除产品名、路径与符号外，还要核对默认 endpoint/base URL、认证与凭证读取、远端功能开关、遥测上报、升级与发布入口，确保没有接入 Codex 产品服务或留下回退调用。必要的模型访问继续由 Lime `model-provider` 与现役配置决定；明确支持的第三方集成按独立外部契约登记，不能成为导入 Codex 控制面的理由。

协议能力、本地执行和远端托管服务分别判定。例如 Responses custom tool 在 Lime host 执行，不能仅因 endpoint 不是官方域名而禁用；仍须由模型目录显式声明能力，并与实际 wire 支持求交集。远端托管搜索、图像生成等功能继续服从各自的服务合同，不能因启用本地 custom tool 一并放开。复制或适配时同步迁移锁死旧域名假设的测试，保留无能力、无授权及不支持协议的拒绝路径。

消费者切换前，以现有定向验证证明多模型/多协议、品牌、自有服务端和发布合同仍由原 owner 提供；有缺口就记录阻塞并修复接线。发现与保留边界冲突时缩小复制闭包，不覆盖 Lime 特色，也不以外观、多模型或服务端适配为由重写整套可复用实现。

Computer Use 的共享事实源是 `lime-rs/crates/app-server-protocol/src/protocol/v2/computer_use.rs`，不是某个桌面、插件或 CLI 的私有命令。三类适配器固定为 `native`、`chrome`、`office`；每个请求都要绑定目标身份、能力、授权范围和 epoch，并通过 `computerUse/status`、`computerUse/setup`、`computerUse/revoke`、`computerUse/lease/acquire`、`computerUse/lease/release` 进入同一 App Server。首版必须保守返回真实状态：未安装、未连接、需权限、需设置、阻断或更新中都不能渲染为 `ready`。只有真实适配器完成设置且授权覆盖目标与能力时才发放 grant；缺少适配器、授权、目标匹配、能力或有效 epoch 时拒绝 lease，撤销必须让既有 grant/lease 失效。该合同可以先落协议与 schema，但在 handler、真实 helper、Chrome host 或 Office session 尚未接通前，不得宣称能力已可用。

## Computer Use 方案与验收入口

方案入口为：[总执行计划](../exec-plans/codex-chatgpt-native-computer-use-20261025.md)、[PRD](../exec-plans/native-computer-use-prd-20261025.md)、[架构与图表](../exec-plans/native-computer-use-architecture-20261025.md) 和 [交付与验收计划](../exec-plans/native-computer-use-delivery-20261025.md)；当前实现、测试与平台 Gate B 结果统一见 [实施记录](../exec-plans/native-computer-use-implementation-20261025.md)。REA 原始证据和专题报告固定在 [REA 原始证据目录](../../.lime/verification/rea-native-computer-use-20261025/)。方案、静态分析、截图和浏览器投影只能作为来源或 Gate A 证据；公开源码不可得记录 `source-unavailable`，尚未实现或未运行的验收项记录具体缺口及 `blocked` 原因，两类状态分别记账。

## 复制决策

- **优先整目录复制**：当源目录的许可证、功能归属、消费者和依赖闭包均已确认，使用 `rsync -a` 或等价目录复制一次性迁移文件、子目录、模块、类型、函数、测试、生成物和必要许可证文件；不得把逐文件手写重构当成默认路径。
- **复制到现役 owner**：复制目标必须是 `lime-rs/crates/**` 或已确认的 Lime 现役宿主目录，不能写入 `lime-rs/upstream/`、`candidate/`、`vendor-upstream/` 或第二 workspace。
- **复制后裁剪**：整目录复制只解决迁移完整性，随后按最小依赖闭包移除无消费者代码，以及 Codex 登录、Cloud、账号、遥测、计费、发布、单模型服务端和品牌入口；不得为保留目录结构而引入这些能力。
- **命名与边界**：无品牌的路径层级、目录名、文件名、模块名、类型名和函数名默认与上游一致，不做无必要的重命名；`codex-rs`、`codex_`、`codex-`、`CODEX_` 等 Lime 自有品牌标识必须适配并登记源名到目标名的映射，不要求给所有领域名称加 `lime` 前缀。上游协议固定值、许可证署名和审计文件中的来源名称必须登记理由，不能扩散为 Lime 产品品牌。
- **共享文件最小接线**：现有 workspace manifest、锁文件、配置、schema 注册表和 Provider catalog 不能被上游整文件覆盖；按依赖变更合并并使用 Lime 现役生成流程更新生成物。整目录复制不授权覆盖并行进程的未知改动。

## 纳入门槛

1. 先记录上游 revision、文件许可证和目标能力。许可证不明、禁止再分发、依赖未满足或属于上游专属产品/服务的内容不得复制。
2. 从 Lime 的真实入口出发，运行 workspace metadata、定向编译与测试，识别最小完整依赖闭包。只迁移消费者实际需要的包、资源和测试；上游未使用的 CLI、账号登录、Cloud/远程控制、遥测或发布工具不因处于同一个 workspace 而自动纳入。
3. 代码落在 `lime-rs/crates/**` 的现有领域 owner；不创建整仓镜像、`upstream/`、`vendor-upstream/` 或第二 runtime。能力接入后删除重复 Lime 实现，不长期保留并行 owner。
4. Lime 自有产品身份采用 Lime 品牌，无品牌的领域名称沿用上游。迁移内部 `codex_`、`codex-`、`CODEX_`、Codex 产品文案、可执行名、crate 名及 Lime 配置路径时，逐项同步代码、依赖、schema、文档、fixture 与测试。`.codex` 等第三方官方目录、`codex` 技能包目标和 `AGENTS.md` 等明确集成契约必须保留；逐项记录其消费者，不将它们引作 Lime 自有产品标识。
5. 保留上游许可证要求的版权与许可证文本。许可证署名是法律通知，不作为产品品牌、UI 文案或运行时身份使用。

6. Lime 的品牌、多模型/多协议、Provider catalog/readiness、服务端协议和发布合同属于 Lime current owner，迁移 Codex runtime 或 Computer Use 时必须保留并复用；Codex 的登录、Cloud、账号、遥测、计费、发布和单模型服务端能力不纳入 Lime 依赖闭包。

7. Computer Use 的验收面是 macOS 原生桌面、Windows 桌面、CLI/TUI、Chrome Plugin 和 Office connector。桌面行为必须有 REA 安装包证据；Chrome Plugin 必须记录扩展权限、Native Messaging host、browser service、session/turn 绑定和授权拒绝路径；CLI 必须在 Electron 退出后用真实 stdio App Server 验证同一 Thread/Turn/Item 投影。Office 的 setup、目标确认、focus 与文档工具读写按独立 session 生命周期验收，未观察到的 transport、注册或鉴权不得写成既定事实。

8. Computer Use 方案交付必须同时落库 PRD、架构图、时序图、流程图、跨平台适配器矩阵、权限/授权矩阵和失败路径；图中必须标出 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item` 主链、唯一 owner、取消/撤销/租约边界，以及 Electron 退出后的 CLI 路径。方案文档只能引用已保存的 REA Evidence ID、源码 revision 或真实运行 transcript；截图、静态字符串、浏览器投影和设计图不能单独升级为 Gate B。

## 消费者迁移

1. 从 Lime 当前真实入口出发，迁移到单一现役 owner；保留多模型、多协议、品牌、自有服务端与 Provider 边界、专家广场、消息渠道及必要桌面宿主/平台适配。
2. 上游不存在的 Desktop 能力必须使用 REA 安装包证据，作为 Lime 适配实现；不得将自研实现、压缩符号或推测名称标成源码复制。
3. 消费者切换并由测试证明后，删除被替代的 Lime 重复实现、旧入口和失效测试；不新增 alias、长期包装、平行 runtime 或只用于绕过编译的 compat 层。
4. 若依赖闭包包含 Lime 不需要或不能复用的上游产品功能，应在 Lime owner 中移除其调用/依赖，并把真实 Lime 消费者的编译与行为测试作为退出条件；不得为了保留整仓而把上游产品入口带入 Lime。

## 记录与验收

每个迁移记录上游 revision、源路径、许可证、纳入与排除理由、Lime owner、依赖闭包、品牌/宿主适配、删除项、验证和未完成依赖。整树取样可以作为一次性迁移输入，但不得进入 Lime workspace、构建图或文档导航；`lime-rs/upstream/`、`vendor-upstream/` 和其他镜像目录在收口前必须删除。未接入、未编译或未运行的部分必须保留为缺口，不能以“副本存在”代替完成度。

本轮 Computer Use REA 证据仅作为来源与验收边界，不能当作已接入产品的证明：

| 范围                          | Evidence ID                                                           | 可支持的结论                                                               | 明确限制                                                          |
| ----------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 外层应用 plist                | `ev_9cf57c876c2bd7647e1323e3f526c30c310c09baaf2c2ca6037badc63a5a4312` | 外层应用 bundle、版本和产品身份                                            | 不证明 Computer Use 组件运行或授权                                |
| 主 ASAR                       | `ev_a4c477f418d2903b8392f1fd4ba7e9fe3bc165f00f90bc406d9dc8cb8e2f92ae` | 主进程、preload 与选定 Computer Use 入口的完整性收据                       | 选定文件静态图；不证明动态 IPC 或完整调用图                       |
| macOS native service plist    | `ev_9141ee40795701227548bcc22ea55e7daa517c5cbfd47730d987a747b138bdf8` | native service 身份、版本和系统门槛                                        | 不证明服务已启动、TCC/AX 已授权或输入可用                         |
| macOS 原生 JS/IPC             | `ev_d9e2d884118e689f322e82efdb170b48e39d07dc22b5306daba86493c5d1f438` | 发货 JS 的 native pipe、版本握手、动作 schema 和状态读取形状               | 选定文件静态图；未证明运行输入或完整 native 调用图                |
| macOS native helper           | `ev_4feb83280d872a524203ff290b7f32f9f2a93cdcd80137309c86a059bd410cfd` | AX、屏幕捕获、窗口与 Node-API 相关导入存在                                 | 不证明最终输入注入、TCC 已授权或跨 session 隔离                   |
| macOS 签名                    | `ev_c4e3c4a8a39c5d1838e2cb1dff726d0a9dce290105590050fc9ac2f88d221576` | 服务签名元数据与 hardened runtime 观察结果                                 | REA 签名不等于系统公证、在线信任或可运行                          |
| Chrome 插件/服务              | `ev_eb342d0b8a930aa1d20ea1e43f104636af0bbc6958106eb9f343d8e027600cb5` | browser service、扩展 ID/host 配置和权限分层的选定静态证据                 | partial graph；扩展 manifest、service worker、Windows host 未验证 |
| Chrome Native Host            | `ev_817e6183d45656e79e8acc5f9a6faa3dd69cd38169456adddf4f55f43c3fffad` | `AppServerProxy`、proxy listener 等导出符号存在                            | 符号不证明请求鉴权或真实 stdio 运行                               |
| Chrome Native Host 签名       | `ev_233c2b587a48134af0f42f1459df697ec63d74126a56abbe9b446697e5582022` | Native Host 签名元数据                                                     | 不证明 Windows 注册、在线公证、请求鉴权或运行成功                 |
| Office/Excel 设置与 connector | `ev_f4742a160c83eeb9cbfd68b9202fd4be76feeb8b3de339eb18e1a26387298fe0` | 三个 Office 行共享 connected-document app 配置及 setup/schema/command 契约 | 未运行 Excel、未观察 add-in transport、注册、鉴权或 live workbook |

证据原文和有界检索报告固定保存在 `.lime/verification/rea-native-computer-use-20261025/`；产品代码不得依赖该目录运行，也不得把其中的上游品牌、bundle id 或 host 名称复制成 Lime public boundary。Windows 原生行为、四端 Gate B、Electron 退出后的 CLI、Chrome 扩展真实权限和 Office live session 在对应证据产生前都必须标记为 `source-unavailable` 或 `blocked`。
