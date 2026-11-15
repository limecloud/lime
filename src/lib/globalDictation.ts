import { getElectronHostBridge } from "@/lib/electron-host";

let armed = false;

export function armGlobalDictation(): void {
  armed = true;
}

export function isGlobalDictationArmed(): boolean {
  return armed;
}

export function consumeGlobalDictation(): boolean {
  if (!armed) return false;
  armed = false;
  return true;
}

export function cancelGlobalDictation(): void {
  armed = false;
}

export async function insertGlobalDictation(text: string): Promise<boolean> {
  const bridge = getElectronHostBridge();
  if (!bridge) return false;
  await bridge.invoke("text_insert", { text });
  return true;
}
