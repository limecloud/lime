import type { OnBeforeRequestListenerDetails, WebContents } from "electron";
import type { BrowserSitePermissionSetting } from "../src/lib/api/browserSiteSettingsTypes";
import { permissionOrigin } from "./embeddedBrowserPermissionGrants";

/** Image destinations inherit the native requesting document's site rule. */
export function allowsEmbeddedBrowserImage(
  details: OnBeforeRequestListenerDetails,
  contents: WebContents | null,
  decision: (origin: string) => BrowserSitePermissionSetting,
): boolean {
  if (details.resourceType !== "image") return true;
  try {
    const frame = details.frame;
    if (
      !contents ||
      contents.isDestroyed() ||
      !frame ||
      frame.detached ||
      !contents.mainFrame.framesInSubtree.includes(frame)
    )
      return false;
    // Image preferences are not device grants. Sandboxed documents use their
    // native URL, and srcdoc/blank documents inherit the creator's image rule.
    let source = frame;
    let origin =
      permissionOrigin(source.origin) ?? permissionOrigin(source.url);
    while (!origin && source.parent) {
      source = source.parent;
      origin = permissionOrigin(source.origin) ?? permissionOrigin(source.url);
    }
    return origin !== null && decision(origin) === "allow";
  } catch {
    return false;
  }
}
