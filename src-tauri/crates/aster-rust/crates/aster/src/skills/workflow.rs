//! Workflow Processing Module
//!
//! 提供工作流处理相关的函数，包括变量插值和拓扑排序。
//!
//! # 概述
//!
//! 本模块是 Skills Workflow Engine 的核心处理模块，提供：
//! - `interpolate_variables`: 变量插值函数，替换模板中的 `${var_name}` 占位符
//! - `topological_sort`: 拓扑排序函数，根据依赖关系确定步骤执行顺序
//!
//! # 变量插值
//!
//! 支持的变量格式：
//! - `${var_name}` - 简单变量引用
//! - `${step_id.output}` - 步骤输出引用
//! - `${user_input}` - 用户输入引用
//!
//! # 示例
//!
//! ```rust
//! use std::collections::HashMap;
//! use aster::skills::interpolate_variables;
//!
//! let mut context = HashMap::new();
//! context.insert("name".to_string(), "Alice".to_string());
//! context.insert("greeting".to_string(), "Hello".to_string());
//!
//! let template = "${greeting}, ${name}! Welcome to ${unknown}.";
//! let result = interpolate_variables(template, &context);
//!
//! assert_eq!(result, "Hello, Alice! Welcome to ${unknown}.");
//! ```

use regex::Regex;
use std::collections::{HashMap, HashSet, VecDeque};

use super::error::SkillError;
use super::types::WorkflowStep;

/// 变量插值
///
/// 将模板字符串中的 `${var_name}` 占位符替换为上下文中对应的值。
/// 对于上下文中不存在的变量，保留原始占位符不变。
///
/// # 支持格式
///
/// - `${var_name}` - 简单变量引用
/// - `${step_id.output}` - 步骤输出引用（点号分隔）
/// - `${user_input}` - 用户输入引用
///
/// # Arguments
///
/// * `template` - 包含变量占位符的模板字符串
/// * `context` - 变量名到值的映射
///
/// # Returns
///
/// 替换后的字符串。已知变量被替换为对应值，未知变量保留原始占位符。
///
/// # 示例
///
/// ```rust
/// use std::collections::HashMap;
/// use aster::skills::interpolate_variables;
///
/// // 基本变量替换
/// let mut context = HashMap::new();
/// context.insert("name".to_string(), "World".to_string());
/// let result = interpolate_variables("Hello, ${name}!", &context);
/// assert_eq!(result, "Hello, World!");
///
/// // 未知变量保留原样
/// let result = interpolate_variables("Hello, ${unknown}!", &HashMap::new());
/// assert_eq!(result, "Hello, ${unknown}!");
///
/// // 步骤输出引用
/// let mut context = HashMap::new();
/// context.insert("step1.output".to_string(), "分析结果".to_string());
/// let result = interpolate_variables("基于 ${step1.output} 继续", &context);
/// assert_eq!(result, "基于 分析结果 继续");
/// ```
///
/// # 性能说明
///
/// 函数使用正则表达式进行匹配，对于大量变量或长模板字符串，
/// 性能可能受到影响。建议在性能敏感场景下缓存编译后的正则表达式。
pub fn interpolate_variables(template: &str, context: &HashMap<String, String>) -> String {
    // 匹配 ${var_name} 模式
    // 变量名可以包含：字母、数字、下划线、点号、连字符
    let re = Regex::new(r"\$\{([a-zA-Z_][a-zA-Z0-9_.\-]*)\}").expect("Invalid regex pattern");

    // 使用 replace_all 进行替换
    re.replace_all(template, |caps: &regex::Captures| {
        let var_name = &caps[1];
        // 如果变量存在于上下文中，返回其值；否则保留原始占位符
        context
            .get(var_name)
            .cloned()
            .unwrap_or_else(|| format!("${{{}}}", var_name))
    })
    .into_owned()
}

