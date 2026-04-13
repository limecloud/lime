# 图片生成模块

这里现在只保留供现役链路复用的 AI 生图 runtime、插图浮层与测试辅助。

## 当前事实源

- `useImageGen.ts`: AI 生图主 Hook，负责 provider、任务、保存与插图联动
- `RecentImageInsertFloating.tsx`: 最近插图浮层
- `types.ts`: 共享类型
- `test-utils.ts`: 相关测试辅助

## 导入约束

- 不再保留 `@/components/image-gen` 目录级 barrel 导出
- 现役代码必须直连子路径，例如 `@/components/image-gen/useImageGen`
- 共享类型与测试辅助分别走 `@/components/image-gen/types`、`@/components/image-gen/test-utils`

## 已收口的旧 surface

- 独立“插图”页面已经下线，不再作为产品入口
- 联网图片搜索已经迁到 Claw `@素材`
- 本地图片与“我的图片库”已经迁到资料库图片视图

## 使用方式

1. 在 Claw 工作台触发 AI 生图能力
2. 由 `useImageGen` 统一管理生成、保存与插图动作
3. 本地图片上传与图库浏览统一走资料库
