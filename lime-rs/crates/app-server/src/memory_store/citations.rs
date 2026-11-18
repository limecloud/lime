use app_server_protocol::protocol::v2::{MemoryCitation, MemoryCitationEntry};
use serde_json::Value;
use std::collections::HashSet;

/// 将 memory 工具或模型返回的引用降成 Codex v2 的 canonical citation。
///
/// 已结构化的对象直接校验复用；字符串形式兼容 Codex 的 XML 块，解析失败则丢弃，
/// 不把未经验证的模型文本投影为引用。
pub(crate) fn parse_memory_citation(value: &Value) -> Option<MemoryCitation> {
    if let Ok(citation) = serde_json::from_value::<MemoryCitation>(value.clone()) {
        if !citation.entries.is_empty() || !citation.thread_ids.is_empty() {
            return Some(citation);
        }
    }

    let strings = match value {
        Value::String(value) => vec![value.as_str()],
        Value::Array(values) => values.iter().filter_map(Value::as_str).collect(),
        _ => return None,
    };
    let mut entries = Vec::new();
    let mut thread_ids = Vec::new();
    let mut seen_thread_ids = HashSet::new();
    for text in strings {
        if let Some(block) = extract_block(text, "<citation_entries>", "</citation_entries>") {
            entries.extend(block.lines().filter_map(parse_entry));
        }
        if let Some(block) = extract_block(text, "<rollout_ids>", "</rollout_ids>")
            .or_else(|| extract_block(text, "<thread_ids>", "</thread_ids>"))
        {
            for id in block.lines().map(str::trim).filter(|id| !id.is_empty()) {
                if seen_thread_ids.insert(id.to_string()) {
                    thread_ids.push(id.to_string());
                }
            }
        }
    }
    (!entries.is_empty() || !thread_ids.is_empty()).then_some(MemoryCitation {
        entries,
        thread_ids,
    })
}

fn parse_entry(line: &str) -> Option<MemoryCitationEntry> {
    let (location, note) = line.trim().rsplit_once("|note=[")?;
    let note = note.strip_suffix(']')?.trim().to_string();
    let (path, range) = location.rsplit_once(':')?;
    let (start, end) = range.split_once('-')?;
    Some(MemoryCitationEntry {
        path: path.trim().to_string(),
        line_start: start.trim().parse().ok()?,
        line_end: end.trim().parse().ok()?,
        note,
    })
}

fn extract_block<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let (_, rest) = text.split_once(open)?;
    let (body, _) = rest.split_once(close)?;
    Some(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_host_xml_memory_citation() {
        let parsed = parse_memory_citation(&json!(
            "<citation_entries>\nMEMORY.md:2-4|note=[preference]\n</citation_entries>\n<rollout_ids>\nthread-1\nthread-1\n</rollout_ids>"
        ))
        .expect("citation");
        assert_eq!(parsed.entries[0].line_start, 2);
        assert_eq!(parsed.thread_ids, vec!["thread-1"]);
    }

    #[test]
    fn accepts_structured_citation_without_reparsing() {
        let parsed = parse_memory_citation(&json!({
            "entries": [{"path":"MEMORY.md","lineStart":1,"lineEnd":1,"note":"x"}],
            "threadIds": ["thread-1"]
        }))
        .expect("citation");
        assert_eq!(parsed.entries[0].path, "MEMORY.md");
    }
}
