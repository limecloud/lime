import { Lexer, type Tokens } from "marked";
import type { ComposerInline, ComposerLinkAttributes } from "./types";

export const composerLinkDefaults: ComposerLinkAttributes = {
  href: null,
  title: null,
  disabled: false,
  isAutolink: false,
  isGeneratedAutolink: false,
  literalMarkdownOccurrenceId: null,
  literalMarkdownSource: null,
  sourceAppId: null,
};

export function normalizeComposerHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (
    !href ||
    /\s/.test(href) ||
    [...href].some(
      (character) =>
        character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  try {
    const parsed = new URL(href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return parsed.hostname ? href : null;
    return parsed.protocol === "mailto:" && parsed.pathname ? href : null;
  } catch {
    return null;
  }
}

function plainLinkLabel(link: Tokens.Link): string | null {
  if (
    !link.tokens.every(
      (token) => token.type === "text" || token.type === "escape",
    )
  )
    return null;
  return link.tokens
    .map((token) => (token as Tokens.Text | Tokens.Escape).text)
    .join("");
}

export function matchesComposerLiteralLink(
  label: string,
  attrs: ComposerLinkAttributes,
): boolean {
  const source = attrs.literalMarkdownSource;
  if (source === null || attrs.literalMarkdownOccurrenceId === null)
    return false;
  const tokens = Lexer.lexInline(source, { gfm: false });
  if (
    tokens.length !== 1 ||
    tokens[0].type !== "link" ||
    tokens[0].raw !== source
  )
    return false;
  const token = tokens[0] as Tokens.Link;
  const href = normalizeComposerHref(attrs.href);
  return (
    href !== null &&
    normalizeComposerHref(token.href) === href &&
    plainLinkLabel(token) === label &&
    (token.title ?? null) === attrs.title
  );
}

function escapeBasicLabel(label: string): string {
  return label
    .replace(/\\/g, "\\\\")
    .replace(/\]\(/g, "]\\(")
    .replace(/\]/g, "\\]");
}

export function formatResourceLink(label: string, path: string): string {
  return `[${escapeBasicLabel(label)}](${path.replace(/\\/g, "\\\\").replace(/\)/g, "\\)")})`;
}

function escapeMarkdownPhrasing(value: string): string {
  return escapeMarkdownControls(value.replace(/[\\`*_[\]]/g, "\\$&"));
}

function escapeMarkdownControls(value: string): string {
  return [...value]
    .map((character) =>
      character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127
        ? `&#${character.charCodeAt(0)};`
        : character,
    )
    .join("");
}

function formatLinkWithTitle(
  label: string,
  href: string,
  title: string,
): string {
  // Title-bearing links need independent phrasing, destination and quote escaping.
  const destination = href.replace(/[\\()<>]/g, "\\$&");
  const quotedTitle = escapeMarkdownControls(title.replace(/[\\"]/g, "\\$&"));
  return `[${escapeMarkdownPhrasing(label)}](${destination} "${quotedTitle}")`;
}

export function formatComposerLink(
  label: string,
  attrs: ComposerLinkAttributes,
  preserveLiteralMarkdown = false,
): string {
  if (preserveLiteralMarkdown && matchesComposerLiteralLink(label, attrs))
    return attrs.literalMarkdownSource!;
  const href =
    normalizeComposerHref(attrs.href) ??
    (attrs.isAutolink ? normalizeComposerHref(label) : null);
  if (href === null) return label;
  if (label === href && attrs.title === null) return href;
  if (attrs.title) return formatLinkWithTitle(label, href, attrs.title);
  return formatResourceLink(label, href);
}

export function parseComposerInlineLinks(
  text: string,
  occurrence: { next: number },
): ComposerInline[] {
  const result: ComposerInline[] = [];
  for (const token of Lexer.lexInline(text, { gfm: false })) {
    const link = token.type === "link" ? (token as Tokens.Link) : null;
    const label = link ? plainLinkLabel(link) : null;
    const href = link ? normalizeComposerHref(link.href) : null;
    if (link && href && label) {
      result.push({
        type: "text",
        text: label,
        marks: [
          {
            type: "link",
            attrs: {
              ...composerLinkDefaults,
              href,
              title: link.title ?? null,
              isAutolink: token.raw.startsWith("<"),
              literalMarkdownOccurrenceId: occurrence.next++,
              literalMarkdownSource: token.raw,
            },
          },
        ],
      });
    } else if (token.raw) {
      result.push({ type: "text", text: token.raw });
    }
  }
  return result;
}
