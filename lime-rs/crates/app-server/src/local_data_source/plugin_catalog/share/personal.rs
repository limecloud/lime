use super::super::{store::PluginId, PluginStore};
use crate::plugin_remote::wire::Item;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

const RELATIVE_PATH: &str = ".agents/plugins/marketplace.json";
const MAX_BYTES: u64 = 4 * 1024 * 1024;

pub(super) struct Update {
    pub name: String,
    pub path: PathBuf,
    previous: Option<Vec<u8>>,
    contents: Vec<u8>,
}

/// Prepare while holding the existing store lock; preserve unrelated marketplace fields.
pub(super) fn prepare(home: &Path, plugin_path: &Path, item: &Item) -> Result<Update, String> {
    let relative = plugin_path
        .strip_prefix(home)
        .map_err(|_| "checkout must be inside home")?;
    if relative.as_os_str().is_empty() {
        return Err("checkout must not replace home".into());
    }
    let relative = relative
        .components()
        .map(|part| match part {
            Component::Normal(value) => value.to_str().ok_or("checkout path must be UTF-8"),
            _ => Err("checkout path cannot be represented in personal marketplace"),
        })
        .collect::<Result<Vec<_>, _>>()?
        .join("/");
    let source = format!("./{relative}");
    let path = within_home(home, Path::new(RELATIVE_PATH))?;
    let previous = match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.len() > MAX_BYTES {
                return Err("invalid personal marketplace file".into());
            }
            let mut bytes = Vec::new();
            fs::File::open(&path)
                .map_err(io_error)?
                .take(MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(io_error)?;
            if bytes.len() as u64 > MAX_BYTES {
                return Err("personal marketplace exceeds size limit".into());
            }
            Some(bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(io_error(error)),
    };
    let mut value: Value = previous
        .as_ref()
        .map(|bytes| serde_json::from_slice(bytes))
        .transpose()
        .map_err(|_| "invalid personal marketplace JSON")?
        .unwrap_or_else(
            || json!({"name":"lime-curated","interface":{"displayName":"Personal"},"plugins":[]}),
        );
    let object = value
        .as_object_mut()
        .ok_or("personal marketplace must be an object")?;
    let name = object
        .entry("name")
        .or_insert_with(|| json!("lime-curated"))
        .as_str()
        .ok_or("personal marketplace name must be a string")?
        .to_string();
    PluginId::new(&item.name, &name)?;
    let plugins = object
        .entry("plugins")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or("personal marketplace plugins must be an array")?;
    let mut names = BTreeSet::new();
    for entry in plugins.iter() {
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .ok_or("invalid personal marketplace entry")?;
        if !names.insert(name.to_string()) {
            return Err("duplicate personal marketplace plugin".into());
        }
    }
    let mut entry = json!({"name":item.name,"source":{"source":"local","path":source},
        "policy":{"installation":item.installation_policy,"authentication":item.authentication_policy}});
    if let Some(category) = item
        .release
        .interface
        .category
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        entry["category"] = json!(category);
    }
    if let Some(existing) = plugins
        .iter_mut()
        .find(|entry| entry.get("name").and_then(Value::as_str) == Some(&item.name))
    {
        if existing.pointer("/source/path").and_then(Value::as_str) != Some(&source)
            || existing.pointer("/source/source").and_then(Value::as_str) != Some("local")
        {
            return Err(
                "personal marketplace already contains this name with another source".into(),
            );
        }
        *existing = entry;
    } else {
        if plugins.len() >= 10_000 {
            return Err("personal marketplace exceeds entry limit".into());
        }
        plugins.push(entry);
    }
    let mut contents = serde_json::to_vec_pretty(&value)
        .map_err(|_| "personal marketplace serialization failed")?;
    contents.push(b'\n');
    if contents.len() as u64 > MAX_BYTES {
        return Err("personal marketplace exceeds size limit".into());
    }
    Ok(Update {
        name,
        path,
        previous,
        contents,
    })
}

impl Update {
    pub fn commit(&self) -> Result<(), String> {
        write(&self.path, &self.contents)
    }

    pub fn rollback(&self) -> Result<(), String> {
        match &self.previous {
            Some(bytes) => write(&self.path, bytes),
            None => fs::remove_file(&self.path).map_err(io_error),
        }
    }
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("personal marketplace has no parent")?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(io_error)?;
    file.persist(path)
        .map_err(|_| "personal marketplace commit failed")?;
    Ok(())
}

pub(super) fn home(store: &PluginStore) -> Result<PathBuf, String> {
    let home = store
        .home
        .as_ref()
        .filter(|home| home.is_absolute())
        .ok_or("home directory is unavailable")?;
    let home = fs::canonicalize(home).map_err(io_error)?;
    if !home.is_dir() {
        return Err("home must be a directory".into());
    }
    Ok(home)
}

/// Resolve existing ancestors too so a redirected personal directory cannot escape home.
pub(super) fn within_home(home: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut path = home.to_owned();
    for part in relative.components() {
        let Component::Normal(part) = part else {
            return Err("checkout path must stay inside home".into());
        };
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                if !fs::canonicalize(&path).map_err(io_error)?.starts_with(home) {
                    return Err("checkout path escapes home through a symbolic link".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
    }
    Ok(path)
}

fn io_error(error: std::io::Error) -> String {
    format!("personal marketplace IO failed: {error}")
}
