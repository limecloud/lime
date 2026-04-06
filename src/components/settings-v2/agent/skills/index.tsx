import { SkillsPage } from "@/components/skills/SkillsPage";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";

export function ExtensionsSettings() {
  return (
    <div className="space-y-5">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>高级技能入口</span>
          <WorkbenchInfoTip
            ariaLabel="高级技能入口说明"
            content="Claw 左侧导航已经提供面向最终用户的技能主入口；这里仅保留本地导入、仓库管理与标准检查等高级能力。"
            tone="slate"
          />
          <a
            href="https://github.com/aiclientproxy/lime/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 text-primary hover:underline"
          >
            问题反馈
          </a>
        </div>
      </div>

      <div>
        <SkillsPage hideHeader />
      </div>
    </div>
  );
}
