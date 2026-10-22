# REA 批注 Files 验收续推

状态：本片验收及共享测试迁移完成。日期：2026-10-22。负责人：root。整体 GUI 对齐仍 partial。

沿用 [批注 Files 实施合同](codex-annotation-files-20261022.md)。目标应用路径为 `/Applications/ChatGPT.app`，已有证据标识为 `com.openai.codex`。本轮推进既有迁移的产品验收，不把安装包静态证据写成目标应用运行结果。

本轮写集限本计划、`README.md` 的本片导航、`artifacts/codex-rea-annotation-verification-20261022/` 新增证据，以及 `.gitignore` 的精确白名单。用户针对具体补丁回复“继续”后，追加接管 `src/components/agent/chat/index.workbench03.test.tsx` 的两个过期断言迁移。其余脏源码、主计划、架构和其他进程的产物只读；产品验收使用既有隔离候选 `.lime/verification/annotation-files-20261022-r2`，不改共享 Rust、发布、Git 索引或用户配置。

## 验证合同

- 参考：`ev_614a2ee900e9efc766a559d2096c8915a9b61d75fae9efbd6f65134d458f66dc` 的同路径内容实例复用和标签导航；观察边界及 unknown 沿用原 REA 记录。
- current owner：`openWorkspaceFile -> Files -> FileTabLifecycle`，草稿与焦点仍由 `ArtifactAnnotationDraftStore` 持有。无状态 `ArtifactNavigationContext` 只传导航身份。
- 用户路径：Workbook 区域单条提交、跨 sheet 批注草稿、Composer 重开复用实例、关闭 Files 后冷开定位、主 Composer 保稿、原件 SHA 变化拒绝发送、设置往返后保稿、重新定位与完整提交。
- 证据：真实 Electron/preload/IPC、`app_server_handle_json_lines`、current JSON-RPC 与同一 canonical Thread/Turn/Item；受控 external backend 绕过真实 provider/runtime 执行，不能据此宣称 live 或生产模型行为。
- 稳定性：来源与产物前后摘要一致、freshness ready、零 mock/error、Main 正常退出；保留所有失败，不扩大超时或恢复旧 Canvas 分支。
- 默认门禁：先确认候选测试与 Git 边界，再执行 `verify:local`；若失败记录原终态，续跑沿原状态，不跳批。
- 退出条件：上述产品路径取得独立可复核证据；若暴露产品缺陷，先给出最窄根因与写集，不夹写正在修改的产品文件。整体九类仍 active / partial，无可信总百分比分母。

## 已核验

- 原 r2 GUI 日志已包含 `1.166.0` sidecar 构建完成及标准 GUI 24/24；本轮独立 freshness 检查 `ready=true`。
- 16 份原声明来源在候选中均匹配。工作树有一处 CommandRuntime 换行格式变化，因此原始字节认证仍限定候选；不把这一差异当成产品行为变化。
- 实现和定向测试进度引用原计划，本轮不重复计为新增实现。

## 本轮进展

