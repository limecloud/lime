import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { Page, PageParams } from "@/types/page";
import { buildConversationParams } from "@/lib/workspace/navigation";
import {
  LAST_PROJECT_ID_KEY,
  loadPersistedProjectId,
} from "@/components/agent/chat/hooks/agentProjectStorage";
import { normalizeProjectId } from "@/components/agent/chat/utils/topicProjectResolution";
import {
  buildExpertRuntimeMetadata,
  buildExpertCatalogProjection,
  buildExpertAgentInstanceKey,
  findExpertAgentInstance,
  formatExpertRefList,
  getExpertCatalog,
  getSeededExpertCatalog,
  recordExpertLaunch,
  recordExpertCatalogEvent,
  refreshExpertAgentInstancesFromCloud,
  readExpertInstallOverlay,
  upsertInstalledExpert,
  type ExpertCatalog,
  type ExpertCatalogEventName,
  type ExpertCatalogProjectionItem,
  type ExpertInstallOverlayRecord,
} from "@/features/experts";

interface ExpertPlazaPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  currentProjectId?: string | null;
}

const Shell = styled.div.attrs({
  className: "lime-workbench-theme-scope",
})`
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--lime-stage-surface);
  padding: 24px;
  color: var(--lime-text-strong, #0f172a);

  @media (max-width: 720px) {
    padding: 14px;
  }
`;

const Content = styled.div`
  margin: 0 auto;
  display: flex;
  min-width: 0;
  width: min(1440px, 100%);
  flex-direction: column;
  gap: 18px;
`;

