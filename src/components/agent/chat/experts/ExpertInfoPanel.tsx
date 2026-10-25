import { memo, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronUp,
  Sparkles,
  UserRound,
  Workflow,
} from "lucide-react";
import {
  getSeededExpertCatalog,
  readCachedExpertCatalog,
  type ExpertAvatar,
  type ExpertCatalog,
  type ExpertProfile,
} from "@/features/experts";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime/toolInventoryTypes";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import type { Skill } from "@/lib/api/skills";
import type { AgentThreadItem } from "../types";
import { buildThreadExpertProfileSwitchRequestMetadata } from "../workspace/workspaceExpertMetadata";
import { dedupeExpertSkillRefs } from "./expertSkillRefEditing";
import {
  ExpertSkillsSection,
  type ExpertSkillsManageOptions,
} from "./ExpertSkillsSection";
import {
  Avatar,
  BlockTitle,
  BodyText,
  BulletList,
  Card,
  EmptyCard,
  ExpertSummary,
  ExpertTitle,
  Header,
  HeaderText,
  Panel,
  PanelTitle,
  ProfileSwitchLabel,
  ProfileSwitchRow,
  ProfileSwitchSelect,
  Section,
  SectionHeaderRow,
  SectionTitle,
  SectionToggleButton,
  WorkflowList,
  WorkflowStep,
} from "./ExpertInfoPanel.styles";

type ExpertPanelSectionKey =
  | "overview"
  | "memory"
  | "diary"
  | "skills"
  | "workflow";

interface ExpertInfoPanelProps {
  requestMetadata?: Record<string, unknown> | null;
  localSkills?: Skill[];
  serviceSkills?: ServiceSkillItem[];
  workspaceSkillBindings?: AgentRuntimeWorkspaceSkillBinding[];
  skillsLoading?: boolean;
  threadItems?: readonly AgentThreadItem[];
  skillRefsEdited?: boolean;
  enabledWorkspaceSkillRuntimeCount?: number;
  onSkillRefsChange?: (skillRefs: string[]) => void;
  onEnableWorkspaceSkillRuntime?: (ref: string) => void;
  onExpertProfileSwitch?: (requestMetadata: Record<string, unknown>) => void;
  onOpenSkillsManage?: (options?: ExpertSkillsManageOptions) => void;
}

