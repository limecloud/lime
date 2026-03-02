use std::path::Path;

/// 确保 workspace 根目录可用。
///
/// 返回值：
/// - `Ok(true)`: 目录原本不存在，已自动创建
/// - `Ok(false)`: 目录已存在且可用
/// - `Err(...)`: 路径非法/无权限等不可恢复错误
pub fn ensure_workspace_root_ready(workspace_root: &Path) -> Result<bool, String> {
    if workspace_root.exists() {
        if workspace_root.is_dir() {
            return Ok(false);
        }
        return Err(format!(
            "Workspace 路径存在但不是目录: {}。请删除同名文件或重新选择目录。",
            workspace_root.to_string_lossy()
        ));
    }

    std::fs::create_dir_all(workspace_root).map_err(|error| {
        let path_str = workspace_root.to_string_lossy();
        let hint = workspace_root
            .parent()
            .map(|parent| {
                if !parent.exists() {
                    format!("父目录 '{}' 不存在", parent.display())
                } else if std::fs::metadata(parent)
                    .map(|metadata| metadata.permissions().readonly())
                    .unwrap_or(false)
                {
                    format!("父目录 '{}' 无写入权限", parent.display())
                } else {
                    format!("错误: {error}")
                }
            })
            .unwrap_or_else(|| format!("错误: {error}"));
        format!(
            "Workspace 路径不存在，且自动创建失败: {path_str}。{hint}。请重新选择一个有效的本地目录。"
        )
    })?;

    Ok(true)
}
