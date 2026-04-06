use super::{args_or_default, get_db, get_string_arg, parse_nested_arg, parse_optional_nested_arg};
use crate::commands::content_cmd::{
    parse_general_workbench_document_state, ContentDetail, ContentListItem,
    CreateContentRequest as BridgeCreateContentRequest, GeneralWorkbenchDocumentState,
    ListContentRequest as BridgeListContentRequest,
    UpdateContentRequest as BridgeUpdateContentRequest,
};
use crate::content::{
    ContentCreateRequest, ContentListQuery, ContentManager, ContentUpdateRequest,
};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

fn content_manager(state: &DevBridgeState) -> Result<ContentManager, DynError> {
    Ok(ContentManager::new(get_db(state)?.clone()))
}

fn build_create_request(request: BridgeCreateContentRequest) -> ContentCreateRequest {
    ContentCreateRequest {
        project_id: request.project_id,
        title: request.title,
        content_type: request.content_type.map(|value| {
            value
                .parse::<crate::content::ContentType>()
                .unwrap_or_default()
        }),
        order: request.order,
        body: request.body,
        metadata: request.metadata,
    }
}

fn build_list_query(query: Option<BridgeListContentRequest>) -> Option<ContentListQuery> {
    query.map(|query| ContentListQuery {
        status: query.status.map(|value| value.parse().unwrap_or_default()),
        content_type: query.content_type.map(|value| {
            value
                .parse::<crate::content::ContentType>()
                .unwrap_or_default()
        }),
        search: query.search,
        sort_by: query.sort_by,
        sort_order: query.sort_order,
        offset: query.offset,
        limit: query.limit,
    })
}

fn build_update_request(request: BridgeUpdateContentRequest) -> ContentUpdateRequest {
    ContentUpdateRequest {
        title: request.title,
        status: request
            .status
            .map(|value| value.parse().unwrap_or_default()),
        order: request.order,
        body: request.body,
        metadata: request.metadata,
        session_id: request.session_id,
    }
}

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "content_create" => {
            let args = args_or_default(args);
            let request: BridgeCreateContentRequest = parse_nested_arg(&args, "request")?;
            let manager = content_manager(state)?;
            serde_json::to_value(ContentDetail::from(
                manager.create(build_create_request(request))?,
            ))?
        }
        "content_get" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let manager = content_manager(state)?;
            serde_json::to_value(manager.get(&id)?.map(ContentDetail::from))?
        }
        "content_get_general_workbench_document_state" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let manager = content_manager(state)?;
            let content = manager.get(&id)?;
            let document_state: Option<GeneralWorkbenchDocumentState> = content.and_then(|item| {
                parse_general_workbench_document_state(&item.id, item.metadata.as_ref())
            });
            serde_json::to_value(document_state)?
        }
        "content_list" => {
            let args = args_or_default(args);
            let project_id = get_string_arg(&args, "projectId", "project_id")?;
            let query: Option<BridgeListContentRequest> =
                parse_optional_nested_arg(&args, "query")?;
            let manager = content_manager(state)?;
            let items: Vec<_> = manager
                .list_by_project(&project_id, build_list_query(query))?
                .into_iter()
                .map(ContentListItem::from)
                .collect();
            serde_json::to_value(items)?
        }
        "content_update" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let request: BridgeUpdateContentRequest = parse_nested_arg(&args, "request")?;
            let manager = content_manager(state)?;
            serde_json::to_value(ContentDetail::from(
                manager.update(&id, build_update_request(request))?,
            ))?
        }
        "content_delete" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let manager = content_manager(state)?;
            serde_json::to_value(manager.delete(&id)?)?
        }
        "content_reorder" => {
            let args = args_or_default(args);
            let project_id = get_string_arg(&args, "projectId", "project_id")?;
            let content_ids = args
                .get("contentIds")
                .or_else(|| args.get("content_ids"))
                .cloned()
                .ok_or("缺少参数: contentIds/content_ids")?;
            let content_ids: Vec<String> = serde_json::from_value(content_ids)?;
            let manager = content_manager(state)?;
            manager.reorder(&project_id, content_ids)?;
            serde_json::json!(null)
        }
        "content_stats" => {
            let args = args_or_default(args);
            let project_id = get_string_arg(&args, "projectId", "project_id")?;
            let manager = content_manager(state)?;
            serde_json::to_value(manager.get_project_stats(&project_id)?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
