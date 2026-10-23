import { useCallback, useEffect, useRef, useState } from "react";

export function useMicrophoneDevices() {
  const media = navigator.mediaDevices;
  const supported = typeof media?.enumerateDevices === "function";
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(supported);
  const [refreshPending, setRefreshPending] = useState(false);
  const [error, setError] = useState<"load" | "permission" | null>(null);
  const epoch = useRef(0);
  const sequence = useRef(0);
  const refreshing = useRef(false);

  const enumerate = useCallback(async () => {
    if (!supported) return;
    const currentEpoch = epoch.current;
    const currentSequence = ++sequence.current;
    const ownsRequest = () =>
      currentEpoch === epoch.current && currentSequence === sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await media.enumerateDevices();
      if (ownsRequest())
        setDevices(
          result.filter(
            (device) =>
              device.kind === "audioinput" &&
              device.deviceId &&
              device.deviceId !== "default",
          ),
        );
    } catch {
      if (ownsRequest()) setError("load");
    } finally {
      if (ownsRequest()) setLoading(false);
    }
  }, [media, supported]);

  useEffect(() => {
    void enumerate();
    const changed = () => {
      void enumerate();
    };
    media?.addEventListener?.("devicechange", changed);
    return () => {
      epoch.current += 1;
      refreshing.current = false;
      media?.removeEventListener?.("devicechange", changed);
    };
  }, [enumerate, media]);

  // 只有用户显式刷新才请求麦克风权限。
  const refresh = useCallback(async () => {
    if (!supported || refreshing.current) return;
    refreshing.current = true;
    setRefreshPending(true);
    const currentEpoch = epoch.current;
    setError(null);
    try {
      const stream = await media.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (currentEpoch === epoch.current) await enumerate();
    } catch {
      if (currentEpoch === epoch.current) setError("permission");
    } finally {
      if (currentEpoch === epoch.current) {
        refreshing.current = false;
        setRefreshPending(false);
      }
    }
  }, [enumerate, media, supported]);

  return {
    devices,
    supported,
    loading: loading || refreshPending,
    error,
    refresh,
  };
}
