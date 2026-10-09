import { useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import { RawReasoningVisibility } from "./reasoningVisibilityContext";

/** Display policy only: canonical summary/content remain in the shared projection. */
export function ReasoningVisibility({ children }: PropsWithChildren) {
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const read = async () => {
      const requestedRevision = ++revision;
      try {
        const config = await getConfig();
        if (active && revision === requestedRevision) {
          setShowRaw(config.show_raw_agent_reasoning === true);
        }
      } catch {
        if (active && revision === requestedRevision) setShowRaw(false);
      }
    };
    void read();
    const unsubscribe = subscribeAppConfigChanged(() => void read());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return (
    <RawReasoningVisibility.Provider value={showRaw}>
      {children}
    </RawReasoningVisibility.Provider>
  );
}
