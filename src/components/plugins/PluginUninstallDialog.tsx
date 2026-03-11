/**
 * 插件卸载确认对话框组件
 *
 * 显示卸载确认信息，确认后调用卸载命令
 * _需求: 4.1, 4.2, 4.3_
 */

import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { uninstallPlugin } from "@/lib/api/plugins";

/** 已安装插件信息 */
interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  install_path: string;
  installed_at: string;
  enabled: boolean;
}

interface PluginUninstallDialogProps {
  isOpen: boolean;
  plugin: InstalledPlugin | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function PluginUninstallDialog({
  isOpen,
  plugin,
  onClose,
  onSuccess,
}: PluginUninstallDialogProps) {
  const [uninstalling, setUninstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 关闭对话框
  const handleClose = () => {
    if (uninstalling) return;
    setError(null);
    onClose();
  };

  // 执行卸载
  const handleUninstall = async () => {
    if (!plugin) return;

    setUninstalling(true);
    setError(null);

    try {
      await uninstallPlugin(plugin.id);
      onSuccess();
      // 触发侧边栏刷新事件
      window.dispatchEvent(new CustomEvent("plugin-changed"));
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUninstalling(false);
    }
  };

  if (!plugin) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-sm"
      showCloseButton={false}
      closeOnOverlayClick={!uninstalling}
    >
      <ModalBody>
        <div className="flex items-start gap-4">
          <div className="mt-0.5 text-red-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">确认卸载插件</h3>
            <div className="mt-2 space-y-2 text-sm text-muted-foreground">
              <p>
                确定要卸载插件{" "}
                <span className="font-medium text-foreground">
                  {plugin.name}
                </span>{" "}
                吗？
              </p>
              <p>此操作将删除插件文件和相关配置，无法撤销。</p>
            </div>

            {/* 插件信息 */}
            <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
              <div className="space-y-1">
                <p>
                  <span className="text-muted-foreground">版本：</span>
                  {plugin.version}
                </p>
                {plugin.description && (
                  <p>
                    <span className="text-muted-foreground">描述：</span>
                    {plugin.description}
                  </p>
                )}
              </div>
            </div>

            {/* 错误显示 */}
            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={handleClose} disabled={uninstalling}>
          取消
        </Button>
        <Button
          variant="destructive"
          onClick={handleUninstall}
          disabled={uninstalling}
        >
          {uninstalling ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              卸载中...
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4 mr-2" />
              确认卸载
            </>
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
