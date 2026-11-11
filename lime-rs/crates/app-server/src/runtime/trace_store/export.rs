use super::{protocol_redaction_policy, RawTraceEventRecord};
use app_server_protocol::{DiagnosticsTraceRedactionPolicy, DiagnosticsTraceSummary};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

pub(super) fn default_trace_export_output_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("LIME_TRACE_EXPORT_OUTPUT_DIR")
        .map(PathBuf::from)
        .filter(|path| path.as_os_str().is_empty() == false)
    {
        return path;
    }
    dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(std::env::temp_dir)
}

pub(super) fn trace_export_included_sections() -> Vec<String> {
    vec![
        "meta/manifest.json".to_string(),
        "meta/trace-summary.json".to_string(),
        "trace/events.jsonl".to_string(),
        "README.txt".to_string(),
    ]
}

pub(super) fn trace_export_omitted_sections() -> Vec<String> {
    vec![
        "raw AgentEvent payload".to_string(),
        "prompt text".to_string(),
        "provider request/response payload".to_string(),
        "assistant delta text".to_string(),
        "unparsed raw JSONL bytes".to_string(),
    ]
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceExportManifest<'a> {
    generated_at: &'a str,
    trace: &'a DiagnosticsTraceSummary,
    redaction: DiagnosticsTraceRedactionPolicy,
    summary_only_trace_events_included: bool,
    included_sections: Vec<String>,
    omitted_sections: Vec<String>,
}

pub(super) fn write_trace_export_zip(
    bundle_path: &Path,
    generated_at: &str,
    trace: &DiagnosticsTraceSummary,
    records: &[RawTraceEventRecord],
) -> Result<(), String> {
    let file = fs::File::create(bundle_path).map_err(|error| {
        format!(
            "无法创建 trace export zip {}: {error}",
            bundle_path.display()
        )
    })?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    write_zip_json(
        &mut writer,
        "meta/manifest.json",
        &TraceExportManifest {
            generated_at,
            trace,
            redaction: protocol_redaction_policy(),
            summary_only_trace_events_included: true,
            included_sections: trace_export_included_sections(),
            omitted_sections: trace_export_omitted_sections(),
        },
        options,
    )?;
    write_zip_json(&mut writer, "meta/trace-summary.json", trace, options)?;
    writer
        .start_file("trace/events.jsonl", options)
        .map_err(|error| format!("写入 trace export 文件失败 trace/events.jsonl: {error}"))?;
    for record in records {
        let json = serde_json::to_vec(&record.event).map_err(|error| {
            format!(
                "无法序列化 trace export event {}:{}: {error}",
                record.event.trace_id, record.event.event_id
            )
        })?;
        writer
            .write_all(&json)
            .and_then(|_| writer.write_all(b"\n"))
            .map_err(|error| format!("写入 trace export events.jsonl 失败: {error}"))?;
    }
    writer
        .start_file("README.txt", options)
        .map_err(|error| format!("写入 trace export README 失败: {error}"))?;
    writer
        .write_all(
            b"Claw trace export\n\nThis archive contains summary-only trace events. Raw AgentEvent payloads, prompt text, provider payloads, and assistant delta text are not included.\n",
        )
        .map_err(|error| format!("写入 trace export README 失败: {error}"))?;
    writer
        .finish()
        .map_err(|error| format!("完成 trace export zip 失败: {error}"))?;
    Ok(())
}

fn write_zip_json<T: Serialize>(
    writer: &mut ZipWriter<fs::File>,
    path: &str,
    value: &T,
    options: SimpleFileOptions,
) -> Result<(), String> {
    writer
        .start_file(path, options)
        .map_err(|error| format!("写入 trace export 文件失败 {path}: {error}"))?;
    let content = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("序列化 trace export JSON 失败 {path}: {error}"))?;
    writer
        .write_all(&content)
        .map_err(|error| format!("写入 trace export JSON 失败 {path}: {error}"))
}
