import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CloudDesktopParams,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";

export type CloudRequest = (
  params: CloudDesktopParams,
) => Promise<CloudDesktopResponse>;
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function Field({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const { t } = useTranslation("settings");
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[13px]">
      <span>{t(`settings.cloudDesktop.${name}`)}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-9 min-w-0 w-full rounded-lg border-[0.5px] border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function CloudSelect({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <select
        {...props}
        className={`${inputClass} appearance-none pr-8 ${className}`}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export function CloudReceipt({ data }: { data: unknown }) {
  const { t } = useTranslation("settings");
  const receipt = object(data);
  return (
    <div role="status" className="space-y-2 break-all text-[13px]">
      {receipt.restoreVerified === false && (
        <p>{t("settings.cloudDesktop.archiveUnverified")}</p>
      )}
      {receipt.requiresApplicationValidation === true && (
        <p>{t("settings.cloudDesktop.applicationValidation")}</p>
      )}
      {typeof receipt.outcome === "string" && (
        <p>
          {t(
            `settings.cloudDesktop.outcome.${receipt.outcome === "notSubmitted" && object(receipt.request).action === "prepareEcsDesktop" ? "prepareNotSubmitted" : receipt.outcome}`,
          )}
        </p>
      )}
      {typeof receipt.failureCode === "string" && (
        <p role="alert">
          {t(`settings.cloudDesktop.prepareFailure.${receipt.failureCode}`, {
            defaultValue: t(
              "settings.cloudDesktop.prepareFailure.preparationFailed",
            ),
          })}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {[
          "operationId",
          "requestId",
          "snapshotId",
          "instanceId",
          "sha256",
          "path",
          "destination",
          "localPath",
          "remote",
        ].map(
          (key) =>
            typeof receipt[key] === "string" && (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">
                  {t(`settings.cloudDesktop.${key}`)}
                </dt>
                <dd className="select-text">{String(receipt[key])}</dd>
              </div>
            ),
        )}
        {["files", "skippedEntries"].map(
          (key) =>
            typeof receipt[key] === "number" && (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">
                  {t(`settings.cloudDesktop.${key}`)}
                </dt>
                <dd>{Number(receipt[key]).toLocaleString()}</dd>
              </div>
            ),
        )}
      </dl>
      {Array.isArray(receipt.desktopIds) && (
        <p className="select-text">
          {t("settings.cloudDesktop.resourceId")}:{" "}
          {receipt.desktopIds.filter((id) => typeof id === "string").join(", ")}
        </p>
      )}
      {typeof receipt.diagnostic === "string" && <p>{receipt.diagnostic}</p>}
    </div>
  );
}
