# API Key Provider 组件

当前设置页事实源只允许收敛到：

`ApiKeyProviderSection -> ModelProviderList / ModelAddPanel / ProviderSetting`

左侧只展示已经启用或已配置的模型；添加模型时再进入可筛选目录；右侧只保留 API Key、模型优先级、接口获取模型和测试连接。

## 当前组件

| 文件 | 描述 |
|------|------|
| `ApiKeyProviderSection.tsx` | 当前 API Key Provider 管理区域，承载左侧列表、添加流程和右侧设置页 |
| `ModelProviderList.tsx` | 当前左侧模型列表，只展示已启用/已配置的模型入口 |
| `ModelAddPanel.tsx` | 当前添加模型流程，按推荐/国内/聚合/海外/本地分类筛选服务商 |
| `ProviderSetting.tsx` | 当前简洁设置页，只保留 API Key、模型优先级、接口获取模型和测试连接 |
| `ImportExportDialog.tsx` | 当前配置导入导出对话框 |
| `providerConfigUtils.ts` | 当前 Provider 类型、Prompt Cache、模型 ID 规范化工具 |
| `providerTypeMapping.ts` | 模型注册表 Provider 映射工具 |
| `connectionTestTypes.ts` | 连接测试共享类型 |

## 已删除旧实现

以下旧分组/完整表单实现已从目录中删除，并在 `src/lib/governance/legacySurfaceCatalog.json` 中登记为 `dead-candidate`，避免后续重新接回主路径：

- `ProviderListItem.tsx`、`ProviderGroup.tsx`、`ProviderList.tsx`
- `ApiKeyItem.tsx`、`ApiKeyList.tsx`
- `ProviderConfigForm.tsx`、`ProviderModelList.tsx`
- `ConnectionTestButton.tsx`、`DeleteProviderDialog.tsx`
- `AddCustomProviderModal.tsx`、`SectionInfoButton.tsx`

## 测试文件

| 文件 | 描述 |
|------|------|
| `ApiKeyProviderSection.test.ts` | Provider 选择同步与测试模型解析属性测试 |
| `ApiKeyProviderSection.ui.test.tsx` | 当前模型管理布局、添加流程与激活链路 UI 回归 |
| `ModelProviderList.test.ts` | 当前左侧启用模型列表 helper 回归 |
| `ProviderSetting.test.ts` | 当前简洁设置页字段属性测试 |
| `ProviderSetting.ui.test.tsx` | 设置面板 UI 回归：简洁页、接口模型、手动添加和连接测试 |
| `providerConfigUtils.test.ts` | Provider 类型、模型 ID 规范化和模型排序属性测试 |
| `providerTypeMapping.test.ts` | 模型注册表映射契约：目录归一不等于 Prompt Cache 能力 |

## 使用示例

```tsx
import { ApiKeyProviderSection } from "@/components/provider-pool/api-key";

function ProviderPoolPage() {
  return (
    <div className="h-full">
      <ApiKeyProviderSection />
    </div>
  );
}
```

## Provider 映射分层（关键）

为避免“改一处坏一片”，Provider/模型映射采用分层策略：

1. **框架层（aster-rust）**：负责 Provider 工厂与别名归一，支持 `ASTER_PROVIDER_ALIAS_OVERRIDES` 做运行时覆盖。
2. **应用后端层（Lime Tauri）**：`get_system_provider_catalog` 提供 Provider 元信息，`get_model_registry_provider_ids` 提供模型 Provider 真相集；真相源读取失败时直接报错。
3. **应用前端层（UI）**：设置页只接受接口返回模型和用户手动添加模型；本地模型目录仅用于添加页服务商发现，不再作为右侧配置页兜底。

### 解析优先级

`resolveRegistryProviderId` 的核心规则：

1. codex 协议强制 `codex`
2. Catalog 别名映射
3. 最小 legacy ID 映射
4. providerType 回退
5. 原始 providerId

这层解析只负责模型目录真相源收敛，不负责 Prompt Cache 等运行时能力判断。
例如 `anthropic-compatible -> anthropic` 仅表示可复用 Anthropic 模型注册表，不能据此推断官方 Anthropic 自动缓存能力。

## Prompt Cache 能力提示（当前事实源）

Provider 池当前把 Prompt Cache 能力视为 **Provider 显式声明优先，类型默认兜底**：

- `anthropic`：自动缓存能力
- `anthropic-compatible`：先识别已知官方 Anthropic 兼容端点（如 GLM / Kimi / MiniMax / MiMo），其余端点默认仅显式缓存；自定义 Provider 仍可显式声明为 `automatic`
- 其它 Provider：默认不展示 Prompt Cache 能力提示

当前前台提示统一复用 `src/lib/model/providerPromptCacheSupport.ts`，不要在组件里各自写一套判断。
