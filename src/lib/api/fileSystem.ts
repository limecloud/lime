import { safeInvoke } from "@/lib/dev-bridge";

export async function revealPathInFinder(path: string): Promise<void> {
  await safeInvoke("reveal_in_finder", { path });
}

export async function openPathWithDefaultApp(path: string): Promise<void> {
  await safeInvoke("open_with_default_app", { path });
}
