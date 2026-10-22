import { createContext, useContext, useLayoutEffect } from "react";

export interface FileEditController {
  getSnapshot(): { dirty: boolean; saving: boolean };
  flushPublicFile(): Promise<boolean>;
  discardEdits(): void;
}

export const FileEditLifecycleContext = createContext<
  | ((path: string, controller: FileEditController) => (() => void) | undefined)
  | null
>(null);

/** 预览只发布当前编辑实例；标签关闭与外部文件动作仍归宿主生命周期。 */
export function useFileEditLifecycle(
  path: string,
  controller: FileEditController | undefined,
) {
  const register = useContext(FileEditLifecycleContext);
  useLayoutEffect(() => {
    if (controller) return register?.(path, controller);
  }, [path, controller, register]);
}
