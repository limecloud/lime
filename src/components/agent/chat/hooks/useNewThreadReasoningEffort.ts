import { useEffect, useState } from "react";
import {
  getConfigSnapshot,
  subscribeAppConfigChanged,
} from "@/lib/api/appConfig";
import { normalizeModelReasoningEffort } from "@/lib/model/modelReasoningPolicy";

/** 新聊天的显示投影；未选择的提交值由 App Server 按 cwd 解析。 */
export function useNewThreadReasoningEffort(
  workingDir: string | null | undefined,
  enabled: boolean,
) {
  const cwd = workingDir?.trim() || undefined;
  const [snapshot, setSnapshot] = useState<{
    cwd: string | undefined;
    effort: ReturnType<typeof normalizeModelReasoningEffort>;
  } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      return;
    }
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const { config } = await getConfigSnapshot({ cwd });
        if (active && generation === request)
          setSnapshot({
            cwd,
            effort: normalizeModelReasoningEffort(
              config.model_reasoning_effort,
            ),
          });
      } catch {
        // 无确认配置时保持继承，不猜测模型档位，也不改写提交选择。
      }
    };
    const stop = subscribeAppConfigChanged(() => void refresh());
    void refresh();
    return () => {
      active = false;
      stop();
    };
  }, [cwd, enabled]);
  return enabled && snapshot?.cwd === cwd ? (snapshot?.effort ?? "") : "";
}
