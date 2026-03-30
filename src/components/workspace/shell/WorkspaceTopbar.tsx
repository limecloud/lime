import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ThemeWorkspaceNavigationItem,
  ThemeWorkspaceView,
} from "@/features/themes/types";
import type { ProjectType } from "@/lib/api/project";
import { getProjectTypeLabel } from "@/lib/api/project";
import { CanvasBreadcrumbHeader } from "@/lib/workspace/workbenchUi";

export interface WorkspaceTopbarProps {
  theme: ProjectType;
  projectName?: string;
  navigationItems: ThemeWorkspaceNavigationItem[];
  activeView: ThemeWorkspaceView;
  onViewChange: (view: ThemeWorkspaceView) => void;
  onBackHome?: () => void;
  onOpenCreateHome?: () => void;
  onBackToProjectManagement?: () => void;
  showBackToProjectManagement?: boolean;
}

export function WorkspaceTopbar({
  theme,
  projectName,
  navigationItems,
  activeView,
  onViewChange,
  onBackHome,
  onOpenCreateHome,
  onBackToProjectManagement,
  showBackToProjectManagement = true,
}: WorkspaceTopbarProps) {
  return (
    <header className="border-b bg-background">
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="shrink-0">
            <CanvasBreadcrumbHeader
              label={getProjectTypeLabel(theme)}
              onBackHome={onBackHome}
            />
          </div>

          {showBackToProjectManagement && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              onClick={onBackToProjectManagement}
            >
              项目管理
            </Button>
          )}

          {onOpenCreateHome && (
            <Button
              variant={activeView === "create" ? "default" : "outline"}
              size="sm"
              className="h-8 shrink-0"
              onClick={onOpenCreateHome}
            >
              创作首页
            </Button>
          )}

          {projectName && (
            <div className="max-w-[280px] shrink-0 truncate text-sm font-medium text-muted-foreground">
              {projectName}
            </div>
          )}

          {navigationItems.length > 0 && (
            <div className="mx-1 h-5 w-px shrink-0 bg-border/70" aria-hidden="true" />
          )}

          {navigationItems.map((item) => (
            <Button
              key={item.key}
              size="sm"
              variant={activeView === item.key ? "default" : "outline"}
              className={cn("h-8 shrink-0")}
              onClick={() => onViewChange(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
    </header>
  );
}

export default WorkspaceTopbar;
