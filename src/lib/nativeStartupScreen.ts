import { hasDesktopHostInvokeCapability } from "@/lib/desktop-runtime";
import { useEffect } from "react";
import { revealStartupWindowWhenReady } from "./startupWindowReveal";

// Mount inside the page Suspense boundary so a loading fallback cannot reveal
// the desktop window before its initial page has committed.
export function NativeStartupWindowReady(): null {
  useEffect(() => {
    if (hasNativeStartupScreen()) revealStartupWindowWhenReady();
  }, []);
  return null;
}

export function hasNativeStartupScreen(): boolean {
  return hasDesktopHostInvokeCapability() && hasNativeStartupScreenFlag();
}

function hasNativeStartupScreenFlag(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    new URLSearchParams(window.location.search).get("nativeStartup") === "1"
  );
}
