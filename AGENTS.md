# AI Agent 指南

本文件只用于 **开发 Lime 源码仓库本身**。
根 `AGENTS.md` 只保留仓库级规则、高频入口和硬约束；长流程与模块说明统一下沉到 `docs/aiprompts/`。

## 仓库级原则

1. **始终使用中文输出** - 回复、注释、文档统一使用中文
2. **先读后写** - 修改文件前必须先读取现有内容
3. **避免无关变更** - 不顺手重构、不扩大范围、不主动做 git 提交/分支操作
4. **规则留根，流程下沉** - 根文件只放长期稳定的仓库规则；长说明写到 `docs/aiprompts/`

## 跨平台硬约束

1. **默认双平台** - 新增功能、脚本、文档默认同时考虑 macOS 与 Windows
2. **禁止硬编码平台路径** - 用户数据、日志、缓存、凭证等目录必须走系统 API 或统一封装
3. **优先平台无关入口** - 优先复用 `npm`、`cargo`、Tauri 命令和仓库脚本，不新增只适用于 Bash/zsh 的流程
4. **未验证的平台假设要显式说明** - 涉及文件系统、进程、终端、快捷键、窗口、托盘、权限时尤其如此

## 工程硬规则

1. **默认先跑统一入口** - 功能改动发起 PR 前默认执行 `npm run verify:local`
2. **版本改动必须校验一致性** - 改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf*.json` 时必须执行 `npm run verify:app-version`
3. **命令边界改动必须校验契约** - 改 `safeInvoke` / `invoke`、Tauri command、Bridge/mock 边界时必须执行 `npm run test:contracts`
4. **Lime 是 GUI 桌面产品** - 不能只以 `lint`、`typecheck`、单测通过作为“可交付”判断
5. **高风险 GUI 改动必须做最小冒烟** - 涉及 GUI 壳、DevBridge、Workspace、主页面路径时必须执行 `npm run verify:gui-smoke`
6. **不要继续扩展 compat / deprecated 路径** - 新 API、新命令、新前端入口默认落在当前 `current` 主路径
7. **协议改动必须同步四侧** - `safeInvoke(...)` / `invoke(...)`、`tauri::generate_handler!`、`agentCommandCatalog`、`mockPriorityCommands` / `defaultMocks` 必须保持一致
8. **协议改动必须同步文档** - 至少同步更新 `docs/aiprompts/commands.md`、`docs/aiprompts/playwright-e2e.md`、`docs/aiprompts/quality-workflow.md`
9. **用户可见 UI 改动必须补稳定回归** - 优先补现有 `*.test.tsx` 的关键文案、状态、交互断言；若已有 snapshot 机制，沿用现有机制
10. **配置结构改动要成组更新** - schema、校验器、消费者、文档必须同步演进
11. **依赖改动要同步锁文件** - 提交 `package-lock.json`、`src-tauri/Cargo.lock` 等实际锁文件；本仓库不适用 Bazel 规则
12. **Rust 测试先小后大** - 先跑受影响 crate / 模块 / 定向测试，再决定是否跑全量 `cargo test`
13. **控制 Rust 文件规模** - 新增模块尽量控制在 `500 LoC` 以内；文件接近 `800 LoC` 时，新功能优先拆新模块
14. **不要继续放大历史大文件** - 现有超大文件属于历史包袱，但新增逻辑应优先拆边界，不继续堆叠
15. **质量门禁保持单一主线** - `.github/workflows/quality.yml`、`scripts/quality-task-planner.mjs`、本地统一入口要保持一致

## UI 规则

1. **改界面先读视觉规范** - 先看 `docs/aiprompts/design-language.md`
2. **中文排版优先** - 避免英文 tracking 过大、重复标题、拥挤统计卡文案
3. **宽度按页面类型选** - 表单页窄、工作台页宽，不要整仓一个 `max-width`
4. **渐变只做氛围层** - 背景存在感必须弱于内容
5. **主表面默认实体底色** - 不要默认用 `bg-white/80`、`backdrop-blur` 制造层级

## 常用文档入口

- **架构概览**：`docs/aiprompts/overview.md`
- **工程质量**：`docs/aiprompts/quality-workflow.md`
- **治理收口**：`docs/aiprompts/governance.md`
- **UI 规范**：`docs/aiprompts/design-language.md`
- **Tauri 命令边界**：`docs/aiprompts/commands.md`
- **凭证与路径**：`docs/aiprompts/credential-pool.md`
- **Playwright / GUI 续测**：`docs/aiprompts/playwright-e2e.md`
- **Codex Skills 索引**：`.codex/skills/README.md`

## 高频命令

```bash
# 本地统一校验
npm run verify:local
npm run verify:local:full

# GUI 最小冒烟
npm run verify:gui-smoke
npm run bridge:health -- --timeout-ms 120000

# 契约与治理
npm run test:contracts
npm run governance:legacy-report

# GUI / headless 调试
npm run tauri:dev:headless

# Rust 定向 / 全量测试
cd src-tauri && cargo test
```

## 文档维护

1. 改仓库级规则时，同时更新本文件与对应 `docs/aiprompts/` 文档
2. 新增长期使用的工程脚本时，同时补 `package.json` 与对应文档入口
3. 如果某段说明已经超过“规则/入口”的粒度，就迁出根 `AGENTS.md`
4. 如果某条流程已经高频复用到值得做成 skill，同步更新 `.codex/skills/README.md`
