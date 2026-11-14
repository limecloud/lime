import type { IpcMain, IpcMainInvokeEvent, Session } from "electron";
import { BrowserPasswordStore } from "./browserPasswordStore";
import { BROWSER_PASSWORD_AUTOFILL_CHANNEL } from "./browserPasswordAutofillModel";

export function registerBrowserPasswordAutofill({
  ipcMain,
  session,
  store,
  isEnabled = async () => true,
}: {
  ipcMain: IpcMain;
  session: Session;
  store: BrowserPasswordStore;
  isEnabled?: () => Promise<boolean>;
}): () => void {
  const handler = async (event: IpcMainInvokeEvent) => {
    if (event.sender.session !== session) return [];
    if (!(await isEnabled())) return [];
    const frameUrl = event.senderFrame?.url ?? event.sender.getURL();
    return await store.lookupForUrl(frameUrl);
  };
  ipcMain.handle(BROWSER_PASSWORD_AUTOFILL_CHANNEL, handler);
  return () => ipcMain.removeHandler(BROWSER_PASSWORD_AUTOFILL_CHANNEL);
}
