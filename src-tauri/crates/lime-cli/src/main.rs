mod catalog;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use lime_media_runtime::{
    list_task_outputs, load_task_output, retry_task_artifact, update_task_status,
    write_task_artifact, MediaRuntimeError, MediaTaskErrorOutput, TaskType, TaskWriteOptions,
    DEFAULT_ARTIFACT_ROOT,
};
use serde_json::{json, Value};

use crate::catalog::{
    find_skill_entry, find_task_entry, ROOT_AFTER_HELP, SKILL_AFTER_HELP, SKILL_ENTRIES,
    TASK_AFTER_HELP, TASK_ENTRIES,
};

const ROOT_LONG_ABOUT: &str = "\
Lime 官方任务 CLI。

默认输出结构化 JSON，优先服务 Agent 与技能调用。
当前主线覆盖内容生成、链接解析、排版优化与素材检索等任务型业务。";

#[derive(Debug, Parser)]
#[command(
    name = "lime",
    version,
    about = "Lime 官方任务 CLI",
    long_about = ROOT_LONG_ABOUT,
    after_help = ROOT_AFTER_HELP,
    arg_required_else_help = true
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Task(TaskCommand),
    Skill(SkillCommand),
    Doctor(DoctorArgs),
    #[command(hide = true)]
    Media(MediaCommand),
}

#[derive(Debug, Args)]
#[command(after_help = TASK_AFTER_HELP, arg_required_else_help = true)]
struct TaskCommand {
    #[command(subcommand)]
    command: TaskSubcommand,
}

#[derive(Debug, Subcommand)]
enum TaskSubcommand {
    Create(TaskCreateCommand),
    Status(TaskLookupArgs),
    List(TaskListArgs),
    Attempts(TaskLookupArgs),
    Retry(TaskLookupArgs),
    Cancel(TaskLookupArgs),
    Result(TaskLookupArgs),
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
struct TaskCreateCommand {
    #[command(subcommand)]
    command: TaskCreateSubcommand,
}

#[derive(Debug, Subcommand)]
enum TaskCreateSubcommand {
    Image(ImageGenerateArgs),
    Cover(CoverGenerateArgs),
    Video(VideoGenerateArgs),
    Broadcast(BroadcastGenerateArgs),
    #[command(name = "url-parse")]
    UrlParse(UrlParseArgs),
    Typesetting(TypesettingArgs),
    #[command(name = "resource-search")]
    ResourceSearch(ResourceSearchArgs),
}

#[derive(Debug, Args)]
#[command(after_help = SKILL_AFTER_HELP, arg_required_else_help = true)]
struct SkillCommand {
    #[command(subcommand)]
    command: SkillSubcommand,
}

#[derive(Debug, Subcommand)]
enum SkillSubcommand {
    List,
    Show(SkillShowArgs),
}

#[derive(Debug, Args)]
struct SkillShowArgs {
    name: String,
}

#[derive(Debug, Args)]
struct DoctorArgs {
    #[arg(long)]
    workspace: Option<PathBuf>,
    #[arg(long = "artifact-dir")]
    artifact_dir: Option<String>,
    #[arg(long)]
    json: bool,
}

#[derive(Debug, Args, Clone)]
struct SharedTaskWriteArgs {
    #[arg(long)]
    workspace: Option<PathBuf>,
    #[arg(long)]
    output: Option<String>,
    #[arg(long = "artifact-dir")]
    artifact_dir: Option<String>,
    #[arg(long = "idempotency-key")]
    idempotency_key: Option<String>,
    #[arg(long)]
    json: bool,
}

#[derive(Debug, Args, Clone)]
struct SharedTaskReadArgs {
    #[arg(long)]
    workspace: Option<PathBuf>,
    #[arg(long = "artifact-dir")]
    artifact_dir: Option<String>,
    #[arg(long)]
    json: bool,
}

#[derive(Debug, Args)]
struct TaskLookupArgs {
    task_ref: String,
    #[command(flatten)]
    shared: SharedTaskReadArgs,
}

#[derive(Debug, Args)]
struct TaskListArgs {
    #[command(flatten)]
    shared: SharedTaskReadArgs,
    #[arg(long)]
    status: Option<String>,
    #[arg(long = "family")]
    task_family: Option<String>,
    #[arg(long = "type")]
    task_type: Option<String>,
    #[arg(long)]
    limit: Option<usize>,
}

#[derive(Debug, Args, Clone)]
struct ImageGenerateArgs {
    #[arg(long)]
    prompt: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    model: Option<String>,
    #[arg(long)]
    style: Option<String>,
    #[arg(long)]
    size: Option<String>,
    #[arg(long)]
    count: Option<u32>,
    #[arg(long)]
    usage: Option<String>,
    #[command(flatten)]
    output: SharedTaskWriteArgs,
}

#[derive(Debug, Args, Clone)]
struct CoverGenerateArgs {
    #[arg(long)]
    prompt: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    model: Option<String>,
    #[arg(long)]
    style: Option<String>,
    #[arg(long)]
    platform: Option<String>,
    #[arg(long)]
    size: Option<String>,
    #[arg(long = "image-url")]
    image_url: Option<String>,
    #[arg(long = "reference-image-url")]
    reference_image_url: Option<String>,
    #[arg(long)]
    usage: Option<String>,
    #[command(flatten)]
    output: SharedTaskWriteArgs,
}

#[derive(Debug, Args, Clone)]
struct VideoGenerateArgs {
    #[arg(long)]
    prompt: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long = "project-id")]
    project_id: Option<String>,
    #[arg(long = "provider-id")]
    provider_id: Option<String>,
    #[arg(long)]
    model: Option<String>,
    #[arg(long = "aspect-ratio")]
    aspect_ratio: Option<String>,
    #[arg(long)]
    resolution: Option<String>,
    #[arg(long)]
    duration: Option<i64>,
    #[arg(long = "image-url")]
    image_url: Option<String>,
    #[arg(long = "end-image-url")]
    end_image_url: Option<String>,
    #[arg(long)]
    seed: Option<i64>,
    #[arg(long = "generate-audio")]
    generate_audio: Option<bool>,
    #[arg(long = "camera-fixed")]
    camera_fixed: Option<bool>,
    #[command(flatten)]
    output: SharedTaskWriteArgs,
}

