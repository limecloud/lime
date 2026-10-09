# Lime v1.153.0 发布执行计划

状态：冻结候选与必要验证完成，执行commit/tag/push及分发核验。
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
- [ ] 创建Release v1.153.0提交与v1.153.0，推送main/tag并复核SHA。
- [ ] 核验Release workflow、GitHub Release、CLI/npm与updater实际分发。

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

- 本地与远端main仍为起点，目标tag/GitHub Release尚不存在。
- release commit/tag/push尚未执行，必要门禁与冻结结果确认后连续执行。
- 当前退出条件6/8（75%）；必要验证闭环，接续commit/tag/push与CI/公开分发。

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
