import { Fragment, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openIn } from "@/lib/api/openIn";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import { configLayerFile, type Config } from "@/lib/api/appConfig";
import {
  configLayerScope,
  isConfigFieldManaged,
  isManagedSource,
} from "@/lib/api/configLayers";
import {
  SettingsAction,
  SettingsGroup,
  SettingsLoading,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  SettingsValueMenu,
} from "../../SettingsPrimitives";
import { useConfiguration, type ConfigurationField } from "./useConfiguration";
import { ModelFeaturesSection } from "./ModelFeaturesSection";
import { WorkspaceDependenciesSection } from "./WorkspaceDependenciesSection";

const FIELDS = [
  "approval_policy",
  "sandbox_mode",
  "web_search",
  "model_verbosity",
  "model_reasoning_summary",
] as const;
const OPTIONS = {
  approval_policy: ["on-request", "never"],
  sandbox_mode: ["read-only", "workspace-write", "danger-full-access"],
  web_search: ["disabled", "cached", "indexed", "live"],
  model_verbosity: ["model-default", "low", "medium", "high"],
  model_reasoning_summary: ["auto", "concise", "detailed", "none"],
} as const;
const FALLBACKS = {
  approval_policy: "on-request",
  sandbox_mode: "read-only",
  web_search: "cached",
  model_verbosity: "model-default",
  model_reasoning_summary: "auto",
} as const;

