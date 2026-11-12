import { AppServerClient } from "./appServer";
import { requestCloud as requestCloudRpc } from "./cloud";
import type {
  AppServerCloudRequestParams,
  AppServerCloudRequestResponse,
} from "./appServerTypes";
import { getLimeI18n } from "@/i18n/createI18n";
import {
  cloudAccountIdentity,
  cloudAccountIdentityVersion,
  CloudAccountChangedError,
  getCloudAccount,
  readCloudAccount,
} from "@/lib/cloudAccount";

export class CloudRequestError extends Error {
  constructor(readonly response: AppServerCloudRequestResponse) {
    super(
      typeof response.body === "object" &&
        response.body &&
        "error" in response.body
        ? String(response.body.error)
        : `Cloud request failed (HTTP ${response.status})`,
    );
  }
}

/** The native owner validates fixed routes and keeps credentials out of the renderer. */
export async function requestCloud<T>(
  params: Omit<AppServerCloudRequestParams, "language">,
  client: Pick<AppServerClient, "requestCloud"> = new AppServerClient(),
): Promise<T> {
  const account = getCloudAccount() ?? (await readCloudAccount());
  if (!account) throw new Error("account_login_required");
  const identity = cloudAccountIdentity(account);
  const version = cloudAccountIdentityVersion();
  const result = await requestCloudRpc(
    { ...params, language: getLimeI18n().language },
    client,
  );
  if (
    version !== cloudAccountIdentityVersion() ||
    identity !== cloudAccountIdentity(getCloudAccount()) ||
    identity !== cloudAccountIdentity({ account: result.account })
  )
    throw new CloudAccountChangedError();
  if (result.status < 200 || result.status >= 300)
    throw new CloudRequestError(result);
  return result.body as T;
}
