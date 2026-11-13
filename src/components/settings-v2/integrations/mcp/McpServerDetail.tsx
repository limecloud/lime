import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { McpServer } from "@/lib/api/mcp";
import { SettingsAction, SettingsPageHeader } from "../../SettingsPrimitives";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";
import { SettingsUnsavedChangesDialog } from "../../_layout/SettingsUnsavedChangesDialog";
import {
  createMcpServerDraft,
  mcpServerConfig,
  mcpServerDraftValid,
} from "./mcpServerConfig";
import { McpServerFields } from "./McpServerFields";
import type { McpSettingsController } from "./useMcpSettings";

export function McpServerDetail({
  server,
  controller,
  onClose,
}: {
  server?: McpServer;
  controller: McpSettingsController;
  onClose: () => void;
}) {
  const { t } = useTranslation("settings");
  const baseline = useRef(createMcpServerDraft(server));
  const id = useRef(server?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState(baseline.current);
  const [discard, setDiscard] = useState(false);
  const [uninstall, setUninstall] = useState(false);
  const uninstallButton = useRef<HTMLButtonElement>(null);
  const { pending, loading, error, awaitingConfirmation } = controller;
  const initialConfirmationVersion = useRef(controller.confirmationVersion);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current);
  const locked = pending || loading;
  useEffect(() => {
    if (
      !locked &&
      !error &&
      controller.confirmationVersion > initialConfirmationVersion.current
    )
      onClose();
  }, [locked, error, controller.confirmationVersion, onClose]);
  useSettingsDraft({ dirty, saving: locked });
  const close = () => {
    if (!locked) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  const retry = async () => {
    if (await controller.reload()) onClose();
  };
  const save = async () => {
    if (!mcpServerDraftValid(draft) || locked || awaitingConfirmation) return;
    const next: McpServer = server
      ? {
          ...server,
          name: draft.name.trim(),
          server_config: mcpServerConfig(draft, server.server_config),
        }
      : {
          id: id.current,
          name: draft.name.trim(),
          server_config: mcpServerConfig(draft),
          enabled_lime: true,
        };
    if (
      await controller.mutate({
        kind: "save",
        server: next,
        create: !server,
        previous: server,
      })
    )
      onClose();
  };
  return (
    <div className="min-w-0 space-y-6" data-testid="mcp-config-detail">
      <SettingsAction
        type="button"
        disabled={locked}
        onClick={close}
        data-testid="mcp-config-cancel"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t("settings.plugins.mcp.back")}
      </SettingsAction>
      <SettingsPageHeader
        title={
          server
            ? t("settings.plugins.mcp.titleExisting", { name: server.name })
            : t("settings.plugins.mcp.titleNew")
        }
      />
      <form
        className="min-w-0 space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <McpServerFields
          draft={draft}
          existing={Boolean(server)}
          disabled={locked || awaitingConfirmation}
          onChange={setDraft}
        />
        {error && !uninstall ? (
          <div role="alert" className="text-[13px] text-destructive">
            {t(`settings.plugins.mcp.error.${error}`)}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {server ? (
            <SettingsAction
              type="button"
              $tone="danger"
              disabled={locked || awaitingConfirmation}
              ref={uninstallButton}
              onClick={() => {
                controller.clearError();
                setUninstall(true);
              }}
              data-testid="mcp-config-delete"
            >
              {t("settings.plugins.mcp.uninstall")}
            </SettingsAction>
          ) : null}
          {awaitingConfirmation ? (
            <SettingsAction
              type="button"
              disabled={locked}
              onClick={() => void retry()}
            >
              {t("settings.browser.retry")}
            </SettingsAction>
          ) : null}
          <SettingsAction
            type="submit"
            disabled={
              locked ||
              awaitingConfirmation ||
              !dirty ||
              !mcpServerDraftValid(draft)
            }
            data-testid="mcp-config-save"
          >
            {t("settings.plugins.mcp.save")}
          </SettingsAction>
        </div>
      </form>
      <SettingsUnsavedChangesDialog
        pendingNavigation={discard}
        saving={locked}
        onClearPendingNavigation={() => setDiscard(false)}
        onDiscardChanges={onClose}
        size="compact"
      />
      <Dialog.Root
        open={uninstall}
        onOpenChange={(open) => {
          if (!locked) setUninstall(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl"
            onEscapeKeyDown={(event) => {
              if (locked) event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              if (!locked) setUninstall(false);
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              uninstallButton.current?.focus();
            }}
          >
            <Dialog.Title className="text-[16px] font-medium">
              {t("settings.plugins.mcp.uninstallTitle", { name: server?.name })}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
              {t("settings.plugins.mcp.uninstallDescription")}
            </Dialog.Description>
            {error ? (
              <p role="alert" className="mt-3 text-[13px] text-destructive">
                {t(`settings.plugins.mcp.error.${error}`)}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <SettingsAction type="button" disabled={locked}>
                  {t("settings.unsavedChanges.keepEditing")}
                </SettingsAction>
              </Dialog.Close>
              {awaitingConfirmation ? (
                <SettingsAction
                  type="button"
                  disabled={locked}
                  onClick={() => void retry()}
                >
                  {t("settings.browser.retry")}
                </SettingsAction>
              ) : (
                <SettingsAction
                  type="button"
                  $tone="danger"
                  disabled={locked}
                  onClick={async () => {
                    if (
                      server &&
                      (await controller.mutate({
                        kind: "delete",
                        id: server.id,
                      }))
                    )
                      onClose();
                  }}
                >
                  {t("settings.plugins.mcp.uninstall")}
                </SettingsAction>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