/// 拓扑排序
///
/// 根据步骤依赖关系确定执行顺序。使用 Kahn 算法（BFS）实现。
///
/// # 算法说明
///
/// 1. 构建入度表（每个步骤被多少其他步骤依赖）
/// 2. 将入度为 0 的步骤加入队列
/// 3. 依次处理队列中的步骤，将其加入结果，并减少其依赖步骤的入度
/// 4. 如果最终结果数量不等于步骤总数，说明存在循环依赖
///
/// # Arguments
///
/// * `steps` - 工作流步骤列表
///
/// # Returns
///
/// 排序后的步骤引用列表，或错误：
/// - `SkillError::MissingDependency` - 步骤引用了不存在的依赖
/// - `SkillError::CyclicDependency` - 步骤之间存在循环依赖
///
/// # 示例
///
/// ```rust
/// use aster::skills::topological_sort;
/// use aster::skills::WorkflowStep;
///
/// // 创建步骤：step2 依赖 step1
/// let steps = vec![
///     WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
///     WorkflowStep::new("step2", "步骤二", "提示2", "out2")
///         .with_dependency("step1"),
/// ];
///
/// let sorted = topological_sort(&steps).unwrap();
/// assert_eq!(sorted[0].id, "step1");
/// assert_eq!(sorted[1].id, "step2");
/// ```
///
/// # 错误示例
///
/// ```rust
/// use aster::skills::topological_sort;
/// use aster::skills::WorkflowStep;
///
/// // 循环依赖：step1 -> step2 -> step1
/// let steps = vec![
///     WorkflowStep::new("step1", "步骤一", "提示1", "out1")
///         .with_dependency("step2"),
///     WorkflowStep::new("step2", "步骤二", "提示2", "out2")
///         .with_dependency("step1"),
/// ];
///
/// let result = topological_sort(&steps);
/// assert!(result.is_err());
/// ```
pub fn topological_sort(steps: &[WorkflowStep]) -> Result<Vec<&WorkflowStep>, SkillError> {
    // 空步骤列表直接返回空结果
    if steps.is_empty() {
        return Ok(Vec::new());
    }

    // 构建步骤 ID 到索引的映射
    let step_ids: HashSet<&str> = steps.iter().map(|s| s.id.as_str()).collect();
    let id_to_index: HashMap<&str, usize> = steps
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();

    // 检查所有依赖是否存在
    for step in steps {
        for dep in &step.dependencies {
            if !step_ids.contains(dep.as_str()) {
                return Err(SkillError::missing_dependency(format!(
                    "步骤 '{}' 依赖的 '{}' 不存在",
                    step.id, dep
                )));
            }
        }
    }

    // 计算每个步骤的入度（被依赖的次数）
    // 入度 = 当前步骤依赖的步骤数量
    let mut in_degree: Vec<usize> = vec![0; steps.len()];
    for step in steps {
        // 当前步骤有多少依赖，入度就是多少
        in_degree[id_to_index[step.id.as_str()]] = step.dependencies.len();
    }

    // 初始化队列：将入度为 0 的步骤加入队列
    let mut queue: VecDeque<usize> = VecDeque::new();
    for (i, &degree) in in_degree.iter().enumerate() {
        if degree == 0 {
            queue.push_back(i);
        }
    }

    // 构建邻接表：记录每个步骤被哪些步骤依赖
    // adjacency[i] = 依赖步骤 i 的所有步骤索引
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); steps.len()];
    for (i, step) in steps.iter().enumerate() {
        for dep in &step.dependencies {
            let dep_idx = id_to_index[dep.as_str()];
            adjacency[dep_idx].push(i);
        }
    }

    // BFS 拓扑排序
    let mut result: Vec<&WorkflowStep> = Vec::with_capacity(steps.len());
    while let Some(idx) = queue.pop_front() {
        result.push(&steps[idx]);

        // 减少所有依赖当前步骤的步骤的入度
        for &dependent_idx in &adjacency[idx] {
            in_degree[dependent_idx] -= 1;
            if in_degree[dependent_idx] == 0 {
                queue.push_back(dependent_idx);
            }
        }
    }

    // 检查是否所有步骤都被处理（检测循环依赖）
    if result.len() != steps.len() {
        // 找出循环中的步骤
        let processed: HashSet<usize> = result.iter().map(|s| id_to_index[s.id.as_str()]).collect();
        let cycle_steps: Vec<&str> = steps
            .iter()
            .enumerate()
            .filter(|(i, _)| !processed.contains(i))
            .map(|(_, s)| s.id.as_str())
            .collect();

        return Err(SkillError::cyclic_dependency(format!(
            "检测到循环依赖，涉及步骤: {}",
            cycle_steps.join(", ")
        )));
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== 基本功能测试 ====================

    #[test]
    fn test_interpolate_single_variable() {
        let mut context = HashMap::new();
        context.insert("name".to_string(), "Alice".to_string());

        let result = interpolate_variables("Hello, ${name}!", &context);
        assert_eq!(result, "Hello, Alice!");
    }

    #[test]
    fn test_interpolate_multiple_variables() {
        let mut context = HashMap::new();
        context.insert("greeting".to_string(), "Hello".to_string());
        context.insert("name".to_string(), "Bob".to_string());
        context.insert("time".to_string(), "morning".to_string());

        let result = interpolate_variables("${greeting}, ${name}! Good ${time}.", &context);
        assert_eq!(result, "Hello, Bob! Good morning.");
    }

    #[test]
    fn test_interpolate_same_variable_multiple_times() {
        let mut context = HashMap::new();
        context.insert("word".to_string(), "test".to_string());

        let result = interpolate_variables("${word} ${word} ${word}", &context);
        assert_eq!(result, "test test test");
    }

    // ==================== 未知变量测试 ====================

    #[test]
    fn test_interpolate_unknown_variable_preserved() {
        let context = HashMap::new();
        let result = interpolate_variables("Hello, ${unknown}!", &context);
        assert_eq!(result, "Hello, ${unknown}!");
    }

    #[test]
    fn test_interpolate_mixed_known_unknown_variables() {
        let mut context = HashMap::new();
        context.insert("known".to_string(), "value".to_string());

        let result = interpolate_variables("${known} and ${unknown}", &context);
        assert_eq!(result, "value and ${unknown}");
    }

    #[test]
    fn test_interpolate_all_unknown_variables() {
        let context = HashMap::new();
        let template = "${a} ${b} ${c}";
        let result = interpolate_variables(template, &context);
        assert_eq!(result, "${a} ${b} ${c}");
    }

    // ==================== 特殊变量名测试 ====================

    #[test]
    fn test_interpolate_variable_with_underscore() {
        let mut context = HashMap::new();
        context.insert("user_input".to_string(), "用户输入".to_string());

        let result = interpolate_variables("处理 ${user_input}", &context);
        assert_eq!(result, "处理 用户输入");
    }

    #[test]
    fn test_interpolate_variable_with_numbers() {
        let mut context = HashMap::new();
        context.insert("step1".to_string(), "第一步".to_string());
        context.insert("result2".to_string(), "结果二".to_string());

        let result = interpolate_variables("${step1} -> ${result2}", &context);
        assert_eq!(result, "第一步 -> 结果二");
    }

    #[test]
    fn test_interpolate_variable_with_dot() {
        let mut context = HashMap::new();
        context.insert("step1.output".to_string(), "步骤输出".to_string());

        let result = interpolate_variables("基于 ${step1.output} 继续", &context);
        assert_eq!(result, "基于 步骤输出 继续");
    }

    #[test]
    fn test_interpolate_variable_with_hyphen() {
        let mut context = HashMap::new();
        context.insert("my-var".to_string(), "连字符变量".to_string());

        let result = interpolate_variables("值: ${my-var}", &context);
        assert_eq!(result, "值: 连字符变量");
    }

    #[test]
    fn test_interpolate_complex_variable_name() {
        let mut context = HashMap::new();
        context.insert("analyze_step.result-1".to_string(), "复杂结果".to_string());

        let result = interpolate_variables("${analyze_step.result-1}", &context);
        assert_eq!(result, "复杂结果");
    }

    // ==================== 边界情况测试 ====================

    #[test]
    fn test_interpolate_empty_template() {
        let context = HashMap::new();
        let result = interpolate_variables("", &context);
        assert_eq!(result, "");
    }

    #[test]
    fn test_interpolate_no_variables() {
        let context = HashMap::new();
        let result = interpolate_variables("Hello, World!", &context);
        assert_eq!(result, "Hello, World!");
    }

    #[test]
    fn test_interpolate_empty_context() {
        let context = HashMap::new();
        let result = interpolate_variables("${var}", &context);
        assert_eq!(result, "${var}");
    }

    #[test]
    fn test_interpolate_variable_at_start() {
        let mut context = HashMap::new();
        context.insert("start".to_string(), "开始".to_string());

        let result = interpolate_variables("${start}后面的内容", &context);
        assert_eq!(result, "开始后面的内容");
    }

    #[test]
    fn test_interpolate_variable_at_end() {
        let mut context = HashMap::new();
        context.insert("end".to_string(), "结束".to_string());

        let result = interpolate_variables("前面的内容${end}", &context);
        assert_eq!(result, "前面的内容结束");
    }

    #[test]
    fn test_interpolate_only_variable() {
        let mut context = HashMap::new();
        context.insert("only".to_string(), "唯一".to_string());

        let result = interpolate_variables("${only}", &context);
        assert_eq!(result, "唯一");
    }

    #[test]
    fn test_interpolate_adjacent_variables() {
        let mut context = HashMap::new();
        context.insert("a".to_string(), "A".to_string());
        context.insert("b".to_string(), "B".to_string());

        let result = interpolate_variables("${a}${b}", &context);
        assert_eq!(result, "AB");
    }

    // ==================== 特殊字符值测试 ====================

    #[test]
    fn test_interpolate_value_with_special_chars() {
        let mut context = HashMap::new();
        context.insert("special".to_string(), "值包含 ${}[] 特殊字符".to_string());

        let result = interpolate_variables("${special}", &context);
        assert_eq!(result, "值包含 ${}[] 特殊字符");
    }

    #[test]
    fn test_interpolate_value_with_newlines() {
        let mut context = HashMap::new();
        context.insert(
            "multiline".to_string(),
            "第一行\n第二行\n第三行".to_string(),
        );

        let result = interpolate_variables("内容:\n${multiline}", &context);
        assert_eq!(result, "内容:\n第一行\n第二行\n第三行");
    }

    #[test]
    fn test_interpolate_value_with_unicode() {
        let mut context = HashMap::new();
        context.insert("emoji".to_string(), "🎉🚀✨".to_string());
        context.insert("chinese".to_string(), "中文内容".to_string());

        let result = interpolate_variables("${emoji} ${chinese}", &context);
        assert_eq!(result, "🎉🚀✨ 中文内容");
    }

    #[test]
    fn test_interpolate_empty_value() {
        let mut context = HashMap::new();
        context.insert("empty".to_string(), String::new());

        let result = interpolate_variables("前${empty}后", &context);
        assert_eq!(result, "前后");
    }

    // ==================== 无效格式测试（不应匹配） ====================

    #[test]
    fn test_interpolate_invalid_format_no_braces() {
        let mut context = HashMap::new();
        context.insert("var".to_string(), "value".to_string());

        // $var 不是有效格式，应保持原样
        let result = interpolate_variables("$var", &context);
        assert_eq!(result, "$var");
    }

    #[test]
    fn test_interpolate_invalid_format_single_brace() {
        let mut context = HashMap::new();
        context.insert("var".to_string(), "value".to_string());

        // ${var 和 $var} 不是有效格式
        let result = interpolate_variables("${var $var}", &context);
        assert_eq!(result, "${var $var}");
    }

    #[test]
    fn test_interpolate_invalid_format_empty_braces() {
        let context = HashMap::new();

        // ${} 不是有效格式（变量名不能为空）
        let result = interpolate_variables("${}", &context);
        assert_eq!(result, "${}");
    }

    #[test]
    fn test_interpolate_invalid_format_starts_with_number() {
        let mut context = HashMap::new();
        context.insert("1var".to_string(), "value".to_string());

        // ${1var} 不是有效格式（变量名不能以数字开头）
        let result = interpolate_variables("${1var}", &context);
        assert_eq!(result, "${1var}");
    }

    #[test]
    fn test_interpolate_invalid_format_with_spaces() {
        let mut context = HashMap::new();
        context.insert("var name".to_string(), "value".to_string());

        // ${var name} 不是有效格式（变量名不能包含空格）
        let result = interpolate_variables("${var name}", &context);
        assert_eq!(result, "${var name}");
    }

    // ==================== user_input 特殊变量测试 ====================

    #[test]
    fn test_interpolate_user_input() {
        let mut context = HashMap::new();
        context.insert("user_input".to_string(), "用户的原始输入".to_string());

        let result = interpolate_variables("处理用户输入: ${user_input}", &context);
        assert_eq!(result, "处理用户输入: 用户的原始输入");
    }

    // ==================== 步骤输出引用测试 ====================

    #[test]
    fn test_interpolate_step_output_reference() {
        let mut context = HashMap::new();
        context.insert("analyze.output".to_string(), "分析结果".to_string());
        context.insert("generate.output".to_string(), "生成内容".to_string());

        let template = "基于 ${analyze.output}，生成了 ${generate.output}";
        let result = interpolate_variables(template, &context);
        assert_eq!(result, "基于 分析结果，生成了 生成内容");
    }

    // ==================== 长字符串测试 ====================

    #[test]
    fn test_interpolate_long_template() {
        let mut context = HashMap::new();
        context.insert("var".to_string(), "X".to_string());

        // 创建一个包含多个变量的长模板
        let template = "${var} ".repeat(1000);
        let result = interpolate_variables(&template, &context);

        assert_eq!(result.matches('X').count(), 1000);
    }

    #[test]
    fn test_interpolate_long_value() {
        let mut context = HashMap::new();
        let long_value = "a".repeat(10000);
        context.insert("long".to_string(), long_value.clone());

        let result = interpolate_variables("${long}", &context);
        assert_eq!(result, long_value);
    }

    // ==================== 实际使用场景测试 ====================

    #[test]
    fn test_interpolate_workflow_prompt_template() {
        let mut context = HashMap::new();
        context.insert("user_input".to_string(), "def hello(): pass".to_string());
        context.insert("analysis.output".to_string(), "这是一个空函数".to_string());

        let template = r#"
你是一个代码审查助手。

用户提交的代码：
```python
${user_input}
```

之前的分析结果：
${analysis.output}

请基于以上信息，提供改进建议。
"#;

        let result = interpolate_variables(template, &context);

        assert!(result.contains("def hello(): pass"));
        assert!(result.contains("这是一个空函数"));
        assert!(!result.contains("${user_input}"));
        assert!(!result.contains("${analysis.output}"));
    }

    #[test]
    fn test_interpolate_partial_context() {
        let mut context = HashMap::new();
        context.insert("step1.output".to_string(), "第一步完成".to_string());
        // step2.output 不在上下文中

        let template = "步骤1: ${step1.output}, 步骤2: ${step2.output}";
        let result = interpolate_variables(template, &context);

        assert_eq!(result, "步骤1: 第一步完成, 步骤2: ${step2.output}");
    }

    // ==================== 正则表达式边界测试 ====================

    #[test]
    fn test_interpolate_nested_braces() {
        let mut context = HashMap::new();
        context.insert("var".to_string(), "value".to_string());

        // 嵌套大括号不应该导致问题
        let result = interpolate_variables("{{${var}}}", &context);
        assert_eq!(result, "{{value}}");
    }

    #[test]
    fn test_interpolate_escaped_dollar() {
        let context = HashMap::new();

        // 单独的 $ 符号应保持原样
        let result = interpolate_variables("$ 100", &context);
        assert_eq!(result, "$ 100");
    }

    #[test]
    fn test_interpolate_dollar_without_brace() {
        let context = HashMap::new();

        // ${ 后面没有 } 应保持原样
        let result = interpolate_variables("${incomplete", &context);
        assert_eq!(result, "${incomplete");
    }

    // ==================== 拓扑排序测试 ====================

    // -------------------- 基本功能测试 --------------------

    #[test]
    fn test_topological_sort_empty_steps() {
        let steps: Vec<WorkflowStep> = vec![];
        let result = topological_sort(&steps).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_topological_sort_single_step() {
        let steps = vec![WorkflowStep::new("step1", "步骤一", "提示1", "out1")];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "step1");
    }

    #[test]
    fn test_topological_sort_no_dependencies() {
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2"),
            WorkflowStep::new("step3", "步骤三", "提示3", "out3"),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 3);
        // 无依赖时，顺序可以是任意的，但所有步骤都应该在结果中
        let ids: Vec<&str> = result.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"step1"));
        assert!(ids.contains(&"step2"));
        assert!(ids.contains(&"step3"));
    }

    #[test]
    fn test_topological_sort_linear_chain() {
        // step1 -> step2 -> step3
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("step1"),
            WorkflowStep::new("step3", "步骤三", "提示3", "out3").with_dependency("step2"),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].id, "step1");
        assert_eq!(result[1].id, "step2");
        assert_eq!(result[2].id, "step3");
    }

    #[test]
    fn test_topological_sort_diamond_dependency() {
        //     step1
        //    /     \
        // step2   step3
        //    \     /
        //     step4
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("step1"),
            WorkflowStep::new("step3", "步骤三", "提示3", "out3").with_dependency("step1"),
            WorkflowStep::new("step4", "步骤四", "提示4", "out4")
                .with_dependencies(vec!["step2".to_string(), "step3".to_string()]),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 4);

        // 验证依赖顺序
        let ids: Vec<&str> = result.iter().map(|s| s.id.as_str()).collect();
        let pos_step1 = ids.iter().position(|&id| id == "step1").unwrap();
        let pos_step2 = ids.iter().position(|&id| id == "step2").unwrap();
        let pos_step3 = ids.iter().position(|&id| id == "step3").unwrap();
        let pos_step4 = ids.iter().position(|&id| id == "step4").unwrap();

        // step1 必须在 step2 和 step3 之前
        assert!(pos_step1 < pos_step2);
        assert!(pos_step1 < pos_step3);
        // step2 和 step3 必须在 step4 之前
        assert!(pos_step2 < pos_step4);
        assert!(pos_step3 < pos_step4);
    }

    #[test]
    fn test_topological_sort_multiple_dependencies() {
        // step1, step2 无依赖
        // step3 依赖 step1 和 step2
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2"),
            WorkflowStep::new("step3", "步骤三", "提示3", "out3")
                .with_dependencies(vec!["step1".to_string(), "step2".to_string()]),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 3);

        let ids: Vec<&str> = result.iter().map(|s| s.id.as_str()).collect();
        let pos_step1 = ids.iter().position(|&id| id == "step1").unwrap();
        let pos_step2 = ids.iter().position(|&id| id == "step2").unwrap();
        let pos_step3 = ids.iter().position(|&id| id == "step3").unwrap();

        // step1 和 step2 必须在 step3 之前
        assert!(pos_step1 < pos_step3);
        assert!(pos_step2 < pos_step3);
    }

    #[test]
    fn test_topological_sort_reverse_order_input() {
        // 输入顺序与依赖顺序相反
        let steps = vec![
            WorkflowStep::new("step3", "步骤三", "提示3", "out3").with_dependency("step2"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("step1"),
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].id, "step1");
        assert_eq!(result[1].id, "step2");
        assert_eq!(result[2].id, "step3");
    }

    // -------------------- 循环依赖检测测试 --------------------

    #[test]
    fn test_topological_sort_simple_cycle() {
        // step1 -> step2 -> step1 (循环)
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1").with_dependency("step2"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("step1"),
        ];
        let result = topological_sort(&steps);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_cyclic_dependency());
        assert!(err.message().contains("step1"));
        assert!(err.message().contains("step2"));
    }

    #[test]
    fn test_topological_sort_self_dependency() {
        // step1 依赖自己
        let steps =
            vec![WorkflowStep::new("step1", "步骤一", "提示1", "out1").with_dependency("step1")];
        let result = topological_sort(&steps);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_cyclic_dependency());
        assert!(err.message().contains("step1"));
    }

    #[test]
    fn test_topological_sort_three_step_cycle() {
        // step1 -> step2 -> step3 -> step1 (三步循环)
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1").with_dependency("step3"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("step1"),
            WorkflowStep::new("step3", "步骤三", "提示3", "out3").with_dependency("step2"),
        ];
        let result = topological_sort(&steps);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_cyclic_dependency());
    }

    #[test]
    fn test_topological_sort_partial_cycle() {
        // step1 无依赖
        // step2 -> step3 -> step2 (部分循环)
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("step3"),
            WorkflowStep::new("step3", "步骤三", "提示3", "out3").with_dependency("step2"),
        ];
        let result = topological_sort(&steps);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_cyclic_dependency());
        // step1 不应该在循环中
        // step2 和 step3 应该在循环中
        assert!(err.message().contains("step2"));
        assert!(err.message().contains("step3"));
    }

    // -------------------- 缺失依赖检测测试 --------------------

    #[test]
    fn test_topological_sort_missing_dependency() {
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("nonexistent"),
        ];
        let result = topological_sort(&steps);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_missing_dependency());
        assert!(err.message().contains("step2"));
        assert!(err.message().contains("nonexistent"));
    }

    #[test]
    fn test_topological_sort_multiple_missing_dependencies() {
        let steps = vec![WorkflowStep::new("step1", "步骤一", "提示1", "out1")
            .with_dependencies(vec!["missing1".to_string(), "missing2".to_string()])];
        let result = topological_sort(&steps);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_missing_dependency());
        // 应该报告第一个缺失的依赖
        assert!(err.message().contains("missing1") || err.message().contains("missing2"));
    }

    #[test]
    fn test_topological_sort_typo_in_dependency() {
        // 模拟依赖名称拼写错误
        let steps = vec![
            WorkflowStep::new("analyze", "分析", "分析代码", "analysis"),
            WorkflowStep::new("generate", "生成", "生成代码", "code").with_dependency("analize"), // 拼写错误
        ];
        let result = topological_sort(&steps);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_missing_dependency());
        assert!(err.message().contains("analize"));
    }

    // -------------------- 复杂场景测试 --------------------

    #[test]
    fn test_topological_sort_complex_dag() {
        //       step1
        //      /  |  \
        //   step2 step3 step4
        //      \  |  /
        //       step5
        //         |
        //       step6
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2").with_dependency("step1"),
            WorkflowStep::new("step3", "步骤三", "提示3", "out3").with_dependency("step1"),
            WorkflowStep::new("step4", "步骤四", "提示4", "out4").with_dependency("step1"),
            WorkflowStep::new("step5", "步骤五", "提示5", "out5").with_dependencies(vec![
                "step2".to_string(),
                "step3".to_string(),
                "step4".to_string(),
            ]),
            WorkflowStep::new("step6", "步骤六", "提示6", "out6").with_dependency("step5"),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 6);

        let ids: Vec<&str> = result.iter().map(|s| s.id.as_str()).collect();

        // 验证所有依赖关系
        let pos = |id: &str| ids.iter().position(|&x| x == id).unwrap();

        assert!(pos("step1") < pos("step2"));
        assert!(pos("step1") < pos("step3"));
        assert!(pos("step1") < pos("step4"));
        assert!(pos("step2") < pos("step5"));
        assert!(pos("step3") < pos("step5"));
        assert!(pos("step4") < pos("step5"));
        assert!(pos("step5") < pos("step6"));
    }

    #[test]
    fn test_topological_sort_two_independent_chains() {
        // 两条独立的链
        // chain1: a -> b -> c
        // chain2: x -> y -> z
        let steps = vec![
            WorkflowStep::new("a", "A", "提示A", "outA"),
            WorkflowStep::new("b", "B", "提示B", "outB").with_dependency("a"),
            WorkflowStep::new("c", "C", "提示C", "outC").with_dependency("b"),
            WorkflowStep::new("x", "X", "提示X", "outX"),
            WorkflowStep::new("y", "Y", "提示Y", "outY").with_dependency("x"),
            WorkflowStep::new("z", "Z", "提示Z", "outZ").with_dependency("y"),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 6);

        let ids: Vec<&str> = result.iter().map(|s| s.id.as_str()).collect();
        let pos = |id: &str| ids.iter().position(|&x| x == id).unwrap();

        // 验证链内顺序
        assert!(pos("a") < pos("b"));
        assert!(pos("b") < pos("c"));
        assert!(pos("x") < pos("y"));
        assert!(pos("y") < pos("z"));
    }

    #[test]
    fn test_topological_sort_preserves_step_data() {
        let steps = vec![
            WorkflowStep::new("step1", "第一步", "处理 ${user_input}", "result1"),
            WorkflowStep::new("step2", "第二步", "继续 ${result1}", "result2")
                .with_dependency("step1"),
        ];
        let result = topological_sort(&steps).unwrap();

        // 验证步骤数据完整性
        assert_eq!(result[0].name, "第一步");
        assert_eq!(result[0].prompt, "处理 ${user_input}");
        assert_eq!(result[0].output, "result1");

        assert_eq!(result[1].name, "第二步");
        assert_eq!(result[1].prompt, "继续 ${result1}");
        assert_eq!(result[1].output, "result2");
        assert_eq!(result[1].dependencies, vec!["step1"]);
    }

    // -------------------- 边界情况测试 --------------------

    #[test]
    fn test_topological_sort_many_steps() {
        // 测试大量步骤的线性链
        let mut steps = Vec::new();
        for i in 0..100 {
            let mut step = WorkflowStep::new(
                format!("step{}", i),
                format!("步骤{}", i),
                format!("提示{}", i),
                format!("out{}", i),
            );
            if i > 0 {
                step = step.with_dependency(format!("step{}", i - 1));
            }
            steps.push(step);
        }

        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 100);

        // 验证顺序
        for (i, step) in result.iter().enumerate().take(100) {
            assert_eq!(step.id, format!("step{}", i));
        }
    }

    #[test]
    fn test_topological_sort_unicode_step_ids() {
        let steps = vec![
            WorkflowStep::new("分析", "分析步骤", "分析代码", "分析结果"),
            WorkflowStep::new("生成", "生成步骤", "生成代码", "生成结果").with_dependency("分析"),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "分析");
        assert_eq!(result[1].id, "生成");
    }

    #[test]
    fn test_topological_sort_duplicate_dependencies() {
        // 步骤有重复的依赖（虽然不常见，但应该能处理）
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2")
                .with_dependencies(vec!["step1".to_string(), "step1".to_string()]),
        ];
        let result = topological_sort(&steps).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "step1");
        assert_eq!(result[1].id, "step2");
    }
}
