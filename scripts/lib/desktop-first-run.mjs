import fs from "node:fs";
import path from "node:path";

const locales = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
const labels = locales.map((locale) => {
  const messages = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "i18n",
        "resources",
        locale,
        "settings.json",
      ),
      "utf8",
    ),
  );
  return messages["settings.permissionsSetup.later"];
});

export async function finishDesktopFirstRun(page, timeoutMs) {
  if (!labels.every((label) => typeof label === "string" && label.length > 0)) {
    throw new Error("Desktop first-run labels are missing");
  }
  const name = new RegExp(
    `^(?:${labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`,
  );
  const button = page.getByRole("dialog").getByRole("button", { name });
  if (!(await button.isVisible())) return { deferred: false };
  await button.click({ timeout: timeoutMs });
  await button.waitFor({ state: "hidden", timeout: timeoutMs });
  return { deferred: true };
}
