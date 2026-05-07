import { useMemo, useState } from "react";
import styled from "styled-components";
import { createCanvasStateFromArtifact } from "@/components/artifact/canvasAdapterUtils";
import {
  CanvasFactory,
  createInitialDesignCanvasState,
  type CanvasStateUnion,
} from "@/lib/workspace/workbenchCanvas";
import {
  LAYERED_DESIGN_DEFAULT_MODEL_SLOT_TEXT_OCR_PRIORITY_LABEL,
  createLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProviders,
  createLayeredDesignFlatImageAnalyzerFromStructuredProvider,
  createLayeredDesignArtifactFromPrompt,
  createLayeredDesignDeterministicSubjectMattingProvider,
  createLayeredDesignDeterministicTextOcrProvider,
  createLayeredDesignNativeStructuredAnalyzerProvider,
  createLayeredDesignPrioritizedTextOcrProvider,
  createLayeredDesignSubjectMaskRefinerFromMattingProvider,
  createLayeredDesignWorkerCleanPlateProvider,
  createLayeredDesignWorkerCleanPlateRefinerFromProvider,
  createLayeredDesignWorkerHeuristicAnalyzer,
  createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider,
  createLayeredDesignWorkerSubjectMattingProvider,
  createLayeredDesignWorkerTextOcrProvider,
  createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider,
  installLayeredDesignStructuredAnalyzerWorkerRuntime,
  type LayeredDesignFlatImageStructuredAnalyzerProvider,
  type LayeredDesignAnalyzerModelSlotConfigInput,
  type LayeredDesignStructuredAnalyzerWorkerMessageListener,
  type LayeredDesignStructuredAnalyzerWorkerRequest,
  type LayeredDesignStructuredAnalyzerWorkerResponse,
} from "@/lib/layered-design";

const SMOKE_CREATED_AT = "2026-05-05T00:00:00.000Z";
const WORKER_REFINED_TEXT = "WORKER REFINED TEXT";
const WORKER_OCR_TEXT = "WORKER OCR TEXT";
const WORKER_REFINED_SUBJECT_CONFIDENCE = 0.93;
const WORKER_MATTING_SUBJECT_CONFIDENCE = 0.94;
const WORKER_REFINED_FIXTURE_LABEL =
  "Subject matting / TextLayer / Logo / 背景碎片 refined seams fixture";
const WORKER_MATTING_FIXTURE_LABEL =
  "Subject matting browser Worker provider fixture";
const WORKER_OCR_FIXTURE_LABEL = "Text OCR browser Worker provider fixture";
const WORKER_OCR_PRIORITY_FIRST_LABEL = "Smoke failing OCR provider";
const WORKER_OCR_PRIORITY_EMPTY_LABEL = "Smoke empty OCR provider";
const WORKER_OCR_PRIORITY_WORKER_LABEL =
  "Smoke OCR priority browser Worker provider";
const WORKER_OCR_PRIORITY_FIXTURE_LABEL =
  "Text OCR priority provider fixture";
const WORKER_OCR_PRIORITY_LABEL = `OCR priority: ${WORKER_OCR_PRIORITY_FIRST_LABEL} -> ${WORKER_OCR_PRIORITY_EMPTY_LABEL} -> ${WORKER_OCR_PRIORITY_WORKER_LABEL}`;
const WORKER_CLEAN_PLATE_FIXTURE_LABEL =
  "Clean plate browser Worker provider fixture";
const WORKER_MODEL_SLOTS_FIXTURE_LABEL =
  "Analyzer model slots provider JSON executor fixture";
const WORKER_MODEL_SLOTS_NATIVE_OCR_FIXTURE_LABEL =
  "Analyzer model slots native OCR JSON executor fixture";
const WORKER_MODEL_SLOT_OCR_TEXT = WORKER_OCR_TEXT;
const WORKER_MODEL_SLOT_NATIVE_OCR_PRIORITY_LABEL =
  LAYERED_DESIGN_DEFAULT_MODEL_SLOT_TEXT_OCR_PRIORITY_LABEL;
