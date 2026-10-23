import { describe, expect, it } from "vitest";
import { loadNamespaceResource } from "./loadNamespace";
import { getLimeI18n } from "./createI18n";
import type { SupportedLocale } from "./locales";

const modules = import.meta.glob<Record<string, string>>(
  "./resources/*/browser{Chrome,History,Annotation,Downloads,Data}.json",
  { eager: true, import: "default" },
);
describe("Browser resource bundles", () => {
  for (const [file, namespace, prefix] of [
    ["browserChrome", "agent", "browserChrome."],
    ["browserHistory", "settings", "browserHistory."],
    ["browserDownloads", "settings", "browserDownloads."],
    ["browserData", "settings", "browserData."],
    ["browserAnnotation", "agent", "browserAnnotation."],
  ] as const) {
    const baseline = modules[`./resources/en-US/${file}.json`];
    it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
      `includes every ${file} key and interpolation in %s without fallback`,
      (locale: SupportedLocale) => {
        const resource = modules[`./resources/${locale}/${file}.json`];
        expect(resource).toBeDefined();
        expect(Object.keys(resource).sort()).toEqual(
          Object.keys(baseline).sort(),
        );
        const bundled = loadNamespaceResource(locale, namespace);
        const t = getLimeI18n().getFixedT(locale, namespace);
        for (const [key, value] of Object.entries(resource)) {
          expect(key.startsWith(prefix)).toBe(true);
          expect(typeof value).toBe("string");
          expect(value.trim(), key).not.toBe("");
          expect(bundled[key], key).toBe(value);
          const interpolation = (source: string) =>
            [...source.matchAll(/\{\{([^}]+)\}\}/gu)]
              .map((match) => match[1].trim())
              .sort();
          expect(interpolation(value), key).toEqual(
            interpolation(baseline[key]),
          );
          const translated = t(key, {
            title: "History fixture",
            filename: "download.txt",
            received: "1 KB",
            total: "2 KB",
            count: 2,
            site: "example.com",
            size: "2 KB",
            types: "History",
          });
          expect(translated, key).not.toBe(key);
          expect(translated, key).not.toMatch(/\{\{[^}]+\}\}/u);
        }
      },
    );
  }
});