- Workbook 完整场景 r1 exit0，35.620 秒；271 份来源、514 份产物前后稳定，freshness ready。230 次 App Server IPC，mock/trace/console/page error 均 0，Main 正常 code0/signal null，无 forced cleanup。同实例复用、冷开定位、SHA 拒发、设置往返保稿和主输入保留全部通过；冷开与版本冲突截图已查看。新证据见 `artifacts/codex-rea-annotation-verification-20261022/workbook-r1/summary.json`。
- 标准 GUI r2 的 24/24 原始 summary 与截图已复制到本轮证据目录，仍属于原冻结产品，不伪造新增 wrapper exit 收据。
- 为本地门禁只复制 Git 元数据到隔离候选，不提交、建分支或改共享索引。原 task planner 检出 111 个变更路径，选择版本/i18n/全局 lint/types/前端全量/contracts/GUI；没有 Rust 变更和全量 Rust 任务。`verify:local` r1 的原始终态和后续续跑均保留。
- 共享批注 hook 同时影响 PDF/DOCX/PPTX，因此追加三种既有 Composer review 场景，按原夹具顺序运行；不修改产品、fixture 或超时。Workbook 的冷开断言只归 Workbook，不外推为三种格式均已冷开。
- 三种追加场景分别 exit0：PDF 15.367 秒 / IPC 96，DOCX 22.038 秒 / IPC 119，PPTX 19.413 秒 / IPC 103。每轮 271 来源/514 产物稳定，Main 正常退出、无 forced cleanup，mock/error 为 0；三张 Composer review 截图均已查看。四轮受控 external backend 独立结算，不证明 live provider。
- 重新只读核验目标身份：版本 `26.1007.30912`、build `20156`、Bundle ID `com.openai.codex`，ASAR SHA256 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`，与复用 REA 基线一致。
- 默认门禁 r1 在 370.251 秒 exit1：版本/i18n/lint/硬编码扫描/types 通过，第 18/141 批的项目初始文件和 saved site 两个测试仍断言旧 Canvas Artifact；17 批通过，123 批 pending。原失败和原 smart state 保留。
- 先在隔离候选迁移两个过期断言，保留实际 Markdown 内容、路径、Files 激活及旧 Canvas 请求不回流验证。首轮迁移发现 Files storage 缺少测试输入，原失败保留；补齐显式 storage fixture 后 5/5 通过。产品与超时未改；测试文件不属于产品 fingerprint。共享文件开工时已脏，因此当时按并行规则请求用户确认具体补丁；获准后的应用及回归见 r7。
- 候选沿原 state 续跑 `verify:local`，未重置批次。新测试只扩大测试覆盖；r1 四格式证据绑定当时的产物，最终重建后的认证另见 r6。
- 通过已安装 REA CLI 对完整原 Evidence 做 summary view，得到 `ev_547464efaa688bbb1e9c689f47b7ed26eaa78af0f875c21fbe054ce492e911a7`；父证据仍为 `ev_614a2ee900e9efc766a559d2096c8915a9b61d75fae9efbd6f65134d458f66dc`。5 份提取/3543 字节、parse failure 0，semantic status unknown / 222 个 unknown，不能据此宣称整体静态调用图完整。ASAR、原成员和五份提取摘要已独立匹配；不重复分析相同输入，不将应用代码复制进本轮归档。
- r2 沿原 state 通过第 18–21 批，在第 22 批的 Rust runner 大日志测试遇到原 5000ms 超时，194/195 通过；170.315 秒 exit1。保持源码和超时不变，先独立复跑定位；不将该超时归为 Files 产品失败。原 r2 状态与日志保留。
- 原 runner 独立复跑 18/18 通过（测试 241ms），r3 在完整批次中也通过第 22 批；r3 前进至第 45 批时，两个专业夹具的八项 worker 用例因默认 Node `23.4.0` 缺少 `node:module.registerHooks` 失败。原 254.087 秒 exit1 与 state 保留。改用机器已有 Node `24.21.0`，只向验证子进程注入 PATH，不安装或更改系统默认；先独立验证这两个文件，再沿原 state 续跑。前 44 个成功批次有 Node23 历史结果，不声明它们全由 Node24 执行。
- 两个 worker 夹具独立验证 14/14 通过（10.902 秒）；r4 完整通过原第 45 批并完成其余批次。没有为旧运行时恢复 fallback 或放松夹具断言。
- r4 前端终态：1939 个文件、141/141 批 passed，failed/pending/running 均 0，live excluded 为 0。全链版本/i18n/lint/硬编码扫描/types 和合同前置均通过；wrapper 最后因候选 `.gitignore` 未同步发布索引里两张截图的已有例外而 exit1（779.467 秒）。只将共享 `.gitignore` 已存在的两条精确规则同步到候选，记录原/后摘要与复制来源，不修改共享发布输入或索引。随后单独运行完整 contracts 和 GUI，组合结算默认任务，保留 wrapper exit1；不为获取 wrapper exit0 重置已全过的前端批次。

## 最终验收

- 完整 `test:contracts` r5 exit0（23.885 秒），App Server client 296 checks；标准 `verify:gui-smoke` r5 exit0（564.648 秒），24/24。后者实际重建 Renderer/Host/私有 Rust sidecar，包含真实 Electron、preload/IPC、App Server 初始化、重载、设置页和三尺寸布局；其标准场景本身不证明 provider turn。
- r5 重建使产物从 514 增为 640 份，其中旧产物有 5 份改变，因此追加四格式 r6，未复用旧产物的通过结果认证新产物。Workbook/PDF/DOCX/PPTX 分别 exit0：27.627 / 22.569 / 33.446 / 28.085 秒，IPC 234 / 91 / 117 / 113。每轮 271 份场景来源、640 份产物稳定，freshness ready，trace/mock/console/page error 均 0；Main 正常 code0/signal null，无 forced cleanup。五张关键新截图已查看。
- r6 的 Workbook 证明同实例复用、关闭 Files 后冷开定位、原件 SHA 变化零发送、显式重定位后完整提交、跨设置页保稿和主 Composer 草稿保留。其余三格式只报告各自既有 review/提交/恢复合同，不外推冷开。
- 三段产品输入 fingerprint 全程不变：renderer `5cc3e963786fdce77256ffdffd5877397ee067a28b3fbc1336bc3a3982c5d743`；host `fbe412faf22c2e7c35c493502e544cdd8820db9da7c44fbba595dd6e5b72f39e`；appServer `63ce2537a01bc131f5a12e5fef29bf1b68dd37af10768591a5ff7cd6f34714fa`。最终四轮与前后快照的 640 份产物逐项一致，16 份声明来源仍匹配。
- 默认本地任务按组合步骤成功结算；原 `verify:local` r4 wrapper 仍为 exit1，不写成单轮 exit0。前端续跑历史包含 Node23 和 Node24，最终 contracts/GUI/四格式使用机器已有 Node24，未修改系统默认。
- 最终运行停留在各场景的 Files 批注提交终态，随后正常退出，无存活验收窗口；标准 GUI 最后为 `file:///index.html?nativeStartup` 的记忆设置页。四格式属于 macOS Desktop Gate B 的受控 external backend 证据，绕过真实 provider 与 production runtime 执行，不证明 Windows、打包应用、live 或参考应用运行行为。
- 本轮验收分母为四格式 4/4（100%）；r7 共享补丁应用 1/1，定向测试 5/5，尚未声明共享工作树全仓门禁通过。九类 GUI 全面对齐没有可信总百分比分母，继续 partial。结构/命名与旧入口删除沿用原实施合同，本轮补验收和过期测试迁移；没有新增兼容层、协议、依赖或产品代码。
- 精简收据：[verification-summary.json](./artifacts/codex-rea-annotation-verification-20261022/verification-summary.json)。完整日志、失败历史、终态、截图、摘要及补丁归入 [evidence.tar.gz](./artifacts/codex-rea-annotation-verification-20261022/evidence.tar.gz)，归档内含逐文件 SHA256 manifest；不包含参考应用代码或完整 REA 原始图。

