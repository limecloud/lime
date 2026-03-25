use serde_json::{Map, Value};
use std::collections::HashMap;

pub const FILESYSTEM_EVENT_PATH_KEYS: &[&str] = &[
    "path",
    "file_path",
    "filePath",
    "file_name",
    "fileName",
    "filename",
    "target_path",
    "targetPath",
    "output_path",
    "outputPath",
    "absolute_path",
    "absolutePath",
    "new_path",
    "newPath",
    "paths",
    "files",
];

pub const FILESYSTEM_EVENT_LOCATION_HINT_KEYS: &[&str] =
    &["directory", "cwd", "output_file", "offload_file"];

pub fn normalize_filesystem_event_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.replace('\\', "/"))
    }
}

pub fn extract_filesystem_event_paths(record: &Map<String, Value>) -> Vec<String> {
    extract_paths_from_object(record, FILESYSTEM_EVENT_PATH_KEYS)
}

pub fn extract_filesystem_event_paths_from_value(value: &Value) -> Vec<String> {
    extract_paths_from_value(value, FILESYSTEM_EVENT_PATH_KEYS)
}

pub fn extract_filesystem_event_paths_from_metadata(
    metadata: &HashMap<String, Value>,
) -> Vec<String> {
    extract_paths_from_metadata(metadata, FILESYSTEM_EVENT_PATH_KEYS)
}

pub fn extract_filesystem_event_location_hints(record: &Map<String, Value>) -> Vec<String> {
    extract_paths_from_object(record, FILESYSTEM_EVENT_LOCATION_HINT_KEYS)
}

pub fn extract_filesystem_event_location_hints_from_value(value: &Value) -> Vec<String> {
    extract_paths_from_value(value, FILESYSTEM_EVENT_LOCATION_HINT_KEYS)
}

pub fn extract_filesystem_event_location_hints_from_metadata(
    metadata: &HashMap<String, Value>,
) -> Vec<String> {
    extract_paths_from_metadata(metadata, FILESYSTEM_EVENT_LOCATION_HINT_KEYS)
}

fn extract_paths_from_object(record: &Map<String, Value>, keys: &[&str]) -> Vec<String> {
    let mut paths = Vec::new();
    append_paths_from_object(&mut paths, record, keys);
    paths
}

fn extract_paths_from_value(value: &Value, keys: &[&str]) -> Vec<String> {
    let mut paths = Vec::new();
    collect_paths_from_value(&mut paths, value, keys);
    paths
}

fn extract_paths_from_metadata(metadata: &HashMap<String, Value>, keys: &[&str]) -> Vec<String> {
    let mut paths = Vec::new();
    append_paths_from_metadata(&mut paths, metadata, keys);
    for value in metadata.values() {
        if matches!(value, Value::Array(_) | Value::Object(_)) {
            collect_paths_from_value(&mut paths, value, keys);
        }
    }
    paths
}

fn append_unique_path(target: &mut Vec<String>, raw: &str) {
    let Some(normalized) = normalize_filesystem_event_path(raw) else {
        return;
    };
    if !target.iter().any(|item| item == &normalized) {
        target.push(normalized);
    }
}

fn append_paths_from_field(target: &mut Vec<String>, value: &Value) {
    match value {
        Value::String(path) => append_unique_path(target, path),
        Value::Array(items) => {
            for item in items {
                append_paths_from_field(target, item);
            }
        }
        _ => {}
    }
}

fn append_paths_from_object(target: &mut Vec<String>, object: &Map<String, Value>, keys: &[&str]) {
    for key in keys {
        if let Some(value) = object.get(*key) {
            append_paths_from_field(target, value);
        }
    }
}

fn append_paths_from_metadata(
    target: &mut Vec<String>,
    metadata: &HashMap<String, Value>,
    keys: &[&str],
) {
    for key in keys {
        if let Some(value) = metadata.get(*key) {
            append_paths_from_field(target, value);
        }
    }
}

