# `docs/aiprompts` 索引

本目录存放 Lime 仓库的模块级说明、工程流程和治理文档。
根 `AGENTS.md` 只保留仓库级规则；超过“规则/入口”粒度的说明统一放到这里。

## 使用原则

1. **先按场景找入口** - 不确定从哪里开始时，优先读本页
2. **先读对应文档再改代码** - 尤其是命令边界、GUI 主路径、迁移收口、Provider 与凭证
3. **GUI 改动优先看质量链路** - Lime 是 GUI 桌面产品，先看 `quality-workflow.md` 与 `playwright-e2e.md`
4. **新旧并存问题先看治理文档** - 避免在 compat / deprecated 路径上继续长新表面

## 按场景导航

### 架构与治理

- `overview.md` - 项目架构总览与模块分层
- `query-loop.md` - 运行时 Query Loop current 主链、提交入口与执行边界
- `prompt-foundation.md` - 基础 Prompt current 主链、system prompt 组装顺序与 current/compat 分类
- `task-agent-taxonomy.md` - Task / Agent / Coordinator current taxonomy、current/compat 分类与协调边界
- `remote-runtime.md` - Remote runtime current 主链、远程入口 current/compat 分类与控制面归属
- `memory-compaction.md` - Memory / Compaction current 主链、来源链/持久记忆/压缩边界与 current/compat 分类
- `persistence-map.md` - Runtime 文件快照持久化主链、artifact sidecar/version/checkpoint 边界
- `state-history-telemetry.md` - State / History / Telemetry current 主链、session/thread/request/evidence/history 边界与 current/compat 分类
- `governance.md` - 新旧并存治理、迁移收口、禁止回流
- `harness-engine-governance.md` - Harness Engine 事实源、evidence pack、replay / analysis / review 治理规范
- `quality-workflow.md` - 本地校验、GUI smoke、契约检查、CI 门禁
- `command-runtime.md` - `@` / `/` / 轻卡 / viewer / 功能方案包实施手册
- `skill-standard.md` - 统一技能标准、skill / adapter / runtime binding 边界
- `site-adapter-standard.md` - 站点适配器标准、来源导入边界、运行时收敛规则
- `web-browser-scene-skill.md` - 网页 / 浏览器场景技能设计提案，说明如何把外部 web skill 思路收敛到 Lime 主线
- `project-heatmap.md` - 仓库热力图与治理候选分析
- `limecore-collaboration-entry.md` - 跨仓库联动入口
- `../tech/harness/README.md` - Lime Harness Engineering 总入口与实施蓝图

### GUI 与前端

- `design-language.md` - 全局 UI 视觉语言
- `components.md` - React 组件约定
- `hooks.md` - 自定义 Hooks
- `lib.md` - 前端工具库与运行时封装
- `workspace.md` - Workspace 边界与工作区模型
- `playwright-e2e.md` - GUI 续测、Playwright MCP、交互验证
- `performance-profiling.md` - 性能分析与剖析方法

### 后端与运行时

- `commands.md` - Tauri 命令边界、协议同步点
- `services.md` - Rust 服务层
- `server.md` - HTTP Server 与接口边界
- `mcp.md` - MCP 服务器与工具管理
- `plugins.md` - 插件系统
- `aster-integration.md` - Aster Agent 集成

### Provider 与数据

- `providers.md` - Provider 接入与认证方式
- `credential-pool.md` - 凭证池退役边界、启动清理与守卫
- `converter.md` - 协议转换与兼容层
- `database.md` - 数据库层与持久化

## 常见入口建议

- **改 UI / 页面结构**：先读 `design-language.md`，再看 `quality-workflow.md`
- **改 system prompt / subagent prompt / plan prompt / prompt_context / augmentation 顺序**：先读 `prompt-foundation.md`，再回看 `query-loop.md`
- **改 turn 提交 / prompt 组包 / queue / compaction / evidence 主链**：先读 `query-loop.md`
- **改 subagent / automation / execution tracker / scheduler taxonomy**：先读 `task-agent-taxonomy.md`
- **讨论 `/goal`、Managed Objective 或跨 turn 目标续跑**：先读 `task-agent-taxonomy.md` 与 `query-loop.md`，再读 `../research/codex-goal/README.md` 与 `../roadmap/managed-objective/README.md`
- **讨论 Coding Agent、Skill Forge 或能力生成 draft**：先读 `query-loop.md` 与 `skill-standard.md`，再读 `../research/pi-mono-coding-agent/README.md` 与 `../roadmap/creaoai/coding-agent-layer.md`
- **改 channels / browser connector / DevBridge / OpenClaw remote runtime**：先读 `remote-runtime.md`
- **改记忆来源链 / working memory / durable memory / Team Memory / compaction**：先读 `memory-compaction.md`
- **改 FileArtifact / artifact sidecar / versions / file checkpoint / evidence 中的文件快照**：先读 `persistence-map.md`
- **改 session detail / thread read / requestTelemetry / evidence / history-record**：先读 `state-history-telemetry.md`
- **改 Tauri 命令 / Bridge / mock**：先读 `commands.md`，再看 `quality-workflow.md`
- **改 `@` / `/` / 轻卡 / viewer / ServiceSkill 场景**：先读 `command-runtime.md`
- **改 Claw 技能 / Service Skill / 统一 Skills 标准**：先读 `skill-standard.md`
- **改站点适配器 / 导入外部 adapter**：先读 `site-adapter-standard.md`，再看 `web-browser-scene-skill.md` 与 `quality-workflow.md`
- **做网页登录态访问 / 网页导出 / Markdown 落盘场景**：先读 `web-browser-scene-skill.md`
- **改 Workspace / GUI 壳 / 主路径**：先读 `workspace.md`、`quality-workflow.md`、`playwright-e2e.md`
- **做迁移 / 收口 / 去兼容层**：先读 `governance.md`
- **改 handoff / evidence pack / replay / review / HarnessStatusPanel**：先读 `state-history-telemetry.md`，再看 `harness-engine-governance.md` 与 `governance.md`
- **改 Provider / 凭证加载 / Token 刷新**：先读 `providers.md`、`credential-pool.md`
- **做跨仓库联动**：先读 `limecore-collaboration-entry.md`

## 对应 Codex Skills

- **治理收口**：`.codex/skills/lime-governance/`
- **GUI 设计语言**：`.codex/skills/lime-design-language/`
- **工程质量 / 交付判断**：`.codex/skills/lime-quality-workflow/`
- **命令边界 / 契约同步**：`.codex/skills/lime-command-boundary/`
- **GUI 续测 / Playwright MCP**：`.codex/skills/lime-playwright-e2e/`
- **热力图 / 治理优先级**：`.codex/skills/lime-project-heatmap/`
- **项目技能提炼**：`.codex/skills/project-skill-factory/`

## 维护规则

1. 新增长期文档后，要同步更新本索引
2. 根 `AGENTS.md` 不再堆叠长流程，统一链接到这里
3. 如果某段说明已经变成长期流程或模块说明，应从根规则迁到本目录
4. 如果某条工作流已经高频复用到值得做成 skill，同步检查 `.codex/skills/README.md`
