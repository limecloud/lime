import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface PluginInstallProgress {
  stage: string;
  percent: number;
  message: string;
}

export const PLUGIN_INSTALL_PROGRESS_EVENT = "plugin-install-progress";
export const PLUGIN_TASK_EVENT = "plugin-task-event";

export interface ListPluginTasksParams {
  taskState?: string | null;
  limit?: number;
}

export async function getPluginStatus<T>(): Promise<T> {
  return safeInvoke<T>("get_plugin_status");
}

export async function getPlugins<T>(): Promise<T[]> {
  return safeInvoke<T[]>("get_plugins");
}

export async function listInstalledPlugins<T>(): Promise<T[]> {
  return safeInvoke<T[]>("list_installed_plugins");
}

export async function listPluginTasks<T>(
  params: ListPluginTasksParams,
): Promise<T[]> {
  return safeInvoke<T[]>(
    "list_plugin_tasks",
    params as unknown as Record<string, unknown>,
  );
}

export async function getPluginQueueStats<T>(): Promise<T[]> {
  return safeInvoke<T[]>("get_plugin_queue_stats");
}

export async function getPluginTask<T>(taskId: string): Promise<T | null> {
  return safeInvoke<T | null>("get_plugin_task", { taskId });
}

export async function enablePlugin(name: string): Promise<void> {
  await safeInvoke("enable_plugin", { name });
}

export async function disablePlugin(name: string): Promise<void> {
  await safeInvoke("disable_plugin", { name });
}

export async function reloadPlugins(): Promise<void> {
  await safeInvoke("reload_plugins");
}

export async function unloadPlugin(name: string): Promise<void> {
  await safeInvoke("unload_plugin", { name });
}

export async function uninstallPlugin(pluginId: string): Promise<boolean> {
  return safeInvoke<boolean>("uninstall_plugin", { pluginId });
}

export async function cancelPluginTask(taskId: string): Promise<boolean> {
  return safeInvoke<boolean>("cancel_plugin_task", { taskId });
}

export async function listenPluginInstallProgress(
  handler: (payload: PluginInstallProgress) => void,
): Promise<UnlistenFn> {
  return safeListen<PluginInstallProgress>(
    PLUGIN_INSTALL_PROGRESS_EVENT,
    (event) => {
      handler(event.payload);
    },
  );
}

export async function listenPluginTaskEvent(
  handler: () => void | Promise<void>,
): Promise<UnlistenFn> {
  return safeListen(PLUGIN_TASK_EVENT, () => {
    void handler();
  });
}
