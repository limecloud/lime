export interface SmartInputConfig {
  enabled: boolean;
  shortcut: string;
}

export interface ExperimentalFeatures {
  screenshot_chat: SmartInputConfig;
}

export interface ToolCallingConfig {
  enabled: boolean;
  dynamic_filtering: boolean;
  native_input_examples: boolean;
}
