import { useState } from "react";
import { X, Plus, Trash2, ExternalLink, RefreshCw } from "lucide-react";
import type { SkillRepo } from "@/lib/api/skills";

interface RepoManagerPanelProps {
  repos: SkillRepo[];
  onClose: () => void;
  onAddRepo: (repo: SkillRepo) => Promise<void>;
  onRemoveRepo: (owner: string, name: string) => Promise<void>;
  onRefresh: () => void;
}

export function RepoManagerPanel({
  repos,
  onClose,
  onAddRepo,
  onRemoveRepo,
  onRefresh,
}: RepoManagerPanelProps) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!owner.trim() || !name.trim()) {
      alert("请输入仓库所有者和名称");
      return;
    }

    setAdding(true);
    try {
      await onAddRepo({
        owner: owner.trim(),
        name: name.trim(),
        branch: branch.trim() || "main",
        enabled: true,
      });
      setOwner("");
      setName("");
      setBranch("main");
    } catch (e) {
      alert(`添加失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (repoOwner: string, repoName: string) => {
    const key = `${repoOwner}/${repoName}`;
    setRemoving(key);
    try {
      await onRemoveRepo(repoOwner, repoName);
    } catch (e) {
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemoving(null);
    }
  };

  const openRepo = (repo: SkillRepo) => {
    window.open(`https://github.com/${repo.owner}/${repo.name}`, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[linear-gradient(180deg,rgba(240,249,255,0.82)_0%,rgba(236,253,245,0.74)_52%,rgba(255,255,255,0.86)_100%)] backdrop-blur-[2px]">
      <div className="bg-background rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="text-lg font-semibold">仓库管理</h3>
            <p className="text-sm text-muted-foreground">管理 Skill 仓库源</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="rounded-lg p-2 hover:bg-muted"
              title="刷新"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="rounded-lg p-2 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Add Repo Form */}
          <div className="rounded-lg border bg-card p-4">
            <h4 className="font-medium mb-3">添加新仓库</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    所有者
                  </label>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="anthropics"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    仓库名
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="skills"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  分支（可选）
                </label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={adding}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {adding ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    添加中...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    添加仓库
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Repo List */}
          <div className="space-y-2">
            <h4 className="font-medium">已添加的仓库</h4>
            {repos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                暂无仓库
              </p>
            ) : (
              repos.map((repo) => {
                const key = `${repo.owner}/${repo.name}`;
                const isRemoving = removing === key;

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg border bg-card p-3"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{key}</p>
                      <p className="text-xs text-muted-foreground">
                        分支: {repo.branch}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openRepo(repo)}
                        className="rounded-lg p-2 hover:bg-muted"
                        title="在 GitHub 上查看"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleRemove(repo.owner, repo.name)}
                        disabled={isRemoving}
                        className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                        title="删除"
                      >
                        {isRemoving ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
