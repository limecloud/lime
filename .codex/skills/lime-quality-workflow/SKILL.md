---
name: lime-quality-workflow
description: 为 Lime GUI、CLI/TUI、Rust、协议、配置与发布改动选择风险匹配的验证，区分 current fixture 和真实进程证据，并同步迁移过期测试与护栏。只读分析或规则文档更新使用轻量检查。
---

# Lime 质量验证

先读 [质量事实源](../../../internal/aiprompts/quality-workflow.md)，按其中的最低门禁矩阵执行；实际命令以 `package.json#scripts` 与对应入口实现为准，不在 skill 复制第二份全量矩阵。

按任务读取：

- public method、IPC、preload、typed gateway、catalog、fixture：[命令边界](../../../internal/aiprompts/commands.md)。
- owner、目录和依赖方向：[架构](../../../internal/aiprompts/architecture.md)。
- 删除、旧路回流、重复实现：[治理](../../../internal/aiprompts/governance.md)。
- GUI 对齐：[设计事实源](../../../internal/aiprompts/design-language.md)；真实交互再读 [GUI E2E](../../../internal/aiprompts/playwright-e2e.md)。

## 先确定这次要证明什么

只读分析、skill 或纯规则文档更新，检查格式、链接、真实命令和既有文档守卫；没有产品代码变化时，不为获取“全绿”运行全量 Rust 或 Electron。若修改了质量入口、执行脚本或 public boundary，则验证相应行为。

实现任务先写清 current owner、输入、用户可见结果和失败终态。长任务进入 `internal/exec-plans/`；Agent / GUI 主链实现前填写 [Verification Contract](../../../internal/exec-plans/templates/agent-verification-contract.md)。用户要求结构对齐时，验证目录、函数、类型、类和调用链迁移，不能只检查画面相似度。

主链固定为 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection`。Desktop、CLI 和 TUI 共用协议、runtime、工具与持久化 owner；host 测试不能证明另一种 host 的交互。

## 验证顺序

1. 先跑受影响的 unit/component/domain integration。纯逻辑归 projection/selector/helper，React 测试覆盖渲染、DOM、hook 和关键接线。
2. Rust 先 `npm run test:rust:related -- <paths...>`，跨 owner 追加 integration；不要无理由从 workspace 全量开始。
3. method / protocol / client / IPC / preload / gateway / catalog 变更补 `npm run test:contracts`，并同步 schema、消费者、fixture 和文档。
4. Agent chat、streaming、stop、approval、queue、工具终态或恢复主链，先 `npm run smoke:agent-runtime-current`，再按受影响场景补证据。
5. GUI / Bridge / Workspace / Desktop Agent 主路径至少 `npm run verify:gui-smoke`；交付默认本地门禁 `npm run verify:local`。真实用户路径还需对应 Electron Gate B。
6. CLI/TUI 先 crate 测试，再用真实 stdio/CLI/PTY fixture；从事实源选择具体入口。TUI 必须证明 alternate screen、键盘与终端恢复。

扩大测试必须由新改动、失败或未关闭风险支持。全量前端中断后用 `npm run test:resume`；已有通过结果不因收尾重复运行。五语言文案与关键交互按仓库规则补稳定回归，避免只断言实现文字或镜像内部逻辑。

## 证据与治理

- Unit、App Server integration、current fixture、Gate A、Desktop Gate B、CLI Gate B、TUI Gate B、live 和 platform/packaged 分别报告，不能互相替代。
- `smoke:agent-runtime-current` 聚合 Code Mode、会话恢复和运行中 Turn 恢复三个真实 Electron 入口。只报告实际执行成功的场景和边界，不把入口名称或历史结果当成任意 GUI 功能的 Gate B。
- Desktop Gate B 必须关联真实 Electron、preload/IPC、`app_server_handle_json_lines`、current JSON-RPC、runtime/read model 与同一 identity 的用户可见状态；仅 `/health` 或浏览器 DOM 成功不足。
- external / unavailable backend 是显式测试依赖；说明绕过了哪些执行层，不冒充 production 或 live provider。生产 mock fallback 命中必须为零。
- public v2 使用 `thread/*`、`turn/*`、`item/*` 与 server request 合同。完成回归区分 wire `turn/completed`、runtime event 和 renderer `turn_completed`；不靠 sleep/grace timer 合成 terminal。
- 复刻时同步迁移或删除过期代码、文档、测试、snapshot、fixture、扫描规则和白名单。有效护栏守住 current 语义、唯一 owner、权限与 mock 边界，不锁死旧文件名或 DOM 布局。
- 版本/Forge/workspace manifest 执行 `npm run verify:app-version`；脚本治理执行 `npm run governance:scripts`；依赖更新同步锁文件。其余按质量事实源扩大。

汇报风险、改动分类、实际命令及结果、证据等级、未跑原因和剩余阻塞。对齐任务分别报告行为、结构/命名、清理、产品验证；不能把规则更新、静态分析或同名文件数写成全面对齐完成。
