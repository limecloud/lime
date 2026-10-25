use super::*;

#[cfg(test)]
pub(super) fn read_manifest(package_root: &Path) -> Result<Value, String> {
    read_manifest_with_name(package_root, None)
}

pub(super) fn read_manifest_with_name(
    package_root: &Path,
    fallback_name: Option<&str>,
) -> Result<Value, String> {
    let root = canonical_package_root(package_root)?;
    let path = find_manifest_path(&root)?;
    let content = read_manifest_file(&path)?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("解析 Plugin manifest 失败: {error}"))?;
    let Value::Object(mut object) = value else {
        return Err("Plugin manifest 必须是 object。".to_string());
    };
    if path != root.join("plugin.json") {
        validate_native_manifest_fields(&object)?;
        if object
            .get("name")
            .and_then(Value::as_str)
            .is_none_or(|name| name.trim().is_empty())
        {
            object.insert(
                "name".to_string(),
                Value::String(
                    fallback_name
                        .or_else(|| root.file_name().and_then(|name| name.to_str()))
                        .unwrap_or_default()
                        .to_string(),
                ),
            );
        }
        let manifest = Value::Object(object);
        manifest_name(&manifest)?;
        manifest_version(&manifest)?;
        return Ok(manifest);
    }
    for field in object.keys() {
        if !STANDARD_MANIFEST_FIELDS.contains(&field.as_str()) {
            tracing::warn!(
                path = %path.display(),
                field,
                "忽略未知 Agent Plugins manifest 字段"
            );
        }
    }
    object.retain(|field, _| STANDARD_MANIFEST_FIELDS.contains(&field.as_str()));
    if object
        .get("extensions")
        .is_some_and(|extensions| !extensions.is_object())
    {
        tracing::warn!(
            path = %path.display(),
            "忽略非 object 的 Agent Plugins extensions 字段"
        );
        object.remove("extensions");
    }
    if object.get("$schema").and_then(Value::as_str) != Some(STANDARD_MANIFEST_SCHEMA) {
        return Err(format!(
            "plugin.json 必须声明标准 schema `{STANDARD_MANIFEST_SCHEMA}`。"
        ));
    }
    validate_standard_manifest_fields(&object)?;

    // 标准包的资源固定，client extension 仅可覆盖 Apps、Hooks 和 interface。
    object.insert("skills".to_string(), serde_json::json!(["./skills"]));
    object.insert(
        "mcpServers".to_string(),
        Value::String("./mcp.json".to_string()),
    );
    let mut manifest = Value::Object(object);
    apply_lime_manifest_extension(&root, &path, &mut manifest)?;
    manifest_name(&manifest)?;
    manifest_version(&manifest)?;
    Ok(manifest)
}

pub(super) fn validate_standard_manifest_fields(
    object: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "Plugin manifest 缺少合法 name。".to_string())?;
    validate_standard_name(name)?;

    for field in [
        "version",
        "description",
        "homepage",
        "repository",
        "license",
    ] {
        if object.get(field).is_some_and(|value| !value.is_string()) {
            return Err(format!("Agent Plugins `{field}` 必须是 string。"));
        }
    }

    if let Some(author) = object.get("author") {
        let author = author
            .as_object()
            .ok_or_else(|| "Agent Plugins `author` 必须是 object。".to_string())?;
        for (field, value) in author {
            if !["name", "email", "url"].contains(&field.as_str()) {
                return Err(format!("Agent Plugins `author` 包含未知字段 `{field}`。"));
            }
            if !value.is_string() {
                return Err(format!("Agent Plugins `author.{field}` 必须是 string。"));
            }
        }
    }

    if let Some(keywords) = object.get("keywords") {
        let keywords = keywords
            .as_array()
            .ok_or_else(|| "Agent Plugins `keywords` 必须是 string array。".to_string())?;
        if keywords.iter().any(|keyword| !keyword.is_string()) {
            return Err("Agent Plugins `keywords` 必须是 string array。".to_string());
        }
    }
    Ok(())
}

pub(super) fn apply_lime_manifest_extension(
    package_root: &Path,
    manifest_path: &Path,
    manifest: &mut Value,
) -> Result<(), String> {
    let inline_extension = manifest
        .get("extensions")
        .and_then(Value::as_object)
        .and_then(|extensions| extensions.get(LIME_EXTENSION_NAMESPACE))
        .and_then(|extension| {
            if extension.is_object() {
                Some(extension.clone())
            } else {
                tracing::warn!(
                    path = %manifest_path.display(),
                    namespace = LIME_EXTENSION_NAMESPACE,
                    "忽略非 object 的 Agent Plugins client extension"
                );
                None
            }
        });
    let extension = match inline_extension {
        Some(extension) => Some(extension),
        None => {
            let overlay_path = package_root.join(LIME_EXTENSION_MANIFEST_PATH);
            match fs::read_to_string(&overlay_path) {
                Ok(contents) => Some(
                    serde_json::from_str(&contents)
                        .map_err(|error| format!("解析 Lime Plugin extension 失败: {error}"))?,
                ),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(format!("读取 Lime Plugin extension 失败: {error}")),
            }
        }
    };
    let Some(extension) = extension else {
        return Ok(());
    };
    let extension = extension
        .as_object()
        .ok_or_else(|| "Lime Plugin extension 必须是 object。".to_string())?;
    if let Some(interface) = extension.get("interface") {
        if !interface.is_object() {
            return Err("Lime Plugin extension interface 必须是 object。".to_string());
        }
        manifest
            .as_object_mut()
            .expect("validated manifest object")
            .insert("interface".to_string(), interface.clone());
    }
    if let Some(hooks) = extension.get("hooks") {
        manifest
            .as_object_mut()
            .expect("validated manifest object")
            .insert("hooks".to_string(), hooks.clone());
    }
    if let Some(apps) = extension.get("apps") {
        if !apps.is_string() {
            return Err("Lime Plugin extension apps 必须是包内相对路径。".to_string());
        }
        manifest
            .as_object_mut()
            .expect("validated manifest object")
            .insert("apps".to_string(), apps.clone());
    }
    Ok(())
}

