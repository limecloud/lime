# Release v0.76.0

发布日期：2026-03-02

## 📊 变更统计

- **88 个文件变更**
- **新增 9,642 行代码**
- **删除 2,925 行代码**
- **净增 6,717 行代码**

## 🎉 重点功能

### 1) 图片搜索能力落地（含 Pixabay）

- 新增后端命令：`src-tauri/src/commands/image_search_cmd.rs`
- 新增搜索逻辑 Hook：`src/components/image-gen/hooks/useImageSearch.ts`
- 新增搜索页签：`src/components/image-gen/tabs/ImageSearchTab.tsx`
- 新增系统设置与测试：
  - `src/components/settings-v2/system/web-search/index.tsx`
  - `src/components/settings-v2/system/web-search/index.test.tsx`
- 支持在设置页配置并启用图片搜索相关 Key（含 Pixabay）

### 2) 图片工作台重构（可插入创作流程）

- 图片页拆分为多 Tab 结构：
  - `AiImageGenTab.tsx`
  - `ImageSearchTab.tsx`
  - `LocalImageTab.tsx`
  - `MyGalleryTab.tsx`
- 新增最近插入浮层：`src/components/image-gen/RecentImageInsertFloating.tsx`
- 统一插入通道与目标追踪：
  - `src/lib/activeContentTarget.ts`
  - `src/lib/canvasImageInsertBus.ts`
  - `src/lib/documentImageInsertBus.ts`
  - `src/lib/canvasImageInsertHistory.ts`

### 3) 覆盖多画布插入能力（主题创作可用）

- 文稿画布：`DocumentCanvas.tsx` / `NotionEditor.tsx` / `autoImageInsert.ts`
- 海报画布：`PosterCanvas.tsx`
- 视频画布：`VideoCanvas.tsx`
- 音乐画布：`MusicCanvas.tsx`
- 小说画布：`NovelCanvas.tsx`
- 脚本画布：`ScriptCanvas.tsx`

### 4) 稳定性与工程完善

- 新增崩溃上报模块：`src-tauri/src/crash_reporting.rs`、`src/lib/crashReporting.ts`
- 调整启动/配置与命令注册链路（含 `src-tauri/src/lib.rs`、`src-tauri/src/commands/mod.rs`）
- 补充测试覆盖（图片搜索、设置项、插入流程、工作台对话框）

## 🔧 版本同步

已同步版本号到：
- `package.json`: `0.76.0`
- `src-tauri/Cargo.toml`: `0.76.0`
- `src-tauri/tauri.conf.json`: `0.76.0`

## 🚀 升级建议

1. 打开设置页，检查图片搜索服务配置（含 Pixabay Key）
2. 在任一创作主题画布中触发图片搜索并执行插入
3. 验证插入目标是否符合当前激活画布

---

**完整变更日志**：https://github.com/aiclientproxy/proxycast/compare/v0.75.0...v0.76.0
