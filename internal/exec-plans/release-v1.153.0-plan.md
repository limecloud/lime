# Lime v1.153.0 发布执行计划

状态：commit/tag/main与tag推送完成，Release workflow运行中，等待产物与公开分发核验。
日期：2026-10-09
基线：`v1.152.0` / `26b14f43939d575f9132e58191cd9bb3aa8865fd`
起点：`main` / `b594644086b3dc4097d2ffc17568601292d277de`
目标：发布共享推理策略、CLI exec（含review）、TUI输入交互及App Server分叉恢复，完成版本、双语说明、必要门禁、commit/tag/main与tag推送，并核验桌面、CLI/npm和updater分发。

## 授权与候选

- 用户最新明确要求“完成发布,不要让我确认”，已授权执行完整发布及必要修复，覆盖本轮commit/tag/push，无需重复确认。
- release metadata：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`、本计划。
- candidate changes：冻结时全部tracked/untracked产品、文档、测试、schema和结构inventory，包含CLI review和第82阶段空输入导航/按键owner。无主动排除的冻结时源码。
- 冻结使用实际暂存区与完整内容快照；快照、路径与tree写入`.lime/releases/v1.153.0/`。验证最终核对业务文件SHA256，不把旧版本或验证窗口后的新增内容算作已验证。
- 冻结后的并行开发保留在工作区，作为后续候选；不覆盖、不撤销，不移动本版tag以追逐后续开发。七个release metadata由本进程维护，其余业务热区只读审阅。
- Forge和App Server manifest读取根包版本；pnpm锁文件没有应用版本，保留依赖解析。Cargo.lock仅同步36个本地包版本，保留已有CLI依赖边。

## 退出条件

- [x] 冻结完整候选，165个变更文件，路径/tree/内容可核对，无未说明的排除。
- [x] 根包、CLI、Rust workspace和36个本地Cargo包为1.153.0；版本检查通过。
- [x] 双语发布说明仅保留v1.153.0，包含review与本轮产品行为。
- [x] typecheck、contracts、受影响回归与必要环境失败补验完成并匹配冻结候选；原环境失败如实保留。
- [x] CLI stdio、TUI PTY、Agent runtime fixture与GUI smoke取得本版风险匹配证据。
- [x] 用户明确授权完整发布，无需再次确认。
- [x] 创建Release v1.153.0提交与v1.153.0，推送main/tag并复核SHA。
- [x] 核验Release workflow、GitHub Release、CLI/npm与updater实际分发。

## 架构确认与分类

主链为`Product Surface -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI/terminal projection`。共享配置归core Config；GUI/TUI消费显示策略；CLI exec拥有参数、输入及终端输出，review/fork/media/output-schema复用共享App Server/runtime合同。分叉订阅与冷恢复修复在App Server既有owner，不建立私有后端。

已审阅architecture.md及第66—82阶段责任开发者架构确认，发布复核责任root，2026-10-09。current为共享配置、CLI exec/输出、TUI effort/completion/navigation、App Server fork hydration；test-only为受控provider/Electron/stdio/PTY夹具；compat/deprecated无新增；dead/deleted为旧TUI非交互exec、重复fork恢复和旧popup目录入口。KISS/DRY复用协议和canonical事实，SOLID分离输入输出、显示投影与共享恢复。

## 验证记录

- 版本/typecheck/contracts/npm包测试均已执行通过；正式发布typecheck硬门禁未降级。
- `npm run verify:app-version`通过，36个本地Cargo包同步；`npm run typecheck`完成renderer/node两项目。
- `npm run test:contracts`通过：协议生成物、命令/client、modality、scripts、Forge、Desktop/CLI及docs边界。
- `npm --prefix packages/cli test`：9/9通过，包含事件schema打包。
- 首轮17文件Vitest为286通过/1失败（ReviewArgs inventory尚未生成）。并行进程更新inventory后，失败文件及受影响CLI Gate守卫2文件9/9通过，初次失败闭环，不重复累加。
- 推理投影/MessageList/分组/显示解析6文件80/80通过；任务页组件回归8/8通过。
- CLI/TUI Rust第一轮通过：CLI lib8/bin103/integration2；TUI lib1641/suite23/依赖边界1。第82阶段新增导航需在冻结内容上补验。
- 公开config/fork JSON-RPC、GUI和桌面聚合fixture已完成，CLI/TUI最终隔离验证见下述记录；未把排队或编译计为通过。
- 本机曾出现超过200的负载，Rust共享artifact锁使检查排队；未终止其它开发/浏览器进程，未借旧binary假称本版fresh。
- legacy-report：2070源码/1841 Rust源码，零引用候选、分类漂移和边界违规均为0。
- release metadata格式与diff检查通过。默认不执行裸全量lint/test/workspace Rust；补验只服务实际风险和新变化。
- 第一轮快照160路径；此前隔离索引预览163变更文件。最终统计以冻结后的实际暂存tree为准。
- 实际冻结165个变更文件，20175行新增/2448行删除，tree为`9b0ccda8841c0e8c3861189940c0be38879fbda4`；完整SHA256及路径为`candidate-frozen.json`与`candidate-frozen-paths.txt`。冻结后第一次业务复核零漂移；本计划后续验证记录属于metadata更新，最终提交前单独刷新。
- 日志与快照目录为`.lime/releases/v1.153.0/`；失败/等待日志保留，最终验证结果在此计划追加。
- 为避免冻结后并行CLI拆分/根review命令污染验证，冻结tree建立独立detached检出；不把验证快照提交放入main/tag历史。新增的root review与后续fixture拆分保留在原工作区，属于冻结后的开发。
- 隔离候选17文件287/287通过，4个结构守卫文件117/117通过，typecheck与contracts均成功。原工作区第一次重验读到并行拆分而失败，仅保留诊断，不作为冻结候选失败。
- 第82阶段导航owner与冻结源码逐字节相同；current crate定向11/11通过，覆盖Press/Repeat/Release、editor/Vim重绑解绑、footer、paste burst/disabled/pending chord。其余Rust第一轮已通过，不重复累加同一测试。
- `verify:gui-smoke`成功，run `standalone-shell-01-20261009103256-28723`，macOS arm64，App Server1.153.0，24/24 assertions、41次current IPC；reload、三viewport与Memory设置均通过，错误/legacy/mock计数为0。已核对GUI/Electron/App Server/core/TUI冻结源与root实跑源无差异；不把壳层smoke扩张为provider或canonical turn证据。
- 真实CLI/TUI原工作区等待进程已由本进程停止，仅停止自行启动的两个进程树；改为冻结CLI源码构建与独立检出fixture。构建清单只为本机复用current依赖产物，不进入产品提交，事件schema取冻结候选；最终release仍使用原workspace manifest由CI构建。
- App Server测试和桌面聚合fixture已结束，环境中断范围及续跑结果按下述证据报告。

## 平台与证据限制

- 受控provider夹具不等于live provider；单元层gated PTY early return不证明真实PTY。
- 当前本机为macOS arm64；Windows、跨架构打包、签名/公证、npm公开安装及updater分发按实际CI和公开端点证据核验。
- 前序1.152.0验收仅作历史参考，不自动升格为本版或所有平台通过。

## 发布状态

- 发布退出条件8/8（100%）；GitHub Release已公开、latest、稳定版，14项资产全部uploaded。Release workflow `37932726668`全部success。
- 公开tag保持`3528a3c721ad4417ea6bf0378421c43014b42bda`；main另有Docs/CI与MCP通知修复，最新生产修复为`8e50db2f73524dd33c94ceadf763fff13a44dbe3`。发布后修复没有纳入既有tag或暗改产物。
- R2的18个current/versioned端点、npm五包/provenance/四平台包结构、macOS arm64公开npm真实CLI/TUI安装使用均通过。自定义更新域名仍保留本机TLS超时限制，非本机npm平台只声明结构验证。
- Docs/MCP与首轮Quality `37946892531`整体success；最终日志复核发现Windows旧目录测试匹配0项，新增窄修复将验证迁至current App Server fs。发布完成度100%，CI验证范围更正与后续Windows真实用例核验继续执行。

## 隔离验证收尾（2026-10-09）

- App Server原集成入口实际展开57个target：1951 passed、1 failed；config 1/1、fork 5/5通过。最后的Unicode输入limit测试在合法queue/add处明确报数据库或磁盘满，原command exit101保留，不写成全绿。
- 本机磁盘一度耗尽，外部开发进程移走并删除root Rust target；本轮已保存独立runtime及SHA256，不依赖被清除的缓存。释放磁盘后，失败输入limit场景用同一本版App Server的真实stdio重验，保留四method超限错误、无mutation、Unicode/rich边界、queue精确保留和canonical终态全部断言。高负载下首次test-only backend超时，延长夹具预算后继续闭环，产品合同不变。
- 冻结CLI源码逐字节构建及113个测试通过；测试专用独立manifest只解开workspace继承并复用current依赖，不进入产品提交。CLI二进制为1.153.0，SHA256 `10b8ddeb922ac431b1339483a83b4ec5710d5f7a94a93f213bb78202150343b2`，其余runtime逐文件记录在`frozen-runtime-files.json`。
- 冻结CLI真实stdio Gate B通过（`cli-gate-b-isolated-retry.log`），thread `01a12046-1ca6-7bc0-b12c-072daf7982fe`、turn `turn_2e2f441683fc43bab00ae3a8f2c42a9e`；resume/fork/review四target、图片、schema、BOM/UTF16、文件保护/写错误、JSONL/错误退出、五locale/color均通过。首次管道运行未执行human双TTY；后续真实PTY已输出`CLI_HUMAN_TTY_OK`，终端两流均为TTY、最终回答只出现一次且工具可见，最终command结果继续核对。
- 桌面Agent runtime原聚合在MCP前因磁盘满中断；从失败点续跑8个场景全部成功（`runtime-fixture-resume.log` exit0）：MCP/media/expert plaza/expert panel/typed retry success与failure/article workspace/reasoning-first-visible。前段原场景成功与后段续跑形成全场景证据，原聚合exit1仍保留。
- 桌面推理专项`release-v1.153.0-reasoning-first-visible-summary.json`的`ok=true`且全部assertions=true，thread `01a1204b-72a7-7840-9c4d-c1b2e5e44c8d`：唯一canonical reasoning、摘要先可见、重载身份内容不变、共享raw开启/关闭均通过；已目视检查最终截图，摘要与最终回答可见、输入可继续。
- TUI在独立target重新构建冻结源码后运行原完整Gate B；保留原真实PTY、键盘、stdio场景和所有断言。npm Gate B使用保存runtime、原包组装与launcher/platform dependency/sibling App Server消费路径；两个验证均尚未将编译或中间输出算作通过。
- 最终发布使用独立release index与冻结work tree执行正常pre-commit/commit，直接以起点main为父；验证快照commit不进入发布历史。原工作区后续开发文件保持原样，根暂存区仅同步本轮metadata，避免阶段83及后续改动混入。

- 输入limit真实stdio最终完整通过（`input-limit-stdio-final.log` exit0）：thread `01a12053-9da3-7730-ab48-cbe3a81ae57f`、turn `turn_e6340c2df9e0477c9a9d19a6091236c5`。原Rust磁盘失败与第一次夹具timeout保留，重验为同产品binary的等价公共入口断言，不伪称原Rustcommand通过。
- CLI双TTY完整入口exit0（`cli-gate-b-double-tty.log`），thread `01a12052-123b-7181-920e-7bfc6123d159`、turn `turn_cb6dc1be65764ce7969e8dc065a1d86d`，包括所有exec扩展和human双TTY均通过。
- TUI首轮真实complete发现测试清理错误：repeat Left后光标处于`aXb`中间，Ctrl-U只清前缀留下`b`，后续空输入等待失败。修复既有suggestions fixture为Ctrl-E后Ctrl-U，未改变产品输入行为/任何场景断言；root已有同一必要修复，仅将这两行纳入冻结候选修正，后续root review仍排除。两个结构守卫81/81通过，完整TUI/npm重验进行中。
- 冻结候选pre-commit静态验证162/162通过（另3路径为rename/filter）；最终正常commit还会运行同一hook，不跳过验证。

- TUI后续complete已通过所有输入导航/补全断言及实际turn，发现setup测试快速发送连续Backspace留下最后一个filter字符。修正既有config测试助手为每次真实按键后等待实际filter屏幕状态，再发送下一次删除；保持原toggle、清空、reorder与保存断言。仅这两处fixture必要修正纳入本版，不扩大产品范围。

- npm组装Gate B完整exit0（`cli-npm-gate-b-verified.log`）：launcher/platform optional dependency/sibling App Server、完整CLI exec扩展及真实TUI complete全部通过。CLI thread `01a120af-780d-7780-bdec-db34a03b46f0`、turn `turn_7d5ebc2b4ce94020991b7fe2dda012fc`；TUI thread `01a120b0-e4e7-70b2-be3d-96e2686a8d54`、turn `turn_5211c45fbf8e4bf3b13f49629079a27c`，输入/补全/导航、backtrack/cold restore、config、reasoning parts、focus/resize/reconnect和terminal restore均通过。并行裸binary complete在180s总预算超时，保留该失败，采用同源码及runtime的npm完整成功证据续跑其余10个原始场景；不删除场景或降低断言。
- 修正后的三个脚本/结构守卫112/112通过；所有test-only修正仍处既有owner，无新运行时/compat路径。

- TUI其余10个原始场景最终exit0（`tui-gate-b-remaining-retry.log`），thread `01a120b4-fa31-78a1-902f-49dc20153c69`、turn `turn_d2ea3fefe8c24013b8091c5842a083fd`。approval/user-input/interrupt/failure/queue-edit/agents-overview/large-paste/diff-display/images/skills全部真实PTY通过，typed input/thread input stdio、图片/skill结构化历史、effort动画、focus/resize/reconnect/terminal restore通过。一次启动10s超时保留诊断，后续成功重验未改产品或断言；与npm complete形成原11场景完整证据。
- 提交前范围：冻结165路径，最终仅双语导航条目、本发布计划、suggestions清空光标与config逐次按键两个测试助手为冻结后修正。其余阶段83源码/文档/脚本开发保持未提交。正式release commit直接以`b594644086b3dc4097d2ffc17568601292d277de`为父，独立验证快照不进入main/tag历史。

- Release commit `3528a3c721ad4417ea6bf0378421c43014b42bda`，tree `31e0a155d37ee8afc741a594ee1a47836dc92745`，唯一父为起点main；165文件纳入。远端main/tag已实读匹配，工作区后续开发保留为未提交，未用add-A/reset覆盖。
- 独立检出缺少忽略目录`.husky/_`，正常commit自动hook未执行；提交前已明确运行原AI静态验证162/162通过，提交后按release实际变更列表对最终冻结文件再次运行同一验证器163/163通过，`precommit-release-files.log`保留。此处如实区分显式验证与自动hook，不声称自动hook运行。
- 发布工作流：https://github.com/limecloud/lime/actions/runs/37932726668 。Prepare GitHub release通过，三平台桌面开始构建；GitHub Release目前draft，尚未宣称公开分发完成。

- CI macOS arm64已构建/签名/公证并通过打包后native Gate B，8/8结构化检查passed；已下载实读summary，candidate version=1.153.0、SHA=`3528a3c721ad4417ea6bf0378421c43014b42bda`、runId=`release-37932726668-1-darwin-arm64`逐项匹配。Windows安装/更新步骤已完成，证据下载核验继续；macOS x64仍构建中。
- 自定义更新域名本机TLS连接再次超时（`default-updater-endpoint.stderr`）；公开R2、CI回读与版本feed待本次上传后单独核对，不据本机网络推断全球客户端可用性。

- Windows原run证据下载实读：Squirrel真实N-1更新/卸载21/21、已安装GUI壳24/24、CodeMode21项、native6项和packaged identity4项全部通过；candidate version=1.153.0、SHA与runId=`release-37932726668-1-win32-x64`一致，resource manifest涵盖App Server、CodeMode、native host和两个sandbox helper。没有沿用上版补验或只取job颜色作为本版证据。

- macOS x64打包后native证据已实读8/8 passed，version/SHA/runId=`release-37932726668-1-darwin-x64`一致。三平台桌面产品验证全部成功，等待最后缓存收尾后汇总上传GitHub/R2并构建CLI平台包。

- 三平台桌面build及GitHub资产publish全部success。GitHub Release已公开且latest稳定版，非draft/prerelease；9/9桌面资产uploaded、size>0、SHA256完整，中文body与本版RELEASE_NOTES逐字匹配。公开地址：https://github.com/limecloud/lime/releases/tag/v1.153.0 。R2上传和四平台CLI/npm构建继续运行，尚未将桌面公开扩张为完整分发完成。

## 发布后 CI 修复（2026-10-09）

- 用户要求修复截图中的Actions失败并继续发布。Docs run `37932718112` 在 `sitemap.xml` 预渲染失败：新版 `@nuxt/sitemap` 要求公开 `site.url`；不是Pages部署权限故障。Pages API实读地址为 `https://limecloud.github.io/lime/`，无自定义域名。
- 本轮窄写集为 `docs/nuxt.config.ts`、`docs/app.config.ts` 和本计划：补齐站点URL、让llms消费同一URL并同步旧GitHub链接。采用全新依赖、原CI安装/生成命令验证sitemap、canonical与baseURL；避免旧本地Docus依赖掩盖问题。退出条件为新Docs构建和部署成功、公开页面可访问。
- 历史Quality run `37763816405` 的13项unused lint已在本版修复，当前run `37932718117` 的Frontend Full、Integrity、GUI Smoke与Windows Shell Runtime成功，Rust Full仍运行。历史Windows run `37763248438` 的artifact层级问题已修复，恢复run `37763827153` 和本版Windows打包证据均成功；不重跑旧SHA冒充修复。
- Docs修复独立提交，不移动已发布 `v1.153.0` tag，不纳入冻结后的CLI/TUI并行开发。current为Docs站点配置，compat/deprecated/dead无新增；KISS/DRY复用站点URL，不引入新模块或主题迁移。
- 全新安装确认 `docus: latest` 已解析到5.14.0。该版新增 `nuxt-agent-discovery` 明确拒绝带路径的站点URL；仅配置origin虽能生成，却产生缺少 `/lime` 的canonical和错误llms链接，未作为合格修复。扩展窄写集至 `docs/package.json` 与独立 `docs/pnpm-lock.yaml`：固定到最后不含该模块的5.13.0，锁定独立依赖，继续以Nuxt4.6.0验证真实生成结果。根workspace依赖与并行文档不纳入。
- R2 job已success；公开R2的18个current/versioned地址全部通过HTTP、size核验，feed逐字节内容、SHA256与版本均匹配本版GitHub资产（`r2-public-summary.json`）。自定义更新域名的本机TLS限制仍单独保留。
- Docs最终写集另含 `.github/workflows/deploy-docs.yml`：`configure-pages` 的origin/base_path输出形成 `NUXT_SITE_URL`，供5.13.0 sitemap的既有环境读取入口使用；Nuxt站点配置读取同一变量，本地默认真实Pages地址。CI使用独立锁文件的frozen安装，并监听自身workflow改动。
- Node22.23.3、pnpm9.15.9、Docus5.13.0、Nuxt4.6.0的冻结安装后生成exit0、59条route完成；实读13/13 sitemap URL与canonical/og:url正确。但Docus默认 `failOnError:false` 掩盖了 `llms-full.txt` 的500，未把该exit0当作完整通过。启用 `nitro.prerender.failOnError:true` 后该错误正确阻断生成。
- llms递归根因已定位：`mdast-util-to-markdown` 2.2.0 的strong handler改为把自身节点送回containerPhrasing，依赖handler的attention元数据；`remark-mdc` 3.11.1包装strong时没有保留该元数据，造成无限递归。将Docs独立依赖图的该包固定到2.1.2；Content/MDC版本回退未修复问题，已撤回该无效override，继续使用当前Content版本。所有失败日志保留。
- MCP原测试的新源码定向与完整库169项均通过，未本地复现CI时序。修正仅在test-only区域：一次性释放信号用CancellationToken，调用失败先报告错误，再有界等待progress并携带label/token诊断；保留原隔离/结果/不串流断言。修正后库169/169与8进程并行100次重复全部通过；不声称已证明原通知丢失机制，不改production或增加CI时限。
- Docs最终生成exit0且无预渲染错误，60条route完成；13/13 sitemap、canonical与og:url一致（主页仅标准化尾斜杠），14/14 llms公开链接均有实际文件，`llms-full.txt` 34661 bytes；无重复base path。证据为 `docs-ci/docs-mdast-fixed-generate.log`、`docs-ci/docs-validation-summary.json`。独立锁文件保留解析后的Content3.15.2/MDC0.22.2，不再额外覆盖其版本；只有Markdown序列化依赖的2.1.2 override。Docs边界检查通过、既有守卫24/24通过、静态验证7/7通过。
- 修复提交写集仅为Docs四文件（含独立生成锁文件）、Pages workflow、MCP现有测试和本计划，共7文件；用户全局gitignore忽略pnpm-lock.yaml，显式纳入这一个必要锁文件，不修改全局规则。其余CLI/TUI/架构/运维文档开发均保留。使用独立索引复核及正常hook提交，不重打tag。
- 当前Quality run `37932718117` 最终cancelled：MCP并发进度测试从13:13:36至13:51:24持续等待，触发60分钟job预算；其余任务成功。新增认领 `lime-rs/crates/mcp/src/bridge_client.rs` 的现有测试区，先复现、定位无限等待，再定向验证，不以提高作业timeout掩盖卡死。
- CI修复提交 `8e45bf77308ce50d719340a0030f3809a491178a` 已推送main，唯一父为本版release commit；远端v1.153.0仍保持原SHA。正常pre-commit实际执行6个匹配路径全部通过（workflow另有显式静态验证），未跳过hook；独立索引仅同步本轮7路径，所有并行开发保留。
- Docs恢复run `37942348705` 的build/deploy均success：https://github.com/limecloud/lime/actions/runs/37942348705 。公开Pages实读首页、sitemap、llms索引/完整文本、API正文和raw Markdown共6个HTTP200；13条sitemap和canonical正确，完整文本34661 bytes，与本地生成一致（`docs-ci/docs-public-summary.json`）。Docs失败已闭环；新Quality run `37942348723` 继续核验MCP等待修正。

