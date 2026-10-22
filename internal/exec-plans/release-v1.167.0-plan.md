# v1.167.0 发布执行计划

状态：标签已推送，最终 Quality 与本地真实进程已通过，公开构建与渠道发布中；负责人：root；日期：2026-10-22。

## 目标、授权与范围

- 目标版本 `1.167.0`、标签 `v1.167.0`。用户明确要求“完成发布，我出去一下，不要找我确认”，授权本次必要修复、提交、标签、推送与公开渠道核验；不再重复确认。
- 基底 `416673da28f4166578a099e53a0d4aafc5d807cd`，上一标签 `v1.166.0`。初始远端 main 与基底一致，本地和远端均无目标标签。
- 当前 tracked/untracked 产品、测试、脚本及领域文档全部进入候选；只排除生成缓存 `tsconfig.node.tsbuildinfo`。候选冻结后新出现的其他 owner 改动留下一版，不自动追入。
- 主目标是交付既有候选，当前阶段是冻结与发布门禁，下一步为通过门禁后提交并跟踪同一源码的 Quality、Release 和公开渠道。

## 写集与架构确认

- 发布 metadata：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、两份 `RELEASE_NOTES*.md`。Forge 从 package 读取版本，pnpm 锁文件无应用显式版本，不额外改写。
- 记录：本计划、README 当前发布导航、`.gitignore` 精确放行、本版 artifacts。产品修复先在 `.lime/release-v11670/source` 隔离副本以窄写集完成，避免覆盖共享热区。
- 候选产品包括浏览器统一标签、Host 覆盖层/批注、历史与设置、浏览审批，以及 Files 预览、批注重开和文件点击迁移。全量路径和摘要以候选 manifest 为准。
- current 主链保持 Desktop/CLI -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item。Browser 历史/权限与 Files 状态沿用既有领域 owner；架构文档已有原责任开发者的图与依赖确认，本轮发布复核该方向。
- 不新增 compat/deprecated。已删除的 Canvas 预览、目录与无人调用文件入口保持 deleted，不恢复包装层。
- 浏览器完整原生 Profile、密码/Autofill/导入/扩展与完整 Codex GUI 对齐尚未交付；发布本次已实现增量，不把路线图或历史证据升级为完整产品验收。

## Verification Contract 与退出条件

1. 冻结 tracked/untracked 候选并留存逐文件 SHA，隔离依赖和 Git 索引，不创建开发分支；构建、测试与提交源码保持一致。
2. 必须通过 `npm run verify:app-version`、完整 `npm run typecheck`、`npm run test:contracts`；补受影响前端/脚本和 Rust owner 定向测试。
3. 运行标准 `verify:gui-smoke`、Agent current fixture，以及本次 Browser 权限/历史和文件点击等受影响真实 Electron 场景；串行使用同一构建，记录正常进程退出与 freshness。
4. 不降低权限、identity、断言、超时或来源校验来获取通过。失败保留原日志，修复后另起证据。
5. 提交前复核完整 staged 候选；推送 main 和标签，核对远端标签解析到同一提交，跟踪精确 SHA 的 Quality/Release 终态。
6. GitHub stable 资产、四平台 CLI/npm、三个 updater feeds/downloads 全部核验，macOS arm64 公开 npm fresh-install 真实 CLI 回归后记录结果。
7. 验证证据标明 Gate A/B、受控 provider/external backend、实际平台与未覆盖边界，不宣称 live provider 或未运行平台完整验收。

## 进展

- 已完成初始只读盘点、前版发布记录与当前领域计划复核。尚未修改产品代码、提交、打标签或推送。
- 本机默认 Node23 不支持部分现役测试 API；后续使用机器已有 Node24 的子进程 PATH，不全局安装或修改系统设置。

- 冻结 tree `e7ab8e4e149a9359b1b53507e131133192cc4035`，344 个路径（335 存在 / 9 删除），来源清单 `.lime/release-v11670/candidate-freeze.json`。验证使用已有 Node24.15.0，COW 克隆独立 Rust target，不争用原 target 锁。
- contracts r1 全通过；五语言资源 key/namespace 100% 一致。unused 首轮仅 7 个实际使用的批注标签未被单段动态前缀识别，改为显式类型化标签对象并移除双重类型断言，不删除文案或放宽扫描。
- 定向首轮 83 文件：81 passed / 2 failed，1151 passed / 8 failed。定位为新 page-preload 测试遗留 Save 按钮与 live-clock DOM，后续 NewTab 全局断言及批注测试点击到了前者。窄修复在该 fixture teardown 恢复 DOM、title 和 elementFromPoint descriptor；不改产品权限、断言或超时。原日志保留，后继独立重跑。

- 修复后原集合 83/83 文件、1159/1159 测试全部通过；i18n unused、legacy report 与窄格式全部通过。270 个改动 TS/JS 路径 ESLint 零警告，源码 whitespace 检查 exit0。首次失败和格式检查失败原件均保留。
- 首次完整 typecheck 与 Electron types 均通过；标签映射修正后的完整 typecheck 单独复验中。core Browser 配置 5/5 通过，Agent 多阶段审批与 App Server 配置持久化仍在编译/执行。
- 共享 useBrowserAnnotations 已被其他进程独立修改为同义的显式标签映射，本轮保留其字节，只在冻结候选使用直接 string 类型；page-preload fixture 在共享 SHA 与冻结输入相同后同步清理修复，不覆盖并行新增产品。

- 最终完整 `npm run typecheck` exit0（891.6 秒），覆盖标签映射修正后的源码；Electron types 首轮已通过。本机并行编译争用时仅临时挂起本任务 Vite 编译 120 秒，已自动恢复；未结束用户进程、改超时或更改来源门禁，操作收据单列。Agent Browser 审批 6/6 通过。

