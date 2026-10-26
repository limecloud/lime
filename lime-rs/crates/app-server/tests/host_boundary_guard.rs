use std::fs;
use std::path::Path;
use std::path::PathBuf;

const FORBIDDEN_HOST_SURFACES: &[&str] = &[
    concat!("ta", "uri"),
    "AppHandle",
    "State<",
    "tauri::Emitter",
    "tauri::Manager",
    "tauri::Window",
    "WindowEvent",
    "WebviewWindow",
    "BrowserWindow",
    "electron",
    "Electron",
];

const FORBIDDEN_DEFAULT_EVENT_SURFACES: &[&str] = &[
    "lime_agent::AgentEvent",
    "Vec<lime_agent::AgentEvent>",
    "lime_agent_event_to_runtime_event",
    "emit_lime_agent_event_to_sink",
    "runtime_event_type_from_lime_agent_type",
];

#[test]
fn app_server_crate_must_not_depend_on_desktop_host_surfaces() {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest = fs::read_to_string(crate_root.join("Cargo.toml")).expect("读取 Cargo.toml");
    assert!(
        !manifest.contains(concat!("ta", "uri")),
        "app-server crate 不能直接依赖桌面宿主壳层；壳层能力必须通过 HostAdapter 注入"
    );

    let mut offenders = Vec::new();
    collect_rust_files(&crate_root.join("src"), &mut offenders);
    let offenders = offenders
        .into_iter()
        .filter_map(|path| {
            let content = fs::read_to_string(&path)
                .unwrap_or_default()
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            let matches = FORBIDDEN_HOST_SURFACES
                .iter()
                .filter(|surface| content.contains(**surface))
                .map(|surface| (*surface).to_string())
                .collect::<Vec<_>>();
            if matches.is_empty() {
                None
            } else {
                Some((path, matches))
            }
        })
        .collect::<Vec<_>>();

    let offender_paths: Vec<String> = offenders
        .into_iter()
        .map(|(path, surfaces)| {
            format!(
                "{} contains {}",
                path.strip_prefix(&crate_root)
                    .expect("相对路径转换失败")
                    .to_string_lossy()
                    .replace('\\', "/"),
                surfaces.join(", ")
            )
        })
        .collect();

    assert_eq!(offender_paths, Vec::<String>::new());
}

#[test]
fn app_server_public_backend_contract_must_use_runtime_events() {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let checked_files = [
        crate_root.join("src/capability.rs"),
        crate_root.join("src/lib.rs"),
        crate_root.join("src/runtime.rs"),
        crate_root.join("src/runtime_factory.rs"),
    ];

    let mut offenders = Vec::new();
    for path in checked_files {
        let content = fs::read_to_string(&path).expect("读取 app-server 边界文件");
        for surface in FORBIDDEN_DEFAULT_EVENT_SURFACES {
            if content.contains(surface) {
                offenders.push(format!(
                    "{} contains {}",
                    path.strip_prefix(&crate_root)
                        .expect("相对路径转换失败")
                        .to_string_lossy()
                        .replace('\\', "/"),
                    surface
                ));
            }
        }
    }

    assert_eq!(
        offenders,
        Vec::<String>::new(),
        "app-server 公共后端边界只能暴露 RuntimeEvent；Lime/Agent 私有事件转换必须留在 Desktop compat adapter"
    );
}

fn collect_rust_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            collect_rust_files(&path, files);
            continue;
        }

        if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            files.push(path);
        }
    }
}
