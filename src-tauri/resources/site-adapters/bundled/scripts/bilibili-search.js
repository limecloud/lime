async (args, helpers) => {
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
};
