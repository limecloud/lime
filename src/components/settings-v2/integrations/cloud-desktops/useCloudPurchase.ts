import { useEffect, useRef, useState } from "react";
import type {
  EcsDesktopSpec,
  WuyingDesktopSpec,
} from "@limecloud/app-server-client";
import { object, type CloudRequest } from "./CloudDesktopPrimitives";

export function useCloudPurchase<S extends EcsDesktopSpec | WuyingDesktopSpec>({
  initialSpec,
  request,
  onPurchased,
}: {
  initialSpec: S;
  request: CloudRequest;
  onPurchased: () => void;
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
    template?: { id: string; version: number },
  ) {
    if (busy.current || (action === "purchase" && (submitted || !canPurchase)))
      return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (action === "quote") {
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
                  ? { action: "quoteEcs", spec }
                  : { action: "quoteWuying", spec },
            )
          ).data,
        );
        if (template) {
          const resolved = object(result.spec);
          if (
            resolved.profile !== spec.profile ||
            resolved.regionId !== spec.regionId ||
            Object.entries(initialSpec).some(
              ([key, value]) =>
                typeof resolved[key] !== typeof value || resolved[key] === "",
            )
          )
            throw new Error("Invalid cloud template specification");
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
        setReceipt(
          (await request({ action: "readOperation", operationId })).data,
        );
        onPurchased();
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
        onPurchased();
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
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
