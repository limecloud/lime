import { useEffect, useMemo, useState, type FormEvent } from "react";
import styled from "styled-components";
import {
  getClientSceneSkillPreferences,
  updateClientSceneSkillPreferences,
  type OemCloudCustomScene,
  type OemCloudSceneSkillPreference,
} from "@/lib/api/oemCloudControlPlane";
import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "@/lib/api/oemCloudRuntime";
import {
  getSkillCatalog,
  listSkillCatalogEntries,
  refreshSkillCatalogFromRemote,
  type SkillCatalogEntry,
} from "@/lib/api/skillCatalog";

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.22);
  padding: 1.25rem;
`;

const Dialog = styled.div`
  display: flex;
  width: min(760px, 100%);
  max-height: min(720px, calc(100vh - 2.5rem));
  flex-direction: column;
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.96));
  background: var(--lime-surface, #fff);
  box-shadow: 0 26px 74px -42px rgba(15, 23, 42, 0.46);
`;

const Header = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.9));
  padding: 1.05rem 1.15rem 0.9rem;
`;

const TitleBlock = styled.div`
  min-width: 0;
`;

const Title = styled.h2`
  margin: 0;
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 17px;
  font-weight: 780;
  line-height: 1.35;
`;

const Description = styled.p`
  margin: 0.22rem 0 0;
  color: var(--lime-text-muted, rgb(100 116 139));
  font-size: 12px;
  line-height: 1.55;
`;

const Body = styled.div`
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  overflow: auto;
  padding: 1rem 1.15rem;
`;

const Footer = styled.footer`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-top: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.9));
  padding: 0.85rem 1.15rem 1rem;
`;

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
`;

const Button = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid
    ${({ $primary }) =>
      $primary
        ? "var(--lime-brand-strong, #2f533c)"
        : "var(--lime-surface-border, rgba(203, 213, 225, 0.96))"};
  background: ${({ $primary }) =>
    $primary ? "var(--lime-brand-strong, #2f533c)" : "#fff"};
  padding: 0.48rem 0.82rem;
  color: ${({ $primary }) =>
    $primary ? "#fff" : "var(--lime-text, rgb(71 85 105))"};
  font-size: 12px;
  font-weight: 720;
  line-height: 1;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
  border-radius: 18px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.92));
  background: var(--lime-surface-soft, rgba(248, 250, 252, 0.98));
  padding: 0.55rem 0.7rem;
`;

const DragHandle = styled.span`
  color: var(--lime-text-subtle, rgb(148 163 184));
  font-size: 15px;
  line-height: 1;
  text-align: center;
`;

const RowTitle = styled.div`
  min-width: 0;
`;

const RowName = styled.div`
  overflow: hidden;
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 13px;
  font-weight: 740;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowMeta = styled.div`
  overflow: hidden;
  color: var(--lime-text-muted, rgb(100 116 139));
  font-size: 11px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowControls = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
`;

const IconButton = styled.button`
  display: inline-flex;
  height: 28px;
  min-width: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--lime-surface-border, rgba(203, 213, 225, 0.9));
  background: #fff;
  color: var(--lime-text, rgb(71 85 105));
  font-size: 12px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const ToggleLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  color: var(--lime-text, rgb(71 85 105));
  font-size: 11px;
  font-weight: 680;
`;

const Notice = styled.div`
  border-radius: 18px;
  border: 1px solid rgba(190, 242, 100, 0.62);
  background: rgba(247, 254, 231, 0.86);
  padding: 0.68rem 0.78rem;
  color: rgb(63 98 18);
  font-size: 12px;
  line-height: 1.55;
`;

const ErrorNotice = styled(Notice)`
  border-color: rgba(254, 202, 202, 0.9);
  background: rgba(254, 242, 242, 0.92);
  color: rgb(153 27 27);
`;

const FieldGrid = styled.form`
  display: grid;
  gap: 0.72rem;
`;

const Field = styled.label`
  display: grid;
  gap: 0.3rem;
  color: var(--lime-text, rgb(71 85 105));
  font-size: 12px;
  font-weight: 700;
`;

const Input = styled.input`
  min-height: 36px;
  border-radius: 14px;
  border: 1px solid var(--lime-surface-border, rgba(203, 213, 225, 0.94));
  background: #fff;
  padding: 0.5rem 0.62rem;
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 13px;
  outline: none;
`;

const Select = styled.select`
  min-height: 36px;
  border-radius: 14px;
  border: 1px solid var(--lime-surface-border, rgba(203, 213, 225, 0.94));
  background: #fff;
  padding: 0.5rem 0.62rem;
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 13px;
`;

const TextArea = styled.textarea`
  min-height: 74px;
  resize: vertical;
  border-radius: 14px;
  border: 1px solid var(--lime-surface-border, rgba(203, 213, 225, 0.94));
  background: #fff;
  padding: 0.55rem 0.62rem;
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 13px;
  line-height: 1.5;
  outline: none;
