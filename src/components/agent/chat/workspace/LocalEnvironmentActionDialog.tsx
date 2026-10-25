import { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { X } from "lucide-react";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  createEnvironmentAction,
  createLocalEnvironmentDraft,
  serializeLocalEnvironment,
  type EnvironmentActionDraft,
} from "@/lib/localEnvironments";
import { environmentInputClass } from "@/components/settings-v2/coding/local-environments/LifecycleEditor";
import { EnvironmentActionIcon } from "./EnvironmentActionIcon";

/** Adapted from the packaged Desktop action dialog; symbols are minified upstream. */
export function LocalEnvironmentActionDialog({
  configPath,
  workspaceRoot,
  onClose,
  onOpenSettings,
  onSaved,
  restoreFocus,
}: {
  configPath: string;
  workspaceRoot: string;
  onClose: () => void;
  onOpenSettings?: () => void;
  onSaved: (action: EnvironmentActionDraft) => void;
  restoreFocus: () => void;
}) {
  const { t, i18n } = useTranslation(["agent", "settings"]);
  const id = useId();
  const [action, setAction] = useState(createEnvironmentAction);
  const [config, setConfig] = useState<Awaited<
    ReturnType<typeof localEnvironments.readConfig>
  > | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const labelClass = `block text-[12px] font-medium text-muted-foreground${i18n.resolvedLanguage?.startsWith("en") ? " uppercase tracking-wide" : ""}`;
  useEffect(() => {
    let current = true;
    alive.current = true;
    void localEnvironments.readConfig(configPath).then(
      (result) => {
        if (!current) return;
        setConfig(result);
        setLoadError(!result.exists || result.environment?.type !== "success");
      },
      () => {
        if (current) setLoadError(true);
      },
    );
    return () => {
      current = false;
      alive.current = false;
    };
  }, [configPath]);
  const disabled =
    !action.name.trim() ||
    !action.command.trim() ||
    !config?.exists ||
    config.environment?.type !== "success" ||
    loadError ||
    saving;
  const save = async () => {
    if (disabled || pending.current || config?.environment?.type !== "success")
      return;
    pending.current = true;
    setSaving(true);
    content.current?.focus();
    const next = {
      ...action,
      name: action.name.trim(),
      command: action.command.trim(),
    };
    let result;
    try {
      const draft = createLocalEnvironmentDraft(config.environment.environment);
      draft.name ||=
        workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ||
        t("agentChat.localEnvironmentActions.defaultEnvironment");
      draft.actions.push(next);
      result = await localEnvironments.saveConfig({
        configPath: config.configPath,
        expectedRevision: config.revision ?? null,
        raw: serializeLocalEnvironment(draft),
      });
    } catch {
      if (alive.current)
        toast.error(t("agentChat.localEnvironmentActions.addSaveError"));
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
    if (!alive.current || !result) return;
    if (result.type === "conflict") {
      onClose();
      toast.error(t("agentChat.localEnvironmentActions.addConflict"));
    } else onSaved(next);
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          ref={content}
          data-testid="local-environment-action-dialog"
          aria-busy={(!config && !loadError) || saving}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-4rem)] w-[379px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-border bg-background p-0 text-[14px] leading-normal text-foreground shadow-xl outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <form
            className="flex flex-col gap-3 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <header className="flex flex-col gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/5">
                <EnvironmentActionIcon icon={action.icon} className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <Dialog.Title className="text-[18px] font-semibold leading-7">
                  {t("agentChat.localEnvironmentActions.add")}
                </Dialog.Title>
                <Dialog.Description className="text-[14px] leading-normal text-muted-foreground">
                  {t("agentChat.localEnvironmentActions.addDescription")}
                </Dialog.Description>
                {loadError ? (
                  <p role="alert" className="text-[13px] text-destructive">
                    {t("agentChat.localEnvironmentActions.addLoadError")}
                  </p>
                ) : null}
              </div>
            </header>
            <div className="space-y-2">
              <label htmlFor={`${id}-name`} className={labelClass}>
                {t("settings:settings.localEnvironments.actionName")}
              </label>
              <div className="flex items-center gap-2">
                <Menu.Root>
                  <Menu.Trigger asChild disabled={saving}>
                    <button
                      type="button"
                      aria-label={t(
                        "settings:settings.localEnvironments.actionIcon",
                      )}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <EnvironmentActionIcon icon={action.icon} />
                    </button>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content
                      align="start"
                      sideOffset={4}
                      className="z-[60] flex gap-1 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
                    >
                      {(["tool", "run", "debug", "test"] as const).map(
                        (icon) => (
                          <Menu.Item
                            key={icon}
                            aria-label={t(
                              `settings:settings.localEnvironments.icon.${icon}`,
                            )}
                            onSelect={() => setAction({ ...action, icon })}
                            className="flex h-8 w-8 items-center justify-center rounded-lg outline-none data-[highlighted]:bg-accent"
                          >
                            <EnvironmentActionIcon icon={icon} />
                          </Menu.Item>
                        ),
                      )}
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
                <input
                  ref={input}
                  id={`${id}-name`}
                  className={environmentInputClass}
                  disabled={saving}
                  value={action.name}
                  onChange={(event) =>
                    setAction({ ...action, name: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-command`} className={labelClass}>
                {t("agentChat.localEnvironmentActions.commandLabel")}
              </label>
              <textarea
                id={`${id}-command`}
                rows={8}
                spellCheck={false}
                className={`${environmentInputClass} resize-y font-mono`}
                placeholder={t(
                  "agentChat.localEnvironmentActions.commandPlaceholder",
                )}
                disabled={saving}
                value={action.command}
                onChange={(event) =>
                  setAction({ ...action, command: event.target.value })
                }
              />
            </div>
            <footer className="flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={saving || !onOpenSettings}
                onClick={onOpenSettings}
                className="text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {t("agentChat.localEnvironmentActions.environmentSettings")}
              </button>
              <button
                type="submit"
                disabled={disabled}
                className="h-8 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
              >
                {t(
                  saving
                    ? "settings:settings.localEnvironments.saving"
                    : "settings:settings.localEnvironments.save",
                )}
              </button>
            </footer>
          </form>
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label={t("agentChat.localEnvironmentActions.close")}
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