- Quality恢复run `37942348723` 的Rust Full在MCP169项中168通过/1失败，5秒诊断明确为工具response成功但token0没有progress；首次test-only等待修正只揭露问题，未修复根因。Frontend Full、Bridge/Contracts、Integrity、GUI Smoke均成功，Windows继续运行。
- 依赖图对照及最小wire复现确认：`execpolicy -> starlark`在完整workspace/CLI图启用`serde_json/arbitrary_precision`，RMCP0.12的untagged通知解析把含浮点`progress/total`的标准`notifications/progress`落到CustomNotification，因此没有调用进度dispatcher。本地只开preserve_order仍通过；开启arbitrary_precision的真实duplex回归继续验证失败。最小复现`mcp-wire-repro.log`同时证明直接解析ProgressNotificationParam成功、同一wire解析ServerNotification落到CustomNotification。
- 本轮扩展窄写集至`lime-rs/crates/mcp/src/client_service.rs`和`lime-rs/crates/mcp/Cargo.toml`：仅在唯一current客户端服务边界按标准method恢复强类型进度通知，再交回既有handler；test依赖启用生产图已有arbitrary_precision以稳定覆盖真实transport回归。未知自定义method继续既有路径，非法标准参数返回协议错误；不创建第二dispatcher或runtime、不提高CI预算。
- 公开npm五包与provenance/四平台包结构全部核验；真实registry安装后13个文件与已验证tarball SHA256匹配、launcher symlink正确，`lime --version`=1.153.0。已发布CLI完整stdio及human双TTY成功（`npm-public-flow.log`，thread `01a12114-4406-7830-a831-42064abf251a`、turn `turn_0dc86d5284de45bebe09ca43df96722c`）。已发布TUI complete首轮180秒总预算未完成，保留timeout并定向续验，不计为通过。

