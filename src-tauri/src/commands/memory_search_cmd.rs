//! Memory search commands
//!
//! Provides Tauri commands for semantic and hybrid search

use crate::database::DbConnection;
use lime_core::database::lock_db;
use lime_memory::models::{
    MemoryCategory, MemoryMetadata, MemorySource, MemoryType, UnifiedMemory,
};
use lime_memory::search;
use lime_services::api_key_provider_service::ApiKeyProviderService;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json;
use tauri::State;

// ==================== Helper Functions ====================

/// Parse memory from database row
fn parse_memory_row(row: &rusqlite::Row) -> Result<UnifiedMemory, rusqlite::Error> {
    let id: String = row.get(0)?;
    let session_id: String = row.get(1)?;
    let memory_type_json: String = row.get(2)?;
    let category_json: String = row.get(3)?;
    let title: String = row.get(4)?;
    let content: String = row.get(5)?;
    let summary: String = row.get(6)?;
    let tags_json: String = row.get(7)?;
    let confidence: f32 = row.get(8)?;
    let importance: i64 = row.get(9)?;
    let access_count: i64 = row.get(10)?;
    let last_accessed_at: Option<i64> = row.get(11)?;
    let source_json: String = row.get(12)?;
    let created_at: i64 = row.get(13)?;
    let updated_at: i64 = row.get(14)?;
    let archived: i64 = row.get(15)?;

    // Parse JSON fields
    let memory_type: MemoryType = serde_json::from_str(&memory_type_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let category: MemoryCategory = serde_json::from_str(&category_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let tags: Vec<String> = serde_json::from_str(&tags_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let source: MemorySource = serde_json::from_str(&source_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    // Build metadata
    let metadata = MemoryMetadata {
        confidence,
        importance: importance as u8,
        access_count: access_count as u32,
        last_accessed_at,
        source,
        embedding: None,
    };

    Ok(UnifiedMemory {
        id,
        session_id,
        memory_type,
        category,
        title,
        content,
        summary,
        tags,
        metadata,
        created_at,
        updated_at,
        archived: archived != 0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchOptions {
    pub query: String,
    pub category: Option<MemoryCategory>,
    pub min_similarity: f32,
    pub limit: Option<u32>,
}

impl SemanticSearchOptions {
    pub fn with_defaults(mut self) -> Self {
        if self.min_similarity == 0.0 {
            self.min_similarity = 0.5;
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSearchOptions {
    pub query: String,
    pub category: Option<MemoryCategory>,
    pub semantic_weight: f32,
    pub min_similarity: f32,
    pub limit: Option<u32>,
}

impl HybridSearchOptions {
    pub fn with_defaults(mut self) -> Self {
        if self.semantic_weight == 0.0 {
            self.semantic_weight = 0.6;
        }
        if self.min_similarity == 0.0 {
            self.min_similarity = 0.5;
        }
        self
    }
}

#[tauri::command]
pub async fn unified_memory_semantic_search(
    db: State<'_, DbConnection>,
    options: SemanticSearchOptions,
) -> Result<Vec<UnifiedMemory>, String> {
    let options = options.with_defaults();

    tracing::info!("[Semantic Search] Query: {}", options.query);

    let api_key_service = ApiKeyProviderService::new();

    let credential = match api_key_service
        .select_credential_for_provider(
            &db,
            "openai",
            None::<&str>,
            None::<&lime_core::models::client_type::ClientType>,
        )
        .await
    {
        Ok(Some(cred)) => cred,
        Ok(None) => {
            return Err(String::from(
                "No available OpenAI credential. Please add OpenAI API Key in settings.",
            ))
        }
        Err(e) => return Err(format!("Failed to get credential: {e}")),
    };

    let api_key = match credential.credential {
        lime_core::models::provider_pool_model::CredentialData::OpenAIKey { api_key, .. } => {
            api_key
        }
        lime_core::models::provider_pool_model::CredentialData::AnthropicKey {
            api_key, ..
        } => api_key,
        _ => {
            return Err(String::from(
                "Semantic search requires OpenAI API Key credential.",
            ))
        }
    };

    let query_embedding = lime_embedding::get_embedding(&options.query, &api_key, None)
        .await
        .map_err(|e| format!("Failed to get embedding: {e}"))?;

    let results = {
        let conn = lock_db(&db)?;
        search::semantic_search(
            &conn,
            &query_embedding,
            options.category.as_ref(),
            options.min_similarity,
        )
        .map_err(|e| format!("Semantic search failed: {e}").to_string())
    }?;

    tracing::info!("[Semantic Search] Returning {} results", results.len());
    Ok(results)
}

#[tauri::command]
pub async fn unified_memory_hybrid_search(
    db: State<'_, DbConnection>,
    options: HybridSearchOptions,
) -> Result<Vec<UnifiedMemory>, String> {
    let options = options.with_defaults();

    tracing::info!(
        "[Hybrid Search] Query: {}, semantic_weight: {}",
        options.query,
        options.semantic_weight
    );

    let api_key_service = ApiKeyProviderService::new();

    let credential = match api_key_service
        .select_credential_for_provider(
            &db,
            "openai",
            None::<&str>,
            None::<&lime_core::models::client_type::ClientType>,
        )
        .await
    {
        Ok(Some(cred)) => cred,
        Ok(None) => {
            return Err(String::from(
                "No available OpenAI credential. Please add OpenAI API Key in settings.",
            ))
        }
        Err(e) => return Err(format!("Failed to get credential: {e}")),
    };

    // Extract API key from credential
    let api_key = match credential.credential {
        lime_core::models::provider_pool_model::CredentialData::OpenAIKey { api_key, .. } => {
            api_key
        }
        lime_core::models::provider_pool_model::CredentialData::AnthropicKey {
            api_key, ..
        } => api_key,
        _ => {
            return Err(String::from(
                "Semantic search requires OpenAI API Key credential.",
            ))
        }
    };

    tracing::debug!("[Hybrid Search] Using API key from API Key Provider");

    // Get query embedding
    let query_embedding = lime_embedding::get_embedding(&options.query, &api_key, None)
        .await
        .map_err(|e| format!("Failed to get embedding: {e}"))?;

    // Calculate keyword weight (1.0 - semantic_weight)
    let keyword_weight = 1.0 - options.semantic_weight;
    tracing::debug!(
        "[Hybrid Search] Weights: semantic={}, keyword={}",
        options.semantic_weight,
        keyword_weight
    );

    // Execute semantic search
    let semantic_results = {
        let conn = lock_db(&db)?;
        search::semantic_search(
            &conn,
            &query_embedding,
            options.category.as_ref(),
            options.min_similarity,
        )
        .map_err(|e| format!("Hybrid semantic search failed: {e}").to_string())
    }?;

    tracing::info!(
        "[Hybrid Search] Semantic: {} results",
        semantic_results.len()
    );

    // Execute keyword search
    let keyword_results: Vec<UnifiedMemory> = {
        let conn = lock_db(&db)?;
        let query_clean = options.query.replace('%', "\\%").replace('_', "\\_");
        let search_pattern = format!("%{query_clean}%");
        let limit = options.limit.unwrap_or(50) as i64;
        let sql = "SELECT id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived FROM unified_memory WHERE archived = 0 AND (title LIKE ?1 OR summary LIKE ?1) ORDER BY updated_at DESC LIMIT ?";

        let mut stmt = conn.prepare(sql)
            .map_err(|e| format!("Failed to prepare statement: {e}"))?;

        let memories = stmt
            .query_map(params![search_pattern, limit], |row| {
                parse_memory_row(row)
            })
            .map_err(|e| format!("Query execution failed: {e}"))?
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .map_err(|e| format!("Result collection failed: {e}"))?;

        tracing::info!("[Hybrid Search] Keyword: {} results", memories.len());

        Ok(memories)
    }.map_err(|e: std::io::Error| format!("Hybrid keyword search failed: {e}").to_string())?;

    // Merge and deduplicate results
    let mut merged = std::collections::HashMap::new();

    // Add semantic results with weighted scores
    for memory in semantic_results {
        let id = memory.id.clone();
        if let std::collections::hash_map::Entry::Vacant(e) = merged.entry(id) {
            e.insert((memory, options.semantic_weight));
        }
    }

    // Add keyword results with weighted scores
    for memory in keyword_results {
        let id = memory.id.clone();
        match merged.entry(id) {
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert((memory, keyword_weight));
            }
            std::collections::hash_map::Entry::Occupied(mut e) => {
                // Memory already in semantic results, add keyword weight to existing score
                e.get_mut().1 += keyword_weight;
            }
        }
    }

    // Convert to Vec and sort by combined score
    let mut results: Vec<(UnifiedMemory, f32)> = merged
        .into_iter()
        .map(|(_, (memory, score))| (memory, score))
        .collect();

    // Sort by combined score (descending)
    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Extract memories, dropping scores
    let memories: Vec<UnifiedMemory> = results.into_iter().map(|(memory, _score)| memory).collect();

    // Apply limit if specified
    let memories = if let Some(limit) = options.limit {
        if memories.len() > limit as usize {
            memories.into_iter().take(limit as usize).collect()
        } else {
            memories
        }
    } else {
        memories
    };

    tracing::info!(
        "[Hybrid Search] Returning {} merged results",
        memories.len()
    );

    Ok(memories)
}
