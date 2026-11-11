import { AppServerClient } from "./appServer";
import type {
  AppServerCloudDesktopParams,
  AppServerCloudDesktopResponse,
  AppServerCloudRequestParams,
  AppServerCloudRequestResponse,
} from "./appServerTypes";

export async function requestCloudDesktop(
  params: AppServerCloudDesktopParams,
  client: Pick<AppServerClient, "requestCloudDesktop"> = new AppServerClient(),
): Promise<AppServerCloudDesktopResponse> {
  return (await client.requestCloudDesktop(params)).result;
}

export async function requestCloud(
  params: AppServerCloudRequestParams,
  client: Pick<AppServerClient, "requestCloud"> = new AppServerClient(),
): Promise<AppServerCloudRequestResponse> {
  return (await client.requestCloud(params)).result;
}
