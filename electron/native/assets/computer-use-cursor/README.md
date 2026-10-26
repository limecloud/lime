# Lime Computer Use 指针

配色直接取自 `public/logo-v6.svg` 的 `ringGrad`：深青绿 → 翡翠绿 → 青柠绿 → 浅绿。按用户提供的小箭头参考使用约 14 px 的圆角轮廓、1.2 px 渐变描边和 12% 透明填充，不使用传统长尾。24 帧、1.6 秒循环包括渐变流动、柔和径向光晕呼吸，以及围绕尖端 ±4° 的轻微晃动；点击热点固定。

- Windows：`windows/lime-pointer.ani` 为 RIFF ACON 动态光标，每帧含 32/48/64 px、32-bit BGRA 与透明遮罩；`lime-pointer.cur` 为静态首帧。生成器将同一 ANI 的全部像素转换为 top-down premultiplied BGRA，编入 `windows-computer-use-cursor-frames.h`，由现役 helper 的非交互 layered window 显示；热点覆盖 100/150/200% DPI，关闭系统动画时显示首帧。鼠标动作期间临时可见性使用 Magnification API，不修改 cursor scheme；动作后恢复系统光标，保留独立 Agent 叠层。隐藏前建立同一 helper 的私有恢复子进程，检查它已脱离父 job；退出、心跳过期、取消、手动输入、失焦、锁屏走恢复路径。恢复进程不可用时鼠标动作明确失败。像素一致性与交叉编译已通过，真实 Windows 显示、HID、Job、崩溃恢复和高于 200% DPI 的效果仍未验收。
- macOS：`macos/frames` 为 40×40，`frames@2x` 为 80×80 Retina，透明画布为光晕留白，箭头本体仍约 14 px。现役 helper 使用生成的 Swift 帧资源与 AppKit/Core Animation 叠层，获批观察、截图、键盘或鼠标动作激活展示；停留时继续晃动。鼠标动作后恢复系统光标，模型等待期间保留 Agent 叠层。用户输入、切换应用、锁屏、撤权、取消、错误或 helper 结束时清理；匹配回合终态经共享 `finish_turn` 收口，旧回合的迟到清理不关闭新回合指针。跟随系统“减少动态效果”设置，启用时仅显示首帧。
- 两个 `preview.gif` 仅供预览，不作为操作系统光标格式。PNG/SVG 为透明底。

再生成：`node scripts/electron/generate-computer-use-cursor.mjs`，需要开发机已有的 `rsvg-convert` 和 ImageMagick。生成的 Swift 帧直接编入现役 helper，随同现有 SHA256 清单和签名闭包交付，运行时不读取外部图片目录。不要修改系统默认指针设置或全局注册。

只从现有 Windows ANI 更新嵌入数据：`node scripts/electron/generate-computer-use-cursor.mjs --embed-windows-only`；该命令不重写 macOS 资源。Windows 恢复模式只恢复临时可见性，不承接授权、工具、会话或 App Server 业务。

这是用户明确要求的 Lime 品牌适配，不作为 Codex 原生资源复制声明。

生命周期与验证边界见 [指针专题](../../../../internal/exec-plans/native-computer-use-cursor-lifecycle-20261026.md)。固定 2.4 秒空闲隐藏已移除；展示不占用跨工具输入 lease。macOS 原生探针通过不代表 Windows 实机或 Desktop/CLI/TUI 全部验收。

速度与按压计算由 `electron/native/computer-use-cursor-motion.h` 唯一提供，Swift 通过构建时 bridging header、Windows 通过 C++ include 直接消费。移动驱动微旋转和沿速度方向的拉伸；点击保留短按视觉反馈，拖拽保持压下，释放后恢复，热点仍在真实输入位置。减少动态效果返回原始静态帧。资源像素未重画，仍使用 Lime Logo 渐变。这些运动参数是 Lime 平台适配，不声称取自原版私有实现；实际验证及未验项见[运动专题](../../../../internal/exec-plans/native-computer-use-cursor-motion-20261026.md)。
