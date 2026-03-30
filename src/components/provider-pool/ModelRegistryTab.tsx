/**
 * @file ModelRegistryTab 组件
 * @description 模型库 Tab，显示所有可用模型
 * @module components/provider-pool/ModelRegistryTab
 */

import { EnhancedModelsTab } from "./EnhancedModelsTab";

/**
 * 模型库 Tab 组件
 *
 * 复用 Provider Pool 的增强模型列表组件
 */
export function ModelRegistryTab() {
  return (
    <div className="min-h-[400px]" data-testid="model-registry-section">
      <EnhancedModelsTab />
    </div>
  );
}

export default ModelRegistryTab;
