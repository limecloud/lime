# 组件系统

## 概述

React 组件层，使用 TailwindCSS 和 shadcn/ui。

## 目录结构

```
src/components/
├── ui/                 # 基础 UI 组件 (shadcn/ui)
├── api-key-provider/ # API Key Provider 设置
├── flow-monitor/       # 流量监控
├── general-chat/       # 兼容画布桥接（非对话主入口）
├── terminal/           # 已移除的历史终端页面路径（不要恢复）
├── mcp/                # MCP 服务器
├── settings/           # 设置页面
└── AppSidebar.tsx      # 全局侧边栏
```

## 核心组件

### AppSidebar

全局图标侧边栏，类似 cherry-studio 风格。

```tsx
// src/components/AppSidebar.tsx
export function AppSidebar() {
  return (
    <aside className="w-14 bg-sidebar">
      <nav className="flex flex-col items-center gap-2">
        <SidebarItem icon={Home} to="/" />
        <SidebarItem icon={MessageSquare} to="/chat" />
        <SidebarItem icon={Settings} to="/settings" />
      </nav>
    </aside>
  );
}
```

### ApiKeyProviderSection

API Key Provider 设置组件，是当前设置页的 Provider 配置入口。

```tsx
// src/components/api-key-provider/ApiKeyProviderSection.tsx
import { ApiKeyProviderSection } from "@/components/api-key-provider";
```

旧 `ProviderPoolPage`、凭证卡片、OAuth 表单与 `useProviderPool` 已退役，不允许重新作为设置入口。

### FlowMonitor

流量监控组件。

```tsx
// src/components/flow-monitor/FlowMonitorPanel.tsx
export function FlowMonitorPanel() {
  const { records, stats, query } = useFlowMonitor();

  return (
    <div className="flex flex-col h-full">
      <FlowStats stats={stats} />
      <FlowTable records={records} />
      <FlowPagination query={query} />
    </div>
  );
}
```

## 组件规范

### 文件命名

- 组件文件: `PascalCase.tsx`
- Hook 文件: `useCamelCase.ts`
- 工具文件: `camelCase.ts`

### 组件结构

```tsx
// 标准组件结构
interface Props {
  // props 定义
}

export function ComponentName({ prop1, prop2 }: Props) {
  // hooks
  const [state, setState] = useState();

  // handlers
  const handleClick = () => {};

  // render
  return <div>{/* JSX */}</div>;
}
```

## 相关文档

- [hooks.md](hooks.md) - React Hooks
- [lib.md](lib.md) - 工具库

## 输入组件统一规范（input-kit）

输入组件统一基座位于 `src/components/input-kit/`，目标是避免多处输入实现导致行为漂移。

### 分层原则

1. `Hook` 层管理状态与持久化（会话、Provider、Model、输入内容）。
2. `input-kit` 层只负责渲染和交互编排（`BaseComposer`、`ModelSelector`）。
3. 业务页面通过 `adapters` 做状态归一化，不允许 UI 组件直接写本地存储。

### 必须遵守

1. UI 组件使用受控 props，不在组件内“偷偷”回写默认 Provider/Model。
2. Provider/Model 的默认值与恢复逻辑统一放在 Hook 层。
3. 新增输入入口优先复用 `BaseComposer`，而不是复制粘贴 textarea 逻辑。

### 迁移约定

1. 先接 `adapters`，再替换页面中的旧输入实现。
2. 保留兼容包装组件（如 `ChatModelSelector`）用于渐进迁移。
3. 每次迁移至少补一个回归测试，覆盖 Enter 发送/停止和会话切换场景。