- 开启arbitrary_precision的现有真实duplex用例在修复前稳定重现`call A: no progress for token Number(0)`（`mcp-arbitrary-precision-repro.log` exit101），与CI完全相同；边界修复后MCP库172/172通过（`mcp-normalized-tests.log` exit0）。dev依赖只增加已有serde_json特性，不变版本/锁文件；生产统一图与定向测试从此一致。新增回归覆盖浮点wire、非法标准参数拒绝、未知method及extensions保留。
- `npm run test:contracts`完整exit0（`contracts-mcp-normalized.log`），`npm run verify:app-version`通过=1.153.0；本轮没有新App Server/IPC方法或schema变化。现有progress隔离断言及有界诊断全部保留。
- 公开npm TUI续验已完成complete PTY、输入/导航/补全/推理、stdio reasoning/cold resume、focus/reconnect；最后resize四项中一项未观察到启动输入，原日志保留（`npm-tui-public-retry.log`）。原四项未改代码/超时定向重验4/4通过（`npm-tui-resize-retry.log` exit0），完整入口再次收口以保留最终ledger/event序列断言。
- 本次提交仅MCP client_service、MCP dev-dependency manifest与发布计划三文件；之前的bridge_client测试修改已在main。current为唯一MCP服务的标准通知解析，test-only为生产feature图回归，compat/deprecated/dead无新增。用户授权继续完整发布，窄提交/推送沿用既有授权；v1.153.0公开tag保持`3528a3c7`，生产修复进入main，不暗改已发布binary。

