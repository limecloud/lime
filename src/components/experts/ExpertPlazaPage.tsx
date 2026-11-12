import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import {
  cloudAccountIdentity,
  cloudAccountIdentityVersion,
  getCloudAccount,
} from "@/lib/cloudAccount";
import { useExpertCatalog } from "./useExpertCatalog";
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
  readExpertInstructions,
  recordExpertLaunch,
  recordExpertCatalogEvent,
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
  color: var(--lime-text-strong);

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

const Title = styled.h1`
  margin: 0;
  color: var(--lime-text-strong);
  font-size: 18px;
  letter-spacing: -0.03em;
`;

const Subtitle = styled.p`
  margin: 0;
  max-width: 680px;
  color: var(--lime-text-muted);
  font-size: 14px;
  line-height: 1.7;
`;

const SyncPill = styled.span`
  border-radius: 8px;
  border: 0.5px solid var(--lime-surface-border-strong);
  background: var(--lime-surface);
  padding: 8px 12px;
  color: var(--lime-text);
  font-size: 12px;
  font-weight: 680;
`;

const Toolbar = styled.section`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 0.5px solid var(--lime-surface-border);
  border-radius: 8px;
  background: var(--lime-surface);
  padding: 12px;
`;

const CategoryList = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
`;

const CategoryButton = styled.button<{ $active: boolean }>`
  border: 0.5px solid
    ${(props) =>
      props.$active ? "var(--lime-brand)" : "var(--lime-surface-border)"};
  border-radius: 8px;
  background: ${(props) =>
    props.$active ? "var(--lime-brand-soft)" : "var(--lime-surface-soft)"};
  padding: 7px 12px;
  color: ${(props) =>
    props.$active ? "var(--lime-brand-strong)" : "var(--lime-text)"};
  font-size: 12px;
  font-weight: 720;
  cursor: pointer;

  &:hover {
    border-color: var(--lime-brand);
    background: var(--lime-surface-hover);
    color: var(--lime-brand-strong);
  }
