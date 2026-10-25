# 上游源码筛选与 Lime 消费者迁移

状态：active / partial。责任：root。2026-10-25。

## 最新纠正（优先于下方历史路径记录）

用户最新要求不是把整树换个位置：不能因“能复制”而默认全量复制；Codex 专属产品品牌、入口和无 Lime 消费者的内容必须清理。Lime 自有代码、命名、配置、命令、路径、UI 与产物不得伪装成 Codex；有明确消费者的第三方目标集成（包括 Codex 技能包写入 `~/.codex/skills` 和 `AGENTS.md` 提示文件）必须继续支持，它们是外部应用目标，不属于 Lime 品牌。法定版权/许可证文本和有证据的不可变外部协议值单独保留，不参与产品身份。根 AGENTS 与本计划已据此修订。

2026-10-25 校正执行：恢复 `AppType::Codex` 与 `SkillPackageApp::Codex`，保留 `~/.codex/skills`、`~/.codex` 配置及 `~/AGENTS.md` 外部目标；Lime 自有配置独立归 `AppType::Lime` 和 `~/.lime`。Codex Web 跳转不是本地目标集成，已从 Lime 任务位置菜单移除。

本次验证：Lime Core 外部目标解析测试通过 1/1；任务位置与技能 Hook 前端测试通过 17/17；`npm run typecheck` 通过。App Server 技能目标测试未能启动：依赖构建遇到 rusty_v8 150.4.0 预编译包 HTTP 404，以及工作树中 `ComputerUseGrantScope: Default` 编译错误；这些非本写集问题未在本次改动中处理。

本段新增清理写集：合并 Lime 自有的重复 Responses 协议标识，统一 Lime 内部 DTO 命名，并对源树中的品牌词按“产品命名 / 外部 wire 值 / 许可证与审计证据”逐项分类。不得用全局替换改动真实外部协议值、模型 ID 或来源账本；不属于 Lime 消费者的上游专属实现从纳入范围排除，而不是改名后带入。

`lime-rs/upstream/` 当前不存在，且不得恢复。历史完整副本摘要只作为最初取样记录，不代表当前保留范围或品牌清理完成。`execpolicy` 已迁入 `lime-rs/crates/execpolicy`，新增 `utils-absolute-path` 作为必要依赖，CLI 消费者已改接 Lime workspace。下一步核对并清理这条消费者闭包中的配置根、环境变量、符号和示例，再按真实 Lime 消费者继续筛选其他能力；无消费者或不适用的上游产品代码保持排除。

本轮只读盘点：上游 Cargo metadata 有 168 个 package；`codex-mcp`、`codex-config`、`codex-app-server`、`codex-cli`、`codex-tui` 与 `codex-utils-string` 六个技术闭包的 union 为 152 个 package，另有 16 个不在该技术闭包内。这仍不是 Lime 纳入清单：闭包包含 Codex 专属账号、Cloud、发布及其他产品能力，必须结合 Lime 现役消费者重新筛选。已经接入的 CLI execpolicy 目前仍指向复制树，旧 `lime-rs/crates/execpolicy` 也仍存在，构成需要收敛的重复 owner；未改动这些消费者及目录。

旧验证只证明原始镜像中的指定上游目标曾可编译/测试；它们不证明筛选后的 Lime 依赖、品牌适配、用户行为或产品入口通过。下一步先确认最小 Lime crate 与外部固定值清单，再把第一条 execpolicy 消费者迁入现有 `crates/execpolicy` 并清掉重复实现；Browser/Host/协议等现有改动保持避让。

## 已确认目标

历史上曾要求先完整复制 `/Users/coso/Documents/dev/rust/codex/codex-rs`。该范围现已纠正：不再整仓保留，按 Lime 消费者和许可证逐项筛选。多模型/多协议、视觉主题、专家广场、消息渠道的保留范围不变。

整树取样曾暂存于同一原仓库内的 `lime-rs/upstream/`，但该目录不再作为迁移基线或产品路径；只保留机器收据、许可证和审计报告中的来源信息。现役 `lime-rs/crates/` 仍运行旧主链；迁移后原实现删除，不新增长期双轨 backend、runtime 或 read model。

## 复制收据

- 上游 revision：`970111f6cb62cc02fe36a82ea7d71b37a2889c97`，复制时该源树无未提交修改。
- 整目录 `rsync -a` 复制，保留符号链接；未对复制后的源码逐文件改写。
- 8,984 个源文件/符号链接、88,021,971 字节常规文件；逐文件 SHA256/链接目标核对，差异 0。
- 只排除构建/宿主缓存：target、node_modules、Python 缓存、.DS_Store；原树实际没有命中被排除目录。
- 完整路径、摘要、上游身份及品牌边界见 [机器收据](../refactor/codex-source-baseline.json)；原始许可证随 [许可证副本](../refactor/codex-source.LICENSE) 保存，不改上游署名。
- 复制时曾暂用根级 `codex-rs/`，用户补充品牌约束后已整目录移动到 `lime-rs/upstream/`，未保留另一份源树。第一次网络检查因此中断；最终检查只使用新路径。

## 顺序与退出条件

