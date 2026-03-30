/**
 * 记忆系统 API
 *
 * 提供角色、世界观、大纲的 CRUD 操作
 */

import { safeInvoke } from "@/lib/dev-bridge";
import { logAgentDebug } from "@/lib/agentDebug";

// ==================== 类型定义 ====================

/** 角色关系 */
export interface CharacterRelationship {
  target_id: string;
  relationship_type: string;
  description?: string;
}

/** 角色 */
export interface Character {
  id: string;
  project_id: string;
  name: string;
  aliases: string[];
  description?: string;
  personality?: string;
  background?: string;
  appearance?: string;
  relationships: CharacterRelationship[];
  avatar_url?: string;
  is_main: boolean;
  order: number;
  extra?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** 创建角色请求 */
export interface CreateCharacterRequest {
  project_id: string;
  name: string;
  aliases?: string[];
  description?: string;
  personality?: string;
  background?: string;
  appearance?: string;
  is_main?: boolean;
}

/** 更新角色请求 */
export interface UpdateCharacterRequest {
  name?: string;
  aliases?: string[];
  description?: string;
  personality?: string;
  background?: string;
  appearance?: string;
  relationships?: CharacterRelationship[];
  avatar_url?: string;
  is_main?: boolean;
  order?: number;
  extra?: Record<string, unknown>;
}

/** 世界观设定 */
export interface WorldBuilding {
  project_id: string;
  description: string;
  era?: string;
  locations?: string;
  rules?: string;
  extra?: Record<string, unknown>;
  updated_at: string;
}

/** 更新世界观请求 */
export interface UpdateWorldBuildingRequest {
  description?: string;
  era?: string;
  locations?: string;
  rules?: string;
  extra?: Record<string, unknown>;
}

/** 大纲节点 */
export interface OutlineNode {
  id: string;
  project_id: string;
  parent_id?: string;
  title: string;
  content?: string;
  content_id?: string;
  order: number;
  expanded: boolean;
  extra?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** 大纲树节点 */
export interface OutlineTreeNode extends OutlineNode {
  children: OutlineTreeNode[];
}

/** 创建大纲节点请求 */
export interface CreateOutlineNodeRequest {
  project_id: string;
  parent_id?: string;
  title: string;
  content?: string;
  content_id?: string;
  order?: number;
}

/** 更新大纲节点请求 */
export interface UpdateOutlineNodeRequest {
  parent_id?: string | null;
  title?: string;
  content?: string;
  content_id?: string | null;
  order?: number;
  expanded?: boolean;
  extra?: Record<string, unknown>;
}

/** 项目记忆（聚合） */
export interface ProjectMemory {
  characters: Character[];
  world_building?: WorldBuilding;
  outline: OutlineNode[];
}

// ==================== 角色 API ====================

/** 获取角色列表 */
export async function listCharacters(projectId: string): Promise<Character[]> {
  return safeInvoke<Character[]>("character_list", { projectId });
}

/** 获取角色详情 */
export async function getCharacter(id: string): Promise<Character | null> {
  return safeInvoke<Character | null>("character_get", { id });
}

/** 创建角色 */
export async function createCharacter(
  request: CreateCharacterRequest,
): Promise<Character> {
  return safeInvoke<Character>("character_create", { request });
}

/** 更新角色 */
export async function updateCharacter(
  id: string,
  request: UpdateCharacterRequest,
): Promise<Character> {
  return safeInvoke<Character>("character_update", { id, request });
}

/** 删除角色 */
export async function deleteCharacter(id: string): Promise<boolean> {
  return safeInvoke<boolean>("character_delete", { id });
}

// ==================== 世界观 API ====================

/** 获取世界观 */
export async function getWorldBuilding(
  projectId: string,
): Promise<WorldBuilding | null> {
  return safeInvoke<WorldBuilding | null>("world_building_get", { projectId });
}

/** 更新世界观 */
export async function updateWorldBuilding(
  projectId: string,
  request: UpdateWorldBuildingRequest,
): Promise<WorldBuilding> {
  return safeInvoke<WorldBuilding>("world_building_update", {
    projectId,
    request,
  });
}

// ==================== 大纲 API ====================

/** 获取大纲节点列表 */
export async function listOutlineNodes(
  projectId: string,
): Promise<OutlineNode[]> {
  return safeInvoke<OutlineNode[]>("outline_node_list", { projectId });
}

/** 获取大纲节点详情 */
export async function getOutlineNode(id: string): Promise<OutlineNode | null> {
  return safeInvoke<OutlineNode | null>("outline_node_get", { id });
}

/** 创建大纲节点 */
export async function createOutlineNode(
  request: CreateOutlineNodeRequest,
): Promise<OutlineNode> {
  return safeInvoke<OutlineNode>("outline_node_create", { request });
}

/** 更新大纲节点 */
export async function updateOutlineNode(
  id: string,
  request: UpdateOutlineNodeRequest,
): Promise<OutlineNode> {
  return safeInvoke<OutlineNode>("outline_node_update", { id, request });
}

/** 删除大纲节点 */
export async function deleteOutlineNode(id: string): Promise<boolean> {
  return safeInvoke<boolean>("outline_node_delete", { id });
}

// ==================== 聚合 API ====================

/** 获取项目完整记忆 */
export async function getProjectMemory(
  projectId: string,
): Promise<ProjectMemory> {
  const startedAt = Date.now();
  let settled = false;
  const slowTimer: number | null =
    typeof window !== "undefined"
      ? window.setTimeout(() => {
          if (settled) {
            return;
          }
          logAgentDebug(
            "AgentApi",
            "projectMemoryGet.slow",
            {
              elapsedMs: Date.now() - startedAt,
              projectId,
            },
            {
              dedupeKey: `projectMemoryGet.slow:${projectId}`,
              level: "warn",
              throttleMs: 1000,
            },
          );
        }, 1000)
      : null;

  logAgentDebug("AgentApi", "projectMemoryGet.start", { projectId });

  try {
    const memory = await safeInvoke<ProjectMemory>("project_memory_get", {
      projectId,
    });
    settled = true;
    logAgentDebug("AgentApi", "projectMemoryGet.success", {
      charactersCount: memory.characters.length,
      durationMs: Date.now() - startedAt,
      hasWorldBuilding: Boolean(memory.world_building),
      outlineCount: memory.outline.length,
      projectId,
    });
    return memory;
  } catch (error) {
    settled = true;
    logAgentDebug(
      "AgentApi",
      "projectMemoryGet.error",
      {
        durationMs: Date.now() - startedAt,
        error,
        projectId,
      },
      { level: "error" },
    );
    throw error;
  } finally {
    if (slowTimer !== null) {
      clearTimeout(slowTimer);
    }
  }
}

// ==================== 辅助函数 ====================

/** 构建大纲树结构 */
export function buildOutlineTree(nodes: OutlineNode[]): OutlineTreeNode[] {
  const nodeMap = new Map<string, OutlineTreeNode>();
  const roots: OutlineTreeNode[] = [];

  // 初始化所有节点
  nodes.forEach((node) => {
    nodeMap.set(node.id, { ...node, children: [] });
  });

  // 构建树结构
  nodes.forEach((node) => {
    const current = nodeMap.get(node.id)!;
    if (node.parent_id) {
      const parent = nodeMap.get(node.parent_id);
      if (parent) {
        parent.children.push(current);
      } else {
        roots.push(current);
      }
    } else {
      roots.push(current);
    }
  });

  // 按 order 排序
  const sortByOrder = (items: OutlineTreeNode[]) => {
    items.sort((a, b) => a.order - b.order);
    items.forEach((item) => sortByOrder(item.children));
  };
  sortByOrder(roots);

  return roots;
}