`;

const SearchInput = styled.input`
  flex: 1 1 240px;
  min-height: 36px;
  min-width: 0;
  width: min(320px, 100%);
  border: 0.5px solid var(--lime-surface-border);
  border-radius: 8px;
  background: var(--lime-surface-soft);
  padding: 0 14px;
  color: var(--lime-text-strong);
  outline: none;

  &::placeholder {
    color: var(--lime-text-muted);
  }

  &:focus {
    border-color: var(--lime-brand);
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
  border: 0.5px solid var(--lime-card-subtle-border);
  border-radius: 8px;
  background: var(--lime-surface);
  padding: 18px;

  &:hover {
    border-color: var(
      --lime-surface-border-strong,
      var(--lime-surface-border-strong)
    );
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
  border-radius: 8px;
  background: var(--lime-brand-soft);
  font-size: 18px;
`;

const ExpertTitle = styled.h3`
  margin: 0;
  color: var(--lime-text-strong);
  font-size: 14px;
  overflow-wrap: anywhere;
`;

const ExpertSummary = styled.p`
  margin: 6px 0 0;
  color: var(--lime-text-muted);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
`;

const CardMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--lime-text-muted);
  font-size: 12px;
`;

const Tag = styled.span`
  border-radius: 8px;
  background: var(--lime-surface-muted);
  padding: 5px 8px;
  color: var(--lime-text);
  font-size: 12px;
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
  border: 0.5px solid
    color-mix(in srgb, var(--lime-brand) 72%, var(--lime-surface-border));
  border-radius: 8px;
  background: hsl(var(--primary));
  padding: 0 14px;
  color: hsl(var(--primary-foreground));
  font-size: 12px;
  font-weight: 760;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: var(--lime-brand-muted);
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const SecondaryButton = styled.button`
  display: inline-flex;
  min-height: 38px;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 0.5px solid
    color-mix(in srgb, var(--lime-brand) 24%, var(--lime-surface-border));
  border-radius: 8px;
  background: color-mix(
    in srgb,
    var(--lime-brand-soft) 58%,
    var(--lime-surface)
  );
  padding: 0 14px;
  color: var(--lime-brand-strong);
  font-size: 12px;
  font-weight: 720;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    border-color: color-mix(
      in srgb,
      var(--lime-brand) 52%,
      var(--lime-surface-border)
    );
    background: color-mix(
      in srgb,
      var(--lime-brand-soft) 78%,
      var(--lime-surface)
    );
    color: var(--lime-brand-strong);
  }
`;

const EmptyState = styled.div`
  border: 0.5px dashed var(--lime-surface-border-strong);
  border-radius: 8px;
  background: var(--lime-surface);
  padding: 34px;
  text-align: center;
  color: var(--lime-text-muted);
`;

const DetailOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--lime-text-strong) 40%, transparent);
  padding: 24px;
`;

const DetailDialog = styled.div`
  display: grid;
  width: min(980px, 100%);
  max-height: min(720px, 88vh);
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 18px;
  overflow: auto;
  border: 0.5px solid var(--lime-card-subtle-border);
  border-radius: 8px;
  background: var(--lime-surface);
  padding: 24px;

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
  border-radius: 8px;
  background: var(--lime-surface);
  padding: 16px;
`;

const DetailActions = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-top: 6px;
  border-top: 1px solid
    color-mix(in srgb, var(--lime-brand) 16%, var(--lime-surface-border));
  padding-top: 12px;
`;

const DetailPrimaryButton = styled(PrimaryButton)`
  width: 100%;
  min-height: 44px;
  padding: 0 18px;
  font-size: 12px;
`;

const DetailTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const CloseButton = styled.button`
  border: 0.5px solid var(--lime-surface-border);
  border-radius: 8px;
  background: var(--lime-surface);
  padding: 8px 10px;
  color: var(--lime-text);
  cursor: pointer;

  &:hover {
    border-color: var(--lime-brand);
    background: var(--lime-brand-soft);
    color: var(--lime-brand-strong);
  }
`;

const DetailBlock = styled.section`
  border: 0.5px solid var(--lime-surface-border);
  border-radius: 8px;
  background: var(--lime-surface-soft);
  padding: 14px;
`;

const DetailBlockTitle = styled.h4`
  margin: 0 0 8px;
  color: var(--lime-text-strong);
  font-size: 12px;
`;

function resolveAvatarValue(item: ExpertCatalogProjectionItem) {
  return item.avatar.kind === "emoji" ? item.avatar.value : "✨";
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
    catalogId: catalog.catalogId,
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
  if (catalog.catalogId === "local-seeded" || item.source !== "cloud_catalog") {
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
  const { t, i18n } = useTranslation("agent");
  const { catalog, loading, failed, retry } = useExpertCatalog(i18n.language);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchFailed, setLaunchFailed] = useState(false);
  const [overlays, setOverlays] = useState<ExpertInstallOverlayRecord[]>(() =>
    readExpertInstallOverlay(),
  );
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const syncedFromCloud = catalog.catalogId !== "local-seeded";
  const impressionKeysRef = useRef<Set<string>>(new Set());
  const projectScopedId = resolveExpertPlazaProjectId(currentProjectId);
  const launchEpoch = useRef(0);
  useEffect(() => {
    setLaunching(null);
    setLaunchFailed(false);
    return () => {
      launchEpoch.current += 1;
    };
  }, [catalog.catalogId, catalog.version, projectScopedId, i18n.language]);

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

  const handleStart = async (item: ExpertCatalogProjectionItem) => {
    if (launching) return;
    const epoch = launchEpoch.current;
    const identityVersion = cloudAccountIdentityVersion();
    const accountIdentity = cloudAccountIdentity(getCloudAccount());
    setLaunching(item.id);
    setLaunchFailed(false);
    try {
      const instructions = await readExpertInstructions(item);
      if (
        epoch !== launchEpoch.current ||
        identityVersion !== cloudAccountIdentityVersion() ||
        accountIdentity !== cloudAccountIdentity(getCloudAccount())
      )
        return;
      const nextOverlays = recordExpertLaunch(overlays, item);
      setOverlays(nextOverlays);
      const identity = resolveExpertAgentIdentity(
        catalog,
        item,
        projectScopedId,
      );
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
        catalogId: catalog.catalogId,
        overlay: findOverlayForExpert(nextOverlays, item.id),
        skillRefsOverride: existingInstance?.skillRefsOverride,
      });
      const runtimePrompt = t("agentExperts.chat.runtimePrompt", {
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
      const initialUserPrompt = instructions
        ? [instructions, starter].join("\n\n")
        : runtimePrompt;
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
    } catch {
      if (epoch === launchEpoch.current) setLaunchFailed(true);
    } finally {
      if (epoch === launchEpoch.current) setLaunching(null);
    }
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
            <Title>{t("agentExperts.title")}</Title>
          </TitleGroup>
          <SyncPill>
            {syncedFromCloud
              ? t("agentExperts.sync.cloud")
              : t("agentExperts.sync.seeded")}
          </SyncPill>
        </Header>

        {loading ? <p role="status">{t("agentExperts.loading")}</p> : null}
        {failed ? (
          <div role="alert">
            {t("agentExperts.loadFailed")}{" "}
            <SecondaryButton type="button" onClick={retry}>
              {t("agentExperts.retry")}
            </SecondaryButton>
          </div>
        ) : null}
        {launchFailed ? (
          <p role="alert">{t("agentExperts.launchFailed")}</p>
        ) : null}

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
                  {item.tags.slice(0, 2).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                  <Tag>{readinessLabel(item)}</Tag>
                </CardMeta>
                <ActionRow>
                  <PrimaryButton
                    type="button"
                    data-testid={`expert-start-${item.id}`}
                    disabled={launching !== null}
                    onClick={() => void handleStart(item)}
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
                  {selected.release.workflowRefs.join("、")}
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
                  disabled={launching !== null}
                  onClick={() => void handleStart(selected)}
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
