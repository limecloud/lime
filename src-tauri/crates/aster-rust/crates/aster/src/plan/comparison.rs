//! 计划对比功能
//!
//! 支持多个计划方案的对比分析

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use super::persistence::PlanPersistenceManager;
use super::types::*;

/// 默认对比标准
pub fn default_criteria() -> Vec<ComparisonCriteria> {
    vec![
        ComparisonCriteria {
            name: "complexity".to_string(),
            description: "Implementation complexity".to_string(),
            weight: 0.2,
            score_range: (0.0, 10.0),
        },
        ComparisonCriteria {
            name: "risk".to_string(),
            description: "Overall risk level".to_string(),
            weight: 0.25,
            score_range: (0.0, 10.0),
        },
        ComparisonCriteria {
            name: "maintainability".to_string(),
            description: "Long-term maintainability".to_string(),
            weight: 0.2,
            score_range: (0.0, 10.0),
        },
        ComparisonCriteria {
            name: "performance".to_string(),
            description: "Expected performance impact".to_string(),
            weight: 0.15,
            score_range: (0.0, 10.0),
        },
        ComparisonCriteria {
            name: "time_to_implement".to_string(),
            description: "Time required to implement".to_string(),
            weight: 0.2,
            score_range: (0.0, 10.0),
        },
    ]
}

/// 计划对比管理器
pub struct PlanComparisonManager;

impl PlanComparisonManager {
    /// 对比多个计划
    pub fn compare_plans(
        plan_ids: &[String],
        criteria: Option<Vec<ComparisonCriteria>>,
    ) -> Result<PlanComparison, String> {
        let criteria = criteria.unwrap_or_else(default_criteria);

        // 加载所有计划
        let mut plans = Vec::new();
        for id in plan_ids {
            let plan = PlanPersistenceManager::load_plan(id)?;
            plans.push(plan);
        }

        if plans.len() < 2 {
            return Err("Need at least 2 plans to compare".to_string());
        }

        // 计算得分
        let mut scores: HashMap<String, HashMap<String, f32>> = HashMap::new();
        let mut total_scores: HashMap<String, f32> = HashMap::new();

        for plan in &plans {
            let plan_id = &plan.metadata.id;
            let mut plan_scores = HashMap::new();
            let mut weighted_total = 0.0;

            for criterion in &criteria {
                let score = Self::calculate_score(plan, criterion);
                plan_scores.insert(criterion.name.clone(), score);
                weighted_total += score * criterion.weight;
            }

            scores.insert(plan_id.clone(), plan_scores);
            total_scores.insert(plan_id.clone(), (weighted_total * 10.0).round() / 10.0);
        }

        // 找出推荐的计划
        let recommended_plan_id = total_scores
            .iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(id, _)| id.clone())
            .unwrap_or_default();

        let analysis = Self::generate_analysis(&plans, &scores, &criteria);
        let recommendation = Self::generate_recommendation(
            plans
                .iter()
                .find(|p| p.metadata.id == recommended_plan_id)
                .unwrap(),
            &plans,
            &total_scores,
        );

