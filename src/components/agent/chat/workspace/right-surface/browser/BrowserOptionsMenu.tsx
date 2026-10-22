import { useEffect, useMemo, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { SettingsTabs } from "@/types/settings";
import {
  captureBrowserTabScreenshot,
  printBrowserTab,
  setBrowserTabZoom,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import type { BrowserMenuItem } from "@/lib/api/browserMenu";
import type { BrowserWorkspaceOwner } from "@/lib/api/browserWorkspace";
import {
  browserIconButton,
  type RunBrowserOperation,
} from "./BrowserNavigationBar";
import { BROWSER_ZOOM_STEP, clampBrowserZoom } from "./browserWorkspaceModel";
import { useBrowserNativeMenu } from "./useBrowserNativeMenu";

export function BrowserOptionsMenu({
  selected,
  owner,
  active,
  run,
  onFind,
  onDeviceToggle,
  onError,
}: {
  selected: BrowserTabState | null;
  owner: BrowserWorkspaceOwner | null;
  active: boolean;
  run: RunBrowserOperation;
  onFind: () => void;
  onDeviceToggle: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation("agent");
  const navigate = useAppNavigationRequest();
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const menu = useBrowserNativeMenu({
    selected,
    active,
    onError,
    onAction: (id) => {
      const tab = selectedRef.current;
      if (!tab) return;
      const browserReturnOwner =
        owner?.threadId === tab.threadId ? owner : undefined;
      if (id === "find") onFind();
      else if (id === "history")
        navigate?.("settings", {
          tab: SettingsTabs.Browser,
          browserPage: "history",
          browserReturnOwner,
        });
      else if (id === "settings")
        navigate?.("settings", {
          tab: SettingsTabs.Browser,
          browserReturnOwner,
        });
      else if (id === "device") onDeviceToggle();
      else if (id === "print")
        void run(async () => {
          const result = await printBrowserTab(tab.tabId);
          if (
            !result.printed &&
            result.failureReason &&
            !/cancel/i.test(result.failureReason)
          )
            throw new Error(result.failureReason);
          return result.state;
        });
      else if (id === "screenshot")
        void run(async () => {
          const result = await captureBrowserTabScreenshot(tab.tabId, true);
          if (result.copiedToClipboard)
            toast.success(t("browserChrome.screenshotCopied"));
          return result.state;
        });
      else if (id.startsWith("zoom-")) {
        const zoom = tab.zoomFactor ?? 1;
        const target =
          id === "zoom-reset"
            ? 1
            : clampBrowserZoom(
                zoom +
                  (id === "zoom-in" ? BROWSER_ZOOM_STEP : -BROWSER_ZOOM_STEP),
              );
        void run(() => setBrowserTabZoom(tab.tabId, target));
      }
    },
  });
  const zoom = selected?.zoomFactor ?? 1;
  const deviceEnabled = Boolean(selected?.device);
  const items = useMemo<BrowserMenuItem[]>(
    () => [
      { id: "find", label: t("browserChrome.find"), shortcut: "⌘F" },
      { id: "print", label: t("browserChrome.print"), shortcut: "⌘P" },
      { separator: true },
      {
        id: "zoom",
        label: t("browserChrome.zoom"),
        controls: [
          {
            id: "zoom-out",
            label: "−",
            ariaLabel: t("browserChrome.zoomOut"),
            enabled: zoom > 0.5,
          },
          {
            id: "zoom-reset",
            label: `${Math.round(zoom * 100)}%`,
            ariaLabel: t("browserChrome.zoomReset"),
          },
          {
            id: "zoom-in",
            label: "+",
            ariaLabel: t("browserChrome.zoomIn"),
            enabled: zoom < 3,
          },
        ],
      },
      { separator: true },
      {
        id: "device",
        label: t("browserChrome.device"),
        checked: deviceEnabled,
      },
      { id: "screenshot", label: t("browserChrome.screenshot") },
      { separator: true },
      {
        id: "history",
        label: t("browserChrome.history"),
        enabled: Boolean(navigate),
      },
      { separator: true },
      {
        id: "settings",
        label: t("browserChrome.settings"),
        enabled: Boolean(navigate),
      },
    ],
    [t, zoom, deviceEnabled, navigate],
  );
  const { open, update } = menu;
  useEffect(() => {
    if (open) void update(items);
  }, [items, open, update]);
  return (
    <button
      type="button"
      className={browserIconButton}
      aria-label={t("browserChrome.more")}
      title={t("browserChrome.more")}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      disabled={!selected || !active}
      data-testid="browser-workspace-options"
      onClick={(event) => {
        void menu.show(event.currentTarget, items).catch(onError);
      }}
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}
