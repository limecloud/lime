import { getElectronHostBridge } from "@/lib/electron-host";

export async function captureScreenRegion(): Promise<File | null> {
  const bridge = getElectronHostBridge();
  if (!bridge) return null;
  const result = await bridge.invoke<{ data?: unknown } | null>(
    "screen_capture_region",
  );
  const data = result?.data;
  if (typeof data !== "string" || !data) return null;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], `screenshot-${Date.now()}.png`, {
    type: "image/png",
  });
}