#[derive(Debug, Args, Clone)]
struct BroadcastGenerateArgs {
    #[arg(long)]
    content: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    audience: Option<String>,
    #[arg(long)]
    tone: Option<String>,
    #[arg(long = "duration-hint-minutes")]
    duration_hint_minutes: Option<u32>,
    #[command(flatten)]
    output: SharedTaskWriteArgs,
}

#[derive(Debug, Args, Clone)]
struct UrlParseArgs {
    #[arg(long)]
    url: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    summary: String,
    #[arg(long = "key-point")]
    key_points: Vec<String>,
    #[arg(long = "extract-status", default_value = "ready")]
    extract_status: String,
    #[command(flatten)]
    output: SharedTaskWriteArgs,
}

#[derive(Debug, Args, Clone)]
struct TypesettingArgs {
    #[arg(long)]
    content: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long = "target-platform")]
    target_platform: String,
    #[arg(long = "rule")]
    rules: Vec<String>,
    #[command(flatten)]
    output: SharedTaskWriteArgs,
}

#[derive(Debug, Args, Clone)]
struct ResourceSearchArgs {
    #[arg(long = "resource-type")]
    resource_type: String,
    #[arg(long)]
    query: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    usage: String,
    #[arg(long, default_value_t = 6)]
    count: u32,
    #[arg(long = "constraint")]
    constraints: Vec<String>,
    #[command(flatten)]
    output: SharedTaskWriteArgs,
}

#[derive(Debug, Args)]
struct MediaCommand {
    #[command(subcommand)]
    command: MediaSubcommand,
}

#[derive(Debug, Subcommand)]
enum MediaSubcommand {
    Image(ImageCommand),
    Cover(CoverCommand),
    Video(VideoCommand),
}

#[derive(Debug, Args)]
struct ImageCommand {
    #[command(subcommand)]
    command: ImageSubcommand,
}

#[derive(Debug, Args)]
struct CoverCommand {
    #[command(subcommand)]
    command: CoverSubcommand,
}

#[derive(Debug, Args)]
struct VideoCommand {
    #[command(subcommand)]
    command: VideoSubcommand,
}

