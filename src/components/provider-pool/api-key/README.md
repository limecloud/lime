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
| `ProviderList.test.ts` | Property 10, 14 & 15 属性测试 |
| `ProviderConfigForm.test.ts` | Property 7 属性测试：Provider 类型处理正确性 |
| `ProviderSetting.test.ts` | Property 6 属性测试：Provider 设置面板字段完整性 |
| `ApiKeyProviderSection.test.ts` | Property 2 属性测试：Provider 选择同步 |
| `AddCustomProviderModal.test.ts` | Property 8 属性测试：自定义 Provider 表单验证 |
| `DeleteProviderDialog.test.ts` | Property 9 属性测试：System Provider 删除保护 |

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
