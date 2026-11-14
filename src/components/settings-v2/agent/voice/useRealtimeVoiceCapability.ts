import { useCallback, useEffect, useRef, useState } from "react";
import {
  readModelProviderCapabilities,
  type RealtimeVoiceBlocker,
} from "@/lib/api/modelRegistry";

export interface RealtimeVoiceCapability {
  available: boolean;
  blockers: RealtimeVoiceBlocker[];
  model?: string;
  voice?: string;
  models: string[];
  voices: string[];
}

export type RealtimeVoiceCapabilityState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; capability: RealtimeVoiceCapability };

/**
 * 读取 App Server 的实时语音能力。
 *
 * 只用 exact `modelProvider/capabilities/read` 结果，不在 renderer 推断 provider
 * 或模型是否支持实时语音；未知/缺字段响应按不可用处理。
 */
export function useRealtimeVoiceCapability() {
  const [state, setState] = useState<RealtimeVoiceCapabilityState>({
    status: "loading",
  });
  const mounted = useRef(false);
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setState({ status: "loading" });
    try {
      const capabilities = await readModelProviderCapabilities();
      if (!mounted.current || request !== sequence.current) return;
      setState({
        status: "ready",
        capability: {
          available: capabilities.realtime === true,
          blockers: capabilities.realtimeBlockers,
          model: capabilities.realtimeModel,
          voice: capabilities.realtimeVoice,
          models: capabilities.realtimeModels,
          voices: capabilities.realtimeVoices,
        },
      });
    } catch {
      if (mounted.current && request === sequence.current) {
        setState({ status: "error" });
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const onFocus = () => {
      void reload();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  return { state, reload };
}
