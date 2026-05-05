import { useCallback, useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import type { AgentRuntimeEvidenceTaskIndex } from "@/lib/api/agentRuntime";
import {
  buildModalityTaskIndexFacets,
  buildModalityTaskIndexRows,
  filterModalityTaskIndexRows,
  type ModalityTaskIndexQueryFilters,
  type ModalityTaskIndexRow,
} from "@/lib/agentRuntime/modalityTaskIndexPresentation";
import { Badge } from "@/components/ui/badge";

const TASK_INDEX_FILTER_ALL_VALUE = "__all__";

function TaskIndexStatCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 text-base font-semibold text-foreground">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function TaskIndexItemCard({ item }: { item: ModalityTaskIndexRow }) {
  return (
    <div className="rounded-lg border border-teal-200/80 bg-background/85 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {item.title}
        </span>
        {item.modality ? (
          <Badge variant="outline">{item.modality}</Badge>
        ) : null}
        {item.executorKind ? (
          <Badge variant="secondary">{item.executorKind}</Badge>
        ) : null}
        {item.contractKey ? (
          <Badge variant="outline">{item.contractKey}</Badge>
        ) : null}
        {item.costState ? (
          <Badge variant="outline">{item.costState}</Badge>
        ) : null}
        {item.limitState ? (
          <Badge variant={item.quotaLow ? "destructive" : "outline"}>
            {item.limitState}
          </Badge>
        ) : null}
      </div>

      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {item.threadId ? (
            <span>
              thread：
              <span className="ml-1 font-mono text-foreground">
                {item.threadId}
              </span>
            </span>
          ) : null}
          {item.turnId ? (
            <span>
              turn：
              <span className="ml-1 font-mono text-foreground">
                {item.turnId}
              </span>
            </span>
          ) : null}
          {item.contentId ? (
            <span>
              content：
              <span className="ml-1 font-mono text-foreground">
                {item.contentId}
              </span>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {item.skillId ? (
            <span>
              skill：
              <span className="ml-1 font-mono text-foreground">
                {item.skillId}
              </span>
            </span>
          ) : null}
          {item.modelId ? (
            <span>
              model：
              <span className="ml-1 font-mono text-foreground">
                {item.modelId}
              </span>
            </span>
          ) : null}
          {item.executorBindingKey ? (
            <span>
              binding：
              <span className="ml-1 font-mono text-foreground">
                {item.executorBindingKey}
              </span>
            </span>
          ) : null}
          {item.entryKey ? (
            <span>
              entry：
              <span className="ml-1 font-mono text-foreground">
                {item.entryKey}
              </span>
            </span>
          ) : null}
        </div>
        {item.estimatedCostClass || item.limitEventKind ? (
          <div>
            cost/limit：
            <span className="ml-1 font-mono text-foreground">
              {[item.estimatedCostClass, item.limitEventKind]
                .filter(Boolean)
                .join(" / ")}
            </span>
          </div>
        ) : null}
        {item.artifactPath ? (
          <div className="break-all">
            artifact：
            <span className="ml-1 font-mono text-foreground">
              {item.artifactPath}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TaskIndexFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options: string[];
  onChange: (value?: string) => void;
}) {
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-[11px] font-medium text-teal-900">
      <span>{label}</span>
      <select
        className="h-8 rounded-lg border border-teal-200 bg-white px-2 text-xs font-normal text-teal-950 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
        value={value ?? TASK_INDEX_FILTER_ALL_VALUE}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          onChange(
            nextValue === TASK_INDEX_FILTER_ALL_VALUE ? undefined : nextValue,
          );
        }}
      >
        <option value={TASK_INDEX_FILTER_ALL_VALUE}>全部</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function HarnessTaskIndexSection({
  index,
}: {
  index: AgentRuntimeEvidenceTaskIndex;
}) {
  const facets = buildModalityTaskIndexFacets(index);
  const rows = useMemo(() => buildModalityTaskIndexRows(index), [index]);
  const [filters, setFilters] = useState<ModalityTaskIndexQueryFilters>({});
  const filteredRows = useMemo(
    () => filterModalityTaskIndexRows(rows, filters),
    [filters, rows],
  );
  const visibleRows = filteredRows.slice(0, 8);
  const hasActiveFilters = Object.values(filters).some(Boolean);
  const updateFilter = useCallback(
    <Key extends keyof ModalityTaskIndexQueryFilters>(
      key: Key,
      value?: ModalityTaskIndexQueryFilters[Key],
    ) => {
      setFilters((current) => {
        const next = { ...current };
        if (value) {
          next[key] = value;
        } else {
          delete next[key];
        }
        return next;
      });
    },
    [],
  );

  if (index.snapshot_count <= 0 && index.items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/80 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-teal-950">
        <ListChecks className="h-4 w-4 text-teal-700" />
        <span>多模态任务索引</span>
      </div>
      <p className="mt-1 text-xs text-teal-800">
        来自 modalityRuntimeContracts.snapshotIndex.taskIndex；用于按 thread /
        turn / content / entry / executor / cost / limit 诊断非媒体任务，
        不另建任务事实源。
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <TaskIndexStatCard
          title="索引快照"
          value={`${index.snapshot_count}`}
          hint={`items ${index.items.length}`}
        />
        <TaskIndexStatCard
          title="身份锚点"
          value={`${facets.identityAnchors.length}`}
          hint={
            facets.identityAnchors.slice(0, 3).join(" / ") || "暂无 identity"
          }
        />
        <TaskIndexStatCard
          title="执行器维度"
          value={`${facets.executorDimensions.length}`}
          hint={
            facets.executorDimensions.slice(0, 3).join(" / ") || "暂无 executor"
          }
        />
        <TaskIndexStatCard
          title="成本 / 限额"
          value={`${facets.costLimitDimensions.length}`}
          hint={
            facets.costLimitDimensions.slice(0, 3).join(" / ") ||
            `quota low ${facets.quotaLowCount}`
          }
        />
      </div>

      {rows.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-teal-200/80 bg-white p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-teal-950">
                  任务中心过滤列表
                </div>
                <p className="mt-0.5 text-xs text-teal-800">
                  直接消费同一 taskIndex rows；用于把非媒体任务按身份、入口、
                  执行器和成本/限额过滤，不另建索引。
                </p>
              </div>
              <Badge variant="outline">
                {filteredRows.length} / {rows.length}
              </Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <TaskIndexFilterSelect
                label="入口"
                value={filters.entryKey}
                options={facets.entryKeys}
                onChange={(value) => updateFilter("entryKey", value)}
              />
              <TaskIndexFilterSelect
                label="内容"
                value={filters.contentId}
                options={facets.contentIds}
                onChange={(value) => updateFilter("contentId", value)}
              />
              <TaskIndexFilterSelect
                label="执行器"
                value={filters.executorKind}
                options={facets.executorKinds}
                onChange={(value) => updateFilter("executorKind", value)}
              />
              <TaskIndexFilterSelect
                label="成本"
                value={filters.costState}
                options={facets.costStates}
                onChange={(value) => updateFilter("costState", value)}
              />
              <TaskIndexFilterSelect
                label="限额"
                value={filters.limitState}
                options={facets.limitStates}
                onChange={(value) => updateFilter("limitState", value)}
              />
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                className="mt-2 text-xs font-medium text-teal-800 underline-offset-4 hover:text-teal-950 hover:underline"
                onClick={() => setFilters({})}
              >
                清空过滤
              </button>
            ) : null}
          </div>

          {visibleRows.length > 0 ? (
            visibleRows.map((item, indexInList) => (
              <TaskIndexItemCard
                key={`${item.id}:${indexInList}`}
                item={item}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-teal-200 bg-white p-3 text-xs text-teal-800">
              当前过滤条件下没有匹配的任务索引行。
            </div>
          )}
          {filteredRows.length > visibleRows.length ? (
            <p className="text-xs text-teal-800">
              仅展示前 {visibleRows.length} 条；请继续缩小过滤条件查看具体任务。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
