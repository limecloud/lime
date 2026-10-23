import { useEffect, useMemo, useRef } from "react";
import {
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import type {
  ToolExecutionCommandRuleConfig,
  ToolExecutionNetworkRuleConfig,
} from "@/lib/api/appConfig";
import type { ExecutionPolicyFocusContext } from "@/types/page";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";
import {
  createShellRule,
  createNetworkRule,
  normalizeShellRule,
  normalizeNetworkRule,
  type RuleKind,
  type WarningPolicy,
} from "./executionPolicyConfig";
import { useExecutionPolicyDraft } from "./useExecutionPolicyDraft";
import {
  buildPolicySourceLayers,
  SELECT_CLASS_NAME,
} from "./executionPolicyPresentation";
import { InlineMessage, ToggleRow, RuleEditor } from "./ExecutionPolicyFields";
import { PolicySourceLayerPanel } from "./PolicySourceLayerPanel";
import { resolveExecutionPolicyNetworkRuleFocus } from "./executionPolicyFocus";
import { ExecutionPolicyNetworkFocusPanel } from "./ExecutionPolicyNetworkFocusPanel";
import { SettingsAction, SettingsPageHeader } from "../../SettingsPrimitives";
import { WindowsSandboxReadinessStatus } from "./WindowsSandboxReadinessStatus";

export function ExecutionPolicySettings({
  focus,
}: { focus?: ExecutionPolicyFocusContext | null } = {}) {
  const { t } = useTranslation("settings");
  const {
    draft,
    change,
    dirty,
    saving,
    loading,
    ready,
    message,
    save,
    reload,
    toolOverrideCount,
  } = useExecutionPolicyDraft();
  useSettingsDraft({ dirty, saving });
  const focusedNetworkRuleRef = useRef<HTMLDivElement | null>(null);
  const workspaceSandbox = draft;
  const { updatePlanEnabled, bashWarningPolicy, shellRules, networkRules } =
    draft;
  const networkRuleFocus = useMemo(
    () => resolveExecutionPolicyNetworkRuleFocus(networkRules, focus),
    [networkRules, focus],
  );
  const hasCustomPolicy =
    draft.enabled ||
    draft.strict ||
    updatePlanEnabled ||
    bashWarningPolicy !== "shell_command_risk" ||
    shellRules.length > 0 ||
    networkRules.length > 0 ||
    toolOverrideCount > 0;
  const policySourceLayers = buildPolicySourceLayers({
    hasCustomPolicy,
    shellRuleCount: shellRules.length,
    networkRuleCount: networkRules.length,
    toolOverrideCount,
    t,
  });
  useEffect(() => {
    if (networkRuleFocus)
      focusedNetworkRuleRef.current?.scrollIntoView?.({
        block: "center",
        behavior: "smooth",
      });
  }, [networkRuleFocus]);
  const addRule = (kind: RuleKind) => {
    if (kind === "shell")
      change("shellRules", (current) => [...current, createShellRule()]);
    else change("networkRules", (current) => [...current, createNetworkRule()]);
  };
  const addNetworkRule = (rule: ToolExecutionNetworkRuleConfig) =>
    change("networkRules", (current) => [
      ...current,
      normalizeNetworkRule(rule),
    ]);
  const removeRule = (kind: RuleKind, index: number) => {
    if (kind === "shell")
      change("shellRules", (current) => current.filter((_, i) => i !== index));
    else
      change("networkRules", (current) =>
        current.filter((_, i) => i !== index),
      );
  };
  const updateRule = (
    kind: RuleKind,
    index: number,
    rule: ToolExecutionCommandRuleConfig | ToolExecutionNetworkRuleConfig,
  ) => {
    if (kind === "shell")
      change("shellRules", (current) =>
        current.map((value, i) =>
          i === index ? normalizeShellRule(rule) : value,
        ),
      );
    else
      change("networkRules", (current) =>
        current.map((value, i) =>
          i === index ? normalizeNetworkRule(rule) : value,
        ),
      );
  };

  if (loading) {
    return (
      <div className="space-y-6 pb-8" data-testid="execution-policy-settings">
        <div className="h-[132px] animate-pulse rounded-2xl border border-border bg-background" />
        <div className="flex flex-col gap-10">
          <div className="space-y-6">
            <div className="h-[220px] animate-pulse rounded-2xl border border-border bg-background" />
            <div className="h-[260px] animate-pulse rounded-2xl border border-border bg-background" />
          </div>
          <div className="h-[260px] animate-pulse rounded-2xl border border-border bg-background" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8" data-testid="execution-policy-settings">
      <SettingsPageHeader
        title={t("settings.executionPolicy.title")}
        actions={
          <div className="flex gap-2">
            <SettingsAction
              type="button"
              disabled={saving || dirty}
              onClick={reload}
            >
              <RefreshCw />
              {t("settings.executionPolicy.action.reload")}
            </SettingsAction>
            <SettingsAction
              type="button"
              data-testid="execution-policy-save"
              disabled={saving || !ready || !dirty}
              onClick={() => void save()}
            >
              <Save />
              {t(
                saving
                  ? "settings.executionPolicy.action.saving"
                  : "settings.executionPolicy.action.save",
              )}
            </SettingsAction>
          </div>
        }
      />

      {message ? (
        <InlineMessage type={message.type} text={message.text} />
      ) : null}

      <div className="flex flex-col gap-10">
        <div className="space-y-6">
          <section
            className="rounded-2xl border border-border bg-background p-5 "
            data-settings-search-target="execution-policy-workspace"
            tabIndex={-1}
            aria-label={t("settings.executionPolicy.workspace.title")}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {t("settings.executionPolicy.workspace.title")}
              <WorkbenchInfoTip
                ariaLabel={t("settings.executionPolicy.workspace.tipAria")}
                content={t("settings.executionPolicy.workspace.description")}
                tone="slate"
              />
            </div>
            <div className="mt-5 space-y-3">
              <ToggleRow
                title={t("settings.executionPolicy.workspace.enabled.title")}
                description={t(
                  "settings.executionPolicy.workspace.enabled.description",
                )}
                ariaLabel={t("settings.executionPolicy.workspace.enabled.aria")}
                checked={workspaceSandbox.enabled}
                disabled={!ready}
                onCheckedChange={(checked) => change("enabled", checked)}
              />
              <ToggleRow
                title={t("settings.executionPolicy.workspace.strict.title")}
                description={t(
                  "settings.executionPolicy.workspace.strict.description",
                )}
                ariaLabel={t("settings.executionPolicy.workspace.strict.aria")}
                checked={workspaceSandbox.strict}
                disabled={!ready || !workspaceSandbox.enabled}
                onCheckedChange={(checked) => change("strict", checked)}
              />
              <ToggleRow
                title={t("settings.executionPolicy.workspace.notify.title")}
                description={t(
                  "settings.executionPolicy.workspace.notify.description",
                )}
                ariaLabel={t("settings.executionPolicy.workspace.notify.aria")}
                checked={workspaceSandbox.notify_on_fallback}
                disabled={!ready || !workspaceSandbox.enabled}
                onCheckedChange={(checked) =>
                  change("notify_on_fallback", checked)
                }
              />
              <WindowsSandboxReadinessStatus />
            </div>
          </section>

          <section
            className="rounded-2xl border border-border bg-background p-5 "
            data-settings-search-target="execution-policy-plan"
            tabIndex={-1}
            aria-label={t("settings.executionPolicy.plan.title")}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Workflow className="h-4 w-4 text-primary" />
              {t("settings.executionPolicy.plan.title")}
              <WorkbenchInfoTip
                ariaLabel={t("settings.executionPolicy.plan.tipAria")}
                content={t("settings.executionPolicy.plan.description")}
                tone="slate"
              />
            </div>
            <div className="mt-5">
              <ToggleRow
                title={t("settings.executionPolicy.plan.enabled.title")}
                description={t(
                  "settings.executionPolicy.plan.enabled.description",
                )}
                ariaLabel={t("settings.executionPolicy.plan.enabled.aria")}
                checked={updatePlanEnabled}
                disabled={!ready}
                onCheckedChange={(checked) =>
                  change("updatePlanEnabled", checked)
                }
              />
            </div>
          </section>

          <section
            className="rounded-2xl border border-border bg-background p-5 "
            data-settings-search-target="execution-policy-shell"
            tabIndex={-1}
            aria-label={t("settings.executionPolicy.shell.title")}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TerminalSquare className="h-4 w-4 text-primary" />
                  {t("settings.executionPolicy.shell.title")}
                  <WorkbenchInfoTip
                    ariaLabel={t("settings.executionPolicy.shell.tipAria")}
                    content={t("settings.executionPolicy.shell.description")}
                    tone="slate"
                  />
                </div>
              </div>
              <label className="min-w-[240px] space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("settings.executionPolicy.shell.warningPolicy")}
                </span>
                <select
                  data-testid="execution-policy-warning"
                  className={SELECT_CLASS_NAME}
                  value={bashWarningPolicy}
                  disabled={!ready}
                  onChange={(event) =>
                    change(
                      "bashWarningPolicy",
                      event.target.value as WarningPolicy,
                    )
                  }
                >
                  <option value="shell_command_risk">
                    {t(
                      "settings.executionPolicy.shell.warningPolicy.shellCommandRisk",
                    )}
                  </option>
                  <option value="none">
                    {t("settings.executionPolicy.shell.warningPolicy.none")}
                  </option>
                </select>
              </label>
            </div>
            <div className="mt-5">
              <RuleEditor
                kind="shell"
                rules={shellRules}
                disabled={!ready}
                onAdd={() => addRule("shell")}
                onRemove={(index) => removeRule("shell", index)}
                onUpdate={(index, rule) => updateRule("shell", index, rule)}
              />
            </div>
          </section>

          <section
            className="rounded-2xl border border-border bg-background p-5 "
            data-settings-search-target="execution-policy-network"
            tabIndex={-1}
            aria-label={t("settings.executionPolicy.network.title")}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              {t("settings.executionPolicy.network.title")}
              <WorkbenchInfoTip
                ariaLabel={t("settings.executionPolicy.network.tipAria")}
                content={t("settings.executionPolicy.network.description")}
                tone="slate"
              />
            </div>
            <div className="mt-5">
              <ExecutionPolicyNetworkFocusPanel
                disabled={!ready}
                focus={focus}
                focusedNetworkRuleRef={focusedNetworkRuleRef}
                networkRuleFocus={networkRuleFocus}
                onAddSuggestedRule={addNetworkRule}
              />
              <RuleEditor
                kind="network"
                rules={networkRules}
                disabled={!ready}
                focusedIndex={networkRuleFocus?.index ?? null}
                onAdd={() => addRule("network")}
                onRemove={(index) => removeRule("network", index)}
                onUpdate={(index, rule) => updateRule("network", index, rule)}
              />
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <PolicySourceLayerPanel layers={policySourceLayers} />
          <section className="rounded-2xl border border-border bg-background p-5 ">
            <div className="text-sm font-semibold text-foreground">
              {t("settings.executionPolicy.summary.title")}
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("settings.executionPolicy.summary.workspaceSandbox")}
                </dt>
                <dd className="font-medium text-foreground">
                  {workspaceSandbox.enabled
                    ? t("settings.executionPolicy.summary.enabled")
                    : t("settings.executionPolicy.summary.disabled")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("settings.executionPolicy.summary.plan")}
                </dt>
                <dd className="font-medium text-foreground">
                  {updatePlanEnabled
                    ? t("settings.executionPolicy.summary.enabled")
                    : t("settings.executionPolicy.summary.disabled")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("settings.executionPolicy.summary.strict")}
                </dt>
                <dd className="font-medium text-foreground">
                  {workspaceSandbox.strict
                    ? t("settings.executionPolicy.summary.enabled")
                    : t("settings.executionPolicy.summary.disabled")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("settings.executionPolicy.summary.shellRules")}
                </dt>
                <dd className="font-medium text-foreground">
                  {shellRules.length}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("settings.executionPolicy.summary.networkRules")}
                </dt>
                <dd className="font-medium text-foreground">
                  {networkRules.length}
                </dd>
              </div>
            </dl>
          </section>
          <section className="rounded-2xl border border-[color:var(--lime-warning-border)] bg-[color:var(--lime-warning-soft)] p-5 text-sm leading-6 text-[color:var(--lime-warning)]">
            {t("settings.executionPolicy.recoveryNote")}
          </section>
        </aside>
      </div>
    </div>
  );
}