## 共享测试接管 r7

- 用户针对接管与应用具体补丁的请求回复“继续”，满足并行协作规则。应用前再次匹配 root base `f48e1ff09c9d41be3c15e040a440ec2594d8da49454739f890a2451482b598a2` 和补丁摘要，并通过 `git apply --check`；只应用已审阅补丁，保留开工前改动。
- 应用后及测试结束的文件 SHA256 均为 `4fed2bcb6b4b765e743057ff13dd26070245e62c1c0a87259ec4ce88827d6ba5`，与已验收候选逐字节一致。共享根 `npm test -- src/components/agent/chat/index.workbench03.test.tsx` exit0（41.018 秒），1 文件、5/5 测试通过；ESLint、Prettier 和 diff whitespace 检查通过。
- 日志保留 JSDOM 缺少 `Range.getClientRects` 的既有 CodeMirror 测量错误，不将组件测试写成零控制台错误。产品交互仍由 r6 的真实 Electron 证据证明；本次仅测试变更，无需重复全量前端或重建 Electron，也不把候选全量结果升级为共享根全仓结果。
- 原完整归档保持原字节；接管授权、应用摘要、共享根回归日志及收尾检查单独归入 [takeover-evidence.tar.gz](./artifacts/codex-rea-annotation-verification-20261022/takeover-evidence.tar.gz)，顶层收据关联两份归档及各自 SHA256。

## 写集与原则

- 本轮共享写集：本计划、执行计划 README 的单行导航、`.gitignore` 的精确白名单、本轮新证据目录，以及获准接管的 `index.workbench03.test.tsx` 已审阅补丁。共享产品源码、Rust、Host、架构、主计划和结构账本均避让；隔离候选只迁移过期测试与同步两条已有发布截图白名单。
- 测试补丁复用 current Files 与真实 TextFileEditor，通过显式 storage fixture 验证内容、路径和激活状态，并阻止旧 Canvas 请求回流；遵循 KISS/DRY，不恢复旧包装。源文件及补丁摘要记录在原归档的 `test-patch-base.json`，本次应用与验证另有 r7 收据。

## 下一刀与边界

- 本片共享测试补丁已获准应用并完成定向回归；这项阻塞关闭，不再等待确认。
- 后续文件入口剩余项为 `useWorkspaceArtifactPreviewActions.handleFileClick`、TaskFile 与普通 Artifact/Canvas 消费者；本轮只读观察到现有工具文件测试仍走 Canvas，未把它声明为已删除或已验收。需要认领调用方与目标 Files opener 的完整纵切，再迁移有效行为回归。
- 本轮无产品/协议/配置/依赖更改；结构与删除的进展属于原批注迁移，验收属于本轮。新增 compat/deprecated 为 0。保留差异仍仅主题、多模型和首页 Banner；完整九类、平台、live 与重启耐久性不由四个受控场景关闭。
