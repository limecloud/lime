# Artifact 渲染器

各类型 Artifact 的渲染器组件。当前 `renderers/index.ts` 只保留注册相关公共入口，不再继续暴露单个 renderer 的聚合导出。

## 文件索引

| 文件 | 说明 | 需求 |
|------|------|------|
| `index.ts` | 模块导出入口，注册所有轻量渲染器 | 3.1 |
| `CodeRenderer.tsx` | 代码渲染器，支持语法高亮 | 4.1, 4.2, 4.3, 4.4, 4.6 |
| `HtmlRenderer.tsx` | HTML 渲染器，沙箱化 iframe 预览 | 5.1, 5.2, 5.3, 5.4, 5.5, 5.6 |
| `SvgRenderer.tsx` | SVG 渲染器，支持缩放和下载 | 6.1, 6.2, 6.4, 6.5 |
| `MermaidRenderer.tsx` | Mermaid 图表渲染器，支持导出和主题切换 | 7.1, 7.2, 7.3, 7.4, 7.5, 7.6 |
| `ReactRenderer.tsx` | React 组件渲染器，支持 JSX 编译和沙箱化渲染 | 8.1, 8.2, 8.4, 8.6, 8.7 |

## 渲染器接口

所有渲染器都实现 `ArtifactRendererProps` 接口：

```typescript
interface ArtifactRendererProps {
  artifact: Artifact;
  isStreaming?: boolean;
  onContentChange?: (content: string) => void;
}
```

## 使用方式

### 注册渲染器

在应用初始化时调用 `registerLightweightRenderers()` 注册所有轻量渲染器：

```typescript
import { registerLightweightRenderers } from '@/components/artifact/renderers';

// 在应用入口处调用
registerLightweightRenderers();
```

### 导入单个渲染器

```typescript
import { CodeRenderer } from '@/components/artifact/renderers/CodeRenderer';
import { HtmlRenderer } from '@/components/artifact/renderers/HtmlRenderer';
```

### 检查注册状态

```typescript
import { areLightweightRenderersRegistered } from '@/components/artifact/renderers';

if (!areLightweightRenderersRegistered()) {
  registerLightweightRenderers();
}
```
