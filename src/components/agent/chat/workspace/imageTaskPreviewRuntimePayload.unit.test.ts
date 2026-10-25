import { describe, expect, it } from "vitest";
import {
  asRecord,
  buildNormalizedStoryboardSlot,
  mergeStoryboardSlots,
  readBoolean,

  readImageTaskPresentationCaption,
  readImageTaskPresentationText,
  readPositiveNumber,
  readStoryboardSlotsFromUnknown,
  readString,
  readStringArray,
  resolveImageRuntimeContractSnapshot,
} from "./imageTaskPreviewRuntimePayload";

describe("imageTaskPreviewRuntimePayload", () => {
  it("应按宽松 schema 读取字符串、数字、布尔值和字符串数组", () => {
    expect(asRecord({ value: 1 })).toEqual({ value: 1 });
    expect(asRecord(["not-record"])).toBeNull();

    expect(
      readString(
        [{ title: "  青柠主视觉  " }, { title: "fallback" }],
        ["title"],
      ),
    ).toBe("青柠主视觉");
    expect(readPositiveNumber([{ count: "3" }], ["count"])).toBe(3);
    expect(readPositiveNumber([{ count: 0 }, { count: "2" }], ["count"])).toBe(
      2,
    );
    expect(readBoolean([{ retryable: "false" }], ["retryable"])).toBe(false);
    expect(
      readStringArray(
        [{ reference_images: [" img-1 ", "img-1", "", "img-2", 2] }],
        ["reference_images"],
      ),
    ).toEqual(["img-1", "img-2"]);
  });

  it("应读取图片任务 presentation intro 与不同终态 caption", () => {
    const payload = {
      presentation: {
        opening_text: "已开始生成配图",
        result_captions: {
          completion_caption: "配图已完成",
          failure_caption: "配图失败，可重试",
          cancelled_caption: "已取消配图",
        },
      },
    };

    expect(readImageTaskPresentationText([payload])).toBe("已开始生成配图");
    expect(readImageTaskPresentationCaption([payload], "complete")).toBe(
      "配图已完成",
    );
    expect(readImageTaskPresentationCaption([payload], "failed")).toBe(
      "配图失败，可重试",
    );
    expect(readImageTaskPresentationCaption([payload], "cancelled")).toBe(
      "已取消配图",
    );
    expect(readImageTaskPresentationCaption([payload], "running")).toBe(
      undefined,
    );
  });



  it("读取图片任务 presentation 时不应在前端改写模型文案语义", () => {
    const payload = {
      presentation: {
        opening_text:
          "好啊，先来Generate 深圳夏day午后的城市照片，真实摄影Style。",
        result_captions: {
          completion_caption:
            "搞定，深圳夏day午后的城市照片，真实摄影Style 已经做好了。",
        },
      },
    };
    const languageSource = "Generate 深圳夏day午后的城市照片，真实摄影Style";

    expect(readImageTaskPresentationText([payload], languageSource)).toContain(
      "先来Generate 深圳夏day午后",
    );
    expect(
      readImageTaskPresentationCaption([payload], "complete", languageSource),
    ).toContain("深圳夏day午后");
    expect(
      readImageTaskPresentationCaption([payload], "complete", languageSource),
    ).toContain("真实摄影Style");
  });

  it("应从 task record 投影图片运行时合约，并把路由阻止映射为 blocked", () => {
    const snapshot = resolveImageRuntimeContractSnapshot({
      normalizedStatus: "failed",
      taskRecord: {
        last_error: {
          code: "image_generation_contract_mismatch",
        },
        payload: {
          modality_contract_key: "image_generation",
          routing_slot: "primary-image",
          required_capabilities: ["image_generation", "vision_input"],
          model_capability_assessment: {
            provider_id: "openai",
            model_id: "gpt-image-2",
            source: "model-registry",
            supports_image_generation: "false",
          },
          limecore_policy_snapshot: {
            status: "evaluated",
            decision: "ask",
            decision_source: "policy",
            decision_scope: "workspace",
            decision_reason: "missing approval",
            missing_inputs: ["provider"],
            pending_hit_refs: ["hit-1"],
            policy_evaluation: {
              status: "blocked",
              decision: "deny",
              decision_source: "runtime",
              decision_scope: "session",
              decision_reason: "capability mismatch",
              blocking_refs: ["block-1"],
              ask_refs: ["ask-1"],
              pending_refs: ["pending-1"],
            },
          },
        },
      },
    });

    expect(snapshot).toMatchObject({
      contractKey: "image_generation",
      routingSlot: "primary-image",
      providerId: "openai",
      model: "gpt-image-2",
      routingEvent: "routing_not_possible",
      routingOutcome: "blocked",
      failureCode: "image_generation_contract_mismatch",
      modelCapabilityAssessmentSource: "model-registry",
      modelSupportsImageGeneration: false,
      limecorePolicyDecision: "ask",
      limecorePolicyEvaluationDecision: "deny",
      limecorePolicyEvaluationBlockingRefs: ["block-1"],
      limecorePolicyEvaluationAskRefs: ["ask-1"],
      limecorePolicyEvaluationPendingRefs: ["pending-1"],
    });

    expect(
      resolveImageRuntimeContractSnapshot({
        normalizedStatus: "succeeded",
        taskRecord: { payload: { prompt: "普通图片任务" } },
      }),
    ).toBeNull();
  });

  it("应规范化、排序并合并 storyboard slots", () => {
    expect(
      buildNormalizedStoryboardSlot({
        slotIndex: 0,
        slotId: "invalid",
      }),
    ).toBeNull();

    const slots = readStoryboardSlotsFromUnknown([
      {
        slot_id: "detail",
        slot_index: "2",
        slot_label: "细节图",
        revised_prompt: "展示细节",
        shot_type: "close-up",
        status: "running",
      },
      {
        slot_id: "hero",
        slot_index: 1,
        slot_label: "首图",
        prompt: "展示主题",
      },
      "invalid",
    ]);

    expect(slots).toEqual([
      {
        slotId: "hero",
        slotIndex: 1,
        label: "首图",
        prompt: "展示主题",
        shotType: null,
        status: null,
      },
      {
        slotId: "detail",
        slotIndex: 2,
        label: "细节图",
        prompt: "展示细节",
        shotType: "close-up",
        status: "running",
      },
    ]);

    expect(
      mergeStoryboardSlots(slots, [
        {
          slotId: "hero",
          slotIndex: 1,
          label: null,
          prompt: "更新首图",
          shotType: "wide",
          status: "complete",
        },
      ]),
    ).toEqual([
      {
        slotId: "hero",
        slotIndex: 1,
        label: "首图",
        prompt: "更新首图",
        shotType: "wide",
        status: "complete",
      },
      {
        slotId: "detail",
        slotIndex: 2,
        label: "细节图",
        prompt: "展示细节",
        shotType: "close-up",
        status: "running",
      },
    ]);
  });
});
