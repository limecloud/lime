import { cn } from "@/lib/utils";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TextComponent } from "../../../types";
import { resolveDynamicValue } from "../../../parser";
import { A2UI_RENDERER_TOKENS } from "../../../rendererTokens";

interface TextRendererProps {
  component: TextComponent;
  data: Record<string, unknown>;
  scopePath?: string;
}

function formatTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function containsMarkdownSyntax(value: string): boolean {
  return (
    /\n\s*\n/.test(value) ||
    / {2,}\n/.test(value) ||
    /(?:^\s{0,3}(?:#{1,6}\s|[-*+]\s+|\d+[.)]\s+|>\s+)|\[[^\]]+\]\([^)]+\)|\*\*|__|~~|`)/m.test(
      value,
    )
  );
}

const A2UI_MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="m-0 leading-[1.7]">{children}</p>,
  h1: ({ children }) => (
    <h1 className="m-0 text-base font-semibold leading-6">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="m-0 text-[0.9375rem] font-semibold leading-6">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="m-0 text-sm font-semibold leading-6">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="m-0 text-sm font-medium leading-6">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="m-0 text-sm font-medium leading-6">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="m-0 text-xs font-medium uppercase tracking-[0.04em] text-slate-500">
      {children}
    </h6>
  ),
  ul: ({ children }) => <ul className="m-0 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => (
    <ol className="m-0 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="m-0 leading-[1.7]">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="break-all text-primary underline underline-offset-2 transition-opacity hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="m-0 border-l-2 border-slate-300 pl-3 text-slate-600">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="m-0 overflow-x-auto rounded-xl border border-slate-200 bg-slate-950/95 p-3 text-[0.8125rem] text-slate-100">
      {children}
    </pre>
  ),
  code: ({ children, className, ...props }) => {
    const isCodeBlock =
      typeof className === "string" && className.includes("language-");

    return (
      <code
        {...props}
        className={cn(
          isCodeBlock
            ? "font-mono text-inherit"
            : "rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-700",
          className,
        )}
      >
        {children}
      </code>
    );
  },
  hr: () => <hr className="m-0 border-slate-200" />,
};

export function TextRenderer({
  component,
  data,
  scopePath = "/",
}: TextRendererProps) {
  const text = resolveDynamicValue(component.text, data, "", scopePath);
  const formattedText = formatTextValue(text);
  const shouldRenderMarkdown = containsMarkdownSyntax(formattedText);

  return (
    <div
      className={cn(
        "a2ui-text-block",
        `a2ui-text-${component.variant || "body"}`,
        A2UI_RENDERER_TOKENS.textVariants[component.variant || "body"],
      )}
    >
      {shouldRenderMarkdown ? (
        <div className="a2ui-markdown-content space-y-2 text-inherit">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={A2UI_MARKDOWN_COMPONENTS}
          >
            {formattedText}
          </ReactMarkdown>
        </div>
      ) : (
        formattedText
      )}
    </div>
  );
}

export const Text = TextRenderer;
