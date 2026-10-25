import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

import "@/i18n/config";
import { changeLimeLocale } from "@/i18n/createI18n";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PromptLinkContext, type PromptLinkScope } from "./promptLinkContext";

export const mockConvertLocalFileSrc = vi.fn(
  (path: string) => `asset://${path}`,
);

const markdownRendererMocks = vi.hoisted(() => ({
  hasDesktopHostInvokeCapability: vi.fn(),
  hasDesktopHostRuntimeMarkers: vi.fn(),
  openExternalUrlWithSystemBrowser: vi.fn().mockResolvedValue(undefined),
  readFilePreview: vi.fn(),
}));

export function getMarkdownRendererMocks() {
  return markdownRendererMocks;
}

vi.mock("react-syntax-highlighter/dist/esm/prism", () => ({
  default: ({
    children,
    language,
    className,
    style,
    customStyle,
    codeTagProps,
  }: {
    children: React.ReactNode;
    language?: string;
    className?: string;
    style?: Record<string, unknown>;
    customStyle?: React.CSSProperties;
    codeTagProps?: {
      style?: React.CSSProperties;
    };
  }) => (
    <pre
      data-testid="syntax-highlighter"
      data-language={language}
      className={className}
      data-theme={(style as { __theme?: string } | undefined)?.__theme}
      data-font-family={customStyle?.fontFamily}
      data-text-shadow={customStyle?.textShadow}
      data-font-ligatures={String(codeTagProps?.style?.fontVariantLigatures)}
    >
      <code
        data-testid="syntax-highlighter-code"
        data-inline-code={String((codeTagProps as any)?.["data-inline-code"])}
        data-display={codeTagProps?.style?.display}
        data-padding={String(codeTagProps?.style?.padding)}
        data-border={String(codeTagProps?.style?.border)}
        data-border-radius={String(codeTagProps?.style?.borderRadius)}
        data-background={String(codeTagProps?.style?.background)}
        data-color={String(codeTagProps?.style?.color)}
      >
        {children}
      </code>
    </pre>
  ),
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: { __theme: "dark" },
  oneLight: { __theme: "light" },
}));

vi.mock("./ArtifactPlaceholder", () => ({
  ArtifactPlaceholder: ({ language }: { language: string }) => (
    <div data-testid="artifact-placeholder">{language}</div>
  ),
}));

vi.mock("./A2UITaskCard", () => ({
  A2UITaskCard: ({
    compact,
    className,
    preview,
    onSubmit,
  }: {
    compact?: boolean;
    className?: string;
    preview?: boolean;
    onSubmit?: unknown;
  }) => (
    <div
      data-testid="a2ui-task-card"
      data-compact={String(compact)}
      data-preview={String(preview)}
      data-has-on-submit={onSubmit ? "yes" : "no"}
      className={className}
    />
  ),
  A2UITaskLoadingCard: ({
    compact,
    className,
  }: {
    compact?: boolean;
    className?: string;
  }) => (
    <div
      data-testid="a2ui-task-loading-card"
      data-compact={String(compact)}
      className={className}
    />
  ),
}));

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: (path: string) => mockConvertLocalFileSrc(path),
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  readFilePreview: markdownRendererMocks.readFilePreview,
}));

vi.mock("@/lib/api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser:
    markdownRendererMocks.openExternalUrlWithSystemBrowser,
}));

vi.mock("@/lib/desktop-runtime", () => ({
  hasDesktopHostInvokeCapability:
    markdownRendererMocks.hasDesktopHostInvokeCapability,
  hasDesktopHostRuntimeMarkers:
    markdownRendererMocks.hasDesktopHostRuntimeMarkers,
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

interface RenderOptions {
  promptLinkScope?: PromptLinkScope;
  promptLinkItemId?: string;
  baseFilePath?: string;
  isStreaming?: boolean;
  renderMode?: "standard" | "light";
  collapseCodeBlocks?: boolean;
  shouldCollapseCodeBlock?: (language: string, code: string) => boolean;
  showBlockActions?: boolean;
  onQuoteContent?: (content: string) => void;
  readOnlyA2UI?: boolean;
  configureContainer?: (container: HTMLDivElement) => void;
}

const mountedRoots: MountedHarness[] = [];

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
  markdownRendererMocks.openExternalUrlWithSystemBrowser.mockResolvedValue(
    undefined,
  );
  markdownRendererMocks.hasDesktopHostInvokeCapability.mockReturnValue(false);
  markdownRendererMocks.hasDesktopHostRuntimeMarkers.mockReturnValue(false);
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
  mockConvertLocalFileSrc.mockClear();
});

function renderIntoRoot(
  root: Root,
  content: string,
  {
    promptLinkScope,
    promptLinkItemId,
    baseFilePath,
    isStreaming = false,
    renderMode,
    collapseCodeBlocks = false,
    shouldCollapseCodeBlock,
    showBlockActions = false,
    onQuoteContent,
    readOnlyA2UI = false,
  }: RenderOptions = {},
) {
  act(() => {
    root.render(
      <PromptLinkContext.Provider value={promptLinkScope ?? null}>
        <MarkdownRenderer
          content={content}
          promptLinkItemId={promptLinkItemId}
          baseFilePath={baseFilePath}
          isStreaming={isStreaming}
          renderMode={renderMode}
          collapseCodeBlocks={collapseCodeBlocks}
          shouldCollapseCodeBlock={shouldCollapseCodeBlock}
          showBlockActions={showBlockActions}
          onQuoteContent={onQuoteContent}
          readOnlyA2UI={readOnlyA2UI}
        />
      </PromptLinkContext.Provider>,
    );
  });
}

export function renderMarkdown(
  content: string,
  options: RenderOptions = {},
): HTMLDivElement {
  const container = document.createElement("div");
  options.configureContainer?.(container);
  document.body.appendChild(container);
  const root = createRoot(container);

  renderIntoRoot(root, content, options);

  mountedRoots.push({ container, root });
  return container;
}

export function renderMarkdownHarness(
  content: string,
  options: RenderOptions = {},
) {
  const container = document.createElement("div");
  options.configureContainer?.(container);
  document.body.appendChild(container);
  const root = createRoot(container);

  const rerender = (nextContent: string, nextOptions: RenderOptions = {}) => {
    renderIntoRoot(root, nextContent, { ...options, ...nextOptions });
  };

  rerender(content, options);
  mountedRoots.push({ container, root });
  return { container, rerender };
}
