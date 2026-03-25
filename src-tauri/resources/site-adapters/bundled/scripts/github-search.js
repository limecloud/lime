async (args, helpers) => {
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
};
