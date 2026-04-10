async (args, helpers) => {
  const ARTICLE_ROOT_SELECTOR = '[data-testid="twitterArticleReadView"]';
  const ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]';
  const ARTICLE_CONTENT_SELECTORS = [
    '[data-testid="twitterArticleRichTextView"]',
    '[data-testid="longformRichTextComponent"]',
  ];
  const ARTICLE_CONTENT_SELECTOR = ARTICLE_CONTENT_SELECTORS.join(", ");
  const IMAGE_SELECTOR = '[data-testid="tweetPhoto"] img';
  const IMAGE_BLOCK_SELECTOR =
    '[data-testid="tweetPhoto"], figure, [role="img"], [style*="background-image"]';
  const CODE_BLOCK_SELECTOR = [
    '[data-testid="markdown-code-block"]',
    '[data-testid="prism-code-block"]',
    '[data-testid*="code"]',
    '[data-testid*="Code"]',
    '.prism-code',
    '.react-syntax-highlighter-line-number',
    '[class*="syntax-highlighter"]',
    '[class*="code-block"]',
    '[class*="CodeBlock"]',
    '[class*="language-"]',
    'pre',
  ].join(", ");
  const IGNORED_BLOCK_SELECTOR = [
    ARTICLE_TITLE_SELECTOR,
    "script",
    "style",
    "noscript",
    "svg",
    "button",
    "[role='button']",
    "time",
    "[data-testid='UserAvatar-Container']",
    "[data-testid='User-Name']",
    "[data-testid='socialContext']",
  ].join(", ");

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

  function normalizeCodeText(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .replace(/\n+$/, "");
  }

  function escapeMarkdownText(value) {
    return String(value || "").replace(/([\\`*_{}\[\]()#+\-!|>])/g, "\\$1");
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
    if (!normalizeText(rawUrl)) {
      return "";
    }
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
    const explicitSourceCandidates = [
      imageElement.getAttribute("src"),
      imageElement.getAttribute("data-src"),
      imageElement.getAttribute("data-image-url"),
      imageElement.getAttribute("srcset"),
      ...pictureSources.map((source) => source.getAttribute("srcset")),
    ].filter((value) => normalizeText(value));
    const candidate = [
      explicitSourceCandidates.length > 0 ||
      normalizeText(imageElement.currentSrc) !== location.href
        ? imageElement.currentSrc
        : "",
      ...explicitSourceCandidates,
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

  function registerImageUrl(state, rawUrl, altText, suggestedFileName) {
    const normalizedUrl = normalizeImageUrl(rawUrl);
    if (!normalizedUrl) {
      return "";
    }

    if (!state.imageUrls.has(normalizedUrl)) {
      state.imageUrls.add(normalizedUrl);
      state.images.push({
        url: normalizedUrl,
        alt: normalizeText(altText) || undefined,
        suggested_file_name:
          normalizeText(suggestedFileName) ||
          resolveSuggestedImageName(normalizedUrl, state.images.length),
      });
    }

    const markdownAltText = normalizeText(altText) || "插图";
    return `![${escapeMarkdownText(markdownAltText)}](${normalizedUrl})`;
  }

  function registerImage(state, imageElement) {
    const rawUrl = resolveImageSource(imageElement);
    return registerImageUrl(
      state,
      rawUrl,
      imageElement.getAttribute("alt"),
      undefined,
    );
  }

  function extractBackgroundImageUrl(value) {
    const matches = Array.from(
      String(value || "").matchAll(/url\((['"]?)(.*?)\1\)/g),
    );
    for (const match of matches) {
      const candidate = normalizeImageUrl(match[2]);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  function resolveBackgroundImageSource(element) {
    const inlineStyle = element.getAttribute("style") || "";
    const inlineUrl = extractBackgroundImageUrl(inlineStyle);
    if (inlineUrl) {
      return inlineUrl;
    }

    if (typeof getComputedStyle === "function") {
      const computedUrl = extractBackgroundImageUrl(
        getComputedStyle(element).backgroundImage,
      );
      if (computedUrl) {
        return computedUrl;
      }
    }

    return "";
  }

  function resolveElementAltText(element) {
    return (
      normalizeText(element.getAttribute("aria-label")) ||
      normalizeText(element.getAttribute("title")) ||
      normalizeText(element.getAttribute("data-alt")) ||
      normalizeText(element.getAttribute("alt")) ||
      ""
    );
  }

  function resolveElementDimension(element, property) {
    const rect =
      typeof element.getBoundingClientRect === "function"
        ? element.getBoundingClientRect()
        : null;
    const rectValue = property === "width" ? rect?.width : rect?.height;
    if (Number.isFinite(rectValue) && rectValue > 0) {
      return rectValue;
    }

    const attributeValue = Number(element.getAttribute(property));
    if (Number.isFinite(attributeValue) && attributeValue > 0) {
      return attributeValue;
    }

    const styleValue = Number.parseFloat(
      property === "width" ? element.style?.width : element.style?.height,
    );
    if (Number.isFinite(styleValue) && styleValue > 0) {
      return styleValue;
    }

    return 0;
  }

  function isLikelyContentImageElement(element) {
    const width = resolveElementDimension(element, "width");
    const height = resolveElementDimension(element, "height");
    if (width === 0 && height === 0) {
      return true;
    }
    return width >= 48 && height >= 48;
  }

  function registerBackgroundImage(state, element) {
    const rawUrl = resolveBackgroundImageSource(element);
    if (!rawUrl || !isLikelyContentImageElement(element)) {
      return "";
    }

    return registerImageUrl(
      state,
      rawUrl,
      resolveElementAltText(element),
      undefined,
    );
  }

  function collectImageMarkdown(element, state) {
    const markdown = [];
    const seenUrls = new Set();

    const pushMarkdown = (value) => {
      if (!value) {
        return;
      }
      const urlMatch = value.match(/\]\((.+)\)$/);
      const dedupeKey = urlMatch?.[1] || value;
      if (seenUrls.has(dedupeKey)) {
        return;
      }
      seenUrls.add(dedupeKey);
      markdown.push(value);
    };

    if (element.tagName === "IMG") {
      pushMarkdown(registerImage(state, element));
    }

    Array.from(element.querySelectorAll("img")).forEach((image) => {
      pushMarkdown(registerImage(state, image));
    });

    const backgroundCandidates = [
      element,
      ...Array.from(
        element.querySelectorAll("[role='img'], [style*='background-image']"),
      ),
    ];
    backgroundCandidates.forEach((candidate) => {
      pushMarkdown(registerBackgroundImage(state, candidate));
    });

    return markdown;
  }

  function hasNestedSerializableContent(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return Boolean(
      element.querySelector(
        [
          "img",
          "[role='img']",
          "[style*='background-image']",
          "pre",
          "[data-language]",
          "[data-testid*='code']",
          "[data-testid*='Code']",
          ".prism-code",
          "[class*='syntax-highlighter']",
          "[class*='code-block']",
          "[class*='CodeBlock']",
          "[class*='language-']",
        ].join(", "),
      ),
    );
  }

  function shouldIgnoreElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (
      element.matches?.(ARTICLE_CONTENT_SELECTOR) ||
      element.matches?.(IMAGE_SELECTOR) ||
      element.matches?.(IMAGE_BLOCK_SELECTOR) ||
      element.matches?.(CODE_BLOCK_SELECTOR) ||
      element.tagName === "IMG" ||
      hasNestedSerializableContent(element)
    ) {
      return false;
    }

    return element.matches(IGNORED_BLOCK_SELECTOR);
  }

  function countCodeLikeLines(lines) {
    return lines.filter((line) =>
      /^\s*(#\s*[\w./-]+|---$|name:|description:|metadata:|Step \d+:|class |def |function |const |let |var |async |await |if |for |while |return |import |from |export |\{|\}|\[|\]|<\/?[a-z])/i.test(
        line,
      ),
    ).length;
  }

  function looksLikeCodeBlock(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (element.matches(CODE_BLOCK_SELECTOR)) {
      return true;
    }

    const dataTestId = normalizeText(element.getAttribute("data-testid"));
    if (/code|syntax|prism/i.test(dataTestId)) {
      return true;
    }

    const className =
      typeof element.className === "string"
        ? element.className
        : element.getAttribute("class") || "";
    if (/prism|syntax-highlighter|code-block|CodeBlock|highlight/i.test(className)) {
      return true;
    }

    if (element.querySelector("pre, code, [data-language], [class*='language-']")) {
      return true;
    }

    const rawText = normalizeCodeText(element.innerText || element.textContent || "");
    if (!rawText) {
      return false;
    }

    const lines = rawText.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length < 3) {
      return false;
    }

    const codeLikeLines = countCodeLikeLines(lines);
    const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
    const fontFamily = normalizeText(style?.fontFamily);
    const whiteSpace = normalizeText(style?.whiteSpace);
    const looksMonospace = /mono|courier|menlo|monaco|consolas/i.test(fontFamily);
    const preservesWhitespace = /pre|break-spaces/i.test(whiteSpace);

    return preservesWhitespace || looksMonospace || codeLikeLines >= 2;
  }

  function serializeCodeBlock(element) {
    const codeText = normalizeCodeText(element.innerText || element.textContent || "");
    if (!codeText) {
      return [];
    }
    const language = resolveCodeLanguage(element);
    return [`\`\`\`${language}\n${codeText}\n\`\`\``];
  }

  function isSerializableArticleSegment(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (shouldIgnoreElement(element) || element.matches?.(ARTICLE_TITLE_SELECTOR)) {
      return false;
    }

    return (
      element.matches?.(ARTICLE_CONTENT_SELECTOR) ||
      element.matches?.(IMAGE_SELECTOR) ||
      element.matches?.(IMAGE_BLOCK_SELECTOR) ||
      looksLikeCodeBlock(element)
    );
  }

  function collectArticleSegments(articleRoot, preferredRoot) {
    const preferredRoots = [
      ...(preferredRoot ? [preferredRoot] : []),
      ...Array.from(articleRoot.querySelectorAll(ARTICLE_CONTENT_SELECTOR)).filter(
        (element) => element !== preferredRoot,
      ),
    ];
    const rawCandidates = Array.from(articleRoot.querySelectorAll("*")).filter(
      (element) =>
        isSerializableArticleSegment(element) &&
        !preferredRoots.includes(element),
    );
    const orderedCandidates = [...preferredRoots, ...rawCandidates];
    const segments = [];

    for (const candidate of orderedCandidates) {
      if (
        segments.some(
          (existing) =>
            existing === candidate ||
            existing.contains(candidate) ||
            candidate.contains(existing),
        )
      ) {
        continue;
      }
      segments.push(candidate);
    }

    return segments.length > 0 ? segments : [preferredRoot || articleRoot];
  }

  function resolveArticleContentRoot(articleRoot) {
    for (const selector of ARTICLE_CONTENT_SELECTORS) {
      const matched = articleRoot.querySelector(selector);
      if (matched) {
        return matched;
      }
    }
    return null;
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

    if (element.matches?.(IMAGE_BLOCK_SELECTOR)) {
      return collectImageMarkdown(element, state).join("\n\n");
    }

    if (
      !hasMeaningfulText(element) &&
      element.querySelector?.("img, [role='img'], [style*='background-image']")
    ) {
      return collectImageMarkdown(element, state).join("\n\n");
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

  function hasRenderableMedia(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return (
      element.matches?.(IMAGE_SELECTOR) ||
      element.matches?.(IMAGE_BLOCK_SELECTOR) ||
      element.tagName === "IMG" ||
      Boolean(
        element.querySelector("img, [role='img'], [style*='background-image']"),
      )
    );
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

    if (shouldIgnoreElement(element)) {
      return [];
    }

    if (looksLikeCodeBlock(element)) {
      return serializeCodeBlock(element);
    }

    if (element.matches(IMAGE_SELECTOR) || element.matches(IMAGE_BLOCK_SELECTOR)) {
      return collectImageMarkdown(element, state);
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
      if (child.matches(IMAGE_SELECTOR) || child.matches(IMAGE_BLOCK_SELECTOR)) {
        return true;
      }
      if (child.matches("ul,ol,blockquote,h1,h2,h3,h4,h5,h6,hr")) {
        return true;
      }
      if (looksLikeCodeBlock(child)) {
        return true;
      }
      return child.children.length > 0 && !["A", "SPAN", "EM", "STRONG", "I", "B", "CODE"].includes(child.tagName);
    });

    if (directBlockChildren.length > 0 && !element.matches("p,li")) {
      return directBlockChildren.flatMap((child) => serializeBlock(child, state));
    }

    if (!hasMeaningfulText(element) && !hasRenderableMedia(element)) {
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

  function serializeArticleSegments(segments, state) {
    const blocks = segments
      .flatMap((segment) => {
        if (segment.matches?.(ARTICLE_CONTENT_SELECTOR)) {
          const serialized = serializeArticle(segment, state);
          return serialized ? [serialized] : [];
        }
        return serializeBlock(segment, state);
      })
      .map((block) => normalizeMultilineText(block))
      .filter(Boolean);

    return blocks.join("\n\n");
  }

  function collectPotentialCodeBlockElements(root) {
    const resolveNodeDepth = (element) => {
      let depth = 0;
      let current = element.parentElement;
      while (current) {
        depth += 1;
        current = current.parentElement;
      }
      return depth;
    };
    const candidates = Array.from(root.querySelectorAll("*"))
      .filter((element) => !shouldIgnoreElement(element) && looksLikeCodeBlock(element))
      .sort((left, right) => {
        const leftDepth = resolveNodeDepth(left);
        const rightDepth = resolveNodeDepth(right);
        return rightDepth - leftDepth;
      });
    const uniqueCandidates = [];

    for (const candidate of candidates) {
      if (
        uniqueCandidates.some(
          (existing) =>
            existing === candidate ||
            existing.contains(candidate) ||
            candidate.contains(existing),
        )
      ) {
        continue;
      }
      uniqueCandidates.push(candidate);
    }

    return uniqueCandidates;
  }

  function collectFallbackCodeBlocks(root) {
    const uniqueCandidates = collectPotentialCodeBlockElements(root);
    return uniqueCandidates.flatMap((candidate) => serializeCodeBlock(candidate));
  }

  function extractArticleMarkdown(articleRoot, richTextRoot) {
    const state = createState();
    const articleSegments = collectArticleSegments(articleRoot, richTextRoot);
    const fallbackCodeBlocks = collectFallbackCodeBlocks(articleRoot);
    const potentialMediaCarriers = collectPotentialMediaCarriers(articleRoot);
    let markdown = serializeArticleSegments(articleSegments, state);
    markdown = appendMissingBlocks(markdown, fallbackCodeBlocks);
    markdown = appendMissingBlocks(markdown, collectImageMarkdown(articleRoot, state));

    return {
      state,
      fallbackCodeBlocks,
      potentialMediaCarriers,
      markdown,
    };
  }

  function shouldAttemptStructuredContentRecovery(articleRoot, extraction) {
    if (!extraction?.markdown) {
      return false;
    }

    if (extraction.state.images.length > 0) {
      return false;
    }

    if (extraction.fallbackCodeBlocks.length > 0) {
      return false;
    }

    if (countExtractedCodeBlocks(extraction.markdown) > 0) {
      return false;
    }

    const snapshot = buildWarmupSnapshot(articleRoot);
    return snapshot.textLength >= 1800 && snapshot.articleBlocks >= 1;
  }

  function safeWindowScrollTo(x, y) {
    if (typeof window?.scrollTo !== "function") {
      return false;
    }

    const userAgent = String(globalThis?.navigator?.userAgent || "").toLowerCase();
    if (userAgent.includes("jsdom")) {
      return false;
    }

    try {
      window.scrollTo(x, y);
      return true;
    } catch {
      return false;
    }
  }

  async function attemptStructuredContentRecovery(articleRoot) {
    if (!(articleRoot instanceof Element)) {
      return;
    }

    const initialScrollY = Number.isFinite(window?.scrollY)
      ? Math.round(window.scrollY)
      : 0;
    if (safeWindowScrollTo(0, 0)) {
      await helpers.sleep?.(80);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await helpers.waitForDomStable?.({
        root: articleRoot,
        stableMs: 650,
        timeoutMs: 4200,
      });
      await helpers.scrollUntilSettled?.({
        root: articleRoot,
        maxScrolls: 18,
        delayMs: 420,
        settleRounds: 1,
        viewportFactor: 0.95,
        getSnapshot: () => buildWarmupSnapshot(articleRoot),
      });
      await helpers.waitForDomStable?.({
        root: articleRoot,
        stableMs: 700,
        timeoutMs: 4600,
      });
      await helpers.waitForImagesReady?.(articleRoot, {
        timeoutMs: 4200,
        intervalMs: 250,
        stableRounds: 3,
      });

      const snapshot = buildWarmupSnapshot(articleRoot);
      if (snapshot.mediaCarriers > 0 || snapshot.codeBlocks > 0) {
        break;
      }
    }

    const currentScrollY = Number.isFinite(window?.scrollY)
      ? Math.round(window.scrollY)
      : initialScrollY;
    if (currentScrollY !== initialScrollY && safeWindowScrollTo(0, initialScrollY)) {
      await helpers.sleep?.(80);
    }
  }

  function collectPotentialMediaCarriers(root) {
    if (!(root instanceof Element)) {
      return [];
    }

    const carriers = [];
    const seen = new Set();
    const push = (element) => {
      if (!(element instanceof Element) || seen.has(element)) {
        return;
      }
      if (shouldIgnoreElement(element)) {
        return;
      }
      seen.add(element);
      carriers.push(element);
    };

    if (
      root.matches?.(IMAGE_SELECTOR) ||
      root.matches?.(IMAGE_BLOCK_SELECTOR) ||
      root.tagName === "IMG"
    ) {
      push(root);
    }

    Array.from(
      root.querySelectorAll("img, [data-testid='tweetPhoto'], figure, [role='img'], [style*='background-image']"),
    ).forEach((element) => push(element));

    return carriers;
  }

  function appendMissingBlocks(markdown, blocks) {
    const normalizedMarkdown = normalizeMultilineText(markdown);
    const appendedBlocks = [];
    const appendedSet = new Set();

    blocks.forEach((block) => {
      const normalizedBlock = normalizeMultilineText(block);
      if (!normalizedBlock) {
        return;
      }
      if (
        normalizedMarkdown.includes(normalizedBlock) ||
        appendedSet.has(normalizedBlock)
      ) {
        return;
      }
      appendedSet.add(normalizedBlock);
      appendedBlocks.push(normalizedBlock);
    });

    if (appendedBlocks.length === 0) {
      return normalizedMarkdown;
    }

    return [normalizedMarkdown, ...appendedBlocks].filter(Boolean).join("\n\n");
  }

  function countExtractedCodeBlocks(markdown) {
    return Array.from(String(markdown || "").matchAll(/^```/gm)).length;
  }

  function buildWarmupSnapshot(articleRoot) {
    return {
      articleBlocks: articleRoot.querySelectorAll(ARTICLE_CONTENT_SELECTOR).length,
      codeBlocks: collectPotentialCodeBlockElements(articleRoot).length,
      mediaCarriers: collectPotentialMediaCarriers(articleRoot).length,
      textLength: normalizeText(articleRoot.textContent || "").length,
    };
  }

  async function warmupArticleContent(articleRoot) {
    if (!(articleRoot instanceof Element)) {
      return;
    }

    const initialScrollY = Math.round(window.scrollY);
    await helpers.waitForDomStable?.({
      root: articleRoot,
      stableMs: 400,
      timeoutMs: 2500,
    });
    await helpers.scrollUntilSettled?.({
      root: articleRoot,
      maxScrolls: 12,
      delayMs: 350,
      settleRounds: 2,
      getSnapshot: () => buildWarmupSnapshot(articleRoot),
    });
    await helpers.waitForDomStable?.({
      root: articleRoot,
      stableMs: 500,
      timeoutMs: 3000,
    });
    await helpers.waitForImagesReady?.(articleRoot, {
      timeoutMs: 3200,
      intervalMs: 200,
      stableRounds: 2,
    });

    if (Math.round(window.scrollY) !== initialScrollY) {
      window.scrollTo(0, initialScrollY);
      await helpers.sleep?.(80);
    }
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

  await warmupArticleContent(articleRoot);

  const title =
    normalizeText(articleRoot.querySelector(ARTICLE_TITLE_SELECTOR)?.textContent) ||
    normalizeText(document.title.replace(/\s+on X.*$/i, ""));
  const richTextRoot = await helpers.waitFor(
    () => resolveArticleContentRoot(articleRoot),
    5000,
    250,
  );
  if (!richTextRoot) {
    return {
      ok: false,
      error_code: helpers.looksLikeLoginWall() ? "auth_required" : "adapter_runtime_error",
      error_message: "未找到 X 长文正文区域。",
    };
  }

  let extraction = extractArticleMarkdown(articleRoot, richTextRoot);
  if (shouldAttemptStructuredContentRecovery(articleRoot, extraction)) {
    await attemptStructuredContentRecovery(articleRoot);
    const recoveredExtraction = extractArticleMarkdown(articleRoot, richTextRoot);
    const improved =
      recoveredExtraction.state.images.length > extraction.state.images.length ||
      recoveredExtraction.fallbackCodeBlocks.length >
        extraction.fallbackCodeBlocks.length ||
      countExtractedCodeBlocks(recoveredExtraction.markdown) >
        countExtractedCodeBlocks(extraction.markdown);
    if (improved) {
      extraction = recoveredExtraction;
    }
  }

  const state = extraction.state;
  const fallbackCodeBlocks = extraction.fallbackCodeBlocks;
  const potentialMediaCarriers = extraction.potentialMediaCarriers;
  let markdown = extraction.markdown;
  if (!markdown) {
    return {
      ok: false,
      error_code: helpers.looksLikeLoginWall() ? "auth_required" : "adapter_runtime_error",
      error_message: "正文为空，无法导出 Markdown。",
    };
  }

  if (potentialMediaCarriers.length > 0 && state.images.length === 0) {
    return {
      ok: false,
      error_code: "adapter_runtime_error",
      error_message: "X 长文中的图片资源尚未完全加载，请稍后重试导出。",
    };
  }

  if (fallbackCodeBlocks.length > 0 && countExtractedCodeBlocks(markdown) === 0) {
    return {
      ok: false,
      error_code: "adapter_runtime_error",
      error_message: "X 长文中的代码示例尚未完全加载，请稍后重试导出。",
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
