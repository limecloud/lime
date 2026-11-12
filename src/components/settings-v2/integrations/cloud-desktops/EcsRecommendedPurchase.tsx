import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EcsDesktopSpec } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { object } from "./cloudDesktopData";
import { initialEcsSpec } from "./purchaseSpecs";
import type { useCloudPurchase } from "./useCloudPurchase";

export function EcsRecommendedPurchase({
  purchase,
  onBusyChange,
}: {
  purchase: ReturnType<typeof useCloudPurchase<EcsDesktopSpec>>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const { regionId, profile } = purchase.spec;
  const [receipt, setReceipt] = useState<Record<string, unknown>>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [consented, setConsented] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const current = useRef(purchase);
  current.current = purchase;
  const receiptRef = useRef(receipt);
  receiptRef.current = receipt;
  const quoted = useRef("");

  async function run(prepare: boolean, expected = generation.current) {
    if (busy.current || !profile || !regionId || current.current.submitted)
      return;
    busy.current = true;
    setPending(true);
    setError(false);
    onBusyChange(true);
    try {
      const operationId = crypto.randomUUID();
      const data = object(
        (
          await requestCloudDesktop(
            prepare
              ? {
                  action: "prepareEcsPurchase",
                  regionId,
                  profile,
                  operationId,
                  confirmation: `prepareEcsPurchase:${regionId}:${profile}:${operationId}`,
                }
              : { action: "readEcsPurchasePreparation", regionId, profile },
          )
        ).data,
      );
      if (expected !== generation.current) return;
      if (data.outcome !== "notPrepared") {
        const request = object(data.request);
        if (
          typeof data.operationId !== "string" ||
          !data.operationId ||
          request.action !== "prepareEcsPurchase" ||
          request.regionId !== regionId ||
          request.profile !== profile ||
          ![
            "unknown",
            "networkPreparing",
            "networkReady",
            "networkFailed",
            "networkRolledBack",
          ].includes(String(data.outcome))
        )
          throw new Error("Invalid network preparation");
      }
      setReceipt(data);
      if (
        data.outcome === "networkReady" &&
        quoted.current !== data.operationId
      ) {
        const resolved = object(data.spec);
        if (
          resolved.regionId !== regionId ||
          resolved.profile !== profile ||
          Object.entries(initialEcsSpec).some(
            ([key, value]) =>
              typeof resolved[key] !== typeof value ||
              (key !== "keyPairName" && resolved[key] === ""),
          )
        )
          throw new Error("Invalid recommended desktop specification");
        const spec: EcsDesktopSpec = {
          regionId,
          profile,
          imageId: String(resolved.imageId),
          instanceType: String(resolved.instanceType),
          keyPairName: String(resolved.keyPairName),
          outboundMbps: Number(resolved.outboundMbps),
          securityGroupId: String(resolved.securityGroupId),
          systemDiskGib: Number(resolved.systemDiskGib),
          vSwitchId: String(resolved.vSwitchId),
        };
        const applied = await current.current.run("quote", { spec });
        if (expected !== generation.current) return;
        if (applied) quoted.current = String(data.operationId);
        else setError(true);
      }
    } catch {
      if (expected === generation.current) setError(true);
    } finally {
      if (expected === generation.current) {
        busy.current = false;
        setPending(false);
        onBusyChange(false);
      }
    }
  }
  const runner = useRef(run);
  runner.current = run;
  useEffect(() => {
    const expected = ++generation.current;
    busy.current = false;
    quoted.current = "";
    setReceipt(undefined);
    setConsented(false);
    setError(false);
    void runner.current(false, expected);
    return () => {
      generation.current += 1;
      busy.current = false;
      onBusyChange(false);
    };
  }, [regionId, profile, onBusyChange]);
  const outcome = receipt?.outcome;
  const waiting = outcome === "unknown" || outcome === "networkPreparing";
  useEffect(() => {
    if (!waiting || error) return;
    const timer = window.setInterval(() => {
      const createdAt = Date.parse(String(receiptRef.current?.createdAt));
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > 10 * 60_000)
        return;
      void runner.current(false);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [waiting, error]);
  if (!profile) return null;
  const canPrepare =
    outcome === "notPrepared" || outcome === "networkRolledBack";
  const locked = pending || purchase.pending || purchase.submitted;
  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.recommendedDescription")}
      </p>
      {canPrepare && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={consented}
            disabled={locked}
            onChange={(event) => setConsented(event.target.checked)}
          />
          {t("settings.cloudDesktop.recommendedConsent")}
        </label>
      )}
      <p role="status" aria-live="polite">
        {pending && !waiting
          ? t("settings.cloudDesktop.recommendedChecking")
          : waiting
            ? t("settings.cloudDesktop.recommendedPreparing")
            : outcome === "networkReady"
              ? t("settings.cloudDesktop.recommendedReady")
              : outcome === "networkRolledBack"
                ? t("settings.cloudDesktop.recommendedRolledBack")
                : outcome === "networkFailed"
                  ? t("settings.cloudDesktop.recommendedFailed")
                  : null}
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {t("settings.cloudDesktop.recommendedUnavailable")}
        </p>
      )}
      {canPrepare ? (
        <SettingsAction
          disabled={locked || !consented}
          onClick={() => void run(true)}
        >
          {t("settings.cloudDesktop.recommendedPrepare")}
        </SettingsAction>
      ) : (
        (error || waiting || outcome === "networkFailed") && (
          <SettingsAction disabled={locked} onClick={() => void run(false)}>
            {t("settings.cloudDesktop.recommendedRefresh")}
          </SettingsAction>
        )
      )}
    </div>
  );
}
