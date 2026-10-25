import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  validateLocalEnvironmentDraft,
  type LocalEnvironmentDraft,
} from "@/lib/localEnvironments";
import { ActionsEditor } from "./ActionsEditor";
import { LifecycleEditor, environmentInputClass } from "./LifecycleEditor";

export function LocalEnvironmentFields({
  draft,
  disabled,
  onChange,
}: {
  draft: LocalEnvironmentDraft;
  disabled: boolean;
  onChange: (draft: LocalEnvironmentDraft) => void;
}) {
  const { t } = useTranslation("settings");
  const id = useId();
  const validation = validateLocalEnvironmentDraft(draft);
  return (
    <>
      <div className="space-y-2">
        <label htmlFor={`${id}-name`} className="block text-[13px] font-medium">
          {t("settings.localEnvironments.name")}
        </label>
        <input
          id={`${id}-name`}
          className={environmentInputClass}
          value={draft.name}
          disabled={disabled}
          aria-invalid={validation.missingName}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>
      <LifecycleEditor
        type="setup"
        draft={draft}
        disabled={disabled}
        onChange={onChange}
      />
      <LifecycleEditor
        type="cleanup"
        draft={draft}
        disabled={disabled}
        onChange={onChange}
      />
      <ActionsEditor
        actions={draft.actions}
        disabled={disabled}
        incomplete={validation.incompleteActionIds}
        onChange={(actions) => onChange({ ...draft, actions })}
      />
    </>
  );
}
