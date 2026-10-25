# Codex GUI 复刻与 Lime 适配

状态：current。用户复刻要求校准：2026-10-25。

## 目标与范围

Codex 原版是 GUI 复刻基线。页面区域、布局、控件顺序、尺寸比例、信息密度、交互、状态和代码组织均按源码与指定安装包的 REA 证据还原，不自主设计另一套 Lime 界面。现有 Lime 页面、组件、命名和 snapshot 不能覆盖原版；妨碍复刻的实现直接重构或替换。先完成复刻，再优化。

源码执行 [整目录复制准则](codex-source-alignment.md)：能整目录复制就整目录复制，能整文件复制就整文件复制，带上实现、测试、资源和依赖闭包；不能把“最小闭包”解释成先逐文件手写。复制后再按 Lime 保留边界裁剪，直接接入现役 owner，删除冲突实现。不得创建 `lime-rs/upstream/` 或其他长期镜像产品树。

Lime 保留边界如下；对应能力继续使用现役 owner：

| 差异       | current 落点                                                 | 边界                                                                 |
| ---------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 外观       | `src/lib/appearance/themeMode.ts`、`colors.css` | 只保留浅色、深色、跟随系统，固定 Radix 中性色和状态色；皮肤已删除 |
| 多模型支持 | 既有模型选择、App Server catalog、`model-provider`           | 保留 provider/model/capability 路由，不复制 runtime 或配置 authority |
| 品牌       | 现役产品标识、Logo、命令、配置根与发布身份                   | 对上游品牌做必要适配，不改变无品牌领域名称                           |
| 自有服务端 | 现役认证、服务端协议、配置与 Provider 控制面                 | 不引入上游产品服务；本地 App Server、runtime 和工具仍优先复制        |
| 专家广场   | `src/components/experts/`、既有专家目录与启动链              | 保留目录、详情、启动及 Thread profile/metadata，不建立第二 runtime   |
| 消息渠道   | `src/components/channels/`、App Server gateway/channel owner | 保留渠道配置、登录、连接和收发链，沿同一 runtime 执行                |

2026-10-25 用户进一步取消视觉主题保留例外：自定义主题、皮肤和首页装饰整链删除，保留多模型及用户明确保留的专家广场和消息渠道。Codex 没有的功能整链删除；创作场景主题不属于视觉主题，首页 Banner 不再享有独立例外。

Lime 品牌、自有服务端、认证接入与发布合同也必须保留；不接入 Codex 登录、Cloud、账号、遥测、计费或产品服务控制面。公开源码中的本地 App Server、runtime、工具和持久化仍是复制目标。其他差异进入复刻清单。缺少证据时仅补查影响当前切片的部分，记录 unknown / gap / not-run，不将旧界面或自拟设计当成原版，不自动增加保留项。

## 参考证据分工

| 要回答的问题                                                                | 证据来源                                                        | 限制                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Desktop 布局、交互、模块、导出和数据流                                      | 指定安装包的 REA ASAR / JavaScript 分析；已获准的运行观察       | 静态分析不证明实际点击结果；压缩代码可能无法恢复原始名称       |
| 协议、runtime、Thread/Turn/Item、审批、工具、MCP、Skills、Multi-Agent、恢复 | `/Users/coso/Documents/dev/rust/codex` current 源码、协议与测试 | 公开 Rust 仓库不包含 Desktop 前端源码；TUI 布局不充当 GUI 基线 |
| 多模型控制与 provider wire                                                  | 根 `AGENTS.md` 和 [architecture.md](architecture.md) 指定的参考 | 仅提供模型机制，不改变业务主链和 owner                         |
| Lime 实现正确性                                                             | 当前源码、定向测试、对应进程与平台证据                          | 旧报告和上游静态代码不证明当前 Lime 已实现                     |

用户要求 REA 复刻时，使用 `reverse-engineer-anything` 的实际能力，记录目标版本、摘要、Evidence ID、提取模块和分析覆盖限制。复用匹配的已有证据；只有具体问题未回答时继续聚焦分析。没有 source map 时，chunk 名、压缩局部符号与原始开发源码名称必须分开记录。

## 结构、命名与所有权

唯一业务主链：

`Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection`

Desktop 与 CLI/TUI 共享协议、runtime、持久化和工具 owner。Renderer 只拥有布局、输入事件、焦点、滚动、局部显示状态与 canonical projection 的消费；不拥有审批 authority、工具执行或第二份历史 store。

每个实施切片建立映射：

`上游 revision/源路径/许可证 -> 纳入或排除理由 -> Lime current owner/消费者 -> 必要品牌与宿主适配 -> 调用者迁移 -> 重复实现删除 -> 验证证据`

- 属于 Lime 产品且可合法复用的实现优先整目录/整文件复制，复制后按真实依赖闭包裁剪。无品牌路径、目录、文件、模块、类型和函数名沿用上游，不因偏好重命名或先重写；带 Codex 产品品牌的自有入口按 Lime 边界适配。
- 保持 Rust/TypeScript 的语言惯例；不同平台的适配职责在计划中解释，不伪造逐字同名。
- 压缩变量、chunk hash、推测的组件名称不能作为命名事实。
- 迁移替换既有 current owner 时同步迁移消费者并清除原实现；不保留同义包装、双轨实现或平行 read model。外部不可变协议字段与法律署名逐项记录证据，不将它们作为 Lime 产品命名继续扩散。
- 结构调整先核对 [architecture.md](architecture.md)。重大 owner/边界变更同步架构图与责任开发者确认；未确认不得写完成。
- 接近 800 行先拆分职责，超过 1000 行不继续堆业务逻辑，除非计划已记录退出条件。

## GUI 结构与行为

