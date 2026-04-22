import {
  hasTauriInvokeCapability,
  hasTauriRuntimeMarkers,
} from "@/lib/tauri-runtime";

/**
 * Tauri WebView 在生产构建下偶发 CSSOM 注入失效；
 * 切回文本注入可以避开 styled-components #17 启动崩溃。
 */
export function shouldDisableStyledCssomInjection(): boolean {
  return hasTauriRuntimeMarkers() || hasTauriInvokeCapability();
}
