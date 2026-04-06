# artifact

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

Artifact 系统核心库，提供统一的结构化内容抽象层。
用于从 AI 响应中提取、管理和渲染各种类型的结构化内容。

## 文件索引

- `types.ts` - Artifact 类型定义（Requirements 1.1, 1.2, 1.4, 1.5）
  - ArtifactType 联合类型
  - ArtifactStatus 状态枚举
  - Artifact、ArtifactMeta、ArtifactRendererProps 接口
  - RendererEntry 渲染器注册项接口
  - 类型检查辅助函数

- `parser.ts` - AI 响应解析器（Requirements 2.1, 2.2, 2.4, 2.6）
  - ArtifactParser 类 - 支持流式解析和增量更新
  - ParseResult、ParserConfig 接口
  - artifact fence 解析（` ```artifact type="..." `）
  - 标准 code fence 解析（` ```language `）
  - 属性提取（type, language, title）
  - 位置信息记录
  - serializeArtifact、artifactContentEqual 辅助函数

- `registry.ts` - 渲染器注册表（Requirements 3.1-3.6）
  - ArtifactRegistry 类 - 单例模式管理渲染器
  - register、get、has、getAll 方法
  - isCanvasType、getFileExtension 辅助方法

- `store.ts` - Jotai 状态管理（Requirements 9.1-9.5）
  - artifactsAtom - Artifact 列表
  - selectedArtifactIdAtom、selectedArtifactAtom - 选中状态
  - streamingArtifactAtom - 流式状态
  - artifactActionsAtom - 操作 atom

- `hooks/` - React Hooks
  - `useDebouncedValue.ts` - 现役防抖 Hook（Requirements 11.2）
  - `index.ts` - 最小公共导出入口

- `index.ts` - 模块导出入口

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
