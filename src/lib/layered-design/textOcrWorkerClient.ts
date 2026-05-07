import type { LayeredDesignFlatImageTextOcrProvider } from "./analyzer";
import { createLayeredDesignDeterministicTextOcrProvider } from "./textOcr";
import {
  createLayeredDesignTextOcrWorkerProvider,
  type CreateLayeredDesignTextOcrWorkerProviderOptions,
  type LayeredDesignTextOcrWorkerLike,
} from "./textOcrWorker";

export interface LayeredDesignTextOcrWorkerHandle
  extends LayeredDesignTextOcrWorkerLike {
  terminate?: () => void;
}

export type LayeredDesignTextOcrWorkerFactory =
  () => LayeredDesignTextOcrWorkerHandle;

export interface CreateLayeredDesignWorkerTextOcrProviderOptions
  extends CreateLayeredDesignTextOcrWorkerProviderOptions {
  workerFactory?: LayeredDesignTextOcrWorkerFactory;
  fallbackProvider?: LayeredDesignFlatImageTextOcrProvider | null;
}

export function createDefaultLayeredDesignTextOcrWorker(): Worker {
  if (typeof Worker !== "function") {
    throw new Error("当前环境不支持文字 OCR Worker");
  }

  return new Worker(new URL("./textOcr.worker.ts", import.meta.url), {
    name: "lime-layered-design-text-ocr",
    type: "module",
  });
}

export function createLayeredDesignWorkerTextOcrProvider(
  options: CreateLayeredDesignWorkerTextOcrProviderOptions = {},
): LayeredDesignFlatImageTextOcrProvider {
  const workerFactory =
    options.workerFactory ?? createDefaultLayeredDesignTextOcrWorker;

  return {
    label: options.label ?? "Worker text OCR provider",
    detectText: async (input) => {
      let worker: LayeredDesignTextOcrWorkerHandle | null = null;

      try {
        worker = workerFactory();
        const provider = createLayeredDesignTextOcrWorkerProvider(worker, {
          label: options.label,
          requestIdFactory: options.requestIdFactory,
          timeoutMs: options.timeoutMs,
        });
        return await provider.detectText(input);
      } catch (error) {
        if (options.fallbackProvider === null) {
          throw error;
        }

        const fallbackProvider =
          options.fallbackProvider ??
          createLayeredDesignDeterministicTextOcrProvider();
        return await fallbackProvider.detectText(input);
      } finally {
        worker?.terminate?.();
      }
    },
  };
}
