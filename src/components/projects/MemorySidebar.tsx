/**
 * 记忆侧边栏
 *
 * 在编辑页面显示项目的角色与世界观（只读）
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Users,
  Globe,
  ChevronDown,
  ChevronRight,
  Star,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ProjectMemory,
  Character,
  WorldBuilding,
  getProjectMemory,
} from "@/lib/api/memory";

interface MemorySidebarProps {
  projectId: string;
  className?: string;
}

export function MemorySidebar({ projectId, className }: MemorySidebarProps) {
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["characters", "world"]),
  );

  const loadMemory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProjectMemory(projectId);
      setMemory(data);
    } catch (error) {
      console.error("加载记忆失败:", error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };
  const headerBadges = [
    `${memory?.characters.length || 0} 个角色`,
    memory?.world_building ? "已整理世界观" : "待补世界观",
  ];

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-40 items-center justify-center border-l border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.92)_0%,rgba(241,245,249,0.88)_100%)]",
          className,
        )}
      >
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden border-l border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,0.98)_34%,rgba(241,245,249,0.94)_100%)]",
        className,
      )}
    >
      <div className="relative border-b border-white/80 px-4 py-4">
        <div className="pointer-events-none absolute -right-10 top-0 h-24 w-24 rounded-full bg-sky-200/20 blur-3xl" />
        <div className="pointer-events-none absolute left-[-28px] top-[-18px] h-20 w-20 rounded-full bg-emerald-200/20 blur-3xl" />
        <div className="relative space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500">
                项目记忆
              </div>
              <div className="text-sm font-semibold text-slate-900">
                角色与世界观
              </div>
              <p className="text-xs leading-5 text-slate-500">
                编辑时快速查看项目事实，保持人物与设定的一致性。
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-slate-500 hover:bg-white/70 hover:text-slate-700"
              onClick={loadMemory}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {headerBadges.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/90 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm shadow-slate-950/5"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          <SidebarSection
            title="角色"
            icon={<Users className="h-4 w-4" />}
            count={memory?.characters.length || 0}
            expanded={expandedSections.has("characters")}
            onToggle={() => toggleSection("characters")}
          >
            {memory?.characters && memory.characters.length > 0 ? (
              <div className="space-y-2">
                {memory.characters.map((character) => (
                  <CharacterItem key={character.id} character={character} />
                ))}
              </div>
            ) : (
              <p className="py-2 text-xs text-slate-500">暂无角色</p>
            )}
          </SidebarSection>

          <SidebarSection
            title="世界观"
            icon={<Globe className="h-4 w-4" />}
            expanded={expandedSections.has("world")}
            onToggle={() => toggleSection("world")}
          >
            {memory?.world_building ? (
              <WorldBuildingItem worldBuilding={memory.world_building} />
            ) : (
              <p className="py-2 text-xs text-slate-500">暂无世界观设定</p>
            )}
          </SidebarSection>
        </div>
      </ScrollArea>
    </div>
  );
}

// 侧边栏分区组件
interface SidebarSectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function SidebarSection({
  title,
  icon,
  count,
  expanded,
  onToggle,
  children,
}: SidebarSectionProps) {
  return (
    <Collapsible
      open={expanded}
      onOpenChange={onToggle}
      className="rounded-[22px] border border-white/90 bg-white/84 p-1.5 shadow-sm shadow-slate-950/5"
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-[18px] px-3 py-3 text-sm text-slate-700 transition",
          expanded ? "bg-slate-50/80" : "hover:bg-slate-50/70",
        )}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
        {icon}
        <span className="flex-1 text-left font-medium">{title}</span>
        {count !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            {count}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2 pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// 角色项组件
interface CharacterItemProps {
  character: Character;
}

function CharacterItem({ character }: CharacterItemProps) {
  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-3 py-3 text-xs shadow-sm shadow-slate-950/5">
      <div className="mb-1 flex items-center gap-2">
        <User className="h-3 w-3 text-slate-400" />
        <span className="font-medium text-slate-900">{character.name}</span>
        {character.is_main && (
          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
        )}
      </div>
      {character.description && (
        <p className="line-clamp-2 leading-5 text-slate-500">
          {character.description}
        </p>
      )}
    </div>
  );
}

// 世界观项组件
interface WorldBuildingItemProps {
  worldBuilding: WorldBuilding;
}

function WorldBuildingItem({ worldBuilding }: WorldBuildingItemProps) {
  return (
    <div className="space-y-2 rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-3 py-3 text-xs shadow-sm shadow-slate-950/5">
      {worldBuilding.description && (
        <div>
          <span className="text-slate-400">描述：</span>
          <p className="line-clamp-3 leading-5 text-slate-700">
            {worldBuilding.description}
          </p>
        </div>
      )}
      {worldBuilding.era && (
        <div>
          <span className="text-slate-400">时代：</span>
          <span className="text-slate-700">{worldBuilding.era}</span>
        </div>
      )}
      {worldBuilding.locations && (
        <div>
          <span className="text-slate-400">地点：</span>
          <p className="line-clamp-2 leading-5 text-slate-700">
            {worldBuilding.locations}
          </p>
        </div>
      )}
    </div>
  );
}
