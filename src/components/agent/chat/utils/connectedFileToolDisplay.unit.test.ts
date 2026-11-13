import { afterEach, expect, it } from "vitest";
import { loadNamespaceResource } from "@/i18n/loadNamespace";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { getToolDisplayInfo } from "./toolDisplayInfo";

afterEach(() => {
  document.documentElement.lang = "";
});

it.each(SUPPORTED_LOCALES)("%s 展示文档读取及真实工具状态", (locale) => {
  document.documentElement.lang = locale;
  const resource = loadNamespaceResource(locale, "agent");
  for (const status of ["running", "completed", "failed"] as const) {
    const display = getToolDisplayInfo("ReadConnectedFile", status);
    expect(display.family).toBe("read");
    expect(display.label).toBe(resource["agentChat.toolCall.label.documentRead"]);
    expect(display.groupTitle).toBe(resource["agentChat.toolCall.groupTitle.fetch"]);
    expect(display.action).toBe(resource[`agentChat.toolCall.action.read.${status}`]);
  }
});
