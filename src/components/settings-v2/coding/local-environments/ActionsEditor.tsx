import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  createEnvironmentAction,
  environmentPlatforms,
  type EnvironmentActionDraft,
} from "@/lib/localEnvironments";
import {
  SettingsAction,
  SettingsSection,
  SettingsValueMenu,
} from "../../SettingsPrimitives";
import { environmentInputClass } from "./LifecycleEditor";

export function ActionsEditor({
  actions,
  disabled,
  incomplete,
  onChange,
}: {
  actions: EnvironmentActionDraft[];
  disabled: boolean;
  incomplete: string[];
  onChange: (actions: EnvironmentActionDraft[]) => void;
}) {
  const { t } = useTranslation("settings");
  const id = useId();
  const update = (id: string, patch: Partial<EnvironmentActionDraft>) =>
    onChange(
      actions.map((action) =>
        action.id === id ? { ...action, ...patch } : action,
      ),
    );
  return (
    <SettingsSection
      title={t("settings.localEnvironments.actions")}
      actions={
        <SettingsAction
          type="button"
          disabled={disabled}
          onClick={() => onChange([...actions, createEnvironmentAction()])}
        >
          <Plus />
          {t("settings.localEnvironments.addAction")}
        </SettingsAction>
      }
    >
      <p className="mb-3 text-[12px] text-muted-foreground">
        {t("settings.localEnvironments.actionsDescription")}
      </p>
      <div className="space-y-5">
        {actions.map((action, index) => {
          const label = t("settings.localEnvironments.actionNumber", {
            number: index + 1,
          });
          return (
            <fieldset
              key={action.id}
              disabled={disabled}
              className="min-w-0 space-y-2 border-t border-border pt-3"
            >
              <legend className="sr-only">{label}</legend>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${environmentInputClass} flex-1 basis-32`}
                  aria-label={`${label} · ${t("settings.localEnvironments.actionName")}`}
                  placeholder={t("settings.localEnvironments.actionName")}
                  aria-invalid={incomplete.includes(action.id)}
                  value={action.name}
                  onChange={(event) =>
                    update(action.id, { name: event.target.value })
                  }
                />
                <span
                  id={`${id}-${action.id}-icon-label`}
                  className="sr-only"
                >{`${label} · ${t("settings.localEnvironments.actionIcon")}`}</span>
                <SettingsValueMenu
                  targetId={`${id}-${action.id}-icon`}
                  disabled={disabled}
                  value={action.icon ?? "tool"}
                  options={(["tool", "run", "debug", "test"] as const).map(
                    (value) => ({
                      value,
                      label: t(`settings.localEnvironments.icon.${value}`),
                    }),
                  )}
                  onChange={(icon) => update(action.id, { icon })}
                />
                <span
                  id={`${id}-${action.id}-platform-label`}
                  className="sr-only"
                >{`${label} · ${t("settings.localEnvironments.actionPlatform")}`}</span>
                <SettingsValueMenu
                  targetId={`${id}-${action.id}-platform`}
                  disabled={disabled}
                  value={action.platform ?? "all"}
                  options={["all" as const, ...environmentPlatforms].map(
                    (value) => ({
                      value,
                      label: t(`settings.localEnvironments.platform.${value}`),
                    }),
                  )}
                  onChange={(platform) =>
                    update(action.id, {
                      platform: platform === "all" ? null : platform,
                    })
                  }
                />
                <SettingsAction
                  type="button"
                  aria-label={t("settings.localEnvironments.removeAction", {
                    number: index + 1,
                  })}
                  onClick={() =>
                    onChange(actions.filter((entry) => entry.id !== action.id))
                  }
                >
                  <Trash2 />
                </SettingsAction>
              </div>
              <textarea
                aria-label={`${label} · ${t("settings.localEnvironments.command")}`}
                className={`${environmentInputClass} min-h-20 resize-y font-mono`}
                spellCheck={false}
                placeholder={t("settings.localEnvironments.command")}
                value={action.command}
                aria-invalid={incomplete.includes(action.id)}
                onChange={(event) =>
                  update(action.id, { command: event.target.value })
                }
              />
              {incomplete.includes(action.id) ? (
                <p role="alert" className="text-[12px] text-destructive">
                  {t("settings.localEnvironments.incompleteAction")}
                </p>
              ) : null}
            </fieldset>
          );
        })}
        {!actions.length ? (
          <p className="text-muted-foreground">
            {t("settings.localEnvironments.noActions")}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
