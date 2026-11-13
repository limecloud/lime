import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getElectronHostBridge } from "@/lib/electron-host";
import {
  getModelRegistry,
  subscribeModelRegistryUpdates,
} from "@/lib/api/modelRegistry";
import { SettingsTabs } from "@/types/settings";
import type { Page, PageParams } from "@/types/page";

type Props = {
  currentPage: Page;
  onNavigate: (page: Page, params?: PageParams) => void;
};

/** 云端目录只投影配置状态；模型连通与工具权限仍由现役 owner 决定。 */
export function CloudModelSetupNotice(props: Props) {
  if (
    !getElectronHostBridge()?.cloudDesktop ||
    props.currentPage === "settings"
  )
    return null;
  return <CloudModelSetupState onNavigate={props.onNavigate} />;
}

function CloudModelSetupState({ onNavigate }: Pick<Props, "onNavigate">) {
  const { t } = useTranslation("settings");
  const [phase, setPhase] = useState<
    "checking" | "missing" | "configured" | "failed"
  >("checking");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let loading = false;
    const refresh = async () => {
      const current = ++generation;
      loading = true;
      setPending(true);
      try {
        // The current window's bridge owns transport and catalog filtering.
        const models = await getModelRegistry({ forceRefresh: true });
        if (!active || current !== generation) return;
        setPhase(
          models.some(
            (model) =>
              model.task_families?.includes("chat") &&
              model.picker_policy?.show_in_picker === true,
          )
            ? "configured"
            : "missing",
        );
      } catch {
        if (active && current === generation) setPhase("failed");
      } finally {
        if (active && current === generation) {
          loading = false;
          setPending(false);
        }
      }
    };
    const request = () => void refresh();
    const focus = () => {
      if (!loading) request();
    };
    const unsubscribe = subscribeModelRegistryUpdates(request);
    window.addEventListener("focus", focus);
    request();
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, [attempt]);

  if (phase === "configured") return null;
  const checking = phase === "checking";
  return (
    <aside
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-[13px]"
      aria-label={t("settings.cloudDesktop.modelSetupTitle")}
      data-testid="cloud-model-setup"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p role={phase === "failed" ? "alert" : "status"}>
          {t(
            `settings.cloudDesktop.${checking ? "modelSetupChecking" : phase === "failed" ? "modelSetupFailed" : "modelSetupTitle"}`,
          )}
        </p>
        {phase === "missing" && (
          <p className="text-muted-foreground">
            {t("settings.cloudDesktop.modelSetupHelp")}
          </p>
        )}
      </div>
      {!checking && (
        <button
          type="button"
          className="shrink-0 rounded-lg border border-border px-3 py-2 hover:bg-accent disabled:opacity-50"
          disabled={pending}
          onClick={() => {
            if (phase === "failed") setAttempt((value) => value + 1);
            else onNavigate("settings", { tab: SettingsTabs.Providers });
          }}
        >
          {t(
            `settings.cloudDesktop.${phase === "failed" ? "refresh" : "modelSetupAction"}`,
          )}
        </button>
      )}
    </aside>
  );
}
