import { useEffect } from "react";
import { BrowserRuntimeWorkspace } from "@/features/browser-runtime/BrowserRuntimeWorkspace";

export function BrowserRuntimeDebuggerPage() {
  useEffect(() => {
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const rootElement = document.getElementById("root");
    const rootStyle = rootElement?.style;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousHtmlOverflowY = htmlStyle.overflowY;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyOverflowY = bodyStyle.overflowY;
    const previousRootOverflow = rootStyle?.overflow ?? "";
    const previousRootHeight = rootStyle?.height ?? "";
    const previousRootMinHeight = rootStyle?.minHeight ?? "";

    htmlStyle.overflow = "auto";
    htmlStyle.overflowY = "auto";
    bodyStyle.overflow = "auto";
    bodyStyle.overflowY = "auto";
    if (rootStyle) {
      rootStyle.overflow = "visible";
      rootStyle.height = "auto";
      rootStyle.minHeight = "100vh";
    }

    return () => {
      htmlStyle.overflow = previousHtmlOverflow;
      htmlStyle.overflowY = previousHtmlOverflowY;
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.overflowY = previousBodyOverflowY;
      if (rootStyle) {
        rootStyle.overflow = previousRootOverflow;
        rootStyle.height = previousRootHeight;
        rootStyle.minHeight = previousRootMinHeight;
      }
    };
  }, []);

  const params = new URLSearchParams(window.location.search);
  return (
    <BrowserRuntimeWorkspace
      standalone
      initialProfileKey={params.get("profile_key") || undefined}
      initialSessionId={params.get("session_id") || undefined}
    />
  );
}
