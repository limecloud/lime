# 语音组件

语音输入功能相关的 React 组件。

## 文件索引

| 文件 | 说明 |
|------|------|
| `types.ts` | 类型定义和常量 |
| `AsrCredentialCard.tsx` | ASR 凭证卡片组件 |
| `AddAsrCredentialModal.tsx` | 添加 ASR 凭证模态框 |
| `AsrProviderSection.tsx` | ASR Provider 管理区域 |
| `InstructionEditor.tsx` | 自定义指令编辑器组件 |
| `index.ts` | 模块导出 |

## 使用方式

```tsx
import { AsrProviderSection, InstructionEditor } from "@/components/voice";

// 在凭证池页面中使用 ASR 管理
<AsrProviderSection />

// 在设置页面中使用指令编辑器
<InstructionEditor
  defaultInstructionId="default"
  onDefaultChange={(id) => console.log("默认指令:", id)}
/>
```

## 支持的 ASR Provider

- **本地 Whisper** - 离线语音识别
- **讯飞语音** - 讯飞开放平台
- **百度语音** - 百度 AI 开放平台
- **OpenAI Whisper** - OpenAI Whisper API
