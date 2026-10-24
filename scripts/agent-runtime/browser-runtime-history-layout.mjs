/** Observe real layout, including empty states, without mirroring CSS classes. */
export async function readHistoryLayout(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="browser-history-page"]');
    const targets = {
      page: root,
      header: root?.querySelector('[data-testid="browser-management-header"]'),
      search: root?.querySelector('input[type="search"]'),
    };
    return Object.fromEntries(
      Object.entries(targets).map(([name, element]) => {
        if (!element?.checkVisibility())
          throw new Error(`History layout target is not visible: ${name}`);
        const { x, width } = element.getBoundingClientRect();
        return [name, { x, width }];
      }),
    );
  });
}

export function sameHistoryLayout(before, after) {
  return Object.keys(before).every((name) =>
    ["x", "width"].every(
      (key) => Math.abs(before[name][key] - after[name][key]) <= 1,
    ),
  );
}

export async function waitForHistoryAnimations(page) {
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="browser-history-page"]')
        ?.getAnimations({ subtree: true })
        .some(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        ),
    undefined,
    { timeout: 3000 },
  );
}
