import type { WorkspaceTheme } from "@/types/page";
import type { ThemeModule } from "@/features/themes/types";
import { createDefaultThemeModule } from "@/features/themes/shared/defaultThemeModule";
import { videoThemeModule } from "@/features/themes/video";

const THEME_MODULES: Partial<Record<WorkspaceTheme, ThemeModule>> = {
  video: videoThemeModule,
};

export function getThemeModule(theme: WorkspaceTheme): ThemeModule {
  return THEME_MODULES[theme] ?? createDefaultThemeModule(theme);
}
