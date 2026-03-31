# A2UI 运行时

`components/` 只保留 Lime 的运行时装配层，不再承载组件实现。

## 目录结构

```text
components/
├── index.tsx             # A2UIRenderer 入口与导出
├── ComponentRenderer.tsx # 组件分发器
└── A2UIRenderer.test.tsx # 运行时回归
```

## 事实源

- 完整组件集：`../catalog/basic/components`
- 最小组件集：`../catalog/minimal/components`
- 根入口：`../index.ts`

## 使用方式

```tsx
import { A2UIRenderer } from "@/components/workspace/a2ui";
```

## 扩展规则

1. 新增组件优先落在 `catalog/basic/components/`
2. 需要运行时分发时，再同步更新 `ComponentRenderer.tsx`
3. 如需公开导出，再同步更新 `../index.ts`
