import { useSyncExternalStore } from "react";
import { hasDesktopHostInvokeCapability } from "@/lib/desktop-runtime";

const OPEN_PERMISSIONS_SETUP = "permissions:open-setup";
// Keep native browser views behind the guide until the first-run preference is read.
let visible = hasDesktopHostInvokeCapability();
const listeners = new Set<() => void>();
export function setPermissionsSetupVisible(value: boolean) {
  if (visible === value) return;
  visible = value;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function usePermissionsSetupVisible() {
  return useSyncExternalStore(
    subscribe,
    () => visible,
    () => false,
  );
}
export function openPermissionsSetup() {
  window.dispatchEvent(new Event(OPEN_PERMISSIONS_SETUP));
}
export function listenPermissionsSetup(listener: () => void) {
  window.addEventListener(OPEN_PERMISSIONS_SETUP, listener);
  return () => window.removeEventListener(OPEN_PERMISSIONS_SETUP, listener);
}
