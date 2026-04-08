async (args, helpers) => {
  const ARTICLE_ROOT_SELECTOR = '[data-testid="twitterArticleReadView"]';
  const ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]';
  const ARTICLE_CONTENT_SELECTOR =
    '[data-testid="longformRichTextComponent"] [data-contents="true"], [data-testid="longformRichTextComponent"]';
  const IMAGE_SELECTOR = '[data-testid="tweetPhoto"] img';
  const CODE_BLOCK_SELECTOR =
    '[data-testid="markdown-code-block"], [data-testid="prism-code-block"], pre';

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeMultilineText(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeMarkdownText(value) {
    return String(value || "").replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
  }

  function normalizeArticleUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
      if (hostname !== "x.com" && hostname !== "twitter.com") {
        return null;
      }
      if (!/\/article\//.test(url.pathname)) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  function resolveAuthor() {
    const titleMatch = document.title.match(/^(.+?) on X/i);
    if (titleMatch?.[1]) {
      return normalizeText(titleMatch[1]);
    }

    const pathMatch = location.pathname.match(/^\/([^/]+)/);
    if (pathMatch?.[1]) {
      return `@${pathMatch[1]}`;
    }

    return null;
  }

  function normalizeImageUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      if (url.hostname.includes("pbs.twimg.com")) {
        if (url.searchParams.has("format")) {
          url.searchParams.set("name", "orig");
        }
      }
      return url.toString();
    } catch {
      return rawUrl || "";
    }
  }

  function resolveSrcsetUrl(rawSrcset) {
    const entries = String(rawSrcset || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      return "";
    }

    const lastEntry = entries[entries.length - 1] || "";
    const [url] = lastEntry.split(/\s+/, 1);
    return String(url || "").trim();
  }

  function resolveImageSource(imageElement) {
    const picture = imageElement.closest("picture");
    const pictureSources = picture
      ? Array.from(picture.querySelectorAll("source"))
      : [];
    const candidate = [
      imageElement.currentSrc,
      imageElement.getAttribute("src"),
      imageElement.getAttribute("data-src"),
      imageElement.getAttribute("data-image-url"),
      resolveSrcsetUrl(imageElement.getAttribute("srcset")),
      ...pictureSources.map((source) =>
        resolveSrcsetUrl(source.getAttribute("srcset")),
      ),
    ].find((value) => normalizeText(value));

    return String(candidate || "");
  }

  function resolveSuggestedImageName(rawUrl, fallbackIndex) {
    try {
      const url = new URL(rawUrl, location.href);
      const format = normalizeText(url.searchParams.get("format"));
      const ext = format || normalizeText(url.pathname.split(".").pop()) || "jpg";
      return `image-${fallbackIndex + 1}.${ext}`;
    } catch {
      return `image-${fallbackIndex + 1}.jpg`;
    }
  }

  function resolveCodeLanguage(element) {
    const candidates = [
      element.getAttribute("data-language"),
      element.querySelector("[data-language]")?.getAttribute("data-language"),
      element.querySelector("code")?.getAttribute("data-language"),
      element.querySelector("pre")?.getAttribute("data-language"),
      element.querySelector("code")?.className,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeText(candidate);
      if (!normalized) {
        continue;
      }
      const match = normalized.match(/language-([a-z0-9_+-]+)/i);
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
      if (/^[a-z0-9_+-]+$/i.test(normalized)) {
        return normalized.toLowerCase();
      }
    }

    return "";
  }

  function createState() {
    return {
      imageUrls: new Set(),
      images: [],
    };
  }

  function registerImage(state, imageElement) {
    const rawUrl = resolveImageSource(imageElement);
    const normalizedUrl = normalizeImageUrl(rawUrl);
    if (!normalizedUrl) {
      return "";
    }

    if (!state.imageUrls.has(normalizedUrl)) {
      state.imageUrls.add(normalizedUrl);
      state.images.push({
        url: normalizedUrl,
        alt: normalizeText(imageElement.getAttribute("alt")) || undefined,
        suggested_file_name: resolveSuggestedImageName(
          normalizedUrl,
          state.images.length,
        ),
      });
    }

    const altText = normalizeText(imageElement.getAttribute("alt")) || "插图";
    return `![${escapeMarkdownText(altText)}](${normalizedUrl})`;
  }

  function collectInlineMarkdown(node, state) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMarkdownText(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node;
    if (element.matches?.(IMAGE_SELECTOR) || element.tagName === "IMG") {
      return registerImage(state, element);
    }

    if (element.matches?.(CODE_BLOCK_SELECTOR)) {
      return "";
    }

    if (element.tagName === "BR") {
      return "\n";
    }

    const childMarkdown = Array.from(element.childNodes)
      .map((child) => collectInlineMarkdown(child, state))
      .join("");
    const normalized = childMarkdown.replace(/[ \t]+\n/g, "\n");

    if (element.tagName === "A") {
      const href = helpers.absoluteUrl(element.getAttribute("href") || "");
      const label = normalizeMultilineText(normalized);
      if (!href) {
        return label;
      }
      return label ? `[${label}](${href})` : href;
    }

    if (element.tagName === "CODE") {
      const codeText = normalizeMultilineText(element.textContent || "");
      return codeText ? `\`${codeText}\`` : "";
    }

    if (element.tagName === "STRONG" || element.tagName === "B") {
      const text = normalized.trim();
      return text ? `**${text}**` : "";
    }

    if (element.tagName === "EM" || element.tagName === "I") {
      const text = normalized.trim();
      return text ? `*${text}*` : "";
    }

    return normalized;
  }

  function hasMeaningfulText(element) {
    return normalizeText(element.textContent || "").length > 0;
  }

  function serializeList(element, state, depth = 0) {
    const items = Array.from(element.children)
      .filter((child) => child.tagName === "LI")
      .map((item, index) => {
        const marker = element.tagName === "OL" ? `${index + 1}.` : "-";
        const nestedLists = Array.from(item.children).filter((child) =>
          ["UL", "OL"].includes(child.tagName),
        );
        const clonedItem = item.cloneNode(true);
        nestedLists.forEach((list) => {
          const nestedClone = clonedItem.querySelector(list.tagName.toLowerCase());
          nestedClone?.remove();
        });

        const text = normalizeMultilineText(
          collectInlineMarkdown(clonedItem, state),
        );
        const lines = [];
        if (text) {
          lines.push(`${"  ".repeat(depth)}${marker} ${text}`);
        }
        nestedLists.forEach((list) => {
          const nestedMarkdown = serializeList(list, state, depth + 1);
          if (nestedMarkdown) {
            lines.push(nestedMarkdown);
          }
        });
        return lines.join("\n");
      })
      .filter(Boolean);

    return items.join("\n");
  }

  function serializeBlock(element, state) {
    if (!(element instanceof Element)) {
      return [];
    }

    if (element.matches(ARTICLE_TITLE_SELECTOR)) {
      return [];
    }

    if (element.matches(CODE_BLOCK_SELECTOR)) {
      const codeText = normalizeMultilineText(element.innerText || element.textContent || "");
      if (!codeText) {
        return [];
      }
      const language = resolveCodeLanguage(element);
      return [`\`\`\`${language}\n${codeText}\n\`\`\``];
    }

    if (element.matches(IMAGE_SELECTOR) || element.matches('[data-testid="tweetPhoto"], figure')) {
      const images = element.matches(IMAGE_SELECTOR)
        ? [element]
        : Array.from(element.querySelectorAll("img"));
      return images
        .map((image) => registerImage(state, image))
        .filter(Boolean);
    }

    if (element.matches("ul,ol")) {
      const listMarkdown = serializeList(element, state);
      return listMarkdown ? [listMarkdown] : [];
    }

    if (element.matches("blockquote")) {
      const text = normalizeMultilineText(collectInlineMarkdown(element, state));
      if (!text) {
        return [];
      }
      return [text.split("\n").map((line) => `> ${line}`).join("\n")];
    }

    if (element.matches("h1,h2,h3,h4,h5,h6")) {
      const level = Number(element.tagName.slice(1)) || 2;
      const text = normalizeMultilineText(collectInlineMarkdown(element, state));
      return text ? [`${"#".repeat(Math.min(level, 6))} ${text}`] : [];
    }

    if (element.matches("hr")) {
      return ["---"];
    }

    const directBlockChildren = Array.from(element.children).filter((child) => {
      if (child.matches(CODE_BLOCK_SELECTOR)) {
        return true;
      }
      if (child.matches(IMAGE_SELECTOR) || child.matches('[data-testid="tweetPhoto"], figure')) {
        return true;
      }
      if (child.matches("ul,ol,blockquote,h1,h2,h3,h4,h5,h6,hr")) {
        return true;
      }
      return child.children.length > 0 && !["A", "SPAN", "EM", "STRONG", "I", "B", "CODE"].includes(child.tagName);
    });

    if (directBlockChildren.length > 0 && !element.matches("p,li")) {
      return directBlockChildren.flatMap((child) => serializeBlock(child, state));
    }

    if (!hasMeaningfulText(element) && !element.querySelector("img")) {
      return [];
    }

    const paragraph = normalizeMultilineText(collectInlineMarkdown(element, state));
    return paragraph ? [paragraph] : [];
  }

  function serializeArticle(root, state) {
    const blocks = Array.from(root.children)
      .flatMap((child) => serializeBlock(child, state))
      .map((block) => normalizeMultilineText(block))
      .filter(Boolean);

    if (blocks.length > 0) {
      return blocks.join("\n\n");
    }

    const fallback = normalizeMultilineText(root.innerText || root.textContent || "");
    return fallback;
  }

  const requestedUrl = String(args.url || "").trim();
  if (requestedUrl && !normalizeArticleUrl(requestedUrl)) {
    return {
      ok: false,
      error_code: "invalid_args",
      error_message: "url 必须是 x.com 或 twitter.com 的 article 链接。",
    };
  }

  const articleRoot = await helpers.waitFor(
    () => document.querySelector(ARTICLE_ROOT_SELECTOR),
    15000,
    250,
  );
  if (!articleRoot) {
    if (helpers.looksLikeLoginWall()) {
      return {
        ok: false,
        error_code: "auth_required",
        error_message: "未能读取 X 长文内容，可能需要先登录 X 后再访问。",
      };
    }
    return {
      ok: false,
      error_code: "adapter_runtime_error",
      error_message: "未找到 X 长文阅读视图。",
    };
  }

  const title =
    normalizeText(articleRoot.querySelector(ARTICLE_TITLE_SELECTOR)?.textContent) ||
    normalizeText(document.title.replace(/\s+on X.*$/i, ""));
  const contentRoot = articleRoot.querySelector(ARTICLE_CONTENT_SELECTOR);
  if (!contentRoot) {
    return {
      ok: false,
      error_code: helpers.looksLikeLoginWall() ? "auth_required" : "adapter_runtime_error",
      error_message: "未找到 X 长文正文区域。",
    };
  }

  const state = createState();
  const markdown = serializeArticle(contentRoot, state);
  if (!markdown) {
    return {
      ok: false,
      error_code: helpers.looksLikeLoginWall() ? "auth_required" : "adapter_runtime_error",
      error_message: "正文为空，无法导出 Markdown。",
    };
  }

  const publishedAt =
    articleRoot.querySelector("time[datetime]")?.getAttribute("datetime") ||
    document.querySelector("time[datetime]")?.getAttribute("datetime") ||
    undefined;
  const sourceUrl = normalizeArticleUrl(location.href) || location.href;

  return {
    ok: true,
    source_url: sourceUrl,
    data: {
      export_kind: "markdown_bundle",
      title: title || undefined,
      source_url: sourceUrl,
      author: resolveAuthor() || undefined,
      published_at: publishedAt || undefined,
      markdown,
      images: state.images,
    },
  };
};
