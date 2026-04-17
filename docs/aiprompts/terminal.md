# 终端能力归档说明（已移除）

本页仅用于治理归档与历史检索，不作为 current 模块入口。

## 概述

`lime-terminal` 已从当前仓库移除，Lime 不再提供内置 PTY / SSH / WSL 终端会话能力。独立前端 `terminal / sysinfo / files / web` 页面更早已下线；本轮收口后，旧 `src-tauri/src/terminal/`、`terminal_cmd`、`connection_cmd` 与 `src/lib/api/terminal.ts` 也不再作为 current surface 保留。

## 当前结论

当前与“terminal”仍相关的能力只剩：

- Windows 启动诊断里的默认 shell 判定
- Aster runtime 中的 `SessionType::Terminal` 会话类型与相关读模型语义
- 与 Agent / 执行工作区相关的 `latest_terminal / recent_terminals` 运行结果摘要字段
- 文档与治理目录册中的历史痕迹扫描

这些都不是内置终端产品面，不应再被扩展回 PTY 会话、连接管理或终端页面。

## 治理分类

- `dead`
  - `src-tauri/src/terminal/*`
  - `src-tauri/src/commands/terminal_cmd.rs`
  - `src-tauri/src/commands/connection_cmd.rs`
  - `src/lib/api/terminal.ts`
- `current`
  - `src/lib/api/serverRuntime.ts`、`crashDiagnostic.ts` 等非终端产品面的运行时诊断入口
  - Aster runtime 会话读模型里的 `SessionType::Terminal`
  - 执行工作区中的 `latest_terminal / recent_terminals` 运行结果摘要

## 约束

- 不再新增任何 `terminal_*` / `connection_*` Tauri 命令
- 不再恢复终端页面、终端 API 网关或 PTY 管理层
- 如未来确有需求，必须重新定义新的 current surface，而不是复活旧 crate / 旧命令 / 旧页面

## 相关文档

- [commands.md](commands.md) - Tauri 命令
- [governance.md](governance.md) - 治理判断
