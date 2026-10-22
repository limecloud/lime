# v1.167.0 发布执行计划

状态：候选已推送，本地真实进程与远端 Quality 验证中；负责人：root；日期：2026-10-22。

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
