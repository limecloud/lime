# Lime 品牌边界与清理清单

这份清单只处理“源码已经进入 Lime owner 后如何收口”。上游名称可以出现在审计证据和许可证通知中，但不能继续成为 Lime 产品身份。

## Lime 专属能力优先级

Lime 的主题、品牌、多模型/多协议、Provider catalog 与 readiness、服务端协议和发布合同是现役产品事实源。复刻 Codex runtime 或 Computer Use 时只能接入这些边界，不能把 Codex 的单模型服务端、登录/Cloud/账号、遥测、计费或发布控制面带入 Lime，也不能为了上游目录一致而覆盖 Lime owner。

具体 owner、保留项与适配方式以 [Lime 保留边界](../../../../internal/aiprompts/codex-source-alignment.md#复刻注意项lime-保留边界) 为准。上游本地 App Server JSON-RPC、runtime、协议、持久化和工具实现可直接复用，不属于这里排除的云端产品服务。无品牌目录、文件、类型和函数保持上游原名，无须为了品牌清理全部改名。

## 禁止进入产品边界的内容

以下位置不得新增或保留 Codex 产品品牌、`codex-rs`、`codex_`、`codex-`、`.codex` 等 Lime 自有命名：

- 目录、文件、Rust crate、workspace member、package/bin、公开命令和环境变量。
- Electron bundle/package、Windows AUMID/Publisher/Product、安装包文件名和升级通道。
- Chrome/Office 扩展显示名、manifest、Native Messaging 注册、公开 RPC 方法、配置根和用户文案。
- App Server catalog、schema、测试 fixture、日志事件名、持久化根和发布产物。
- Lime 自有服务端、Provider、多模型和主题的 public boundary；这些能力即使与上游目录同名，也不能被 Codex 实现替换。

## 允许保留但必须登记的内容

只有下列类别的上游品牌字符串可以保留，并且要在复制账本写明来源、消费者和证据：

1. 许可证要求的版权、NOTICE 或第三方署名。
2. 外部协议、签名 manifest、固定 wire 值或与兼容性约定不可变的标识。
3. 明确支持的第三方应用集成契约，例如 `codex` 技能包目标、`~/.codex/skills` 和 `~/AGENTS.md`；这些指向外部应用，不能成为 Lime 自有产品的数据根或名称。

允许项不能向产品命名、UI 文案、路径或新 API 扩散。仅仅“上游原名”或“测试方便”不是保留理由。

## 收口检查顺序

1. `rg -n --hidden` 扫描现役目录的品牌词、`upstream/` 引用和 path dependency。
2. 读取 Cargo workspace、npm package、Electron/Chrome/Office manifest，确认构建图只指向 Lime owner。
3. 扫描生成 schema、fixture、安装包和 Native Messaging 注册，确认对外标识统一。
4. 删除临时整树目录后再次执行第 1 步；任何残留引用都阻断 `upstream-removed`。
5. 用真实 CLI、Electron、Chrome Native Host 和 Office session 运行门禁，证明清理没有切断同一 App Server/Thread/Turn/Item 主链。

## 账本字段

每个保留或改名项至少记录：`source_string`、`lime_string`、`surface`、`reason`、`evidence_id`、`owner`、`validation`。未登记的品牌残留按 `dead / forbidden-to-restore` 处理。
