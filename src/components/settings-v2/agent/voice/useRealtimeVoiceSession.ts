import { useCallback, useEffect, useState } from "react";
import { createRealtimeVoiceClientSecret } from "@/lib/api/realtimeVoice";
import { RealtimeVoiceSession } from "@/lib/voice/realtimeVoiceSession";

/** Voice 设置里的实时语音会话宿主；音频与 data channel 只在浏览器中运行。 */
export function useRealtimeVoiceSession() {
  const [session] = useState(
    () =>
      new RealtimeVoiceSession({
        mintClientSecret: () => createRealtimeVoiceClientSecret(),
      }),
  );
  const [snapshot, setSnapshot] = useState(() => session.getSnapshot());

  useEffect(() => {
    const unsubscribe = session.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      session.dispose();
    };
  }, [session]);

  const start = useCallback(async () => {
    await session.start();
  }, [session]);

  const stop = useCallback(() => {
    session.stop();
  }, [session]);

  return { snapshot, start, stop };
}
