import { useId, type ComponentPropsWithoutRef } from "react";
import { Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsAction } from "../../SettingsPrimitives";
import type { McpEntry, McpServerDraft } from "./mcpServerConfig";

export const mcpInputClass =
  "min-w-0 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function Field({
  label,
  ...props
}: ComponentPropsWithoutRef<"input"> & { label: string }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-w-0 flex-col gap-2 text-[12px] font-medium"
    >
      {label}
      <input {...props} id={id} className={mcpInputClass} />
    </label>
  );
}

function Entries({
  label,
  addLabel,
  value,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  addLabel: string;
  value: McpEntry[];
  disabled: boolean;
  onChange: (value: McpEntry[]) => void;
  testId?: string;
}) {
  const { t } = useTranslation("settings");
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-[12px] font-medium">{label}</legend>
      {value.map((entry, index) => (
        <div
          key={index}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
        >
          <input
            className={mcpInputClass}
            disabled={disabled}
            aria-label={`${label} ${index + 1} ${t("settings.plugins.mcp.key")}`}
            value={entry.key}
            data-testid={testId ? `${testId}-key` : undefined}
            onChange={(event) =>
              onChange(
                value.map((item, position) =>
                  position === index
                    ? { ...item, key: event.target.value }
                    : item,
                ),
              )
            }
          />
          <input
            className={mcpInputClass}
            disabled={disabled}
            aria-label={`${label} ${index + 1} ${t("settings.plugins.mcp.value")}`}
            value={entry.value}
            data-testid={testId ? `${testId}-value` : undefined}
            onChange={(event) =>
              onChange(
                value.map((item, position) =>
                  position === index
                    ? { ...item, value: event.target.value }
                    : item,
                ),
              )
            }
          />
          <SettingsAction
            disabled={disabled}
            type="button"
            aria-label={t("settings.plugins.mcp.removeField", {
              name: label,
              index: index + 1,
            })}
            onClick={() =>
              onChange(value.filter((_, position) => position !== index))
            }
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </SettingsAction>
        </div>
      ))}
      <SettingsAction
        type="button"
        disabled={disabled}
        data-testid={testId ? `${testId}-add` : undefined}
        onClick={() => onChange([...value, { key: "", value: "" }])}
      >
        {addLabel}
      </SettingsAction>
    </fieldset>
  );
}

function StringEntries({
  label,
  addLabel,
  value,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  addLabel: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
  testId?: string;
}) {
  const { t } = useTranslation("settings");
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-[12px] font-medium">{label}</legend>
      {value.map((argument, index) => (
        <div key={index} className="flex gap-2">
          <input
            className={mcpInputClass}
            data-testid={testId ?? "mcp-config-argument"}
            disabled={disabled}
            aria-label={`${label} ${index + 1}`}
            value={argument}
            onChange={(event) =>
              onChange(
                value.map((item, position) =>
                  position === index ? event.target.value : item,
                ),
              )
            }
          />
          <SettingsAction
            type="button"
            disabled={disabled}
            aria-label={t("settings.plugins.mcp.removeField", {
              name: label,
              index: index + 1,
            })}
            onClick={() =>
              onChange(value.filter((_, position) => position !== index))
            }
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </SettingsAction>
        </div>
      ))}
      <SettingsAction
        type="button"
        disabled={disabled}
        onClick={() => onChange([...value, ""])}
        data-testid={testId ? `${testId}-add` : undefined}
      >
        {addLabel}
      </SettingsAction>
    </fieldset>
  );
}

export function McpServerFields({
  draft,
  existing,
  disabled,
  onChange,
}: {
  draft: McpServerDraft;
  existing: boolean;
  disabled: boolean;
  onChange: (draft: McpServerDraft) => void;
}) {
  const { t } = useTranslation("settings");
  const text = (key: string) => t(`settings.plugins.mcp.${key}`);
  const update = <K extends keyof McpServerDraft>(
    key: K,
    value: McpServerDraft[K],
  ) => onChange({ ...draft, [key]: value });
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-5">
      <Field
        label={text("name")}
        value={draft.name}
        onChange={(event) => update("name", event.target.value)}
        autoComplete="off"
        autoFocus
        data-testid="mcp-config-name"
      />
      <label className="flex min-w-0 flex-col gap-2 text-[12px] font-medium">
        {text("transport")}
        <select
          className={mcpInputClass}
          aria-label={text("transport")}
          disabled={existing || disabled}
          value={draft.transport}
          data-testid="mcp-config-transport"
          onChange={(event) =>
            update(
              "transport",
              event.target.value as McpServerDraft["transport"],
            )
          }
        >
          <option value="stdio">{text("transportLabel.stdio")}</option>
          <option value="streamable_http">
            {text("transportLabel.streamableHttp")}
          </option>
        </select>
      </label>
      {existing ? (
        <p className="text-[12px] text-muted-foreground">
          {text("switchTransportNotice")}
        </p>
      ) : null}
      {draft.transport === "stdio" ? (
        <>
          <Field
            label={text("command")}
            value={draft.command}
            onChange={(event) => update("command", event.target.value)}
            data-testid="mcp-config-command"
          />
          <StringEntries
            label={text("args")}
            addLabel={text("addArgument")}
            value={draft.args}
            disabled={disabled}
            onChange={(value) => update("args", value)}
          />
          <Entries
            label={text("envVars")}
            addLabel={text("addEnvVar")}
            value={draft.env}
            disabled={disabled}
            onChange={(value) => update("env", value)}
            testId="mcp-config-env"
          />
          <StringEntries
            label={text("envVarPassthrough")}
            addLabel={text("addEnvVarPassthrough")}
            value={draft.envVars}
            disabled={disabled}
            onChange={(value) => update("envVars", value)}
            testId="mcp-config-env-var-passthrough"
          />
          <Field
            label={text("cwd")}
            value={draft.cwd}
            onChange={(event) => update("cwd", event.target.value)}
            data-testid="mcp-config-cwd"
          />
        </>
      ) : (
        <>
          <Field
            label={text("url")}
            value={draft.url}
            onChange={(event) => update("url", event.target.value)}
            data-testid="mcp-config-connection-url"
          />
          <Field
            label={text("bearerToken")}
            value={draft.bearerTokenEnvVar}
            onChange={(event) =>
              update("bearerTokenEnvVar", event.target.value)
            }
            data-testid="mcp-config-bearer-token-env-var"
          />
          <Entries
            label={text("headers")}
            addLabel={text("addHeader")}
            value={draft.headers}
            disabled={disabled}
            onChange={(value) => update("headers", value)}
            testId="mcp-config-header"
          />
          <Entries
            label={text("envHeaders")}
            addLabel={text("addEnvHeader")}
            value={draft.envHeaders}
            disabled={disabled}
            onChange={(value) => update("envHeaders", value)}
            testId="mcp-config-env-header"
          />
        </>
      )}
    </fieldset>
  );
}
