import { useEffect, useState } from "react";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import {
  DEFAULT_REASONING_EFFORTS,
  enabledReasoningEfforts,
} from "./reasoningEffortPreferences";

/** 配置投影；持久化与并发写入仍由 appConfig owner 负责。 */
export function useReasoningEffortPreferences(enabled: boolean) {
  const [state, setState] = useState({
    efforts: DEFAULT_REASONING_EFFORTS,
    ready: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const config = await getConfig();
        if (active && request === generation)
          setState({
            efforts: enabledReasoningEfforts(
              config.desktop?.["enabled-reasoning-efforts"],
            ),
            ready: true,
          });
      } catch {
        // 读取失败保留已确认投影，避免清空 Composer 中的用户选择。
      }
    };
    const stop = subscribeAppConfigChanged(() => void refresh());
    void refresh();
    return () => {
      active = false;
      stop();
    };
  }, [enabled]);
  return state;
}