#[derive(Debug, Subcommand)]
enum ImageSubcommand {
    Generate(ImageGenerateArgs),
}

#[derive(Debug, Subcommand)]
enum CoverSubcommand {
    Generate(CoverGenerateArgs),
}

#[derive(Debug, Subcommand)]
enum VideoSubcommand {
    Generate(VideoGenerateArgs),
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(output) => {
            print_json(&output, false);
            ExitCode::SUCCESS
        }
        Err(error) => {
            let payload = MediaTaskErrorOutput::from_error(&error);
            let serialized =
                serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string());
            eprintln!("{serialized}");
            ExitCode::from(error.exit_code().clamp(1, 255) as u8)
        }
    }
}

fn print_json(value: &Value, stderr: bool) {
    let serialized = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string());
    if stderr {
        eprintln!("{serialized}");
    } else {
        println!("{serialized}");
    }
}

fn run(cli: Cli) -> Result<Value, MediaRuntimeError> {
    match cli.command {
        Command::Task(task) => run_task_command(task),
        Command::Skill(skill) => run_skill_command(skill),
        Command::Doctor(doctor) => run_doctor_command(doctor),
        Command::Media(media) => run_media_command(media),
    }
}

fn run_task_command(command: TaskCommand) -> Result<Value, MediaRuntimeError> {
    match command.command {
        TaskSubcommand::Create(create) => run_task_create_command(create),
        TaskSubcommand::Status(args) => {
            let workspace_root = resolve_workspace_root(args.shared.workspace)?;
            let output = load_task_output(
                &workspace_root,
                &args.task_ref,
                args.shared.artifact_dir.as_deref(),
            )?;
            Ok(json!(output))
        }
        TaskSubcommand::Attempts(args) => {
            let workspace_root = resolve_workspace_root(args.shared.workspace)?;
            let output = load_task_output(
                &workspace_root,
                &args.task_ref,
                args.shared.artifact_dir.as_deref(),
            )?;
            Ok(json!({
                "success": true,
                "task_id": output.task_id,
                "task_type": output.task_type,
                "task_family": output.task_family,
                "status": output.status,
                "normalized_status": output.normalized_status,
                "current_attempt_id": output.current_attempt_id,
                "attempt_count": output.attempt_count,
                "attempts": output.record.attempts,
                "path": output.path,
                "absolute_path": output.absolute_path,
            }))
        }
        TaskSubcommand::List(args) => {
            let workspace_root = resolve_workspace_root(args.shared.workspace)?;
            let task_type_filter = match args.task_type.as_deref() {
                Some(raw) => Some(raw.parse::<TaskType>().map_err(|_| {
                    MediaRuntimeError::InvalidParams(format!("未知任务类型: {raw}"))
                })?),
                None => None,
            };
            let task_family_filter = args
                .task_family
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let tasks = list_task_outputs(
                &workspace_root,
                args.shared.artifact_dir.as_deref(),
                args.status.as_deref(),
                task_family_filter,
                task_type_filter,
                args.limit,
            )?;
            Ok(json!({
                "success": true,
                "workspace_root": workspace_root.to_string_lossy().to_string(),
                "artifact_root": resolve_artifact_root(&workspace_root, args.shared.artifact_dir.as_deref()).to_string_lossy().to_string(),
                "filters": {
                    "status": args.status,
                    "task_family": task_family_filter,
                    "task_type": task_type_filter.map(|value| value.as_str().to_string()),
                    "limit": args.limit,
                },
                "total": tasks.len(),
                "tasks": tasks,
            }))
        }
        TaskSubcommand::Retry(args) => {
            let workspace_root = resolve_workspace_root(args.shared.workspace)?;
            let output = retry_task_artifact(
                &workspace_root,
                &args.task_ref,
                args.shared.artifact_dir.as_deref(),
            )?;
            Ok(json!(output))
        }
        TaskSubcommand::Cancel(args) => {
            let workspace_root = resolve_workspace_root(args.shared.workspace)?;
            let output = update_task_status(
                &workspace_root,
                &args.task_ref,
                args.shared.artifact_dir.as_deref(),
                "cancelled",
            )?;
            Ok(json!(output))
        }
        TaskSubcommand::Result(args) => {
            let workspace_root = resolve_workspace_root(args.shared.workspace)?;
            let output = load_task_output(
                &workspace_root,
                &args.task_ref,
                args.shared.artifact_dir.as_deref(),
            )?;
            let has_result = output.record.result.is_some();
            let result = output.record.result.clone();
            let record = output.record.clone();
            Ok(json!({
                "success": true,
                "task_id": output.task_id,
                "task_type": output.task_type,
                "task_family": output.task_family,
                "status": output.status,
                "normalized_status": output.normalized_status,
                "current_attempt_id": output.current_attempt_id,
                "attempt_count": output.attempt_count,
                "last_error": output.last_error,
                "progress": output.progress,
                "ui_hints": output.ui_hints,
                "path": output.path,
                "absolute_path": output.absolute_path,
                "artifact_path": output.artifact_path,
                "absolute_artifact_path": output.absolute_artifact_path,
                "has_result": has_result,
                "result": result,
                "record": record,
            }))
        }
    }
}

