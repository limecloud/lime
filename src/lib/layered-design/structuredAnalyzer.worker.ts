import {
  createLayeredDesignSimpleCleanPlateProvider,
  createLayeredDesignWorkerCleanPlateRefinerFromProvider,
} from "./cleanPlate";
import { installLayeredDesignStructuredAnalyzerWorkerRuntime } from "./structuredAnalyzerWorker";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";
import {
  createLayeredDesignSimpleSubjectMattingProvider,
  createLayeredDesignSubjectMaskRefinerFromMattingProvider,
} from "./subjectMatting";

installLayeredDesignStructuredAnalyzerWorkerRuntime(
  self,
  createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
    subjectMaskRefiner: createLayeredDesignSubjectMaskRefinerFromMattingProvider(
      createLayeredDesignSimpleSubjectMattingProvider({
        label: "Worker simple subject matting provider",
        confidence: 0.94,
      }),
    ),
    cleanPlateRefiner: createLayeredDesignWorkerCleanPlateRefinerFromProvider(
      createLayeredDesignSimpleCleanPlateProvider(),
    ),
  }),
);
