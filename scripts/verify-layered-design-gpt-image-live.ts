#!/usr/bin/env tsx
/* global Buffer, process */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import type { MediaTaskArtifactOutput } from "../src/lib/api/mediaTasks";
import {
  applyLayeredDesignImageTaskOutput,
  createLayeredDesignImageTaskRequest,
} from "../src/lib/layered-design/imageTasks";
import { createLayeredDesignAssetGenerationPlan } from "../src/lib/layered-design/generation";
import { createLayeredDesignSeedDocument } from "../src/lib/layered-design/planner";

const DEFAULT_OUTER_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_MODEL = "gpt-images-2";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

interface CliOptions {
  selfTest: boolean;
  output?: string;
  imageOutput?: string;
  baseUrl?: string;
  imageModel: string;
  outerModel: string;
}

interface ImageGenerationResponse {
  imageBase64: string;
  imageItemId?: string;
  revisedPrompt?: string;
  eventCount: number;
  outputItemCount: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    selfTest: false,
    imageModel: DEFAULT_IMAGE_MODEL,
    outerModel: DEFAULT_OUTER_MODEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--self-test") {
      options.selfTest = true;
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`未知参数: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`缺少 --${key} 的值`);
    }
    index += 1;

    switch (key) {
      case "output":
        options.output = value;
        break;
      case "image-output":
        options.imageOutput = value;
        break;
      case "base-url":
        options.baseUrl = value;
        break;
      case "image-model":
        options.imageModel = value;
        break;
      case "outer-model":
        options.outerModel = value;
        break;
      default:
        throw new Error(`未知参数: --${key}`);
    }
  }

  return options;
}

function usage(): string {
  return [
    "用法：",
    "  npm exec -- tsx scripts/verify-layered-design-gpt-image-live.ts --self-test --output /tmp/evidence.json",
    "",
    "真实网关验收：",
    "  IMAGE_API_KEY=... IMAGE_BASE_URL=... npm exec -- tsx scripts/verify-layered-design-gpt-image-live.ts --output docs/roadmap/ai-layered-design/evidence/gpt-image-live.json --image-output docs/roadmap/ai-layered-design/evidence/gpt-image-live.png",
    "",
    "可选参数：",
    "  --base-url <Responses 网关基址，通常到 /v1>",
    "  --image-model gpt-images-2",
    "  --outer-model gpt-5.5",
    "  --image-output <保存生成 PNG 的路径>",
  ].join("\n");
}

function buildResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("base URL 不能为空");
  }
  if (trimmed.endsWith("/responses")) {
    return trimmed;
  }
  return `${trimmed}/responses`;
}

function buildInput(prompt: string, useInputList: boolean): unknown {
  if (!useInputList) {
    return prompt;
  }

  return [
    {
      role: "user",
      content: [{ type: "input_text", text: prompt }],
    },
  ];
}

async function requestResponsesImageGeneration(params: {
  apiKey: string;
  baseUrl: string;
  outerModel: string;
  imageModel: string;
  prompt: string;
  useInputList?: boolean;
}): Promise<Response> {
  return fetch(buildResponsesUrl(params.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: params.outerModel,
      input: buildInput(params.prompt, Boolean(params.useInputList)),
      tools: [{ type: "image_generation", model: params.imageModel }],
      stream: true,
    }),
  });
}

function shouldRetryWithInputList(status: number, text: string): boolean {
  return status === 400 && /input must be a list/i.test(text);
}

function parseSseEvent(rawEvent: string): { eventName?: string; dataText?: string } {
  const lines = rawEvent.split(/\r?\n/);
  const eventName = lines
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim();
  const dataText = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  return { eventName, dataText };
}

async function extractImageGenerationResult(
  response: Response,
): Promise<ImageGenerationResponse> {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Responses 图片生成请求失败 ${response.status}: ${text.slice(0, 1000)}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  let outputItemCount = 0;
  let imageBase64 = "";
  let imageItemId: string | undefined;
  let revisedPrompt: string | undefined;

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      const { eventName, dataText } = parseSseEvent(rawEvent);
      if (!eventName || !dataText || dataText.trim() === "[DONE]") {
        continue;
      }
      eventCount += 1;
      if (eventName !== "response.output_item.done") {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(dataText);
      } catch {
        continue;
      }
      const item = (parsed as { item?: Record<string, unknown> }).item;
      if (!item) {
        continue;
      }
      outputItemCount += 1;
      if (item.type !== "image_generation_call" || typeof item.result !== "string") {
        continue;
      }

      imageBase64 = item.result.trim();
      imageItemId = typeof item.id === "string" ? item.id : undefined;
      revisedPrompt =
        typeof item.revised_prompt === "string" ? item.revised_prompt : undefined;
    }
  }

  if (!imageBase64) {
    throw new Error("Responses SSE 流里没有 image_generation_call.result");
  }

  return { imageBase64, imageItemId, revisedPrompt, eventCount, outputItemCount };
}

async function generateImage(params: {
  apiKey: string;
  baseUrl: string;
  outerModel: string;
  imageModel: string;
  prompt: string;
}): Promise<ImageGenerationResponse> {
  let response = await requestResponsesImageGeneration(params);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (!shouldRetryWithInputList(response.status, text)) {
      throw new Error(`Responses 图片生成请求失败 ${response.status}: ${text.slice(0, 1000)}`);
    }
    response = await requestResponsesImageGeneration({
      ...params,
      useInputList: true,
    });
  }

  return extractImageGenerationResult(response);
}

function createTaskOutput(params: {
  projectRootPath: string;
  taskId: string;
  taskRequest: ReturnType<typeof createLayeredDesignImageTaskRequest>;
  result: ImageGenerationResponse;
}): MediaTaskArtifactOutput {
  const createdAt = new Date().toISOString();
  const imageUrl = `data:image/png;base64,${params.result.imageBase64}`;
  return {
    success: true,
    task_id: params.taskId,
    task_type: "image_generate",
    task_family: "image",
    status: "succeeded",
    normalized_status: "succeeded",
    path: `.lime/tasks/image_generate/${params.taskId}.json`,
    absolute_path: path.join(
      params.projectRootPath,
      ".lime/tasks/image_generate",
      `${params.taskId}.json`,
    ),
    artifact_path: `.lime/tasks/image_generate/${params.taskId}.json`,
    absolute_artifact_path: path.join(
      params.projectRootPath,
      ".lime/tasks/image_generate",
      `${params.taskId}.json`,
    ),
    reused_existing: false,
    record: {
      task_id: params.taskId,
      task_type: "image_generate",
      task_family: "image",
      payload: {
        prompt: params.taskRequest.prompt,
        provider_id: params.taskRequest.providerId,
        model: params.taskRequest.model,
        executor_mode: params.taskRequest.executorMode,
        outer_model: params.taskRequest.outerModel,
      },
      status: "succeeded",
      normalized_status: "succeeded",
      created_at: createdAt,
      updated_at: createdAt,
      result: {
        executor_mode: params.taskRequest.executorMode,
        outer_model: params.taskRequest.outerModel,
        images: [
          {
            url: imageUrl,
            revised_prompt: params.result.revisedPrompt,
            source: "responses_image_generation",
          },
        ],
        responses: [
          {
            executor_mode: "responses_image_generation",
            event_count: params.result.eventCount,
            output_item_count: params.result.outputItemCount,
            image_item_id: params.result.imageItemId,
          },
        ],
      },
    },
  };
}

function sha256Short(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function readEnvOrOption(options: CliOptions): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.IMAGE_API_KEY?.trim();
  const baseUrl = options.baseUrl ?? process.env.IMAGE_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    throw new Error(`${usage()}\n\n缺少 IMAGE_API_KEY 或 IMAGE_BASE_URL`);
  }
  return { apiKey, baseUrl };
}

async function startSelfTestServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end("not found");
      return;
    }

    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      [
        "event: response.output_item.done",
        `data: ${JSON.stringify({
          item: {
            id: "ig_self_test",
            type: "image_generation_call",
            result: TINY_PNG_BASE64,
            revised_prompt: "自测青柠图层",
          },
        })}`,
        "",
        "event: response.completed",
        'data: {"response":{"id":"resp_self_test"}}',
        "",
      ].join("\n"),
    );
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("无法启动 self-test server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeImageIfRequested(filePath: string | undefined, imageBase64: string) {
  if (!filePath) {
    return undefined;
  }
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, Buffer.from(imageBase64, "base64"));
  return resolved;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let selfTestServer: Awaited<ReturnType<typeof startSelfTestServer>> | null = null;
  let apiKey = "";
  let baseUrl = "";
  const mode = options.selfTest ? "self_test" : "live";

  try {
    if (options.selfTest) {
      selfTestServer = await startSelfTestServer();
      apiKey = "self-test-key";
      baseUrl = selfTestServer.baseUrl;
    } else {
      const env = readEnvOrOption(options);
      apiKey = env.apiKey;
      baseUrl = env.baseUrl;
    }

    const projectRootPath = path.join(os.tmpdir(), "lime-layered-design-gpt-image-live");
    const document = createLayeredDesignSeedDocument({
      prompt: "@配图 青柠汽水产品主视觉，透明主体图层",
      id: "gpt-image-live-design",
      title: "GPT Image 图层生成验收",
      createdAt: new Date().toISOString(),
    });
    const generationRequest =
      createLayeredDesignAssetGenerationPlan(document).find((request) => request.hasAlpha) ??
      createLayeredDesignAssetGenerationPlan(document)[0];
    if (!generationRequest) {
      throw new Error("没有可验收的图层生成请求");
    }

    const taskRequest = createLayeredDesignImageTaskRequest(document, generationRequest, {
      projectRootPath,
      providerId: "openai",
      model: options.imageModel,
      outerModel: options.outerModel,
      usage: "layered_design_gpt_image_live_verification",
    });

    const generated = await generateImage({
      apiKey,
      baseUrl,
      outerModel: options.outerModel,
      imageModel: options.imageModel,
      prompt: taskRequest.prompt,
    });
    const taskOutput = createTaskOutput({
      projectRootPath,
      taskId: `${mode}-gpt-image-task`,
      taskRequest,
      result: generated,
    });
    const appliedDocument = applyLayeredDesignImageTaskOutput(
      document,
      generationRequest,
      taskOutput,
    );
    if (!appliedDocument) {
      throw new Error("图片任务结果未能写回 LayeredDesignDocument");
    }

    const targetLayer = appliedDocument.layers.find(
      (layer) => layer.id === generationRequest.layerId,
    );
    const appliedAsset = appliedDocument.assets.find(
      (asset) => asset.id === targetLayer?.assetId,
    );
    const imageOutputPath = await writeImageIfRequested(options.imageOutput, generated.imageBase64);
    const evidence = {
      schema: "layered-design-gpt-image-live-evidence@1",
      mode,
      generatedAt: new Date().toISOString(),
      gateway: {
        baseUrlHash: sha256Short(baseUrl),
        responsesPath: new URL(buildResponsesUrl(baseUrl)).pathname,
      },
      models: {
        imageModel: options.imageModel,
        outerModel: options.outerModel,
        executorMode: taskRequest.executorMode,
      },
      task: {
        entrySource: taskRequest.entrySource,
        providerId: taskRequest.providerId,
        model: taskRequest.model,
        executorMode: taskRequest.executorMode,
        outerModel: taskRequest.outerModel,
        routingSlot: taskRequest.routingSlot,
        modalityContractKey: taskRequest.modalityContractKey,
        targetOutputId: taskRequest.targetOutputId,
        targetOutputRefId: taskRequest.targetOutputRefId,
      },
      result: {
        imageCount: 1,
        imageItemId: generated.imageItemId,
        eventCount: generated.eventCount,
        outputItemCount: generated.outputItemCount,
        imageBytes: Buffer.byteLength(generated.imageBase64, "base64"),
        imageOutputPath,
      },
      document: {
        documentId: appliedDocument.id,
        targetLayerId: generationRequest.layerId,
        targetLayerAssetId: targetLayer?.assetId,
        generatedAssetId: appliedAsset?.id,
        generatedAssetSource: appliedAsset?.params?.generatedImageSource,
        generatedAssetExecutorMode: appliedAsset?.params?.executorMode,
      },
      checks: {
        noLegacyPosterRoute:
          !JSON.stringify(taskRequest).includes("poster_generate") &&
          !JSON.stringify(taskRequest).includes("canvas:poster"),
        executorModeResponses: taskRequest.executorMode === "responses_image_generation",
        imageDataUrl: taskOutput.record.result?.images?.[0]?.url?.startsWith(
          "data:image/png;base64,",
        ),
        generatedAssetApplied: Boolean(appliedAsset?.src),
        targetLayerUpdated: targetLayer?.assetId === appliedAsset?.id,
      },
    };

    const ok = Object.values(evidence.checks).every(Boolean);
    if (!ok) {
      throw new Error(`验收检查失败: ${JSON.stringify(evidence.checks)}`);
    }

    if (options.output) {
      await writeJson(path.resolve(options.output), evidence);
    }
    console.log(JSON.stringify({ ok: true, evidence }, null, 2));
  } finally {
    await selfTestServer?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