interface ResolvedExpertInfo {
  id: string;
  title: string;
  summary: string;
  avatar: ExpertAvatar;
  category: string;
  tags: string[];
  promptStarters: string[];
  showcase: Array<{ title: string; body: string }>;
  memoryTemplateRef?: string;
  skillRefs: string[];
  workflowRefs: string[];
  memoryEnabled: boolean;
  workflowEnabled: boolean;
  usageCount?: number;
  likeCount?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickStringArray(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function pickBoolean(
  record: Record<string, unknown> | null,
  key: string,
  fallback: boolean,
) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function extractExpertMetadata(metadata?: Record<string, unknown> | null) {
  const root = asRecord(metadata);
  const expert = asRecord(root?.expert);
  const harness = asRecord(asRecord(root?.harness)?.expert);
  const expertId =
    pickString(expert, "expertId") || pickString(harness, "expert_id");
  if (!expertId) {
    return null;
  }

  return {
    id: expertId,
    title: pickString(expert, "title") || pickString(harness, "title"),
    category: pickString(expert, "category") || pickString(harness, "category"),
    source: pickString(expert, "source") || pickString(harness, "source"),
    memoryTemplateRef:
      pickString(expert, "memoryTemplateRef") ||
      pickString(harness, "memory_template_ref"),
    skillRefs:
      pickStringArray(expert, "skillRefs").length > 0
        ? pickStringArray(expert, "skillRefs")
        : pickStringArray(harness, "skill_refs"),
    workflowRefs:
      pickStringArray(expert, "workflowRefs").length > 0
        ? pickStringArray(expert, "workflowRefs")
        : pickStringArray(harness, "workflow_refs"),
    memoryEnabled:
      pickBoolean(expert, "memoryEnabled", true) &&
      pickBoolean(harness, "memory_enabled", true),
    workflowEnabled:
      pickBoolean(expert, "workflowEnabled", true) &&
      pickBoolean(harness, "workflow_enabled", true),
  };
}

function getCatalogs(): ExpertCatalog[] {
  const cached = readCachedExpertCatalog();
  const seeded = getSeededExpertCatalog();
  return cached ? [cached, seeded] : [seeded];
}

interface ExpertSwitchOption {
  id: string;
  title: string;
  catalog: ExpertCatalog;
  profile: ExpertProfile;
}

function getExpertSwitchOptions(): ExpertSwitchOption[] {
  const seen = new Set<string>();
  return getCatalogs().flatMap((catalog) =>
    catalog.items.flatMap((profile) => {
      if (seen.has(profile.id)) {
        return [];
      }
      seen.add(profile.id);
      return [
        {
          id: profile.id,
          title: profile.title,
          catalog,
          profile,
        },
      ];
    }),
  );
}

function findCatalogExpert(expertId: string): ExpertProfile | null {
  for (const catalog of getCatalogs()) {
    const matched = catalog.items.find((item) => item.id === expertId);
    if (matched) {
      return matched;
    }
  }
  return null;
}

function renderAvatar(avatar: ExpertAvatar, title: string) {
  if (avatar.kind === "url" || avatar.kind === "asset") {
    return <img src={avatar.value} alt={title} />;
  }
  return avatar.value;
}

function formatRefLabel(ref: string) {
  const withoutPrefix = ref.includes(":") ? ref.split(":").pop() || ref : ref;
  const withoutVersion = withoutPrefix.split("@")[0] || withoutPrefix;
  return withoutVersion
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveExpertInfo(
  metadata?: Record<string, unknown> | null,
): ResolvedExpertInfo | null {
  const extracted = extractExpertMetadata(metadata);
  if (!extracted) {
    return null;
  }

  const catalogExpert = findCatalogExpert(extracted.id);
  return {
    id: extracted.id,
    title: extracted.title || catalogExpert?.title || extracted.id,
    summary: catalogExpert?.summary || "",
    avatar: catalogExpert?.avatar || { kind: "emoji", value: "🧑‍💼" },
    category: extracted.category || catalogExpert?.category || "expert",
    tags: catalogExpert?.tags || [],
    promptStarters: catalogExpert?.promptStarters || [],
    showcase: catalogExpert?.showcase || [],
    memoryTemplateRef:
      extracted.memoryEnabled === false
        ? undefined
        : extracted.memoryTemplateRef ||
          catalogExpert?.release.memoryTemplateRef,
    skillRefs:
      extracted.skillRefs.length > 0
        ? extracted.skillRefs
        : catalogExpert?.release.skillRefs || [],
    workflowRefs:
      extracted.workflowEnabled === false
        ? []
        : extracted.workflowRefs.length > 0
          ? extracted.workflowRefs
          : catalogExpert?.release.workflowRefs || [],
    memoryEnabled: extracted.memoryEnabled,
    workflowEnabled: extracted.workflowEnabled,
    usageCount: catalogExpert?.stats.usageCount,
    likeCount: catalogExpert?.stats.likeCount,
  };
}

function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Set<ExpertPanelSectionKey>>(
    () => new Set(["overview", "diary"]),
  );

  const toggle = (key: ExpertPanelSectionKey) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return { collapsed, toggle };
}

export const ExpertInfoPanel = memo(function ExpertInfoPanel({
  requestMetadata,
  localSkills,
  serviceSkills,
  workspaceSkillBindings,
  skillsLoading = false,
  threadItems,
  skillRefsEdited = false,
  enabledWorkspaceSkillRuntimeCount = 0,
  onSkillRefsChange,
  onEnableWorkspaceSkillRuntime,
  onExpertProfileSwitch,
  onOpenSkillsManage,
}: ExpertInfoPanelProps) {
  const { t } = useTranslation("agent");
  const profileSwitchSelectId = useId();
  const expert = useMemo(
    () => resolveExpertInfo(requestMetadata),
    [requestMetadata],
  );
  const expertSwitchOptions = useMemo(() => getExpertSwitchOptions(), []);
  const { collapsed, toggle } = useCollapsedSections();
  const baseSkillRefs = useMemo(
    () => dedupeExpertSkillRefs(expert ? expert.skillRefs : []),
    [expert],
  );

  if (!expert) {
    return null;
  }

  const handleExpertProfileSwitch = (nextExpertId: string) => {
    if (!onExpertProfileSwitch || nextExpertId === expert.id) {
      return;
    }
    const nextOption = expertSwitchOptions.find(
      (option) => option.id === nextExpertId,
    );
    if (!nextOption) {
      return;
    }
    onExpertProfileSwitch(
      buildThreadExpertProfileSwitchRequestMetadata({
        currentMetadata: requestMetadata,
        expert: nextOption.profile,
        catalog: nextOption.catalog,
        switchedAt: new Date().toISOString(),
      }),
    );
  };

  const renderSection = (
    key: ExpertPanelSectionKey,
    title: string,
    icon: ReactNode,
    content: ReactNode,
    action?: ReactNode,
  ) => {
    const isCollapsed = collapsed.has(key);
    return (
      <Section data-testid={`expert-info-section-${key}`}>
        <SectionHeaderRow>
          <SectionToggleButton
            type="button"
            aria-expanded={!isCollapsed}
            onClick={() => toggle(key)}
          >
            <SectionTitle>
              {icon}
              {title}
            </SectionTitle>
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </SectionToggleButton>
          {action}
        </SectionHeaderRow>
        {isCollapsed ? null : content}
      </Section>
    );
  };

  const focusItems = [
    ...expert.tags.slice(0, 4).map((tag) => `#${tag}`),
    ...expert.promptStarters.slice(0, 2),
  ];
  const workflowRefs = expert.workflowRefs;

  return (
    <Panel
      data-testid="expert-info-panel"
      data-layout="right-surface-full"
      aria-label={t("agentExperts.info.title", "专家信息")}
    >
      <PanelTitle>
        <UserRound size={16} />
        {t("agentExperts.info.title", "专家信息")}
      </PanelTitle>

      <Header>
        <Avatar aria-hidden="true">
          {renderAvatar(expert.avatar, expert.title)}
        </Avatar>
        <HeaderText>
          <ExpertTitle>{expert.title}</ExpertTitle>
          <ExpertSummary>{expert.summary}</ExpertSummary>
        </HeaderText>
      </Header>

      {onExpertProfileSwitch && expertSwitchOptions.length > 1 ? (
        <ProfileSwitchRow data-testid="expert-profile-switch">
          <ProfileSwitchLabel htmlFor={profileSwitchSelectId}>
            {t("agentExperts.info.profileSwitch.label", "当前专家")}
          </ProfileSwitchLabel>
          <ProfileSwitchSelect
            id={profileSwitchSelectId}
            aria-label={t(
              "agentExperts.info.profileSwitch.ariaLabel",
              "切换当前对话的专家",
            )}
            value={expert.id}
            onChange={(event) => handleExpertProfileSwitch(event.target.value)}
          >
            {expertSwitchOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </ProfileSwitchSelect>
        </ProfileSwitchRow>
      ) : null}

      {renderSection(
        "overview",
        t("agentExperts.info.sections.overview", "简介"),
        <Sparkles size={14} />,
        <Card>
          <BlockTitle>
            {t("agentExperts.info.overview.who", "专家定位")}
          </BlockTitle>
          <BodyText>
            {expert.summary ||
              t(
                "agentExperts.info.overview.empty",
                "这个专家会把人设、技能、记忆和工作流绑定到当前 Agent 对话中。",
              )}
          </BodyText>
          <BlockTitle>
            {t("agentExperts.info.overview.how", "工作方式")}
          </BlockTitle>
          <BulletList>
            <li>
              {t(
                "agentExperts.info.overview.workWithContext",
                "先理解当前项目目标，再给出可执行建议。",
              )}
            </li>
            <li>
              {t(
                "agentExperts.info.overview.workWithRefs",
                "必要时引用已绑定的技能、记忆模板和工作流。",
              )}
            </li>
            {expert.showcase.slice(0, 2).map((item) => (
              <li key={item.title}>
                {item.title}：{item.body}
              </li>
            ))}
          </BulletList>
          <BlockTitle>
            {t("agentExperts.info.overview.boundaries", "边界")}
          </BlockTitle>
          <BulletList>
            <li>
              {t(
                "agentExperts.info.boundary.truth",
                "基于真实上下文和用户提供的信息工作，不编造未给出的事实。",
              )}
            </li>
            <li>
              {t(
                "agentExperts.info.boundary.private",
                "不会把项目文件、私有记忆或对话内容写回公共专家目录。",
              )}
            </li>
          </BulletList>
        </Card>,
      )}

      {renderSection(
        "memory",
        t("agentExperts.info.sections.memory", "记忆"),
        <Brain size={14} />,
        expert.memoryTemplateRef ? (
          <Card data-testid="expert-info-memory">
            <BlockTitle>
              {t("agentExperts.info.memory.title", {
                title: expert.title,
                defaultValue: "MEMORY.md — {{title}} Memory",
              })}
            </BlockTitle>
            <BlockTitle>
              {t("agentExperts.info.memory.focus", "当前项目与关注")}
            </BlockTitle>
            <BulletList>
              {focusItems.length > 0 ? (
                focusItems.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>
                  {t(
                    "agentExperts.info.memory.defaultFocus",
                    "围绕本轮任务持续沉淀偏好、约束和复盘线索。",
                  )}
                </li>
              )}
            </BulletList>
            <BlockTitle>
              {t("agentExperts.info.memory.accumulated", "经验积累")}
            </BlockTitle>
            <BulletList>
              <li>
                {t(
                  "agentExperts.info.memory.templateEnabled",
                  "专家记忆模板已启用，会作为本轮对话的长期上下文线索。",
                )}
              </li>
              {typeof expert.usageCount === "number" ? (
                <li>
                  {t("agentExperts.info.memory.usage", {
                    count: expert.usageCount,
                    defaultValue: "历史使用 {{count}} 次",
                  })}
                </li>
              ) : null}
            </BulletList>
          </Card>
        ) : (
          <EmptyCard>
            {t(
              "agentExperts.info.memory.disabled",
              "这个专家当前没有启用记忆模板。",
            )}
          </EmptyCard>
        ),
      )}

      {renderSection(
        "diary",
        t("agentExperts.info.sections.diary", "日记"),
        <BookOpen size={14} />,
        <EmptyCard>{t("agentExperts.info.diary.empty", "暂无日记")}</EmptyCard>,
      )}

      <ExpertSkillsSection
        collapsed={collapsed.has("skills")}
        expertId={expert.id}
        baseSkillRefs={baseSkillRefs}
        localSkills={localSkills}
        serviceSkills={serviceSkills}
        workspaceSkillBindings={workspaceSkillBindings}
        skillsLoading={skillsLoading}
        threadItems={threadItems}
        skillRefsEdited={skillRefsEdited}
        enabledWorkspaceSkillRuntimeCount={enabledWorkspaceSkillRuntimeCount}
        onToggle={() => toggle("skills")}
        onSkillRefsChange={onSkillRefsChange}
        onEnableWorkspaceSkillRuntime={onEnableWorkspaceSkillRuntime}
        onOpenSkillsManage={onOpenSkillsManage}
      />

      {renderSection(
        "workflow",
        t("agentExperts.info.sections.workflow", "工作流程"),
        <Workflow size={14} />,
        workflowRefs.length > 0 ? (
          <WorkflowList data-testid="expert-info-workflow">
            {workflowRefs.map((ref) => (
              <WorkflowStep key={ref}>{formatRefLabel(ref)}</WorkflowStep>
            ))}
          </WorkflowList>
        ) : (
          <EmptyCard>
            {t("agentExperts.info.workflow.empty", "暂无绑定工作流程")}
          </EmptyCard>
        ),
      )}
    </Panel>
  );
});
