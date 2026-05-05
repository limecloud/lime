import { useMemo, useState } from "react";
import styled from "styled-components";
import { createCanvasStateFromArtifact } from "@/components/artifact/canvasAdapterUtils";
import {
  CanvasFactory,
  createInitialDesignCanvasState,
  type CanvasStateUnion,
} from "@/lib/workspace/workbenchCanvas";
import { createLayeredDesignArtifactFromPrompt } from "@/lib/layered-design";

const SMOKE_CREATED_AT = "2026-05-05T00:00:00.000Z";

const smokeArtifact = createLayeredDesignArtifactFromPrompt(
  "@海报 为 Lime AI 图层化设计生成一张咖啡快闪活动海报，保留背景、主体、氛围特效、标题和 CTA 独立图层",
  {
    id: "design-canvas-smoke",
    title: "Smoke 图层设计海报",
    artifactId: "artifact-design-canvas-smoke",
    artifactTitle: "Smoke 图层设计海报",
    documentCreatedAt: SMOKE_CREATED_AT,
    timestamp: Date.parse(SMOKE_CREATED_AT),
  },
);

function readSearchParam(name: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = new URLSearchParams(window.location.search).get(name)?.trim();
  return value || null;
}

function createSmokeCanvasState(): CanvasStateUnion {
  return createCanvasStateFromArtifact(smokeArtifact) ?? createInitialDesignCanvasState();
}

const Page = styled.main`
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  background:
    radial-gradient(circle at 12% 10%, rgba(14, 165, 233, 0.16), transparent 28%),
    linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  color: #0f172a;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.36);
  background: rgba(255, 255, 255, 0.82);
  padding: 18px 24px;
`;

const TitleGroup = styled.div`
  min-width: 0;
`;

const Eyebrow = styled.div`
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const Title = styled.h1`
  margin: 4px 0 0;
  font-size: 20px;
  line-height: 1.2;
`;

const BadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
`;

const Badge = styled.span`
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 7px 10px;
`;

const CanvasHost = styled.section`
  min-height: 0;
  flex: 1;
  padding: 18px;
`;

const CanvasCard = styled.div`
  height: calc(100vh - 116px);
  min-height: 620px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 28px;
  background: white;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
`;

export function DesignCanvasSmokePage() {
  const projectRootPath = useMemo(() => readSearchParam("projectRootPath"), []);
  const projectId = useMemo(() => readSearchParam("projectId"), []);
  const [state, setState] = useState<CanvasStateUnion>(() =>
    createSmokeCanvasState(),
  );

  return (
    <Page data-testid="design-canvas-smoke-page">
      <Header>
        <TitleGroup>
          <Eyebrow>canvas:design 专属 GUI Smoke</Eyebrow>
          <Title>AI 图层化设计画布</Title>
        </TitleGroup>
        <BadgeRow>
          <Badge data-testid="design-canvas-smoke-artifact-type">
            {smokeArtifact.type}
          </Badge>
          <Badge>LayeredDesignDocument</Badge>
          <Badge>
            {projectRootPath ? "工作区已绑定" : "工作区未绑定，仅验证画布"}
          </Badge>
        </BadgeRow>
      </Header>

      <CanvasHost>
        <CanvasCard>
          <CanvasFactory
            theme="general"
            state={state}
            onStateChange={setState}
            onBackHome={() => undefined}
            onClose={() => undefined}
            projectRootPath={projectRootPath}
            projectId={projectId}
            contentId="design-canvas-smoke"
          />
        </CanvasCard>
      </CanvasHost>
    </Page>
  );
}
