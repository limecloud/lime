# Artifact 组件

Artifact 系统的 UI 组件，用于渲染和管理各种类型的结构化内容。
当前 `index.ts` 只保留工作区预览主链正在使用的最小公共入口；其余渲染器与适配辅助默认按文件级路径直接引用。

## 目录结构

```
artifact/
├── renderers/                  # 各类型渲染器
│   ├── CodeRenderer.tsx        # 代码渲染器
│   ├── ArtifactDocumentRenderer.tsx # 结构化文档渲染器
│   ├── HtmlRenderer.tsx        # HTML 渲染器
│   ├── SvgRenderer.tsx         # SVG 渲染器
│   ├── MermaidRenderer.tsx     # Mermaid 渲染器
│   ├── ReactRenderer.tsx       # React 渲染器
│   └── index.ts                # 渲染器导出
├── ArtifactRenderer.tsx        # 统一渲染入口
├── ArtifactToolbar.tsx         # 工具栏组件
├── ArtifactCanvasOverlay.tsx   # 写入首段到达前的过渡遮罩
├── CanvasAdapter.tsx           # Canvas 系统适配器
├── ErrorFallbackRenderer.tsx   # 错误回退渲染器
├── README.md                   # 本文件
└── index.ts                    # 模块导出
```

## 渲染器组件

### CodeRenderer

代码渲染器，支持语法高亮、行号显示、复制功能和流式内容更新。

**功能特性：**
- 使用 react-syntax-highlighter 实现语法高亮
- 显示行号（超过 1 行时）
- 提供复制到剪贴板功能
- 支持从 artifact 元数据检测语言
- 支持流式内容更新，无闪烁

**使用示例：**
```tsx
import { CodeRenderer } from '@/components/artifact/renderers/CodeRenderer';

<CodeRenderer
  artifact={{
    id: '1',
    type: 'code',
    title: 'example.ts',
    content: 'const hello = "world";',
    status: 'complete',
    meta: { language: 'typescript' },
    position: { start: 0, end: 0 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }}
  isStreaming={false}
/>
```

## 当前 barrel 入口

`src/components/artifact/index.ts` 当前只对外暴露：

- `ArtifactRenderer`
- `ArtifactToolbar`
- `ArtifactCanvasOverlay`
- `registerLightweightRenderers`

其余实现细节（如 `CanvasAdapter`、`ErrorFallbackRenderer`、各具体 renderer）默认视为文件级实现，不再作为通用公共入口继续扩散。

## 相关文档

- [Artifact 类型定义](../../lib/artifact/types.ts)
- [Artifact 解析器](../../lib/artifact/parser.ts)
- [Artifact 状态管理](../../lib/artifact/store.ts)


## ArtifactRenderer

Artifact 统一渲染入口组件，根据类型分发到对应的渲染器。

**功能特性：**
- 根据 Artifact 类型分发到对应的渲染器
- Canvas 类型委托给 Canvas 系统处理
- 错误边界捕获渲染错误，显示友好的错误信息
- 支持流式状态指示器
- 使用 React.Suspense 支持懒加载渲染器

**使用示例：**
```tsx
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';

<ArtifactRenderer
  artifact={artifact}
  isStreaming={false}
  onContentChange={(content) => updateArtifact(artifact.id, { content })}
/>
```

**Props：**
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| artifact | Artifact | 是 | 要渲染的 Artifact 对象 |
| isStreaming | boolean | 否 | 是否处于流式生成状态 |
| onContentChange | (content: string) => void | 否 | 内容变更回调 |
| className | string | 否 | 自定义类名 |

**类型分发逻辑：**
1. 检查 ArtifactRegistry 是否有对应类型的渲染器
2. 如果是 Canvas 类型（`canvas:*`），委托给 CanvasAdapter
3. 如果有注册的渲染器，使用 Suspense 懒加载渲染
4. 如果没有注册的渲染器，显示 FallbackRenderer

**错误处理：**
- 使用 ArtifactErrorBoundary 捕获渲染错误
- 错误时显示友好的错误信息和重试按钮
- 支持查看源码回退

---

## CanvasAdapter

