//! 预算管理
//!
//! 跟踪 API 调用成本和预算限制

use parking_lot::RwLock;
use std::collections::HashMap;
use std::time::Instant;

/// 成本追踪器
#[derive(Debug, Clone)]
pub struct CostTracker {
    /// 总成本
    pub total_cost: f64,
    /// 每个模型的成本
    pub cost_per_model: HashMap<String, f64>,
    /// 每个会话的成本
    pub cost_per_session: HashMap<String, f64>,
    /// 预算限制
    pub budget_limit: Option<f64>,
    /// 上次重置时间
    pub last_reset: Instant,
}

impl Default for CostTracker {
    fn default() -> Self {
        Self {
            total_cost: 0.0,
            cost_per_model: HashMap::new(),
            cost_per_session: HashMap::new(),
            budget_limit: None,
            last_reset: Instant::now(),
        }
    }
}

/// 预算管理器
pub struct BudgetManager {
    tracker: RwLock<CostTracker>,
    budget_limit: RwLock<Option<f64>>,
}

impl BudgetManager {
    /// 创建新的预算管理器
    pub fn new(budget_limit: Option<f64>) -> Self {
        Self {
            tracker: RwLock::new(CostTracker {
                budget_limit,
                last_reset: Instant::now(),
                ..Default::default()
            }),
            budget_limit: RwLock::new(budget_limit),
        }
    }

    /// 添加成本
    pub fn add_cost(&self, cost: f64, model: Option<&str>, session_id: Option<&str>) {
        let mut tracker = self.tracker.write();
        tracker.total_cost += cost;

        if let Some(m) = model {
            *tracker.cost_per_model.entry(m.to_string()).or_insert(0.0) += cost;
        }

        if let Some(s) = session_id {
            *tracker.cost_per_session.entry(s.to_string()).or_insert(0.0) += cost;
        }
    }

    /// 检查是否在预算内
    pub fn is_within_budget(&self) -> bool {
        let limit = self.budget_limit.read();
        match *limit {
            Some(l) => self.tracker.read().total_cost < l,
            None => true,
        }
    }

    /// 获取剩余预算
    pub fn get_remaining_budget(&self) -> Option<f64> {
        let limit = self.budget_limit.read();
        limit.map(|l| (l - self.tracker.read().total_cost).max(0.0))
    }

    /// 获取追踪器状态
    pub fn get_tracker(&self) -> CostTracker {
        self.tracker.read().clone()
    }

    /// 重置追踪器
    pub fn reset(&self) {
        let mut tracker = self.tracker.write();
        tracker.total_cost = 0.0;
        tracker.cost_per_model.clear();
        tracker.cost_per_session.clear();
        tracker.last_reset = Instant::now();
    }

    /// 设置预算限制
    pub fn set_budget_limit(&self, limit: Option<f64>) {
        *self.budget_limit.write() = limit;
        self.tracker.write().budget_limit = limit;
    }

    /// 获取总成本
    pub fn get_total_cost(&self) -> f64 {
        self.tracker.read().total_cost
    }

    /// 获取模型成本
    pub fn get_model_cost(&self, model: &str) -> f64 {
        self.tracker
            .read()
            .cost_per_model
            .get(model)
            .copied()
            .unwrap_or(0.0)
    }

    /// 获取会话成本
    pub fn get_session_cost(&self, session_id: &str) -> f64 {
        self.tracker
            .read()
            .cost_per_session
            .get(session_id)
            .copied()
            .unwrap_or(0.0)
    }
}

impl Default for BudgetManager {
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_budget_manager_no_limit() {
        let manager = BudgetManager::new(None);
        manager.add_cost(100.0, None, None);
        assert!(manager.is_within_budget());
        assert_eq!(manager.get_remaining_budget(), None);
    }

    #[test]
    fn test_budget_manager_with_limit() {
        let manager = BudgetManager::new(Some(100.0));
        manager.add_cost(50.0, None, None);
        assert!(manager.is_within_budget());
        assert_eq!(manager.get_remaining_budget(), Some(50.0));

        manager.add_cost(60.0, None, None);
        assert!(!manager.is_within_budget());
        assert_eq!(manager.get_remaining_budget(), Some(0.0));
    }

    #[test]
    fn test_cost_tracking() {
        let manager = BudgetManager::new(None);
        manager.add_cost(10.0, Some("gpt-4"), Some("session-1"));
        manager.add_cost(20.0, Some("claude-3"), Some("session-1"));
        manager.add_cost(15.0, Some("gpt-4"), Some("session-2"));

        assert_eq!(manager.get_total_cost(), 45.0);
        assert_eq!(manager.get_model_cost("gpt-4"), 25.0);
        assert_eq!(manager.get_model_cost("claude-3"), 20.0);
        assert_eq!(manager.get_session_cost("session-1"), 30.0);
        assert_eq!(manager.get_session_cost("session-2"), 15.0);
    }

    #[test]
    fn test_reset() {
        let manager = BudgetManager::new(Some(100.0));
        manager.add_cost(50.0, Some("gpt-4"), None);
        manager.reset();

        assert_eq!(manager.get_total_cost(), 0.0);
        assert_eq!(manager.get_model_cost("gpt-4"), 0.0);
    }
}