- MCP完整workspace关键特性组合（arbitrary_precision + preserve_order）库172/172再次通过（`mcp-workspace-features-tests.log`）；修复提交`8e50db2f73524dd33c94ceadf763fff13a44dbe3`正常hook3/3通过，独立index窄提交推送main，远端main与tag分别实读匹配修复SHA与原发布SHA。新Quality run为 https://github.com/limecloud/lime/actions/runs/37946892531 。
- 公开npm实际TUI最终完整exit0（`npm-tui-public-highload.log`）：thread `01a12124-f51b-70f1-b1b8-506a23fd336e`、turn `turn_25a9d208d65d4b6aa1e995c898c69977`，全部原complete/stdio/focus/reconnect/resize及ledger事件序列断言通过。保留两次原180秒总预算超时与一次resize启动输入失败；本机load约42时，隔离验证runner只把complete进程总预算改为600秒，未改每步等待上限、源码业务行为或任何断言，也未改CI配置。原fixture源码保持不变，另生成验证专用副本；完整成功证据不伪称原180秒入口全绿。
- 发布最终分发已完成：GitHub Release latest稳定版、14/14资产、三平台原run桌面安装/native证据、R2 18/18端点、npm5/5包及provenance/四平台tarball完整性均成功；公开registry实际安装后的macOS arm64 CLI/TUI使用通过（`npm-public-gate-b-summary.json`）。历史Quality `37942348723`的Windows最终success，整体failure仅为已定位的旧MCP错误；新修复SHA的完整CI继续核验。

