import type { ReactNode } from "react";
import styled from "styled-components";
import { Trans, useTranslation } from "react-i18next";
import { LIME_BRAND_LOGO_SRC } from "@/lib/branding";
import {
  EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME,
  EMPTY_STATE_PAGE_CONTAINER_CLASSNAME,
} from "./emptyStateSurfaceTokens";

const PageContainer = styled.div.attrs({
  className: EMPTY_STATE_PAGE_CONTAINER_CLASSNAME,
})`
  container-type: size;
  overscroll-behavior: contain;
  background: var(--lime-stage-surface, hsl(var(--background)));
`;

const ContentWrapper = styled.div.attrs({
  className: EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME,
})`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
  flex: 0 0 auto;
  padding: 16px var(--lime-panel-padding, 24px) 12px;
`;

const Welcome = styled.div`
  display: flex;
  min-height: 7rem;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 1.5rem 0;
  color: var(--lime-text-strong);

  img {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }

  h1 {
    margin: 0;
    max-width: 100%;
    font-size: 2rem;
    font-weight: 400;
    line-height: 2.375rem;
    text-align: center;
    overflow-wrap: anywhere;
  }
`;

const ProjectSelectButton = styled.button`
  display: inline;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: inherit;
  cursor: pointer;
  text-decoration: underline dotted;
  text-decoration-color: var(--lime-text-muted);
  text-underline-offset: 4px;
  overflow-wrap: anywhere;

  &:hover {
    color: var(--lime-text-strong);
    text-decoration-style: solid;
  }

  &:focus-visible {
    outline: 2px solid var(--lime-brand-strong);
    outline-offset: 2px;
    border-radius: 2px;
  }
`;

const ComposerFrame = styled.div`
  position: relative;
  min-width: 0;
`;

const ComposerRegion = styled.div`
  position: relative;
  z-index: 50;
  display: flex;
  width: min(100%, 46rem);
  min-width: 0;
  min-height: fit-content;
  flex-direction: column;
  justify-content: flex-end;
  align-self: center;
  justify-self: center;
`;

export function EmptyStateComposerFrame({ children }: { children: ReactNode }) {
  return (
    <ComposerFrame data-testid="empty-state-composer-frame">
      {children}
    </ComposerFrame>
  );
}

interface EmptyStateLayoutProps {
  composer: ReactNode;
  children?: ReactNode;
  projectName?: string | null;
  onProjectSelect?: () => void;
}

export function EmptyStateLayout({
  composer,
  children,
  projectName,
  onProjectSelect,
}: EmptyStateLayoutProps) {
  const { t } = useTranslation("agent");
  const normalizedProjectName = projectName?.trim() ?? "";
  const title = normalizedProjectName ? (
    <Trans
      ns="agent"
      t={t}
      i18nKey="agentChat.home.titleInProject"
      values={{ projectName: normalizedProjectName }}
      components={{
        projectSelect: onProjectSelect ? (
          <ProjectSelectButton
            type="button"
            data-testid="home-hero-project-select"
            onClick={onProjectSelect}
          />
        ) : (
          <span />
        ),
      }}
    />
  ) : (
    t("agentChat.home.title")
  );
  return (
    <PageContainer data-testid="home-composer-page">
      <ContentWrapper data-testid="empty-state-first-screen">
        <Welcome data-testid="home-welcome">
          <img src={LIME_BRAND_LOGO_SRC} alt="" aria-hidden="true" />
          <h1>{title}</h1>
        </Welcome>
        <ComposerRegion>{composer}</ComposerRegion>
      </ContentWrapper>
      {children}
    </PageContainer>
  );
}
