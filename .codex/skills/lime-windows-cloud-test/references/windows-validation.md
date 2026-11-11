# Lime Windows 验收入口

命令事实源为 `package.json`、`rust-toolchain.toml`、`.github/workflows/quality.yml` 和 `.github/workflows/release.yml`，执行前查看当前参数，不复制 Shou 的 .NET、WinUI、TRX 或 MSIX 流程。

## 选择路径

- 排查源码：固定候选 SHA/overlay，按 Quality workflow 准备 Node/pnpm、Rust/MSVC、sherpa 与 rusty_v8 资源，优先定向测试，再补 GUI。
- 排查用户安装版：复用同 SHA 的 CI Windows artifact 或正式 Squirrel Setup；不把云电脑本地未签名构建当正式签名/发布证据。
- 手动界面：在无影的交互用户桌面打开候选，按本轮用户路径操作并截图，记录进程/版本、原生窗口与 viewport 尺寸、UI 状态和 current IPC trace。

Node 约束取 `package.json.engines`，pnpm 取 `packageManager`；Rust 工具链取根 `rust-toolchain.toml`。缓存放测试盘，机器上已有工具先核对再复用。依赖安装沿用锁文件，不更新核心依赖促成通过。

```powershell
Set-Location $Source
$env:LIME_GATE_RUN_ID = $RunId
$env:LIME_CREDENTIALS_STORE = "file"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Locked dependency install failed" }
npm run verify:app-version
if ($LASTEXITCODE -ne 0) { throw "Version check failed" }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }
npm run verify:gui-smoke
if ($LASTEXITCODE -ne 0) { throw "Electron GUI smoke failed" }
```

上例以 `$Source`、`$RunId` 来自本轮已校验清单为前提；Rust/V8 与 Windows 链接环境按当前 CI 准备，不能靠失败后的 mock fallback 绕过。GUI smoke 默认隐藏窗口，仍需要在后续真实可见窗口完成本轮交互验收。

## 已安装候选

完整参数与步骤顺序直接参考 `.github/workflows/release.yml`：

1. `scripts/electron/select-windows-update-baseline.mjs` 选择已发布、包含非空 Setup 的正式 N-1，不能选无产物草稿。
2. `scripts/electron/windows-squirrel-rc-smoke.mjs` 执行安装/N-1 更新并产生含 `candidateSha`、`candidateRunId`、安装路径和卸载计划的 summary。
3. 从该 summary 读取实际安装的 `Lime.exe`，运行 `scripts/agent-runtime/code-mode-electron-gate-b.mjs` 与 `scripts/electron/windows-native-host-gate-b.mjs`；保持同一候选/run 身份。
4. `scripts/electron/windows-packaged-evidence.mjs` 校验三份证据身份，再按 Squirrel 脚本当前 cleanup 参数卸载本轮安装。保留用户要求的云电脑不等于保留测试安装。

下载包、安装成功、GUI smoke、Code Mode、native helper 和卸载各自说明结果；未执行 N-1 或长时间运行不能标通过。现有 native host 场景主要证明 helper 打包、观察及无租约拒绝，不证明全部授权输入。

## 会话与界面

按 [GUI E2E 事实源](../../../../internal/aiprompts/playwright-e2e.md)选择 current fixture 或 live 入口。会话至少核对可见输入/回复、最终 completed/failed/interrupted 状态、同一 canonical Thread/Turn/Item，以及停止后能继续使用。真实模型成功与本地 provider fixture 分开记录。

复验本轮修复时覆盖：原生内容尺寸与 renderer viewport 一致、内容铺满、权限控件禁用时无文字重影、未登录不出现 Lime Hub、登录后模型恢复。不要仅用页面标题、截图或成功加载取代行为断言。

原始截图、summary、trace、工具链/OS/架构、候选包摘要与进程退出码导出到本地 `.lime/verification/<run-id>/`。验收矩阵中区分 Windows 云电脑、Windows GitHub runner、macOS、本地源码及正式安装包。
