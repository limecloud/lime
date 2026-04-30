import { describe, expect, it } from "vitest";
import {
  resolveBrowserControlRuntimeContractBinding,
  resolveImageGenerationRuntimeContractBinding,
  resolveTextTransformRuntimeContractBinding,
} from "./modalityRuntimeContracts";
import {
  resolveExecutorAdapterKey,
  resolveModalityExecutionProfileBinding,
} from "./modalityExecutionProfiles";

describe("modalityExecutionProfiles", () => {
  it("应从 executor binding 解析标准 adapter key", () => {
    expect(
      resolveExecutorAdapterKey({
        executor_kind: "skill",
        binding_key: "image_generate",
      }),
    ).toBe("skill:image_generate");
    expect(resolveExecutorAdapterKey({ executor_kind: "skill" })).toBeNull();
  });

  it("image_generation 应解析到 profile 与 executor adapter", () => {
    const binding = resolveImageGenerationRuntimeContractBinding();

    expect(binding).toMatchObject({
      executionProfileKey: "image_generation_profile",
      executorAdapterKey: "skill:image_generate",
      runtimeContract: {
        execution_profile: expect.objectContaining({
          profile_key: "image_generation_profile",
          model_role_slots: ["image_generation_model"],
          artifact_policy: expect.objectContaining({
            artifact_kinds: ["image_task", "image_output"],
            viewer_surfaces: ["image_workbench"],
          }),
        }),
        executor_adapter: expect.objectContaining({
          adapter_key: "skill:image_generate",
          supports_progress: true,
          supports_cancel: true,
          supports_resume: false,
          artifact_output_kinds: ["image_task", "image_output"],
        }),
      },
    });
  });

  it("browser_control profile 应保留浏览器权限与 resume 能力", () => {
    const binding = resolveBrowserControlRuntimeContractBinding();

    expect(binding.executionProfile).toEqual(
      expect.objectContaining({
        profile_key: "browser_control_profile",
        permission_profile_keys: expect.arrayContaining([
          "browser_control",
          "web_search",
        ]),
        fallback_behavior: expect.arrayContaining([
          "do_not_fallback_to_web_search",
        ]),
      }),
    );
    expect(binding.executorAdapter).toEqual(
      expect.objectContaining({
        adapter_key: "browser:browser_assist",
        supports_resume: true,
        artifact_output_kinds: expect.arrayContaining([
          "browser_session",
          "browser_snapshot",
        ]),
      }),
    );
  });

  it("text_transform 只能把 generic_file 作为 compat fallback", () => {
    const binding = resolveTextTransformRuntimeContractBinding();

    expect(binding.executionProfile).toEqual(
      expect.objectContaining({
        profile_key: "text_transform_profile",
        artifact_policy: expect.objectContaining({
          artifact_kinds: ["report_document", "generic_file"],
        }),
        fallback_behavior: expect.arrayContaining([
          "keep_generic_file_as_compat_only",
        ]),
      }),
    );
  });

  it("直接 resolver 应按 contract key 返回同一份 profile 绑定", () => {
    const binding = resolveModalityExecutionProfileBinding({
      contractKey: "audio_transcription",
      executorBinding: {
        executor_kind: "skill",
        binding_key: "transcription_generate",
      },
    });

    expect(binding).toEqual(
      expect.objectContaining({
        profileKey: "audio_transcription_profile",
        executorAdapterKey: "skill:transcription_generate",
        executionProfile: expect.objectContaining({
          model_role_slots: ["audio_transcription_model"],
          permission_profile_keys: expect.arrayContaining([
            "read_files",
            "write_artifacts",
            "service_api_call",
          ]),
        }),
        executorAdapter: expect.objectContaining({
          artifact_output_kinds: ["transcript"],
        }),
      }),
    );
  });
});
