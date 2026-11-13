import { useEffect, useRef, useState } from "react";
import type {
  EcsDesktopSpec,
  WuyingDesktopSpec,
} from "@limecloud/app-server-client";
import type { CloudRequest } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export type CloudPurchaseContext<S> = {
  operationId: string;
  spec: S;
  desktopName: string;
};

export function useCloudPurchase<S extends EcsDesktopSpec | WuyingDesktopSpec>({
  initialSpec,
  request,
  onPurchased,
  resolveSpec,
}: {
  initialSpec: S;
  request: CloudRequest;
  onPurchased: (receipt: unknown, context: CloudPurchaseContext<S>) => void;
  resolveSpec?: (spec: S) => S;
}) {
  const [spec, setSpec] = useState(initialSpec);
  const [name, setName] = useState("");
  const [quote, setQuote] = useState<Record<string, unknown>>();
  const [approved, setApproved] = useState(false);
  const [pending, setPending] = useState(false);
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const busy = useRef(false);
  const active = useRef(true);
  const latest = useRef({
    spec,
    name,
    resolveSpec,
    quoteId: quote?.quoteId,
    approved,
  });
  latest.current = {
    spec,
    name,
    resolveSpec,
    quoteId: quote?.quoteId,
    approved,
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const submitted = operationId !== "";
  const expiresAt = Date.parse(String(object(quote?.quote).expiresAt));
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const remaining = expiresAt - Date.now();
    setExpired(!Number.isFinite(remaining) || remaining <= 0);
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.min(remaining, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  const canPurchase =
    !!quote?.quoteId &&
    approved &&
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) &&
    !expired &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now();
  async function run(
    action: "quote" | "purchase" | "read",
    source?: { id: string; version: number } | { spec: S },
  ) {
    if (
      busy.current ||
      (action === "quote" && submitted) ||
      (action === "purchase" &&
        (submitted || !canPurchase || expiresAt <= Date.now()))
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    const expected = JSON.stringify([spec, name]);
    const current = () =>
      active.current &&
      expected === JSON.stringify([latest.current.spec, latest.current.name]) &&
      resolveSpec === latest.current.resolveSpec &&
      (action !== "purchase" ||
        (quote?.quoteId === latest.current.quoteId && latest.current.approved));
    try {
      if (action === "quote") {
        const template = source && "id" in source ? source : undefined;
        const baseSpec = source && "spec" in source ? source.spec : spec;
        const selectedSpec = resolveSpec ? resolveSpec(baseSpec) : baseSpec;
        if (
          selectedSpec.profile !== spec.profile ||
          selectedSpec.regionId !== spec.regionId
        )
          throw new Error("Cloud recommendation context changed");
        setQuote(undefined);
        setApproved(false);
        setReceipt(undefined);
        let result = object(
          (
            await request(
              template && "vSwitchId" in spec
                ? {
                    action: "quoteEcsTemplate",
                    regionId: spec.regionId,
                    profile: spec.profile,
                    launchTemplateId: template.id,
                    version: template.version,
                  }
                : "vSwitchId" in spec
                  ? { action: "quoteEcs", spec: selectedSpec as EcsDesktopSpec }
                  : {
                      action: "quoteWuying",
                      spec: selectedSpec as WuyingDesktopSpec,
                    },
            )
          ).data,
        );
        if (!current()) return false;
        if (source || resolveSpec) {
          const resolved = object(template ? result.spec : selectedSpec);
          if (
            resolved.profile !== spec.profile ||
            resolved.regionId !== spec.regionId ||
            Object.entries(initialSpec).some(
              ([key, value]) =>
                typeof resolved[key] !== typeof value ||
                (key !== "keyPairName" && resolved[key] === ""),
            )
          )
            throw new Error("Invalid cloud template specification");
          const resolvedSpec = Object.assign(
            { ...initialSpec },
            Object.fromEntries(
              Object.keys(initialSpec).map((key) => [key, resolved[key]]),
            ),
          );
          const finalSpec =
            template && resolveSpec ? resolveSpec(resolvedSpec) : resolvedSpec;
          if (
            template &&
            Object.keys(initialSpec).some(
              (key) => object(finalSpec)[key] !== resolved[key],
            )
          ) {
            result = object(
              (
                await request(
                  "vSwitchId" in finalSpec
                    ? { action: "quoteEcs", spec: finalSpec as EcsDesktopSpec }
                    : {
                        action: "quoteWuying",
                        spec: finalSpec as WuyingDesktopSpec,
                      },
                )
              ).data,
            );
            if (!current()) return false;
          }
          if (
            (!template || resolveSpec) &&
            Object.keys(initialSpec).some(
              (key) =>
                object(object(result.quote).spec)[key] !==
                object(finalSpec)[key],
            )
          )
            throw new Error(
              "Cloud quote does not match the recommended specification",
            );
          setSpec(finalSpec);
          if (!name) setName(`Lime-${crypto.randomUUID().slice(0, 8)}`);
        }
        setQuote(result);
      } else if (action === "read") {
        const result = (await request({ action: "readOperation", operationId }))
          .data;
        if (!active.current) return;
        setReceipt(result);
        onPurchased(result, { operationId, spec, desktopName: name });
      } else {
        const quoteId = String(quote?.quoteId ?? "");
        if ("vSwitchId" in spec) {
          setCheckingNetwork(true);
          try {
            const proof = object(
              (await request({ action: "preflightEcsPurchase", spec, quoteId }))
                .data,
            );
            const checked = Date.parse(String(proof.checkedAt));
            const expiry = Date.parse(String(proof.expiresAt));
            if (
              proof.quoteId !== quoteId ||
              proof.networkReady !== true ||
              !Number.isFinite(checked) ||
              checked > Date.now() ||
              !Number.isFinite(expiry) ||
              expiry <= Date.now() ||
              expiry > Math.min(expiresAt, checked + 60_000)
            )
              throw new Error("Invalid network observation");
          } catch {
            throw new Error("CLOUD_PURCHASE_PREFLIGHT_FAILED");
          } finally {
            if (active.current) setCheckingNetwork(false);
          }
        }
        if (!current() || expiresAt <= Date.now()) return false;
        const id = crypto.randomUUID();
        setOperationId(id);
        const provider = "vSwitchId" in spec ? "ecs" : "wuying";
        const body = {
          desktopName: name,
          operationId: id,
          quoteId,
          confirmation: `purchase:${provider}:${spec.regionId}:${name}:${quoteId}`,
        };
        const result = (
          await request(
            "vSwitchId" in spec
              ? { action: "purchaseEcs", spec, ...body }
              : { action: "purchaseWuying", spec, ...body },
          )
        ).data;
        if (!active.current) return;
        setReceipt(result);
        const state = object(result);
        if (
          state.operationId === id &&
          state.outcome === "notSubmitted" &&
          state.submitted === false &&
          state.requiresInspection === false
        ) {
          setOperationId("");
          if (state.diagnostic !== "CLOUD_PURCHASE_PREFLIGHT_REQUIRED") {
            setQuote(undefined);
            setApproved(false);
          }
        }
        onPurchased(result, { operationId: id, spec, desktopName: name });
      }
      return true;
    } catch (cause) {
      if (active.current && (action === "read" || current()))
        setError(String(cause));
      return false;
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  return {
    spec,
    setSpec,
    name,
    setName,
    quote,
    setQuote,
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
  };
}
