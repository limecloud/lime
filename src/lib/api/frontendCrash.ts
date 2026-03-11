import { safeInvoke } from "@/lib/dev-bridge";

export async function reportFrontendCrash(report: unknown): Promise<void> {
  await safeInvoke("report_frontend_crash", { report });
}