fn run_task_create_command(command: TaskCreateCommand) -> Result<Value, MediaRuntimeError> {
    match command.command {
        TaskCreateSubcommand::Image(args) => create_image_task(args),
        TaskCreateSubcommand::Cover(args) => create_cover_task(args),
        TaskCreateSubcommand::Video(args) => create_video_task(args),
        TaskCreateSubcommand::Broadcast(args) => create_broadcast_task(args),
        TaskCreateSubcommand::UrlParse(args) => create_url_parse_task(args),
        TaskCreateSubcommand::Typesetting(args) => create_typesetting_task(args),
        TaskCreateSubcommand::ResourceSearch(args) => create_resource_search_task(args),
    }
}

fn run_media_command(command: MediaCommand) -> Result<Value, MediaRuntimeError> {
    match command.command {
        MediaSubcommand::Image(image) => match image.command {
            ImageSubcommand::Generate(args) => create_image_task(args),
        },
        MediaSubcommand::Cover(cover) => match cover.command {
            CoverSubcommand::Generate(args) => create_cover_task(args),
        },
        MediaSubcommand::Video(video) => match video.command {
            VideoSubcommand::Generate(args) => create_video_task(args),
        },
    }
}

fn run_skill_command(command: SkillCommand) -> Result<Value, MediaRuntimeError> {
    match command.command {
        SkillSubcommand::List => Ok(json!({
            "success": true,
            "total": SKILL_ENTRIES.len(),
            "skills": SKILL_ENTRIES.iter().map(|entry| {
                json!({
                    "name": entry.name,
                    "description": entry.description,
                    "recommended_command": entry.recommended_command,
                    "skill_path": entry.skill_path,
                    "references": entry.references,
                })
            }).collect::<Vec<_>>(),
        })),
        SkillSubcommand::Show(args) => {
            let entry = find_skill_entry(&args.name)
                .or_else(|| {
                    find_task_entry(&args.name).and_then(|task| find_skill_entry(task.skill_name))
                })
                .ok_or_else(|| {
                    MediaRuntimeError::InvalidParams(format!("未知 skill: {}", args.name))
                })?;
            Ok(json!({
                "success": true,
                "skill": {
                    "name": entry.name,
                    "description": entry.description,
                    "recommended_command": entry.recommended_command,
                    "skill_path": entry.skill_path,
                    "references": entry.references,
                }
            }))
        }
    }
}

