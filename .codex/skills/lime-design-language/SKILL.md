---
name: lime-design-language
description: 对齐 Lime GUI 的布局、交互、组件结构与命名；以 Codex Desktop 安装包证据和公开源码分工校准，保留 Lime 视觉主题与多模型。适用于页面、工作台、侧边栏、Composer、面板与设置改动。
---

# Lime GUI 对齐

先读 [设计事实源](../../../internal/aiprompts/design-language.md)。用户本轮明确指定的目标优先于 skill、旧页面和历史计划；不要把本 skill 当成保留旧 Lime 布局的理由。

按改动边界继续读取：

- 组件拆分、目录或 owner 迁移：[全局架构](../../../internal/aiprompts/architecture.md)。
- Workspace 主路径：[工作台边界](../../../internal/aiprompts/workspace.md)。
- 命令、审批、队列、历史恢复：[命令边界](../../../internal/aiprompts/commands.md)。
- 验证与证据等级：[质量工作流](../../../internal/aiprompts/quality-workflow.md)；真实交互再读 [GUI E2E](../../../internal/aiprompts/playwright-e2e.md)。

## 参考与保留范围

- Desktop 的布局、交互、模块边界、导出名称和可观察数据流来自实际安装包。用户要求 REA 复刻时使用 `reverse-engineer-anything` 的 ASAR / JavaScript 流程，复用匹配版本与摘要的 Evidence。
- 协议、Thread/Turn/Item、状态机、工具生命周期、审批、MCP、Skills、Multi-Agent 与恢复语义对齐 `/Users/coso/Documents/dev/rust/codex` 的 current owner。该公开仓库不包含 Desktop 前端源码，不能由 TUI 布局推断 GUI。
- 保留差异为 Lime **视觉主题、多模型支持**及用户明确保留的**专家广场、消息渠道**。其他可确认的 UI、行为、目录职责、函数、类型和类均纳入对齐；证据不足的项目记录为 unknown，不擅自增加保留项。
- 主题样式通过现有 token / skin 实现；多模型通过现有 catalog / model-provider 实现。这两项都不能产生第二套 runtime 或 read model。

## 实施方式

在执行计划记录“参考模块/符号 → Lime current owner → 行为和数据合同 → 迁移/删除项 → 验证”，再按独立切片直接替换。需要截图、安装包分析或源码才能成立的结论分别标明来源；静态分析不证明运行效果。

已确认的模块、类型、类和函数名称尽量直接对齐，并一次迁移调用者、export、测试与 fixture。保持平台语言惯例；不要把压缩变量、chunk hash 或猜测名称当成上游源码名称，不为同名无同义的函数保留 alias。

GUI 只消费 canonical projection。显示状态可在 surface 内维护，业务状态、审批 authority、工具执行和持久化仍属于 App Server 与既有领域 owner。长历史、审批和 diff 必须复用同一 thread/turn/item identity。

清理与替换同时交付：旧组件、hook、重复状态、旧文档入口、过期正向测试和冲突护栏一起迁移或删除。有效风险用 current owner 的行为测试继续覆盖；不要为旧 snapshot、旧选择器或规则恢复已替代实现。

## 视觉与交互检查

- 导航、会话页头、时间线、Composer 与右侧面按 Desktop 证据组织，不强套白卡、统计卡或阶段导轨模板。
- 使用既有语义 token，验证浅色、深色、跟随系统与受影响 skin；不要硬编码旧浅色或覆盖用户主题。
- 面板层级、宽度、密度、滚动与焦点服务任务；不要用重复弹窗、进度入口或背景装饰替代状态反馈。
- 长历史验证动态高度、canonical key、滚动锚点、流式尾随和离屏焦点；审批验证完整详情、可用决定和失败恢复；Files 验证工作区树、源码预览和文件标签身份；Changes 验证实际打开已有 diff owner。具体合同与参考限制见设计事实源。
- 面向开发工作流可以直接显示模型、Skills、MCP、权限、工具和 Git 等用户需要操作的产品概念；Runtime、Gateway、mock 等内部机制只在需要诊断时呈现。
- 用户可见文案覆盖五语言；键盘、焦点、可访问名称和可见状态要有稳定回归。验证命令和 Gate 等级按质量事实源选择。

汇报实际替换、保留差异及用户明确例外、current/compat/deprecated/dead 分类、已取得证据及未验证项。规则更新完成不等于 GUI 已对齐。
