import { describe, expect, it } from "vitest";
import {
  resolveBrowserControlRuntimeContractBinding,
  resolveBrowserControlEntrySource,
  isImageGenerationBoundEntrySource,
  resolveAudioTranscriptionRuntimeContractBinding,
  resolveImageGenerationRuntimeContractBinding,
  resolvePdfExtractRuntimeContractBinding,
  resolveTextTransformRuntimeContractBinding,
  resolveVoiceGenerationRuntimeContractBinding,
  resolveWebResearchRuntimeContractBinding,
} from "./modalityRuntimeContracts";

describe("modalityRuntimeContracts", () => {
  it("image_generation contract 应提供底层运行字段与上层入口绑定", () => {
    const contract = resolveImageGenerationRuntimeContractBinding();

    expect(contract).toMatchObject({
      contractKey: "image_generation",
      modality: "image",
      routingSlot: "image_generation_model",
      runtimeContract: expect.objectContaining({
        contract_key: "image_generation",
        routing_slot: "image_generation_model",
      }),
    });
    expect(contract.requiredCapabilities).toEqual(
      expect.arrayContaining([
        "text_generation",
        "image_generation",
        "vision_input",
      ]),
    );
    expect(contract.boundEntrySources).toEqual(
      expect.arrayContaining(["at_image_command", "at_poster_command"]),
    );
  });

  it("image_generation entry source 只从 contract registry 判定", () => {
    expect(isImageGenerationBoundEntrySource("at_image_command")).toBe(true);
    expect(isImageGenerationBoundEntrySource("at_poster_command")).toBe(true);
    expect(isImageGenerationBoundEntrySource("at_video_command")).toBe(false);
  });

  it("browser_control contract 应提供 Browser Assist 底层运行字段", () => {
    const contract = resolveBrowserControlRuntimeContractBinding();

    expect(contract).toMatchObject({
      contractKey: "browser_control",
      modality: "browser",
      routingSlot: "browser_reasoning_model",
      runtimeContract: expect.objectContaining({
        contract_key: "browser_control",
        routing_slot: "browser_reasoning_model",
        executor_binding: expect.objectContaining({
          executor_kind: "browser",
          binding_key: "browser_assist",
        }),
      }),
    });
    expect(contract.requiredCapabilities).toEqual(
      expect.arrayContaining([
        "text_generation",
        "browser_reasoning",
        "browser_control_planning",
      ]),
    );
    expect(contract.boundEntrySources).toEqual(
      expect.arrayContaining([
        "at_browser_command",
        "at_browser_agent_command",
        "at_mini_tester_command",
      ]),
    );
  });

  it("browser_control entry source 应从 contract registry 派生", () => {
    expect(resolveBrowserControlEntrySource("@浏览器")).toBe(
      "at_browser_command",
    );
    expect(resolveBrowserControlEntrySource("@Browser Agent")).toBe(
      "at_browser_agent_command",
    );
    expect(resolveBrowserControlEntrySource("@Mini Tester")).toBe(
      "at_mini_tester_command",
    );
    expect(resolveBrowserControlEntrySource("@unknown")).toBe(
      "at_browser_command",
    );
  });

  it("pdf_extract contract 应提供 Skill(pdf_read) 底层运行字段与上层入口绑定", () => {
    const contract = resolvePdfExtractRuntimeContractBinding();

    expect(contract).toMatchObject({
      contractKey: "pdf_extract",
      modality: "document",
      routingSlot: "base_model",
      runtimeContract: expect.objectContaining({
        contract_key: "pdf_extract",
        routing_slot: "base_model",
        executor_binding: expect.objectContaining({
          executor_kind: "skill",
          binding_key: "pdf_read",
        }),
      }),
    });
    expect(contract.requiredCapabilities).toEqual(
      expect.arrayContaining([
        "text_generation",
        "local_file_read",
        "long_context",
      ]),
    );
    expect(contract.boundEntrySources).toEqual(
      expect.arrayContaining(["at_pdf_read_command"]),
    );
  });

  it("voice_generation contract 应提供 ServiceSkill(voice_runtime) 底层运行字段与上层入口绑定", () => {
    const contract = resolveVoiceGenerationRuntimeContractBinding();

    expect(contract).toMatchObject({
      contractKey: "voice_generation",
      modality: "audio",
      routingSlot: "voice_generation_model",
      runtimeContract: expect.objectContaining({
        contract_key: "voice_generation",
        routing_slot: "voice_generation_model",
        executor_binding: expect.objectContaining({
          executor_kind: "service_skill",
          binding_key: "voice_runtime",
        }),
      }),
    });
    expect(contract.requiredCapabilities).toEqual(
      expect.arrayContaining(["text_generation", "voice_generation"]),
    );
    expect(contract.boundEntrySources).toEqual(
      expect.arrayContaining(["at_voice_command"]),
    );
  });

  it("audio_transcription contract 应提供 Skill(transcription_generate) 底层运行字段与上层入口绑定", () => {
    const contract = resolveAudioTranscriptionRuntimeContractBinding();

    expect(contract).toMatchObject({
      contractKey: "audio_transcription",
      modality: "audio",
      routingSlot: "audio_transcription_model",
      runtimeContract: expect.objectContaining({
        contract_key: "audio_transcription",
        routing_slot: "audio_transcription_model",
        executor_binding: expect.objectContaining({
          executor_kind: "skill",
          binding_key: "transcription_generate",
        }),
      }),
    });
    expect(contract.requiredCapabilities).toEqual(
      expect.arrayContaining(["text_generation", "audio_transcription"]),
    );
    expect(contract.boundEntrySources).toEqual(
      expect.arrayContaining(["at_transcription_command"]),
    );
  });

  it("web_research contract 应提供 Skill(research) 底层运行字段与上层入口绑定", () => {
    const contract = resolveWebResearchRuntimeContractBinding();

    expect(contract).toMatchObject({
      contractKey: "web_research",
      modality: "mixed",
      routingSlot: "report_generation_model",
      runtimeContract: expect.objectContaining({
        contract_key: "web_research",
        routing_slot: "report_generation_model",
        executor_binding: expect.objectContaining({
          executor_kind: "skill",
          binding_key: "research",
        }),
      }),
    });
    expect(contract.requiredCapabilities).toEqual(
      expect.arrayContaining([
        "text_generation",
        "web_search",
        "structured_document_generation",
        "long_context",
      ]),
    );
    expect(contract.boundEntrySources).toEqual(
      expect.arrayContaining([
        "at_search_command",
        "at_deep_search_command",
        "at_site_search_command",
        "at_report_command",
        "at_competitor_command",
      ]),
    );
  });

  it("text_transform contract 应提供文本转换底层运行字段与上层入口绑定", () => {
    const contract = resolveTextTransformRuntimeContractBinding();

    expect(contract).toMatchObject({
      contractKey: "text_transform",
      modality: "document",
      routingSlot: "base_model",
      runtimeContract: expect.objectContaining({
        contract_key: "text_transform",
        routing_slot: "base_model",
        executor_binding: expect.objectContaining({
          executor_kind: "skill",
          binding_key: "text_transform",
        }),
      }),
    });
    expect(contract.requiredCapabilities).toEqual(
      expect.arrayContaining([
        "text_generation",
        "local_file_read",
        "long_context",
      ]),
    );
    expect(contract.boundEntrySources).toEqual(
      expect.arrayContaining([
        "at_file_read_command",
        "at_summary_command",
        "at_translation_command",
        "at_analysis_command",
        "at_publish_compliance_command",
      ]),
    );
  });
});