fn run_doctor_command(args: DoctorArgs) -> Result<Value, MediaRuntimeError> {
    let _ = args.json;
    let workspace_root = resolve_workspace_root(args.workspace)?;
    let artifact_root = resolve_artifact_root(&workspace_root, args.artifact_dir.as_deref());
    let docs_root = workspace_root.join("tools/lime-cli");
    let current_dir = std::env::current_dir()
        .map_err(|error| MediaRuntimeError::Io(format!("读取当前工作目录失败: {error}")))?;
    let current_exe = std::env::current_exe()
        .map_err(|error| MediaRuntimeError::Io(format!("读取当前可执行路径失败: {error}")))?;
    let task_count = list_task_outputs(
        &workspace_root,
        args.artifact_dir.as_deref(),
        None,
        None,
        None,
        None,
    )?
    .len();

    Ok(json!({
        "success": true,
        "cli_version": env!("CARGO_PKG_VERSION"),
        "current_dir": current_dir.to_string_lossy().to_string(),
        "current_exe": current_exe.to_string_lossy().to_string(),
        "workspace_root": workspace_root.to_string_lossy().to_string(),
        "artifact_root": artifact_root.to_string_lossy().to_string(),
        "artifact_root_exists": artifact_root.exists(),
        "docs_root": docs_root.to_string_lossy().to_string(),
        "docs_root_exists": docs_root.exists(),
        "known_task_count": task_count,
        "supported_tasks": TASK_ENTRIES.iter().map(|entry| {
            json!({
                "command_name": entry.command_name,
                "task_type": entry.task_type.as_str(),
                "task_family": entry.task_type.family(),
                "description": entry.description,
                "skill_name": entry.skill_name,
                "docs_dir": entry.docs_dir,
                "example": entry.example,
            })
        }).collect::<Vec<_>>(),
        "supported_skills": SKILL_ENTRIES.iter().map(|entry| entry.name).collect::<Vec<_>>(),
    }))
}

fn create_image_task(args: ImageGenerateArgs) -> Result<Value, MediaRuntimeError> {
    let workspace_root = resolve_workspace_root(args.output.workspace.clone())?;
    let output = write_task_artifact(
        &workspace_root,
        TaskType::ImageGenerate,
        args.title,
        json!({
            "prompt": args.prompt,
            "model": args.model,
            "style": args.style,
            "size": args.size,
            "count": args.count,
            "usage": args.usage,
        }),
        task_write_options(&args.output),
    )?;
    Ok(json!(output))
}

fn create_cover_task(args: CoverGenerateArgs) -> Result<Value, MediaRuntimeError> {
    let workspace_root = resolve_workspace_root(args.output.workspace.clone())?;
    let output = write_task_artifact(
        &workspace_root,
        TaskType::CoverGenerate,
        args.title,
        json!({
            "prompt": args.prompt,
            "model": args.model,
            "style": args.style,
            "platform": args.platform,
            "size": args.size,
            "imageUrl": args.image_url,
            "referenceImageUrl": args.reference_image_url,
            "usage": args.usage.or(Some("cover".to_string())),
        }),
        task_write_options(&args.output),
    )?;
    Ok(json!(output))
}

fn create_video_task(args: VideoGenerateArgs) -> Result<Value, MediaRuntimeError> {
    let workspace_root = resolve_workspace_root(args.output.workspace.clone())?;
    let output = write_task_artifact(
        &workspace_root,
        TaskType::VideoGenerate,
        args.title,
        json!({
            "prompt": args.prompt,
            "projectId": args.project_id,
            "providerId": args.provider_id,
            "model": args.model,
            "aspectRatio": args.aspect_ratio,
            "resolution": args.resolution,
            "duration": args.duration,
            "imageUrl": args.image_url,
            "endImageUrl": args.end_image_url,
            "seed": args.seed,
            "generateAudio": args.generate_audio,
            "cameraFixed": args.camera_fixed,
        }),
        task_write_options(&args.output),
    )?;
    Ok(json!(output))
}

fn create_broadcast_task(args: BroadcastGenerateArgs) -> Result<Value, MediaRuntimeError> {
    let workspace_root = resolve_workspace_root(args.output.workspace.clone())?;
    if args.content.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "content 不能为空字符串".to_string(),
        ));
    }
    let output = write_task_artifact(
        &workspace_root,
        TaskType::BroadcastGenerate,
        args.title,
        json!({
            "content": args.content,
            "audience": args.audience,
            "tone": args.tone,
            "durationHintMinutes": args.duration_hint_minutes,
        }),
        task_write_options(&args.output),
    )?;
    Ok(json!(output))
}

fn create_url_parse_task(args: UrlParseArgs) -> Result<Value, MediaRuntimeError> {
    let workspace_root = resolve_workspace_root(args.output.workspace.clone())?;
    if args.url.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "url 不能为空字符串".to_string(),
        ));
    }
    if args.summary.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "summary 不能为空字符串".to_string(),
        ));
    }
    let output = write_task_artifact(
        &workspace_root,
        TaskType::UrlParse,
        args.title,
        json!({
            "url": args.url,
            "summary": args.summary,
            "keyPoints": args.key_points,
            "extractStatus": args.extract_status,
        }),
        task_write_options(&args.output),
    )?;
    Ok(json!(output))
}