pub(super) fn manifest_name(manifest: &Value) -> Result<String, String> {
    let name = manifest_string(manifest, "name")
        .ok_or_else(|| "Plugin manifest 缺少 name。".to_string())?;
    validate_plugin_id(&name)?;
    Ok(name)
}

pub(super) fn manifest_version(manifest: &Value) -> Result<String, String> {
    let version = manifest_string(manifest, "version").unwrap_or_else(|| {
        if is_standard_manifest(manifest) {
            "1.0.0"
        } else {
            "local"
        }
        .to_string()
    });
    if version.is_empty()
        || matches!(version.as_str(), "." | "..")
        || !version
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+'))
    {
        return Err("Plugin version 不能作为安全的 cache 路径。".to_string());
    }
    Ok(version)
}

pub(super) fn manifest_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(super) fn interface_string(manifest: &Value, key: &str) -> Option<String> {
    manifest
        .get("interface")
        .and_then(Value::as_object)
        .and_then(|interface| interface.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(super) fn is_standard_manifest(manifest: &Value) -> bool {
    manifest.get("$schema").and_then(Value::as_str) == Some(STANDARD_MANIFEST_SCHEMA)
}

pub(super) fn read_manifest_file(path: &Path) -> Result<String, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(io_error("读取 Plugin manifest 元数据失败"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Plugin manifest 必须是普通文件。".to_string());
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("Plugin manifest 超过大小限制。".to_string());
    }
    fs::read_to_string(path).map_err(io_error("读取 Plugin manifest 失败"))
}

pub(super) fn find_manifest_path(root: &Path) -> Result<PathBuf, String> {
    let standard = root.join("plugin.json");
    match fs::symlink_metadata(&standard) {
        Ok(_) => {
            let contents = read_manifest_file(&standard)?;
            if serde_json::from_str::<Value>(&contents)
                .ok()
                .and_then(|value| {
                    value
                        .get("$schema")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })
                .is_some_and(|schema| schema.starts_with("https://agent-plugins.org/schemas/"))
            {
                return Ok(standard);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("读取 Plugin manifest 失败: {error}")),
    }
    for relative in [
        ".lime-plugin/plugin.json",
        ".claude-plugin/plugin.json",
        ".cursor-plugin/plugin.json",
    ] {
        let candidate = root.join(relative);
        match fs::symlink_metadata(candidate.parent().expect("manifest parent")) {
            Ok(metadata) if !metadata.file_type().is_dir() => {
                return Err("Plugin manifest 目录必须是普通目录。".to_string())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("读取 Plugin manifest 目录失败: {error}")),
        }
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) if metadata.file_type().is_file() => return Ok(candidate),
            Ok(_) => return Err("Plugin manifest 必须是普通文件。".to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("读取 Plugin manifest 失败: {error}")),
        }
    }
    Err("未找到 Lime 支持的 Plugin manifest。".to_string())
}

fn validate_native_manifest_fields(object: &serde_json::Map<String, Value>) -> Result<(), String> {
    for field in ["name", "version", "description", "apps"] {
        if object.get(field).is_some_and(|value| {
            !value.is_null() && !value.is_string() || field == "name" && value.is_null()
        }) {
            return Err(format!("Plugin `{field}` 必须是 string。"));
        }
    }
    if object
        .get("interface")
        .is_some_and(|value| !value.is_null() && !value.is_object())
    {
        return Err("Plugin interface 必须是 object。".to_string());
    }
    if let Some(keywords) = object.get("keywords") {
        if keywords
            .as_array()
            .is_none_or(|values| values.iter().any(|value| !value.is_string()))
        {
            return Err("Plugin keywords 必须是 string array。".to_string());
        }
    }
    Ok(())
}

pub(super) fn skill_paths(root: &Path, manifest: &Value) -> Result<Vec<PathBuf>, String> {
    let mut paths = match manifest.get("skills") {
        Some(Value::String(path)) => vec![path.as_str()],
        Some(Value::Array(paths)) => paths.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    paths.retain(|path| {
        path.starts_with("./")
            && !Path::new(path).components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
    });
    if paths.is_empty() && !is_standard_manifest(manifest) {
        paths.push("./skills");
    }
    let mut resolved = Vec::new();
    for path in paths {
        if !path.starts_with("./") {
            continue;
        }
        match resource_path(root, path) {
            Ok(path) if path.is_dir() && !resolved.contains(&path) => resolved.push(path),
            Ok(_) => {}
            Err(error) => tracing::warn!(%error, "忽略不可用的 Plugin skill root"),
        }
    }
    Ok(resolved)
}
