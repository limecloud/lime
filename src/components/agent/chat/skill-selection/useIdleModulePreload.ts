import { useEffect, useRef } from "react";
import { scheduleIdleModulePreload } from "./scheduleIdleModulePreload";

export function useIdleModulePreload(task: () => void): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    return scheduleIdleModulePreload(() => {
      taskRef.current();
    });
  }, []);
}
