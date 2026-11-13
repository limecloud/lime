import { useTranslation } from "react-i18next";
import { SettingsAction } from "../../SettingsPrimitives";
import { CloudReceipt } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";
import type { useCloudPurchase } from "./useCloudPurchase";

type PurchaseState = Pick<
  ReturnType<typeof useCloudPurchase>,
  | "spec"
  | "quote"
  | "approved"
  | "setApproved"
  | "pending"
  | "checkingNetwork"
  | "operationId"
  | "error"
  | "receipt"
  | "submitted"
  | "canPurchase"
  | "expired"
> & { run: (action: "quote" | "purchase" | "read") => Promise<unknown> };

export function PurchaseActions({
  purchase,
  pendingLabel,
}: {
  purchase: PurchaseState;
  pendingLabel?: string;
}) {
  const { t } = useTranslation("settings");
  const {
    spec,
    quote,
    approved,
    setApproved,
    pending,
    checkingNetwork,
    operationId,
    error,
    receipt,
    submitted,
    run,
    canPurchase,
    expired,
  } = purchase;
  const price = object(object(quote?.quote).price);
  return (
    <div className="mt-4 space-y-3">
      {quote && (
        <>
          <p className="text-[13px]">
            {t(
              "vSwitchId" in spec
                ? "settings.cloudDesktop.ecsQuotePrice"
                : "settings.cloudDesktop.quotePrice",
              {
                price: price.hourlyPrice,
                currency: price.currency,
              },
            )}
          </p>
          <p
            role={expired ? "status" : undefined}
            className="text-[13px] text-muted-foreground"
          >
            {expired
              ? t("settings.cloudDesktop.quoteExpired")
              : t("settings.cloudDesktop.quoteExpiry", {
                  expiry: new Date(
                    String(object(quote.quote).expiresAt),
                  ).toLocaleString(),
                })}
          </p>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={approved}
              disabled={pending || submitted || expired}
              onChange={(e) => setApproved(e.target.checked)}
            />
            {t("settings.cloudDesktop.approvePurchase")}
          </label>
        </>
      )}
      {submitted && object(receipt).operationId !== operationId && (
        <p className="break-all text-[13px]">
          {t("settings.cloudDesktop.operationId")}: {operationId}
        </p>
      )}
      {pending && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {checkingNetwork
            ? t("settings.cloudDesktop.checkingPurchaseNetwork")
            : (pendingLabel ?? t("settings.cloudDesktop.working"))}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error.includes("CLOUD_PURCHASE_PREFLIGHT_FAILED")
            ? t("settings.cloudDesktop.purchaseNetworkFailed")
            : error}
        </p>
      )}
      {receipt !== undefined && <CloudReceipt data={receipt} />}
      <div className="flex gap-2">
        {submitted ? (
          <SettingsAction disabled={pending} onClick={() => void run("read")}>
            {t("settings.cloudDesktop.readOperation")}
          </SettingsAction>
        ) : (
          <>
            <SettingsAction
              disabled={
                pending ||
                Object.entries(spec).some(
                  ([key, value]) => key !== "keyPairName" && value === "",
                )
              }
              onClick={() => void run("quote")}
            >
              {t("settings.cloudDesktop.quote")}
            </SettingsAction>
            <SettingsAction
              disabled={pending || !canPurchase}
              onClick={() => void run("purchase")}
            >
              {t("settings.cloudDesktop.purchase")}
            </SettingsAction>
          </>
        )}
      </div>
    </div>
  );
}
