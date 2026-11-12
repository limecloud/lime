import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  connectCloudDesktopView,
  showCloudDesktopViewPassword,
} from "@/lib/api/cloudDesktopConnection";
import { validateCloudDesktopViewEndpoint } from "@/lib/desktop-host/cloudDesktopConnection";

export function CloudDesktopViewer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("settings");
  const [endpoint, setEndpoint] = useState("");
  const [pending, setPending] = useState(true);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [error, setError] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const lifetime = useRef<{ active: boolean } | null>(null);
  const busy = useRef(false);
  const passwordBusy = useRef(false);

  const connect = useCallback(async () => {
    const current = lifetime.current;
    if (!current?.active || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setEndpoint("");
    setFrameLoaded(false);
    try {
      const response = await connectCloudDesktopView();
      const url = new URL(validateCloudDesktopViewEndpoint(response.endpoint));
      url.searchParams.set("autoconnect", "true");
      url.searchParams.set("resize", "scale");
      url.searchParams.set("view_only", "true");
      if (current.active) setEndpoint(url.toString());
    } catch (cause) {
      if (current.active)
        setError(
          String(cause).includes("ECS_SECURITY_GROUP_DENIED")
            ? "tunnelSecurityGroupDenied"
            : "desktopViewFailed",
        );
    } finally {
      if (current.active) {
        busy.current = false;
        setPending(false);
      }
    }
  }, []);

  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    busy.current = false;
    void connect();
    return () => {
      current.active = false;
    };
  }, [connect]);

  async function showPassword() {
    const current = lifetime.current;
    if (!current?.active || passwordBusy.current) return;
    passwordBusy.current = true;
    setPasswordPending(true);
    setError("");
    try {
      await showCloudDesktopViewPassword();
    } catch {
      if (current.active) setError("desktopViewPasswordFailed");
    } finally {
      if (current.active) {
        passwordBusy.current = false;
        setPasswordPending(false);
      }
    }
  }

  const loading = pending || Boolean(endpoint && !frameLoaded);

  return (
    <section
      id="cloud-desktop-viewer"
      aria-label={t("settings.cloudDesktop.desktopViewTitle")}
      aria-busy={loading}
      className="flex min-h-[280px] min-w-0 flex-col border-t border-border bg-background lg:h-full lg:w-[min(48vw,720px)] lg:border-l lg:border-t-0"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
        <span className="min-w-0 flex-1 font-medium">
          {t("settings.cloudDesktop.desktopViewTitle")}
        </span>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent disabled:opacity-50"
          disabled={passwordPending}
          onClick={() => void showPassword()}
        >
          <KeyRound size={14} aria-hidden />
          {t("settings.cloudDesktop.showDesktopPassword")}
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-accent"
          aria-label={t("settings.cloudDesktop.hideDesktop")}
          title={t("settings.cloudDesktop.hideDesktop")}
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <p className="shrink-0 px-3 py-2 text-[12px] text-muted-foreground">
        {t("settings.cloudDesktop.desktopViewHelp")}
      </p>
      {error && (
        <p role="alert" className="px-3 pb-2 text-[12px] text-destructive">
          {t(`settings.cloudDesktop.${error}`)}
        </p>
      )}
      {loading && (
        <p role="status" className="p-3 text-[13px] text-muted-foreground">
          {t("settings.cloudDesktop.desktopViewConnecting")}
        </p>
      )}
      {endpoint ? (
        <iframe
          title={t("settings.cloudDesktop.desktopViewTitle")}
          src={endpoint}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          onLoad={() => setFrameLoaded(true)}
          className="min-h-[240px] w-full flex-1 border-0"
        />
      ) : !pending ? (
        <div className="p-3">
          <button
            type="button"
            className="flex items-center gap-1 rounded border border-border px-3 py-2 text-[12px]"
            onClick={() => void connect()}
          >
            <RefreshCw size={14} aria-hidden />
            {t("settings.cloudDesktop.reconnectRemote")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
