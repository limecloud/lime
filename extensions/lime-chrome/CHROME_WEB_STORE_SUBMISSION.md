# Lime Browser Bridge Chrome 商店提交底稿

本文档用于填写 Chrome Web Store 开发者后台的上架表单、审核备注与数据使用说明。

## 基础信息

- 扩展名称：`Lime Browser Bridge`
- 当前版本：`0.3.0`
- 上传包：`tmp/lime-chrome-0.3.0.zip`
- 上传包 SHA-256：`65838b438f96bcd58ebd8464bd92ba2aeb362512fe99ea1f857a631330d4f542`
- 建议分类：`Productivity`
- 建议语言：`English`

## 单一句用途

`Lime Browser Bridge` 的单一用途是把用户当前 Chrome 标签页连接到本地运行的 Lime 桌面端，让 Lime 在用户明确触发浏览器相关任务时读取当前页面上下文，并在当前浏览器中执行对应操作。

## Short Description

Connect Lime to your current Chrome tab so Lime can read page context and perform browser actions through your local desktop runtime.

## Detailed Description

Lime Browser Bridge is the companion Chrome extension for the Lime desktop app.

It connects your current Chrome session to a locally running Lime runtime so Lime can:

- read the active page title, URL, and page content
- execute browser actions such as open URL, click, type, scroll, switch tab, and go back
- keep browser control attached to the tabs you are already using instead of launching a separate managed browser
- reconnect automatically when Lime is running again

This extension is designed for users who already use Lime on their desktop and want browser-aware AI workflows inside their existing Chrome session.

The extension does not provide a consumer cloud service by itself. It works only with a user-configured or locally exported Lime connection and only operates on pages the user chooses to open or control.

## 审核备注

可直接粘贴给审核团队：

This extension is a companion bridge for the Lime desktop application. Its single purpose is to connect the user's existing Chrome tabs to a locally running Lime runtime so Lime can inspect the current page and perform browser actions requested by the user.

The `debugger` permission is required because some actions rely on Chrome DevTools Protocol, including screenshot capture, coordinate-based interactions, raw keyboard input, and page lifecycle inspection. Chrome will show its standard debugger banner during those actions.

The `<all_urls>` host permission is required because users may ask Lime to work with arbitrary websites in their existing session. The extension does not run on `chrome://` pages and does not inject persistent scripts into every site by default; it injects scripts on demand when a read or action request occurs.

The extension stores only local configuration and recent bridge status in Chrome storage. It sends page data only to the user-configured Lime runtime endpoint, which is local by default.

## 权限说明

### `debugger`

用于通过 Chrome DevTools Protocol 执行以下能力：

- 页面结构读取
- 截图
- 坐标点击与键盘输入
- 页面生命周期与标签页调试会话管理

### `tabs` / `tabGroups` / `windows` / `activeTab`

用于读取当前标签页、切换标签页、聚合 Lime Agent 打开的标签页，并把用户带回正确的窗口。

### `scripting`

用于在用户当前操作的网页上按需注入内容脚本，以抓取页面内容或执行页面内动作。

### `storage`

用于保存以下本地状态：

- `serverUrl`
- `bridgeKey`
- `profileKey`
- 开关状态
- 最近一次页面快照摘要
- relay 连接状态与端口信息

### `clipboardRead`

仅在用户点击弹窗中的粘贴配置操作时使用，用于把 Lime 导出的配置粘贴到扩展设置。

### `alarms`

用于维持 MV3 service worker 存活和断线自动重连。

### `notifications`

用于在本地 relay 异常时向用户展示浏览器内提示。

### `<all_urls>`

用于支持用户在任意常规网页上让 Lime 读取内容或执行浏览器动作。该权限不会用于 `chrome://` 等 Chrome 内部页面。

## 数据使用填写建议

以下内容是后台数据使用问卷的建议答案，请以上线前实际条目为准再核对一遍。

### 收集的数据

- Website content
- Website URLs
- Page titles
- User-provided connection settings
- Optional screenshots captured from the active tab during requested actions

### 数据用途

- Extension functionality

### 是否出售数据

- No

### 是否用于广告

- No

### 是否用于信用评估或放贷

- No

### 是否与数据经纪人共享

- No

### 数据传输说明

- Page data is sent only to the user-configured Lime runtime endpoint.
- The default endpoint is local (`ws://127.0.0.1:8999`).
- The extension does not include analytics, ad SDKs, or third-party tracking code.

## 截图建议

建议准备至少 3 张 `1280x800` 截图：

1. 安装引导页
2. 扩展状态/连接页
3. 连接后由 Lime 控制当前浏览器标签页的示意页

已生成的本地截图草稿：

- `tmp/chrome-store-assets/install-extension-1280x800.png`
- `tmp/chrome-store-assets/compare-methods-1280x800.png`
- `tmp/chrome-store-assets/options-connected-clean-1280x800.png`

## 发布前核对

- 确认后台条目是否就是 `cpidmllglbedhpombjibeoalnafofipo`
- 确认隐私政策 URL 已填写且外网可访问；当前仓库内草稿文件为 `extensions/lime-chrome/PRIVACY_POLICY.md`
- 确认截图、分类、语言、可见性、地区都已补齐
- 确认审核备注已说明 `debugger` 与 `<all_urls>` 的必要性
