# Lime Computer Use 指针

配色直接取自 `public/logo-v6.svg` 的 `ringGrad`：深青绿 → 翡翠绿 → 青柠绿 → 浅绿。按用户提供的小箭头参考使用约 14 px 的圆角轮廓、1.2 px 渐变描边和 12% 透明填充，不使用传统长尾。24 帧、1.6 秒循环包括渐变流动、柔和径向光晕呼吸，以及围绕尖端 ±4° 的轻微晃动；点击热点固定。

- Windows：`windows/lime-pointer.ani` 为 RIFF ACON 动态光标，每帧含 32/48/64 px、32-bit BGRA 与透明遮罩；`lime-pointer.cur` 为减少动态效果时的静态版本。热点按 100/150/200% DPI 缩放。文件结构已验证，Windows 实机加载和 Computer Use 驱动接入仍需 Windows 验收。
- macOS：`macos/frames` 为 40×40，`frames@2x` 为 80×80 Retina，透明画布为光晕留白，箭头本体仍约 14 px。现役 helper 使用生成的 Swift 帧资源与 AppKit/Core Animation 叠层，随获批鼠标输入显示；停留时继续晃动，用户移动鼠标、切换应用、锁屏、取消、错误、空闲 2.4 秒或 helper 结束时恢复普通指针。跟随系统“减少动态效果”设置，启用时仅显示首帧。
- 两个 `preview.gif` 仅供预览，不作为操作系统光标格式。PNG/SVG 为透明底。

再生成：`node scripts/electron/generate-computer-use-cursor.mjs`，需要开发机已有的 `rsvg-convert` 和 ImageMagick。生成的 Swift 帧直接编入现役 helper，随同现有 SHA256 清单和签名闭包交付，运行时不读取外部图片目录。不要修改系统默认指针设置或全局注册。

这是用户明确要求的 Lime 品牌适配，不作为 Codex 原生资源复制声明。
