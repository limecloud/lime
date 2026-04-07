// 使用 IIFE 避免重复注入时的变量冲突
(function () {
  // 检查是否已经注入过
  if (
    window.__LIME_CONTENT_SCRIPT_LOADED__ ||
    window.__PROXYCAST_CONTENT_SCRIPT_LOADED__
  ) {
    return;
  }
  window.__LIME_CONTENT_SCRIPT_LOADED__ = true;
  window.__PROXYCAST_CONTENT_SCRIPT_LOADED__ = true;

  let refCounter = 0;
  const REF_ATTR = "lime-id";

  function nextRefId() {
    refCounter += 1;
    return `lime-${refCounter}`;
  }

  function resetRefs() {
    refCounter = 0;
    document.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => {
      el.removeAttribute(REF_ATTR);
    });
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isElementVisible(element) {
    if (!element) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInteractiveElement(element) {
    if (!element || !isElementVisible(element)) {
      return false;
    }

    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    if (
      ["a", "button", "input", "textarea", "select", "option"].includes(tag)
    ) {
      return true;
    }
    if (
      role &&
      [
        "button",
        "link",
        "checkbox",
        "radio",
        "menuitem",
        "tab",
        "switch",
        "option",
        "searchbox",
        "textbox",
        "combobox",
      ].includes(role)
    ) {
      return true;
    }

    if (element.hasAttribute("onclick")) {
      return true;
    }

    const style = window.getComputedStyle(element);
    return style.cursor === "pointer";
  }

  function interactiveLabel(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    const text = normalizeText(
      element.innerText ||
        element.value ||
        element.placeholder ||
        element.getAttribute("aria-label") ||
        element.title ||
        element.name ||
        element.id,
    );

    if (tag === "a") {
      return `链接: ${text || "无标题链接"}`;
    }
    if (tag === "button" || role === "button") {
      return `按钮: ${text || "无标题按钮"}`;
    }
    if (tag === "input" || tag === "textarea") {
      return `输入框: ${text || "未命名输入框"}`;
    }
    if (tag === "select") {
      return `下拉框: ${text || "未命名下拉框"}`;
    }
    return `可交互元素: ${text || tag}`;
  }

  function buildMarkdown() {
    resetRefs();

    const lines = [];
    lines.push(`# ${document.title || "Untitled"}`);
    lines.push(`URL: ${window.location.href}`);
    lines.push("");

    const bodyText = normalizeText(
      document.body ? document.body.innerText : "",
    );
    if (bodyText) {
      lines.push("## 页面文本");
      lines.push(bodyText.slice(0, 6000));
      lines.push("");
    }

    lines.push("## 可交互元素");
    const allElements = Array.from(document.querySelectorAll("*")).filter(
      isInteractiveElement,
    );

    for (const element of allElements.slice(0, 300)) {
      const refId = nextRefId();
      element.setAttribute(REF_ATTR, refId);
      lines.push(`- [${interactiveLabel(element)}](${refId})`);
    }

    return lines.join("\n").trim();
  }

  function findElement(target) {
    if (!target || typeof target !== "string") {
      return null;
    }
    const trimmed = target.trim();
    if (!trimmed) {
      return null;
    }

    let element = document.querySelector(
      `[${REF_ATTR}="${CSS.escape(trimmed)}"]`,
    );
    if (element) {
      return element;
    }

    try {
      element = document.querySelector(trimmed);
      if (element) {
        return element;
      }
    } catch (_) {}

    element = Array.from(
      document.querySelectorAll(
        "button,a,input,textarea,select,[role='button']",
      ),
    ).find(
      (candidate) =>
        normalizeText(
          candidate.innerText || candidate.value || candidate.placeholder || "",
        ) === trimmed,
    );
    if (element) {
      return element;
    }

    element = Array.from(document.querySelectorAll("[aria-label]")).find(
      (candidate) =>
        normalizeText(candidate.getAttribute("aria-label")) === trimmed,
    );
    return element || null;
  }

  function scrollPage(text) {
    const input = normalizeText(text);
    let direction = "down";
    let amount = 500;

    if (input.includes(":")) {
      const parts = input.split(":");
      direction = normalizeText(parts[0]) || "down";
      const parsed = Number(parts[1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        amount = parsed;
      }
    }

    if (direction === "up") {
      window.scrollBy(0, -amount);
    } else if (direction === "left") {
      window.scrollBy(-amount, 0);
    } else if (direction === "right") {
      window.scrollBy(amount, 0);
    } else {
      window.scrollBy(0, amount);
    }
  }

  const siteAdapterHelpers = {
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    text(value) {
      return String(value?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
    },
    absoluteUrl(value) {
      try {
        return new URL(value, window.location.href).toString();
      } catch {
        return "";
      }
    },
    uniqueBy(items, getKey) {
      const seen = new Set();
      return items.filter((item) => {
        const key = getKey(item);
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },
    async waitFor(test, timeoutMs = 12000, intervalMs = 250) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const value = await test();
        if (value) {
          return value;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      return null;
    },
    take(items, limit) {
      return items.slice(0, Math.max(1, limit));
    },
    number(value, fallbackValue) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallbackValue;
    },
    looksLikeLoginWall() {
      const text = (document.body?.textContent || "").slice(0, 4000);
      return /(登录|登入|sign in|log in|继续访问|验证你是人类|扫码登录)/i.test(
        text,
      );
    },
  };

  const generatedSiteAdapterRunners =
    window.__LIME_SITE_ADAPTER_RUNNERS__ &&
    typeof window.__LIME_SITE_ADAPTER_RUNNERS__ === "object" &&
    !Array.isArray(window.__LIME_SITE_ADAPTER_RUNNERS__)
      ? window.__LIME_SITE_ADAPTER_RUNNERS__
      : {};

  const legacySiteAdapterRunners = {
    "github/search": async (args, helpers) => {
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
    },
    "github/issues": async (args, helpers) => {
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
                  row?.querySelector(
                    "span.color-fg-muted, .markdown-title + div",
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
    },
    "zhihu/search": async (args, helpers) => {
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
    },
    "zhihu/hot": async (args, helpers) => {
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
    },
    "bilibili/search": async (args, helpers) => {
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
    },
    "36kr/newsflash": async (args, helpers) => {
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
    },
    "linux-do/hot": async (args, helpers) => {
      const limit = helpers.number(args.limit, 10);
      const allowedPeriods = new Set([
        "all",
        "daily",
        "weekly",
        "monthly",
        "yearly",
      ]);
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
          categories.map((category) => [
            category?.id,
            String(category?.name || "").trim(),
          ]),
        );

        const items = helpers
          .take(
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
          )
          .filter((item) => item.title);

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
            error instanceof Error
              ? error.message
              : "读取 linux.do 热门话题失败。",
        };
      }
    },
    "linux-do/categories": async (args, helpers) => {
      const limit = helpers.number(args.limit, 10);

      try {
        const response = await fetch("/categories.json", {
          credentials: "include",
        });
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

        const items = helpers
          .take(
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
          )
          .filter((item) => item.name);

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
            error instanceof Error
              ? error.message
              : "读取 linux.do 分类列表失败。",
        };
      }
    },
    "smzdm/search": async (args, helpers) => {
      const query = String(args.query || "").trim();
      const limit = helpers.number(args.limit, 10);
      const rowSelector = "li.feed-row-wide";

      await helpers.waitFor(
        () =>
          document.querySelectorAll(rowSelector).length > 0 ||
          /搜索结果|相关好价|什么值得买/i.test(
            document.body?.textContent || "",
          ),
        12000,
        300,
      );

      const rows = Array.from(document.querySelectorAll(rowSelector));
      const items = helpers.take(
        helpers.uniqueBy(
          rows
            .map((row, index) => {
              const titleAnchor =
                row.querySelector("h5.feed-block-title > a") ||
                row.querySelector("h5 > a");
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
              const commentsText = helpers
                .text(row.querySelector(".feed-btn-comment"))
                .replace(/[^\d]/g, "");
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
    },
    "yahoo-finance/quote": async (args, helpers) => {
      const symbol = String(args.symbol || "").trim().toUpperCase();
      if (!symbol) {
        return {
          ok: false,
          error_code: "invalid_args",
          error_message: "symbol 不能为空。",
        };
      }

      const normalizeTextValue = (value) => {
        const text = String(value ?? "")
          .replace(/\s+/g, " ")
          .trim();
        return text || null;
      };
      const normalizeNumberValue = (value) => {
        if (value === undefined || value === null || value === "") {
          return null;
        }
        const text = String(value)
          .replace(/,/g, "")
          .replace(/%/g, "")
          .trim();
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
            const previousClose =
              meta.previousClose ?? meta.chartPreviousClose ?? null;
            const price = meta.regularMarketPrice ?? null;
            const change =
              price != null && previousClose != null
                ? price - previousClose
                : null;
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
          document.querySelector(
            'fin-streamer[data-field="regularMarketPrice"]',
          ) ||
          document.querySelector("h1"),
        12000,
        300,
      );

      const titleText = normalizeTextValue(document.querySelector("h1")?.textContent);
      const daysRangeText = document.querySelector('[data-test="DAYS_RANGE-value"]')
        ?.textContent;
      const daysRangeParts = typeof daysRangeText === "string"
        ? daysRangeText.split(" - ")
        : [];
      const item = {
        symbol,
        name: titleText
          ? titleText.replace(/\s*\([^)]+\)\s*$/, "").trim() || symbol
          : symbol,
        price: normalizeNumberValue(
          document.querySelector('[data-testid="qsp-price"]')?.textContent ||
            document.querySelector(
              'fin-streamer[data-field="regularMarketPrice"]',
            )?.textContent,
        ),
        change: normalizeNumberValue(
          document.querySelector('[data-testid="qsp-price-change"]')
            ?.textContent ||
            document.querySelector(
              'fin-streamer[data-field="regularMarketChange"]',
            )?.textContent,
        ),
        changePercent: normalizeNumberValue(
          document.querySelector('[data-testid="qsp-price-change-percent"]')
            ?.textContent ||
            document.querySelector(
              'fin-streamer[data-field="regularMarketChangePercent"]',
            )?.textContent,
        ),
        open: normalizeNumberValue(
          document.querySelector('[data-test="OPEN-value"]')?.textContent,
        ),
        high: normalizeNumberValue(daysRangeParts[1]),
        low: normalizeNumberValue(daysRangeParts[0]),
        volume: normalizeNumberValue(
          document.querySelector('[data-test="TD_VOLUME-value"]')?.textContent,
        ),
        marketCap: normalizeTextValue(
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
    },
  };

  const siteAdapterRunners = {
    ...legacySiteAdapterRunners,
    ...generatedSiteAdapterRunners,
  };

  async function executeCommand(commandData) {
    const command = String(commandData.command || "").trim();
    const target = commandData.target;
    const text = commandData.text;
    const payload = commandData.payload;

    switch (command) {
      case "click": {
        const element = findElement(target);
        if (!element) {
          return { status: "error", error: `未找到点击目标: ${target}` };
        }
        element.click();
        return { status: "success", message: "click 执行成功" };
      }
      case "type": {
        const element = findElement(target);
        if (!element) {
          return { status: "error", error: `未找到输入目标: ${target}` };
        }
        const value = text == null ? "" : String(text);
        if ("value" in element) {
          element.focus();
          element.value = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          element.textContent = value;
        }
        return { status: "success", message: "type 执行成功" };
      }
      case "scroll":
      case "scroll_page": {
        scrollPage(text);
        return { status: "success", message: "scroll 执行成功" };
      }
      case "get_page_info": {
        await sendPageInfo("get_page_info");
        return { status: "success", message: "页面信息已回传" };
      }
      case "refresh_page": {
        window.location.reload();
        return { status: "success", message: "页面刷新中" };
      }
      case "go_back": {
        window.history.back();
        return { status: "success", message: "执行后退" };
      }
      case "go_forward": {
        window.history.forward();
        return { status: "success", message: "执行前进" };
      }
      case "run_adapter": {
        const adapterName = String(payload?.adapter_name || "").trim();
        if (!adapterName) {
          return { status: "error", error: "run_adapter 缺少 adapter_name" };
        }
        const runner = siteAdapterRunners[adapterName];
        if (typeof runner !== "function") {
          return {
            status: "error",
            error: `当前扩展内未注册站点适配器: ${adapterName}`,
          };
        }
        const adapterArgs =
          payload && typeof payload.args === "object" && !Array.isArray(payload.args)
            ? payload.args
            : {};
        try {
          const result = await runner(adapterArgs, siteAdapterHelpers);
          return {
            status: "success",
            message: "run_adapter 执行成功",
            data: result ?? null,
          };
        } catch (error) {
          return {
            status: "error",
            error: error?.message || String(error),
          };
        }
      }
      default:
        return { status: "error", error: `不支持的命令: ${command}` };
    }
  }

  async function sendPageInfo(reason) {
    const markdown = buildMarkdown();
    const payload = {
      type: "PAGE_INFO_UPDATE",
      data: {
        reason,
        title: document.title || "",
        url: window.location.href,
        markdown,
      },
    };
    await chrome.runtime.sendMessage(payload);
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const type = request?.type;

    if (type === "REQUEST_PAGE_CAPTURE") {
      sendPageInfo(request?.data?.reason || "manual")
        .then(() => sendResponse({ status: "success" }))
        .catch((error) =>
          sendResponse({
            status: "error",
            error: error?.message || String(error),
          }),
        );
      return true;
    }

    if (type === "EXECUTE_COMMAND") {
      executeCommand(request?.data || {})
        .then(async (result) => {
          if (request?.data?.wait_for_page_info === true) {
            setTimeout(() => {
              sendPageInfo("wait_for_page_info");
            }, 400);
          }
          sendResponse(result);
        })
        .catch((error) =>
          sendResponse({
            status: "error",
            error: error?.message || String(error),
          }),
        );
      return true;
    }

    return true;
  });

  setTimeout(() => {
    sendPageInfo("content_script_ready").catch(() => {});
  }, 800);
})(); // 结束 IIFE
