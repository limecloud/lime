# 参与 Lime

先阅读 [AGENTS.md](AGENTS.md) 和[架构](internal/aiprompts/architecture.md)。Agent runtime 以 Codex 为对齐来源，Provider 控制面可参考 Grok-build 的适用机制；Lime 品牌、多模型/多协议、自有服务端、专家广场和消息渠道继续由现役 owner 提供。

## 源码启动

需要 Node.js 22（或 24 及以上版本）、pnpm 9.15.9、Rust 1.95.0 与平台 C/C++ 工具链。根包开发工具链的 Node.js 范围以 `package.json#engines` 为准；CLI 发布包使用自己的运行要求。macOS 需要 Xcode Command Line Tools；Windows 使用 MSVC 工具链，具体依赖与资源准备由现有启动/构建脚本检查。

```bash
git clone https://github.com/limecloud/lime.git
cd lime
corepack pnpm install --frozen-lockfile
npm run electron:dev
```

`electron:dev` 启动真实 Electron Host 与 App Server；单独启动 renderer 不等于完整产品。首次构建会下载原生依赖；按脚本错误准备所缺资源，不以 mock backend 绕过。

## 验证与问题报告

按修改路径运行定向检查，完成后执行本地门禁：

```bash
npm run test:rust:related -- lime-rs/crates/services/src/provider_credentials.rs
npm run test:contracts
npm run verify:gui-smoke
npm run verify:local
```

Rust 测试分层 runner 使用临时目录和显式文件凭据模式，不操作真实账号凭据。需要真实模型或 OS keyring 的测试必须单独执行并标注其外部依赖。更多范围见[质量流程](internal/aiprompts/quality-workflow.md)。

提交 issue 时提供版本、操作系统、复现步骤、预期与实际结果、最小输入以及脱敏日志。先定位失败属于 renderer、Host/IPC、App Server、runtime、工具或 Provider；说明最早出错的边界、根因和验证过的修复，避免只贴最终报错。不得上传 API Key、token、完整配置或私密工作区内容。

PR 应集中于一个目标，说明用户可观察的变化、现役 owner、来源 revision/许可证、删除项、验证命令和未验证范围。重大架构变化同步架构图及确认；测试 fixture 证据与真实平台证据分别陈述。贡献按所在文件/组件的许可证提供，见[许可范围](LICENSES.md)。
