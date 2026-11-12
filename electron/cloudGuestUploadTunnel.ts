import type { CloudDesktopResource } from "@limecloud/app-server-client";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";
import { waitForCloudGuestRequest } from "./cloudGuestRequest";

/** Only the fixed installation service is reachable through this short lease. */
export async function openCloudGuestUploadTunnel(
  request: CloudDesktopRequest,
  resource: CloudDesktopResource,
  signal: AbortSignal,
): Promise<{ endpoint: string; close(): Promise<void> }> {
  let opening = false;
  const close = async () => {
    await waitForCloudGuestRequest(
      request({ action: "closeEcsTunnel", resource, channel: "installation" }),
      signal,
    );
  };
  const cancel = () => void close().catch(() => undefined);
  try {
    signal.throwIfAborted();
    if (resource.provider !== "ecs") throw new Error("unsupported provider");
    opening = true;
    signal.addEventListener("abort", cancel, { once: true });
    const { data } = await waitForCloudGuestRequest(
      request({ action: "openEcsTunnel", resource, channel: "installation" }),
      signal,
    );
    signal.throwIfAborted();
    const value = data as Record<string, unknown> | null;
    if (
      !value ||
      value.state !== "listening" ||
      value.channel !== "installation" ||
      value.persistent !== false ||
      typeof value.endpoint !== "string"
    )
      throw new Error("invalid installation tunnel");
    const endpoint = new URL(value.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== "127.0.0.1" ||
      !endpoint.port ||
      Number(endpoint.port) === 0 ||
      endpoint.pathname !== "/" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error("invalid installation endpoint");
    return { endpoint: endpoint.toString(), close };
  } catch (error) {
    if (opening) await close().catch(() => undefined);
    throw new Error(
      String(error).includes(
        "ErrorCode=InvalidOperation.SecurityGroupRuleDenied",
      )
        ? "CLOUD_INSTALL_SECURITY_GROUP_DENIED"
        : "CLOUD_INSTALL_TUNNEL_FAILED",
    );
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
