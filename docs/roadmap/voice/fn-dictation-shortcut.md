# Fn 语音输入快捷键方案

> 状态：current planning source
> 更新时间：2026-04-30
> 目标：定义截图参考中的 Fn 按住录音、松开转写体验，并明确它与现有普通全局快捷键的边界。

## 1. 固定目标

P0 目标：

1. Apple 键盘上支持 Fn 按住录音。
2. 松开 Fn 后停止录音并触发转写。
3. Fn 不可用时，稳定降级到自定义快捷键。
4. 设置页明确提示 Fn 的系统限制和第三方键盘处理方式。
5. 现有 `CommandOrControl+Shift+V` 类普通快捷键继续工作。

非目标：

1. 不承诺 Windows 上支持 Fn。
2. 不承诺所有第三方键盘支持 Fn。
3. 不把 Fn 写入现有 shortcut 字符串解析器。
4. 不做系统键盘设置自动修改。

## 2. 现有实现边界

当前语音快捷键在 `src-tauri/src/voice/shortcut.rs` 中实现：

1. 使用 `tauri_plugin_global_shortcut`。
2. 通过字符串解析 `Shortcut`。
3. `Pressed` 时打开语音浮窗。
4. `Released` 时发送停止录音事件。

这条路径适合普通组合键：

```text
CommandOrControl+Shift+V
Alt+Space
Control+Option+V
```

Fn 不应进入这条路径。原因：

1. Fn 在 macOS 上经常不是普通 keyboard accelerator。
2. 系统可能把 Fn/地球仪键绑定到输入法、表情、听写或其他系统行为。
3. 第三方键盘对 Fn 的上报方式不统一。
4. 直接注册可能出现“配置成功但无事件”的假成功。

## 3. 配置模型

语音输入配置新增触发模式：

```rust
pub enum VoiceShortcutTriggerMode {
    FnHold,
    CustomShortcut,
}
```

配置字段：

```rust
pub struct VoiceInputConfig {
    pub trigger_mode: VoiceShortcutTriggerMode,
    pub shortcut: String,
    pub fn_shortcut_enabled: bool,
}
```

默认策略：

| 平台 / 设备 | 默认模式 |
| --- | --- |
| macOS + Apple 键盘 | `FnHold` |
| macOS + 未知键盘 | `CustomShortcut` |
| Windows | `CustomShortcut` |
| Linux | `CustomShortcut` |

`shortcut` 字段继续保留，作为 fallback 与用户自定义快捷键。

## 4. macOS Fn 主路径

### 4.0 当前实现进度

2026-04-30 已落地第一刀：

1. `src-tauri/src/voice/fn_shortcut.rs` 通过 macOS `NSEventMaskFlagsChanged` 监听 Fn 修饰键状态。
2. Fn 按下复用 `open_floating_window_with_voice`，Fn 松开复用 `send_voice_stop_event`，不新增第二套语音窗口流程。
3. 监听随语音输入启用/停用注册和注销；普通语音快捷键仍作为 fallback 保留。
4. 运行时状态已接入 `get_voice_shortcut_runtime_status` 和设置页 Fn 状态展示。
5. 尚未实现本方案里的 `trigger_mode` / `fn_shortcut_enabled` 配置分流；当前是“启用语音输入时同时注册普通快捷键与 macOS Fn 监听”的最小可用形态。

### 4.1 监听模块

新增 macOS-only 模块，例如：

```text
src-tauri/src/voice/fn_shortcut_macos.rs
```

职责：

1. 启动 Fn 事件监听。
2. 判断 press / release。
3. 去抖，避免重复打开语音窗。
4. 把事件转发给现有语音窗口函数。
5. 暴露状态给设置页。

事件行为：

| 事件 | 行为 |
| --- | --- |
| Fn pressed | 打开语音浮窗并开始录音 |
| Fn repeated | 忽略 |
| Fn released | 发送停止录音事件 |
| 监听失败 | 标记 Fn 不可用，降级自定义快捷键 |

### 4.2 权限与系统设置

Fn 监听可能需要系统辅助功能、输入监听或键盘相关权限。实现时必须提供可解释状态：

| 状态 | 含义 | UI 提示 |
| --- | --- | --- |
| `available` | Fn 可监听 | 正常显示 Fn |
| `permission_required` | 缺少权限 | 引导到系统设置授权 |
| `system_reserved` | 系统占用 Fn/地球仪键 | 提示改系统“按地球仪键”为“什么都不做” |
| `unsupported_keyboard` | 当前键盘不支持 | 建议使用自定义快捷键 |
| `unknown_error` | 其他错误 | 保留诊断信息 |

