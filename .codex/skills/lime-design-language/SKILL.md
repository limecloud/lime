---
name: lime-design-language
description: 复刻 Codex Desktop 的页面、布局、交互和代码组织时使用；优先复制源码，缺失的 Desktop 实现按 REA 证据还原，保留 Lime 品牌、多模型和自有服务端。适用于导航、会话、Composer、面板、设置与 Computer Use GUI。
---

# Codex GUI 复刻

本 skill 服务于复刻。Codex 原版决定产品结构和行为，Lime 既有页面与组件只是待迁移实现，不能反过来成为设计基线。用户最新要求优先；按“先完成复刻，再优化”的顺序推进。

执行顺序为：用户当前要求 → 指定 Codex 版本的源码与 REA 证据 → Lime 明确保留差异的必要适配。旧设计规范、旧页面和原型图不能替代原版证据；需要画图时使用同一基线，不重新决定布局和交互。

先读 [源码复制规则](../../../internal/aiprompts/codex-source-alignment.md) 和 [GUI 复刻事实源](../../../internal/aiprompts/design-language.md)。源码迁移使用 `lime-replication`；需要发货 Desktop 证据时使用 `reverse-engineer-anything`，复用已有匹配版本证据，避免重做研究。

## 先找原版，再改产品

1. 明确本次要复刻的原版页面、状态和动作，读取已有截图、REA Evidence、模块提取与源代码。原版的区域划分、入口顺序、可见条件、弹层、滚动、键盘、焦点、授权、停止和失败恢复都在范围内。
2. 公开源码从 `/Users/coso/Documents/dev/rust/codex` 直接取。能整目录复制就整目录复制，能整文件复制就整文件复制；包括实现、测试、资源和依赖闭包。不能先自己重写，再把上游当参考。无品牌的路径、目录、文件、模块、类型和函数名沿用原名。
3. 公开仓库没有 Desktop 前端源码时，按安装包中的合法可用实现与 REA 数据流还原；记录观察到的模块、导出、调用与状态。压缩符号和猜测名称不能冒充原始源码名。证据缺口只补查影响当前切片的部分，不能借此长期停在方案或重新设计。
4. 将实现直接接入 Lime 现役 owner，删除已被替代的旧布局、入口和状态副本。旧组件若妨碍复刻，就重构或替换；不为了复用旧组件而改变原版行为。禁止保留 `lime-rs/upstream/`、候选产品树或第二套业务后端。

## Lime 适配边界

- **品牌**：Lime 产品名、Logo、bundle/package、命令、配置根和发布身份继续使用 Lime；不复制 Codex 产品品牌。许可证署名与必须保留的第三方固定协议值按源码规则登记。
- **外观**：只保留 Codex 的浅色、深色、跟随系统模式，使用固定语义颜色。用户已取消 Lime 主题/皮肤例外，禁止恢复皮肤 catalog、随机切换、首页装饰及专用资源。
- **多模型/多协议**：保留现役模型选择、catalog、Provider 路由和能力判断；布局与交互沿用原版，必要模型选择接在同一位置和同一主链。
- **自有服务端**：继续调用 Lime 认证、服务端与发布合同，排除 Codex 登录、账号、Cloud、遥测、计费和产品服务控制面。公开源码中的本地 App Server JSON-RPC、runtime、工具和持久化仍应复制接入。
- 专家广场、消息渠道及用户后续明确保留的能力按当前仓库规则处理，不把这些例外扩张为其他自主产品设计。

## 执行与验收

在执行计划中简要记录“原版模块/证据 → Lime 目标文件 → 复制及必要适配 → 消费者切换 → 验证”。对任务没有帮助的规划、治理和规则扩写不应阻塞产品实现。

GUI 通过 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection` 消费同一业务状态。设置、授权、取消、工具执行和持久化使用现役 owner；renderer 不新增 authority 或平行历史。

逐项对照原版验收页面和状态：

- 页面区域、控件顺序、尺寸比例、密度、显隐条件及响应布局。
- 点击、键盘、焦点、滚动、弹层、加载、拒绝、停止、恢复与终态。
- 目录职责、无品牌名称、真实调用者与已删除的冲突实现。
- Lime 品牌、多模型和自有服务端仍由现役 owner 提供。

不能把“看起来合理”、旧 snapshot 通过或自拟设计图作为复刻完成依据。用户文案覆盖五语言；按 [质量规则](../../../internal/aiprompts/quality-workflow.md) 运行受影响测试和真实 GUI 验证，区分组件、Gate A 与 Desktop Gate B。

涉及边界时再读 [架构](../../../internal/aiprompts/architecture.md)、[命令](../../../internal/aiprompts/commands.md)、[工作台](../../../internal/aiprompts/workspace.md) 和 [GUI 验证](../../../internal/aiprompts/playwright-e2e.md)。报告实际完成的复刻、必要适配、测试与缺口，不将 skill 修订计入产品完成度。