fn collect_paths_from_value(target: &mut Vec<String>, value: &Value, keys: &[&str]) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_paths_from_value(target, item, keys);
            }
        }
        Value::Object(object) => {
            append_paths_from_object(target, object, keys);
            for nested in object.values() {
                if matches!(nested, Value::Array(_) | Value::Object(_)) {
                    collect_paths_from_value(target, nested, keys);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_filesystem_event_paths_reads_canonical_keys() {
        let value = serde_json::json!({
            "file_path": " workspace\\draft.md ",
            "fileName": "workspace/final.md",
            "new_path": "workspace/next.md",
            "paths": ["workspace/archive.md"],
        });

        let paths = extract_filesystem_event_paths(
            value
                .as_object()
                .expect("filesystem event record should be object"),
        );

        assert_eq!(
            paths,
            vec![
                "workspace/draft.md".to_string(),
                "workspace/final.md".to_string(),
                "workspace/next.md".to_string(),
                "workspace/archive.md".to_string(),
            ]
        );
    }

    #[test]
    fn extract_filesystem_event_paths_does_not_mix_location_hint_keys() {
        let value = serde_json::json!({
            "output_file": "workspace/result.log",
            "cwd": "/tmp/workspace",
        });

        let paths = extract_filesystem_event_paths(
            value
                .as_object()
                .expect("filesystem event record should be object"),
        );

        assert!(paths.is_empty());
    }

    #[test]
    fn extract_filesystem_event_paths_from_value_recurses_nested_records() {
        let paths = extract_filesystem_event_paths_from_value(&serde_json::json!({
            "payload": {
                "newPath": "workspace\\next.md",
            },
            "result": [
                {
                    "absolute_path": "/tmp/workspace/final.md",
                },
            ],
        }));

        assert_eq!(
            paths,
            vec![
                "workspace/next.md".to_string(),
                "/tmp/workspace/final.md".to_string(),
            ]
        );
    }

    #[test]
    fn extract_filesystem_event_paths_from_metadata_recurses_nested_records() {
        let metadata = HashMap::from([
            (
                "filePath".to_string(),
                Value::String("workspace\\demo.md".to_string()),
            ),
            (
                "payload".to_string(),
                serde_json::json!({
                    "files": ["workspace/cover.png"]
                }),
            ),
        ]);

        assert_eq!(
            extract_filesystem_event_paths_from_metadata(&metadata),
            vec![
                "workspace/demo.md".to_string(),
                "workspace/cover.png".to_string(),
            ]
        );
    }

    #[test]
    fn extract_filesystem_event_location_hints_reads_canonical_keys() {
        let value = serde_json::json!({
            "directory": "workspace\\docs",
            "cwd": "/tmp/workspace",
            "output_file": "workspace/result.log",
            "offload_file": "workspace/offload.txt",
        });

        let paths = extract_filesystem_event_location_hints(
            value
                .as_object()
                .expect("filesystem hint record should be object"),
        );

        assert_eq!(
            paths,
            vec![
                "workspace/docs".to_string(),
                "/tmp/workspace".to_string(),
                "workspace/result.log".to_string(),
                "workspace/offload.txt".to_string(),
            ]
        );
    }

    #[test]
    fn extract_filesystem_event_location_hints_from_value_recurses_nested_records() {
        let paths = extract_filesystem_event_location_hints_from_value(&serde_json::json!({
            "payload": {
                "offload_file": "workspace\\full-output.txt",
            },
        }));

        assert_eq!(paths, vec!["workspace/full-output.txt".to_string()]);
    }

    #[test]
    fn extract_filesystem_event_location_hints_from_metadata_recurses_nested_records() {
        let metadata = HashMap::from([
            (
                "cwd".to_string(),
                Value::String("workspace\\root".to_string()),
            ),
            (
                "payload".to_string(),
                serde_json::json!({
                    "output_file": "workspace/result.md"
                }),
            ),
        ]);

        assert_eq!(
            extract_filesystem_event_location_hints_from_metadata(&metadata),
            vec![
                "workspace/root".to_string(),
                "workspace/result.md".to_string()
            ]
        );
    }
}