const WORKER_MODEL_SLOT_CONFIGS: readonly LayeredDesignAnalyzerModelSlotConfigInput[] =
  [
    {
      id: "smoke-subject-matting-slot",
      kind: "subject_matting",
      label: "Smoke model slot subject matting",
      execution: "remote_model",
      modelId: "smoke-subject-matting-slot-v1",
      metadata: {
        providerId: "smoke-model-slot",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
    {
      id: "smoke-clean-plate-slot",
      kind: "clean_plate",
      label: "Smoke model slot clean plate",
      execution: "remote_model",
      modelId: "smoke-clean-plate-slot-v1",
      metadata: {
        providerId: "smoke-model-slot",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
    {
      id: "smoke-ocr-slot",
      kind: "text_ocr",
      label: "Smoke model slot OCR",
      execution: "remote_model",
      modelId: "smoke-ocr-slot-v1",
      metadata: {
        providerId: "smoke-model-slot",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
  ];
type SmokeAnalyzerMode =
  | "default"
  | "native"
  | "worker"
  | "worker-refined"
  | "worker-matting"
  | "worker-ocr"
  | "worker-ocr-priority"
  | "worker-clean-plate"
  | "worker-model-slots"
  | "worker-model-slots-native-ocr";

const analyzerBadgeLabels: Record<SmokeAnalyzerMode, string> = {
  default: "默认 analyzer",
  native: "Native analyzer 已启用",
  worker: "Worker analyzer 已启用",
  "worker-refined": "Worker refined analyzer 已启用",
  "worker-matting": "Worker subject matting analyzer 已启用",
  "worker-ocr": "Worker OCR analyzer 已启用",
  "worker-ocr-priority": "Worker OCR priority analyzer 已启用",
  "worker-clean-plate": "Worker clean plate analyzer 已启用",
  "worker-model-slots": "Worker model slots analyzer 已启用",
  "worker-model-slots-native-ocr": "Worker model slots native OCR analyzer 已启用",
};

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

function resolveAnalyzerMode(value: string | null): SmokeAnalyzerMode {
  if (
    value === "native" ||
    value === "worker" ||
    value === "worker-refined" ||
    value === "worker-matting" ||
    value === "worker-ocr" ||
    value === "worker-ocr-priority" ||
    value === "worker-clean-plate" ||
    value === "worker-model-slots" ||
    value === "worker-model-slots-native-ocr"
  ) {
    return value;
  }

  return "default";
}

class SmokeStructuredAnalyzerWorker {
  private readonly clientListeners =
    new Set<LayeredDesignStructuredAnalyzerWorkerMessageListener>();
  private readonly runtimeListeners =
    new Set<LayeredDesignStructuredAnalyzerWorkerMessageListener>();
  private readonly disposeRuntime: () => void;

  constructor(provider: LayeredDesignFlatImageStructuredAnalyzerProvider) {
    this.disposeRuntime = installLayeredDesignStructuredAnalyzerWorkerRuntime(
      {
        postMessage: (message) => this.emitToClient(message),
        addEventListener: (_type, listener) => {
          this.runtimeListeners.add(listener);
        },
        removeEventListener: (_type, listener) => {
          this.runtimeListeners.delete(listener);
        },
      },
      provider,
    );
  }

  postMessage(message: LayeredDesignStructuredAnalyzerWorkerRequest) {
    queueMicrotask(() => {
      for (const listener of this.runtimeListeners) {
        listener({ data: message });
      }
    });
  }

  addEventListener(
    _type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) {
    this.clientListeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) {
    this.clientListeners.delete(listener);
  }

  terminate() {
    this.disposeRuntime();
    this.clientListeners.clear();
    this.runtimeListeners.clear();
  }

  private emitToClient(message: LayeredDesignStructuredAnalyzerWorkerResponse) {
    queueMicrotask(() => {
      for (const listener of this.clientListeners) {
        listener({ data: message });
      }
    });
  }
}

function createSmokeRefinedWorkerAnalyzer() {
  return createLayeredDesignWorkerHeuristicAnalyzer({
    fallbackAnalyzer: null,
    workerFactory: () =>
      new SmokeStructuredAnalyzerWorker(
        createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
          subjectMaskRefiner:
            createLayeredDesignSubjectMaskRefinerFromMattingProvider(
              createLayeredDesignDeterministicSubjectMattingProvider({
                label: "Smoke deterministic subject matting provider",
                confidence: WORKER_REFINED_SUBJECT_CONFIDENCE,
              }),
            ),
          textCandidateExtractor:
            createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(
              createLayeredDesignDeterministicTextOcrProvider({
                label: "Smoke deterministic OCR provider",
                text: WORKER_REFINED_TEXT,
                confidence: 0.92,
              }),
            ),
          logoCandidateRefiner: async (input) => ({
            imageSrc: input.candidate.crop.src,
            confidence: 0.78,
            hasAlpha: true,
          }),
          backgroundFragmentRefiner: async (input) => ({
            imageSrc: input.candidate.crop.src,
            confidence: 0.68,
            hasAlpha: true,
          }),
        }),
      ),
  });
}

function createSmokeSubjectMattingWorkerAnalyzer() {
  return createLayeredDesignWorkerHeuristicAnalyzer({
    fallbackAnalyzer: null,
    workerFactory: () =>
      new SmokeStructuredAnalyzerWorker(
        createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
          subjectMaskRefiner:
            createLayeredDesignSubjectMaskRefinerFromMattingProvider(
              createLayeredDesignWorkerSubjectMattingProvider({
                label: "Smoke subject matting browser Worker provider",
                fallbackProvider: null,
              }),
            ),
        }),
      ),
  });
}

function createSmokeTextOcrWorkerAnalyzer() {
  return createLayeredDesignWorkerHeuristicAnalyzer({
    fallbackAnalyzer: null,
    workerFactory: () =>
      new SmokeStructuredAnalyzerWorker(
        createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
          textCandidateExtractor:
            createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(
              createLayeredDesignWorkerTextOcrProvider({
                label: "Smoke OCR browser Worker provider",
                fallbackProvider: null,
              }),
            ),
        }),
      ),
  });
}

