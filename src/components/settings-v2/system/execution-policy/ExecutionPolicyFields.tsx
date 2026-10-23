import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsRow, SettingsSwitch } from "../../SettingsPrimitives";
import { cn } from "@/lib/utils";
import type {
  ToolExecutionCommandRiskLevelConfig,
  ToolExecutionCommandRuleConfig,
  ToolExecutionNetworkRuleConfig,
} from "@/lib/api/appConfig";
import type { RuleKind } from "./executionPolicyConfig";
import {
  FIELD_CLASS_NAME,
  SELECT_CLASS_NAME,
  SECONDARY_BUTTON_CLASS_NAME,
  DANGER_BUTTON_CLASS_NAME,
} from "./executionPolicyPresentation";
type MatchType = NonNullable<ToolExecutionCommandRuleConfig["match_type"]>;
type NetworkTarget = NonNullable<ToolExecutionNetworkRuleConfig["target"]>;

export function InlineMessage({
  type,
  text,
}: {
  type: "success" | "error";
  text: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[18px] border px-4 py-3 text-sm shadow-sm ",
        type === "success"
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-destructive/20 bg-destructive/10 text-foreground",
      )}
    >
      <AlertCircle className="h-4 w-4" />
      <span>{text}</span>
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  disabled,
  ariaLabel,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingsRow label={title} description={description}>
      <SettingsSwitch
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </SettingsRow>
  );
}

