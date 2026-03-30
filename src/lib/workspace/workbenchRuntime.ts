/**
 * @file workbenchRuntime.ts
 * @description 工作台运行时共享网关，避免外层主链直接依赖 content-creator 工具目录
 * @module lib/workspace/workbenchRuntime
 */

export {
  activityLogger,
  ActivityLogger,
  type ActivityEventType,
  type ActivityLog,
  type ActivityLogScope,
} from "@/components/content-creator/utils/activityLogger";

export {
  resolveSocialMediaArtifactDescriptor,
  type SocialMediaArtifactDescriptor,
  type SocialMediaArtifactType,
  type SocialMediaHarnessStage,
} from "@/components/content-creator/utils/socialMediaHarness";
