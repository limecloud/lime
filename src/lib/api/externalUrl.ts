import { safeInvoke } from "@/lib/dev-bridge";
import { assertNotDiagnosticFacade } from "./diagnosticFacade";
import { assertEmptyElectronHostResult } from "./electronHostResult";

export async function openExternalUrlWithSystemBrowser(
  url: string,
): Promise<void> {
  const result = await safeInvoke("open_external_url", { url });
  assertNotDiagnosticFacade(
    "open_external_url",
    result,
    "真实外部链接 current 通道",
  );
  assertEmptyElectronHostResult("open_external_url", result);
}

export async function isDefaultBrowser(): Promise<boolean> {
  const result = await safeInvoke<unknown>("is_default_browser");
  if (typeof result !== "boolean") {
    throw new Error(
      "is_default_browser did not return a boolean Electron host result",
    );
  }
  return result;
}
