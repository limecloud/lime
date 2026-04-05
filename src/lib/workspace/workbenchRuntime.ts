/**
 * @file workbenchRuntime.ts
 * @description 工作台运行时共享网关，承接外层主链对工作台运行时工具的依赖
 * @module lib/workspace/workbenchRuntime
 */

export {
  activityLogger,
  ActivityLogger,
  type ActivityEventType,
  type ActivityLog,
  type ActivityLogScope,
} from "@/lib/workspace/activityLogger";