function createSmokeTextOcrPriorityWorkerAnalyzer() {
  const priorityProvider = createLayeredDesignPrioritizedTextOcrProvider([
    {
      label: WORKER_OCR_PRIORITY_FIRST_LABEL,
      detectText: async () => {
        throw new Error("Smoke priority OCR source unavailable");
      },
    },
    createLayeredDesignDeterministicTextOcrProvider({
      label: WORKER_OCR_PRIORITY_EMPTY_LABEL,
      text: "",
    }),
    createLayeredDesignWorkerTextOcrProvider({
      label: WORKER_OCR_PRIORITY_WORKER_LABEL,
      fallbackProvider: null,
    }),
  ]);

  return createLayeredDesignWorkerHeuristicAnalyzer({
    fallbackAnalyzer: null,
    workerFactory: () =>
      new SmokeStructuredAnalyzerWorker(
        createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
          textCandidateExtractor:
            createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(
              priorityProvider,
            ),
        }),
      ),
  });
}

function createSmokeCleanPlateWorkerAnalyzer() {
  return createLayeredDesignWorkerHeuristicAnalyzer({
    fallbackAnalyzer: null,
    workerFactory: () =>
      new SmokeStructuredAnalyzerWorker(
        createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
          cleanPlateRefiner:
            createLayeredDesignWorkerCleanPlateRefinerFromProvider(
              createLayeredDesignWorkerCleanPlateProvider({
                label: "Smoke clean plate browser Worker provider",
                fallbackProvider: null,
              }),
            ),
        }),
      ),
  });
}