UI 文案沿用截图含义：

> Fn 键仅支持 Apple 键盘（内置或妙控键盘），第三方键盘请点击左侧按钮自定义快捷键。建议在「系统设置 -> 键盘 -> 按地球仪键」中设为「什么都不做」以避免干扰。

### 4.3 降级策略

Fn 不可用时：

1. 不阻断语音功能。
2. 自动显示自定义快捷键配置。
3. 保留现有 `shortcut` 注册路径。
4. 运行时状态说明“Fn 当前不可用，已使用自定义快捷键”。

## 5. 普通快捷键兼容

`src-tauri/src/voice/shortcut.rs` 继续负责普通快捷键。

需要调整：

1. 注册时根据 `trigger_mode` 分流。
2. `FnHold` 模式只启动 macOS Fn 监听。
3. `CustomShortcut` 模式继续注册 `shortcut` 字符串。
4. 切换模式时先注销旧监听，再注册新监听。
5. 如果 Fn 注册失败，尝试注册 `shortcut` fallback。

不改动：

1. 现有 press 打开语音窗逻辑。
2. 现有 release 停止录音事件。
3. 翻译快捷键的普通 shortcut 路径。

翻译模式 P0 不绑定 Fn。Fn 只作为主语音输入触发键。

## 6. 前端设置页

设置页顶部新增 Fn 控制区：

1. Fn 胶囊按钮。
2. 启用开关。
3. 当前运行状态。
4. 系统限制提示。
5. 自定义快捷键 fallback 入口。

状态展示：

| 状态 | UI |
| --- | --- |
| Fn 可用 | 显示绿色可用状态 |
| 权限缺失 | 显示警告和打开系统设置按钮 |
| 系统占用 | 显示系统设置建议 |
| 第三方键盘 | 显示自定义快捷键入口 |
| fallback 生效 | 显示当前 fallback 快捷键 |

交互规则：

1. 用户关闭 Fn 开关后，直接进入 `CustomShortcut`。
2. 用户打开 Fn 开关但不可用时，不覆盖现有可用 shortcut。
3. 保存失败时恢复旧设置。

## 7. 命令与合同

若新增 Tauri command，必须同步四侧：

1. 前端 `safeInvoke(...)`
2. Rust `tauri::generate_handler!`
3. `agentCommandCatalog`
4. `mockPriorityCommands` / `defaultMocks`

建议命令：

| 命令 | 作用 |
| --- | --- |
| `voice_shortcut_get_runtime_status` | 获取 Fn 与普通快捷键运行状态 |
| `voice_shortcut_set_trigger_mode` | 切换 Fn / 自定义快捷键模式 |
| `voice_shortcut_probe_fn` | 探测 Fn 是否可监听 |
| `voice_shortcut_open_keyboard_settings` | 打开系统键盘设置或权限设置 |

运行时状态需要结构化返回：

```json
{
  "triggerMode": "fn_hold",
  "fnStatus": "permission_required",
  "fallbackShortcut": "CommandOrControl+Shift+V",
  "registeredShortcut": null,
  "message": "需要授权输入监听权限"
}
```

## 8. 测试计划

Rust：

1. `FnHold` 模式不调用普通 shortcut parser。
2. `CustomShortcut` 模式仍注册普通快捷键。
3. Fn 注册失败时 fallback 到 `shortcut`。
4. 切换模式时旧监听被注销。
5. repeated press 不重复打开窗口。

前端：

1. Fn 可用状态展示。
2. 权限缺失提示。
3. 第三方键盘 fallback 提示。
4. 用户关闭 Fn 后显示自定义快捷键。
5. 保存失败恢复旧配置。

GUI：

```bash
npm run verify:gui-smoke
```

合同：

```bash
npm run test:contracts
```

收口：

```bash
npm run verify:local
```

## 9. 验收标准

1. Apple 键盘上按住 Fn 能启动录音，松开后转写。
2. Fn 不可用时，用户能清楚知道原因和 fallback。
3. 第三方键盘用户仍能使用自定义快捷键完成同一语音输入流程。
4. 现有输入栏听写、悬浮语音窗、翻译快捷键不被破坏。
5. 设置页不会展示“Fn 已启用”但运行时实际没有监听的假状态。

## 10. 这一步如何服务主线

Fn 快捷键的主线收益是：

**把语音输入从“需要记住组合键”推进到“按住说话”的低摩擦桌面交互，同时保留普通快捷键作为可靠兜底。**
