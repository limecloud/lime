import {
  METHOD_CONFIG_REQUIREMENTS_READ,
  type ConfigRequirements,
  type ConfigRequirementsReadResponse,
} from "@limecloud/app-server-client";
import { AppServerClient } from "./appServer";
import { assertNotDiagnosticFacade } from "./diagnosticFacade";
import { assertBrowserRequirements } from "./browserUseRequirements";

const choices = {
  allowedApprovalPolicies: ["on-request", "never", "untrusted"],
  allowedSandboxModes: ["read-only", "workspace-write", "danger-full-access"],
  allowedWebSearchModes: ["disabled", "cached", "indexed", "live"],
} as const;

export type { ConfigRequirements };

export async function getConfigRequirements(): Promise<ConfigRequirements | null> {
  const response =
    await new AppServerClient().request<ConfigRequirementsReadResponse>(
      METHOD_CONFIG_REQUIREMENTS_READ,
      {},
    );
  assertNotDiagnosticFacade(
    METHOD_CONFIG_REQUIREMENTS_READ,
    response.result,
    "App Server",
  );
  const requirements = response.result?.requirements;
  assertBrowserRequirements(requirements);
  if (requirements === null) return null;
  if (
    !requirements ||
    typeof requirements !== "object" ||
    Array.isArray(requirements)
  )
    throw new Error("configRequirements/read returned invalid requirements");
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    const values = requirements[key];
    if (values === null) continue;
    if (
      !Array.isArray(values) ||
      values.some(
        (value) =>
          typeof value !== "string" ||
          !(choices[key] as readonly string[]).includes(value),
      )
    )
      throw new Error(`configRequirements/read returned invalid ${key}`);
    if (key !== "allowedWebSearchModes" && values.length === 0)
      throw new Error(`configRequirements/read returned empty ${key}`);
    if (key === "allowedWebSearchModes" && !values.includes("disabled"))
      throw new Error("configRequirements/read must allow disabled web search");
  }
  const browser = requirements.inAppBrowser;
  if (browser !== undefined && browser !== null) {
    if (typeof browser !== "object" || Array.isArray(browser))
      throw new Error("configRequirements/read returned invalid inAppBrowser");
    const allow = browser.allowExternalBrowserSettingsImport;
    if (allow !== undefined && allow !== null && typeof allow !== "boolean")
      throw new Error(
        "configRequirements/read returned invalid inAppBrowser.allowExternalBrowserSettingsImport",
      );
  }
  return requirements;
}