`;

interface ManagerRow {
  id: string;
  title: string;
  summary: string;
  kind: SkillCatalogEntry["kind"];
  visible: boolean;
}

interface DraftScene {
  title: string;
  summary: string;
  linkedEntryId: string;
  placeholder: string;
  templateTitle: string;
  templateDescription: string;
  templatePrompt: string;
}

const emptyPreference: OemCloudSceneSkillPreference = {
  tenantId: "",
  userId: "",
  orderedEntryIds: [],
  hiddenEntryIds: [],
  customScenes: [],
};

const defaultDraft: DraftScene = {
  title: "",
  summary: "",
  linkedEntryId: "",
  placeholder: "",
  templateTitle: "开始",
  templateDescription: "",
  templatePrompt: "",
};

function canManageEntry(entry: SkillCatalogEntry): boolean {
  return entry.kind === "skill" || entry.kind === "scene";
}

function moveRow(
  rows: ManagerRow[],
  id: string,
  direction: -1 | 1,
): ManagerRow[] {
  const index = rows.findIndex((row) => row.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) {
    return rows;
  }
  const next = [...rows];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

function toRows(
  entries: SkillCatalogEntry[],
  preference: OemCloudSceneSkillPreference,
): ManagerRow[] {
  const hidden = new Set(preference.hiddenEntryIds);
  const baseRows = entries.filter(canManageEntry).map((entry) => ({
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    kind: entry.kind,
    visible: !hidden.has(entry.id),
  }));
  const byId = new Map(baseRows.map((row) => [row.id, row]));
  const ordered = preference.orderedEntryIds
    .map((id) => byId.get(id))
    .filter((row): row is ManagerRow => Boolean(row));
  const orderedIds = new Set(ordered.map((row) => row.id));
  return [...ordered, ...baseRows.filter((row) => !orderedIds.has(row.id))];
}

function buildCustomScene(draft: DraftScene): OemCloudCustomScene {
  const idSuffix =
    draft.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "") || `scene-${Date.now()}`;

  return {
    id: `custom_scene:${idSuffix}`,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    linkedEntryId: draft.linkedEntryId,
    placeholder: draft.placeholder.trim(),
    enabled: true,
    templates: [
      {
        id: "default",
        title: draft.templateTitle.trim() || "开始",
        description: draft.templateDescription.trim(),
        prompt: draft.templatePrompt.trim(),
      },
    ],
  };
}

interface HomeSceneSkillManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HomeSceneSkillManagerDialog({
  open,
  onClose,
}: HomeSceneSkillManagerDialogProps) {
  const [view, setView] = useState<"list" | "create">("list");
  const [entries, setEntries] = useState<SkillCatalogEntry[]>([]);
  const [preference, setPreference] =
    useState<OemCloudSceneSkillPreference>(emptyPreference);
  const [rows, setRows] = useState<ManagerRow[]>([]);
  const [customScenes, setCustomScenes] = useState<OemCloudCustomScene[]>([]);
  const [draft, setDraft] = useState<DraftScene>(defaultDraft);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSync, setCanSync] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const runtime = resolveOemCloudRuntimeContext();
        const syncAvailable = hasOemCloudSession(runtime);
        setCanSync(syncAvailable);
        const catalog = await getSkillCatalog();
        const nextEntries =
          listSkillCatalogEntries(catalog).filter(canManageEntry);
        let nextPreference: OemCloudSceneSkillPreference = {
          ...emptyPreference,
          tenantId: runtime?.tenantId ?? "",
        };
        if (syncAvailable && runtime) {
          nextPreference = await getClientSceneSkillPreferences(
            runtime.tenantId,
          );
        } else {
          setError("需要登录云端账号后，才能同步场景 Skills 管理结果。");
        }
        if (cancelled) {
          return;
        }
        setEntries(nextEntries);
        setPreference(nextPreference);
        setCustomScenes(nextPreference.customScenes);
        setRows(toRows(nextEntries, nextPreference));
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const linkableEntries = useMemo(
    () =>
      entries.filter(
        (entry) => entry.kind === "skill" || entry.kind === "scene",
      ),
    [entries],
  );

  const handleDropOnRow = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    setRows((current) => {
      const sourceIndex = current.findIndex((row) => row.id === draggingId);
      const targetIndex = current.findIndex((row) => row.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
    setDraggingId(null);
  };

  const handleRestoreDefault = () => {
    setRows(
      toRows(entries, {
        ...preference,
        orderedEntryIds: [],
        hiddenEntryIds: [],
      }),
    );
  };

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    const linkedEntryId = draft.linkedEntryId.trim();
    const prompt = draft.templatePrompt.trim();
    if (!title || !linkedEntryId || !prompt) {
      setError("请填写场景名称、关联技能和模板提示词。");
      return;
    }

    const scene = buildCustomScene(draft);
    setCustomScenes((current) => [...current, scene]);
    setRows((current) => [
      ...current,
      {
        id: scene.id ?? `custom_scene:${Date.now()}`,
        title: scene.title,
        summary: scene.summary || scene.templates[0]?.prompt || "自定义场景",
        kind: "scene",
        visible: true,
      },
    ]);
    setDraft(defaultDraft);
    setView("list");
    setError(null);
  };

  const handleSave = async () => {
    const runtime = resolveOemCloudRuntimeContext();
    const syncAvailable = hasOemCloudSession(runtime);
    if (!runtime || !syncAvailable) {
      setCanSync(false);
      setError("需要登录云端账号后，才能同步场景 Skills 管理结果。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateClientSceneSkillPreferences(runtime.tenantId, {
        orderedEntryIds: rows.map((row) => row.id),
        hiddenEntryIds: rows.filter((row) => !row.visible).map((row) => row.id),
        customScenes,
      });
      await refreshSkillCatalogFromRemote();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <Backdrop role="presentation" data-testid="home-scene-skill-manager">
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-scene-skill-manager-title"
      >
        <Header>
          <TitleBlock>
            <Title id="home-scene-skill-manager-title">
              {view === "list" ? "场景管理" : "新增自定义场景"}
            </Title>
            <Description>
              {view === "list"
                ? "调整首页场景和 Skills 的顺序、显隐；新增入口会同步到云端。"
                : "把已有 SkillCatalog 里的技能包装成更贴近你工作流的起手场景。"}
            </Description>
          </TitleBlock>
          <Button type="button" onClick={onClose}>
            关闭
          </Button>
        </Header>

        <Body>
          {error ? <ErrorNotice role="alert">{error}</ErrorNotice> : null}
          {!error && !canSync ? (
            <Notice>
              当前未检测到云端会话，列表可以预览，但保存需要先登录。
            </Notice>
          ) : null}

          {view === "list" ? (
            <>
              <ActionRow>
                <Button type="button" onClick={() => setView("create")}>
                  新增场景
                </Button>
              </ActionRow>
              {loading ? <Notice>正在载入场景 Skills…</Notice> : null}
              <List aria-label="场景 Skills 列表">
                {rows.map((row, index) => (
                  <Row
                    key={row.id}
                    draggable
                    onDragStart={() => setDraggingId(row.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDropOnRow(row.id)}
                  >
                    <DragHandle aria-hidden>⋮⋮</DragHandle>
                    <RowTitle>
                      <RowName>{row.title}</RowName>
                      <RowMeta>
                        {row.kind === "scene" ? "场景" : "Skill"} ·{" "}
                        {row.summary}
                      </RowMeta>
                    </RowTitle>
                    <RowControls>
                      <IconButton
                        type="button"
                        aria-label={`上移 ${row.title}`}
                        disabled={index === 0}
                        onClick={() =>
                          setRows((current) => moveRow(current, row.id, -1))
                        }
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        type="button"
                        aria-label={`下移 ${row.title}`}
                        disabled={index === rows.length - 1}
                        onClick={() =>
                          setRows((current) => moveRow(current, row.id, 1))
                        }
                      >
                        ↓
                      </IconButton>
                      <ToggleLabel>
                        <input
                          type="checkbox"
                          checked={row.visible}
                          onChange={(event) => {
                            const visible = event.currentTarget.checked;
                            setRows((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? { ...item, visible }
                                  : item,
                              ),
                            );
                          }}
                        />
                        显示
                      </ToggleLabel>
                    </RowControls>
                  </Row>
                ))}
              </List>
            </>
          ) : (
            <FieldGrid onSubmit={handleCreateSubmit}>
              <Field>
                场景名称
                <Input
                  value={draft.title}
                  placeholder="例如：每日账号复盘"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field>
                关联技能
                <Select
                  value={draft.linkedEntryId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      linkedEntryId: event.target.value,
                    }))
                  }
                >
                  <option value="">选择已有 Skill / 场景</option>
                  {linkableEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.kind === "scene" ? "场景" : "Skill"} ·{" "}
                      {entry.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                输入框占位提示
                <Input
                  value={draft.placeholder}
                  placeholder="例如：今天想复盘哪个账号？"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      placeholder: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field>
                快捷模板标题
                <Input
                  value={draft.templateTitle}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      templateTitle: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field>
                快捷模板描述
                <Input
                  value={draft.templateDescription}
                  placeholder="简短说明这个模板适合什么场景"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      templateDescription: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field>
                模板提示词
                <TextArea
                  value={draft.templatePrompt}
                  placeholder="点击该场景时填入输入框的启动文本"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      templatePrompt: event.target.value,
                    }))
                  }
                />
              </Field>
              <ActionRow>
                <Button type="button" onClick={() => setView("list")}>
                  返回
                </Button>
                <Button type="submit" $primary>
                  加入列表
                </Button>
              </ActionRow>
            </FieldGrid>
          )}
        </Body>

        {view === "list" ? (
          <Footer>
            <Button type="button" onClick={handleRestoreDefault}>
              恢复默认
            </Button>
            <ActionRow>
              <Button type="button" onClick={onClose}>
                取消
              </Button>
              <Button
                type="button"
                $primary
                disabled={saving || loading}
                onClick={handleSave}
              >
                {saving ? "同步中…" : "完成"}
              </Button>
            </ActionRow>
          </Footer>
        ) : null}
      </Dialog>
    </Backdrop>
  );
}
