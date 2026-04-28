//! 处理器模块测试

use crate::ProviderType;
use lime_processor::*;
use std::sync::Arc;

#[test]
fn test_request_processor_new() {
    let processor = RequestProcessor::with_defaults();

    // 验证所有组件都已初始化
    assert!(Arc::strong_count(&processor.router) >= 1);
    assert!(Arc::strong_count(&processor.mapper) >= 1);
    assert!(Arc::strong_count(&processor.injector) >= 1);
    assert!(Arc::strong_count(&processor.retrier) >= 1);
    assert!(Arc::strong_count(&processor.failover) >= 1);
    assert!(Arc::strong_count(&processor.timeout) >= 1);
    assert!(Arc::strong_count(&processor.plugins) >= 1);
    assert!(Arc::strong_count(&processor.stats) >= 1);
    assert!(Arc::strong_count(&processor.tokens) >= 1);
}

#[tokio::test]
async fn test_request_processor_components() {
    let processor = RequestProcessor::with_defaults();

    // 验证路由器可以正常使用
    {
        let router = processor.router.read().await;
        // 默认路由器为空，等待从配置加载
        assert_eq!(router.default_provider(), None);
    }

    // 验证映射器可以正常使用
    {
        let mapper = processor.mapper.read().await;
        // resolve 返回原值如果没有别名
        assert_eq!(mapper.resolve("unknown"), "unknown");
    }

    // 验证注入器可以正常使用
    {
        let injector = processor.injector.read().await;
        assert!(injector.rules().is_empty());
    }

    // 验证统计聚合器可以正常使用（使用 parking_lot::RwLock）
    {
        let stats = processor.stats.read();
        assert!(stats.is_empty());
    }

    // 验证 Token 追踪器可以正常使用（使用 parking_lot::RwLock）
    {
        let tokens = processor.tokens.read();
        assert!(tokens.is_empty());
    }
}

// ========== 模型映射测试 (需求 2.1) ==========

#[tokio::test]
async fn test_resolve_model_with_alias() {
    let processor = RequestProcessor::with_defaults();

    // 添加别名映射
    {
        let mut mapper = processor.mapper.write().await;
        mapper.add_alias("gpt-4", "claude-sonnet-4-5");
        mapper.add_alias("gpt-3.5-turbo", "claude-3-haiku");
    }

    // 测试别名解析
    let resolved = processor.resolve_model("gpt-4").await;
    assert_eq!(resolved, "claude-sonnet-4-5");

    let resolved = processor.resolve_model("gpt-3.5-turbo").await;
    assert_eq!(resolved, "claude-3-haiku");

    // 非别名应返回原值
    let resolved = processor.resolve_model("claude-sonnet-4-5").await;
    assert_eq!(resolved, "claude-sonnet-4-5");
}

#[tokio::test]
async fn test_resolve_model_for_context() {
    let processor = RequestProcessor::with_defaults();

    // 添加别名映射
    {
        let mut mapper = processor.mapper.write().await;
        mapper.add_alias("gpt-4", "claude-sonnet-4-5");
    }

    // 创建请求上下文
    let mut ctx = RequestContext::new("gpt-4".to_string());
    assert_eq!(ctx.original_model, "gpt-4");
    assert_eq!(ctx.resolved_model, "gpt-4"); // 初始时相同

    // 解析模型并更新上下文
    let resolved = processor.resolve_model_for_context(&mut ctx).await;

    assert_eq!(resolved, "claude-sonnet-4-5");
    assert_eq!(ctx.original_model, "gpt-4"); // 原始模型不变
    assert_eq!(ctx.resolved_model, "claude-sonnet-4-5"); // 解析后的模型已更新
}

// ========== 路由测试 ==========

#[tokio::test]
async fn test_route_model_returns_default() {
    let processor = RequestProcessor::with_defaults();

    // 默认路由器为空，所有模型都应返回 None
    let (provider, is_default) = processor.route_model("gemini-2.5-flash").await;
    assert_eq!(provider, None);
    assert!(is_default);

    let (provider, is_default) = processor.route_model("claude-sonnet-4-5").await;
    assert_eq!(provider, None);
    assert!(is_default);
}

#[tokio::test]
async fn test_route_for_context() {
    let processor = RequestProcessor::with_defaults();

    // 创建请求上下文
    let mut ctx = RequestContext::new("gemini-2.5-flash".to_string());
    ctx.set_resolved_model("gemini-2.5-flash".to_string());

    // 路由并更新上下文（默认路由器为空，返回 None）
    let provider = processor.route_for_context(&mut ctx).await;

    assert_eq!(provider, None);
    assert_eq!(ctx.provider, None);
}

