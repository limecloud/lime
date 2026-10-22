import { useLayoutEffect, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import {
  WorkbookController,
  workbookControllersAtom,
} from "./WorkbookController";
import type { WorkbookSnapshot } from "./workbookSnapshot";
import { useFileEditLifecycle } from "../fileEditLifecycle";

const subscribeEmpty = () => () => {};
const empty = () => undefined;

export function useWorkbookController(
  path: string,
  document?: WorkbookSnapshot,
) {
  const controllers = useAtomValue(workbookControllersAtom);
  let controller = controllers.get(path);
  if (!controller && document) {
    controller = new WorkbookController(path, document);
    controllers.set(path, controller);
  }
  useLayoutEffect(() => {
    if (document) controller?.receiveDocument(document);
  }, [controller, document]);
  useFileEditLifecycle(path, controller);
  const state = useSyncExternalStore(
    controller?.subscribe ?? subscribeEmpty,
    controller?.getSnapshot ?? empty,
  );
  return { controller, state };
}
