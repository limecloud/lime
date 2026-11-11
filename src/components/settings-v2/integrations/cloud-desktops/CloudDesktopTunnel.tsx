import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import { SettingsAction } from "../../SettingsPrimitives";
import type { CloudRequest } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export function CloudDesktopTunnel({
  resource,
  running,
  request,
}: {
  resource: CloudDesktopResource;
  running: boolean;
  request: CloudRequest;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [connectionFailed, setConnectionFailed] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const execute = useCallback(
    async (action: "openEcsTunnel" | "readEcsTunnel" | "closeEcsTunnel") => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError("");
      const current = generation.current;
      try {
        const params: Parameters<CloudRequest>[0] = {
          action,
          resource,
          channel: "desktop",
        };
        const data = object((await request(params)).data);
        if (current !== generation.current) return;
        if (
          data.channel !== "desktop" ||
          !["listening", "closed"].includes(String(data.state))
        )
          throw new Error(t("settings.cloudDesktop.invalidResponse"));
        let address = "";
        if (data.state === "listening") {
          const url = new URL(String(data.endpoint));
          if (
            url.protocol !== "http:" ||
            url.hostname !== "127.0.0.1" ||
            !url.port ||
            url.pathname !== "/vnc.html" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            throw new Error(t("settings.cloudDesktop.invalidResponse"));
          address = url.toString();
        }
        setEndpoint(address);
        setConnectionFailed(data.connectionFailed === true);
      } catch (cause) {
        if (current === generation.current)
          setError(
            String(cause).includes(
              "ErrorCode=InvalidOperation.SecurityGroupRuleDenied",
            )
              ? t("settings.cloudDesktop.tunnelSecurityGroupDenied")
              : String(cause),
          );
      } finally {
        busy.current = false;
        if (current === generation.current) setPending(false);
      }
    },
    [resource, request, t],
  );

  useEffect(() => {
    if (!open || !endpoint) return;
    const timer = setInterval(() => void execute("readEcsTunnel"), 5000);
    return () => clearInterval(timer);
  }, [open, endpoint, execute]);

  async function openDesktop() {
    setError("");
    try {
      await openExternalUrlWithSystemBrowser(endpoint);
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (pending) return;
        setOpen(value);
        setError("");
        if (value) void execute("readEcsTunnel");
      }}
    >
      <Dialog.Trigger asChild>
        <SettingsAction disabled={!running}>
          {t("settings.cloudDesktop.tunnelDesktop")}
        </SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-[16px] font-medium">
            {t("settings.cloudDesktop.tunnelDesktop")}
          </Dialog.Title>
          <Dialog.Description className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.tunnelDescription")}
          </Dialog.Description>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.tunnelRequiresRuntime")}
          </p>
          {endpoint && (
            <>
              <p role="status" className="text-[13px]">
                {t("settings.cloudDesktop.tunnelListening")}
              </p>
              <p className="select-text break-all text-[12px] text-muted-foreground">
                {endpoint}
              </p>
            </>
          )}
          {connectionFailed && (
            <p role="alert" className="text-[13px] text-destructive">
              {t("settings.cloudDesktop.tunnelConnectionFailed")}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="break-words text-[13px] text-destructive"
            >
              {error}
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
            {endpoint ? (
              <>
                <SettingsAction
                  disabled={pending}
                  onClick={() => void execute("closeEcsTunnel")}
                >
                  {t("settings.cloudDesktop.tunnelDisconnect")}
                </SettingsAction>
                <SettingsAction
                  disabled={pending || !running}
                  onClick={() => void openDesktop()}
                >
                  {t("settings.cloudDesktop.tunnelOpenDesktop")}
                </SettingsAction>
              </>
            ) : (
              <SettingsAction
                disabled={pending || !running}
                onClick={() => void execute("openEcsTunnel")}
              >
                {t("settings.cloudDesktop.tunnelConnect")}
              </SettingsAction>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
