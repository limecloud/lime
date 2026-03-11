import { useState, useEffect, useCallback, useRef } from "react";
import { skillsApi, Skill, SkillRepo, AppType } from "@/lib/api/skills";

/** 模块级内存缓存，跨组件挂载共享 */
interface SkillsCache {
  skills: Skill[];
  repos: SkillRepo[];
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<AppType, SkillsCache>();

export function useSkills(app: AppType = "proxycast") {
  const cached = cache.get(app);
  const isCacheFresh = cached && Date.now() - cached.timestamp < CACHE_TTL_MS;

  const [skills, setSkills] = useState<Skill[]>(cached?.skills ?? []);
  const [repos, setRepos] = useState<SkillRepo[]>(cached?.repos ?? []);
  const [loading, setLoading] = useState(!isCacheFresh);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initializedRef = useRef(false);

  const updateCache = useCallback(
    (data: Skill[], reposData?: SkillRepo[]) => {
      const prev = cache.get(app);
      cache.set(app, {
        skills: data,
        repos: reposData ?? prev?.repos ?? [],
        timestamp: Date.now(),
      });
    },
    [app],
  );

  const fetchAllSkills = useCallback(
    async (refreshRemote = false) => {
      try {
        setLoading(true);
        setError(null);
        const data = await skillsApi.getAll(app, { refreshRemote });
        setSkills(data);
        updateCache(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [app, updateCache],
  );

  const fetchRepos = useCallback(async () => {
    try {
      const data = await skillsApi.getRepos();
      setRepos(data);
      const prev = cache.get(app);
      if (prev) {
        prev.repos = data;
      }
    } catch (e) {
      console.error("Failed to fetch repos:", e);
    }
  }, [app]);

  useEffect(() => {
    if (initializedRef.current || isCacheFresh) {
      initializedRef.current = true;
      return;
    }
    initializedRef.current = true;

    // 阶段 1：快速拿本地+内置技能（同步接口，不走网络）
    skillsApi.getLocal(app).then((localData) => {
      setSkills(localData);
      setLoading(false);
      // 阶段 2：后台拉取全部（含远程仓库）
      setRemoteLoading(true);
      skillsApi
        .getAll(app, { refreshRemote: false })
        .then((allData) => {
          setSkills(allData);
          updateCache(allData);
        })
        .catch(() => {
          // 远程失败，保留本地数据
          updateCache(localData);
        })
        .finally(() => {
          setRemoteLoading(false);
        });
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });

    fetchRepos();
  }, [app, isCacheFresh, fetchAllSkills, fetchRepos, updateCache]);

  const install = async (directory: string) => {
    await skillsApi.install(directory, app);
    await fetchAllSkills(false);
  };

  const uninstall = async (directory: string) => {
    await skillsApi.uninstall(directory, app);
    await fetchAllSkills(false);
  };

  const addRepo = async (repo: SkillRepo) => {
    await skillsApi.addRepo(repo);
    await fetchRepos();
    await fetchAllSkills(true);
  };

  const removeRepo = async (owner: string, name: string) => {
    await skillsApi.removeRepo(owner, name);
    await fetchRepos();
    await fetchAllSkills(true);
  };

  return {
    skills,
    repos,
    loading,
    remoteLoading,
    error,
    refresh: async () => {
      await skillsApi.refreshCache();
      await fetchAllSkills(true);
    },
    install,
    uninstall,
    addRepo,
    removeRepo,
  };
}