| 阶段               | 当前结果                                                   | 退出条件                                                                                   |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 源码筛选           | 第一条 Lime 消费者闭包已筛选；整树镜像不存在 | 其余能力逐项审查许可证、Lime 产品范围和真实消费者，不纳入无消费者/专属服务代码             |
| workspace/依赖闭包 | execpolicy 与绝对路径依赖在 Lime workspace；定向测试通过 | 其他迁移项的最小闭包可解析、编译并由 Lime 行为测试证明                                  |
| 品牌适配           | execpolicy 仍有配置根/CLI 环境命名残留；全仓清理进行中 | Lime 自有路径、入口、schema、文案和产物清除 Codex 标识；仅有证据的法律/外部值保留      |
| 消费者迁移         | CLI execpolicy 已指向现有 Lime crate；其余主链逐项筛选 | App Server、Desktop Host/Renderer、CLI/TUI 均消费唯一 Lime owner                       |
| 冲突清理           | execpolicy 旧实现已替换；其他 owner 待审查      | 删除实际重复实现、无消费者代码和失效测试/guard，不保留双轨 owner                        |
| 产品验收           | execpolicy crate 定向测试已通过；全仓主链验收未完成 | contracts、GUI smoke、真实 Electron/CLI/TUI、平台与打包产物按受影响范围取得证据          |

## 写集与架构确认

本轮准则写集为 `AGENTS.md`、`internal/aiprompts/codex-source-alignment.md`、本执行计划及复刻 skill；源码副本、Cargo 消费者和浏览器产品文件尚未由本写集改动。既有工作树中浏览器 Host/协议/设置/网络策略改动保持避让。下一段消费者写集须直接认领现有 `lime-rs/crates/execpolicy` 与 CLI 的依赖/导入/测试，再删除旧平行实现；不得覆盖现存 Browser/App Server 协议修改。原始整树与机器收据仅作历史取样记录；并行删除流程完成后必须回读并复核无残留引用。

Architecture impact：major / 迁移实施中。用户已明确要求整树基线和按编译闭包迁移，root 确认本阶段只引入源码与构建事实源，不启动第二业务服务。当前运行链仍为 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection`；消费者切换必须保持唯一 authority。架构地图同步记录，未完成主链切换前不写整体完成。

## 验证合同与阻塞

以复制后的原 `Cargo.toml`/`Cargo.lock` 运行真实 Cargo。`cargo metadata --no-deps` 只证明 workspace/path 关系，不能替代依赖解析、编译、测试或产品运行。离线首检缺少原锁定 crossterm Git revision，随后按上游锁文件联网拉取；不换版本或手写替代实现。

整树 `codex-mcp` check、`codex-app-server / codex-cli / codex-tui` check 均真实 exit0；`codex-utils-string` 原测试 24/24 通过。Cargo 下载使用进程局部 `http.multiplexing=false` 解决本机连接超时，没有改代理、registry 或上游依赖。V8 helper 接受明确的 `cargoLockPath`，默认旧 workspace 锁文件、源树构建指定源树锁文件；7/7 回归通过，并已下载、校验 152.2.0 的官方 sandbox archive/binding/checksums。check 只证明编译，未记作二进制链接、真实启动或 GUI Gate B。

## 第一条消费者：CLI execpolicy

入口为真实 `lime execpolicy check`。现状是 CLI 导入 `codex_execpolicy::ExecPolicyCheckCommand`，依赖指向 `lime-rs/upstream/execpolicy`，旧 `lime-rs/crates/execpolicy` 仍保留。这是过渡接线，不符合唯一 owner 和 Lime 品牌准则。迁移目标是把经审核的上游实现纳入现有 Lime `execpolicy` owner，改为 Lime 符号/包/配置根命名，删除重复实现和整树路径；不保留 alias、包装或第二 workspace。

Verification Contract：输入为隔离规则文件、命令 tokens 与可选 `--resolve-host-executables`；输出为真实 CLI JSON decision/matchedRules。验证既有 strictest decision/justification，以及新源树 host_executable 白名单的允许路径与非白名单路径，命令只做规则查询、不执行被查询命令。上游 crate 测试、真实 CLI 集成测试、结构清单、CLI boundary、workspace 版本和脚本治理共同验收；通过后删除旧 `lime-rs/crates/execpolicy`，清单改指唯一源树 owner。当前回归进行中，尚不声称删除或产品验收完成。

旧主链前序边界证据：设置插件 7 文件 127 项通过，contracts 完整 exit0；Rust related 已真实通过 App Server 2,066 项与 agent 311 项，随后旧 MCP 测试因 launcher 环境缺可执行文件失败，不能记全绿。最终旧 workspace 复验又遇到并行 protocol 缺少 AllowDenyRequirement；Renderer/Host 类型检查和 GUI smoke 被并行 Browser 类型缺口阻断。保留日志，避免以这些失败修改无关热区或回退 mock。

当前分类：复制源树是 current 迁移基线；旧主链仍是被实际消费的过渡实现，按闭包逐项迁移后删除；前序自研 parser 等重复实现列为待替换，尚未假报已删除。新增长期 compat/deprecated 包装为 0。

初始镜像完整性曾为 100%（8,984/8,984），但这只是历史取样数据。当前源码筛选、品牌清理、消费者迁移和产品验收均未完成；不以镜像完整率表示目标完成度。
