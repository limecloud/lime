// 由 scripts/generate-extension-site-adapter-runners.mjs 自动生成，请勿手改。
(function () {
  const generatedSiteAdapterRunners = {
    "36kr/newsflash": (async (args, helpers) => {
  const limit = helpers.number(args.limit, 10);
  await helpers.waitFor(
    () => document.querySelectorAll('a[href*="/p/"]').length > 0,
    12000,
    300,
  );
  const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
  const items = helpers.take(
    helpers.uniqueBy(
      links
        .map((anchor) => {
          const card = anchor.closest("div, article");
          return {
            title: helpers.text(anchor),
            url: helpers.absoluteUrl(anchor.getAttribute("href") || ""),
            summary: helpers.text(card?.querySelector("p")),
          };
        })
        .filter((item) => item.title && item.url),
      (item) => item.url,
    ),
    limit,
  );

  return {
    ok: true,
    data: {
      items,
      count: items.length,
    },
    source_url: location.href,
  };
}),

    "bilibili/search": (async (args, helpers) => {
  const query = String(args.query || "").trim();
  const limit = helpers.number(args.limit, 10);
  await helpers.waitFor(
    () =>
      document.querySelectorAll(
        'a[href*="/video/BV"], a[href*="//www.bilibili.com/video/"]',
      ).length > 0,
    12000,
    300,
  );
  const links = Array.from(
    document.querySelectorAll(
      'a[href*="/video/BV"], a[href*="//www.bilibili.com/video/"]',
    ),
  );
  const items = helpers.take(
    helpers.uniqueBy(
      links
        .map((anchor) => {
          const card = anchor.closest("div");
          return {
            title: helpers.text(anchor),
            url: helpers.absoluteUrl(anchor.getAttribute("href") || ""),
            author: helpers.text(
              card?.querySelector(
                ".bili-video-card__info--author, .up-name, .bili-video-card__info--bottom .bili-video-card__info--author",
              ),
            ),
            summary: helpers.text(
              card?.querySelector(
                ".bili-video-card__info--desc, .des, .bili-video-card__info--title",
              ),
            ),
          };
        })
        .filter((item) => item.title && item.url),
      (item) => item.url,
    ),
    limit,
  );

  if (items.length === 0 && helpers.looksLikeLoginWall()) {
    return {
      ok: false,
      error_code: "auth_required",
      error_message: `B 站没有返回 "${query}" 的搜索结果，可能需要先登录。`,
    };
  }

  return {
    ok: true,
    data: {
      query,
      items,
      count: items.length,
    },
    source_url: location.href,
  };
}),

    "github/issues": (async (args, helpers) => {
  const repo = String(args.repo || "").trim();
  const limit = helpers.number(args.limit, 10);
  await helpers.waitFor(
    () =>
      document.querySelectorAll(
        'a[data-hovercard-type="issue"], a[id^="issue_"]',
      ).length > 0,
    12000,
    300,
  );
  const links = Array.from(
    document.querySelectorAll(
      'a[data-hovercard-type="issue"], a[id^="issue_"]',
    ),
  );
  const items = helpers.take(
    helpers.uniqueBy(
      links
        .map((anchor) => {
          const row = anchor.closest("div, li");
          return {
            title: helpers.text(anchor),
            url: helpers.absoluteUrl(anchor.getAttribute("href") || ""),
            status: helpers.text(
              row?.querySelector(
                '[aria-label*="Open"], [aria-label*="Closed"], .State',
              ),
            ),
            summary: helpers.text(
              row?.querySelector("span.color-fg-muted, .markdown-title + div"),
            ),
          };
        })
        .filter((item) => item.title && item.url),
      (item) => item.url,
    ),
    limit,
  );

  if (items.length === 0 && helpers.looksLikeLoginWall()) {
    return {
      ok: false,
      error_code: "auth_required",
      error_message: `GitHub 仓库 ${repo} 的 issue 列表为空，可能需要登录后访问。`,
    };
  }

  return {
    ok: true,
    data: {
      repo,
      items,
      count: items.length,
    },
    source_url: location.href,
  };
}),

    "github/search": (async (args, helpers) => {
  const query = String(args.query || "").trim();
  const limit = helpers.number(args.limit, 10);
  await helpers.waitFor(
    () => document.querySelectorAll("a.v-align-middle").length > 0,
    12000,
    300,
  );
  const links = Array.from(document.querySelectorAll("a.v-align-middle"));
  const items = helpers.take(
    helpers.uniqueBy(
      links
        .map((anchor) => {
          const card = anchor.closest("li, div.search-title, div.Box-row");
          return {
            title: helpers.text(anchor),
            url: helpers.absoluteUrl(anchor.getAttribute("href") || ""),
            summary: helpers.text(card?.querySelector("p")),
          };
        })
        .filter((item) => item.title && item.url),
      (item) => item.url,
    ),
    limit,
  );

  if (items.length === 0 && helpers.looksLikeLoginWall()) {
    return {
      ok: false,
      error_code: "auth_required",
      error_message: "GitHub 搜索结果为空，可能需要先登录后再访问。",
    };
  }

  return {
    ok: true,
    data: {
      query,
      items,
      count: items.length,
    },
    source_url: location.href,
  };
}),

    "linux-do/categories": (async (args, helpers) => {
  const limit = helpers.number(args.limit, 10);

  try {
    const response = await fetch("/categories.json", { credentials: "include" });
    if (!response.ok) {
      return {
        ok: false,
        error_code: "auth_required",
        error_message: "linux.do 分类列表暂不可用，可能需要先登录。",
      };
    }
    const payload = await response.json();
    const categories = Array.isArray(payload?.category_list?.categories)
      ? payload.category_list.categories
      : [];

    const items = helpers.take(
      categories.map((category) => ({
        name: String(category?.name || "").trim(),
        slug: String(category?.slug || "").trim(),
        id: category?.id ?? null,
        topics: category?.topic_count ?? 0,
        description: String(category?.description_text || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80),
      })),
      limit,
    ).filter((item) => item.name);

    return {
      ok: true,
      data: {
        items,
        count: items.length,
      },
      source_url: location.href,
    };
  } catch (error) {
    return {
      ok: false,
      error_code: "runtime_error",
      error_message:
        error instanceof Error ? error.message : "读取 linux.do 分类列表失败。",
    };
  }
}),

    "linux-do/hot": (async (args, helpers) => {
  const limit = helpers.number(args.limit, 10);
  const allowedPeriods = new Set(["all", "daily", "weekly", "monthly", "yearly"]);
  const period = String(args.period || "weekly").trim().toLowerCase();
  const normalizedPeriod = allowedPeriods.has(period) ? period : "weekly";

  try {
    const response = await fetch(
      "/top.json?period=" + encodeURIComponent(normalizedPeriod),
      { credentials: "include" },
    );
    if (!response.ok) {
      return {
        ok: false,
        error_code: "auth_required",
        error_message: "linux.do 热门话题暂不可用，可能需要先登录。",
      };
    }
    const payload = await response.json();
    const topics = Array.isArray(payload?.topic_list?.topics)
      ? payload.topic_list.topics
      : [];
    const categories = Array.isArray(payload?.topic_list?.categories)
      ? payload.topic_list.categories
      : Array.isArray(payload?.categories)
        ? payload.categories
        : [];
    const categoryMap = new Map(
      categories.map((category) => [category?.id, String(category?.name || "").trim()]),
    );

    const items = helpers.take(
      topics.map((topic, index) => ({
        rank: index + 1,
        title: String(topic?.title || "").trim(),
        replies: Math.max(0, Number(topic?.posts_count || 1) - 1),
        views: Number(topic?.views || 0),
        likes: Number(topic?.like_count || 0),
        category:
          categoryMap.get(topic?.category_id) ||
          String(topic?.category_id || "").trim(),
      })),
      limit,
    ).filter((item) => item.title);

    return {
      ok: true,
      data: {
        period: normalizedPeriod,
        items,
        count: items.length,
      },
      source_url: location.href,
    };
  } catch (error) {
    return {
      ok: false,
      error_code: "runtime_error",
      error_message:
        error instanceof Error ? error.message : "读取 linux.do 热门话题失败。",
    };
  }
}),

    "smzdm/search": (async (args, helpers) => {
  const query = String(args.query || "").trim();
  const limit = helpers.number(args.limit, 10);
  const rowSelector = "li.feed-row-wide";

  await helpers.waitFor(
    () =>
      document.querySelectorAll(rowSelector).length > 0 ||
      /搜索结果|相关好价|什么值得买/i.test(document.body?.textContent || ""),
    12000,
    300,
  );

  const rows = Array.from(document.querySelectorAll(rowSelector));
  const items = helpers.take(
    helpers.uniqueBy(
      rows
        .map((row, index) => {
          const titleAnchor =
            row.querySelector("h5.feed-block-title > a") || row.querySelector("h5 > a");
          const rawHref =
            titleAnchor?.getAttribute("href") || titleAnchor?.href || "";
          const url = helpers.absoluteUrl(rawHref);
          const title = (
            titleAnchor?.getAttribute("title") || helpers.text(titleAnchor)
          ).trim();
          const price = helpers.text(row.querySelector(".z-highlight"));
          const mall = helpers.text(
            row.querySelector(".z-feed-foot-r .feed-block-extras span") ||
              row.querySelector(".z-feed-foot-r span"),
          );
          const commentsText = helpers.text(
            row.querySelector(".feed-btn-comment"),
          ).replace(/[^\d]/g, "");
          return {
            rank: index + 1,
            title,
            url,
            price,
            mall,
            comments: commentsText ? Number(commentsText) : 0,
          };
        })
        .filter((item) => item.title && item.url),
      (item) => item.url,
    ),
    limit,
  );

  return {
    ok: true,
    data: {
      query,
      items,
      count: items.length,
    },
    source_url: location.href,
  };
}),

    "yahoo-finance/quote": (async (args, helpers) => {
  const symbol = String(args.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return {
      ok: false,
      error_code: "invalid_args",
      error_message: "symbol 不能为空。",
    };
  }

  const normalizeText = (value) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text || null;
  };
  const normalizeNumber = (value) => {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    const text = String(value).replace(/,/g, "").replace(/%/g, "").trim();
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  };
  const buildResult = (item) => ({
    ok: true,
    data: {
      symbol,
      items: [item],
      count: 1,
    },
    source_url: location.href,
  });

  try {
    const chartUrl =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?interval=1d&range=1d";
    const response = await fetch(chartUrl, { credentials: "include" });
    if (response.ok) {
      const payload = await response.json();
      const chart = payload?.chart?.result?.[0];
      if (chart) {
        const meta = chart.meta || {};
        const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
        const price = meta.regularMarketPrice ?? null;
        const change =
          price != null && previousClose != null ? price - previousClose : null;
        const changePercent =
          change != null && previousClose
            ? Number(((change / previousClose) * 100).toFixed(2))
            : null;
        return buildResult({
          symbol: meta.symbol || symbol,
          name: meta.shortName || meta.longName || symbol,
          price: price != null ? Number(price.toFixed(2)) : null,
          change: change != null ? Number(change.toFixed(2)) : null,
          changePercent,
          open: chart.indicators?.quote?.[0]?.open?.[0] ?? null,
          high: meta.regularMarketDayHigh ?? null,
          low: meta.regularMarketDayLow ?? null,
          volume: meta.regularMarketVolume ?? null,
          marketCap: meta.marketCap ?? null,
        });
      }
    }
  } catch {}

  await helpers.waitFor(
    () =>
      document.querySelector('[data-testid="qsp-price"]') ||
      document.querySelector('fin-streamer[data-field="regularMarketPrice"]') ||
      document.querySelector("h1"),
    12000,
    300,
  );

  const titleText = normalizeText(document.querySelector("h1")?.textContent);
  const item = {
    symbol,
    name: titleText
      ? titleText.replace(/\s*\([^)]+\)\s*$/, "").trim() || symbol
      : symbol,
    price: normalizeNumber(
      document.querySelector('[data-testid="qsp-price"]')?.textContent ||
        document.querySelector('fin-streamer[data-field="regularMarketPrice"]')
          ?.textContent,
    ),
    change: normalizeNumber(
      document.querySelector('[data-testid="qsp-price-change"]')?.textContent ||
        document.querySelector('fin-streamer[data-field="regularMarketChange"]')
          ?.textContent,
    ),
    changePercent: normalizeNumber(
      document.querySelector('[data-testid="qsp-price-change-percent"]')
        ?.textContent ||
        document.querySelector(
          'fin-streamer[data-field="regularMarketChangePercent"]',
        )?.textContent,
    ),
    open: normalizeNumber(
      document.querySelector('[data-test="OPEN-value"]')?.textContent,
    ),
    high: normalizeNumber(
      document.querySelector('[data-test="DAYS_RANGE-value"]')
        ?.textContent?.split(" - ")
        ?.at(1),
    ),
    low: normalizeNumber(
      document.querySelector('[data-test="DAYS_RANGE-value"]')
        ?.textContent?.split(" - ")
        ?.at(0),
    ),
    volume: normalizeNumber(
      document.querySelector('[data-test="TD_VOLUME-value"]')?.textContent,
    ),
    marketCap: normalizeText(
      document.querySelector('[data-test="MARKET_CAP-value"]')?.textContent,
    ),
  };

  if (item.price != null || item.name !== symbol) {
    return buildResult(item);
  }

  return {
    ok: true,
    data: {
      symbol,
      items: [],
      count: 0,
    },
    source_url: location.href,
  };
}),

    "x/article-export": (async (args, helpers) => {
  const ARTICLE_ROOT_SELECTOR = '[data-testid="twitterArticleReadView"]';
  const ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]';
  const ARTICLE_CONTENT_SELECTOR =
    '[data-testid="longformRichTextComponent"] [data-contents="true"], [data-testid="longformRichTextComponent"]';
  const IMAGE_SELECTOR = '[data-testid="tweetPhoto"] img';
  const CODE_BLOCK_SELECTOR = '[data-testid="markdown-code-block"]';

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
    const rawUrl =
      imageElement.getAttribute("src") ||
      imageElement.getAttribute("data-src") ||
      "";
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
}),

    "zhihu/hot": (async (args, helpers) => {
  const limit = helpers.number(args.limit, 10);
  const hrefTokens = ["/question/"];
  const maxCandidates = Math.max(limit * 6, 30);
  const main = document.querySelector("main") || document.body;
  const collectCandidates = (maxCount) => {
    if (!main) {
      return [];
    }
    const results = [];
    const seen = new Set();
    for (const anchor of main.getElementsByTagName("a")) {
      const href = anchor.getAttribute("href") || "";
      if (!hrefTokens.some((token) => href.includes(token))) {
        continue;
      }
      const title = helpers.text(anchor);
      const url = helpers.absoluteUrl(href);
      if (!title || !url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      results.push({ anchor, title, url });
      if (results.length >= maxCount) {
        break;
      }
    }
    return results;
  };
  await helpers.waitFor(() => collectCandidates(1)[0], 12000, 300);
  const items = helpers.take(
    collectCandidates(maxCandidates)
      .map(({ anchor, title, url }, index) => {
        const card = anchor.closest("section, div");
        return {
          rank: index + 1,
          title,
          url,
          summary: helpers.text(card?.querySelector("p")),
        };
      })
      .filter((item) => item.title && item.url),
    limit,
  );

  if (items.length === 0 && helpers.looksLikeLoginWall()) {
    return {
      ok: false,
      error_code: "auth_required",
      error_message: "当前页面没有返回知乎热榜内容，可能需要先登录知乎。",
    };
  }

  return {
    ok: true,
    data: {
      items,
      count: items.length,
    },
    source_url: location.href,
  };
}),

    "zhihu/search": (async (args, helpers) => {
  const query = String(args.query || "").trim();
  const limit = helpers.number(args.limit, 10);
  const hrefTokens = ["/question/", "/answer/", "/zvideo/"];
  const maxCandidates = Math.max(limit * 8, 40);
  const main = document.querySelector("main") || document.body;
  const collectCandidates = (maxCount) => {
    if (!main) {
      return [];
    }
    const results = [];
    const seen = new Set();
    for (const anchor of main.getElementsByTagName("a")) {
      const href = anchor.getAttribute("href") || "";
      if (!hrefTokens.some((token) => href.includes(token))) {
        continue;
      }
      const title = helpers.text(anchor);
      const url = helpers.absoluteUrl(href);
      if (!title || !url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      results.push({ anchor, title, url });
      if (results.length >= maxCount) {
        break;
      }
    }
    return results;
  };
  await helpers.waitFor(() => collectCandidates(1)[0], 12000, 300);
  const items = helpers.take(
    collectCandidates(maxCandidates)
      .map(({ anchor, title, url }) => {
        const card = anchor.closest("div");
        return {
          title,
          url,
          summary: helpers.text(card?.querySelector("p")),
        };
      })
      .filter((item) => item.title && item.url),
    limit,
  );

  if (items.length === 0 && helpers.looksLikeLoginWall()) {
    return {
      ok: false,
      error_code: "auth_required",
      error_message: `知乎没有返回 "${query}" 的搜索结果，可能需要先登录。`,
    };
  }

  return {
    ok: true,
    data: {
      query,
      items,
      count: items.length,
    },
    source_url: location.href,
  };
})
  };

  const existingSiteAdapterRunners =
    window.__LIME_SITE_ADAPTER_RUNNERS__ &&
    typeof window.__LIME_SITE_ADAPTER_RUNNERS__ === "object" &&
    !Array.isArray(window.__LIME_SITE_ADAPTER_RUNNERS__)
      ? window.__LIME_SITE_ADAPTER_RUNNERS__
      : {};

  window.__LIME_SITE_ADAPTER_RUNNERS__ = {
    ...generatedSiteAdapterRunners,
    ...existingSiteAdapterRunners,
  };
})();