2026-10-18 的 `rail-with-contextual-sidebar` 是已有截图与提取记录中的历史映射，不是可以覆盖原版的新设计规范。当前任务按指定 Codex 版本的真实导航、折叠、上下文列和页面状态复刻；若新版证据不同，更新实现和过期测试，不守住旧布局。已有静态合同及限制见 [feature navigation 证据](../exec-plans/artifacts/codex-shell-layout-rea-20261018/sidebar/feature-navigation/report.md)。

导航、会话页头、时间线、Composer、审批、队列、历史恢复、Files、Changes、右侧面和设置以可确认的 Desktop 结构与行为为基线。尺寸与密度随窗口适配，不强制套固定宽度、卡片墙、统计摘要或“3 到 7 步”导轨。

当前工作对象、运行状态、主动作和阻塞恢复必须清楚。状态由同一 canonical identity 投影，不能让时间线、页头、Composer 与右侧面各自猜测业务完成态。

重点验证：

- 时间线：稳定 thread/turn/item key、动态高度、viewport virtualization、滚动锚点、历史 prepend、流式尾随、展开与焦点保持。
- Composer：Controller 唯一 ProseMirror 文档，View 事务回交；file/skill/plugin/paste atom、JSON 草稿、UTF16 选择区与 UTF8 发送范围各自保持语义。首页/会话共用草稿 owner，start/steer/queue 共用 typed submission；接受前锁定重复提交，失败保留完整输入，旧 receipt 不清新 revision。附件、模型/reasoning、停止、队列和键盘历史同时验证，不只对齐输入框外观。
- 输入法候选确认及 compositionEnd 属于编辑，不能隐式发送；另一次普通 Enter 或显式按钮按当前提交合同处理。清空、替换或卸载草稿后，旧附件读取的成功与错误不得回流到新草稿；首页和会话复用同一生命周期原语。
- 审批：完整操作与权限详情、可用决定、pending/resolved 状态和重复响应防护；自动审查详情与等待用户审批分别核对。
- Files：空文件标签展示工作区文件树和源码预览；选择路径进入相应文件标签。Changes：委托既有 diff owner，正确关联路径与 patch，保留审阅、inline/split 和返回路径。两者使用独立标签，不以 Git 列表代替文件浏览器；具体身份与原件证据见 [侧栏合同](../exec-plans/artifacts/codex-shared-page-header-20261018/thread-controls/thread-side-panel-contract.md)。
- 右侧面：使用既有单一 host/registry，切换、关闭和恢复遵循同一可见状态；不重复建 browser、terminal、artifact 或 subagent owner。

## 主题与视觉样式

2026-10-25 用户明确的设计约束适用于现役页面：文案不以“·”分隔；移除冗余说明、装饰眉题与重复标题。
用语应符合开发者工作台的使用场景，简洁、准确，避免随意造词。颜色统一由 Radix Colors 色阶映射到
现有语义 token：1–2 背景、3–5 交互表面、6–8 边界、9–10 实色、11–12 文字；浅深模式使用固定中性色及语义状态色。
线条和边框使用 0.5px；页面字号优先 12/14/16px，最多四档。用字重、间距与留白组织层级，保持光学对齐与
嵌套圆角同心，减少圆角、阴影、带色左边线和装饰性动画；确有需要的过渡使用 ease-out，250ms 为起点。
选择只放在用户原本要作决定的位置，不新增模型能力保存等额外判断流程。原版区域与交互仍按已有证据复刻。

固定的明暗模式承接外观 token。原版决定页面区域、层级、控件位置、入口顺序、尺寸比例、信息密度和交互；主题不能成为改变这些内容、保留旧布局或新增卡片的理由。需要时改造现役组件的 token 消费，不让旧组件约束复刻。

使用 `src/lib/appearance/`、`src/index.css` 和目标区域既有语义 token；优先复用 `--lime-*` 及 `--background`、`--foreground`、`--card`、`--border`、`--primary` 等已定义 token。不要用固定浅色背景覆盖深色模式。

- 主次层级靠布局、排版、留白与语义色建立，避免重复标题、多层套卡和竞争进度入口。
- 正文和操作须在浅色、深色、跟随系统模式 下清晰可读；强调、焦点、禁用、错误等状态语义保持一致。
- 首页按用户截图保留中央 Lime icon、简短标题与底部 Composer，不恢复皮肤插画、Banner 或装饰槽。
- 透明、磨砂、渐变或阴影由可确认的原版交互决定；不默认新增，也不以旧硬性禁令阻止目标复刻。

## 文案与可访问性

开发工作流可以显示模型、Skills、MCP、工具、Git、权限、审批等用户需要选择或检查的产品概念，不强行替换为内容生产流程术语。Runtime、Gateway、mock 等内部实现只在有助于诊断时出现。

用户可见文案覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`。保持中文自然排版，避免英文大写或 tracking 主导页面。按钮、菜单、弹窗、键盘和焦点均有明确可访问语义；虚拟化不能使当前交互条目消失。

## 清理与验证

旧组件、hook、状态副本、命名、文档入口、fixture、snapshot、测试和护栏与调用者一起迁移或删除。有效风险在 current owner 继续覆盖；不能为了过期测试或扫描规则保留旧布局、旧接口或第二份后端。

验证按 [quality-workflow.md](quality-workflow.md) 选择：定向行为测试、五语言与关键 DOM 回归、受影响 current fixture、GUI smoke、对应 Gate B。静态分析、浏览器 Gate A、组件测试与真实 Electron Gate B 分别报告。

执行进度见 [Codex GUI current 对齐计划](../exec-plans/codex-gui-alignment-current-plan.md)。规则更新不代表产品完成；计划须列出本轮替换、清理、证据、未完成项和下一刀。
