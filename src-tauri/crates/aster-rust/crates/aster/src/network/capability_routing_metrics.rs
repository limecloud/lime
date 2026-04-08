//! 能力路由指标统计
//!
//! 用于统计能力过滤与回退链路的关键计数，便于上层服务暴露状态与观测。

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CapabilityFilterExcludedReason {
    Tools,
    Vision,
    Context,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityRoutingMetricsSnapshot {
    /// 能力过滤评估总次数（模型候选被评估一次计一次）
    pub filter_eval_total: u64,
    /// 能力过滤排除总次数（候选被过滤掉一次计一次）
    pub filter_excluded_total: u64,
    /// 因 tools 能力不匹配而被过滤次数
    pub filter_excluded_tools_total: u64,
    /// 因 vision 能力不匹配而被过滤次数
    pub filter_excluded_vision_total: u64,
    /// 因 context 不足而被过滤次数
    pub filter_excluded_context_total: u64,
    /// 提供方回退总次数（命中非初始 provider 一次计一次）
    pub provider_fallback_total: u64,
    /// 模型回退总次数（最终模型与原模型不一致一次计一次）
    pub model_fallback_total: u64,
    /// 候选全被过滤总次数（单次过滤阶段无候选可用）
    pub all_candidates_excluded_total: u64,
}

#[derive(Debug, Default)]
pub struct CapabilityRoutingMetricsStore {
    filter_eval_total: AtomicU64,
    filter_excluded_total: AtomicU64,
    filter_excluded_tools_total: AtomicU64,
    filter_excluded_vision_total: AtomicU64,
    filter_excluded_context_total: AtomicU64,
    provider_fallback_total: AtomicU64,
    model_fallback_total: AtomicU64,
    all_candidates_excluded_total: AtomicU64,
}

impl CapabilityRoutingMetricsStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_filter_evaluation(&self) {
        self.filter_eval_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_filter_excluded(&self) {
        self.filter_excluded_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_filter_excluded_reason(&self, reason: CapabilityFilterExcludedReason) {
        match reason {
            CapabilityFilterExcludedReason::Tools => {
                self.filter_excluded_tools_total
                    .fetch_add(1, Ordering::Relaxed);
            }
            CapabilityFilterExcludedReason::Vision => {
                self.filter_excluded_vision_total
                    .fetch_add(1, Ordering::Relaxed);
            }
            CapabilityFilterExcludedReason::Context => {
                self.filter_excluded_context_total
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn record_filter_excluded_with_reasons<I>(&self, reasons: I)
    where
        I: IntoIterator<Item = CapabilityFilterExcludedReason>,
    {
        self.record_filter_excluded();
        for reason in reasons {
            self.record_filter_excluded_reason(reason);
        }
    }

    pub fn record_provider_fallback(&self) {
        self.provider_fallback_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_model_fallback(&self) {
        self.model_fallback_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_all_candidates_excluded(&self) {
        self.all_candidates_excluded_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> CapabilityRoutingMetricsSnapshot {
        CapabilityRoutingMetricsSnapshot {
            filter_eval_total: self.filter_eval_total.load(Ordering::Relaxed),
            filter_excluded_total: self.filter_excluded_total.load(Ordering::Relaxed),
            filter_excluded_tools_total: self.filter_excluded_tools_total.load(Ordering::Relaxed),
            filter_excluded_vision_total: self.filter_excluded_vision_total.load(Ordering::Relaxed),
            filter_excluded_context_total: self
                .filter_excluded_context_total
                .load(Ordering::Relaxed),
            provider_fallback_total: self.provider_fallback_total.load(Ordering::Relaxed),
            model_fallback_total: self.model_fallback_total.load(Ordering::Relaxed),
            all_candidates_excluded_total: self
                .all_candidates_excluded_total
                .load(Ordering::Relaxed),
        }
    }

    pub fn reset(&self) {
        self.filter_eval_total.store(0, Ordering::Relaxed);
        self.filter_excluded_total.store(0, Ordering::Relaxed);
        self.filter_excluded_tools_total.store(0, Ordering::Relaxed);
        self.filter_excluded_vision_total
            .store(0, Ordering::Relaxed);
        self.filter_excluded_context_total
            .store(0, Ordering::Relaxed);
        self.provider_fallback_total.store(0, Ordering::Relaxed);
        self.model_fallback_total.store(0, Ordering::Relaxed);
        self.all_candidates_excluded_total
            .store(0, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_record_and_snapshot_metrics() {
        let store = CapabilityRoutingMetricsStore::new();

        store.record_filter_evaluation();
        store.record_filter_evaluation();
        store.record_filter_excluded_with_reasons([
            CapabilityFilterExcludedReason::Tools,
            CapabilityFilterExcludedReason::Context,
        ]);
        store.record_provider_fallback();
        store.record_model_fallback();
        store.record_all_candidates_excluded();

        let metrics = store.snapshot();
        assert_eq!(metrics.filter_eval_total, 2);
        assert_eq!(metrics.filter_excluded_total, 1);
        assert_eq!(metrics.filter_excluded_tools_total, 1);
        assert_eq!(metrics.filter_excluded_vision_total, 0);
        assert_eq!(metrics.filter_excluded_context_total, 1);
        assert_eq!(metrics.provider_fallback_total, 1);
        assert_eq!(metrics.model_fallback_total, 1);
        assert_eq!(metrics.all_candidates_excluded_total, 1);
    }

    #[test]
    fn should_reset_metrics() {
        let store = CapabilityRoutingMetricsStore::new();
        store.record_filter_evaluation();
        store.record_filter_excluded_with_reasons([CapabilityFilterExcludedReason::Vision]);

        store.reset();

        assert_eq!(
            store.snapshot(),
            CapabilityRoutingMetricsSnapshot::default()
        );
    }
}
