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
}: {
  initialSpec: S;
  request: CloudRequest;
  onPurchased: (receipt: unknown, context: CloudPurchaseContext<S>) => void;
}) {
  const [spec, setSpec] = useState(initialSpec);
  const [name, setName] = useState("");
  const [quote, setQuote] = useState<Record<string, unknown>>();
  const [approved, setApproved] = useState(false);
  const [pending, setPending] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const busy = useRef(false);
  const active = useRef(true);
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
      (action === "purchase" &&
        (submitted || !canPurchase || expiresAt <= Date.now()))
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (action === "quote") {
        const template = source && "id" in source ? source : undefined;
        const selectedSpec = source && "spec" in source ? source.spec : spec;
        if (
          selectedSpec.profile !== spec.profile ||
          selectedSpec.regionId !== spec.regionId
        )
          throw new Error("Cloud recommendation context changed");
        setQuote(undefined);
        setApproved(false);
        setReceipt(undefined);
        const result = object(
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
        if (!active.current) return;
        if (source) {
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
          if (
            !template &&
            Object.keys(initialSpec).some(
              (key) => object(object(result.quote).spec)[key] !== resolved[key],
            )
          )
            throw new Error(
              "Cloud quote does not match the recommended specification",
            );
          setSpec(
            Object.assign(
              { ...initialSpec },
              Object.fromEntries(
                Object.keys(initialSpec).map((key) => [key, resolved[key]]),
              ),
            ),
          );
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
        const id = crypto.randomUUID();
        setOperationId(id);
        const quoteId = String(quote?.quoteId ?? "");
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
          setQuote(undefined);
          setApproved(false);
        }
        onPurchased(result, { operationId: id, spec, desktopName: name });
      }
      return true;
    } catch (cause) {
      if (active.current) setError(String(cause));
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
    operationId,
    error,
    receipt,
    submitted,
    run,
    canPurchase,
    expired,
  };
}
