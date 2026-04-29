/**
 * @file MicrophoneTest.tsx
 * @description 麦克风测试组件 - 设备选择和音量测试
 * @module components/voice/MicrophoneTest
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Mic, MicOff, RefreshCw, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listAudioDevices,
  startRecording,
  cancelRecording,
  getRecordingStatus,
  type AudioDeviceInfo,
} from "@/lib/api/asrProvider";
import { VolumeWaveform } from "./VolumeWaveform";

interface MicrophoneTestProps {
  /** 当前选择的设备 ID */
  selectedDeviceId?: string;
  /** 设备选择变化回调 */
  onDeviceChange: (deviceId: string | undefined) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

export function MicrophoneTest({
  selectedDeviceId,
  onDeviceChange,
  disabled = false,
}: MicrophoneTestProps) {
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  // 使用 ref 跟踪录音状态，避免闭包捕获过时的 state
  const isTestingRef = useRef(false);

  // 加载设备列表
  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const deviceList = await listAudioDevices();
      setDevices(deviceList);
    } catch (err: any) {
      setError(err?.message || "无法获取麦克风设备列表");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // 开始测试
  const startTest = useCallback(async () => {
    if (testing) return;
    setTesting(true);
    isTestingRef.current = true;
    setError(null);
    setVolume(0);

    console.log("[麦克风测试] 开始测试，设备ID:", selectedDeviceId);

    try {
      await startRecording(selectedDeviceId);
      console.log("[麦克风测试] 录音已开始");

      // 轮询获取音量
      pollIntervalRef.current = window.setInterval(async () => {
        try {
          const status = await getRecordingStatus();
          console.log("[麦克风测试] 状态:", status);
          setVolume(status.volume);
        } catch (err) {
          console.error("[麦克风测试] 获取状态失败:", err);
        }
      }, 100);
    } catch (err: any) {
      console.error("[麦克风测试] 开始录音失败:", err);
      setError(err?.message || "无法开始录音测试");
      setTesting(false);
      isTestingRef.current = false;
    }
  }, [testing, selectedDeviceId]);

  // 停止测试
  const stopTest = useCallback(async () => {
    if (!testing) return;

    console.log("[麦克风测试] 停止测试");

    // 清除轮询
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // 先更新状态，避免重复调用
    setTesting(false);
    isTestingRef.current = false;

    try {
      await cancelRecording();
      console.log("[麦克风测试] 录音已取消");
    } catch (err) {
      console.error("[麦克风测试] 取消录音失败:", err);
      // 忽略取消错误
    }

    setVolume(0);
  }, [testing]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      console.log(
        "[麦克风测试] 组件卸载，清理资源，isTestingRef:",
        isTestingRef.current,
      );
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      // 使用 ref 而不是 state，确保能获取到最新值
      if (isTestingRef.current) {
        console.log("[麦克风测试] 组件卸载时正在录音，取消录音");
        isTestingRef.current = false;
        cancelRecording().catch((err) => {
          console.error("[麦克风测试] 卸载时取消录音失败:", err);
        });
      }
    };
  }, []); // 空依赖，只在卸载时执行

  const selectedDeviceLabel = selectedDeviceId
    ? (devices.find((device) => device.id === selectedDeviceId)?.name ??
      selectedDeviceId)
    : devices.find((device) => device.is_default)?.name
      ? `系统默认 (${devices.find((device) => device.is_default)?.name})`
      : "系统默认";

  return (
    <div className="space-y-4">
      {/* 设备选择 */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select
            value={selectedDeviceId || "__default__"}
            onValueChange={(value) =>
              onDeviceChange(value === "__default__" ? undefined : value)
            }
            disabled={disabled || loading || testing}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择麦克风设备">
                {selectedDeviceLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">
                <div className="flex items-center gap-2">
                  <span>系统默认</span>
                  {devices.find((d) => d.is_default) && (
                    <span className="text-xs text-muted-foreground">
                      ({devices.find((d) => d.is_default)?.name})
                    </span>
                  )}
                </div>
              </SelectItem>
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  <div className="flex items-center gap-2">
                    <span>{device.name}</span>
                    {device.is_default && (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={loadDevices}
          disabled={loading || testing}
          title="刷新设备列表"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* 测试区域 */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
        <Button
          variant={testing ? "destructive" : "default"}
          size="sm"
          onClick={testing ? stopTest : startTest}
          disabled={disabled || loading}
        >
          {testing ? (
            <>
              <MicOff className="h-4 w-4 mr-2" />
              停止测试
            </>
          ) : (
            <>
              <Mic className="h-4 w-4 mr-2" />
              测试麦克风
            </>
          )}
        </Button>

        <div className="flex-1">
          <VolumeWaveform volume={volume} isRecording={testing} barCount={12} />
        </div>

        <div className="text-sm text-muted-foreground w-12 text-right">
          {testing ? `${volume}%` : "--"}
        </div>
      </div>

      {/* 提示信息 */}
      <p className="text-xs text-muted-foreground">
        点击"测试麦克风"按钮，对着麦克风说话，观察音量波形是否有变化。
      </p>
    </div>
  );
}

export default MicrophoneTest;
