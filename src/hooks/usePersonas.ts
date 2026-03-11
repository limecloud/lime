/**
 * @file usePersonas.ts
 * @description 人设管理 Hook，提供人设列表获取、创建、更新、删除、设置默认功能
 * @module hooks/usePersonas
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { useState, useEffect, useCallback } from "react";
import {
  createPersona,
  deletePersona,
  getDefaultPersona,
  listPersonaTemplates,
  listPersonas,
  setDefaultPersona as setDefaultPersonaApi,
  updatePersona,
} from "@/lib/api/personas";
import type {
  Persona,
  CreatePersonaRequest,
  PersonaUpdate,
  PersonaTemplate,
} from "@/types/persona";

/** Hook 返回类型 */
export interface UsePersonasReturn {
  /** 人设列表 */
  personas: Persona[];
  /** 默认人设 */
  defaultPersona: Persona | null;
  /** 人设模板列表 */
  templates: PersonaTemplate[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 创建人设 */
  create: (request: CreatePersonaRequest) => Promise<Persona>;
  /** 更新人设 */
  update: (id: string, update: PersonaUpdate) => Promise<Persona>;
  /** 删除人设 */
  remove: (id: string) => Promise<void>;
  /** 设置默认人设 */
  setDefault: (personaId: string) => Promise<void>;
  /** 加载人设模板 */
  loadTemplates: () => Promise<void>;
}

/**
 * 人设管理 Hook
 *
 * @param projectId - 项目 ID
 */
export function usePersonas(projectId: string | null): UsePersonasReturn {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [defaultPersona, setDefaultPersona] = useState<Persona | null>(null);
  const [templates, setTemplates] = useState<PersonaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 刷新人设列表 */
  const refresh = useCallback(async () => {
    if (!projectId) {
      setPersonas([]);
      setDefaultPersona(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [list, defaultP] = await Promise.all([
        listPersonas(projectId),
        getDefaultPersona(projectId),
      ]);

      setPersonas(list);
      setDefaultPersona(defaultP);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /** 创建人设 */
  const create = useCallback(
    async (request: CreatePersonaRequest): Promise<Persona> => {
      const persona = await createPersona(request);
      await refresh();
      return persona;
    },
    [refresh],
  );

  /** 更新人设 */
  const update = useCallback(
    async (id: string, updateData: PersonaUpdate): Promise<Persona> => {
      const persona = await updatePersona(id, updateData);
      await refresh();
      return persona;
    },
    [refresh],
  );

  /** 删除人设 */
  const remove = useCallback(
    async (id: string): Promise<void> => {
      await deletePersona(id);
      await refresh();
    },
    [refresh],
  );

  /** 设置默认人设 */
  const setDefault = useCallback(
    async (personaId: string): Promise<void> => {
      if (!projectId) return;
      await setDefaultPersonaApi(projectId, personaId);
      await refresh();
    },
    [projectId, refresh],
  );

  /** 加载人设模板 */
  const loadTemplates = useCallback(async () => {
    try {
      const list = await listPersonaTemplates();
      setTemplates(list);
    } catch (err) {
      console.error("加载人设模板失败:", err);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    personas,
    defaultPersona,
    templates,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
    setDefault,
    loadTemplates,
  };
}

export default usePersonas;
