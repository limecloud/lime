# OEM Logo 快速替换指南

> 状态：current oem derivative
> 更新：2026-04-19
> 上游事实源：brand.md、slogan.md

本文用于未来 OEM / 代理商定制时，快速把 Lime 的品牌图替换为代理商品牌图，并尽量让 AI 一次完成主要资产更新。

目标不是讲设计理论，而是提供一条可执行、可复用、低沟通成本的流程。

## 适用范围

适用于以下两类需求：

1. 只替换图形 Logo，不改产品名、包名、文案。
2. 同时替换 Logo 与对外品牌名，例如启动页 slogan、README 下载文案、发布说明。

## 当前确认的 Lime 主 Logo

当前仓库已经确认的正式主 Logo 原图是：

```text
./lime-claw.png
```

说明：

1. 该文件为透明底 `2048x2048` 主 Logo。
2. 当前前端 Logo、启动页 Logo、桌面端打包图标都应以这张图为准。
3. `./logo-lime.png` 可视为不带 claw 的备用图，不是当前默认主 Logo。

## 当前仓库里的关键 Logo 落点

执行 OEM 替换时，优先关注这些位置：

- 通用前端 Logo：`public/logo.png`
- 启动页专用 Logo：`public/logo-splash.png`
- 桌面端打包图标：`src-tauri/icons/`
- 浏览器页签图标：`index.html` 中引用的 `/logo.png`
- 直接引用前端 Logo 的页面：
  - `src/components/AppSidebar.tsx`
  - `src/components/SplashScreen.tsx`
  - `src/components/onboarding/steps/WelcomeStep.tsx`
  - `src/components/settings-v2/system/about/index.tsx`
  - `src/components/agent/chat/components/MessageList.tsx`

注意：

- `src-tauri/icons/tray/*` 是托盘状态图，不一定适合直接换成 OEM Logo。
- 如果只是换品牌图，通常不要动 tray 状态图。

## 推荐输入物

给 AI 或执行者提供以下输入，成功率最高：

1. 一张高分辨率透明底主 Logo，建议 `2048x2048` 或更高。
2. 一个简短的品牌定位描述。
   例如：`偏企业、稳重、科技蓝绿` 或 `轻快、创意、果汁感`
3. 是否需要同步替换 slogan。
4. 是否需要同步替换产品名。

推荐把 OEM 原始图先放到仓库根目录，命名为：

```text
oem-logo.png
```

如果还有启动页专用版本，也可以额外提供：

```text
oem-logo-splash.png
```

## 标准替换流程

### 方案 A：只替换 Logo

1. 把 OEM Logo 放到仓库根目录，例如 `oem-logo.png`
2. 让 AI 先扫描引用点和打包图标目录
3. 更新 `public/logo.png`
4. 单独生成 `public/logo-splash.png`
5. 同步生成 `src-tauri/icons/` 下的桌面端图标资产
6. 保持 `src-tauri/icons/tray/*` 不变
7. 跑 `npm run lint`

### 方案 B：Logo + 品牌名一起替换

在方案 A 基础上，再额外处理：

1. 启动页 slogan
2. README 下载说明
3. `RELEASE_NOTES.md`
4. 如果是完整品牌切换，再继续检查：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - 深链 scheme
   - 安装包命名
   - GitHub Release 文案

## 推荐给 AI 的单次提示词

下面这段可以直接复制给 AI，通常一轮就能完成大部分替换：

```text
请帮我把当前仓库的品牌图替换为 OEM Logo。

输入图片路径：
- 主 Logo：./oem-logo.png

要求：
1. 先扫描仓库里当前 logo 的引用点和图标资产，不要盲改。
2. 替换通用前端 logo：public/logo.png
3. 为启动页单独生成一张更适合大尺寸展示的专用图：public/logo-splash.png
4. 同步更新 src-tauri/icons/ 下的桌面端打包图标，包括 png / ico / icns / ios / android 图标集
5. 不要替换 src-tauri/icons/tray/*，这些是状态图标
6. 如果启动页当前复用通用 logo，请改成单独引用 logo-splash.png
7. 如果启动页视觉太小，请顺手调整 SplashScreen 的布局和尺寸，让 logo 更显眼
8. 除非我明确要求，不要改产品名、包名、identifier
9. 修改完成后执行 npm run lint
10. 最后告诉我改了哪些文件、哪些图标已同步、哪些没有动

实现约束：
- 修改前先读文件
- 不要改无关业务逻辑
- 保持 macOS / Windows / Android / iOS 图标资产一致
```

## 如果还要一起改 slogan

把上面的提示词补充为：

```text
另外把启动页改成只保留 logo、slogan、进度动画。
新的 slogan 是：
“青柠一下，灵感即来”
产品副标是：
“把一个内容任务推进为可交付结果”
可选说明行是：
“技能起手，灵感入库，生成推进”
```

如果需要统一引用当前确认的品牌方案，优先查看：

- `docs/oem/brand.md`

## 如果还要一起改品牌名

把上面的提示词再补充为：

```text
这是一次 OEM 品牌替换，不只是换图。
请额外扫描并更新对外展示名称、README、RELEASE_NOTES、GitHub Release 文案。
但先不要擅自修改历史 tag。
```

## AI 执行后的核对清单

完成后至少检查以下内容：

### 视觉核对

- 浏览器页签是否已经换成 OEM Logo
- 侧边栏 / About / 欢迎页是否已经换图
- 启动页是否明显使用了单独的大图，而不是缩小后的通用 logo
- 启动页 Logo 是否居中，是否存在透明留白过大问题

### 打包核对

- `src-tauri/icons/icon.png`
- `src-tauri/icons/icon.ico`
- `src-tauri/icons/icon.icns`
- `src-tauri/icons/ios/*`
- `src-tauri/icons/android/*`

### 命令核对

```bash
npm run lint
```

如果这次同时改了 Tauri 或 Rust 相关资源生成流程，补跑：

```bash
cargo check --manifest-path "src-tauri/Cargo.toml" --offline
```

## 常见问题

### 1. 启动页 logo 看起来还是小

通常不是图片太小，而是：

- 启动页复用了 `public/logo.png`
- Logo 外面套了过厚的卡片、边框或内边距
- 透明边界太大

解决方式：

1. 单独生成 `public/logo-splash.png`
2. 把启动页改成专用引用
3. 去掉厚重容器，只保留大 logo + slogan + 进度动画

### 2. Windows Release 里只看到一个 setup.exe

这通常不是图标问题，而是 CI 的 Windows 在线包 / 离线包命名或上传逻辑有冲突。

重点检查：

- `.github/workflows/release.yml`
- `assetNamePattern`
- Windows offline / online 构建顺序

### 3. tray 图标看起来不适合直接 OEM

这是正常的。

tray 图标承担的是状态表达，不是品牌海报位。除非 OEM 要求非常明确，否则建议保持原状态图逻辑不变。

## 建议的资产策略

未来长期维护时，建议默认拆成两类资源：

1. 通用品牌图
   - `public/logo.png`
   - `src-tauri/icons/*`

2. 场景专用品牌图
   - `public/logo-splash.png`

这样后续即使继续 OEM，也能避免“一个 logo 到处复用，结果某个场景总显得小或不协调”。
