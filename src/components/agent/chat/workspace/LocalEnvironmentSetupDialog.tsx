import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  createLocalEnvironmentDraft,
  serializeLocalEnvironment,
  validateLocalEnvironmentDraft,
  type LocalEnvironmentDraft,
} from "@/lib/localEnvironments";
import { LocalEnvironmentFields } from "@/components/settings-v2/coding/local-environments/LocalEnvironmentFields";
import { LifecycleEditor } from "@/components/settings-v2/coding/local-environments/LifecycleEditor";
import { SettingsUnsavedChangesDialog } from "@/components/settings-v2/_layout/SettingsUnsavedChangesDialog";

/** Compact create mode shares the settings editor fields and the same CAS gateway. */
export function LocalEnvironmentSetupDialog({
  configPath,
  workspaceRoot,
  selectEnvironment,
  onClose,
  onSaved,
  restoreFocus,
}: {
  configPath: string;
  workspaceRoot: string;
  selectEnvironment: (configPath: string) => Promise<boolean>;
  onClose: () => void;
  onSaved: (draft: LocalEnvironmentDraft) => void;
  restoreFocus: () => void;
}) {
  const { t } = useTranslation(["agent", "settings"]);
  const [draft, setDraft] = useState(() =>
    createLocalEnvironmentDraft(
      null,
      workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ||
        t("agentChat.localEnvironmentActions.defaultEnvironment"),
    ),
  );
  const baseline = useRef(JSON.stringify(draft));
  const [advanced, setAdvanced] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"save" | "conflict" | null>(null);
  const pending = useRef(false);
  const alive = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== baseline.current;
  const validation = validateLocalEnvironmentDraft(draft);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const requestClose = () => {
    if (pending.current || discard) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const save = async () => {
    if (
      pending.current ||
      !draft.setupScript.trim() ||
      validation.missingName ||
      validation.incompleteActionIds.length ||
      error === "conflict"
    )
      return;
    pending.current = true;
    setSaving(true);
    setError(null);
    let saved = false;
    try {
      const result = await localEnvironments.saveConfig({
        configPath,
        expectedRevision: null,
        raw: serializeLocalEnvironment(draft),
      });
      if (!alive.current) return;
      if (result.type === "conflict") {
        setError("conflict");
        return;
      }
      saved = true;
      let selected = false;
      try {
        selected = await selectEnvironment(result.configPath);
      } catch {
        /* The saved file remains available for selection. */
      }
      if (alive.current && !selected)
        toast.error(t("settings:settings.localEnvironments.error.selection"));
    } catch {
      if (alive.current) setError("save");
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
    if (alive.current && saved) onSaved(draft);
  };
  return (
    <>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            ref={content}
            data-testid="local-environment-setup-dialog"
            aria-busy={saving}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl border border-border bg-background p-5 text-[14px] leading-normal text-foreground shadow-xl outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              content.current?.querySelector("textarea")?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocus();
            }}
            onEscapeKeyDown={(event) => {
              if (saving || discard) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (saving || discard) event.preventDefault();
            }}
          >
            <header className="mb-3 pr-7">
              <Dialog.Title className="text-[18px] font-semibold leading-7">
                {t("agentChat.localEnvironmentActions.setupTitle")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[14px] leading-normal text-muted-foreground">
                {t("agentChat.localEnvironmentActions.setupDescription")}
              </Dialog.Description>
            </header>
            <button
              type="button"
              disabled={saving}
              onClick={requestClose}
              aria-label={t("agentChat.localEnvironmentActions.closeSetup")}
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <form
              className="min-h-0 space-y-5 overflow-y-auto"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={saving} className="min-w-0 space-y-5">
                {!advanced ? (
                  <LifecycleEditor
                    simpleSetup
                    type="setup"
                    draft={draft}
                    disabled={saving}
                    onChange={setDraft}
                  />
                ) : null}
                <button
                  type="button"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                  className="flex items-center gap-2 text-[13px] font-medium"
                >
                  <ChevronRight
                    className={`h-4 w-4 ${advanced ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                  {t("agentChat.localEnvironmentActions.advancedOptions")}
                </button>
                {advanced ? (
                  <LocalEnvironmentFields
                    draft={draft}
                    disabled={saving}
                    onChange={setDraft}
                  />
                ) : null}
              </fieldset>
              {error ? (
                <p role="alert" className="text-[13px] text-destructive">
                  {t(
                    error === "conflict"
                      ? "agentChat.localEnvironmentActions.setupConflict"
                      : "settings:settings.localEnvironments.error.save",
                  )}
                </p>
              ) : null}
              <footer className="flex justify-end">
                <button
                  type="submit"
                  disabled={
                    saving ||
                    !draft.setupScript.trim() ||
                    validation.missingName ||
                    Boolean(validation.incompleteActionIds.length) ||
                    error === "conflict"
                  }
                  className="h-8 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  {t(
                    saving
                      ? "settings:settings.localEnvironments.saving"
                      : "agentChat.localEnvironmentActions.setup",
                  )}
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SettingsUnsavedChangesDialog
        size="compact"
        pendingNavigation={discard}
        saving={saving}
        title={t("agentChat.localEnvironmentActions.discardSetupTitle")}
        description={t(
          "agentChat.localEnvironmentActions.discardSetupDescription",
        )}
        discardLabel={t("agentChat.localEnvironmentActions.discardSetup")}
        onClearPendingNavigation={() => setDiscard(false)}
        onDiscardChanges={() => {
          setDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
