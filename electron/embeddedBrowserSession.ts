import { session } from "./electronRuntime";

export const EMBEDDED_BROWSER_PARTITION = "persist:embedded-browser";

export function openEmbeddedBrowserSession() {
  return session.fromPartition(EMBEDDED_BROWSER_PARTITION, {
    cache: true,
  });
}
