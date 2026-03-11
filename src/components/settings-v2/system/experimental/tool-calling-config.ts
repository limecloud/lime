import type { ToolCallingConfig } from "@/lib/api/appConfig";

export const DEFAULT_TOOL_CALLING_CONFIG: ToolCallingConfig = {
  enabled: true,
  dynamic_filtering: true,
  native_input_examples: false,
};

export function normalizeToolCallingConfig(
  config: ToolCallingConfig | null | undefined,
): ToolCallingConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_TOOL_CALLING_CONFIG.enabled,
    dynamic_filtering:
      config?.dynamic_filtering ??
      DEFAULT_TOOL_CALLING_CONFIG.dynamic_filtering,
    native_input_examples:
      config?.native_input_examples ??
      DEFAULT_TOOL_CALLING_CONFIG.native_input_examples,
  };
}
