import type { BrowserRoute, BrowserTabState } from "./browserTabHost";
import type {
  ElectronEmbeddedBrowserHost,
  EmbeddedBrowserPopupRequest,
} from "./embeddedBrowserHost";
import { readMountIdentity } from "./browserTabState";

export interface BrowserPopupIdentityRequest {
  browserSessionId: string;
  threadId: string;
  openerTabId: string;
  ownerWebContentsId: number;
  url: string;
  background: boolean;
}

export type BrowserPopupIdentityHandler = (
  request: BrowserPopupIdentityRequest,
) => Promise<{ browserSessionId: string; tabId: string }>;

export async function adoptBrowserTabPopup(params: {
  request: EmbeddedBrowserPopupRequest;
  embeddedHost: ElectronEmbeddedBrowserHost;
  identityHandler: BrowserPopupIdentityHandler;
  findOpener: (viewId: string) => BrowserRoute | null;
  register: (route: BrowserRoute) => void;
  select: (
    route: BrowserRoute,
    background: boolean,
  ) => Promise<BrowserTabState>;
}): Promise<void> {
  const { request, embeddedHost } = params;
  const opener = params.findOpener(request.openerViewId);
  if (!opener) throw new Error("Browser popup opener route is unavailable");
  const identity = await params.identityHandler({
    browserSessionId: opener.browserSessionId,
    threadId: opener.threadId,
    openerTabId: opener.tabId,
    ownerWebContentsId: opener.ownerWebContentsId,
    url: request.url,
    background: request.background,
  });
  const native = embeddedHost.resolveNativeView(request.viewId);
  if (
    params.findOpener(request.openerViewId) !== opener ||
    !native ||
    native.window.id !== opener.windowId ||
    native.window.webContents.id !== opener.ownerWebContentsId ||
    identity.browserSessionId !== opener.browserSessionId ||
    !identity.tabId.trim()
  ) {
    throw new Error("Browser popup identity or opener became stale");
  }
  const route = readMountIdentity(
    { ...identity, threadId: opener.threadId, selected: false },
    native.window,
    request.viewId,
  );
  if (opener.controlOwner === "agent") {
    route.origin = "agent";
    route.controlOwner = "agent";
    route.activeTurnId = opener.activeTurnId;
  }
  params.register(route);
  await params.select(route, request.background);
}
