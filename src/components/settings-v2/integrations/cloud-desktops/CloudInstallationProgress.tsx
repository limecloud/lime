import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CloudGuestInstallationStatus } from "@/lib/desktop-host/cloudDesktopConnection";

export function CloudInstallationProgress({
  status,
  reconnect,
}: {
  status?: CloudGuestInstallationStatus;
  reconnect: boolean;
}) {
  const { t, i18n } = useTranslation("settings");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!status?.busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status?.busy, status?.operationId]);
  if (reconnect) return null;
  const phase = status?.phase;
  const current =
    phase === "waitingForAgent" ||
    phase === "preparing" ||
    phase === "launching"
      ? 0
      : phase === "uploading" ||
          phase === "downloading" ||
          phase === "installing"
        ? 1
        : phase === "saving" || phase === "finishPending"
          ? 2
          : phase === "complete"
            ? 3
            : -1;
  const elapsed =
    status?.busy && status.createdAt !== undefined
      ? Math.max(0, Math.floor((now - status.createdAt) / 1000))
      : undefined;
  const transfer = status?.transfer;
  const number = new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumFractionDigits: 1,
  });
  return (
    <div
      className="space-y-3 text-[13px]"
      data-testid="cloud-installation-progress"
    >
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.installTimeExpectation")}
      </p>
      {phase === "waitingForAgent" && (
        <p className="text-muted-foreground" role="status">
          {t("settings.cloudDesktop.installAgentWaitHelp")}
        </p>
      )}
      <ol
        className="grid grid-cols-2 gap-x-4 gap-y-2"
        aria-label={t("settings.cloudDesktop.installProgress")}
      >
        {(["prepare", "runtime", "connection", "ready"] as const).map(
          (step, index) => {
            const complete = index < current || phase === "complete";
            const active = index === current && phase !== "complete";
            return (
              <li
                key={step}
                aria-current={active ? "step" : undefined}
                data-state={
                  complete ? "complete" : active ? "current" : "pending"
                }
                className={`flex min-w-0 items-center gap-2 ${active || complete ? "text-foreground" : "text-muted-foreground"}`}
              >
                {complete ? (
                  <Check aria-hidden className="size-3.5 shrink-0" />
                ) : active && status?.busy ? (
                  <Loader2
                    aria-hidden
                    className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="inline-flex size-3.5 shrink-0 items-center justify-center text-[12px]"
                  >
                    {index + 1}
                  </span>
                )}
                <span>{t(`settings.cloudDesktop.installStep.${step}`)}</span>
              </li>
            );
          },
        )}
      </ol>
      {transfer && (
        <div className="space-y-1 tabular-nums">
          <p>
            {t("settings.cloudDesktop.installTransferBytes", {
              received: number.format(transfer.receivedBytes / 1024 ** 2),
              total: number.format(transfer.totalBytes / 1024 ** 2),
            })}
          </p>
          <progress
            className="h-1 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-foreground [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-foreground"
            aria-label={t("settings.cloudDesktop.installTransferProgress")}
            value={transfer.receivedBytes}
            max={transfer.totalBytes}
          />
          <p className="text-muted-foreground">
            {t("settings.cloudDesktop.installTransferVerification")}
          </p>
        </div>
      )}
      {elapsed !== undefined && (
        <p
          className="tabular-nums text-muted-foreground"
          role="timer"
          aria-live="off"
        >
          {t("settings.cloudDesktop.installElapsed", {
            minutes: Math.floor(elapsed / 60),
            seconds: elapsed % 60,
          })}
        </p>
      )}
      {status?.busy && (
        <p className="text-muted-foreground">
          {t("settings.cloudDesktop.installBackgroundHelp")}
        </p>
      )}
    </div>
  );
}
