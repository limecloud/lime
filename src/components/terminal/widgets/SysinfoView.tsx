/**
 * 系统信息监控视图
 *
 * 显示 CPU 和内存使用率的实时图表
 * 使用 @observablehq/plot 绘制折线图
 * 通过 Tauri 命令获取系统信息
 *
 * @module widgets/SysinfoView
 */

import { memo, useEffect, useRef, useState, useCallback } from "react";
import styled from "styled-components";
import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { subscribeSysinfo, unsubscribeSysinfo } from "@/lib/api/sysinfo";
import * as Plot from "@observablehq/plot";
import dayjs from "dayjs";
import { SysinfoDataPoint, PlotType, TimeSeriesMeta } from "./types";
import {
  DEFAULT_NUM_POINTS,
  DEFAULT_PLOT_META,
  PLOT_TYPE_METRICS,
  PLOT_COLORS,
} from "./constants";

interface SysinfoViewProps {
  /** 图表类型 */
  plotType?: PlotType;
  /** 是否显示标题 */
  showTitle?: boolean;
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 16px;
  overflow: auto;
  background: #1a1a1a;
  color: #e0e0e0;
`;

const ChartContainer = styled.div`
  flex: 1;
  min-height: 150px;
  width: 100%;

  /* Observable Plot 样式覆盖 */
  svg {
    font-family: inherit;
  }

  [aria-label="x-axis tick label"],
  [aria-label="y-axis tick label"] {
    fill: #808080;
    font-size: 10px;
  }

  [aria-label="x-axis tick"],
  [aria-label="y-axis tick"] {
    stroke: #2a2a2a;
  }

