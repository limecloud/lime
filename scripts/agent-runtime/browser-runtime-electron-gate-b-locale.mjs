/** Use the current language setting and preserve the page that launched settings. */
export async function setBrowserFixtureLocale(page, options) {
  if (
    (await page.evaluate(() => document.documentElement.lang)) ===
    options.locale
  )
    return;
  await page.getByTestId("app-sidebar-nav-settings").click();
  await page.getByTestId("settings-sidebar-tab-general").click();
  const language = page.locator("#general-language select");
  await language.selectOption(options.locale, { timeout: options.timeoutMs });
  await page.waitForFunction(
    (expected) => document.documentElement.lang === expected,
    options.locale,
    { timeout: options.timeoutMs },
  );
  await page.getByTestId("settings-back-button").click();
}
