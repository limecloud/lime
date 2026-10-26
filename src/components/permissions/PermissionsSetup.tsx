import { useEffect, useId } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LIME_BRAND_LOGO_SRC } from "@/lib/branding";
import type {
  DesktopPermission,
  DesktopPermissionId,
} from "@/lib/api/desktopPermissionsTypes";
import { usePermissionsSetup } from "./usePermissionsSetup";

const steps: { key: string; ids: DesktopPermissionId[] }[] = [
  { key: "installation", ids: ["installation"] },
  { key: "security", ids: ["secureStorage"] },
  {
    key: "computer",
    ids: ["accessibility", "screenCapture", "inputMonitoring", "automation"],
  },
  { key: "media", ids: ["microphone", "camera"] },
  { key: "system", ids: ["notifications", "localNetwork", "location"] },
  { key: "files", ids: ["files", "fullDiskAccess"] },
];
const button =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-[13px] font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export function PermissionsSetup() {
  const { t } = useTranslation("settings");
  const setup = usePermissionsSetup();
  const targetId = useId();
  const text = (key: string) => t(`settings.permissionsSetup.${key}`);
  const availableSteps = steps.filter(
    (step) =>
      !setup.snapshot ||
      step.ids.some(
        (id) =>
          setup.snapshot?.permissions.find((item) => item.id === id)?.state !==
          "notApplicable",
      ),
  );
  const index = Math.min(setup.step, availableSteps.length - 1);
  const current = availableSteps[index];
  const { loadTargets } = setup;
  useEffect(() => {
    if (current.key === "computer" && setup.snapshot?.platform === "darwin")
      void loadTargets();
  }, [current.key, setup.snapshot?.platform, loadTargets]);

  function permissionRow(permission: DesktopPermission) {
    const { id, state } = permission;
    if (state === "notApplicable") return null;
    const granted = state === "granted";
    const showRequest = permission.canRequest && (!granted || id === "files");
    const showSettings =
      permission.canOpenSettings &&
      !granted &&
      (!permission.canRequest ||
        state === "unavailable" ||
        (id === "files" && state === "denied"));
    const showNotification =
      id === "notifications" && (granted || state === "unknown");
    return (
      <section
        key={id}
        data-permission={id}
        className="space-y-3 py-3 first:pt-0 last:pb-0"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[14px] font-medium">
            {text(`permission.${id}.title`)}
          </h3>
          <span
            className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground"
            role="status"
            data-permission-state={state}
          >
            {granted ? <Check className="size-3.5" aria-hidden="true" /> : null}
            {text(`state.${state}`)}
          </span>
        </div>
        {!granted ? (
          <p className="text-[13px] leading-5 text-muted-foreground">
            {text(
              id === "secureStorage" &&
                ["denied", "unavailable"].includes(state)
                ? setup.snapshot?.platform === "darwin"
                  ? "storageRecoveryMac"
                  : "storageRecovery"
                : `permission.${id}.${setup.snapshot?.platform === "win32" && ["installation", "microphone", "camera", "localNetwork", "files"].includes(id) ? "windowsDescription" : "description"}`,
            )}
          </p>
        ) : null}
        {id === "automation" ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={targetId}>
              {text("selectApp")}
            </label>
            <select
              id={targetId}
              value={setup.target}
              disabled={setup.busy}
              onChange={(event) => setup.setTarget(event.target.value)}
              className="h-8 max-w-full rounded-md border-[0.5px] border-border bg-background px-2 text-[13px]"
            >
              <option value="">{text("selectApp")}</option>
              {setup.targets.map((target) => (
                <option key={target.bundleId} value={target.bundleId}>
                  {target.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={button}
              disabled={setup.busy}
              onClick={() => void setup.loadTargets()}
            >
              {text("refreshApps")}
            </button>
          </div>
        ) : null}
        {id === "files" && setup.snapshot?.selectedDirectory ? (
          <p
            className="truncate text-[12px] text-muted-foreground"
            title={setup.snapshot.selectedDirectory}
          >
            {setup.snapshot.selectedDirectory}
          </p>
        ) : null}
        {showRequest || showSettings || showNotification ? (
          <div className="flex flex-wrap gap-2">
            {showRequest ? (
              <button
                type="button"
                className={button}
                disabled={setup.busy || (id === "automation" && !setup.target)}
                onClick={() => void setup.request(id)}
              >
                {text(
                  id === "files"
                    ? "chooseFolder"
                    : id === "secureStorage"
                      ? ["denied", "unavailable"].includes(state)
                        ? "retryStorage"
                        : "verifyStorage"
                      : [
                            "camera",
                            "microphone",
                            "notifications",
                            "location",
                          ].includes(id) && state === "denied"
                        ? "openSettings"
                        : "enable",
                )}
              </button>
            ) : null}
            {showSettings ? (
              <button
                type="button"
                className={button}
                disabled={setup.busy}
                onClick={() => void setup.settings(id)}
              >
                {text(
                  id === "installation" ? "showApplication" : "openSettings",
                )}
              </button>
            ) : null}
            {id === "fullDiskAccess" && !granted ? (
              <button
                type="button"
                className={button}
                disabled={setup.busy}
                onClick={() =>
                  void setup.settings("installation", "fullDiskAccess")
                }
              >
                {text("showApplication")}
              </button>
            ) : null}
            {showNotification ? (
              <button
                type="button"
                className={button}
                disabled={setup.busy}
                onClick={() =>
                  void setup.testNotification(
                    text("notificationTitle"),
                    text("notificationBody"),
                  )
                }
              >
                {text("testNotification")}
              </button>
            ) : null}
          </div>
        ) : null}
        {id === "notifications" && setup.notificationSent ? (
          <p role="status" className="text-[12px] text-muted-foreground">
            {text("notificationSent")}
          </p>
        ) : null}
        {id === "fullDiskAccess" && !granted ? (
          <p className="text-[12px] leading-5 text-muted-foreground">
            {text("fullDiskInstructions")}
          </p>
        ) : null}
        {setup.error?.permissionId === id ? (
          <p role="alert" className="text-[13px] text-destructive">
            {text(`errors.${setup.error.action}`)}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <Dialog.Root
      open={setup.open}
      onOpenChange={(open) => {
        if (!open && !setup.busy) void setup.finish();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-[color:var(--lime-stage-surface-soft)] opacity-95" />
        <Dialog.Content
          data-testid="permissions-setup"
          aria-busy={setup.busy}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            if (!setup.busy) void setup.finish();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[101] flex max-h-[calc(100vh-32px)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border-[0.5px] border-border bg-background text-foreground outline-none"
        >
          <header className="flex shrink-0 items-center gap-3 border-b-[0.5px] border-border px-6 py-5">
            <img
              src={LIME_BRAND_LOGO_SRC}
              alt=""
              className="size-8 object-contain"
            />
            <div>
              <Dialog.Title className="text-[18px] font-semibold">
                {text("title")}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {text("description")}
              </Dialog.Description>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <div className="flex shrink-0 items-center justify-between gap-4 px-6 pb-5 pt-5">
              <div className="flex items-center gap-3">
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {index + 1} / {availableSteps.length}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={text("steps")}
                aria-valuemin={1}
                aria-valuemax={availableSteps.length}
                aria-valuenow={index + 1}
                aria-valuetext={text(`step.${current.key}`)}
                className="flex gap-1.5"
              >
                {availableSteps.map((step, position) => (
                  <span
                    key={step.key}
                    className={`h-1 w-5 rounded-full ${position <= index ? "bg-primary" : "bg-muted"}`}
                  />
                ))}
              </div>
            </div>
            <main className="min-w-0 flex-1 px-6 pb-6">
              {setup.snapshot ? (
                <div className="divide-y-[0.5px] divide-border">
                  {current.ids
                    .map((id) =>
                      setup.snapshot!.permissions.find(
                        (item) => item.id === id,
                      ),
                    )
                    .filter((item): item is DesktopPermission => Boolean(item))
                    .map(permissionRow)}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  {text(setup.busy ? "checking" : "loadFailed")}
                </p>
              )}
              {setup.error && !setup.error.permissionId && setup.snapshot ? (
                <p role="alert" className="mt-4 text-[13px] text-destructive">
                  {text(`errors.${setup.error.action}`)}
                </p>
              ) : null}
            </main>
          </div>
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t-[0.5px] border-border px-6 py-4">
            {index > 0 ? (
              <button
                type="button"
                className={button}
                disabled={setup.busy}
                onClick={() => setup.setStep(index - 1)}
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
                {text("back")}
              </button>
            ) : null}
            <button
              type="button"
              className={`${button} mr-auto`}
              disabled={setup.busy}
              onClick={() => void setup.refresh()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {text("recheck")}
            </button>
            <button
              type="button"
              className="min-h-8 px-2 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={setup.busy}
              onClick={() => void setup.finish()}
            >
              {text("later")}
            </button>
            <button
              type="button"
              className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
              disabled={setup.busy || !setup.snapshot}
              onClick={() =>
                index < availableSteps.length - 1
                  ? setup.setStep(index + 1)
                  : void setup.finish()
              }
            >
              {text(index < availableSteps.length - 1 ? "next" : "finish")}
              {index < availableSteps.length - 1 ? (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              ) : null}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
