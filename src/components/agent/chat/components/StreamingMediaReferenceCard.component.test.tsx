import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { loadNamespaceResource } from "@/i18n/loadNamespace";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { StreamingMediaReferenceCard } from "./StreamingMediaReferenceCard";

afterEach(async () => {
  await changeLimeLocale("zh-CN");
});

describe("StreamingMediaReferenceCard", () => {
  it.each(SUPPORTED_LOCALES)(
    "%s 隐藏内部地址并保持同一资源的打开动作",
    async (locale) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      await changeLimeLocale(locale);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const uri = `sidecar://media/${"a".repeat(64)}`;
      // Persisted output may still contain the old URI caption fallback.
      const reference = {
        uri,
        kind: "image",
        mimeType: "image/png",
        caption: uri,
      };
      const onOpen = vi.fn();
      try {
        act(() =>
          root.render(
            <StreamingMediaReferenceCard
              reference={reference}
              onOpen={onOpen}
            />,
          ),
        );
        const card = container.querySelector("button");
        const resource = loadNamespaceResource(locale, "agent");
        expect(card?.textContent).toContain(
          resource["agentChat.streamingRenderer.mediaReference.kind.image"],
        );
        expect(card?.textContent).not.toContain("sidecar://");
        expect(card?.getAttribute("aria-label")).not.toContain("sidecar://");
        expect(card?.getAttribute("data-reference-uri")).toBe(uri);
        act(() => card?.click());
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(reference);
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    },
  );
});
