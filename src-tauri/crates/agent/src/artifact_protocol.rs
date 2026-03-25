use serde_json::{Map, Value};
use std::collections::HashMap;

pub const ARTIFACT_PROTOCOL_PATH_KEYS: &[&str] = &[
    "path",
    "file_path",
    "filePath",
    "target_path",
    "targetPath",
    "output_path",
    "outputPath",
    "absolute_path",
    "absolutePath",
    "artifact_path",
    "artifactPath",
    "artifact_paths",
    "artifactPaths",
    "paths",
    "source_file_name",
    "sourceFileName",
];

pub fn normalize_artifact_protocol_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.replace('\\', "/"))
    }
}

pub fn push_unique_artifact_protocol_path(target: &mut Vec<String>, raw: &str) {
    let Some(normalized) = normalize_artifact_protocol_path(raw) else {
        return;
    };
    if !target.iter().any(|item| item == &normalized) {
        target.push(normalized);
    }
}

pub fn extend_unique_artifact_protocol_paths(target: &mut Vec<String>, incoming: &[String]) {
    for path in incoming {
        push_unique_artifact_protocol_path(target, path);
    }
}

pub fn extract_artifact_protocol_paths(record: &Map<String, Value>) -> Vec<String> {
    let mut paths = Vec::new();
    append_paths_from_object(&mut paths, record);
    paths
}

pub fn extract_artifact_protocol_paths_from_value(value: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    collect_paths_from_value(&mut paths, value);
    paths
}

pub fn extract_artifact_protocol_paths_from_metadata(
    metadata: &HashMap<String, Value>,
) -> Vec<String> {
    let mut paths = Vec::new();
    append_paths_from_metadata(&mut paths, metadata);
    for value in metadata.values() {
        if matches!(value, Value::Array(_) | Value::Object(_)) {
            collect_paths_from_value(&mut paths, value);
        }
    }
    paths
}

fn append_unique_path(target: &mut Vec<String>, raw: &str) {
    push_unique_artifact_protocol_path(target, raw);
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

fn append_paths_from_object(target: &mut Vec<String>, object: &Map<String, Value>) {
    for key in ARTIFACT_PROTOCOL_PATH_KEYS {
        if let Some(value) = object.get(*key) {
            append_paths_from_field(target, value);
        }
    }
}

fn append_paths_from_metadata(target: &mut Vec<String>, metadata: &HashMap<String, Value>) {
    for key in ARTIFACT_PROTOCOL_PATH_KEYS {
        if let Some(value) = metadata.get(*key) {
            append_paths_from_field(target, value);
        }
    }
}

fn collect_paths_from_value(target: &mut Vec<String>, value: &Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_paths_from_value(target, item);
            }
        }
        Value::Object(object) => {
            append_paths_from_object(target, object);
            for nested in object.values() {
                if matches!(nested, Value::Array(_) | Value::Object(_)) {
                    collect_paths_from_value(target, nested);
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
    fn extract_artifact_protocol_paths_reads_canonical_keys() {
        let value = serde_json::json!({
            "artifact_paths": [" .lime/artifacts/thread-1/report.artifact.json "],
            "artifactPath": ".lime\\artifacts\\thread-1\\report.artifact.json",
            "filePath": ".lime/artifacts/thread-1/outline.md",
            "target_path": "workspace/result.md",
            "sourceFileName": "workspace/final.md"
        });

        let paths = extract_artifact_protocol_paths(
            value
                .as_object()
                .expect("artifact protocol record should be object"),
        );

        assert_eq!(
            paths,
            vec![
                ".lime/artifacts/thread-1/outline.md".to_string(),
                "workspace/result.md".to_string(),
                ".lime/artifacts/thread-1/report.artifact.json".to_string(),
                "workspace/final.md".to_string(),
            ]
        );
    }

    #[test]
    fn extract_artifact_protocol_paths_from_value_recurses_nested_records() {
        let paths = extract_artifact_protocol_paths_from_value(&serde_json::json!({
            "payload": {
                "absolute_path": " /tmp\\demo.md "
            },
            "result": [
                {
                    "artifact_paths": ["workspace/final.md"]
                }
            ]
        }));

        assert_eq!(
            paths,
            vec!["/tmp/demo.md".to_string(), "workspace/final.md".to_string()]
        );
    }

    #[test]
    fn extract_artifact_protocol_paths_from_metadata_recurses_nested_records() {
        let metadata = HashMap::from([
            (
                "artifactPath".to_string(),
                Value::String("workspace\\demo.cover.png".to_string()),
            ),
            (
                "payload".to_string(),
                serde_json::json!({
                    "artifact_paths": ["workspace/demo.md"]
                }),
            ),
        ]);

        assert_eq!(
            extract_artifact_protocol_paths_from_metadata(&metadata),
            vec![
                "workspace/demo.cover.png".to_string(),
                "workspace/demo.md".to_string(),
            ]
        );
    }

    #[test]
    fn extend_unique_artifact_protocol_paths_should_normalize_and_dedupe() {
        let mut target = vec!["workspace/demo.md".to_string()];
        extend_unique_artifact_protocol_paths(
            &mut target,
            &[
                " workspace\\demo.md ".to_string(),
                "workspace/result.md".to_string(),
            ],
        );
        push_unique_artifact_protocol_path(&mut target, " workspace\\cover.png ");

        assert_eq!(
            target,
            vec![
                "workspace/demo.md".to_string(),
                "workspace/result.md".to_string(),
                "workspace/cover.png".to_string(),
            ]
        );
    }
}
