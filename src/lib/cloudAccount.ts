import { loginAccount, logoutAccount, readAccount } from "./api/account";
import { subscribeAppServerNotifications } from "./api/appServerEventBus";
import { openExternalUrlWithSystemBrowser } from "./api/externalUrl";
import type {
  AppServerAccount,
  AppServerGetAccountResponse,
  AppServerLoginAccountParams,
} from "./api/appServerTypes";

export interface CloudAccountView {
  account: Extract<AppServerAccount, { type: "cloud" }>;
}
export type CloudResource = Extract<AppServerLoginAccountParams, { type: "cloud" }>["resource"];

let current: CloudAccountView | null = null;
let snapshot: AppServerGetAccountResponse = { serviceUrl: null, account: null, authorizations: [] };
let revision = 0;
let identityVersion = 0;
let unwatch: (() => void) | null = null;
let poll: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(view: CloudAccountView | null) => void>();

export function cloudAccountIdentity(view: Pick<CloudAccountView, "account"> | null) {
  const a = view?.account;
  return a ? JSON.stringify([
    a.baseUrl, a.issuer, a.applicationId, a.clientId, a.environment, a.userId, a.generation,
  ]) : null;
}

/** Identity lifetime includes a switch away and back to the same subject. */
export function cloudAccountIdentityVersion(): number { return identityVersion; }
export function getCloudAccount(): CloudAccountView | null { return current; }
export function getCloudAccountState(): AppServerGetAccountResponse { return snapshot; }

function publish(next: AppServerGetAccountResponse) {
  if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
  const view = next.account ? { account: next.account } : null;
  if (cloudAccountIdentity(current) !== cloudAccountIdentity(view)) identityVersion += 1;
  if (JSON.stringify(current) !== JSON.stringify(view)) current = view;
  snapshot = next;
  for (const listener of listeners) listener(current);
}

export async function readCloudAccountState(authorizationId?: string): Promise<AppServerGetAccountResponse> {
  const ticket = ++revision;
  const result = await readAccount(authorizationId ? { authorizationId } : {});
  if (ticket === revision) publish(result);
  return snapshot;
}
export async function readCloudAccount(): Promise<CloudAccountView | null> {
  await readCloudAccountState();
  return current;
}

export async function startCloudAuthorization(params: {
  language: string;
  resource?: CloudResource;
  installation?: Extract<AppServerLoginAccountParams, { type: "cloud" }>["installation"];
}) {
  ++revision;
  const result = await loginAccount({ type: "cloud", ...params });
  await readCloudAccountState();
  await openExternalUrlWithSystemBrowser(result.authUrl);
  schedulePoll();
  return result.authorization;
}

export async function logoutCloudAccount(): Promise<void> {
  ++revision;
  await logoutAccount();
  await readCloudAccountState();
}

function schedulePoll() {
  clearTimeout(poll);
  if (!listeners.size || !snapshot.authorizations.some(a =>
    a.status === "pending" || a.status === "exchanging")) return;
  poll = setTimeout(() => {
    void readCloudAccountState().catch(() => undefined).finally(schedulePoll);
  }, 1500);
}

/** Metadata only. Credential exchange and storage stay in the native account owner. */
export function subscribeCloudAccount(listener: (view: CloudAccountView | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  if (!unwatch) {
    const refresh = () => { void readCloudAccountState().catch(() => undefined).finally(schedulePoll); };
    const dispose = subscribeAppServerNotifications({
      onNotifications: notifications => {
        if (notifications.some(n => n.method === "account/updated")) refresh();
      },
    });
    if (typeof window !== "undefined") window.addEventListener("focus", refresh);
    unwatch = () => {
      dispose();
      clearTimeout(poll);
      if (typeof window !== "undefined") window.removeEventListener("focus", refresh);
    };
    refresh();
  }
  schedulePoll();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { unwatch?.(); unwatch = null; }
  };
}

export class CloudAccountChangedError extends Error {
  constructor() { super("cloud account changed while a request was in flight"); }
}
