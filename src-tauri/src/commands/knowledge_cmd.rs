//! Agent Knowledge 知识包命令
//!
//! 当前命令面只承接 Phase 1 文件优先知识包主链。
//! 不在这里接入 Memory，也不把知识包当 Skill 本体。

use lime_knowledge::{
    compile_knowledge_pack, get_knowledge_pack, import_knowledge_source, list_knowledge_packs,
    resolve_knowledge_context, set_default_knowledge_pack, update_knowledge_pack_status,
    validate_knowledge_context_run, KnowledgeCompilePackRequest, KnowledgeCompilePackResponse,
    KnowledgeContextResolution, KnowledgeGetPackRequest, KnowledgeImportSourceRequest,
    KnowledgeImportSourceResponse, KnowledgeListPacksRequest, KnowledgeListPacksResponse,
    KnowledgePackDetail, KnowledgeResolveContextRequest, KnowledgeSetDefaultPackRequest,
    KnowledgeSetDefaultPackResponse, KnowledgeUpdatePackStatusRequest,
    KnowledgeUpdatePackStatusResponse, KnowledgeValidateContextRunRequest,
    KnowledgeValidateContextRunResponse,
};

/// 导入知识包来源资料
#[tauri::command]
pub async fn knowledge_import_source(
    request: KnowledgeImportSourceRequest,
) -> Result<KnowledgeImportSourceResponse, String> {
    import_knowledge_source(request)
}

/// 编译知识包的 Markdown-first 运行时视图
#[tauri::command]
pub async fn knowledge_compile_pack(
    request: KnowledgeCompilePackRequest,
) -> Result<KnowledgeCompilePackResponse, String> {
    compile_knowledge_pack(request)
}

/// 列出当前 workspace 的知识包 catalog
#[tauri::command]
pub async fn knowledge_list_packs(
    request: KnowledgeListPacksRequest,
) -> Result<KnowledgeListPacksResponse, String> {
    list_knowledge_packs(request)
}

/// 读取单个知识包详情
#[tauri::command]
pub async fn knowledge_get_pack(
    request: KnowledgeGetPackRequest,
) -> Result<KnowledgePackDetail, String> {
    get_knowledge_pack(request)
}

/// 设置 workspace 默认知识包
#[tauri::command]
pub async fn knowledge_set_default_pack(
    request: KnowledgeSetDefaultPackRequest,
) -> Result<KnowledgeSetDefaultPackResponse, String> {
    set_default_knowledge_pack(request)
}

/// 更新知识包审阅状态
#[tauri::command]
pub async fn knowledge_update_pack_status(
    request: KnowledgeUpdatePackStatusRequest,
) -> Result<KnowledgeUpdatePackStatusResponse, String> {
    update_knowledge_pack_status(request)
}

/// 按任务与预算解析 fenced knowledge context
#[tauri::command]
pub async fn knowledge_resolve_context(
    request: KnowledgeResolveContextRequest,
) -> Result<KnowledgeContextResolution, String> {
    resolve_knowledge_context(request)
}

/// 校验 context-resolution run record
#[tauri::command]
pub async fn knowledge_validate_context_run(
    request: KnowledgeValidateContextRunRequest,
) -> Result<KnowledgeValidateContextRunResponse, String> {
    validate_knowledge_context_run(request)
}