export function ConfigurationPanel() {
  const { t } = useTranslation("settings");
  const state = useConfiguration();
  const [openError, setOpenError] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  if (state.loading) return <SettingsLoading />;
  const snapshot = state.snapshot;
  const selected = state.selectedLayer;
  const explicit = selected?.config as Partial<Config> | undefined;
  const managed = selected ? isManagedSource(selected.name) : false;
  const managedField = (field: ConfigurationField) =>
    Boolean(snapshot && isConfigFieldManaged(snapshot.origins, field));
  const config = snapshot
    ? {
        ...snapshot.config,
        ...explicit,
        ...(managedField("sandbox_mode")
          ? { sandbox_mode: snapshot.config.sandbox_mode }
          : {}),
        ...(isConfigFieldManaged(snapshot.origins, "default_permissions")
          ? { default_permissions: snapshot.config.default_permissions }
          : {}),
        sandbox_workspace_write: {
          ...snapshot.config.sandbox_workspace_write,
          ...explicit?.sandbox_workspace_write,
          ...(managedField("sandbox_workspace_write.network_access")
            ? {
                network_access:
                  snapshot.config.sandbox_workspace_write?.network_access,
              }
            : {}),
        },
      }
    : undefined;
  const file = state.selectedFile;
  const fileName = file?.replaceAll("\\", "/").split("/").at(-1);
  const layerLock = selected?.disabledReason;
  const ready = Boolean(snapshot) && !state.readError;

  function lockReason(field: ConfigurationField) {
    if (managedField(field)) return t("settings.configuration.managedByAdmin");
    if (field === "desktop.enabled-reasoning-efforts")
      return snapshot?.layer.disabledReason
        ? t("settings.configuration.readonly")
        : null;
    if (managed || !file || layerLock)
      return t("settings.configuration.readonly");
    if (
      config?.default_permissions &&
      (field === "sandbox_mode" ||
        field === "sandbox_workspace_write.network_access")
    )
      return t("settings.configuration.permissionProfile", {
        profile: config.default_permissions,
      });
    return null;
  }
  const allowedValues = (field: ConfigurationField) =>
    field === "approval_policy"
      ? state.requirements?.allowedApprovalPolicies
      : field === "sandbox_mode"
        ? state.requirements?.allowedSandboxModes
        : field === "web_search"
          ? state.requirements?.allowedWebSearchModes
          : null;
  const disabled = (field: ConfigurationField) =>
    !ready || state.pending.includes(field) || Boolean(lockReason(field));
  const target = (field: ConfigurationField) =>
    `configuration-${field.replaceAll(".", "-")}`;
  const saveError = (field: ConfigurationField) =>
    state.errors[field] ? (
      <div
        role="alert"
        className="mt-1 flex flex-wrap items-center gap-2 text-destructive"
      >
        {t("settings.configuration.saveError")}
        <button
          type="button"
          className="underline underline-offset-2"
          disabled={disabled(field)}
          onClick={() => state.retry(field)}
        >
          {t("settings.browser.retry")}
        </button>
      </div>
    ) : null;
  const description = (field: ConfigurationField) => (
    <>
      <span>
        {t(
          `settings.configuration.fields.${field === "sandbox_workspace_write.network_access" ? "network" : field}.description`,
        )}
      </span>
      {lockReason(field) ? <div>{lockReason(field)}</div> : null}
      {allowedValues(field) ? (
        <div>{t("settings.configuration.adminRestricted")}</div>
      ) : null}
      {saveError(field)}
    </>
  );
  async function open(kind: "config" | "docs") {
    if (openingRef.current || (kind === "config" && !file)) return;
    openingRef.current = true;
    setOpening(true);
    setOpenError(false);
    try {
      if (kind === "config") {
        const cwd =
          selected?.name.type === "project"
            ? selected.name.dotCodexFolder.replace(/[\\/]\.lime$/, "")
            : state.cwd;
        const targets = await openIn.getTargets({
          path: file!,
          deferEnrichment: true,
          ...(cwd ? { cwd } : {}),
        });
        const preferred = targets.targets.find(
          (item) => item.available && item.id === targets.preferredTarget,
        );
        await openIn.open({
          path: file!,
          openMode: "file",
          target: preferred?.target ?? "systemDefault",
          appPath: preferred?.appPath,
          ...(cwd ? { cwd } : {}),
        });
      } else
        await openExternalUrlWithSystemBrowser(
          "https://github.com/limecloud/lime/blob/main/docs/ops.md",
        );
    } catch {
      setOpenError(true);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  return (
    <SettingsPageBody data-testid="configuration-settings">
      <div className="space-y-3">
        <SettingsPageHeader title={t("settings.configuration.title")} />
        <p className="text-[13px] leading-5 text-muted-foreground">
          {t("settings.configuration.description")}{" "}
          <button
            type="button"
            disabled={opening}
            className="underline underline-offset-2"
            onClick={() => void open("docs")}
          >
            {t("settings.configuration.learnMore")}
          </button>
        </p>
      </div>
      {state.readError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 text-[13px] text-destructive"
        >
          {t("settings.configuration.loadError")}
          <SettingsAction
            type="button"
            disabled={state.pending.length > 0}
            onClick={() => void state.load()}
          >
            {t("settings.browser.retry")}
          </SettingsAction>
        </div>
      ) : null}
      <SettingsSection title={t("settings.configuration.agentDefaults")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div id="configuration-scope-label" className="sr-only">
            {t("settings.configuration.scope")}
          </div>
          <div title={file ?? undefined}>
            <SettingsValueMenu
              targetId="configuration-scope"
              align="start"
              value={state.selectedScope}
              options={[
                ...[...state.layers]
                  .reverse()
                  .filter((layer) => layer.name.type === "project"),
                ...state.layers.filter((layer) => layer.name.type === "user"),
                ...state.layers.filter((layer) => isManagedSource(layer.name)),
              ].map((layer) => {
                const path = configLayerFile(layer);
                return {
                  value: configLayerScope(layer),
                  label:
                    layer.name.type === "project"
                      ? (layer.name.dotCodexFolder
                          .replaceAll("\\", "/")
                          .split("/")
                          .at(-2) ??
                        path ??
                        "")
                      : isManagedSource(layer.name)
                        ? t("settings.configuration.adminScope")
                        : t("settings.configuration.userScope"),
                  tooltip: path ?? undefined,
                  ...(layer.name.type === "project"
                    ? { groupLabel: t("settings.configuration.projectGroup") }
                    : {}),
                };
              })}
              disabled={!snapshot}
              onChange={state.selectScope}
            />
          </div>
          {file ? (
            <SettingsAction
              type="button"
              disabled={!file || opening}
              onClick={() => void open("config")}
            >
              {t("settings.configuration.openConfig", { file: fileName ?? "" })}
              <ExternalLink aria-hidden="true" />
            </SettingsAction>
          ) : null}
        </div>
        {openError ? (
          <p role="alert" className="mb-3 text-[12px] text-destructive">
            {t("settings.configuration.openError")}
          </p>
        ) : null}
        {layerLock ? (
          <p role="status" className="mb-3 text-[12px] text-muted-foreground">
            {t("settings.configuration.projectDisabled")}
          </p>
        ) : null}
        <SettingsGroup>
          {FIELDS.map((field) => {
            const localValue =
              (managedField(field)
                ? snapshot?.config[field]
                : config?.[field]) ??
              (field === "web_search" &&
              config?.sandbox_mode === "danger-full-access"
                ? "live"
                : FALLBACKS[field]);
            const allowed = allowedValues(field);
            const canonical = snapshot?.config[field];
            const value =
              allowed &&
              !allowed.includes(localValue) &&
              typeof canonical === "string" &&
              allowed.includes(canonical)
                ? canonical
                : localValue;
            const options: {
              value: string;
              label: string;
              description?: string;
              disabled?: boolean;
            }[] = OPTIONS[field]
              .filter(
                (choice) =>
                  !allowedValues(field) ||
                  allowedValues(field)!.includes(choice),
              )
              .map((choice) => ({
                value: choice,
                label: t(`settings.configuration.options.${field}.${choice}`),
                ...(field === "approval_policy" ||
                field === "sandbox_mode" ||
                field === "web_search"
                  ? {
                      description: t(
                        `settings.configuration.optionDescriptions.${choice}`,
                      ),
                    }
                  : {}),
              }));
            if (field === "approval_policy" && value === "untrusted")
              options.push({
                value,
                label: t(
                  "settings.configuration.options.approval_policy.untrusted",
                ),
                disabled: true,
              });
            return (
              <Fragment key={field}>
                <SettingsRow
                  label={t(`settings.configuration.fields.${field}.label`)}
                  description={description(field)}
                  targetId={target(field)}
                  aria-busy={state.pending.includes(field)}
                >
                  <SettingsValueMenu
                    targetId={target(field)}
                    described
                    value={value}
                    options={options}
                    disabled={
                      disabled(field) ||
                      !options.some((option) => !option.disabled)
                    }
                    onChange={(next) =>
                      void state.change(
                        field,
                        next === "model-default" ? null : next,
                      )
                    }
                  />
                </SettingsRow>
                {field === "sandbox_mode" &&
                config?.sandbox_mode === "workspace-write" ? (
                  <SettingsRow
                    label={t("settings.configuration.fields.network.label")}
                    description={description(
                      "sandbox_workspace_write.network_access",
                    )}
                    targetId={target("sandbox_workspace_write.network_access")}
                    aria-busy={state.pending.includes(
                      "sandbox_workspace_write.network_access",
                    )}
                  >
                    <SettingsSwitch
                      aria-labelledby={`${target("sandbox_workspace_write.network_access")}-label`}
                      aria-describedby={`${target("sandbox_workspace_write.network_access")}-description`}
                      checked={
                        (managedField("sandbox_workspace_write.network_access")
                          ? snapshot?.config.sandbox_workspace_write
                              ?.network_access
                          : config.sandbox_workspace_write?.network_access) ??
                        false
                      }
                      disabled={disabled(
                        "sandbox_workspace_write.network_access",
                      )}
                      onCheckedChange={(next) =>
                        void state.change(
                          "sandbox_workspace_write.network_access",
                          next,
                        )
                      }
                    />
                  </SettingsRow>
                ) : null}
              </Fragment>
            );
          })}
        </SettingsGroup>
      </SettingsSection>
      <WorkspaceDependenciesSection snapshot={snapshot} />
      <ModelFeaturesSection
        value={
          (managedField("desktop.enabled-reasoning-efforts")
            ? snapshot?.config
            : (snapshot?.layer.config as Partial<Config> | undefined)
          )?.desktop?.["enabled-reasoning-efforts"]
        }
        disabled={disabled("desktop.enabled-reasoning-efforts")}
        error={
          <>
            {lockReason("desktop.enabled-reasoning-efforts") ? (
              <div>{lockReason("desktop.enabled-reasoning-efforts")}</div>
            ) : null}
            {saveError("desktop.enabled-reasoning-efforts")}
          </>
        }
        onChange={(value) =>
          void state.change("desktop.enabled-reasoning-efforts", value)
        }
      />
    </SettingsPageBody>
  );
}
