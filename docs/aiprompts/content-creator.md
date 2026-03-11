# 内容创作系统

## 概述

内容创作系统支持多种主题（社媒内容、图文海报、歌词曲谱等），通过 `<write_file>` 标签实现 AI 响应与右侧画布的联动。

## 核心架构

```
用户选择主题 → AgentChatPage 生成 systemPrompt
     ↓
用户发送消息 → useAgentChat.sendMessage()
     ↓
第一条消息时注入 systemPrompt → 发送到 Aster Agent
     ↓
AI 返回带 <write_file> 标签的响应
     ↓
StreamingRenderer 解析标签 → 调用 onWriteFile
     ↓
AgentChatPage.handleWriteFile → 更新画布状态
     ↓
右侧画布自动打开，显示文档内容
```

## 目录结构

```
src/components/
├── content-creator/
│   ├── canvas/              # 画布组件
│   │   ├── CanvasFactory.tsx    # 画布工厂
│   │   ├── canvasUtils.ts       # 画布工具
│   │   ├── document/            # 文档画布
│   │   └── music/               # 音乐画布
│   ├── utils/
│   │   └── systemPrompt.ts      # 系统提示词生成
│   └── a2ui/
│       └── parser.ts            # A2UI 和 write_file 解析器
├── agent/chat/
│   ├── hooks/
│   │   └── useAgentChat.ts      # Agent 聊天 Hook
│   ├── components/
│   │   ├── StreamingRenderer.tsx # 流式渲染（解析 write_file）
│   │   └── MessageList.tsx      # 消息列表
│   └── index.tsx                # AgentChatPage
└── general-chat/
    └── store/
        └── useGeneralChatStore.ts # 通用对话 Store
```

## 核心组件

### 1. systemPrompt.ts - 系统提示词生成

根据主题和创作模式生成 AI 系统提示词。

```typescript
// src/components/content-creator/utils/systemPrompt.ts

// 主题类型
type ThemeType = "general" | "social-media" | "poster" | "music" | ...;

// 创作模式
type CreationMode = "guided" | "fast" | "hybrid" | "framework";

// 生成系统提示词
export function generateContentCreationPrompt(
  theme: ThemeType,
  mode: CreationMode
): string;
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

### 2. parser.ts - write_file 标签解析

解析 AI 响应中的 `<write_file>` 标签。

```typescript
// src/components/content-creator/a2ui/parser.ts

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

### 3. useAgentChat.ts - systemPrompt 注入

在发送第一条消息时注入 systemPrompt。

```typescript
// src/components/agent/chat/hooks/useAgentChat.ts

interface UseAgentChatOptions {
  systemPrompt?: string;
  onWriteFile?: (content: string, fileName: string) => void;
}

// 关键逻辑：第一条消息注入 systemPrompt
const sendMessage = async (content: string, ...) => {
  let messageToSend = content;
  const isFirstMessage = messages.filter(m => m.role === "user").length === 0;

  if (systemPrompt && isFirstMessage) {
    messageToSend = `${systemPrompt}\n\n---\n\n用户请求：${content}`;
  }

  await sendAsterMessageStream(messageToSend, ...);
};
```

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

处理文件写入，更新画布状态。

```typescript
// src/components/agent/chat/index.tsx

const handleWriteFile = useCallback(
  (content: string, fileName: string) => {
    // General 主题使用专门的画布
    if (activeTheme === "general") {
      setGeneralCanvasState({
        isOpen: true,
        contentType: "markdown",
        content,
        filename: fileName,
      });
      setLayoutMode("chat-canvas");
      return;
    }

    // 其他主题使用 CanvasFactory
    setCanvasState(createInitialDocumentState(content));
    setLayoutMode("chat-canvas");
  },
  [activeTheme],
);
```

## 主题类型

| 主题         | 说明     | 文件体系                                          |
| ------------ | -------- | ------------------------------------------------- |
| general      | 通用对话 | 无固定文件                                        |
| social-media | 社媒内容 | brief.md → draft.md → article.md                  |
| poster       | 图文海报 | brief.md → copywriting.md → design.md             |
| music        | 歌词曲谱 | song-spec.md → lyrics-draft.md → lyrics-final.txt |
| video        | 短视频   | brief.md → outline.md → script.md                 |
| novel        | 小说创作 | brief.md → outline.md → chapter.md                |
| document     | 办公文档 | brief.md → outline.md → draft.md                  |

## 创作模式

| 模式      | 说明     | AI 行为                     |
| --------- | -------- | --------------------------- |
| guided    | 引导模式 | 通过表单逐步引导用户创作    |
| fast      | 快速模式 | 收集需求后直接生成完整内容  |
| hybrid    | 混合模式 | AI 写框架，用户填核心内容   |
| framework | 框架模式 | 用户提供框架，AI 按框架填充 |

## 注意事项

### Aster 框架限制

Aster 框架的 `SessionConfig` 不支持 session 级别的 system prompt，因此采用**消息注入**方案：

- 在第一条用户消息前注入 systemPrompt
- 后续消息不再注入（避免重复）

### 画布触发条件

1. AI 响应包含 `<write_file>` 标签
2. `StreamingRenderer` 解析到标签
3. 调用 `onWriteFile` 回调
4. `AgentChatPage` 更新画布状态
5. `layoutMode` 切换为 `chat-canvas`

## 相关文档

- [aster-integration.md](aster-integration.md) - Aster 框架集成
- [components.md](components.md) - 组件系统
- [hooks.md](hooks.md) - React Hooks
