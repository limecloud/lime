import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Monitor } from "lucide-react";
import { CloudDesktopViewer } from "./CloudDesktopViewer";
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
  const [desktopVisible, setDesktopVisible] = useState(false);
  const desktopTrigger = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const connection = useRef<{ active: boolean } | null>(null);
  useEffect(() => {
    const current = { active: true };
    connection.current = current;
    busy.current = false;
    setConnected(null);
    setPending(false);
    setError("");
    setDesktopVisible(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const status = await readCloudDesktopWindowStatus();
        if (current.active) setConnected(status.connected);
      } catch {
        if (current.active) setConnected(false);
      }
      if (current.active) timer = setTimeout(() => void refresh(), 1000);
    };
    if (context) void refresh();
    return () => {
      current.active = false;
      clearTimeout(timer);
    };
  }, [context]);
  if (!context) return children;

  async function reconnect() {
    const current = connection.current;
    if (busy.current || !current?.active) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const status = await reconnectCloudDesktopWindow();
      if (!current.active) return;
      if (!status.connected) throw new Error("REMOTE_DISCONNECTED");
      // Drop all client query caches and pending approvals before reading the new session.
      // Keep tasks isolated until navigation replaces this renderer.
      window.location.reload();
    } catch (cause) {
      if (!current.active) return;
      const message = String(cause);
      setError(
        message.includes("ECS_SECURITY_GROUP_DENIED")
          ? "tunnelSecurityGroupDenied"
          : message.includes("ECS_TUNNEL_FAILED")
            ? "taskTunnelFailed"
            : "remoteReconnectFailed",
      );
      busy.current = false;
      setPending(false);
    }
  }
  const showTasks = connected && !pending && !error;
  const statusKey =
    pending || connected === null
      ? "connectingRemote"
      : showTasks
        ? "remoteConnected"
        : "remoteDisconnected";
  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      style={{ "--lime-window-content-height": "100%" } as CSSProperties}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1">
          {showTasks ? (
            children
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <div className="max-w-md space-y-3 text-[13px]">
                <p role="status">{t(`settings.cloudDesktop.${statusKey}`)}</p>
                <p className="text-muted-foreground">
                  {t("settings.cloudDesktop.remoteDisconnectHelp")}
                </p>
                {error && (
                  <p role="alert" className="text-destructive">
                    {t(`settings.cloudDesktop.${error}`)}
                  </p>
                )}
                {(connected === false || pending || error) && (
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
        {desktopVisible && (
          <CloudDesktopViewer
            onClose={() => {
              setDesktopVisible(false);
              desktopTrigger.current?.focus();
            }}
          />
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
        <div className="flex items-center gap-3">
          <button
            ref={desktopTrigger}
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent disabled:opacity-50"
            aria-expanded={desktopVisible}
            aria-controls="cloud-desktop-viewer"
            disabled={context.resource.provider !== "ecs"}
            title={
              context.resource.provider === "ecs"
                ? undefined
                : t("settings.cloudDesktop.desktopViewUnavailable")
            }
            onClick={() => setDesktopVisible((visible) => !visible)}
          >
            <Monitor size={14} aria-hidden />
            {t(
              `settings.cloudDesktop.${desktopVisible ? "hideDesktop" : "viewDesktop"}`,
            )}
          </button>
          <span role="status">{t(`settings.cloudDesktop.${statusKey}`)}</span>
        </div>
      </div>
    </div>
  );
}
