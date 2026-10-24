import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { localEnvironments } from "@/lib/api/localEnvironments";
import { selectLocalEnvironment } from "@/lib/api/localEnvironmentSelection";
import {
  createLocalEnvironmentDraft,
  serializeLocalEnvironment,
  validateLocalEnvironmentDraft,
  type LocalEnvironmentDraft,
} from "@/lib/localEnvironments";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";
import { SettingsUnsavedChangesDialog } from "../../_layout/SettingsUnsavedChangesDialog";
import {
  SettingsAction,
  SettingsPageBody,
  SettingsPageHeader,
} from "../../SettingsPrimitives";
import { ActionsEditor } from "./ActionsEditor";
import { LifecycleEditor, environmentInputClass } from "./LifecycleEditor";

export function LocalEnvironmentEditor({
  configPath,
  defaultName,
  workspaceRoot,
  onBack,
  onSaved,
}: {
  configPath: string;
  defaultName: string;
  workspaceRoot: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("settings");
  const id = useId();
  const [draft, setDraft] = useState<LocalEnvironmentDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [canonicalPath, setCanonicalPath] = useState(configPath);
  const [revision, setRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<
    "load" | "invalid" | "save" | "conflict" | null
  >(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reloadRequested, setReloadRequested] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const alive = useRef(false);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;
  const validation = draft ? validateLocalEnvironmentDraft(draft) : null;
  useSettingsDraft({ dirty, saving });
  useEffect(() => {
    let current = true;
    alive.current = true;
    setLoading(true);
    setError(null);
    setDraft(null);
    void localEnvironments
      .readConfig(configPath)
      .then((result) => {
        if (!current) return;
        if (result.environment?.type === "error") {
          setError("invalid");
        }
        const next = createLocalEnvironmentDraft(
          result.environment?.type === "success"
            ? result.environment.environment
            : null,
          defaultName,
        );
        setDraft(next);
        setBaseline(
          result.exists && result.environment?.type !== "error"
            ? JSON.stringify(next)
            : "",
        );
        setCanonicalPath(result.configPath);
        setRevision(result.revision ?? null);
      })
      .catch(() => {
        if (current) setError("load");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      alive.current = false;
    };
  }, [configPath, defaultName, reload]);

  const save = async () => {
    if (
      !draft ||
      pending.current ||
      !dirty ||
      validation?.missingName ||
      validation?.incompleteActionIds.length
    )
      return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const raw = serializeLocalEnvironment(draft);
      const result = await localEnvironments.saveConfig({
        configPath: canonicalPath,
        expectedRevision: revision,
        raw,
      });
      if (!alive.current) return;
      if (result.type === "conflict") {
        setError("conflict");
        return;
      }
      setRevision(result.revision ?? null);
      setBaseline(JSON.stringify(draft));
      if (revision === null) {
        let selected = false;
        try {
          selected = await selectLocalEnvironment(
            workspaceRoot,
            result.configPath,
          );
        } catch {
          /* The file is saved even if selecting it fails. */
        }
        if (!alive.current) return;
        if (!selected)
          toast.error(t("settings.localEnvironments.error.selection"));
      }
      onSaved();
    } catch {
      if (alive.current) setError("save");
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const requestExit = (refresh: boolean) => {
    if (pending.current) return;
    if (dirty) {
      setReloadRequested(refresh);
      setDiscardOpen(true);
    } else if (refresh) setReload((value) => value + 1);
    else onBack();
  };
  return (
    <SettingsPageBody
      data-testid="local-environment-editor"
      aria-busy={loading || saving}
    >
      <SettingsPageHeader
        title={t("settings.localEnvironments.edit")}
        actions={
          <div className="flex gap-2">
            <SettingsAction
              disabled={saving}
              onClick={() => requestExit(false)}
            >
              {t("settings.localEnvironments.back")}
            </SettingsAction>
            <SettingsAction
              disabled={
                !draft ||
                loading ||
                saving ||
                !dirty ||
                Boolean(
                  validation?.missingName ||
                  validation?.incompleteActionIds.length,
                )
              }
              onClick={() => void save()}
            >
              {t(
                saving
                  ? "settings.localEnvironments.saving"
                  : "settings.localEnvironments.save",
              )}
            </SettingsAction>
          </div>
        }
      />
      {loading ? (
        <p role="status">{t("settings.localEnvironments.loading")}</p>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-2 text-[13px] text-destructive">
          <p>{t(`settings.localEnvironments.error.${error}`)}</p>
          <SettingsAction disabled={saving} onClick={() => requestExit(true)}>
            {t("settings.localEnvironments.reload")}
          </SettingsAction>
        </div>
      ) : null}
      {draft && !loading ? (
        <>
          <div className="space-y-2">
            <label
              htmlFor={`${id}-name`}
              className="block text-[13px] font-medium"
            >
              {t("settings.localEnvironments.name")}
            </label>
            <input
              id={`${id}-name`}
              className={environmentInputClass}
              value={draft.name}
              disabled={saving}
              aria-invalid={validation?.missingName}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </div>
          <LifecycleEditor
            type="setup"
            draft={draft}
            disabled={saving}
            onChange={setDraft}
          />
          <LifecycleEditor
            type="cleanup"
            draft={draft}
            disabled={saving}
            onChange={setDraft}
          />
          <ActionsEditor
            actions={draft.actions}
            disabled={saving}
            incomplete={validation?.incompleteActionIds ?? []}
            onChange={(actions) => setDraft({ ...draft, actions })}
          />
        </>
      ) : null}
      <SettingsUnsavedChangesDialog
        pendingNavigation={discardOpen}
        saving={saving}
        onClearPendingNavigation={() => setDiscardOpen(false)}
        onDiscardChanges={() => {
          setDiscardOpen(false);
          if (reloadRequested) setReload((value) => value + 1);
          else onBack();
        }}
      />
    </SettingsPageBody>
  );
}
