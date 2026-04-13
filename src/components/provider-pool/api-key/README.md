# API Key Provider 组件

本目录包含 API Key Provider 管理界面的所有组件。

## 组件列表

| 文件 | 描述 |
|------|------|
| `ProviderListItem.tsx` | Provider 列表项组件，显示图标、名称、启用状态和 API Key 数量徽章 |
| `ProviderGroup.tsx` | Provider 分组组件，支持折叠/展开和显示分组标题 |
| `ProviderList.tsx` | Provider 列表组件，集成搜索框、分组显示 |
| `ApiKeyItem.tsx` | API Key 列表项组件，显示掩码 Key、别名、使用统计，支持启用/禁用、删除 |
| `ApiKeyList.tsx` | API Key 列表组件，显示 Provider 的所有 API Key，支持添加新 Key |
| `ProviderConfigForm.tsx` | Provider 配置表单组件，显示 API Host 和根据类型显示额外字段 |
| `ConnectionTestButton.tsx` | 连接测试按钮组件，用于测试 Provider API 连接 |
| `ProviderSetting.tsx` | Provider 设置面板组件，集成所有子组件，显示完整配置界面 |
| `ApiKeyProviderSection.tsx` | API Key Provider 管理区域组件，实现左右分栏布局 |
| `AddCustomProviderModal.tsx` | 添加自定义 Provider 模态框组件，实现表单验证 |
| `DeleteProviderDialog.tsx` | 删除自定义 Provider 确认对话框组件 |
| `ImportExportDialog.tsx` | Provider 配置导入导出对话框组件 |
| `index.ts` | 组件导出入口 |

## 测试文件

| 文件 | 描述 |
|------|------|
| `ProviderListItem.test.ts` | Property 1 & 11 属性测试 |
| `ProviderListItem.ui.test.tsx` | 列表项 UI 回归：显式缓存标签 |
| `ProviderList.test.ts` | Property 10, 14 & 15 属性测试 |
| `ProviderConfigForm.test.ts` | Property 7 属性测试：Provider 类型处理正确性 |
| `ProviderConfigForm.ui.test.tsx` | 编辑入口 UI 回归：Prompt Cache 提示与协议说明弹层 |
| `ProviderSetting.test.ts` | Property 6 属性测试：Provider 设置面板字段完整性 |
| `ProviderSetting.ui.test.tsx` | 设置面板 UI 回归：头部状态与显式缓存标签 |
| `ApiKeyProviderSection.test.ts` | Property 2 属性测试：Provider 选择同步 |
| `AddCustomProviderModal.test.ts` | Property 8 属性测试：自定义 Provider 表单验证 |
| `AddCustomProviderModal.ui.test.tsx` | 创建入口 UI 回归：Prompt Cache 提示与协议特例保留 |
| `DeleteProviderDialog.test.ts` | Property 9 属性测试：System Provider 删除保护 |
| `providerTypeMapping.test.ts` | 模型注册表映射契约：目录归一不等于 Prompt Cache 能力 |

## 使用示例

```tsx
import { ApiKeyProviderSection } from "@/components/provider-pool/api-key";

function ProviderPoolPage() {
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className="h-full">
      <ApiKeyProviderSection
        onAddCustomProvider={() => setShowAddModal(true)}
      />
    </div>
  );
}
```

### 单独使用 ProviderList 和 ProviderSetting

```tsx
import { ProviderList, ProviderSetting } from "@/components/provider-pool/api-key";

function ApiKeySection() {
  const { 
    providersByGroup, 
    selectedProviderId, 
    selectedProvider,
    selectProvider,
    updateProvider,
    addApiKey,
    deleteApiKey,
    toggleApiKey,
  } = useApiKeyProvider();

  return (
    <div className="flex">
      <ProviderList
        providersByGroup={providersByGroup}
        selectedProviderId={selectedProviderId}
        onProviderSelect={selectProvider}
      />
      <ProviderSetting
        provider={selectedProvider}
        onUpdate={updateProvider}
        onAddApiKey={addApiKey}
        onDeleteApiKey={deleteApiKey}
        onToggleApiKey={toggleApiKey}
      />
    </div>
  );
}
```

