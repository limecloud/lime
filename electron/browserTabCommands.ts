import type { EmbeddedBrowserCommand } from "./embeddedBrowserHost";
import { BROWSER_HISTORY_COMMANDS } from "./browserHistoryHost";
import { BROWSER_ANNOTATION_EDITOR_COMMANDS } from "./browserTabAnnotationEditor";
import { BROWSER_ANNOTATION_COMMANDS } from "./browserAnnotationModel";

export const BROWSER_TAB_PAGE_COMMANDS = {
  browser_tab_set_bounds: ["embedded_browser_view_set_bounds", false, "state"],
  browser_tab_navigate: ["embedded_browser_view_navigate", true, "state"],
  browser_tab_reload: ["embedded_browser_view_reload", true, "state"],
  browser_tab_stop: ["embedded_browser_view_stop", true, "state"],
  browser_tab_find_in_page: [
    "embedded_browser_view_find_in_page",
    false,
    "state",
  ],
  browser_tab_stop_find_in_page: [
    "embedded_browser_view_stop_find_in_page",
    false,
    "state",
  ],
  browser_tab_set_zoom: ["embedded_browser_view_set_zoom", true, "state"],
  browser_tab_go_back: ["embedded_browser_view_go_back", true, "state"],
  browser_tab_go_forward: ["embedded_browser_view_go_forward", true, "state"],
  browser_tab_print: ["embedded_browser_view_print", true, "value"],
  browser_tab_capture_screenshot: [
    "embedded_browser_view_capture_screenshot",
    false,
    "value",
  ],
  browser_tab_set_audio_muted: [
    "embedded_browser_view_set_audio_muted",
    true,
    "state",
  ],
  browser_tab_set_device: ["embedded_browser_view_set_device", true, "state"],
} as const satisfies Record<
  string,
  readonly [EmbeddedBrowserCommand, boolean, "state" | "value"]
>;

export type BrowserTabPageCommand = keyof typeof BROWSER_TAB_PAGE_COMMANDS;

export const BROWSER_TAB_COMMANDS = [
  ...BROWSER_ANNOTATION_EDITOR_COMMANDS,
  ...BROWSER_HISTORY_COMMANDS,
  ...BROWSER_ANNOTATION_COMMANDS,
  "browser_tab_list",
  "browser_tab_mount",
  "browser_tab_set_bounds",
  "browser_tab_navigate",
  "browser_tab_reload",
  "browser_tab_stop",
  "browser_tab_find_in_page",
  "browser_tab_stop_find_in_page",
  "browser_tab_set_zoom",
  "browser_tab_go_back",
  "browser_tab_go_forward",
  "browser_tab_print",
  "browser_tab_capture_screenshot",
  "browser_tab_set_audio_muted",
  "browser_tab_set_device",
  "browser_tab_select",
  "browser_tab_close",
  "browser_tab_show_menu",
  "browser_tab_update_menu",
  "browser_tab_hide_overlay",
] as const;

export type BrowserTabCommand = (typeof BROWSER_TAB_COMMANDS)[number];

export function isBrowserTabCommand(
  command: string,
): command is BrowserTabCommand {
  return BROWSER_TAB_COMMANDS.includes(command as BrowserTabCommand);
}

export function isBrowserTabPageCommand(
  command: string,
): command is BrowserTabPageCommand {
  return Object.hasOwn(BROWSER_TAB_PAGE_COMMANDS, command);
}
