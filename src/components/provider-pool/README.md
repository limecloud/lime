# Provider Pool 组件

本目录包含凭证池管理界面的所有组件。

## 组件列表

| 文件                            | 描述                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `ProviderPoolPage.tsx`          | 凭证池管理主页面，支持 OAuth 凭证卡片布局和 API Key 左右分栏布局 |
| `CredentialCard.tsx`            | OAuth 凭证卡片组件，显示健康状态、使用统计和操作按钮             |
| `CredentialCardContextMenu.tsx` | 凭证卡片右键菜单组件                                             |
| `AddCredentialModal.tsx`        | 添加凭证模态框组件                                               |
| `EditCredentialModal.tsx`       | 编辑凭证模态框组件                                               |
| `ErrorDisplay.tsx`              | 错误显示组件                                                     |
| `UsageDisplay.tsx`              | 用量显示组件                                                     |
| `RelayProvidersSection.tsx`     | Connect 中转商列表组件，展示已验证的中转服务商                   |
| `VertexAISection.tsx`           | Vertex AI 配置区域组件                                           |
| `AmpConfigSection.tsx`          | Amp CLI 配置区域组件                                             |
| `GeminiApiKeySection.tsx`       | Gemini API Key 配置区域组件                                      |
| `CodexSection.tsx`              | Codex 配置区域组件                                               |
| `IFlowSection.tsx`              | iFlow 配置区域组件                                               |
| `OAuthPluginTab.tsx`            | OAuth 插件标签页组件                                             |
| `index.ts`                      | 组件导出入口                                                     |

## 子目录

| 目录                | 描述                                      |
| ------------------- | ----------------------------------------- |
| `api-key/`          | API Key Provider 管理组件（左右分栏布局） |
| `credential-forms/` | 各类凭证表单组件                          |

## 测试文件

| 文件                     | 描述                                          |
| ------------------------ | --------------------------------------------- |
| `CredentialCard.test.ts` | Property 3 属性测试：OAuth 凭证卡片信息完整性 |

## 使用示例

```tsx
import { ProviderPoolPage } from "@/components/provider-pool";

function App() {
  return <ProviderPoolPage />;
}
```

## 相关需求

- Requirements 1.1: API Key Provider 左右分栏布局
- Requirements 2.1, 2.2, 2.3: OAuth 凭证保持卡片布局
- Requirements 3.1-3.6: 完整支持 System Provider 类型
- Connect: 中转商浏览和一键添加功能

## 架构说明

ProviderPoolPage 支持四种分类：

1. **OAuth 凭证** - 使用卡片式布局显示 OAuth 类型凭证
2. **API Key** - 使用左右分栏布局（ApiKeyProviderSection）
3. **Connect** - 中转商列表，支持浏览和一键获取 API Key
4. **语音服务** - 语音 Provider 管理入口

## Prompt Cache 认知边界

Provider Pool 页面当前已把 Prompt Cache 能力前置到 Provider UI，而不是等到对话发出后才暴露：

- `anthropic`：按官方 Anthropic 能力链展示
- `anthropic-compatible`：先按已知官方 Anthropic 兼容端点识别自动缓存，未知端点才回退为“仅显式缓存”
- 其它 Provider：默认不展示 Prompt Cache 标签或 notice

当前页面上的主要提示落点：

- 左侧 Provider 列表：`显式缓存` badge
- 右侧 Provider 详情头部：`显式缓存` badge
- 新增自定义 Provider：amber Prompt Cache 提示
- 编辑 Provider 配置：amber Prompt Cache 提示

这条语义的当前事实源位于 `src/lib/model/providerPromptCacheSupport.ts`。如果以后要新增新的缓存能力提示，优先扩这份 helper，不要在单个组件里自行判断。
