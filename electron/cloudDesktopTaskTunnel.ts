import type {
  CloudDesktopParams,
  CloudDesktopResource,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";
import { AppServerConnectionConfigError } from "./appServerRemoteConnection";
import { validateCloudDesktopViewEndpoint } from "../src/lib/desktop-host/cloudDesktopConnection";

export type CloudDesktopRequest = (
  params: CloudDesktopParams,
) => Promise<CloudDesktopResponse>;

// This is the fixed service inside the guest, never the transient local listener.
export const ECS_APP_SERVER_TARGET = "ws://127.0.0.1:8787/";

/** A desktop viewer never requests human input ownership or a new task session. */
export async function resolveCloudDesktopViewTunnel(
  request: CloudDesktopRequest,
  resource: CloudDesktopResource,
): Promise<string> {
  try {
    if (resource.provider !== "ecs") throw new Error("unsupported provider");
    const response = await request({
      action: "openEcsTunnel",
      resource,
      channel: "desktop",
    });
    const data = response.data as Record<string, unknown> | null;
    if (
      !data ||
      data.state !== "listening" ||
      data.channel !== "desktop" ||
      data.persistent !== false ||
      data.connectionFailed === true
    )
      throw new Error("invalid desktop tunnel response");
    return validateCloudDesktopViewEndpoint(data.endpoint);
  } catch (error) {
    throw new Error(
      String(error).includes(
        "ErrorCode=InvalidOperation.SecurityGroupRuleDenied",
      )
        ? "ECS_SECURITY_GROUP_DENIED"
        : "CLOUD_DESKTOP_VIEW_FAILED",
    );
  }
}

/** Resolve only on an explicit connection attempt; polling never creates a session. */
export async function resolveCloudDesktopTaskTunnel(
  request: CloudDesktopRequest,
  resource: CloudDesktopResource,
  renew: boolean,
): Promise<string> {
  try {
    if (resource.provider !== "ecs") throw new Error("unsupported provider");
    if (renew)
      await request({
        action: "closeEcsTunnel",
        resource,
        channel: "appServer",
      });
    const response = await request({
      action: "openEcsTunnel",
      resource,
      channel: "appServer",
    });
    const data = response.data as Record<string, unknown> | null;
    if (
      !data ||
      data.state !== "listening" ||
      data.channel !== "appServer" ||
      data.persistent !== false ||
      typeof data.endpoint !== "string"
    )
      throw new Error("invalid tunnel response");
    const endpoint = new URL(data.endpoint);
    if (
      endpoint.protocol !== "ws:" ||
      endpoint.hostname !== "127.0.0.1" ||
      !endpoint.port ||
      Number(endpoint.port) === 0 ||
      endpoint.pathname !== "/" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error("invalid tunnel endpoint");
    return endpoint.toString();
  } catch (error) {
    // Neither arbitrary supplier errors nor supplier session URLs reach Renderer.
    throw new AppServerConnectionConfigError(
      String(error).includes(
        "ErrorCode=InvalidOperation.SecurityGroupRuleDenied",
      )
        ? "ECS_SECURITY_GROUP_DENIED"
        : "ECS_TUNNEL_FAILED",
    );
  }
}
