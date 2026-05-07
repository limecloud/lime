import { createLayeredDesignDeterministicTextOcrProvider } from "./textOcr";
import { installLayeredDesignTextOcrWorkerRuntime } from "./textOcrWorker";

installLayeredDesignTextOcrWorkerRuntime(
  self,
  createLayeredDesignDeterministicTextOcrProvider({
    label: "Worker deterministic OCR provider",
    text: "WORKER OCR TEXT",
    confidence: 0.93,
  }),
);