fn create_typesetting_task(args: TypesettingArgs) -> Result<Value, MediaRuntimeError> {
    let workspace_root = resolve_workspace_root(args.output.workspace.clone())?;
    if args.content.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "content 不能为空字符串".to_string(),
        ));
    }
    if args.target_platform.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "targetPlatform 不能为空字符串".to_string(),
        ));
    }
    let output = write_task_artifact(
        &workspace_root,
        TaskType::Typesetting,
        args.title,
        json!({
            "targetPlatform": args.target_platform,
            "rules": args.rules,
            "content": args.content,
        }),
        task_write_options(&args.output),
    )?;
    Ok(json!(output))
}

fn create_resource_search_task(args: ResourceSearchArgs) -> Result<Value, MediaRuntimeError> {
    let workspace_root = resolve_workspace_root(args.output.workspace.clone())?;
    if args.resource_type.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "resourceType 不能为空字符串".to_string(),
        ));
    }
    if args.query.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "query 不能为空字符串".to_string(),
        ));
    }
    if args.usage.trim().is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "usage 不能为空字符串".to_string(),
        ));
    }
    let output = write_task_artifact(
        &workspace_root,
        TaskType::ModalResourceSearch,
        args.title,
        json!({
            "resourceType": args.resource_type,
            "query": args.query,
            "usage": args.usage,
            "count": args.count,
            "constraints": args.constraints,
        }),
        task_write_options(&args.output),
    )?;
    Ok(json!(output))
}

fn task_write_options(args: &SharedTaskWriteArgs) -> TaskWriteOptions<'_> {
    let _ = args.json;
    TaskWriteOptions {
        status: None,
        output_path: args.output.as_deref(),
        artifact_dir: args.artifact_dir.as_deref(),
        idempotency_key: args.idempotency_key.as_deref(),
    }
}

fn resolve_workspace_root(
    explicit_workspace: Option<PathBuf>,
) -> Result<PathBuf, MediaRuntimeError> {
    if let Some(workspace) = explicit_workspace {
        return Ok(workspace);
    }

    std::env::current_dir()
        .map_err(|error| MediaRuntimeError::Io(format!("读取当前工作目录失败: {error}")))
}