const Header = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;

  @media (max-width: 720px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const TitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Eyebrow = styled.span`
  color: var(--lime-brand-strong, #0f766e);
  font-size: 12px;
  font-weight: 760;
`;

const Title = styled.h1`
  margin: 0;
  color: var(--lime-text-strong, #0f172a);
  font-size: clamp(24px, 3vw, 34px);
  letter-spacing: -0.03em;
`;

const Subtitle = styled.p`
  margin: 0;
  max-width: 680px;
  color: var(--lime-text-muted, #64748b);
  font-size: 14px;
  line-height: 1.7;
`;

const SyncPill = styled.span`
  border-radius: 999px;
  border: 1px solid var(--lime-surface-border-strong, rgba(148, 163, 184, 0.45));
  background: var(--lime-surface, #fff);
  padding: 8px 12px;
  color: var(--lime-text, #475569);
  font-size: 12px;
  font-weight: 680;
`;

const RankingGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const RankingCard = styled.article`
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 232, 240, 0.92));
  border-radius: 24px;
  background: var(--lime-surface, #fff);
  padding: 18px;
  box-shadow: 0 18px 42px
    color-mix(
      in srgb,
      var(--lime-shadow-color, rgba(15, 23, 42, 0.12)) 34%,
      transparent
    );
`;

const RankingTitle = styled.h2`
  margin: 0 0 12px;
  font-size: 15px;
`;

const RankingList = styled.ol`
  margin: 0;
  display: flex;
  list-style: none;
  flex-direction: column;
  gap: 10px;
  padding: 0;
`;

const RankingItem = styled.li`
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--lime-text, #334155);
  font-size: 13px;
  font-weight: 650;
`;

const Rank = styled.span`
  display: inline-flex;
  height: 22px;
  width: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--lime-brand-soft, #ecfeff);
  color: var(--lime-brand-strong, #0f766e);
  font-size: 12px;
`;

const Toolbar = styled.section`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.92));
  border-radius: 22px;
  background: var(--lime-surface, #fff);
  padding: 12px;
`;

const CategoryList = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
`;

const CategoryButton = styled.button<{ $active: boolean }>`
  border: 1px solid
    ${(props) =>
      props.$active
        ? "var(--lime-brand, #10b981)"
        : "var(--lime-surface-border, #e2e8f0)"};
  border-radius: 999px;
  background: ${(props) =>
    props.$active
      ? "var(--lime-brand-soft, #ecfdf5)"
      : "var(--lime-surface-soft, #f8fafc)"};
  padding: 7px 12px;
  color: ${(props) =>
    props.$active
      ? "var(--lime-brand-strong, #166534)"
      : "var(--lime-text, #475569)"};
  font-size: 12px;
  font-weight: 720;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;

  &:hover {
    border-color: var(--lime-brand, #10b981);
    background: var(--lime-surface-hover, #f4fdf4);
    color: var(--lime-brand-strong, #166534);
  }
`;

const SearchInput = styled.input`
  flex: 1 1 240px;
  min-height: 36px;
  min-width: 0;
  width: min(320px, 100%);
  border: 1px solid var(--lime-surface-border, #e2e8f0);
  border-radius: 999px;
  background: var(--lime-surface-soft, #f8fafc);
  padding: 0 14px;
  color: var(--lime-text-strong, #0f172a);
  outline: none;

  &::placeholder {
    color: var(--lime-text-muted, #94a3b8);
  }

  &:focus {
    border-color: var(--lime-brand, #10b981);
    box-shadow: 0 0 0 4px var(--lime-focus-ring, rgba(52, 171, 103, 0.18));
  }
`;

const CardGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 14px;
`;

const ExpertCard = styled.article`
  display: flex;
  min-height: 188px;
  min-width: 0;
  box-sizing: border-box;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 232, 240, 0.94));
  border-radius: 22px;
  background: var(--lime-surface, #fff);
  padding: 18px;
  box-shadow: 0 16px 34px
    color-mix(
      in srgb,
      var(--lime-shadow-color, rgba(15, 23, 42, 0.12)) 30%,
      transparent
    );
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(
      --lime-surface-border-strong,
      var(--lime-surface-border-strong, #c7e7d1)
    );
    box-shadow: 0 18px 40px
      color-mix(
        in srgb,
        var(--lime-shadow-color, rgba(15, 23, 42, 0.12)) 42%,
        transparent
      );
    transform: translateY(-1px);
  }
`;

const ExpertHead = styled.button`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
`;

const Avatar = styled.span`
  display: inline-flex;
  height: 42px;
  width: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: var(--lime-brand-soft, #ecfeff);
  font-size: 23px;
`;

const ExpertTitle = styled.h3`
  margin: 0;
  color: var(--lime-text-strong, #0f172a);
  font-size: 15px;
  overflow-wrap: anywhere;
`;

const ExpertSummary = styled.p`
  margin: 6px 0 0;
  color: var(--lime-text-muted, #64748b);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
`;

const CardMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--lime-text-muted, #94a3b8);
  font-size: 12px;
`;

const Tag = styled.span`
  border-radius: 999px;
  background: var(--lime-surface-muted, #f1f5f9);
  padding: 5px 8px;
  color: var(--lime-text, #475569);
  font-size: 11px;
  font-weight: 650;
`;

const ActionRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(84px, 0.82fr);
  gap: 8px;

  @media (max-width: 420px) {
    grid-template-columns: 1fr;
  }
`;

const PrimaryButton = styled.button`
  display: inline-flex;
  min-height: 38px;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid
    color-mix(
      in srgb,
      var(--lime-brand, #10b981) 72%,
      var(--lime-surface-border, #e2e8f0)
    );
  border-radius: 16px;
  background: var(
    --lime-primary-gradient-simple,
    linear-gradient(135deg, #0ea5e9 0%, #10b981 100%)
  );
  padding: 0 14px;
  color: #fff;
  font-size: 12px;
  font-weight: 760;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 8px 18px
    color-mix(in srgb, var(--lime-brand, #10b981) 18%, transparent);
  transition:
    box-shadow 0.16s ease,
    filter 0.16s ease,
    transform 0.16s ease;

  &:hover {
    filter: saturate(1.02) brightness(1.01);
    box-shadow: 0 10px 22px
      color-mix(in srgb, var(--lime-brand, #10b981) 24%, transparent);
    transform: translateY(-1px);
  }
`;

const SecondaryButton = styled.button`
  display: inline-flex;
  min-height: 38px;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid
    color-mix(
      in srgb,
      var(--lime-brand, #10b981) 24%,
      var(--lime-surface-border, #e2e8f0)
    );
  border-radius: 16px;
  background: color-mix(
    in srgb,
    var(--lime-brand-soft, #ecfdf5) 58%,
    var(--lime-surface, #fff)
  );
  padding: 0 14px;
  color: var(--lime-brand-strong, #166534);
  font-size: 12px;
  font-weight: 720;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 46%, transparent);
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: color-mix(
      in srgb,
      var(--lime-brand, #10b981) 52%,
      var(--lime-surface-border, #e2e8f0)
    );
    background: color-mix(
      in srgb,
      var(--lime-brand-soft, #ecfdf5) 78%,
      var(--lime-surface, #fff)
    );
    color: var(--lime-brand-strong, #166534);
    transform: translateY(-1px);
  }
`;

const EmptyState = styled.div`
  border: 1px dashed var(--lime-surface-border-strong, #cbd5e1);
  border-radius: 22px;
  background: var(--lime-surface, #fff);
  padding: 34px;
  text-align: center;
  color: var(--lime-text-muted, #64748b);
`;

const DetailOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.38);
  padding: 24px;
`;

const DetailDialog = styled.div`
  display: grid;
  width: min(980px, 100%);
  max-height: min(720px, 88vh);
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 18px;
  overflow: auto;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 232, 240, 0.95));
  border-radius: 28px;
  background: var(--lime-surface, #fff);
  padding: 24px;
  box-shadow: 0 24px 80px
    color-mix(
      in srgb,
      var(--lime-shadow-color, rgba(15, 23, 42, 0.18)) 78%,
      transparent
    );

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
  }
`;

const DetailMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const DetailSide = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 22px;
  background: linear-gradient(
    180deg,
    var(--lime-brand-soft, #ecfdf5) 0%,
    var(--lime-surface-soft, #f8fafc) 100%
  );
  padding: 16px;
`;

const DetailActions = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-top: 6px;
  border-top: 1px solid
    color-mix(
      in srgb,
      var(--lime-brand, #10b981) 16%,
      var(--lime-surface-border, #e2e8f0)
    );
  padding-top: 12px;
`;

const DetailPrimaryButton = styled(PrimaryButton)`
  width: 100%;
  min-height: 44px;
  padding: 0 18px;
  font-size: 13px;
`;

const DetailTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const CloseButton = styled.button`
  border: 1px solid var(--lime-surface-border, #e2e8f0);
  border-radius: 999px;
  background: var(--lime-surface, #fff);
  padding: 8px 10px;
  color: var(--lime-text, #334155);
  cursor: pointer;

  &:hover {
    border-color: var(--lime-brand, #10b981);
    background: var(--lime-brand-soft, #ecfdf5);
    color: var(--lime-brand-strong, #166534);
  }
`;

const DetailBlock = styled.section`
  border: 1px solid var(--lime-surface-border, #e2e8f0);
  border-radius: 18px;
  background: var(--lime-surface-soft, #f8fafc);
  padding: 14px;
`;

const DetailBlockTitle = styled.h4`
  margin: 0 0 8px;
  color: var(--lime-text-strong, #0f172a);
  font-size: 13px;
`;

function resolveAvatarValue(item: ExpertCatalogProjectionItem) {
  return item.avatar.kind === "emoji" ? item.avatar.value : "✨";
}

function formatCount(value: number) {
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(1)}w`;
  }
  return String(value);
}

function findOverlayForExpert(
  overlays: ExpertInstallOverlayRecord[],
  expertId: string,
) {
  return overlays.find((overlay) => overlay.expertId === expertId) ?? null;
}

function resolveExpertAgentIdentity(
  catalog: ExpertCatalog,
  item: ExpertCatalogProjectionItem,
  projectId?: string | null,
) {
  return {
    tenantId: catalog.tenantId,
    ...(projectId ? { projectId } : {}),
    expertId: item.id,
    releaseId: item.release.releaseId,
  };
}

function resolveExpertPlazaProjectId(projectId?: string | null): string | null {
  return (
    normalizeProjectId(projectId) || loadPersistedProjectId(LAST_PROJECT_ID_KEY)
  );
}

function buildExpertCatalogEvent(
  item: ExpertCatalogProjectionItem,
  catalog: ExpertCatalog,
  eventName: ExpertCatalogEventName,
  sourceSurface: string,
  metadata: Record<string, string> = {},
) {
  if (catalog.tenantId === "local-seeded" || item.source !== "cloud_catalog") {
    return null;
  }
  return {
    expertId: item.id,
    releaseId: item.release.releaseId,
    eventName,
    sourceSurface,
    catalogVersion: catalog.version,
    occurredAt: new Date().toISOString(),
    metadata: {
      category: item.category,
      installed: String(item.installed),
      ...metadata,
    },
  };
}

export function ExpertPlazaPage({
  onNavigate,
  currentProjectId,
}: ExpertPlazaPageProps) {
  const { t } = useTranslation("agent");
  const [catalog, setCatalog] = useState<ExpertCatalog>(() =>
    getSeededExpertCatalog(),
  );
  const [overlays, setOverlays] = useState<ExpertInstallOverlayRecord[]>(() =>
    readExpertInstallOverlay(),
  );
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncedFromCloud, setSyncedFromCloud] = useState(false);
  const [, setInstanceSyncVersion] = useState(0);
  const impressionKeysRef = useRef<Set<string>>(new Set());
  const projectScopedId = resolveExpertPlazaProjectId(currentProjectId);

  useEffect(() => {
    let cancelled = false;
    void getExpertCatalog({ refreshRemote: true }).then((nextCatalog) => {
      if (cancelled) {
        return;
      }
      setCatalog(nextCatalog);
      setSyncedFromCloud(nextCatalog.tenantId !== "local-seeded");
    });
    void refreshExpertAgentInstancesFromCloud()
      .then(() => {
        if (!cancelled) {
          setInstanceSyncVersion((version) => version + 1);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const projection = useMemo(
    () => buildExpertCatalogProjection(catalog, { category, query, overlays }),
    [catalog, category, overlays, query],
  );
  const selected =
    projection.items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    projection.items.slice(0, 12).forEach((item, index) => {
      const key = `${catalog.version}:${item.release.releaseId}:expert_impression`;
      if (impressionKeysRef.current.has(key)) {
        return;
      }
      impressionKeysRef.current.add(key);
      const event = buildExpertCatalogEvent(
        item,
        catalog,
        "expert_impression",
        "expert_plaza",
        {
          position: String(index + 1),
          queryActive: String(Boolean(query.trim())),
          rankingKeys: item.rankingKeys.slice(0, 3).join(","),
        },
      );
      if (event) {
        void recordExpertCatalogEvent(event);
      }
    });
  }, [catalog, projection.items, query]);

  const handleOpenDetail = (item: ExpertCatalogProjectionItem) => {
    setSelectedId(item.id);
    const event = buildExpertCatalogEvent(
      item,
      catalog,
      "expert_detail_opened",
      "expert_plaza",
      { queryActive: String(Boolean(query.trim())) },
    );
    if (event) {
      void recordExpertCatalogEvent(event);
    }
  };

  const handleInstall = (item: ExpertCatalogProjectionItem) => {
    setOverlays((current) => upsertInstalledExpert(current, item));
    const event = buildExpertCatalogEvent(
      item,
      catalog,
      "expert_installed",
      "expert_plaza",
    );
    if (event) {
      void recordExpertCatalogEvent(event);
    }
  };

  const handleStart = (item: ExpertCatalogProjectionItem) => {
    const nextOverlays = recordExpertLaunch(overlays, item);
    setOverlays(nextOverlays);
    const identity = resolveExpertAgentIdentity(catalog, item, projectScopedId);
    const existingInstance = projectScopedId
      ? findExpertAgentInstance(identity)
      : null;
    const event = buildExpertCatalogEvent(
      item,
      catalog,
      "expert_chat_started",
      "expert_plaza",
      {
        launchMode: "new_thread",
        reusedSession: "false",
      },
    );
    if (event) {
      void recordExpertCatalogEvent(event);
    }

    const starter =
      item.promptStarters[0] ||
      t("agentExperts.chat.defaultPrompt", { title: item.title });
    const noneLabel = t("agentExperts.meta.none");
    const requestMetadata = buildExpertRuntimeMetadata(item, {
      catalogVersion: catalog.version,
      tenantId: catalog.tenantId,
      overlay: findOverlayForExpert(nextOverlays, item.id),
      skillRefsOverride: existingInstance?.skillRefsOverride,
    });
    const initialUserPrompt = t("agentExperts.chat.runtimePrompt", {
      title: item.title,
      summary: item.summary,
      personaRef: item.release.personaRef,
      memoryTemplateRef: item.release.memoryTemplateRef || noneLabel,
      skillRefs: formatExpertRefList(
        requestMetadata.expert.skillRefs,
        noneLabel,
      ),
      workflowRefs: formatExpertRefList(
        requestMetadata.expert.workflowRefs,
        noneLabel,
      ),
      starter,
    });
    onNavigate?.(
      "agent",
      buildConversationParams({
        ...(projectScopedId ? { projectId: projectScopedId } : {}),
        initialUserPrompt,
        initialSessionName: item.title,
        autoRunInitialPromptOnMount: true,
        newChatAt: Date.now(),
        initialAutoSendRequestMetadata: requestMetadata,
        initialRequestMetadata: requestMetadata,
        expertAgentLaunch: {
          ...identity,
          agentInstanceKey: buildExpertAgentInstanceKey(identity),
          catalogVersion: catalog.version,
          launchMode: "new_thread",
          title: item.title,
          skillRefsOverride: existingInstance?.skillRefsOverride,
        },
      }),
    );
  };

  const readinessLabel = (item: ExpertCatalogProjectionItem) => {
    if (item.release.readiness?.missingSkillRefs?.length) {
      return t("agentExperts.readiness.missingSkills", {
        count: item.release.readiness.missingSkillRefs.length,
      });
    }
    if (item.release.readiness?.requiresProject) {
      return t("agentExperts.readiness.requiresProject");
    }
    if (item.release.readiness?.requiresBrowser) {
      return t("agentExperts.readiness.requiresBrowser");
    }
    if (item.release.readiness?.requiresModel) {
      return t("agentExperts.readiness.requiresModel");
    }
    return t("agentExperts.readiness.ready");
  };

  return (
    <Shell data-testid="expert-plaza-page">
      <Content>
        <Header>
          <TitleGroup>
            <Eyebrow>{t("agentExperts.eyebrow")}</Eyebrow>
            <Title>{t("agentExperts.title")}</Title>
            <Subtitle>{t("agentExperts.subtitle")}</Subtitle>
          </TitleGroup>
          <SyncPill>
            {syncedFromCloud
              ? t("agentExperts.sync.cloud")
              : t("agentExperts.sync.seeded")}
          </SyncPill>
        </Header>

        <RankingGrid aria-label={t("agentExperts.rankings.ariaLabel")}>
          {projection.rankings.slice(0, 3).map((ranking) => (
            <RankingCard key={ranking.key}>
              <RankingTitle>{ranking.title}</RankingTitle>
              <RankingList>
                {ranking.profiles.slice(0, 3).map((profile, index) => (
                  <RankingItem key={profile.id}>
                    <Rank>{index + 1}</Rank>
                    <span>{resolveAvatarValue(profile)}</span>
                    <span>{profile.title}</span>
                  </RankingItem>
                ))}
              </RankingList>
            </RankingCard>
          ))}
        </RankingGrid>

        <Toolbar>
          <CategoryList>
            {projection.categories.map((item) => (
              <CategoryButton
                key={item.key}
                type="button"
                $active={category === item.key}
                onClick={() => setCategory(item.key)}
              >
                {item.title}
              </CategoryButton>
            ))}
          </CategoryList>
          <SearchInput
            value={query}
            placeholder={t("agentExperts.search.placeholder")}
            aria-label={t("agentExperts.search.ariaLabel")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Toolbar>

        {projection.items.length > 0 ? (
          <CardGrid>
            {projection.items.map((item) => (
              <ExpertCard key={item.id} data-testid={`expert-card-${item.id}`}>
                <ExpertHead
                  type="button"
                  onClick={() => handleOpenDetail(item)}
                >
                  <Avatar>{resolveAvatarValue(item)}</Avatar>
                  <div>
                    <ExpertTitle>{item.title}</ExpertTitle>
                    <ExpertSummary>{item.summary}</ExpertSummary>
                  </div>
                </ExpertHead>
                <CardMeta>
                  <span>
                    {formatCount(item.stats.usageCount)}{" "}
                    {t("agentExperts.meta.usage")}
                  </span>
                  <span>
                    {formatCount(item.stats.likeCount)}{" "}
                    {t("agentExperts.meta.likes")}
                  </span>
                  {item.tags.slice(0, 2).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                  <Tag>{readinessLabel(item)}</Tag>
                </CardMeta>
                <ActionRow>
                  <PrimaryButton
                    type="button"
                    data-testid={`expert-start-${item.id}`}
                    onClick={() => handleStart(item)}
                  >
                    {t("agentExperts.actions.start")}
                  </PrimaryButton>
                  <SecondaryButton
                    type="button"
                    data-testid={`expert-add-${item.id}`}
                    onClick={() => handleInstall(item)}
                  >
                    {item.installed
                      ? t("agentExperts.actions.installed")
                      : t("agentExperts.actions.add")}
                  </SecondaryButton>
                </ActionRow>
              </ExpertCard>
            ))}
          </CardGrid>
        ) : (
          <EmptyState>{t("agentExperts.empty")}</EmptyState>
        )}
      </Content>

      {selected ? (
        <DetailOverlay role="dialog" aria-modal="true">
          <DetailDialog>
            <DetailMain>
              <DetailTitleRow>
                <TitleGroup>
                  <Eyebrow>{selected.category}</Eyebrow>
                  <Title>{selected.title}</Title>
                  <Subtitle>{selected.summary}</Subtitle>
                </TitleGroup>
                <CloseButton type="button" onClick={() => setSelectedId(null)}>
                  {t("agentExperts.detail.close")}
                </CloseButton>
              </DetailTitleRow>
              {selected.showcase.map((showcase) => (
                <DetailBlock key={showcase.title}>
                  <DetailBlockTitle>{showcase.title}</DetailBlockTitle>
                  <ExpertSummary>{showcase.body}</ExpertSummary>
                </DetailBlock>
              ))}
              <DetailBlock>
                <DetailBlockTitle>
                  {t("agentExperts.detail.workflow")}
                </DetailBlockTitle>
                <ExpertSummary>
                  {selected.release.workflowRefs.join(" · ")}
                </ExpertSummary>
              </DetailBlock>
              <DetailBlock>
                <DetailBlockTitle>
                  {t("agentExperts.detail.memory")}
                </DetailBlockTitle>
                <ExpertSummary>
                  {selected.release.memoryTemplateRef ||
                    t("agentExperts.meta.none")}
                </ExpertSummary>
              </DetailBlock>
            </DetailMain>
            <DetailSide>
              <Avatar>{resolveAvatarValue(selected)}</Avatar>
              <ExpertTitle>{selected.title}</ExpertTitle>
              <ExpertSummary>{selected.summary}</ExpertSummary>
              <Tag>{readinessLabel(selected)}</Tag>
              <CardMeta>
                {selected.release.skillRefs.map((skillRef) => (
                  <Tag key={skillRef}>{skillRef}</Tag>
                ))}
              </CardMeta>
              <DetailActions
                data-testid={`expert-detail-actions-${selected.id}`}
              >
                <DetailPrimaryButton
                  type="button"
                  data-testid={`expert-detail-start-${selected.id}`}
                  onClick={() => handleStart(selected)}
                >
                  {t("agentExperts.actions.start")}
                </DetailPrimaryButton>
              </DetailActions>
            </DetailSide>
          </DetailDialog>
        </DetailOverlay>
      ) : null}
    </Shell>
  );
}
