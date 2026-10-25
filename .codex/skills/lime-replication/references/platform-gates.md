# Computer Use 平台门禁

| 端 | 正向证据 | 必须的失败/撤销证据 | 关键身份 |
| --- | --- | --- | --- |
| macOS Desktop | Electron 到签名 helper、AX/UI、截图和动作 | TCC 拒绝、锁屏、stop、目标切换 | bundle id、签名路径、窗口 revision |
| macOS CLI/TUI | Electron 退出后真实 stdio/PTY 调用 | 无 grant、helper 崩溃、取消收敛 | issuer、thread/turn、lease fence |
| Windows Desktop | UIA、DPI、输入、窗口和打包 | UIPI、secure desktop、锁屏、撤销 | AUMID/publisher/product/binary |
| Windows CLI/TUI | 独立安装、同一 App Server 合同和 canonical projection | helper 不可用、迟到响应、终止释放 | per-user identity、pipe ACL、lease |
| Chrome | MV3 → Native Messaging → shared App Server | profile/tab 导航失效、权限拒绝、Electron 关闭 | extension id、profile、tab、navigation epoch |
| Excel/Office | session discovery → schema → execute → readback | 未保存文档、部分失败、取消、重连 | executor session、opaque workbook id、generation |

每一行都要有版本、架构、进程链、target identity、授权决定、结果和清理记录。没有真实运行时，不得将该行标记为通过。
