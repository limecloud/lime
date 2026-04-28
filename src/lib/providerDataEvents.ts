/**
 * @file Provider 数据变更事件工具
 * @description 用于跨页面同步 Provider 相关数据，避免必须重启应用
 */

const PROVIDER_DATA_CHANGED_EVENT = "provider-data-changed";

type ProviderDataChangedSource = "api_key";

interface ProviderDataChangedDetail {
  source: ProviderDataChangedSource;
  timestamp: number;
}

/**
 * 广播 Provider 数据变更事件
 */
export function emitProviderDataChanged(
  source: ProviderDataChangedSource,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ProviderDataChangedDetail>(PROVIDER_DATA_CHANGED_EVENT, {
      detail: {
        source,
        timestamp: Date.now(),
      },
    }),
  );
}

/**
 * 订阅 Provider 数据变更事件
 */
export function subscribeProviderDataChanged(
  callback: (source: ProviderDataChangedSource) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<ProviderDataChangedDetail>;
    const source = customEvent.detail?.source;

    if (source) {
      callback(source);
    }
  };

  window.addEventListener(PROVIDER_DATA_CHANGED_EVENT, handler);

  return () => {
    window.removeEventListener(PROVIDER_DATA_CHANGED_EVENT, handler);
  };
}
