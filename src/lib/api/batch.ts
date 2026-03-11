/**
 * 批量任务 API 客户端
 *
 * 通过 fetch 调用本地代理服务器的 REST API
 */

import { getServerStatus } from "@/lib/api/serverRuntime";

async function getBaseUrl(): Promise<string> {
  const status = await getServerStatus();
  return `http://${status.host}:${status.port}`;
}

// ============================================================
// 类型定义
// ============================================================

export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  model: string;
  system_prompt?: string;
  user_message_template: string;
  temperature?: number;
  max_tokens?: number;
  created_at: string;
  updated_at: string;
}

export interface TaskDefinition {
  id?: string;
  variables: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface BatchOptions {
  concurrency?: number;
  continue_on_error?: boolean;
  retry_count?: number;
  timeout_seconds?: number;
}

export interface TaskResult {
  task_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  content?: string;
  error?: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  started_at: string;
  completed_at?: string;
}

export interface BatchTask {
  id: string;
  name: string;
  template_id: string;
  status:
    | "pending"
    | "running"
    | "completed"
    | "partiallycompleted"
    | "failed"
    | "cancelled";
  options: BatchOptions;
  tasks: TaskDefinition[];
  results: TaskResult[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface BatchTaskStatistics {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  running_tasks: number;
  pending_tasks: number;
  total_tokens: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface BatchTaskDetail {
  batch_task: BatchTask;
  statistics: BatchTaskStatistics;
}

// ============================================================
// API 方法
// ============================================================

export async function createTemplate(
  template: Omit<TaskTemplate, "created_at" | "updated_at">,
): Promise<TaskTemplate> {
  const base = await getBaseUrl();
  const now = new Date().toISOString();
  const body = { ...template, created_at: now, updated_at: now };
  const res = await fetch(`${base}/api/batch/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listTemplates(): Promise<TaskTemplate[]> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/batch/templates`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.templates;
}

export async function getTemplate(id: string): Promise<TaskTemplate> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/batch/templates/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteTemplate(id: string): Promise<void> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/batch/templates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}

export interface CreateBatchTaskRequest {
  name: string;
  template_id: string;
  tasks: TaskDefinition[];
  options?: BatchOptions;
}

export async function createBatchTask(
  req: CreateBatchTaskRequest,
): Promise<{ id: string; name: string; task_count: number }> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/batch/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listBatchTasks(): Promise<BatchTask[]> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/batch/tasks`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.tasks;
}

export async function getBatchTask(id: string): Promise<BatchTaskDetail> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/batch/tasks/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function cancelBatchTask(id: string): Promise<void> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/batch/tasks/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}
