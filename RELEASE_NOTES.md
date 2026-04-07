## Lime v1.5.1

### ✨ 主要更新

- 本次 `v1.5.1` 已收口当前工作区全部改动，核心集中在 Agent 聊天工作台、General Workbench、Service Skill、Team Workspace、Artifact / Timeline 展示与输入发送主链
- `src/components/agent/**`、`src/components/workspace/**`、`src/lib/api/**`、`src/features/browser-runtime/**`、`src/components/settings-v2/**` 一批界面、运行时与回归测试已一并进入本次发布
- 浏览器运行时、现有会话桥接、工具展示、团队协作、项目选择、技能目录、工作台工具命令与内容同步相关边界已同步更新
- 工程文档 `docs/aiprompts/commands.md`、`playwright-e2e.md`、`quality-workflow.md` 已随当前实现一起更新

### 🔗 依赖与版本同步

- `aster-rust` 依赖已从 `v0.27.1` 升级到 `v0.27.2`
- `src-tauri/Cargo.toml` 的远程 git tag 引用已同步到 `v0.27.2`
- 应用与 CLI 发布版本保持为 `1.5.1`
- 应用版本入口已对齐到 `1.5.1`，覆盖 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json`、README 发布示例与本地 `package-lock.json` 已同步到 `1.5.1`
- `src-tauri/Cargo.lock` 中 `aster-core` / `aster-models` 已对齐到 `0.27.2`

### ⚠️ 发布说明

- 本次发布 tag 仍为 `v1.5.1`
- 因为要把当前工作区全部改动统一纳入同一补丁版本，本次会更新已经存在的 `v1.5.1` Git tag 与 GitHub Release 指向
- 当前公开 release note 已按这次完整发布内容刷新

### 🧪 当前校验

- `npm run verify:app-version`
- Git 提交前的仓库 AI 验证会随提交钩子执行

### 📝 文档同步

- 发布说明已更新为当前这次完整的 `v1.5.1` 内容，可直接作为 GitHub Release note 使用

---

**完整变更**: `v1.5.0` -> `v1.5.1`