export function RuleEditor({
  kind,
  rules,
  disabled,
  focusedIndex,
  onAdd,
  onRemove,
  onUpdate,
}: {
  kind: RuleKind;
  rules: Array<ToolExecutionCommandRuleConfig | ToolExecutionNetworkRuleConfig>;
  disabled?: boolean;
  focusedIndex?: number | null;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (
    index: number,
    nextRule: ToolExecutionCommandRuleConfig | ToolExecutionNetworkRuleConfig,
  ) => void;
}) {
  const { t } = useTranslation("settings");
  const isNetwork = kind === "network";

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-border bg-muted/40 px-4 py-5 text-sm leading-6 text-muted-foreground">
          {t(`settings.executionPolicy.rules.${kind}.empty`)}
        </div>
      ) : (
        rules.map((rule, index) => (
          <div
            key={`${kind}-${index}`}
            data-testid={`${kind}-rule-${index}`}
            data-focused={focusedIndex === index ? "true" : undefined}
            className={cn(
              "grid gap-3 rounded-[22px] border bg-muted/40 p-4 transition xl:grid-cols-[1.1fr_0.8fr_0.8fr_1.1fr_auto]",
              focusedIndex === index
                ? "border-[color:var(--lime-warning-border)] bg-[color:var(--lime-warning-soft)] ring-2 ring-[color:var(--lime-warning-border)]"
                : "border-border",
            )}
          >
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.executionPolicy.rules.field.ruleId")}
              </span>
              <input
                className={FIELD_CLASS_NAME}
                value={rule.rule_id}
                disabled={disabled}
                placeholder={t(
                  "settings.executionPolicy.rules.field.ruleIdPlaceholder",
                )}
                onChange={(event) =>
                  onUpdate(index, {
                    ...rule,
                    rule_id: event.target.value,
                  })
                }
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.executionPolicy.rules.field.matchType")}
              </span>
              <select
                className={SELECT_CLASS_NAME}
                value={rule.match_type ?? "regex"}
                disabled={disabled}
                onChange={(event) =>
                  onUpdate(index, {
                    ...rule,
                    match_type: event.target.value as MatchType,
                  })
                }
              >
                <option value="regex">
                  {t("settings.executionPolicy.matchType.regex")}
                </option>
                <option value="prefix">
                  {t("settings.executionPolicy.matchType.prefix")}
                </option>
                <option value="exact">
                  {t("settings.executionPolicy.matchType.exact")}
                </option>
              </select>
            </label>
            {isNetwork ? (
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("settings.executionPolicy.rules.field.target")}
                </span>
                <select
                  className={SELECT_CLASS_NAME}
                  value={
                    (rule as ToolExecutionNetworkRuleConfig).target ?? "url"
                  }
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdate(index, {
                      ...rule,
                      target: event.target.value as NetworkTarget,
                    } as ToolExecutionNetworkRuleConfig)
                  }
                >
                  <option value="url">
                    {t("settings.executionPolicy.networkTarget.url")}
                  </option>
                  <option value="host">
                    {t("settings.executionPolicy.networkTarget.host")}
                  </option>
                </select>
              </label>
            ) : (
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("settings.executionPolicy.rules.field.risk")}
                </span>
                <select
                  className={SELECT_CLASS_NAME}
                  value={rule.risk_level ?? "medium"}
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdate(index, {
                      ...rule,
                      risk_level: event.target
                        .value as ToolExecutionCommandRiskLevelConfig,
                    })
                  }
                >
                  <option value="low">
                    {t("settings.executionPolicy.risk.low")}
                  </option>
                  <option value="medium">
                    {t("settings.executionPolicy.risk.medium")}
                  </option>
                  <option value="high">
                    {t("settings.executionPolicy.risk.high")}
                  </option>
                </select>
              </label>
            )}
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.executionPolicy.rules.field.pattern")}
              </span>
              <input
                className={FIELD_CLASS_NAME}
                value={rule.pattern}
                disabled={disabled}
                placeholder={t(
                  `settings.executionPolicy.rules.${kind}.patternPlaceholder`,
                )}
                onChange={(event) =>
                  onUpdate(index, {
                    ...rule,
                    pattern: event.target.value,
                  })
                }
              />
            </label>
            <button
              type="button"
              className={cn(DANGER_BUTTON_CLASS_NAME, "self-end")}
              disabled={disabled}
              onClick={() => onRemove(index)}
            >
              <Trash2 className="h-4 w-4" />
              {t("settings.executionPolicy.rules.action.remove")}
            </button>
            <label className="space-y-1.5 xl:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.executionPolicy.rules.field.reasonCode")}
              </span>
              <input
                className={FIELD_CLASS_NAME}
                value={rule.reason_code ?? ""}
                disabled={disabled}
                placeholder={t(
                  "settings.executionPolicy.rules.field.reasonCodePlaceholder",
                )}
                onChange={(event) =>
                  onUpdate(index, {
                    ...rule,
                    reason_code: event.target.value,
                  })
                }
              />
            </label>
            <label className="space-y-1.5 xl:col-span-3">
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.executionPolicy.rules.field.reason")}
              </span>
              <input
                className={FIELD_CLASS_NAME}
                value={rule.reason ?? ""}
                disabled={disabled}
                placeholder={t(
                  "settings.executionPolicy.rules.field.reasonPlaceholder",
                )}
                onChange={(event) =>
                  onUpdate(index, {
                    ...rule,
                    reason: event.target.value,
                  })
                }
              />
            </label>
            {isNetwork ? (
              <label className="space-y-1.5 xl:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("settings.executionPolicy.rules.field.risk")}
                </span>
                <select
                  className={SELECT_CLASS_NAME}
                  value={rule.risk_level ?? "medium"}
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdate(index, {
                      ...rule,
                      risk_level: event.target
                        .value as ToolExecutionCommandRiskLevelConfig,
                    })
                  }
                >
                  <option value="low">
                    {t("settings.executionPolicy.risk.low")}
                  </option>
                  <option value="medium">
                    {t("settings.executionPolicy.risk.medium")}
                  </option>
                  <option value="high">
                    {t("settings.executionPolicy.risk.high")}
                  </option>
                </select>
              </label>
            ) : null}
          </div>
        ))
      )}
      <button
        type="button"
        className={SECONDARY_BUTTON_CLASS_NAME}
        disabled={disabled}
        onClick={onAdd}
      >
        <Plus className="h-4 w-4" />
        {t(`settings.executionPolicy.rules.${kind}.add`)}
      </button>
    </div>
  );
}
