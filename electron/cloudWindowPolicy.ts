import { ELECTRON_APP_SERVER_TRUTH_BRIDGE_COMMANDS } from "./ipcChannels";

/** Default-deny local capabilities, including future additions to the local Host. */
export function isCloudWindowHostCommand(command: string): boolean {
  return [
    "app_server_handle_json_lines",
    "app_server_drain_events",
    "app_server_host_diagnostics",
    "persisted_atom_read",
    "persisted_atom_update",
    "cloud_desktop_window_status",
    "cloud_desktop_window_reconnect",
    "cloud_desktop_window_view",
    ...ELECTRON_APP_SERVER_TRUTH_BRIDGE_COMMANDS,
  ].includes(command);
}
