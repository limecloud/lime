async (args, helpers) => {
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
};
