import type { IpcMain, IpcMainInvokeEvent, Session } from "electron";
import { ContactAutofillStore } from "./contactAutofillStore";
import { BROWSER_CONTACT_AUTOFILL_CHANNEL } from "./browserContactAutofillModel";
import { isSecureAutofillUrl } from "./browserPasswordAutofillModel";

export function registerBrowserContactAutofill({
  ipcMain,
  session,
  store,
  isEnabled = async () => true,
}: {
  ipcMain: IpcMain;
  session: Session;
  store: ContactAutofillStore;
  isEnabled?: () => Promise<boolean>;
}): () => void {
  const handler = async (event: IpcMainInvokeEvent) => {
    if (event.sender.session !== session) return null;
    if (!(await isEnabled())) return null;
    const frameUrl = event.senderFrame?.url ?? event.sender.getURL();
    if (!isSecureAutofillUrl(frameUrl)) return null;
    return await store.read();
  };
  ipcMain.handle(BROWSER_CONTACT_AUTOFILL_CHANNEL, handler);
  return () => ipcMain.removeHandler(BROWSER_CONTACT_AUTOFILL_CHANNEL);
}
