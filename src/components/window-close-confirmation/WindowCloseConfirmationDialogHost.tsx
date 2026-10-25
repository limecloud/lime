import { useEffect, useRef, useState } from "react";
import { useCommand } from "@/lib/commands/useCommand";
import { runCommand } from "@/lib/commands/registry";
import {
  canCloseWindow,
  listenWindowCloseConfirmation,
  requestWindowClose,
  respondWindowCloseConfirmation,
} from "@/lib/api/windowCloseConfirmation";
import { WindowCloseConfirmationDialog } from "./dialog";

export function WindowCloseConfirmationDialogHost() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const report = (error: unknown) =>
    console.error("Window close confirmation unavailable", error);
  const answer = (confirmed: boolean, doNotAskAgain = false) => {
    const id = current.current;
    if (!id) return;
    current.current = null;
    setRequestId(null);
    void respondWindowCloseConfirmation({
      requestId: id,
      confirmed,
      doNotAskAgain,
    }).catch(report);
  };
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const listening = listenWindowCloseConfirmation(({ requestId }) => {
      if (disposed || current.current) return;
      current.current = requestId;
      setRequestId(requestId);
    });
    if (listening)
      void listening
        .then((unsubscribe) => {
          if (disposed) unsubscribe();
          else stop = unsubscribe;
        })
        .catch(report);
    return () => {
      disposed = true;
      stop?.();
      const id = current.current;
      current.current = null;
      if (id)
        void respondWindowCloseConfirmation({
          requestId: id,
          confirmed: false,
          doNotAskAgain: false,
        }).catch(report);
    };
  }, []);
  useCommand({
    id: "closeWindow",
    titleKey: "settings:desktop.windowCloseConfirmation.confirm",
    section: "app",
    bindings: ["CommandOrControl+W"],
    allowInInput: true,
    enabled: canCloseWindow(),
    handler: () => {
      if (!runCommand("closeTab")) void requestWindowClose().catch(report);
    },
  });
  return requestId ? (
    <WindowCloseConfirmationDialog
      key={requestId}
      onClose={() => answer(false)}
      onConfirm={(never) => answer(true, never)}
    />
  ) : null;
}