- 测试分层预算 37/38 通过。静态与定向门禁已收口，先推送冻结候选检查点以启动远端 Quality；本地 Rust/App Server 与真实 Electron 验证并行继续。该检查点不代表标签或公开发布完成，标签仍以后继门禁和同 SHA CI 终态为准。

- 检查点 `757fee07d51cdd4eeb7c1f6a3a6bf85f46932e72`，tree `ca7115248b1cbe631f1136df4ec830e5e1ce814d`，共 370 个路径（rename 展示为 364 files）。完整 staged manifest 已留存。正常 hooks 成功，main 推送成功并精确核对远端 SHA；尚无版本标签，未宣称公开渠道完成。共享索引只在确认仍等于原基底 tree 后刷新，后续他人改动保留。

- 首次 Quality `39766929023` 的四个 JS job 在 pnpm 安装阶段失败，根因是本轮隔离依赖链接被误纳入检查点（5 个 packages/*/node_modules symlink）。这是发布整理错误；产品测试尚未开始，不能写成测试失败或通过。已认领修正 `.gitignore` 精确匹配所有 node_modules 类型，仅从索引移除五条本地链接，保留工作文件与原 CI 日志，后继干净安装及 CI 独立收口。

- 修正提交 `2e364905b3202b0f348654272f8e714d5c5b1380` 已推送；新的空目录从该 Git tree 导出，使用指定 pnpm9.15.9 正常 frozen-lockfile 安装成功（127.8 秒）。前面 Corepack 旧 keyid 与离线缓存缺包是环境失败，原件保留，未改全局配置、依赖版本或锁文件。后继 Quality `39767600594` 已通过安装并运行全量。
- 初始冻结包含未接线的进行中 Browser annotation fixture；为本版必要产品验证，显式纳入该 owner 完成的 5 个脚本及测试拆分，产品源码保持冻结。27/27 夹具回归、窄 ESLint 通过；全 contracts 后继复验中，真实场景尚未执行，不记 Gate B 通过。

- Rust 定向全部通过：lime-core Browser config 5、lime-agent dynamic approval 6、App Server config/warning 7，共18项；新配置的 CAS、invalid-policy 不写盘合同通过。完整 contracts 后继 exit0（131.85 秒）。远端 Quality r2 的 GUI Smoke success；Frontend/Rust Full 仍待终态。

- 标准本地 GUI smoke exit0，证明真实 Electron/preload/IPC/App Server 1.167.0 与三尺寸。Agent 聚合首轮在审批拒绝场景业务断言全过后，正常 Main 退出超时；保持失败，正在定位生命周期，不以强制回收冒充通过。
- Quality r2 全量前端发现两项过期 Browser 生命周期测试：仍期待挂载时立即 consume。已迁移为显式挂载 ACK 后按 request ID 消费，保留用户选择与 owner 隔离断言；三文件53项回归全部通过。生产消费合同不变。

- 后继 fixture 提交 `003d500f111489938c4a14c6ab561863d03a36bb` 已推送：原生窗口尺寸由 Electron Main 设置，受控 provider 通过真实 models discovery 声明 image modality；请求 data URL 与 canonical sidecar/provider 按字节 SHA 关联，保留异图拒绝回归。32项相关测试、窄 ESLint、完整 contracts 均通过。全量产品 typecheck 证据保持有效，生产 TS/Rust 未再修改。
- Browser projection、history、browse-approval 实际执行成功；projection 仍按 Gate A 报告。annotation r7 全部14项断言通过，证明真实原生主 frame/editor、保存重开编辑、直接/主 Composer 发送、同 Thread 不同完成 Turn、必要截图裁剪、删除与配置恢复。Browser runner 退出使用既有超时回收策略，未单列正常退出证明，不扩大此项声明。
- file-click r7 Gate B 通过，原件/空文件/同名路径/磁盘和会话存储路径都经真实 Desktop/preload/App Server 验证；external backend 绕过 production runtime/provider。正常 Main 退出收据在 summary。
- Agent 聚合先前暴露审批拒绝退出偶发超时、rich draft stop 偶发未发 cancel；原件保留，未改生产生命周期或放宽超时。两者原始独立场景后继分别通过，不能据此宣称已修复偶发性。r7 聚合在 Coding Workbench 网站场景因240条环形日志淘汰早期 `is_default_browser` 证据失败；后继改读既有连续采集器且要求 complete，75项相关回归与窄 lint通过，完整聚合继续验证。
- Quality `39771593577` 的 Frontend Full 与 GUI Smoke 已成功，Rust Full待终态；`003d500f1` 对应 `39775081137` 已启动。尚未创建标签或公开发布。

- 最终候选 `dfd780294df6c460da374df1ea911577273e8038` 的 Quality `39775474871` 全部成功：Frontend Full（含完整 typecheck/lint/Vitest）、Rust Full、GUI Smoke。Git对象核对证实产品源码、依赖锁和打包配置与前面全绿产品基线相同，后继仅测试夹具与证据变化。
- `agent-current-final-r8` 完整聚合 exit0（345.38秒），22个真实Electron场景全部通过，22份正常Main退出码0/无signal/无强制清理。包括之前偶发失败的decline与rich-restore；保留原失败，不宣称已找到其确定根因或完成生产生命周期修复。各场景使用受控provider或明确external backend，边界以summary为准。
- UTC 12:38:57 已推送annotated `v1.167.0`，tag对象 `a8d8988a5b1755184e06ecaa94ec2a484484f912`，远端peeled SHA精确指向最终候选；未移动或重建标签。Release `39780068499` 已启动，目前为draft，桌面/CLI/npm/R2及公开安装核验尚未完成。
