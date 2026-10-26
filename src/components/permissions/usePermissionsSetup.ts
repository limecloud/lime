import { useCallback, useEffect, useRef, useState } from "react";
import { hasDesktopHostInvokeCapability } from "@/lib/desktop-runtime";
import {
  listenPermissionsSetup,
  setPermissionsSetupVisible,
} from "@/lib/permissionsSetup";
import {
  readDesktopPermissions,
  requestDesktopPermission,
  openDesktopPermissionSettings,
  completeDesktopPermissionsSetup,
  readAutomationTargets,
  type DesktopPermissionsSnapshot,
  type DesktopPermissionId,
  type AutomationTarget,
} from "@/lib/api/desktopPermissions";
import { showDesktopNotification } from "@/lib/api/desktopNotification";

type SetupAction =
  | "read"
  | "request"
  | "settings"
  | "targets"
  | "notification"
  | "complete";
interface SetupError {
  action: SetupAction;
  permissionId?: DesktopPermissionId;
}

export function usePermissionsSetup() {
  const [open, setOpen] = useState(hasDesktopHostInvokeCapability);
  const [step, setStep] = useState(0);
  const [snapshot, setSnapshot] = useState<DesktopPermissionsSnapshot | null>(
    null,
  );
  const [targets, setTargets] = useState<AutomationTarget[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [notificationSent, setNotificationSent] = useState(false);
  const alive = useRef(false);
  const working = useRef(false);
  const passiveWork = useRef<Promise<void> | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    setPermissionsSetupVisible(open);
    return () => setPermissionsSetupVisible(false);
  }, [open]);

  const run = useCallback(
    async (
      action: () => Promise<void>,
      context: SetupError = { action: "read" },
      passive = false,
    ) => {
      if (!passive && passiveWork.current) {
        setBusy(true);
        await passiveWork.current;
        if (!alive.current) return;
      }
      if (working.current) return;
      working.current = true;
      let release: (() => void) | undefined;
      if (passive)
        passiveWork.current = new Promise<void>((resolve) => {
          release = resolve;
        });
      if (!passive) setBusy(true);
      if (!passive) setError(null);
      try {
        await action();
      } catch (cause) {
        console.error(
          "[PermissionsSetup]",
          context.action,
          context.permissionId ?? "",
          cause,
        );
        if (alive.current && !passive) setError(context);
      } finally {
        working.current = false;
        if (passive) {
          passiveWork.current = null;
          release?.();
        }
        if (alive.current && !passive) setBusy(false);
      }
    },
    [],
  );
  const refresh = useCallback(async () => {
    const queriedTarget = targetRef.current;
    const result = await readDesktopPermissions(queriedTarget || undefined);
    if (alive.current && targetRef.current === queriedTarget)
      setSnapshot(result);
    return result;
  }, []);
  const loadTargets = useCallback(
    () =>
      (async () => {
        // This read must not be dropped while a focus refresh holds the action lock.
        try {
          const values = await readAutomationTargets();
          if (alive.current) setTargets(values);
        } catch (cause) {
          console.error("[PermissionsSetup] targets", cause);
          if (alive.current)
            setError({ action: "targets", permissionId: "automation" });
        }
      })(),
    [],
  );

  useEffect(() => {
    alive.current = true;
    if (hasDesktopHostInvokeCapability())
      void run(async () => {
        try {
          const result = await refresh();
          if (alive.current) setOpen(!result.setupComplete);
        } catch (cause) {
          if (alive.current) setOpen(true);
          throw cause;
        }
      });
    const unsubscribe = listenPermissionsSetup(() => {
      setError(null);
      setStep(0);
      setOpen(true);
    });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [refresh, run]);
  useEffect(() => {
    if (!open) return;
    void run(async () => {
      await refresh();
    });
    const recheck = () => {
      if (document.visibilityState !== "hidden")
        void run(
          async () => {
            await refresh();
          },
          { action: "read" },
          true,
        );
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    // System consent sheets do not always produce a renderer focus event.
    const timer = window.setInterval(recheck, 2000);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      window.clearInterval(timer);
    };
  }, [open, target, refresh, run]);

  return {
    open,
    step,
    setStep: (value: number) => {
      setError(null);
      setStep(value);
    },
    snapshot,
    busy,
    error,
    targets,
    target,
    notificationSent,
    setTarget: (value: string) => {
      if (!working.current || passiveWork.current) {
        setError(null);
        targetRef.current = value;
        setTarget(value);
        setSnapshot((current) =>
          current
            ? {
                ...current,
                permissions: current.permissions.map((permission) =>
                  permission.id === "automation"
                    ? { ...permission, state: "unknown" }
                    : permission,
                ),
              }
            : null,
        );
      }
    },
    refresh: () =>
      run(async () => {
        await refresh();
      }),
    loadTargets,
    request: (id: DesktopPermissionId) =>
      run(
        async () => {
          try {
            const result = await requestDesktopPermission(
              id,
              id === "automation" ? targetRef.current || undefined : undefined,
            );
            if (alive.current) setSnapshot(result);
          } catch (cause) {
            // A failed recheck must not replace the original request failure.
            await refresh().catch(() => undefined);
            throw cause;
          }
        },
        { action: "request", permissionId: id },
      ),
    settings: (id: DesktopPermissionId, permissionId = id) =>
      run(
        async () => {
          await openDesktopPermissionSettings(id);
        },
        { action: "settings", permissionId },
      ),
    testNotification: (title: string, body: string) =>
      run(
        async () => {
          const result = await showDesktopNotification({
            title,
            body,
            tag: "permissions-setup",
          });
          if (result.status !== "sent")
            throw new Error("Notification unavailable");
          if (alive.current) setNotificationSent(true);
        },
        { action: "notification", permissionId: "notifications" },
      ),
    finish: () =>
      run(
        async () => {
          await completeDesktopPermissionsSetup();
          if (alive.current) setOpen(false);
        },
        { action: "complete" },
      ),
  };
}
