export interface SmartInputConfig {
  enabled: boolean;
  shortcut: string;
}

export interface WebMcpConfig {
  enabled: boolean;
}

export interface ExperimentalFeatures {
  screenshot_chat: SmartInputConfig;
  webmcp: WebMcpConfig;
}

export interface ToolCallingConfig {
  enabled: boolean;
  dynamic_filtering: boolean;
  native_input_examples: boolean;
}

export const DEFAULT_EXPERIMENTAL_FEATURES: ExperimentalFeatures = {
  screenshot_chat: {
    enabled: false,
    shortcut: "CommandOrControl+Alt+Q",
  },
  webmcp: {
    enabled: false,
  },
};