#[tokio::test]
async fn test_resolve_and_route() {
    let processor = RequestProcessor::with_defaults();

    // 添加别名映射
    {
        let mut mapper = processor.mapper.write().await;
        mapper.add_alias("gpt-4", "claude-sonnet-4-5");
    }

    // 测试完整的解析和路由流程
    let mut ctx = RequestContext::new("gpt-4".to_string());
    let provider = processor.resolve_and_route(&mut ctx).await;

    // gpt-4 -> claude-sonnet-4-5 -> None (默认路由器为空)
    assert_eq!(ctx.original_model, "gpt-4");
    assert_eq!(ctx.resolved_model, "claude-sonnet-4-5");
    assert_eq!(provider, None);
    assert_eq!(ctx.provider, None);
}

// ========== 属性测试 (Property-Based Tests) ==========

use crate::telemetry::{RequestLog, RequestStatus};
use proptest::prelude::*;

/// 生成随机的 ProviderType
fn arb_provider_type() -> impl Strategy<Value = ProviderType> {
    prop_oneof![
        Just(ProviderType::Kiro),
        Just(ProviderType::Gemini),
        Just(ProviderType::OpenAI),
        Just(ProviderType::Claude),
    ]
}

/// 生成随机的 RequestStatus
fn arb_request_status() -> impl Strategy<Value = RequestStatus> {
    prop_oneof![
        Just(RequestStatus::Success),
        Just(RequestStatus::Failed),
        Just(RequestStatus::Timeout),
        Just(RequestStatus::Cancelled),
    ]
}

/// 生成随机的模型名称
fn arb_model_name() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("claude-sonnet-4".to_string()),
        Just("claude-opus-4".to_string()),
        Just("gemini-2.5-flash".to_string()),
        Just("gemini-2.5-pro".to_string()),
        Just("qwen3-coder-plus".to_string()),
        Just("gpt-4o".to_string()),
    ]
}

/// 生成随机的请求日志
fn arb_request_log() -> impl Strategy<Value = RequestLog> {
    (
        "[a-zA-Z0-9_-]{8,16}", // id
        arb_provider_type(),
        arb_model_name(),
        any::<bool>(), // is_streaming
        arb_request_status(),
        1u64..10000u64,                   // duration_ms
        prop::option::of(100u16..600u16), // http_status
        prop::option::of(1u32..10000u32), // input_tokens
        prop::option::of(1u32..5000u32),  // output_tokens
    )
        .prop_map(
            |(
                id,
                provider,
                model,
                is_streaming,
                status,
                duration_ms,
                http_status,
                input_tokens,
                output_tokens,
            )| {
                let mut log = RequestLog::new(id, provider, model, is_streaming);

                match status {
                    RequestStatus::Success => {
                        log.mark_success(duration_ms, http_status.unwrap_or(200));
                    }
                    RequestStatus::Failed => {
                        log.mark_failed(duration_ms, http_status, "Test error".to_string());
                    }
                    RequestStatus::Timeout => {
                        log.mark_timeout(duration_ms);
                    }
                    RequestStatus::Cancelled => {
                        log.mark_cancelled(duration_ms);
                    }
                    RequestStatus::Retrying => {
                        // 保持默认状态
                    }
                }

                log.set_tokens(input_tokens, output_tokens);
                log
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: module-integration, Property 1: 请求完成后统计记录**
    #[test]
    fn prop_request_stats_recorded(
        log in arb_request_log()
    ) {
        let processor = RequestProcessor::with_defaults();

        let original_id = log.id.clone();
        let original_provider = log.provider;
        let original_model = log.model.clone();
        let original_status = log.status;

        // 记录请求日志到 StatsAggregator
        {
            let stats = processor.stats.write();
            stats.record(log);
        }

        // 验证：StatsAggregator 中应存在对应的记录
        {
            let stats = processor.stats.read();
            let all_logs = stats.get_all();

            let found = all_logs.iter().find(|l| l.id == original_id);
            prop_assert!(
                found.is_some(),
                "请求 {} 完成后应在 StatsAggregator 中存在记录",
                original_id
            );

            let found_log = found.unwrap();
            prop_assert_eq!(found_log.provider, original_provider);
            prop_assert_eq!(&found_log.model, &original_model);
            prop_assert_eq!(found_log.status, original_status);
        }
    }
}