  [aria-label="x-grid"],
  [aria-label="y-grid"] {
    stroke: #2a2a2a;
    stroke-opacity: 0.5;
  }
`;

const ChartTitle = styled.div`
  font-size: 12px;
  color: #808080;
  margin-bottom: 8px;
`;

const PlotTypeSelector = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
`;

const PlotTypeButton = styled.button<{ $active?: boolean }>`
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid ${({ $active }) => ($active ? "#58a6ff" : "#2a2a2a")};
  background: ${({ $active }) => ($active ? "#58a6ff" : "transparent")};
  color: ${({ $active }) => ($active ? "#000" : "#e0e0e0")};
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: ${({ $active }) => ($active ? "#58a6ff" : "#333")};
  }
`;

const ChartsGrid = styled.div<{ $cols?: number }>`
  display: grid;
  grid-template-columns: ${({ $cols }) =>
    $cols && $cols > 1 ? `repeat(${$cols}, 1fr)` : "1fr"};
  gap: 16px;
  flex: 1;
`;

const LoadingMessage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #808080;
`;

/**
 * 单个折线图组件
 */
const SingleLinePlot = memo(function SingleLinePlot({
  data,
  yKey,
  meta,
  color,
  showTitle,
}: {
  data: SysinfoDataPoint[];
  yKey: string;
  meta: TimeSeriesMeta;
  color: string;
  showTitle?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // 监听容器尺寸变化
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // 渲染图表
  useEffect(() => {
    if (!containerRef.current || dimensions.width === 0 || data.length === 0)
      return;

    // 清除旧图表
    containerRef.current.innerHTML = "";

    // 解析 maxy
    let maxY = 100;
    if (typeof meta.maxy === "number") {
      maxY = meta.maxy;
    } else if (typeof meta.maxy === "string" && data.length > 0) {
      const lastPoint = data[data.length - 1];
      maxY = (lastPoint as unknown as Record<string, number>)[meta.maxy] || 100;
    }

    // 计算时间范围
    const latestTs = data[data.length - 1]?.ts || Date.now();
    const minX = latestTs - DEFAULT_NUM_POINTS * 1000;
    const maxX = latestTs;

    // 创建图表
    const plot = Plot.plot({
      width: dimensions.width,
      height: dimensions.height - (showTitle ? 24 : 0),
      marginLeft: 40,
      marginRight: 10,
      marginTop: 10,
      marginBottom: 30,
      x: {
        type: "linear",
        domain: [minX, maxX],
        tickFormat: (d) => dayjs(d as number).format("HH:mm:ss"),
        grid: true,
      },
      y: {
        domain: [meta.miny, maxY],
        label: meta.label,
        grid: true,
      },
      marks: [
        // 渐变填充区域
        Plot.areaY(data, {
          x: "ts",
          y: yKey,
          fill: color,
          fillOpacity: 0.2,
        }),
        // 折线
        Plot.lineY(data, {
          x: "ts",
          y: yKey,
          stroke: color,
          strokeWidth: 2,
        }),
        // 交互提示
        Plot.tip(
          data,
          Plot.pointerX({
            x: "ts",
            y: yKey,
            title: (d: SysinfoDataPoint) => {
              const value = (d as unknown as Record<string, number>)[yKey];
              return `${dayjs(d.ts).format("HH:mm:ss")}\n${value?.toFixed(meta.decimalPlaces)}${meta.label}`;
            },
          }),
        ),
        // 指示点
        Plot.dot(
          data,
          Plot.pointerX({
            x: "ts",
            y: yKey,
            fill: color,
            r: 4,
          }),
        ),
      ],
    });

    containerRef.current.appendChild(plot);

    return () => {
      plot.remove();
    };
  }, [data, yKey, meta, color, dimensions, showTitle]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {showTitle && <ChartTitle>{meta.name}</ChartTitle>}
      <ChartContainer ref={containerRef} />
    </div>
  );
});

/**
 * 系统信息监控视图
 */
export const SysinfoView = memo(function SysinfoView({
  plotType: initialPlotType = "CPU",
  showTitle = true,
}: SysinfoViewProps) {
  const [data, setData] = useState<SysinfoDataPoint[]>([]);
  const [plotType, setPlotType] = useState<PlotType>(initialPlotType);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 添加新数据点
  const addDataPoint = useCallback((point: SysinfoDataPoint) => {
    setData((prev) => {
      const newData = [...prev, point];
      // 保持最近 DEFAULT_NUM_POINTS 个数据点
      if (newData.length > DEFAULT_NUM_POINTS + 1) {
        return newData.slice(-DEFAULT_NUM_POINTS - 1);
      }
      return newData;
    });
  }, []);

  // 订阅系统信息
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let mounted = true;

    const setup = async () => {
      try {
        // 监听 sysinfo 事件
        unlisten = await safeListen<SysinfoDataPoint>("sysinfo", (event) => {
          if (mounted) {
            addDataPoint(event.payload);
            setLoading(false);
          }
        });

        // 开始订阅
        await subscribeSysinfo();
      } catch (e) {
        console.error("订阅系统信息失败:", e);
        if (mounted) {
          setError(String(e));
          setLoading(false);
        }
      }
    };

    setup();

    return () => {
      mounted = false;
      if (unlisten) {
        unlisten();
      }
      // 取消订阅
      unsubscribeSysinfo().catch(console.error);
    };
  }, [addDataPoint]);

  // 获取当前图表类型的指标
  const metrics =
    data.length > 0
      ? PLOT_TYPE_METRICS[plotType](data[data.length - 1])
      : ["cpu"];

  // 是否显示多列
  const showMultiColumn = metrics.length > 2;

  if (error) {
    return (
      <Container>
        <LoadingMessage>加载失败: {error}</LoadingMessage>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container>
        <LoadingMessage>正在加载系统信息...</LoadingMessage>
      </Container>
    );
  }

  return (
    <Container>
      <PlotTypeSelector>
        {(Object.keys(PLOT_TYPE_METRICS) as PlotType[]).map((type) => (
          <PlotTypeButton
            key={type}
            $active={plotType === type}
            onClick={() => setPlotType(type)}
          >
            {type}
          </PlotTypeButton>
        ))}
      </PlotTypeSelector>

      <ChartsGrid $cols={showMultiColumn ? 2 : 1}>
        {metrics.map((metric, idx) => {
          const meta = DEFAULT_PLOT_META[metric] || {
            name: metric,
            label: "%",
            miny: 0,
            maxy: 100,
            color: PLOT_COLORS[idx % PLOT_COLORS.length],
            decimalPlaces: 1,
          };
          const color = meta.color || PLOT_COLORS[idx % PLOT_COLORS.length];

          return (
            <SingleLinePlot
              key={metric}
              data={data}
              yKey={metric}
              meta={meta}
              color={color}
              showTitle={showTitle && metrics.length > 1}
            />
          );
        })}
      </ChartsGrid>
    </Container>
  );
});
