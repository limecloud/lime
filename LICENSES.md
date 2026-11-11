# 许可证范围

Lime 主应用及未另行声明的源码按 [GPL-3.0-only](LICENSE) 分发。允许按该许可证使用、修改及商业分发；分发时须履行许可证规定的源码和通知义务。README 中的用途介绍不额外限制许可证授权。

各组件已有的显式许可证继续有效，不因 workspace 默认值而改写其原有授权：

- `packages/**/package.json` 中声明为 MIT 的 TypeScript 包按其声明授权。CLI JavaScript launcher 包含 Codex 的 Apache-2.0 源码与 Lime 的 MIT 部分，元信息为 `Apache-2.0 AND MIT`，两份正文在 `packages/cli/LICENSE`，来源通知在 `packages/cli/NOTICE`。
- `@limecloud/lime-<platform>` 包包含 Rust CLI、App Server 及其工具，整体分发元信息为 GPL-3.0-only；不能把 launcher 的许可声明套用于这些二进制。
- 从 Codex 复制的代码保留 Apache-2.0 授权、原始署名和 [OpenAI NOTICE](licenses/OpenAI-NOTICE.txt)。复制模块内的 LICENSE/NOTICE 继续保留；Apache-2.0 文本在 [licenses](licenses/Apache-2.0.txt)。
- `lime-rs/crates/app-server-transport/src/websocket_auth/` 复制自 Codex `websocket-auth/src`，保留 Apache-2.0；来源 revision、逐文件哈希与必要适配见 [Cloud 复制账本](internal/refactor/cloud-desktop-copy-ledger.json)。
- `lime-rs/crates/infra/src/secure_file.rs` 来自 Grok-build，保留 [SpaceXAI Apache-2.0 声明](licenses/SpaceXAI-LICENSE.txt)。
- Cargo 包有显式 `license` 声明时按该声明识别组件；`license.workspace = true` 表示该组合包的默认 GPL-3.0-only，不撤销其中上游文件的 Apache/MIT 授权。
- 第三方依赖、Electron、浏览器与原生运行时继续按其自身许可证分发，现有 LICENSE/NOTICE 不得被打包裁剪。依赖许可扫描不能替代完整的分发材料清单。
- ZIP 的 bzip2 后端 `libbz2-rs-sys` 使用 `bzip2-1.0.6` 许可证；原文及原始作者、Rust 移植作者署名保存在 [licenses/bzip2-LICENSE.txt](licenses/bzip2-LICENSE.txt)，随 Desktop 与 CLI 产物一起分发。

Desktop Forge 与 CLI staging 都会携带本说明、根 LICENSE/NOTICE 和 `licenses/`；launcher 另带自己的 Apache-2.0/MIT LICENSE。源码与构建入口为 [GitHub 仓库](https://github.com/limecloud/lime) 和 [贡献指南](CONTRIBUTING.md)。分发修改版本时须同时提供与二进制相符的对应源码及构建材料，不能仅指向发生变化的 main 分支。
