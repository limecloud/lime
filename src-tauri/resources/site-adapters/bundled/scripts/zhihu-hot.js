async (args, helpers) => {
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
};