function createSmokeModelSlotsWorkerAnalyzer(useNativeOcr = false) {
  return createLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProviders(
    WORKER_MODEL_SLOT_CONFIGS,
    {
      fallbackAnalyzer: null,
      modelSlotTextOcrProvider: useNativeOcr
        ? undefined
        : createLayeredDesignWorkerTextOcrProvider({
            label: "Worker OCR provider via model slot JSON executor",
            fallbackProvider: null,
          }),
    },
  );
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
  const analyzerMode = useMemo(
    () => resolveAnalyzerMode(readSearchParam("analyzer")),
    [],
  );
  const analyzeFlatImage = useMemo(() => {
    if (analyzerMode === "native") {
      return createLayeredDesignFlatImageAnalyzerFromStructuredProvider(
        createLayeredDesignNativeStructuredAnalyzerProvider(),
      );
    }
    if (analyzerMode === "worker") {
      return createLayeredDesignWorkerHeuristicAnalyzer();
    }
    if (analyzerMode === "worker-refined") {
      return createSmokeRefinedWorkerAnalyzer();
    }
    if (analyzerMode === "worker-matting") {
      return createSmokeSubjectMattingWorkerAnalyzer();
    }
    if (analyzerMode === "worker-ocr") {
      return createSmokeTextOcrWorkerAnalyzer();
    }
    if (analyzerMode === "worker-ocr-priority") {
      return createSmokeTextOcrPriorityWorkerAnalyzer();
    }
    if (analyzerMode === "worker-clean-plate") {
      return createSmokeCleanPlateWorkerAnalyzer();
    }
    if (analyzerMode === "worker-model-slots") {
      return createSmokeModelSlotsWorkerAnalyzer();
    }
    if (analyzerMode === "worker-model-slots-native-ocr") {
      return createSmokeModelSlotsWorkerAnalyzer(true);
    }

    return undefined;
  }, [analyzerMode]);
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
          <Badge data-testid="design-canvas-smoke-analyzer">
            {analyzerBadgeLabels[analyzerMode]}
          </Badge>
          {analyzerMode === "worker-refined" ? (
            <Badge>{WORKER_REFINED_FIXTURE_LABEL}</Badge>
          ) : null}
          {analyzerMode === "worker-matting" ? (
            <Badge>
              {WORKER_MATTING_FIXTURE_LABEL} / 置信度{" "}
              {Math.round(WORKER_MATTING_SUBJECT_CONFIDENCE * 100)}%
            </Badge>
          ) : null}
          {analyzerMode === "worker-ocr" ? (
            <Badge>
              {WORKER_OCR_FIXTURE_LABEL} / {WORKER_OCR_TEXT}
            </Badge>
          ) : null}
          {analyzerMode === "worker-ocr-priority" ? (
            <Badge>
              {WORKER_OCR_PRIORITY_FIXTURE_LABEL} / {WORKER_OCR_PRIORITY_LABEL} /{" "}
              {WORKER_OCR_TEXT}
            </Badge>
          ) : null}
          {analyzerMode === "worker-clean-plate" ? (
            <Badge>{WORKER_CLEAN_PLATE_FIXTURE_LABEL}</Badge>
          ) : null}
          {analyzerMode === "worker-model-slots" ? (
            <Badge>
              {WORKER_MODEL_SLOTS_FIXTURE_LABEL} / {WORKER_MODEL_SLOT_OCR_TEXT}
            </Badge>
          ) : null}
          {analyzerMode === "worker-model-slots-native-ocr" ? (
            <Badge>
              {WORKER_MODEL_SLOTS_NATIVE_OCR_FIXTURE_LABEL} /{" "}
              {WORKER_MODEL_SLOT_NATIVE_OCR_PRIORITY_LABEL} /{" "}
              {WORKER_MODEL_SLOT_OCR_TEXT}
            </Badge>
          ) : null}
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
            designAnalyzeFlatImage={analyzeFlatImage}
            designAnalyzerModelSlotConfigs={
              analyzerMode === "worker-model-slots" ||
              analyzerMode === "worker-model-slots-native-ocr"
                ? WORKER_MODEL_SLOT_CONFIGS
                : undefined
            }
          />
        </CanvasCard>
      </CanvasHost>
    </Page>
  );
}
