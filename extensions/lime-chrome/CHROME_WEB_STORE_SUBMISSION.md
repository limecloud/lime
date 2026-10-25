# Lime Computer Use 商店更新材料

日期：2026-10-25。替换旧条目；用户已明确授权发布。本材料取代 0.4.0 旧 WS 版本文案。
当前开发版本 0.5.0；上传前以开发者后台的真实条目 ID、公钥和线上版本确认最终包。

## Single purpose

Connect Chrome to the user's local Lime Desktop or CLI runtime so the user can
organize task tabs and explicitly approve browser observation and control.

## Short description

Control approved Chrome tabs from Lime Desktop or CLI, with native task tab groups.

## Detailed description

Lime Computer Use is the companion Chrome extension for Lime Desktop and CLI.

- Connect to the locally installed Lime Native Messaging host.
- Create native Chrome tab groups with task names, including emoji.
- Keep task child tabs together and preserve existing user tab groups.
- Approve a selected tab before Lime can observe, capture, click, type, or scroll.
- Revoke control through Lime. Each tab requires its own target-bound authority.

The extension requires a compatible local Lime installation. Creating a group
alone does not authorize control. It does not contain a cloud account, remote
code loader, advertising, or analytics SDK. Requested content may be processed
by the model provider the user configures in Lime.

## 权限理由

| 权限             | 实际用途                                                           |
| ---------------- | ------------------------------------------------------------------ |
| debugger         | 获批标签页截图与坐标鼠标/键盘输入；保留 Chrome 标准调试提示        |
| tabs / activeTab | 报告可选 HTTP/HTTPS 标签页身份、URL；按目标授权执行                |
| tabGroups        | 原生任务名称、颜色、子标签页分组；不移动用户已有分组               |
| scripting        | 获批标签页按需读取渲染内容，不常驻全站 content script              |
| nativeMessaging  | 与本机 `com.limecloud.lime.computer_use` host 通信                 |
| storage          | 随机 profile ID、任务名称、组/标签页关联、连接状态                 |
| alarms           | MV3 断线重连                                                       |
| all_urls         | 用户可选择任意常规 HTTP/HTTPS 网页；实际发现/执行过滤为 HTTP/HTTPS |

## 数据使用与审核说明

处理 Website content（DOM/表单/截图）、当前标签页 URL/标题、用户任务输入和本地任务组元数据。
仅用于扩展功能，不出售、不用于广告、放贷或数据经纪。浏览器数据经 Native Messaging
交给本机 Lime；Lime 可按用户配置把所需内容交给模型 Provider，不能宣称数据永不离开本机。
不使用 history/cookies/clipboard API，不复制旧 WS endpoint/key 配置。
无 remote hosted code：worker 的模块和注入观察函数均随扩展包提供。

审核步骤：安装兼容 Lime → 开启 Chrome 通道并注册 Native Host → 安装此扩展 →
打开测试 HTTP/HTTPS 页面 → 在 Lime 选择目标并请求连接 → 扩展弹窗明确允许 →
请求一次观察/输入/截图并核对页面 → 撤销授权。分组可从扩展 popup 输入任务名和起始网址创建。
真实本机测试为隔离 Chrome + 本地模型协议 fixture，不声称真实模型或 Windows 已验收。

## 上传前核对

- 使用旧条目的“上传新软件包”，不创建另一条目；版本必须高于后台当前版本。
- 从旧条目取公钥，使解压开发 ID、商店 ID、Native Messaging allowed origin 保持一致。
- 本仓库历史候选 `cpidmllglbedhpombjibeoalnafofipo` 未经后台确认；当前 key 推导
  `okipgpdaiijkenehohfgochhhlbifcbc`，不能据此直接发布或改 allowed origin。
- 旧权限 clipboardRead/notifications 已删除，新增 nativeMessaging；后台权限说明同步本表。
- 隐私政策使用本目录最新版，并核实后台的公开 URL 能访问这版内容。
- 旧安装/配置截图反映 WS 0.4.0，应替换为当前 Native Messaging popup/分组截图。
- 最后记录上传包 SHA、提交结果、审核状态和可见版本；上传成功不等于审核通过。
