import {
  createLayeredDesignDeterministicSubjectMattingProvider,
  type LayeredDesignSubjectMattingProvider,
} from "./subjectMatting";
import {
  createLayeredDesignSubjectMattingWorkerProvider,
  type CreateLayeredDesignSubjectMattingWorkerProviderOptions,
  type LayeredDesignSubjectMattingWorkerLike,
} from "./subjectMattingWorker";

export interface LayeredDesignSubjectMattingWorkerHandle
  extends LayeredDesignSubjectMattingWorkerLike {
  terminate?: () => void;
}

export type LayeredDesignSubjectMattingWorkerFactory =
  () => LayeredDesignSubjectMattingWorkerHandle;

export interface CreateLayeredDesignWorkerSubjectMattingProviderOptions
  extends CreateLayeredDesignSubjectMattingWorkerProviderOptions {
  workerFactory?: LayeredDesignSubjectMattingWorkerFactory;
  fallbackProvider?: LayeredDesignSubjectMattingProvider | null;
}

export function createDefaultLayeredDesignSubjectMattingWorker(): Worker {
  if (typeof Worker !== "function") {
    throw new Error("当前环境不支持主体 matting Worker");
  }

  return new Worker(new URL("./subjectMatting.worker.ts", import.meta.url), {
    name: "lime-layered-design-subject-matting",
    type: "module",
  });
}

export function createLayeredDesignWorkerSubjectMattingProvider(
  options: CreateLayeredDesignWorkerSubjectMattingProviderOptions = {},
): LayeredDesignSubjectMattingProvider {
  const workerFactory =
    options.workerFactory ?? createDefaultLayeredDesignSubjectMattingWorker;

  return {
    label: options.label ?? "Worker subject matting provider",
    matteSubject: async (input) => {
      let worker: LayeredDesignSubjectMattingWorkerHandle | null = null;

      try {
        worker = workerFactory();
        const provider = createLayeredDesignSubjectMattingWorkerProvider(
          worker,
          {
            label: options.label,
            requestIdFactory: options.requestIdFactory,
            timeoutMs: options.timeoutMs,
          },
        );
        return await provider.matteSubject(input);
      } catch (error) {
        if (options.fallbackProvider === null) {
          throw error;
        }

        const fallbackProvider =
          options.fallbackProvider ??
          createLayeredDesignDeterministicSubjectMattingProvider();
        return await fallbackProvider.matteSubject(input);
      } finally {
        worker?.terminate?.();
      }
    },
  };
}
