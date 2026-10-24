import { act } from "react";
import { describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import type { AgentToolCallState } from "@/lib/api/agentProtocol";
import { resolveRequiredAgentChatCopy as copy } from "../utils/agentChatCopy";
import { renderTool as renderInline } from "./InlineToolProcessStep.testHarness";
import { renderTool as renderCard } from "./ToolCallDisplay.testFixtures";
import { InlineToolProcessStep } from "./InlineToolProcessStep";
import { ToolCallDisplay } from "./ToolCallDisplay";

const metadata = { canonical_type: "dynamicToolCall", namespace: "browser" };
const call: AgentToolCallState = {
  id: "browser-cdp-display",
  name: "executeCdpCommand",
  status: "running",
  arguments: JSON.stringify({ method: "Runtime.evaluate", tabId: "tab-1" }),
  metadata,
};

describe.each(SUPPORTED_LOCALES)(
  "browser current tool surfaces / %s",
  (locale) => {
    it("普通卡片和流式行使用浏览器标签与叙述，完成后保持浏览器归属", async () => {
      await changeLimeLocale(locale);
      const inline = renderInline(call, { isMessageStreaming: true });
      const card = renderCard(call);
      for (const { container } of [inline, card]) {
        expect(container.querySelector(".lucide-terminal")).toBeNull();
        expect(container.textContent).not.toContain("execute Cdp Command");
      }
      expect(inline.container.textContent).toContain(
        copy("toolCall.processSummary.browser.viewPageState"),
      );
      expect(card.container.textContent).toContain(
        `${copy("toolCall.action.browser.running")} ${copy("toolCall.subject.page")}`,
      );
      const completed = {
        ...call,
        status: "completed" as const,
        result: { success: true, output: '{"value":1}' },
      };
      act(() => {
        inline.root.render(<InlineToolProcessStep toolCall={completed} />);
        card.root.render(<ToolCallDisplay toolCall={completed} />);
      });
      expect(inline.container.textContent).toContain(
        copy("toolCall.processSummary.browser.operationCompleted"),
      );
      expect(card.container.textContent).toContain(
        `${copy("toolCall.action.browser.completed")} ${copy("toolCall.subject.page")}`,
      );
      expect(inline.container.querySelector(".lucide-globe")).not.toBeNull();
    });

    it("相同名称的 namespace 更新会重算展示", async () => {
      await changeLimeLocale(locale);
      const initial = {
        ...call,
        name: "read",
        status: "completed" as const,
        metadata: { ...metadata, namespace: "filesystem" },
      };
      const inline = renderInline(initial);
      const card = renderCard(initial);
      expect(inline.container.querySelector(".lucide-globe")).toBeNull();
      expect(card.container.textContent).not.toContain(
        `${copy("toolCall.action.browser.completed")} ${copy("toolCall.subject.page")}`,
      );
      act(() => {
        inline.root.render(
          <InlineToolProcessStep toolCall={{ ...initial, metadata }} />,
        );
        card.root.render(
          <ToolCallDisplay toolCall={{ ...initial, metadata }} />,
        );
      });
      expect(inline.container.querySelector(".lucide-globe")).not.toBeNull();
      expect(card.container.textContent).toContain(
        `${copy("toolCall.action.browser.completed")} ${copy("toolCall.subject.page")}`,
      );
    });
  },
);
