import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { SettingsAction } from "../../SettingsPrimitives";
import type { CloudRequest } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export function CloudHibernation({
  resource,
  status,
  postPaid,
  disabled,
  operations,
  request,
  onChanged,
  onOpenChange,
  initiallyOpen = false,
  hideTrigger = false,
  returnFocus,
}: {
  resource: CloudDesktopResource;
  status: string;
  postPaid: boolean;
  disabled: boolean;
  operations: readonly Record<string, unknown>[];
  request: CloudRequest;
  onChanged: () => void;
  onOpenChange?: (open: boolean) => void;
  initiallyOpen?: boolean;
  hideTrigger?: boolean;
  returnFocus?: HTMLButtonElement;
}) {
  const { t } = useTranslation("settings");
  const resourceKey = JSON.stringify([
    resource.provider,
    resource.regionId,
    resource.resourceId,
    resource.profile,
  ]);
  const existing = operations.find(
    (entry) =>
      entry.action === "hibernateEcs" &&
      !["hibernated", "cancelled"].includes(String(entry.outcome)) &&
      (["provider", "regionId", "resourceId", "profile"] as const).every(
        (key) => object(entry.resource)[key] === resource[key],
      ),
  );
  const [open, setOpen] = useState(initiallyOpen);
  const [openedFor, setOpenedFor] = useState(initiallyOpen ? resourceKey : "");
  const [consent, setConsent] = useState(false);
  const [id, setId] = useState(() =>
    initiallyOpen ? String(existing?.operationId ?? crypto.randomUUID()) : "",
  );
  const [submitted, setSubmitted] = useState(initiallyOpen && !!existing);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  const latestResourceKey = useRef(resourceKey);
  latestResourceKey.current = resourceKey;
  const ready =
    resource.provider === "ecs" &&
    postPaid &&
    ["Running", "Stopped"].includes(status) &&
    !disabled;
  const current = openedFor === resourceKey;
  const terminal = ["hibernated", "cancelled"].includes(
    String(receipt.outcome),
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (open && (!current || (!submitted && !ready))) {
      setOpen(false);
      setConsent(false);
      onOpenChange?.(false);
    }
  }, [open, current, submitted, ready, onOpenChange]);

  async function execute(
    action: "readOperation" | "hibernateEcs" | "cancelEcsHibernation",
    operationId = id,
    resume = false,
  ) {
    if (busy.current || !operationId || (openedFor && !current)) return;
    if (
      action === "hibernateEcs" &&
      (resume
        ? receipt.canResume !== true || terminal
        : submitted || !consent || !ready)
    )
      return;
    if (action === "cancelEcsHibernation" && receipt.canCancel !== true) return;
    busy.current = true;
    const expectedResourceKey = resourceKey;
    setPending(true);
    setError("");
    if (action === "hibernateEcs") setSubmitted(true);
    try {
      const response = object(
        (
          await request(
            action === "readOperation"
              ? { action, operationId }
              : action === "cancelEcsHibernation"
                ? {
                    action,
                    operationId,
                    confirmation: `cancelEcsHibernation:${operationId}`,
                  }
                : {
                    action,
                    operationId,
                    resource,
                    confirmation: `hibernateEcs:${resource.regionId}:${resource.resourceId}:private-image:discard-data`,
                    workSaved: true,
                    includeCredentials: true,
                    discardData: true,
                  },
          )
        ).data,
      );
      const target = object(object(response.request).resource);
      if (
        response.operationId !== operationId ||
        object(response.request).action !== "hibernateEcs" ||
        !(["provider", "regionId", "resourceId", "profile"] as const).every(
          (key) => target[key] === resource[key],
        )
      )
        throw new Error(t("settings.cloudDesktop.invalidResponse"));
      if (alive.current && latestResourceKey.current === expectedResourceKey) {
        setReceipt(response);
        if (action !== "readOperation" || response.outcome === "hibernated")
          onChanged();
      }
    } catch (cause) {
      if (alive.current && latestResourceKey.current === expectedResourceKey)
        setError(String(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }

  useEffect(() => {
    if (
      open &&
      current &&
      submitted &&
      !pending &&
      !error &&
      Object.keys(receipt).length === 0
    )
      void execute("readOperation");
    // Reopening an existing operation only reads its durable state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current, submitted, pending, error, receipt]);

  useEffect(() => {
    if (
      !open ||
      !current ||
      pending ||
      receipt.workerActive !== true ||
      terminal ||
      error
    )
      return;
    const timer = window.setTimeout(() => void execute("readOperation"), 3000);
    return () => window.clearTimeout(timer);
    // The timer reads the latest operation; it never starts or resumes work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current, pending, receipt, terminal, error, id]);

  if (resource.provider !== "ecs" || (!existing && !ready && !submitted))
    return null;
  return (
    <>
      {!hideTrigger && (
        <SettingsAction
          ref={trigger}
          disabled={!existing && !submitted && !ready}
          onClick={() => {
            setOpenedFor(resourceKey);
            setOpen(true);
            onOpenChange?.(true);
            if (submitted && current && !terminal) return;
            const operationId =
              typeof existing?.operationId === "string"
                ? existing.operationId
                : crypto.randomUUID();
            setId(operationId);
            setConsent(false);
            setReceipt({});
            setError("");
            setSubmitted(!!existing);
          }}
        >
          {t(
            `settings.cloudDesktop.${existing || (submitted && !terminal) ? "preservationProgress" : "hibernateEcs"}`,
          )}
        </SettingsAction>
      )}
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          onOpenChange?.(value);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
            onCloseAutoFocus={(event) => {
              const target = returnFocus ?? trigger.current;
              if (target?.isConnected) {
                event.preventDefault();
                target.focus();
              }
            }}
          >
            <Dialog.Title className="text-base font-medium">
              {t("settings.cloudDesktop.hibernateEcs")}
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted-foreground">
              {t("settings.cloudDesktop.changeDescription", { ...resource })}
            </Dialog.Description>
            <p className="text-[13px]">
              {t("settings.cloudDesktop.preservationDescription")}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {t("settings.cloudDesktop.preservationCostPrivacy")}
            </p>
            {!submitted && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                {t("settings.cloudDesktop.preservationConsent")}
              </label>
            )}
            {submitted && (
              <div role="status" className="space-y-3 text-[13px]">
                <ol className="space-y-2">
                  {["stopping", "snapshotting", "imaging", "releasing"].map(
                    (phase) => (
                      <li
                        key={phase}
                        aria-current={
                          receipt.phase === phase ? "step" : undefined
                        }
                        className={
                          receipt.phase === phase
                            ? "font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {t(`settings.cloudDesktop.preservationPhase.${phase}`)}
                      </li>
                    ),
                  )}
                </ol>
                <p>
                  {t(
                    `settings.cloudDesktop.${
                      receipt.outcome === "hibernated"
                        ? "preservationComplete"
                        : receipt.outcome === "cancelled"
                          ? "preservationCancelled"
                          : receipt.canResume === true
                            ? "preservationPaused"
                            : "preservationWaiting"
                    }`,
                  )}
                </p>
                {!terminal && (
                  <p>{t("settings.cloudDesktop.preservationKeepOpen")}</p>
                )}
                {receipt.canCancel === true && (
                  <p className="text-muted-foreground">
                    {t("settings.cloudDesktop.preservationCancelHelp")}
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer">
                    {t("settings.cloudDesktop.resourceDetails")}
                  </summary>
                  <p className="mt-2 select-text break-all">{id}</p>
                  {typeof object(receipt.releaseImage).imageId === "string" && (
                    <p className="select-text break-all">
                      {t("settings.cloudDesktop.imageId")}:{" "}
                      {String(object(receipt.releaseImage).imageId)}
                    </p>
                  )}
                </details>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="break-words text-[13px] text-destructive"
              >
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <SettingsAction>
                  {t("settings.cloudDesktop.close")}
                </SettingsAction>
              </Dialog.Close>
              {!submitted && (
                <SettingsAction
                  disabled={pending || !consent || !ready || !current}
                  onClick={() => void execute("hibernateEcs")}
                >
                  {t("settings.cloudDesktop.confirm")}
                </SettingsAction>
              )}
              {submitted && !terminal && (
                <>
                  {receipt.canCancel === true && (
                    <SettingsAction
                      disabled={pending}
                      onClick={() => void execute("cancelEcsHibernation")}
                    >
                      {t("settings.cloudDesktop.cancelPreservation")}
                    </SettingsAction>
                  )}
                  <SettingsAction
                    disabled={pending}
                    onClick={() => void execute("readOperation")}
                  >
                    {t("settings.cloudDesktop.readOperation")}
                  </SettingsAction>
                  {receipt.canResume === true && (
                    <SettingsAction
                      disabled={pending || !current}
                      onClick={() => void execute("hibernateEcs", id, true)}
                    >
                      {t("settings.cloudDesktop.resumePreservation")}
                    </SettingsAction>
                  )}
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
