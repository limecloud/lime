use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellPlatform {
    Windows,
    Unix,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenClawInstallDependencyKind {
    Node,
    Git,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowsDependencyInstallPlan {
    Winget { package_id: &'static str },
    OfficialInstaller,
    ManualDownload,
}

pub fn command_bin_dir_for(platform: ShellPlatform, binary_path: &str) -> Option<String> {
    let separators: &[char] = match platform {
        ShellPlatform::Windows => &['\\', '/'],
        ShellPlatform::Unix => &['/'],
    };

    let index = binary_path.rfind(separators)?;
    if index == 0 {
        Some(binary_path[..1].to_string())
    } else {
        Some(binary_path[..index].to_string())
    }
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub fn shell_command_escape_for(platform: ShellPlatform, value: &str) -> String {
    match platform {
        ShellPlatform::Windows => format!("\"{}\"", value.replace('"', "\"\"")),
        ShellPlatform::Unix => shell_escape(value),
    }
}

pub fn shell_npm_prefix_assignment_for(platform: ShellPlatform, value: &str) -> String {
    match platform {
        ShellPlatform::Windows => {
            format!(
                "set \"NPM_CONFIG_PREFIX={}\" && ",
                value.replace('"', "\"\"")
            )
        }
        ShellPlatform::Unix => format!("NPM_CONFIG_PREFIX={} ", shell_escape(value)),
    }
}

pub fn shell_path_assignment_for(platform: ShellPlatform, binary_path: &str) -> String {
    let Some(bin_dir) = command_bin_dir_for(platform, binary_path) else {
        return String::new();
    };

    match platform {
        ShellPlatform::Windows => {
            format!("set \"PATH={};%PATH%\" && ", bin_dir.replace('"', "\"\""))
        }
        ShellPlatform::Unix => format!("PATH={}:$PATH ", shell_escape(&bin_dir)),
    }
}

pub fn shell_command_invocation_prefix_for(platform: ShellPlatform, binary_path: &str) -> String {
    match platform {
        ShellPlatform::Windows if windows_shell_requires_call(binary_path) => "call ".to_string(),
        _ => String::new(),
    }
}

fn windows_shell_requires_call(binary_path: &str) -> bool {
    Path::new(binary_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false)
}

fn shell_environment_prefix(
    platform: ShellPlatform,
    binary_path: &str,
    npm_prefix: Option<&str>,
) -> String {
    format!(
        "{}{}",
        shell_path_assignment_for(platform, binary_path),
        npm_prefix
            .map(|prefix| shell_npm_prefix_assignment_for(platform, prefix))
            .unwrap_or_default()
    )
}

pub fn build_openclaw_cleanup_command(
    platform: ShellPlatform,
    npm_path: &str,
    npm_prefix: Option<&str>,
) -> String {
    format!(
        "{}{}{} uninstall -g openclaw @qingchencloud/openclaw-zh",
        shell_environment_prefix(platform, npm_path, npm_prefix),
        shell_command_invocation_prefix_for(platform, npm_path),
        shell_command_escape_for(platform, npm_path)
    )
}

pub fn build_openclaw_install_command(
    platform: ShellPlatform,
    npm_path: &str,
    npm_prefix: Option<&str>,
    package: &str,
    registry: Option<&str>,
) -> String {
    let registry_suffix = registry
        .map(|value| format!(" --registry={value}"))
        .unwrap_or_default();
    format!(
        "{}{}{} install -g {}{}",
        shell_environment_prefix(platform, npm_path, npm_prefix),
        shell_command_invocation_prefix_for(platform, npm_path),
        shell_command_escape_for(platform, npm_path),
        package,
        registry_suffix
    )
}

pub fn resolve_windows_dependency_install_plan(
    dependency: OpenClawInstallDependencyKind,
    has_winget: bool,
) -> WindowsDependencyInstallPlan {
    match (dependency, has_winget) {
        (OpenClawInstallDependencyKind::Node, true) => WindowsDependencyInstallPlan::Winget {
            package_id: "OpenJS.NodeJS.LTS",
        },
        (OpenClawInstallDependencyKind::Node, false) => {
            WindowsDependencyInstallPlan::OfficialInstaller
        }
        (OpenClawInstallDependencyKind::Git, true) => WindowsDependencyInstallPlan::Winget {
            package_id: "Git.Git",
        },
        (OpenClawInstallDependencyKind::Git, false) => WindowsDependencyInstallPlan::ManualDownload,
    }
}

pub fn build_winget_install_command(winget_path: &str, package_id: &str) -> String {
    format!(
        "{}{} install --id {} -e --accept-source-agreements --accept-package-agreements",
        shell_path_assignment_for(ShellPlatform::Windows, winget_path),
        shell_command_escape_for(ShellPlatform::Windows, winget_path),
        package_id
    )
}

pub fn windows_manual_install_message(dependency: OpenClawInstallDependencyKind) -> &'static str {
    match dependency {
        OpenClawInstallDependencyKind::Node => {
            "当前系统缺少 winget，暂时无法一键安装 Node.js，请点击“手动下载 Node.js”完成安装后重试。"
        }
        OpenClawInstallDependencyKind::Git => {
            "当前系统缺少 winget，暂时无法一键安装 Git，请点击“手动下载 Git”完成安装后重试。"
        }
    }
}

fn command_path_rank(path: &Path) -> u8 {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("exe") => 0,
        Some("cmd") => 1,
        Some("bat") => 2,
        _ => 3,
    }
}

pub fn select_preferred_path_candidate(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .min_by_key(|path| command_path_rank(path))
}

fn is_better_semver_candidate(
    current_best: Option<&(PathBuf, (u64, u64, u64))>,
    candidate_path: &Path,
    candidate_version: (u64, u64, u64),
) -> bool {
    let Some((best_path, best_version)) = current_best else {
        return true;
    };

    candidate_version > *best_version
        || (candidate_version == *best_version
            && command_path_rank(candidate_path) < command_path_rank(best_path))
}

type SemVer = (u64, u64, u64);

pub fn select_best_semver_candidate(
    candidates: Vec<(PathBuf, Option<SemVer>)>,
    min_version: SemVer,
) -> Option<PathBuf> {
    let fallback =
        select_preferred_path_candidate(candidates.iter().map(|(path, _)| path.clone()).collect());
    let mut best_supported: Option<(PathBuf, (u64, u64, u64))> = None;
    let mut best_any: Option<(PathBuf, (u64, u64, u64))> = None;

    for (path, version) in candidates {
        let Some(version) = version else {
            continue;
        };

        if is_better_semver_candidate(best_any.as_ref(), &path, version) {
            best_any = Some((path.clone(), version));
        }

        if version >= min_version
            && is_better_semver_candidate(best_supported.as_ref(), &path, version)
        {
            best_supported = Some((path, version));
        }
    }

    best_supported
        .or(best_any)
        .map(|(path, _)| path)
        .or(fallback)
}

#[cfg(test)]
mod tests {
    use super::{
        build_openclaw_cleanup_command, build_openclaw_install_command,
        build_winget_install_command, command_bin_dir_for, resolve_windows_dependency_install_plan,
        select_best_semver_candidate, select_preferred_path_candidate, shell_command_escape_for,
        shell_command_invocation_prefix_for, shell_npm_prefix_assignment_for,
        shell_path_assignment_for, windows_manual_install_message, OpenClawInstallDependencyKind,
        ShellPlatform, WindowsDependencyInstallPlan,
    };
    use std::path::PathBuf;

    const OPENCLAW_CN_PACKAGE: &str = "@qingchencloud/openclaw-zh@latest";
    const OPENCLAW_DEFAULT_PACKAGE: &str = "openclaw@latest";
    const NPM_MIRROR_CN: &str = "https://registry.npmmirror.com";

    #[test]
    fn windows_command_bin_dir_supports_backslash_paths() {
        assert_eq!(
            command_bin_dir_for(ShellPlatform::Windows, r"C:\Program Files\nodejs\npm.cmd"),
            Some(r"C:\Program Files\nodejs".to_string())
        );
    }

    #[test]
    fn windows_shell_command_escape_keeps_cmd_compatible_quotes() {
        assert_eq!(
            shell_command_escape_for(ShellPlatform::Windows, r#"C:\Program Files\nodejs\npm.cmd"#),
            r#""C:\Program Files\nodejs\npm.cmd""#
        );
        assert_eq!(
            shell_command_escape_for(ShellPlatform::Windows, "C:\\demo\\na\"me\\npm.cmd"),
            r#""C:\demo\na""me\npm.cmd""#
        );
    }

    #[test]
    fn windows_shell_npm_prefix_assignment_uses_set_syntax() {
        assert_eq!(
            shell_npm_prefix_assignment_for(
                ShellPlatform::Windows,
                r"C:\Users\demo\AppData\Roaming\npm"
            ),
            r#"set "NPM_CONFIG_PREFIX=C:\Users\demo\AppData\Roaming\npm" && "#
        );
    }

    #[test]
    fn windows_shell_path_assignment_prepends_binary_directory() {
        assert_eq!(
            shell_path_assignment_for(ShellPlatform::Windows, r"C:\Program Files\nodejs\npm.cmd"),
            r#"set "PATH=C:\Program Files\nodejs;%PATH%" && "#
        );
    }

    #[test]
    fn windows_cmd_scripts_use_call_invocation_prefix() {
        assert_eq!(
            shell_command_invocation_prefix_for(
                ShellPlatform::Windows,
                r"C:\Program Files\nodejs\npm.cmd"
            ),
            "call "
        );
        assert!(shell_command_invocation_prefix_for(
            ShellPlatform::Windows,
            r"C:\Users\demo\AppData\Local\Microsoft\WindowsApps\winget.exe"
        )
        .is_empty());
    }

    #[test]
    fn windows_cleanup_command_uses_cmd_compatible_syntax_without_true_fallback() {
        let command = build_openclaw_cleanup_command(
            ShellPlatform::Windows,
            r"C:\Program Files\nodejs\npm.cmd",
            Some(r"C:\Users\demo\AppData\Roaming\npm"),
        );

        assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "set \"NPM_CONFIG_PREFIX=C:\\Users\\demo\\AppData\\Roaming\\npm\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" uninstall -g openclaw @qingchencloud/openclaw-zh"
            )
        );
        assert!(!command.contains("|| true"));
    }

    #[test]
    fn windows_install_command_adds_registry_when_using_china_package() {
        let command = build_openclaw_install_command(
            ShellPlatform::Windows,
            r"C:\Program Files\nodejs\npm.cmd",
            Some(r"C:\Users\demo\AppData\Roaming\npm"),
            OPENCLAW_CN_PACKAGE,
            Some(NPM_MIRROR_CN),
        );

        assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "set \"NPM_CONFIG_PREFIX=C:\\Users\\demo\\AppData\\Roaming\\npm\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" install -g @qingchencloud/openclaw-zh@latest ",
                "--registry=https://registry.npmmirror.com"
            )
        );
    }

    #[test]
    fn windows_install_command_omits_registry_for_default_package() {
        let command = build_openclaw_install_command(
            ShellPlatform::Windows,
            r"C:\Program Files\nodejs\npm.cmd",
            None,
            OPENCLAW_DEFAULT_PACKAGE,
            None,
        );

        assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" install -g openclaw@latest"
            )
        );
        assert!(!command.contains("--registry="));
    }

    #[test]
    fn preferred_path_candidate_prioritizes_windows_executable_extensions() {
        let preferred = select_preferred_path_candidate(vec![
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw"),
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw.bat"),
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"),
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw.exe"),
        ]);

        assert_eq!(
            preferred,
            Some(PathBuf::from(r"C:\nvm4w\nodejs\openclaw.exe"))
        );
    }

    #[test]
    fn semver_selection_prefers_windows_launcher_over_bare_file_when_versions_equal() {
        let preferred = select_best_semver_candidate(
            vec![
                (PathBuf::from(r"C:\nvm4w\nodejs\openclaw"), Some((23, 1, 0))),
                (
                    PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"),
                    Some((23, 1, 0)),
                ),
            ],
            (22, 0, 0),
        );

        assert_eq!(
            preferred,
            Some(PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"))
        );
    }

    #[test]
    fn windows_node_prefers_winget_when_available() {
        assert_eq!(
            resolve_windows_dependency_install_plan(OpenClawInstallDependencyKind::Node, true),
            WindowsDependencyInstallPlan::Winget {
                package_id: "OpenJS.NodeJS.LTS"
            }
        );
    }

    #[test]
    fn windows_node_falls_back_to_official_installer_without_winget() {
        assert_eq!(
            resolve_windows_dependency_install_plan(OpenClawInstallDependencyKind::Node, false),
            WindowsDependencyInstallPlan::OfficialInstaller
        );
    }

    #[test]
    fn windows_git_prefers_winget_when_available() {
        assert_eq!(
            resolve_windows_dependency_install_plan(OpenClawInstallDependencyKind::Git, true),
            WindowsDependencyInstallPlan::Winget {
                package_id: "Git.Git"
            }
        );
    }

    #[test]
    fn windows_git_requires_manual_download_without_winget() {
        assert_eq!(
            resolve_windows_dependency_install_plan(OpenClawInstallDependencyKind::Git, false),
            WindowsDependencyInstallPlan::ManualDownload
        );
        assert_eq!(
            windows_manual_install_message(OpenClawInstallDependencyKind::Git),
            "当前系统缺少 winget，暂时无法一键安装 Git，请点击“手动下载 Git”完成安装后重试。"
        );
    }

    #[test]
    fn winget_install_command_uses_expected_windows_flags() {
        assert_eq!(
            build_winget_install_command(
                r"C:\Users\demo\AppData\Local\Microsoft\WindowsApps\winget.exe",
                "OpenJS.NodeJS.LTS"
            ),
            concat!(
                "set \"PATH=C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps;%PATH%\" && ",
                "\"C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\" install ",
                "--id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements"
            )
        );
    }
}
