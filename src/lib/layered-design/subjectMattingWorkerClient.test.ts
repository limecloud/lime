import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignWorkerSubjectMattingProvider,
  type LayeredDesignSubjectMattingWorkerHandle,
} from "./subjectMattingWorkerClient";
import {
  LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR,
  LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST,
  LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT,
  type LayeredDesignSubjectMattingWorkerMessageListener,
  type LayeredDesignSubjectMattingWorkerRequest,
  type LayeredDesignSubjectMattingWorkerResponse,
} from "./subjectMattingWorker";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

const subjectMattingInput = {
  image: {
    src: "data:image/png;base64,flat",
    width: 900,
    height: 1400,
    mimeType: "image/png",
  },
  createdAt: CREATED_AT,
  subject: {
    id: "subject-candidate",
    name: "主体候选",
    rect: {
      x: 144,
      y: 224,
      width: 612,
      height: 980,
    },
    confidence: 0.74,
    zIndex: 20,
    crop: {
      src: "data:image/png;base64,crop",
      width: 612,
      height: 980,
      mimeType: "image/png" as const,
    },
  },
};

class FakeSubjectMattingWorker
  implements LayeredDesignSubjectMattingWorkerHandle
{
  readonly sentMessages: LayeredDesignSubjectMattingWorkerRequest[] = [];
  readonly terminate = vi.fn();
  private readonly listeners =
    new Set<LayeredDesignSubjectMattingWorkerMessageListener>();

  postMessage(message: LayeredDesignSubjectMattingWorkerRequest) {
    this.sentMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.delete(listener);
  }

  emit(data: LayeredDesignSubjectMattingWorkerResponse) {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

describe("LayeredDesign subject matting worker client", () => {
  it("应创建 subject matting Worker provider 并在完成后释放 Worker", async () => {
    const worker = new FakeSubjectMattingWorker();
    const provider = createLayeredDesignWorkerSubjectMattingProvider({
      label: "Browser subject matting fixture",
      requestIdFactory: () => "subject-matting-worker-request-1",
      workerFactory: () => worker,
      fallbackProvider: null,
    });

    const promise = provider.matteSubject(subjectMattingInput);

    expect(provider.label).toBe("Browser subject matting fixture");
    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST,
        requestId: "subject-matting-worker-request-1",
        input: subjectMattingInput,
      },
    ]);

    worker.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT,
      requestId: "subject-matting-worker-request-1",
      result: {
        imageSrc: "data:image/png;base64,worker-matted",
        maskSrc: "data:image/png;base64,worker-mask",
        confidence: 0.92,
        hasAlpha: true,
      },
    });

    await expect(promise).resolves.toMatchObject({
      imageSrc: "data:image/png;base64,worker-matted",
      maskSrc: "data:image/png;base64,worker-mask",
      confidence: 0.92,
      hasAlpha: true,
    });
    expect(worker.listenerCount).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在 subject matting Worker 失败时使用 fallback provider 并释放 Worker", async () => {
    const worker = new FakeSubjectMattingWorker();
    const fallbackProvider = {
      label: "Fallback subject matting provider",
      matteSubject: vi.fn(async () => ({
        imageSrc: "data:image/png;base64,fallback-matted",
        maskSrc: "data:image/png;base64,fallback-mask",
        confidence: 0.81,
        hasAlpha: true,
      })),
    };
    const provider = createLayeredDesignWorkerSubjectMattingProvider({
      requestIdFactory: () => "subject-matting-worker-request-2",
      workerFactory: () => worker,
      fallbackProvider,
    });

    const promise = provider.matteSubject(subjectMattingInput);

    worker.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR,
      requestId: "subject-matting-worker-request-2",
      error: {
        message: "subject matting Worker 暂不可用",
      },
    });

    await expect(promise).resolves.toMatchObject({
      imageSrc: "data:image/png;base64,fallback-matted",
      maskSrc: "data:image/png;base64,fallback-mask",
      confidence: 0.81,
    });
    expect(fallbackProvider.matteSubject).toHaveBeenCalledWith(
      subjectMattingInput,
    );
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在无法创建 Worker 时默认回退 deterministic subject matting provider", async () => {
    const provider = createLayeredDesignWorkerSubjectMattingProvider({
      workerFactory: () => {
        throw new Error("当前环境不支持主体 matting Worker");
      },
    });

    await expect(provider.matteSubject(subjectMattingInput)).resolves.toEqual({
      imageSrc: "data:image/png;base64,crop",
      maskSrc: expect.stringContaining("data:image/png;base64,"),
      rect: {
        x: 144,
        y: 224,
        width: 612,
        height: 980,
      },
      confidence: 0.74,
      hasAlpha: true,
    });
  });

  it("应在关闭 fallback 时透出 Worker 创建错误", async () => {
    const provider = createLayeredDesignWorkerSubjectMattingProvider({
      fallbackProvider: null,
      workerFactory: () => {
        throw new Error("subject matting Worker 创建失败");
      },
    });

    await expect(provider.matteSubject(subjectMattingInput)).rejects.toThrow(
      "subject matting Worker 创建失败",
    );
  });
});
