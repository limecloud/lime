import { safeInvoke } from "@/lib/dev-bridge";

export interface AutoFixResult {
  issues_found: string[];
  fixes_applied: string[];
  warnings: string[];
}

export async function runAutoFixConfiguration(): Promise<AutoFixResult> {
  return safeInvoke<AutoFixResult>("auto_fix_configuration");
}
