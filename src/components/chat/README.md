# chat

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

该目录现阶段仅保留 **兼容入口**，用于承接历史 `components/chat` 依赖。
现役通用对话实现已经迁移到 `src/components/general-chat/`，不要再在这里新增业务逻辑。

## 当前定位

- **兼容包装**：保留旧导入路径，避免一次性打爆历史调用方
- **单一事实源**：真实会话、消息、流式状态统一以 `general-chat` Store 和后端 compat 命令为准
- **禁止扩散**：该目录下文件只能做委托、适配、废弃标记，不再维护独立状态机

## 文件索引

- `index.ts` - 模块导出入口
- `ChatPage.tsx` - `GeneralChatPage` 的兼容包装层
- `types.ts` - 类型定义

### components/

- `*.tsx` - 历史 UI 资产源码，仅保留参考和兼容排障价值
- `index.ts` - 空壳兼容入口，不再导出旧组件

### hooks/（兼容层）

- `useChat.ts` - 委托到 `general-chat` Store 的兼容 Hook
- `useStreaming.ts` - 历史遗留流式 Hook，已停止维护，不再从模块根入口导出
- `index.ts` - Hooks 导出入口

## 推荐用法

```tsx
import { useUnifiedChat } from "@/hooks/useUnifiedChat";

function Example() {
  const chat = useUnifiedChat({ mode: "general" });

  return <button onClick={() => void chat.sendMessage("你好")}>发送</button>;
}
```

- 页面层不要新增 `ChatPage` / `GeneralChatPage` 依赖，请走现有工作台或路由入口。
- 新的对话逻辑请优先基于 `@/hooks/useUnifiedChat`。
- `@/components/chat` 模块根入口现仅保留 `ChatPage`、基础消息类型和 `useChat` 兼容导出。
- `@/components/chat/components` 已不再导出任何组件，避免旧 UI 资产继续扩散。
- 如必须兼容旧代码，`@/components/chat` 仍可继续导入，但应尽快迁移到统一对话链路。

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
