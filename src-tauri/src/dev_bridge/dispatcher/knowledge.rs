use super::{args_or_default, parse_nested_arg};
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let args = args_or_default(args);
    let result = match cmd {
        "knowledge_import_source" => {
            let request: lime_knowledge::KnowledgeImportSourceRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::import_knowledge_source(request)?)?
        }
        "knowledge_compile_pack" => {
            let request: lime_knowledge::KnowledgeCompilePackRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::compile_knowledge_pack(request)?)?
        }
        "knowledge_list_packs" => {
            let request: lime_knowledge::KnowledgeListPacksRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::list_knowledge_packs(request)?)?
        }
        "knowledge_get_pack" => {
            let request: lime_knowledge::KnowledgeGetPackRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::get_knowledge_pack(request)?)?
        }
        "knowledge_set_default_pack" => {
            let request: lime_knowledge::KnowledgeSetDefaultPackRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::set_default_knowledge_pack(request)?)?
        }
        "knowledge_update_pack_status" => {
            let request: lime_knowledge::KnowledgeUpdatePackStatusRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::update_knowledge_pack_status(request)?)?
        }
        "knowledge_resolve_context" => {
            let request: lime_knowledge::KnowledgeResolveContextRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(lime_knowledge::resolve_knowledge_context(request)?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