        Ok(PlanComparison {
            plans,
            criteria,
            scores,
            total_scores,
            recommended_plan_id,
            recommendation,
            analysis,
            generated_at: current_timestamp(),
        })
    }

    /// 计算单个计划在某个标准上的得分
    fn calculate_score(plan: &SavedPlan, criterion: &ComparisonCriteria) -> f32 {
        match criterion.name.as_str() {
            "complexity" => Self::score_complexity(plan),
            "risk" => Self::score_risk(plan),
            "maintainability" => Self::score_maintainability(plan),
            "performance" => Self::score_performance(plan),
            "time_to_implement" => Self::score_time_to_implement(plan),
            _ => 5.0,
        }
    }

    /// 评估复杂度得分（复杂度越低，得分越高）
    fn score_complexity(plan: &SavedPlan) -> f32 {
        match plan.estimated_complexity {
            Complexity::Simple => 10.0,
            Complexity::Moderate => 7.0,
            Complexity::Complex => 4.0,
            Complexity::VeryComplex => 1.0,
        }
    }

    /// 评估风险得分（风险越低，得分越高）
    fn score_risk(plan: &SavedPlan) -> f32 {
        if plan.risks.is_empty() {
            return 10.0;
        }

        let total: f32 = plan
            .risks
            .iter()
            .map(|r| match r.level {
                RiskLevel::Low => 1.0,
                RiskLevel::Medium => 2.0,
                RiskLevel::High => 3.0,
                RiskLevel::Critical => 4.0,
            })
            .sum();

        let avg = total / plan.risks.len() as f32;
        (10.0 - avg * 2.5).max(1.0)
    }

    /// 评估可维护性得分
    fn score_maintainability(plan: &SavedPlan) -> f32 {
        let mut score = 5.0;

        if !plan.architectural_decisions.is_empty() {
            score += (plan.architectural_decisions.len() as f32 * 0.5).min(2.0);
        }

        if plan.recommendations.as_ref().is_some_and(|r| !r.is_empty()) {
            score += 1.0;
        }

        score.clamp(1.0, 10.0)
    }

    /// 评估性能影响得分
    fn score_performance(plan: &SavedPlan) -> f32 {
        let mut score = 5.0;

        let perf_keywords = ["performance", "optimize", "fast", "speed", "efficient"];
        let has_perf_focus = plan
            .requirements_analysis
            .non_functional_requirements
            .iter()
            .any(|req| perf_keywords.iter().any(|k| req.to_lowercase().contains(k)));

        if has_perf_focus {
            score += 2.0;
        }

        let perf_risks: Vec<_> = plan
            .risks
            .iter()
            .filter(|r| matches!(r.category, RiskCategory::Performance))
            .collect();

        if !perf_risks.is_empty() {
            let avg_level: f32 = perf_risks
                .iter()
                .map(|r| match r.level {
                    RiskLevel::Low => 1.0,
                    RiskLevel::Medium => 2.0,
                    RiskLevel::High => 3.0,
                    RiskLevel::Critical => 4.0,
                })
                .sum::<f32>()
                / perf_risks.len() as f32;
            score -= avg_level * 0.5;
        }

        score.clamp(1.0, 10.0)
    }

    /// 评估实现时间得分（时间越短，得分越高）
    fn score_time_to_implement(plan: &SavedPlan) -> f32 {
        let hours = plan.estimated_hours.unwrap_or(8.0);

        if hours <= 4.0 {
            10.0
        } else if hours <= 8.0 {
            9.0
        } else if hours <= 16.0 {
            7.0
        } else if hours <= 40.0 {
            5.0
        } else if hours <= 80.0 {
            3.0
        } else {
            1.0
        }
    }

    /// 生成详细分析
    fn generate_analysis(
        plans: &[SavedPlan],
        scores: &HashMap<String, HashMap<String, f32>>,
        criteria: &[ComparisonCriteria],
    ) -> ComparisonAnalysis {
        let mut strengths: HashMap<String, Vec<String>> = HashMap::new();
        let mut weaknesses: HashMap<String, Vec<String>> = HashMap::new();
        let mut risk_comparison: HashMap<String, Vec<Risk>> = HashMap::new();
        let mut complexity_comparison: HashMap<String, String> = HashMap::new();

        for plan in plans {
            let plan_id = &plan.metadata.id;
            let mut plan_strengths = Vec::new();
            let mut plan_weaknesses = Vec::new();

            for criterion in criteria {
                let score = scores
                    .get(plan_id)
                    .and_then(|s| s.get(&criterion.name))
                    .copied()
                    .unwrap_or(5.0);

                let avg_score: f32 = scores
                    .values()
                    .filter_map(|s| s.get(&criterion.name))
                    .sum::<f32>()
                    / plans.len() as f32;

                if score > avg_score + 1.0 {
                    plan_strengths.push(format!(
                        "Strong {} (score: {:.1})",
                        criterion.description, score
                    ));
                } else if score < avg_score - 1.0 {
                    plan_weaknesses.push(format!(
                        "Weak {} (score: {:.1})",
                        criterion.description, score
                    ));
                }
            }

            if plan_strengths.is_empty() && !plan.steps.is_empty() {
                plan_strengths.push("Well-structured implementation steps".to_string());
            }

            strengths.insert(plan_id.clone(), plan_strengths);
            weaknesses.insert(plan_id.clone(), plan_weaknesses);
            risk_comparison.insert(plan_id.clone(), plan.risks.clone());
            complexity_comparison
                .insert(plan_id.clone(), format!("{:?}", plan.estimated_complexity));
        }

        ComparisonAnalysis {
            strengths,
            weaknesses,
            risk_comparison,
            complexity_comparison,
        }
    }

    /// 生成推荐理由
    fn generate_recommendation(
        recommended: &SavedPlan,
        all_plans: &[SavedPlan],
        total_scores: &HashMap<String, f32>,
    ) -> String {
        let score = total_scores
            .get(&recommended.metadata.id)
            .copied()
            .unwrap_or(0.0);
        let avg_score: f32 = total_scores.values().sum::<f32>() / all_plans.len() as f32;
        let diff_pct = ((score / avg_score - 1.0) * 100.0).round();

        let mut reasons = vec![
            format!(
                "Plan \"{}\" scored {:.1} out of 10, which is {:.1}% higher than the average.",
                recommended.metadata.title, score, diff_pct
            ),
            format!(
                "\nThis plan has {:?} complexity with an estimated {} hours to implement.",
                recommended.estimated_complexity,
                recommended
                    .estimated_hours
                    .map_or("unknown".to_string(), |h| format!("{:.1}", h))
            ),
        ];

        let high_risks: Vec<_> = recommended
            .risks
            .iter()
            .filter(|r| matches!(r.level, RiskLevel::High | RiskLevel::Critical))
            .collect();

        if !high_risks.is_empty() {
            reasons.push(format!(
                "\nNote: This plan has {} high-priority risk(s) that should be addressed.",
                high_risks.len()
            ));
        } else {
            reasons.push("\nThis plan has relatively low risk profile.".to_string());
        }

        reasons.join("")
    }

    /// 生成对比报告
    pub fn generate_comparison_report(comparison: &PlanComparison) -> String {
        let mut lines = Vec::new();

        lines.push("# Plan Comparison Report".to_string());
        lines.push(String::new());
        lines.push(format!("Comparing {} plans:", comparison.plans.len()));

        for (idx, plan) in comparison.plans.iter().enumerate() {
            let score = comparison
                .total_scores
                .get(&plan.metadata.id)
                .unwrap_or(&0.0);
            lines.push(format!(
                "{}. **{}** ({:?}) - Score: {:.1}/10",
                idx + 1,
                plan.metadata.title,
                plan.metadata.status,
                score
            ));
        }

        lines.push(String::new());
        lines.push("## Recommendation".to_string());
        lines.push(comparison.recommendation.clone());

        lines.join("\n")
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
