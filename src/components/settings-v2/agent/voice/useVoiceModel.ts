import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@/lib/desktop-host/dialog";
import {
  deleteVoiceModel,
  downloadVoiceModel,
  getVoiceModelInstallState,
  listenVoiceModelDownloadProgress,
  listVoiceModelCatalog,
  setDefaultVoiceModel,
  testTranscribeVoiceModelFile,
  type VoiceModelCatalogEntry,
  type VoiceModelDownloadProgressEvent,
  type VoiceModelInstallState,
  type VoiceModelTestTranscribeResult,
} from "@/lib/api/voiceModels";
import {
  getErrorMessage,
  getVoiceModelDisplayName,
  type VoiceModelAction,
} from "./voiceModelPresentation";

type ShowMessage = (type: "success" | "error", text: string) => void;

export function useVoiceModel(
  showMessage: ShowMessage,
  onCapabilityChange: () => void,
) {
  const { t } = useTranslation("settings");
  const [primaryVoiceModel, setPrimaryVoiceModel] =
    useState<VoiceModelCatalogEntry | null>(null);
  const [voiceModelState, setVoiceModelState] =
    useState<VoiceModelInstallState | null>(null);
  const [voiceModelAction, setVoiceModelAction] =
    useState<VoiceModelAction | null>(null);
  const [voiceModelDownloadProgress, setVoiceModelDownloadProgress] =
    useState<VoiceModelDownloadProgressEvent | null>(null);
  const [voiceModelTestPath, setVoiceModelTestPath] = useState("");
  const [voiceModelTestResult, setVoiceModelTestResult] =
    useState<VoiceModelTestTranscribeResult | null>(null);
  const [voiceModelTestError, setVoiceModelTestError] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const mounted = useRef(false);
  const actionRef = useRef<VoiceModelAction | null>(null);
  const loadSequence = useRef(0);
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(false);
    try {
      const catalog = await listVoiceModelCatalog();
      const model = catalog[0] ?? null;
      const state = model ? await getVoiceModelInstallState(model.id) : null;
      if (!mounted.current || sequence !== loadSequence.current) return;
      setPrimaryVoiceModel(model);
      setVoiceModelState(state);
    } catch {
      if (mounted.current && sequence === loadSequence.current)
        setLoadError(true);
    } finally {
      if (mounted.current && sequence === loadSequence.current)
        setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      loadSequence.current += 1;
    };
  }, [reload]);

  const handleDownloadVoiceModel = async () => {
    if (!primaryVoiceModel || actionRef.current) {
      return;
    }

    actionRef.current = "download";
    setVoiceModelAction("download");
    setVoiceModelDownloadProgress({
      model_id: primaryVoiceModel.id,
      phase: "preparing",
      downloaded_bytes: 0,
      total_bytes: primaryVoiceModel.size_bytes || null,
      overall_progress: 0,
      message: t("settings.voice.model.status.prepareDownload"),
    });
    let unlistenProgress: (() => void) | null = null;
    try {
      unlistenProgress = await listenVoiceModelDownloadProgress((event) => {
        if (event.model_id !== primaryVoiceModel.id) {
          return;
        }
        if (mounted.current) setVoiceModelDownloadProgress(event);
      }).catch((error) => {
        console.warn("监听语音模型下载进度失败:", error);
        return null;
      });
      if (!mounted.current) return;
      const result = await downloadVoiceModel(primaryVoiceModel.id);
      if (!mounted.current) return;
      setVoiceModelState(result.state);
      onCapabilityChange();
      setVoiceModelTestError(null);
      setVoiceModelTestResult(null);
      showMessage(
        "success",
        t("settings.voice.model.message.downloaded", {
          model: getVoiceModelDisplayName(primaryVoiceModel),
        }),
      );
    } catch (error) {
      console.error("下载 SenseVoice Small 模型失败:", error);
      showMessage(
        "error",
        t("settings.voice.model.message.downloadFailed", {
          model: getVoiceModelDisplayName(primaryVoiceModel),
        }),
      );
    } finally {
      unlistenProgress?.();
      actionRef.current = null;
      if (mounted.current) setVoiceModelAction(null);
      setVoiceModelDownloadProgress(null);
    }
  };

  const handleDeleteVoiceModel = async () => {
    if (!primaryVoiceModel || actionRef.current) {
      return;
    }

    actionRef.current = "delete";
    setVoiceModelAction("delete");
    try {
      const state = await deleteVoiceModel(primaryVoiceModel.id);
      setVoiceModelState(state);
      onCapabilityChange();
      setVoiceModelTestError(null);
      setVoiceModelTestResult(null);
      await reload();
      showMessage(
        "success",
        t("settings.voice.model.message.deleted", {
          model: getVoiceModelDisplayName(primaryVoiceModel),
        }),
      );
    } catch (error) {
      console.error("删除 SenseVoice Small 模型失败:", error);
      showMessage(
        "error",
        t("settings.voice.model.message.deleteFailed", {
          model: getVoiceModelDisplayName(primaryVoiceModel),
        }),
      );
    } finally {
      actionRef.current = null;
      if (mounted.current) setVoiceModelAction(null);
    }
  };

  const handleSetDefaultVoiceModel = async () => {
    if (!primaryVoiceModel || actionRef.current) {
      return;
    }

    actionRef.current = "default";
    setVoiceModelAction("default");
    try {
      await setDefaultVoiceModel(primaryVoiceModel.id);
      onCapabilityChange();
      await reload();
      showMessage(
        "success",
        t("settings.voice.model.message.defaultSet", {
          model: getVoiceModelDisplayName(primaryVoiceModel),
        }),
      );
    } catch (error) {
      console.error("设置 SenseVoice Small 默认模型失败:", error);
      showMessage(
        "error",
        t("settings.voice.model.message.defaultSetFailed", {
          model: getVoiceModelDisplayName(primaryVoiceModel),
        }),
      );
    } finally {
      actionRef.current = null;
      if (mounted.current) setVoiceModelAction(null);
    }
  };

  const handleSelectVoiceModelTestFile = async () => {
    if (!voiceModelState?.installed || voiceModelAction !== null) {
      return;
    }

    try {
      const selected = await openDialog({
        title: t("settings.voice.model.test.dialogTitle"),
        multiple: false,
        directory: false,
        filters: [
          {
            name: t("settings.voice.model.test.dialogFilter"),
            extensions: ["wav"],
          },
        ],
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) {
        return;
      }
      setVoiceModelTestPath(filePath);
      setVoiceModelTestError(null);
      setVoiceModelTestResult(null);
    } catch (error) {
      console.error("选择 SenseVoice Small 测试文件失败:", error);
      const errorMessage = getErrorMessage(
        error,
        t("settings.voice.model.test.selectFailed"),
      );
      setVoiceModelTestError(errorMessage);
      showMessage("error", t("settings.voice.model.test.selectFailed"));
    }
  };

  const handleTestVoiceModel = async () => {
    if (
      !primaryVoiceModel ||
      !voiceModelState?.installed ||
      actionRef.current
    ) {
      return;
    }

    const filePath = voiceModelTestPath.trim();
    if (!filePath) {
      setVoiceModelTestError(t("settings.voice.model.test.pathRequired"));
      return;
    }

    actionRef.current = "test";
    setVoiceModelAction("test");
    setVoiceModelTestError(null);
    setVoiceModelTestResult(null);
    try {
      const result = await testTranscribeVoiceModelFile(
        primaryVoiceModel.id,
        filePath,
      );
      setVoiceModelTestResult(result);
      showMessage(
        "success",
        t("settings.voice.model.test.completed", {
          model: getVoiceModelDisplayName(primaryVoiceModel),
        }),
      );
    } catch (error) {
      console.error("SenseVoice Small 测试转写失败:", error);
      const errorMessage = getErrorMessage(
        error,
        t("settings.voice.model.test.failed"),
      );
      setVoiceModelTestError(errorMessage);
      showMessage("error", t("settings.voice.model.test.failed"));
    } finally {
      actionRef.current = null;
      if (mounted.current) setVoiceModelAction(null);
    }
  };

  return {
    primaryVoiceModel,
    voiceModelState,
    voiceModelAction,
    voiceModelDownloadProgress,
    voiceModelTestPath,
    setVoiceModelTestPath,
    voiceModelTestResult,
    voiceModelTestError,
    loading,
    loadError,
    reload,
    handleDownloadVoiceModel,
    handleDeleteVoiceModel,
    handleSetDefaultVoiceModel,
    handleSelectVoiceModelTestFile,
    handleTestVoiceModel,
  };
}
