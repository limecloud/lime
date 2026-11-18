# v1.180.0 发布执行记录

- 日期：2026-11-18。目标：准备完整发布候选，验证后确认并执行 release commit、`v1.180.0` tag 与远端推送。
- 起点：`main` / `d39246db790bad3b8bf75a12f8b5025fd4eb91e8`。上一标签 `v1.179.0`；初查远端 main 与本地一致，目标标签本地和远端均不存在。
- 候选范围：初始 339 个 tracked/untracked 产品、测试、文档与既有删除项全部纳入；保留已在主分支的上次标签后改动。缓存、临时工作区、凭据、二进制和本机日志继续排除。
- 本轮窄写集：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml` 的 workspace 版本、`lime-rs/Cargo.lock` 的本地包版本行、两份 `RELEASE_NOTES*.md`、`.gitignore` 的精确例外、本执行记录。业务源码按当前候选盘点，不覆盖并行 owner 的实现。
- 版本：125 个 Cargo workspace 包版本更新；`pnpm-lock.yaml` 没有应用旧版本；Forge 和 App Server manifest 从根版本读取，不制造额外版本源。
- 忽略规则：允许 `.cargo/config.toml`、本计划与 DeepSWE 会话计划进入候选，确保已验收的开发构建优化和验证边界随源码发布；其他 `.cargo` 文件及运行证据保持忽略。
- 架构范围：现有 App Server / runtime / Thread/Turn/Item 主链不变；`runtime-core` 收敛为 `model-routing-core`，MCP 配置归 config、catalog/identity 归 mcp，现有架构文档已同步归属。本轮不新增业务后端或协议。
- 验证：版本一致性、`npm run typecheck`、`npm run test:contracts`、GUI smoke；按最终候选风险追加定向前端/Host 回归。默认不跑裸 lint、裸全量前端或全量 Rust。
- 已知历史边界：DeepSWE 本机原始测试 reward=1，固定 amd64/QEMU 评分停滞；全仓默认门禁曾被共享工作树未引用翻译 key 候选阻断。发布矩阵按独立发版门禁执行，不把旧失败记录改成通过。
- 状态：用户明确要求「马上递交推送」，已授权立即执行完整候选 commit、`v1.180.0` tag、main 与 tag 推送。类型与合同门禁通过；GUI smoke / Rust 定向回归仍在运行，按用户即时递交要求不等待，不将未完成项记为通过。

## 本地验证进度

- `npm run verify:app-version`：通过，1.180.0。
- `npm run typecheck`：退出 0，68.7 秒；`npm run test:contracts`：退出 0，56.4 秒。日志分别为 `.lime/qc/release-v1.180.0/typecheck.log` 和 `test-contracts.log`。
- 当前修改的前端/Host 测试：9 文件 179/179；侧栏、设置、定时任务、插件和右侧面板消费者：11 文件 103/103。两组均退出 0，使用受影响测试列表，不跑裸全量前端。
- diff 检查发现 MCP manifest 和会话标题组件末尾多余空行，只裁去 EOF 空行；没有修改业务语义。重新生成 renderer 收据，`git diff --check` 已通过。
- `npm run verify:gui-smoke`：renderer 与 host 已构建，当前重建最新版本 App Server / CodeMode / sandbox sidecar；MCP 和模型路由 lib 定向测试排队复用构建。
- 既有 RustSec 例外 9 项对应包仍在锁文件中，原因保留且未新增豁免；本机没有 cargo-deny，不把例外复核写成一次新的漏洞全扫描。后端构建同步锁文件时裁去已退出依赖图的包，保留实际闭包。
- CLI npm package：12/12 通过。当前五语言结构检查通过（8,889 个源 key，无缺失/额外 key）；当前 `i18n:unused -- --check` 仍报告 446 个未引用候选并退出 1，属于已知全仓清理缺口，保留失败事实，不作为本轮发版技能规定的默认阻断项。

## 递交授权与范围

- 用户于本次会话明确要求「马上递交推送」，覆盖当前候选提交、创建新标签与推送；不覆盖重打既有标签或 force push。
- 递交范围：6 个版本/发布说明事实源和全部当前产品、文档、测试、已删除及重命名候选；缓存、凭据、二进制与本机日志继续忽略。隔离暂存预览为 331 项文件变更（含重命名），4,369 行新增、7,712 行删除，最终以真实 staged diff 复核。
- 递交前通过：版本一致性、typecheck、完整 contracts、前端/Host 282/282、CLI npm 12/12、五语言结构、diff check。
- 未完成：最新版 sidecar 冷构建后 GUI smoke、MCP/模型路由定向回归；本地结果继续落盘，不作为发布成功证据。已知未引用翻译候选与固定 amd64/QEMU 评分停滞保持原记录。
