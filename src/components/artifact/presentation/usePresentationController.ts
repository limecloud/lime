import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import {
  PresentationController,
  presentationControllersAtom,
} from "./PresentationController";
import type { PresentationSnapshot } from "./presentationDocument";
import { useFileEditLifecycle } from "../fileEditLifecycle";

const emptySubscribe = () => () => {};
const empty = () => undefined;
export function usePresentationController(
  path: string,
  document?: PresentationSnapshot,
) {
  const controllers = useAtomValue(presentationControllersAtom);
  let controller = controllers.get(path);
  if (!controller && document) {
    controller = new PresentationController(path, document);
    controllers.set(path, controller);
  }
  useLayoutEffect(() => {
    if (document) controller?.receiveDocument(document);
  }, [controller, document]);
  useFileEditLifecycle(path, controller);
  const state = useSyncExternalStore(
    controller?.subscribe ?? emptySubscribe,
    controller?.getSnapshot ?? empty,
  );
  useEffect(() => {
    if (
      !controller ||
      !state?.dirty ||
      state.textEditor ||
      state.elementInteraction ||
      state.selectionMarquee ||
      state.projecting ||
      state.saving ||
      state.failure
    )
      return;
    // 只持有定时器；串行保存、冲突检查与稿件仍由同一 Controller 负责。
    const timeout = setTimeout(() => void controller.flushPublicFile(), 500);
    return () => clearTimeout(timeout);
  }, [controller, state]);
  return { controller, state };
}
