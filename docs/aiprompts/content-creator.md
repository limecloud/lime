# 历史内容工作台与画布联动（归档）

## 概述

本说明仅作为历史治理记录保留，现役主入口已经迁到 `workspace.md` 与 `src/components/workspace/**` / `src/lib/workspace/**`。当前内容工作台通过 `<write_file>` 标签与结构化 A2UI 产物实现 Agent 响应、版本链与右侧画布联动。

当前治理结论：

- `src/components/workspace/**` 与 `src/lib/workspace/**` 是现役 `current` runtime，后续能力只允许继续向这里收敛
- 文档导航、实现判断与后续扩展应优先参考 `workspace.md`，不要再把本文件当成现役入口
- 不要再直接恢复 `src/components/content-creator/**` 旧路径；若需要共享能力，统一经 `src/lib/workspace/*` 网关访问
- 已删除的根级旧入口如 `src/hooks/usePosterWorkflow.ts`、`src/hooks/useMultiPlatformExport.ts` 不应回流
- 已删除的海报 workflow 孤岛 `src/components/content-creator/workflows/poster/**`、`src/lib/workspace/workbenchPoster.ts` 不应回流

## 核心架构

```
用户选择主题 → AgentChatWorkspace 生成 systemPrompt
     ↓
用户发送消息 → useAgentChatUnified.sendMessage()
     ↓
统一收口到 useAgentChatUnified / useAsterAgentChat / agent_runtime_*
     ↓
第一条消息时注入 systemPrompt → 发送到 Aster Agent
     ↓
AI 返回带 <write_file> 标签的响应
     ↓
StreamingRenderer / stream processor 解析标签 → 调用 onWriteFile
     ↓
useWorkspaceWriteFileAction → 映射为社媒 harness 产物 / 版本链
     ↓
右侧画布自动打开，显示文档内容
```

## 目录结构

```
src/
├── components/
│   ├── workspace/
│   │   ├── canvas/                  # 现役画布 runtime
│   │   ├── a2ui/                    # A2UI 结构与解析实现
│   │   ├── document/                # 文档画布与编辑器
│   │   ├── layout/                  # 布局过渡与工作台壳
│   │   ├── media/                   # 素材库与媒体面板
│   │   └── hooks/                   # 工作台 Hook
│   └── agent/chat/
│       ├── hooks/
│       │   ├── index.ts             # useAgentChatUnified 统一入口
│       │   └── useAsterAgentChat.ts # 现役 Aster 聊天主 Hook
│       ├── components/
│       │   └── StreamingRenderer.tsx # 流式渲染与标签解析
│       ├── workspace/
│       │   └── useWorkspaceWriteFileAction.ts
│       └── AgentChatWorkspace.tsx   # 工作台主入口
└── lib/
    └── workspace/
        ├── a2ui.ts                  # A2UI 外层共享网关
        ├── workbenchPrompt.ts       # prompt 外层共享网关
        ├── workbenchCanvas.ts       # canvas 外层共享网关
        ├── workbenchRuntime.ts      # runtime helper 外层共享网关
        ├── workbenchUi.ts           # 共享 UI 网关
        └── workbenchWorkflow.ts     # 工作流 Hook 网关
```

## 核心组件

### 1. workbenchPrompt.ts / systemPrompt.ts - 系统提示词生成

根据主题和工作台模式生成 AI 系统提示词。外层主链统一经 `src/lib/workspace/workbenchPrompt.ts` 访问，不应再恢复 `content-creator` 内部旧实现路径。

```typescript
// 运行时代码统一从 workspace 网关进入
import {
  generateSystemPrompt,
  generateProjectMemoryPrompt,
} from "@/lib/workspace/workbenchPrompt";
```

**关键指令**：系统提示词要求 AI 使用 `<write_file>` 标签输出内容：

```markdown
## 文件写入格式

当需要输出文档内容时，使用以下标签格式：

<write_file path="文件名.md">
内容...
</write_file>

**重要规则**：

- 标签前：先写一句引导语
- 标签后：写完成总结
- 标签内的内容会实时流式显示在右侧画布
```

### 2. a2ui.ts / parser.ts - write_file 标签解析

解析 AI 响应中的 `<write_file>` 标签。外层统一从 `src/lib/workspace/a2ui.ts` 读取解析器与结构类型。

```typescript
// src/lib/workspace/a2ui.ts

interface ParseResult {
  parts: ParsedMessageContent[];
  hasA2UI: boolean;
  hasWriteFile: boolean;
  hasPending: boolean;
}

// 解析 AI 响应
export function parseAIResponse(
  content: string,
  isStreaming: boolean,
): ParseResult;
```

