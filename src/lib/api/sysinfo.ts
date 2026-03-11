import { safeInvoke } from "@/lib/dev-bridge";

export async function subscribeSysinfo(): Promise<void> {
  await safeInvoke("subscribe_sysinfo");
}

export async function unsubscribeSysinfo(): Promise<void> {
  await safeInvoke("unsubscribe_sysinfo");
}
