import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import { isServiceSkillExecutableAsSiteAdapter } from "./siteCapabilityBinding";

const DEFAULT_SITE_SKILL_EXAMPLE = "帮我用 GitHub 查一下 AI Agent 项目";

const SITE_SKILL_EXAMPLE_BY_ADAPTER: Record<string, string> = {
  "36kr/newsflash": "帮我看下 36Kr 最新快讯",
  "bilibili/search": "帮我去 B 站搜一下 AI Agent 教程",
  "github/issues": "帮我看一下 GitHub 上 rust-lang/rust 仓库的 issue",
  "github/search": DEFAULT_SITE_SKILL_EXAMPLE,
  "linux-do/categories": "帮我看下 linux.do 的分类列表",
  "linux-do/hot": "帮我看看 linux.do 热门话题",
  "smzdm/search": "帮我在什么值得买查一下 AI Agent 相关商品",
  "yahoo-finance/quote": "帮我看一下 Yahoo Finance 上 TSLA 的行情",
  "zhihu/hot": "帮我看看知乎热榜",
  "zhihu/search": "帮我去知乎搜一下 AI Agent 相关内容",
};

const EXPORT_STYLE_CAPABILITIES = new Set([
  "article_export",
  "markdown_bundle",
]);

function normalizeAdapterName(adapterName?: string | null): string {
  return adapterName?.trim().toLowerCase() || "";
}

function normalizeCapability(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

export function hasAutoLaunchableSiteSkill(
  serviceSkills?: readonly ServiceSkillItem[],
): boolean {
  return (serviceSkills ?? []).some((skill) =>
    isServiceSkillExecutableAsSiteAdapter(skill),
  );
}

export function getSiteSkillAutoLaunchExample(
  serviceSkills?: readonly ServiceSkillItem[],
): string {
  for (const skill of serviceSkills ?? []) {
    if (!isServiceSkillExecutableAsSiteAdapter(skill)) {
      continue;
    }

    const adapterName = normalizeAdapterName(
      skill.siteCapabilityBinding.adapterName,
    );
    const example = SITE_SKILL_EXAMPLE_BY_ADAPTER[adapterName];
    if (example) {
      return example;
    }

    const requiredCapabilities =
      skill.siteCapabilityBinding.adapterMatch?.requiredCapabilities ?? [];
    if (
      requiredCapabilities.some((capability) =>
        EXPORT_STYLE_CAPABILITIES.has(normalizeCapability(capability)),
      )
    ) {
      const siteLabel = skill.siteCapabilityBinding.siteLabel?.trim();
      return siteLabel
        ? `帮我把这个${siteLabel}文章链接导出成 Markdown，并把图片一起保存到项目里`
        : "帮我把这个页面导出成 Markdown，并把图片一起保存到项目里";
    }
  }

  return DEFAULT_SITE_SKILL_EXAMPLE;
}