fn resolve_artifact_root(workspace_root: &Path, artifact_dir: Option<&str>) -> PathBuf {
    match artifact_dir {
        Some(raw) if !raw.trim().is_empty() => workspace_root.join(raw),
        _ => workspace_root.join(DEFAULT_ARTIFACT_ROOT),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_workspace_root_defaults_to_current_dir() {
        let root = resolve_workspace_root(None).expect("resolve current dir");
        assert!(root.is_dir());
    }

    #[test]
    fn run_broadcast_create_supports_idempotency_key() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");

        let first = run(Cli {
            command: Command::Task(TaskCommand {
                command: TaskSubcommand::Create(TaskCreateCommand {
                    command: TaskCreateSubcommand::Broadcast(BroadcastGenerateArgs {
                        content: "原文".to_string(),
                        title: Some("播客".to_string()),
                        audience: Some("开发者".to_string()),
                        tone: Some("理性".to_string()),
                        duration_hint_minutes: Some(8),
                        output: SharedTaskWriteArgs {
                            workspace: Some(temp_dir.path().to_path_buf()),
                            output: None,
                            artifact_dir: None,
                            idempotency_key: Some("broadcast-1".to_string()),
                            json: true,
                        },
                    }),
                }),
            }),
        })
        .expect("run first");

        let second = run(Cli {
            command: Command::Task(TaskCommand {
                command: TaskSubcommand::Create(TaskCreateCommand {
                    command: TaskCreateSubcommand::Broadcast(BroadcastGenerateArgs {
                        content: "原文".to_string(),
                        title: Some("播客".to_string()),
                        audience: Some("开发者".to_string()),
                        tone: Some("理性".to_string()),
                        duration_hint_minutes: Some(8),
                        output: SharedTaskWriteArgs {
                            workspace: Some(temp_dir.path().to_path_buf()),
                            output: None,
                            artifact_dir: None,
                            idempotency_key: Some("broadcast-1".to_string()),
                            json: true,
                        },
                    }),
                }),
            }),
        })
        .expect("run second");

        assert_eq!(first["task_id"], second["task_id"]);
        assert_eq!(second["reused_existing"], json!(true));
    }

    #[test]
    fn skill_show_accepts_task_command_name() {
        let output = run(Cli {
            command: Command::Skill(SkillCommand {
                command: SkillSubcommand::Show(SkillShowArgs {
                    name: "broadcast".to_string(),
                }),
            }),
        })
        .expect("show skill");

        assert_eq!(output["skill"]["name"], "broadcast_generate");
    }

    #[test]
    fn task_list_returns_created_items() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let _ = create_image_task(ImageGenerateArgs {
            prompt: "城市".to_string(),
            title: None,
            model: None,
            style: None,
            size: None,
            count: None,
            usage: None,
            output: SharedTaskWriteArgs {
                workspace: Some(temp_dir.path().to_path_buf()),
                output: None,
                artifact_dir: None,
                idempotency_key: None,
                json: true,
            },
        })
        .expect("create image");

        let output = run(Cli {
            command: Command::Task(TaskCommand {
                command: TaskSubcommand::List(TaskListArgs {
                    shared: SharedTaskReadArgs {
                        workspace: Some(temp_dir.path().to_path_buf()),
                        artifact_dir: None,
                        json: true,
                    },
                    status: None,
                    task_family: None,
                    task_type: Some("image".to_string()),
                    limit: Some(10),
                }),
            }),
        })
        .expect("list tasks");

        assert_eq!(output["total"], 1);
        assert_eq!(output["tasks"][0]["task_type"], "image_generate");
    }

    #[test]
    fn task_list_supports_family_filter() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let _ = create_image_task(ImageGenerateArgs {
            prompt: "城市".to_string(),
            title: None,
            model: None,
            style: None,
            size: None,
            count: None,
            usage: None,
            output: SharedTaskWriteArgs {
                workspace: Some(temp_dir.path().to_path_buf()),
                output: None,
                artifact_dir: None,
                idempotency_key: None,
                json: true,
            },
        })
        .expect("create image");
        let _ = create_url_parse_task(UrlParseArgs {
            url: "https://example.com".to_string(),
            title: None,
            summary: "摘要".to_string(),
            key_points: Vec::new(),
            extract_status: "ready".to_string(),
            output: SharedTaskWriteArgs {
                workspace: Some(temp_dir.path().to_path_buf()),
                output: None,
                artifact_dir: None,
                idempotency_key: None,
                json: true,
            },
        })
        .expect("create url parse");

        let output = run(Cli {
            command: Command::Task(TaskCommand {
                command: TaskSubcommand::List(TaskListArgs {
                    shared: SharedTaskReadArgs {
                        workspace: Some(temp_dir.path().to_path_buf()),
                        artifact_dir: None,
                        json: true,
                    },
                    status: None,
                    task_family: Some("image".to_string()),
                    task_type: None,
                    limit: Some(10),
                }),
            }),
        })
        .expect("list image family");

        assert_eq!(output["total"], 1);
        assert_eq!(output["tasks"][0]["task_family"], "image");
    }

    #[test]
    fn task_attempts_returns_attempt_history() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let failed = write_task_artifact(
            temp_dir.path(),
            TaskType::ModalResourceSearch,
            Some("素材检索".to_string()),
            json!({ "query": "城市夜景" }),
            TaskWriteOptions {
                status: Some("failed".to_string()),
                ..TaskWriteOptions::default()
            },
        )
        .expect("write failed task");
        let _ = retry_task_artifact(temp_dir.path(), &failed.task_id, None).expect("retry task");

        let output = run(Cli {
            command: Command::Task(TaskCommand {
                command: TaskSubcommand::Attempts(TaskLookupArgs {
                    task_ref: failed.task_id.clone(),
                    shared: SharedTaskReadArgs {
                        workspace: Some(temp_dir.path().to_path_buf()),
                        artifact_dir: None,
                        json: true,
                    },
                }),
            }),
        })
        .expect("get attempts");

        assert_eq!(output["attempt_count"], 2);
        assert_eq!(output["attempts"].as_array().map(Vec::len), Some(2));
        assert_eq!(output["task_family"], "resource");
    }
}