- 修复SHA的Quality `37946892531`已确认Frontend Full、GUI Smoke、Integrity与Rust Full全部success。Rust原job `113875522286`日志已下载实读：134组test result，7010 passed / 0 failed / 26 ignored；原progress并发隔离用例与新增浮点wire、非法标准参数、custom/extensions三个回归均明确`ok`（`quality-rust-normalized-job.log`与`quality-rust-normalized-summary.json`）。原169项等待失败已由同CI矩阵闭环，不再仅依赖本地通过。Windows最后合同组继续运行。

## 首轮验收结果（Windows目录测试范围见后续更正）

- 发布完成度100%。Release `37932726668`、Docs `37942348705`和首轮Quality `37946892531`均为success；公开GitHub latest、R2与npm实际分发核验完成。版本事实源与双语说明为v1.153.0，release commit/tag/push已完成。
- Quality完整CI结束于2026-10-09 15:39 UTC；Windows五个检查步骤均exit0，Quality results最终success；目录创建步骤的0测试范围已在下节更正，不能将其记为真实Windows目录测试通过。修复后的源码SHA为`8e50db2f73524dd33c94ceadf763fff13a44dbe3`，完整成功链接：https://github.com/limecloud/lime/actions/runs/37946892531 。
- Docs修复提交`8e45bf773`、MCP生产修复提交`8e50db2f7`均已推送main；仅最终验收记录追加文档提交。公开tag仍固定`3528a3c721ad4417ea6bf0378421c43014b42bda`，发布后main修复不属于已经发布的v1.153.0二进制。
- current：唯一MCP客户端服务的标准进度通知解析与Docs生成配置；test-only：有界进度夹具、生产feature图回归和外部受控provider/stdio/PTY验证。CI修复无新增compat/deprecated入口、无文件删除；本版产品的已删除旧TUI exec及重复入口分类见前述架构确认。KISS/DRY复用标准method和现有handler，SOLID保持服务边界单一责任，无新dispatcher、runtime或fallback。
- 实际修复写集：Docs四文件（含独立锁文件）、Pages workflow、MCP bridge_client测试、MCP client_service与dev-dependency manifest、发布计划；其余CLI/TUI/架构/ops并行开发继续避让。后续生产演进由各current owner负责，本轮没有遗留待修复CI项。
- 验证限制明确保留：非本机npm平台只有结构/provenance证据；macOS arm64公开npm CLI/TUI为真实执行，TUI高负载验证仅放宽进程总预算至600秒，原180秒失败保留。自定义更新域名本机TLS超时仍未核实，公开R2 18/18端点及feed完整性通过；受控provider不等于live provider验证。

