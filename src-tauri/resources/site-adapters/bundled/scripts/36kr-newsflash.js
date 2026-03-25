async (args, helpers) => {
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
};
