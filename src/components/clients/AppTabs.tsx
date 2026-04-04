import { cn } from "@/lib/utils";
import { AppType } from "@/lib/api/switch";
import { ProviderIcon } from "@/icons/providers";

interface AppTabsProps {
  activeApp: AppType;
  onAppChange: (app: AppType) => void;
}

const apps: {
  id: AppType;
  label: string;
  description: string;
  iconType: string;
}[] = [
  {
    id: "claude",
    label: "Claude",
    description: "Claude 配置",
    iconType: "claude",
  },
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI Codex CLI",
    iconType: "openai",
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Google Gemini CLI",
    iconType: "gemini",
  },
];

export function AppTabs({ activeApp, onAppChange }: AppTabsProps) {
  return (
    <div className="flex gap-2 border-b pb-2">
      {apps.map((app) => (
        <button
          key={app.id}
          onClick={() => onAppChange(app.id)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
            activeApp === app.id
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground",
          )}
          title={app.description}
        >
          <ProviderIcon providerType={app.iconType} size={16} />
          {app.label}
        </button>
      ))}
    </div>
  );
}
