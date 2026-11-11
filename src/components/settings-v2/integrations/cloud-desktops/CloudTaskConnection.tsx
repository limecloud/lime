import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import type { CloudDesktopConnectionTransport } from "@/lib/desktop-host/cloudDesktopConnection";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import { isElectronHostCommandAvailable } from "@/lib/electron-host";
import { SettingsAction } from "../../SettingsPrimitives";
import { Field, inputClass } from "./CloudDesktopPrimitives";

export function CloudTaskConnection({
  resource,
  running,
}: {
  resource: CloudDesktopResource;
  running: boolean;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [savedEndpoint, setSavedEndpoint] = useState("");
  const defaultTransport = resource.provider === "ecs" ? "ecsTunnel" : "direct";
  const [transport, setTransport] =
    useState<CloudDesktopConnectionTransport>(defaultTransport);
  const [savedTransport, setSavedTransport] =
    useState<CloudDesktopConnectionTransport>(defaultTransport);
  const [token, setToken] = useState("");
  const [exists, setExists] = useState(false);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const supported = isElectronHostCommandAvailable("cloud_desktop_connection");

  async function execute(action: "status" | "save" | "open" | "delete") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await configureCloudDesktopConnection(
        action === "save"
          ? transport === "ecsTunnel"
            ? { action: "saveEcsTunnel", resource, token }
            : { action, resource, endpoint, token }
          : { action, resource },
      );
      if (action === "status" || action === "save") {
        if (!("exists" in result) || "kind" in result)
          throw new Error(t("settings.cloudDesktop.invalidResponse"));
        setExists(result.exists);
        setAvailable(result.available);
        setEndpoint(result.endpoint ?? "");
        setSavedEndpoint(result.endpoint ?? "");
        const selected = result.exists
          ? (result.transport ?? "direct")
          : defaultTransport;
        setTransport(selected);
        setSavedTransport(selected);
      }
      if (action === "save") {
        setToken("");
        setMessage(t("settings.cloudDesktop.connectionSaved"));
      }
      if (action === "delete") {
        setExists(false);
        setEndpoint("");
        setToken("");
        setSavedEndpoint("");
        setTransport(defaultTransport);
        setSavedTransport(defaultTransport);
      }
      if (action === "open") {
        setOpen(false);
        setToken("");
      }
    } catch (cause) {
      setError(
        String(cause).includes("ECS_SECURITY_GROUP_DENIED")
          ? t("settings.cloudDesktop.tunnelSecurityGroupDenied")
          : String(cause).includes("ECS_TUNNEL_FAILED")
            ? t("settings.cloudDesktop.taskTunnelFailed")
            : String(cause),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (pending) return;
        setOpen(value);
        setToken("");
        setError("");
        setMessage("");
        if (value) {
          setEndpoint("");
          setExists(false);
          setAvailable(false);
          void execute("status");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <SettingsAction disabled={!supported}>
          {t("settings.cloudDesktop.taskConnection")}
        </SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-[16px] font-medium">
            {t("settings.cloudDesktop.taskConnection")}
          </Dialog.Title>
          <Dialog.Description className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.taskConnectionDescription")}
          </Dialog.Description>
          <p className="select-text break-all text-[12px] text-muted-foreground">
            {resource.resourceId} / {resource.regionId}
          </p>
          {!pending && !available && (
            <p role="alert" className="text-[13px] text-destructive">
              {t("settings.cloudDesktop.secureStorageUnavailable")}
            </p>
          )}
          {resource.provider === "ecs" && (
            <Field name="connectionTransport">
              <select
                className={inputClass}
                value={transport}
                onChange={(event) => {
                  setTransport(
                    event.target.value as CloudDesktopConnectionTransport,
                  );
                  setToken("");
                  setError("");
                  setMessage("");
                }}
                disabled={pending || !available}
              >
                <option value="ecsTunnel">
                  {t("settings.cloudDesktop.connectionEcsTunnel")}
                </option>
                <option value="direct">
                  {t("settings.cloudDesktop.connectionDirect")}
                </option>
              </select>
            </Field>
          )}
          {transport === "direct" ? (
            <Field name="connectionEndpoint">
              <input
                className={inputClass}
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                disabled={pending || !available}
                type="url"
                spellCheck={false}
                autoComplete="off"
                placeholder="wss://"
              />
            </Field>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {t("settings.cloudDesktop.taskTunnelHelp")}
            </p>
          )}
          <Field name="connectionToken">
            <input
              className={inputClass}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={pending || !available}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
            />
          </Field>
          <p className="text-[12px] text-muted-foreground">
            {t("settings.cloudDesktop.connectionSecretHelp")}
          </p>
          {error && (
            <p
              role="alert"
              className="break-words text-[13px] text-destructive"
            >
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-[13px]">
              {message}
            </p>
          )}
          {pending && (
            <p role="status" className="text-[13px]">
              {t("settings.cloudDesktop.working")}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <SettingsAction disabled={pending}>
                {t("settings.cloudDesktop.close")}
              </SettingsAction>
            </Dialog.Close>
            {exists && (
              <SettingsAction
                disabled={pending}
                onClick={() => void execute("delete")}
              >
                {t("settings.cloudDesktop.forgetConnection")}
              </SettingsAction>
            )}
            <SettingsAction
              disabled={
                pending ||
                !available ||
                (transport === "direct" && !endpoint.trim()) ||
                !token.trim()
              }
              onClick={() => void execute("save")}
            >
              {t("settings.cloudDesktop.saveConnection")}
            </SettingsAction>
            <SettingsAction
              disabled={
                pending ||
                !available ||
                !exists ||
                !running ||
                token.length > 0 ||
                transport !== savedTransport ||
                endpoint !== savedEndpoint
              }
              onClick={() => void execute("open")}
            >
              {t("settings.cloudDesktop.openCloudWindow")}
            </SettingsAction>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
