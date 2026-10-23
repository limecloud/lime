import { useEffect, useRef, useState } from "react";
import {
  clearBrowsingData,
  getBrowsingDataSettings,
  getBrowsingDataSummary,
} from "@/lib/api/browserData";
import {
  BROWSER_DATA_TYPES,
  type BrowserDataSettings,
  type BrowserDataSummary,
  type BrowserDataTimeRange,
  type BrowserDataType,
} from "@/lib/api/browserDataTypes";

type ClearError =
  | { kind: "open" | "clear" | "partial" }
  | { kind: "unsupported"; dataTypes: BrowserDataType[] };

export function useBrowserClearBrowsingData() {
  const [settings, setSettings] = useState<BrowserDataSettings | null>(null);
  const [timeRange, setTimeRange] = useState<BrowserDataTimeRange>("lastHour");
  const [selected, setSelected] = useState<BrowserDataType[]>([]);
  const [summary, setSummary] = useState<BrowserDataSummary | null>(null);
  const [error, setError] = useState<ClearError | null>(null);
  const [opening, setOpening] = useState(false);
  const [clearing, setClearing] = useState(false);
  const operation = useRef<"opening" | "clearing" | null>(null);
  const lifecycle = useRef({
    mounted: true,
    generation: 0,
    summaryGeneration: 0,
  });
  const state = lifecycle.current;
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.generation++;
      state.summaryGeneration++;
    };
  }, [state]);
  useEffect(() => {
    setSummary(null);
    if (!settings) return;
    const revision = ++state.summaryGeneration;
    let current = true;
    void getBrowsingDataSummary(timeRange).then(
      (value) => {
        if (current && state.summaryGeneration === revision) setSummary(value);
      },
      () => {
        if (current && state.summaryGeneration === revision) setSummary(null);
      },
    );
    return () => {
      current = false;
    };
  }, [settings, timeRange, state]);

  const open = async () => {
    if (operation.current || settings) return;
    operation.current = "opening";
    const current = ++state.generation;
    setOpening(true);
    setError(null);
    try {
      const value = await getBrowsingDataSettings();
      if (!state.mounted || state.generation !== current) return;
      setTimeRange("lastHour");
      setSelected(
        BROWSER_DATA_TYPES.filter(
          (type) =>
            ["history", "siteData", "cache", "downloads"].includes(type) &&
            value.dataRemovalPermitted[type],
        ),
      );
      setSettings(value);
    } catch {
      if (state.mounted && state.generation === current)
        setError({ kind: "open" });
    } finally {
      operation.current = null;
      if (state.mounted && state.generation === current) setOpening(false);
    }
  };
  const close = () => {
    if (operation.current === "clearing") return;
    state.generation++;
    state.summaryGeneration++;
    setSettings(null);
    setSummary(null);
    setError(null);
  };
  const clear = async () => {
    if (operation.current || !settings || !selected.length) return;
    operation.current = "clearing";
    const current = state.generation;
    setClearing(true);
    setError(null);
    try {
      const result = await clearBrowsingData({
        dataTypes: BROWSER_DATA_TYPES.filter((type) => selected.includes(type)),
        timeRange,
      });
      if (!state.mounted || state.generation !== current) return;
      if (result.status === "completed") {
        // The existing history/download owners publish invalidations before returning success.
        setSettings(null);
        setSummary(null);
        state.generation++;
        state.summaryGeneration++;
      } else if (result.status === "unsupported")
        setError({ kind: "unsupported", dataTypes: result.dataTypes });
      else setError({ kind: "partial" });
    } catch {
      if (state.mounted && state.generation === current)
        setError({ kind: "clear" });
    } finally {
      operation.current = null;
      if (state.mounted) setClearing(false);
    }
  };
  return {
    settings,
    timeRange,
    selected,
    summary,
    error,
    opening,
    clearing,
    triggerRef,
    open,
    close,
    clear,
    changeTimeRange: (value: BrowserDataTimeRange) => {
      if (operation.current === "clearing" || value === timeRange) return;
      state.summaryGeneration++;
      setSummary(null);
      setTimeRange(value);
      setError(null);
    },
    toggle: (type: BrowserDataType) => {
      if (
        operation.current === "clearing" ||
        !settings?.dataRemovalPermitted[type]
      )
        return;
      setSelected((value) =>
        value.includes(type)
          ? value.filter((item) => item !== type)
          : [...value, type],
      );
      setError(null);
    },
  };
}
