import { createLayeredDesignSimpleSubjectMattingProvider } from "./subjectMatting";
import { installLayeredDesignSubjectMattingWorkerRuntime } from "./subjectMattingWorker";

installLayeredDesignSubjectMattingWorkerRuntime(
  self,
  createLayeredDesignSimpleSubjectMattingProvider({
    label: "Worker simple subject matting provider",
    confidence: 0.94,
  }),
);
