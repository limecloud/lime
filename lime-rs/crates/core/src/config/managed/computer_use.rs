//! 管理员高优先级层仅覆盖显式字段，保留下层尚未覆盖的应用约束。

use crate::config::ComputerUseRequirementsToml;

pub(super) fn merge_computer_use_requirements(
    target: &mut ComputerUseRequirementsToml,
    source: ComputerUseRequirementsToml,
) {
    if source.allow_locked_computer_use.is_some() {
        target.allow_locked_computer_use = source.allow_locked_computer_use;
    }
    if source.allow_persistent_approval.is_some() {
        target.allow_persistent_approval = source.allow_persistent_approval;
    }
    if source.default_app_access.is_some() {
        target.default_app_access = source.default_app_access;
    }
    if let Some(macos) = source.macos {
        if let Some(bundle_ids) = macos.bundle_ids {
            target
                .macos
                .get_or_insert_default()
                .bundle_ids
                .get_or_insert_default()
                .extend(bundle_ids);
        }
    }
    if let Some(windows) = source.windows {
        let current = target.windows.get_or_insert_default();
        if let Some(aumids) = windows.aumids {
            current.aumids.get_or_insert_default().extend(aumids);
        }
        if let Some(exes) = windows.exes {
            // 上游 regular TOML merge 替换数组，显式 [] 也清除低优先级列表。
            current.exes = Some(exes);
        }
    }
}
