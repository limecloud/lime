# Artifact Hooks

Artifact 系统的 React Hooks 封装。

## 文件索引

| 文件 | 说明 |
|------|------|
| `index.ts` | 模块导出入口 |
| `useDebouncedValue.ts` | 防抖值 Hook，用于避免频繁重渲染 |

## useDebouncedValue

防抖值 Hook，用于避免频繁重渲染（Requirement 11.2）：

```typescript
import { useDebouncedValue, useDebouncedCallback } from '@/lib/artifact/hooks';

// 防抖值
function StreamingContent({ content }: { content: string }) {
  // 内容更新会被防抖处理，避免频繁重渲染
  const debouncedContent = useDebouncedValue(content, 100);
  return <pre>{debouncedContent}</pre>;
}

// 防抖回调
function Editor({ onContentChange }: { onContentChange: (content: string) => void }) {
  const debouncedOnChange = useDebouncedCallback(onContentChange, 200);
  return <textarea onChange={(e) => debouncedOnChange(e.target.value)} />;
}
```

## 依赖关系

- `react` - Hook 运行时