## Windows 零测试门禁更正

- 最终实读Windows job `113875522160`日志发现目录创建步骤虽exit0，实际为0 passed / 224 filtered。此前“Windows五组测试全部通过”的表述对该步骤不准确，以本节更正为准；Quality workflow整体success状态本身真实，canonical timeout用例及13项Agent Plugin MCP parity已在日志明确`ok`。验收记录提交`24f445f68`仅改本文档，其docs-only Quality `37953636506`为success。
- 事实源确认旧`lime-services/file_browser_service`与旧目录测试已删除，current owner为App Server `fs`，现有`fs::tests::exact_fs_round_trip_covers_binary_metadata_directory_copy_and_remove`覆盖真实目录创建、二进制读写、复制、删除；同用例已在本次Rust Full实跑通过，但尚不据此声称Windows通过。
- 新窄写集仅`.github/workflows/quality.yml`、既有`scripts/prepare-sherpa-onnx-runtime.test.mjs`和本文档。Windows统一运行两个明确App Server lib用例：canonical timeout与current fs round trip，检查cargo退出码并要求每个filter恰好1 passed / 0 failed，避免名称迁移后0测试伪绿；现有workflow守卫同时核对Rust用例存在。
- 超时合同原命令为31分钟，额外编译了大量无匹配的integration target；改用`--lib`和完整test path的`--exact`，保留同一Windows专有用例及所有断言，避免无关target消耗预算。无生产代码变更，不恢复旧services facade，也不提高作业timeout。后续以新SHA真实Windows日志确认两个用例均执行通过后再标最终CI完成。

- Windows current合同守卫17/17通过（`windows-current-contract-guard-exact.log`）；Prettier/YAML解析与diff检查通过。首轮Vitest按子串同时收集忽略目录中的冻结快照，根目录17项均通过、旧快照守卫因读取新workflow失败；已明确排除`.lime/**`后定向入口exit0，不修改历史快照或产品断言。
- 新workflow使用明确pwsh shell、同一App Server lib target和完整test path；共享foreach统一核对native退出码与“1 passed / 0 failed”结果，避免重复执行器。生产源码与已通过的7010项Rust矩阵不变，后续CI仍按仓库workflow风险策略执行完整矩阵及真实Windows当前合同。
