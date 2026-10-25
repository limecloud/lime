import type { ReactNode } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
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
  min-height: 120px;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px 0;
  color: var(--lime-text-strong);

  img {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 500;
    line-height: 1.4;
    text-align: center;
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
  width: min(100%, 36rem);
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
}

export function EmptyStateLayout({
  composer,
  children,
}: EmptyStateLayoutProps) {
  const { t } = useTranslation("agent");
  return (
    <PageContainer data-testid="home-composer-page">
      <ContentWrapper data-testid="empty-state-first-screen">
        <Welcome data-testid="home-welcome">
          <img src={LIME_BRAND_LOGO_SRC} alt="" aria-hidden="true" />
          <h1>{t("agentChat.home.title")}</h1>
        </Welcome>
        <ComposerRegion>{composer}</ComposerRegion>
      </ContentWrapper>
      {children}
    </PageContainer>
  );
}
