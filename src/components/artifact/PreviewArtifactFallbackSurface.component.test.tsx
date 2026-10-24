import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { Artifact } from "@/lib/artifact/types";
import { PreviewArtifactFallbackSurface } from "./PreviewArtifactFallbackSurface";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

it.each([
  ["zh-CN", "未命名资源", "类型：application/octet-stream"],
  ["zh-TW", "未命名資源", "類型：application/octet-stream"],
  ["en-US", "Untitled resource", "Type: application/octet-stream"],
  ["ja-JP", "無題のリソース", "種類: application/octet-stream"],
  ["ko-KR", "제목 없는 리소스", "유형: application/octet-stream"],
] as const)("文件预览在 %s 显示文件名兜底和类型", async (locale, title, mime) => {
  await changeLimeLocale(locale);
  const artifact: Artifact = {
    id: "unsupported-file",
    type: "document",
    title: "",
    content: "",
    status: "complete",
    meta: { mimeType: "application/octet-stream" },
    position: { start: 0, end: 0 },
    createdAt: 1,
    updatedAt: 1,
  };
  await act(async () =>
    root.render(
      <PreviewArtifactFallbackSurface artifact={artifact} mode="unsupported" />,
    ),
  );
  expect(container.textContent).toContain(title);
  expect(container.textContent).toContain(mime);
  expect(container.textContent).not.toContain("workspace.");
});