**支持的标签类型**：

- `write_file` - 完整的文件写入
- `pending_write_file` - 流式传输中的文件写入

### 3. useAgentChatUnified / useAsterAgentChat - systemPrompt 注入

在发送第一条消息时注入 systemPrompt，并通过现役 runtime adapter 提交到 `agent_runtime_*`。

```typescript
// src/components/agent/chat/hooks/index.ts

interface UseAgentChatOptions {
  systemPrompt?: string;
  onWriteFile?: (content: string, fileName: string) => void;
}

export function useAgentChatUnified(options: UseAgentChatUnifiedOptions) {
  return useAsterAgentChat(options);
}
```

现役事实源：

- 统一入口：`src/components/agent/chat/hooks/index.ts`
- 底层实现：`src/components/agent/chat/hooks/useAsterAgentChat.ts`
- 首条 system prompt 拼装：`buildUserInputSubmitOp.ts` / `agentStream*`

### 4. StreamingRenderer.tsx - 流式渲染

解析 AI 响应并触发文件写入回调。

```typescript
// src/components/agent/chat/components/StreamingRenderer.tsx

interface Props {
  content: string;
  isStreaming: boolean;
  onWriteFile?: (content: string, fileName: string) => void;
  // ...
}

// 解析 write_file 并触发回调
useEffect(() => {
  if (!onWriteFile) return;

  for (const part of parsedContent.parts) {
    if (part.type === "write_file" && part.filePath) {
      onWriteFile(part.content, part.filePath);
    }
  }
}, [parsedContent.parts, onWriteFile]);
```

### 5. AgentChatPage - 画布联动

处理文件写入，更新画布状态。当前主入口已是 `AgentChatWorkspace` 与 `useWorkspaceWriteFileAction`，不再以旧 `general-chat` 兼容层作为事实源。

```typescript
// src/components/agent/chat/AgentChatWorkspace.tsx
// src/components/agent/chat/workspace/useWorkspaceWriteFileAction.ts

const { sendMessage } = useAgentChatUnified({
  systemPrompt,
  onWriteFile: handleWriteFile,
  workspaceId,
});

const handleWriteFile = useWorkspaceWriteFileAction(...);
```

## 主题类型

| 主题         | 说明     | 文件体系                                          |
| ------------ | -------- | ------------------------------------------------- |
| general      | 通用对话 | 无固定文件                                        |
| current      | 现役口径 | 旧社媒 / 文档 / 规划等主题已统一回落到 general    |

## 创作模式

| 模式      | 说明     | AI 行为                     |
| --------- | -------- | --------------------------- |
| guided    | 引导模式 | 通过表单逐步引导用户创作    |
| fast      | 快速模式 | 收集需求后直接生成完整内容  |
| hybrid    | 混合模式 | AI 写框架，用户填核心内容   |
| framework | 框架模式 | 用户提供框架，AI 按框架填充 |

## 注意事项

- 社媒主题已不再把 `write_file` 仅视为“文件覆盖”，而是映射为带阶段语义的版本链产物
- `brief / draft / polished / platform variant / publish package` 应分别作为不同产物语义处理
- 日志、运行轨迹、正文产物三层分离：`harness` 产生命名事件，日志只做投影，正文仍由画布/产物承载
- 外层主链不要再直接 import `@/components/content-creator/**`，统一走 `src/lib/workspace/*` 与 `@/components/workspace/**`
- 根级旧 Hook `src/hooks/usePosterWorkflow.ts`、`src/hooks/useMultiPlatformExport.ts` 已删除，不应回流
- 海报 workflow 孤岛 `src/components/content-creator/workflows/poster/**` 与 `src/lib/workspace/workbenchPoster.ts` 已删除，不应回流

### Aster 框架限制

Aster 框架的 `SessionConfig` 不支持 session 级别的 system prompt，因此现役主链采用**消息注入**方案：

- 在第一条用户消息前注入 systemPrompt
- 后续消息不再注入（避免重复）

### 画布触发条件

1. AI 响应包含 `<write_file>` 标签
2. `StreamingRenderer` 解析到标签
3. 调用 `onWriteFile` 回调
4. `useWorkspaceWriteFileAction` 更新版本链 / 画布状态
5. `layoutMode` 切换为 `chat-canvas`

## 相关文档

- [aster-integration.md](aster-integration.md) - Aster 框架集成
- [components.md](components.md) - 组件系统
- [hooks.md](hooks.md) - React Hooks
