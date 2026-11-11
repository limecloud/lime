import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { getElectronHostBridge } from "@/lib/electron-host";
import {
  readCloudDesktopWindowStatus,
  reconnectCloudDesktopWindow,
} from "@/lib/api/cloudDesktopConnection";

export function CloudWindowBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation("settings");
  const context = getElectronHostBridge()?.cloudDesktop;
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  useEffect(() => {
    if (!context) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const status = await readCloudDesktopWindowStatus();
        if (active) setConnected(status.connected);
      } catch {
        if (active) setConnected(false);
      }
      if (active) timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [context]);
  if (!context) return children;

  async function reconnect() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await reconnectCloudDesktopWindow();
      // Drop all client query caches and pending approvals before reading the new session.
      window.location.reload();
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      style={{ "--lime-window-content-height": "100%" } as CSSProperties}
    >
      <div className="min-h-0 flex-1">
        {connected ? (
          children
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md space-y-3 text-[13px]">
              <p role="status">
                {t(
                  `settings.cloudDesktop.${connected === null ? "connectingRemote" : "remoteDisconnected"}`,
                )}
              </p>
              <p className="text-muted-foreground">
                {t("settings.cloudDesktop.remoteDisconnectHelp")}
              </p>
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              {connected === false && (
                <button
                  className="rounded-lg border border-border px-3 py-2 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => void reconnect()}
                >
                  {t(
                    `settings.cloudDesktop.${pending ? "working" : "reconnectRemote"}`,
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div
        className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[12px]"
        aria-label={t("settings.cloudDesktop.cloudWindow")}
      >
        <span className="min-w-0 break-all">
          {t("settings.cloudDesktop.cloudWindow")} ·{" "}
          {context.resource.resourceId} · {context.resource.regionId}
        </span>
        <span role="status">
          {t(
            `settings.cloudDesktop.${connected ? "remoteConnected" : "remoteDisconnected"}`,
          )}
        </span>
      </div>
    </div>
  );
}