Canvas 适配器组件，将 Canvas 类型的 Artifact 适配到现有 Canvas 系统。

**功能特性：**
- 检测 Canvas 类型（canvas:document, canvas:video）
- 将 Artifact 内容作为初始状态传递给 Canvas
- 同步 Canvas 状态变更回 Artifact
- 支持在完整 Canvas 编辑器模式中打开
- 保留 Canvas 特定元数据（platform, version 等）

**支持的 Canvas 类型：**
| Artifact 类型 | Canvas 类型 | 说明 |
|--------------|-------------|------|
| canvas:document | document | 文档画布 |
| canvas:video | video | 视频画布 |

旧 `canvas:poster / canvas:music / canvas:novel / canvas:script` 只在解析与适配边界做归一，不再作为主链类型暴露。

**使用示例：**
```tsx
import { CanvasAdapter } from '@/components/artifact/CanvasAdapter';

<CanvasAdapter
  artifact={{
    id: '1',
    type: 'canvas:document',
    title: '我的文档',
    content: '# Hello World',
    status: 'complete',
    meta: { platform: 'markdown' },
    position: { start: 0, end: 0 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }}
  isStreaming={false}
  onContentChange={(content) => console.log('内容变更:', content)}
/>
```

**Props：**
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| artifact | Artifact | 是 | 要渲染的 Artifact 对象 |
| isStreaming | boolean | 否 | 是否处于流式生成状态 |
| onContentChange | (content: string) => void | 否 | 内容变更回调 |
| className | string | 否 | 自定义类名 |

**工具函数：**
- `getCanvasTypeFromArtifact(type)`: 从 Artifact 类型获取 Canvas 类型
- `isCanvasArtifact(type)`: 检测是否为 Canvas 类型的 Artifact
- `createCanvasStateFromArtifact(artifact)`: 根据 Artifact 创建初始 Canvas 状态
- `extractContentFromCanvasState(state)`: 从 Canvas 状态提取内容
- `extractCanvasMetadata(state)`: 提取 Canvas 元数据

---

## ErrorFallbackRenderer

错误回退渲染器，当 Artifact 渲染失败时显示友好的错误信息。

**功能特性：**
- 显示友好的错误信息（错误类型、错误消息）
- 提供重试按钮，支持重新渲染
- 错误时可以查看原始源码
- 支持复制完整错误报告用于调试
- 可折叠的错误堆栈和源码区域
- 显示 Artifact 元信息（类型、标题、状态）

**使用示例：**
```tsx
import { ErrorFallbackRenderer } from '@/components/artifact/ErrorFallbackRenderer';

<ErrorFallbackRenderer
  artifact={artifact}
  error={new Error('渲染失败')}
  onRetry={() => setRetryKey(k => k + 1)}
  onShowSource={() => setShowSource(true)}
/>
```

**Props：**
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| artifact | Artifact | 是 | 发生错误的 Artifact 对象 |
| error | Error \| null | 否 | 错误对象 |
| onRetry | () => void | 否 | 重试回调 |
| onShowSource | () => void | 否 | 显示源码回调 |
| className | string | 否 | 自定义类名 |

**错误报告格式：**
复制错误报告时，会生成包含以下信息的文本：
- 时间戳
- Artifact ID、类型、标题、状态
- 错误类型和消息
- 错误堆栈（如有）
- Artifact 原始内容

## ArtifactToolbar

Artifact 工具栏组件，提供快捷操作功能。

**功能特性：**
- 复制内容到剪贴板
- 下载文件（根据类型自动选择扩展名）
- 源码/预览视图切换
- 在新窗口中打开
- 关闭面板

**使用示例：**
```tsx
import { ArtifactToolbar } from '@/components/artifact/ArtifactToolbar';

<ArtifactToolbar
  artifact={artifact}
  showSource={false}
  onToggleSource={() => setShowSource(!showSource)}
  onClose={() => closePanel()}
/>
```

**Props：**
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| artifact | Artifact | 是 | 要操作的 Artifact 对象 |
| showSource | boolean | 否 | 当前是否显示源码视图 |
| onToggleSource | () => void | 否 | 源码切换回调 |
| onClose | () => void | 否 | 关闭回调 |