## 相关需求

- Requirements 1.1, 1.3, 1.4: API Key Provider 左右分栏布局
- Requirements 1.2, 1.5, 1.6: Provider 列表布局和交互
- Requirements 4.1, 4.2, 4.3, 4.4: Provider 设置面板
- Requirements 5.1-5.5: Provider 类型系统
- Requirements 7.1, 7.2, 7.5: 多 API Key 支持
- Requirements 8.1, 8.2, 8.3: Provider 分组和搜索
- Requirements 10.4: Provider 图标显示
- Requirements 9.4, 9.5: 导入导出功能


## Provider 映射分层（关键）

为避免“改一处坏一片”，Provider/模型映射采用分层策略：

1. **框架层（aster-rust）**
   - 负责 Provider 工厂与别名归一；
   - 支持 `ASTER_PROVIDER_ALIAS_OVERRIDES` 做运行时覆盖（JSON 或 `k=v`）。

2. **应用后端层（Lime Tauri）**
   - `get_system_provider_catalog` 作为 Provider 元信息入口（含 `legacy_ids`）；
   - `get_model_registry_provider_ids` 从 `src-tauri/resources/models/index.json` 提供模型 Provider 真相集；
   - 真相源读取失败时直接报错，不再静默回退数据库。

3. **应用前端层（UI）**
   - `ProviderModelList` 先用 Catalog 归一 provider，再用模型 Provider 真相集校验；
   - 仅保留最小 legacy 映射（如 `dashscope -> alibaba`），避免维护大硬编码表。

### 解析优先级

`resolveRegistryProviderId` 的核心规则：

1. codex 协议强制 `codex`
2. Catalog 别名映射
3. 最小 legacy ID 映射
4. providerType 回退
5. 原始 providerId

当提供 `validRegistryProviders` 时，会优先选择“真实存在于模型注册表”的候选值。

这层解析只负责模型目录真相源收敛，不负责 Prompt Cache 等运行时能力判断。
例如 `anthropic-compatible -> anthropic` 仅表示可复用 Anthropic 模型注册表，不能据此推断官方 Anthropic 自动缓存能力。

## Prompt Cache 能力提示（当前事实源）

Provider 池当前把 Prompt Cache 能力视为 **Provider 显式声明优先，类型默认兜底**：

- `anthropic`：自动缓存能力
- `anthropic-compatible`：先识别已知官方 Anthropic 兼容端点（如 GLM / Kimi / MiniMax / MiMo），其余端点默认仅显式缓存；自定义 Provider 仍可显式声明为 `automatic`
- 其它 Provider：默认不展示 Prompt Cache 能力提示

另外，前台提示层会对已知官方 Anthropic 兼容 Host 做例外收口：

- 不再把它们误报成“显式缓存”或“未声明自动 Prompt Cache”
- 运行时也会和这份事实源保持一致，不再只修 UI

当前前台提示统一复用 `src/lib/model/providerPromptCacheSupport.ts`，不要在组件里各自写一套判断。

### 当前 UI 落点

- `ProviderListItem.tsx`：列表扫描态用 `显式缓存` badge 提醒
- `ProviderSetting.tsx`：详情头部继续展示同口径 badge
- `AddCustomProviderModal.tsx`：创建自定义 Provider 时前置 amber notice
- `ProviderConfigForm.tsx`：编辑 Provider 类型 / API Host 时继续显示 amber notice

### 语义约束

1. `anthropic-compatible` 只表示 Anthropic wire format 兼容，不等于上游已声明 Automatic Prompt Cache
2. 已知官方 Anthropic 兼容端点可直接按 Automatic Prompt Cache 处理
3. 只有当上游明确声明支持 Automatic Prompt Cache 时，才应把未知自定义 Provider 标记为 `automatic`
4. 若未声明自动缓存，应提示用户使用显式 `cache_control`
5. 若上游未实现 Automatic Prompt Caching，`cached_input_tokens` 为空不应直接归因到 Lime 没发字段
