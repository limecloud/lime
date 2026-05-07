import {
  createLayeredDesignDeterministicCleanPlateProvider,
  type LayeredDesignCleanPlateProvider,
} from "./cleanPlate";
import {
  createLayeredDesignCleanPlateWorkerProvider,
  type CreateLayeredDesignCleanPlateWorkerProviderOptions,
  type LayeredDesignCleanPlateWorkerLike,
} from "./cleanPlateWorker";

export interface LayeredDesignCleanPlateWorkerHandle
  extends LayeredDesignCleanPlateWorkerLike {
  terminate?: () => void;
}

export type LayeredDesignCleanPlateWorkerFactory =
  () => LayeredDesignCleanPlateWorkerHandle;

export interface CreateLayeredDesignWorkerCleanPlateProviderOptions
  extends CreateLayeredDesignCleanPlateWorkerProviderOptions {
  workerFactory?: LayeredDesignCleanPlateWorkerFactory;
  fallbackProvider?: LayeredDesignCleanPlateProvider | null;
}

export function createDefaultLayeredDesignCleanPlateWorker(): Worker {
  if (typeof Worker !== "function") {
    throw new Error("当前环境不支持 clean plate Worker");
  }

  return new Worker(new URL("./cleanPlate.worker.ts", import.meta.url), {
    name: "lime-layered-design-clean-plate",
    type: "module",
  });
}

export function createLayeredDesignWorkerCleanPlateProvider(
  options: CreateLayeredDesignWorkerCleanPlateProviderOptions = {},
): LayeredDesignCleanPlateProvider {
  const workerFactory =
    options.workerFactory ?? createDefaultLayeredDesignCleanPlateWorker;

  return {
    label: options.label ?? "Worker clean plate provider",
    createCleanPlate: async (input) => {
      let worker: LayeredDesignCleanPlateWorkerHandle | null = null;

      try {
        worker = workerFactory();
        const provider = createLayeredDesignCleanPlateWorkerProvider(worker, {
          label: options.label,
          requestIdFactory: options.requestIdFactory,
          timeoutMs: options.timeoutMs,
        });
        return await provider.createCleanPlate(input);
      } catch (error) {
        if (options.fallbackProvider === null) {
          throw error;
        }

        const fallbackProvider =
          options.fallbackProvider ??
          createLayeredDesignDeterministicCleanPlateProvider();
        return await fallbackProvider.createCleanPlate(input);
      } finally {
        worker?.terminate?.();
      }
    },
  };
}
