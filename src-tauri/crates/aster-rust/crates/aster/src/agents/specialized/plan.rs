//! Plan Agent
//!
//! Specialized agent for implementation planning with
//! requirements analysis, risk assessment, and step generation.
//!
//! This module implements Requirements 14.1-14.7 from the design document.
//! Key feature: operates in read-only mode without modifying files.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

use super::{ExploreAgent, ExploreOptions, ThoroughnessLevel};

/// Result type alias for plan operations
pub type PlanResult<T> = Result<T, PlanError>;

/// Error types for plan operations
#[derive(Debug, Error)]
pub enum PlanError {
    /// Invalid task
    #[error("Invalid task: {0}")]
    InvalidTask(String),

    /// File not found
    #[error("File not found: {0}")]
    FileNotFound(String),

    /// Analysis error
    #[error("Analysis error: {0}")]
    AnalysisError(String),

    /// I/O error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Explore error
    #[error("Explore error: {0}")]
    ExploreError(String),
}

/// Complexity level for implementation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Complexity {
    /// Trivial - simple changes, minimal risk
    Trivial,

    /// Low - straightforward implementation
    Low,

    /// Medium - moderate complexity
    #[default]
    Medium,

    /// High - complex implementation with multiple components
    High,

    /// Very High - significant architectural changes
    VeryHigh,
}

impl Complexity {
    /// Get estimated hours multiplier
    pub fn hours_multiplier(&self) -> f32 {
        match self {
            Complexity::Trivial => 0.5,
            Complexity::Low => 1.0,
            Complexity::Medium => 2.0,
            Complexity::High => 4.0,
            Complexity::VeryHigh => 8.0,
        }
    }

    /// Get description
    pub fn description(&self) -> &'static str {
        match self {
            Complexity::Trivial => "Simple changes with minimal risk",
            Complexity::Low => "Straightforward implementation",
            Complexity::Medium => "Moderate complexity with some considerations",
            Complexity::High => "Complex implementation with multiple components",
            Complexity::VeryHigh => "Significant architectural changes required",
        }
    }
}

/// Risk severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RiskSeverity {
    /// Low risk - minimal impact if occurs
    Low,

    /// Medium risk - moderate impact
    #[default]
    Medium,

    /// High risk - significant impact
    High,

    /// Critical risk - severe impact, must be addressed
    Critical,
}

/// Risk category
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RiskCategory {
    /// Technical risk - implementation challenges
    #[default]
    Technical,

    /// Security risk - potential vulnerabilities
    Security,

    /// Performance risk - potential performance issues
    Performance,

    /// Compatibility risk - breaking changes
    Compatibility,

    /// Dependency risk - external dependency issues
    Dependency,

    /// Testing risk - testing challenges
    Testing,

    /// Other risk
    Other(String),
}

/// A risk identified during planning
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Risk {
    /// Risk identifier
    pub id: String,

    /// Risk description
    pub description: String,

    /// Risk category
    pub category: RiskCategory,

    /// Risk severity
    pub severity: RiskSeverity,

    /// Likelihood (0.0 - 1.0)
    pub likelihood: f32,

    /// Impact description
    pub impact: String,

    /// Mitigation strategies
    pub mitigation: Vec<String>,

    /// Related files
    pub related_files: Vec<PathBuf>,
}

impl Risk {
    /// Create a new risk
    pub fn new(
        id: impl Into<String>,
        description: impl Into<String>,
        category: RiskCategory,
        severity: RiskSeverity,
    ) -> Self {
        Self {
            id: id.into(),
            description: description.into(),
            category,
            severity,
            likelihood: 0.5,
            impact: String::new(),
            mitigation: Vec::new(),
            related_files: Vec::new(),
        }
    }

    /// Set likelihood
    pub fn with_likelihood(mut self, likelihood: f32) -> Self {
        self.likelihood = likelihood.clamp(0.0, 1.0);
        self
    }

    /// Set impact
    pub fn with_impact(mut self, impact: impl Into<String>) -> Self {
        self.impact = impact.into();
        self
    }

    /// Add mitigation strategy
    pub fn with_mitigation(mut self, mitigation: Vec<String>) -> Self {
        self.mitigation = mitigation;
        self
    }

    /// Add related files
    pub fn with_related_files(mut self, files: Vec<PathBuf>) -> Self {
        self.related_files = files;
        self
    }
}

/// A critical file identified for implementation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CriticalFile {
    /// File path
    pub path: PathBuf,

    /// Reason why this file is critical
    pub reason: String,

    /// Type of modification needed
    pub modification_type: ModificationType,

    /// Priority (1-10, higher is more important)
    pub priority: u8,

    /// Dependencies on other files
    pub dependencies: Vec<PathBuf>,

    /// Estimated lines of change
    pub estimated_changes: Option<usize>,
}

impl CriticalFile {
    /// Create a new critical file
    pub fn new(
        path: impl Into<PathBuf>,
        reason: impl Into<String>,
        modification_type: ModificationType,
    ) -> Self {
        Self {
            path: path.into(),
            reason: reason.into(),
            modification_type,
            priority: 5,
            dependencies: Vec::new(),
            estimated_changes: None,
        }
    }

    /// Set priority
    pub fn with_priority(mut self, priority: u8) -> Self {
        self.priority = priority.min(10);
        self
    }

    /// Set dependencies
    pub fn with_dependencies(mut self, deps: Vec<PathBuf>) -> Self {
        self.dependencies = deps;
        self
    }

    /// Set estimated changes
    pub fn with_estimated_changes(mut self, changes: usize) -> Self {
        self.estimated_changes = Some(changes);
        self
    }
}

/// Type of modification needed for a file
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ModificationType {
    /// Create new file
    Create,

    /// Modify existing file
    #[default]
    Modify,

    /// Delete file
    Delete,

    /// Rename file
    Rename,

    /// Review only (no changes)
    Review,
}

/// An implementation step in the plan
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    /// Step number
    pub step_number: usize,

    /// Step title
    pub title: String,

    /// Detailed description
    pub description: String,

    /// Files involved
    pub files: Vec<PathBuf>,

    /// Dependencies on other steps (by step number)
    pub dependencies: Vec<usize>,

    /// Estimated duration in hours
    pub estimated_hours: Option<f32>,

    /// Whether this step is optional
    pub optional: bool,

    /// Verification criteria
    pub verification: Vec<String>,
}

impl PlanStep {
    /// Create a new plan step
    pub fn new(
        step_number: usize,
        title: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            step_number,
            title: title.into(),
            description: description.into(),
            files: Vec::new(),
            dependencies: Vec::new(),
            estimated_hours: None,
            optional: false,
            verification: Vec::new(),
        }
    }

    /// Add files
    pub fn with_files(mut self, files: Vec<PathBuf>) -> Self {
        self.files = files;
        self
    }

    /// Add dependencies
    pub fn with_dependencies(mut self, deps: Vec<usize>) -> Self {
        self.dependencies = deps;
        self
    }

    /// Set estimated hours
    pub fn with_estimated_hours(mut self, hours: f32) -> Self {
        self.estimated_hours = Some(hours);
        self
    }

    /// Mark as optional
    pub fn as_optional(mut self) -> Self {
        self.optional = true;
        self
    }

    /// Add verification criteria
    pub fn with_verification(mut self, criteria: Vec<String>) -> Self {
        self.verification = criteria;
        self
    }
}

/// An alternative implementation approach
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Alternative {
    /// Alternative identifier
    pub id: String,

    /// Alternative name
    pub name: String,

    /// Description of the approach
    pub description: String,

    /// Pros of this approach
    pub pros: Vec<String>,

    /// Cons of this approach
    pub cons: Vec<String>,

    /// Estimated complexity
    pub complexity: Complexity,

    /// Estimated hours
    pub estimated_hours: Option<f32>,

    /// Whether this is the recommended approach
    pub recommended: bool,
}

impl Alternative {
    /// Create a new alternative
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: description.into(),
            pros: Vec::new(),
            cons: Vec::new(),
            complexity: Complexity::Medium,
            estimated_hours: None,
            recommended: false,
        }
    }

    /// Add pros
    pub fn with_pros(mut self, pros: Vec<String>) -> Self {
        self.pros = pros;
        self
    }

    /// Add cons
    pub fn with_cons(mut self, cons: Vec<String>) -> Self {
        self.cons = cons;
        self
    }

    /// Set complexity
    pub fn with_complexity(mut self, complexity: Complexity) -> Self {
        self.complexity = complexity;
        self
    }

    /// Set estimated hours
    pub fn with_estimated_hours(mut self, hours: f32) -> Self {
        self.estimated_hours = Some(hours);
        self
    }

    /// Mark as recommended
    pub fn as_recommended(mut self) -> Self {
        self.recommended = true;
        self
    }
}

/// An architectural decision
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchitecturalDecision {
    /// Decision identifier
    pub id: String,

    /// Decision title
    pub title: String,

    /// Context/background
    pub context: String,

    /// The decision made
    pub decision: String,

    /// Rationale for the decision
    pub rationale: String,

    /// Consequences of the decision
    pub consequences: Vec<String>,

    /// Related decisions
    pub related_decisions: Vec<String>,
}

impl ArchitecturalDecision {
    /// Create a new architectural decision
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        decision: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            context: String::new(),
            decision: decision.into(),
            rationale: String::new(),
            consequences: Vec::new(),
            related_decisions: Vec::new(),
        }
    }

    /// Set context
    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = context.into();
        self
    }

    /// Set rationale
    pub fn with_rationale(mut self, rationale: impl Into<String>) -> Self {
        self.rationale = rationale.into();
        self
    }

    /// Add consequences
    pub fn with_consequences(mut self, consequences: Vec<String>) -> Self {
        self.consequences = consequences;
        self
    }

    /// Add related decisions
    pub fn with_related_decisions(mut self, related: Vec<String>) -> Self {
        self.related_decisions = related;
        self
    }
}

/// Requirements analysis result
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequirementsAnalysis {
    /// Original task/requirements
    pub original_task: String,

    /// Parsed functional requirements
    pub functional_requirements: Vec<String>,

    /// Parsed non-functional requirements
    pub non_functional_requirements: Vec<String>,

    /// Assumptions made
    pub assumptions: Vec<String>,

    /// Questions/clarifications needed
    pub questions: Vec<String>,

    /// Scope boundaries
    pub scope: ScopeDefinition,
}

impl RequirementsAnalysis {
    /// Create a new requirements analysis
    pub fn new(task: impl Into<String>) -> Self {
        Self {
            original_task: task.into(),
            ..Default::default()
        }
    }

    /// Add functional requirements
    pub fn with_functional_requirements(mut self, reqs: Vec<String>) -> Self {
        self.functional_requirements = reqs;
        self
    }

    /// Add non-functional requirements
    pub fn with_non_functional_requirements(mut self, reqs: Vec<String>) -> Self {
        self.non_functional_requirements = reqs;
        self
    }

    /// Add assumptions
    pub fn with_assumptions(mut self, assumptions: Vec<String>) -> Self {
        self.assumptions = assumptions;
        self
    }

    /// Add questions
    pub fn with_questions(mut self, questions: Vec<String>) -> Self {
        self.questions = questions;
        self
    }

    /// Set scope
    pub fn with_scope(mut self, scope: ScopeDefinition) -> Self {
        self.scope = scope;
        self
    }
}

/// Scope definition for the implementation
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopeDefinition {
    /// What is included in scope
    pub in_scope: Vec<String>,

    /// What is explicitly out of scope
    pub out_of_scope: Vec<String>,

    /// Future considerations
    pub future_considerations: Vec<String>,
}

impl ScopeDefinition {
    /// Create a new scope definition
    pub fn new() -> Self {
        Self::default()
    }

    /// Set in-scope items
    pub fn with_in_scope(mut self, items: Vec<String>) -> Self {
        self.in_scope = items;
        self
    }

    /// Set out-of-scope items
    pub fn with_out_of_scope(mut self, items: Vec<String>) -> Self {
        self.out_of_scope = items;
        self
    }

    /// Set future considerations
    pub fn with_future_considerations(mut self, items: Vec<String>) -> Self {
        self.future_considerations = items;
        self
    }
}

/// Options for plan operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanOptions {
    /// The task or feature to plan
    pub task: String,

    /// Additional context for planning
    pub context: Option<String>,

    /// Constraints to consider
    pub constraints: Option<Vec<String>>,

    /// Existing code paths to consider
    pub existing_code: Option<Vec<PathBuf>>,

    /// Perspective for planning (e.g., "security", "performance")
    pub perspective: Option<String>,

    /// Thoroughness level for analysis
    pub thoroughness: ThoroughnessLevel,

    /// Working directory (for read-only file access)
    pub working_directory: Option<PathBuf>,
}

impl Default for PlanOptions {
    fn default() -> Self {
        Self {
            task: String::new(),
            context: None,
            constraints: None,
            existing_code: None,
            perspective: None,
            thoroughness: ThoroughnessLevel::Medium,
            working_directory: None,
        }
    }
}

impl PlanOptions {
    /// Create new plan options with a task
    pub fn new(task: impl Into<String>) -> Self {
        Self {
            task: task.into(),
            ..Default::default()
        }
    }

    /// Set additional context
    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }

    /// Set constraints
    pub fn with_constraints(mut self, constraints: Vec<String>) -> Self {
        self.constraints = Some(constraints);
        self
    }

    /// Set existing code paths
    pub fn with_existing_code(mut self, paths: Vec<PathBuf>) -> Self {
        self.existing_code = Some(paths);
        self
    }

    /// Set perspective
    pub fn with_perspective(mut self, perspective: impl Into<String>) -> Self {
        self.perspective = Some(perspective.into());
        self
    }

    /// Set thoroughness level
    pub fn with_thoroughness(mut self, level: ThoroughnessLevel) -> Self {
        self.thoroughness = level;
        self
    }

    /// Set working directory
    pub fn with_working_directory(mut self, dir: impl Into<PathBuf>) -> Self {
        self.working_directory = Some(dir.into());
        self
    }
}

/// Result of a planning operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResultData {
    /// Summary of the plan
    pub summary: String,

    /// Requirements analysis
    pub requirements_analysis: RequirementsAnalysis,

    /// Architectural decisions
    pub architectural_decisions: Vec<ArchitecturalDecision>,

    /// Implementation steps
    pub steps: Vec<PlanStep>,

    /// Critical files identified
    pub critical_files: Vec<CriticalFile>,

    /// Identified risks
    pub risks: Vec<Risk>,

    /// Alternative approaches
    pub alternatives: Vec<Alternative>,

    /// Estimated complexity
    pub estimated_complexity: Complexity,

    /// Estimated hours for implementation
    pub estimated_hours: Option<f32>,

    /// Additional recommendations
    pub recommendations: Option<Vec<String>>,
}

impl Default for PlanResultData {
    fn default() -> Self {
        Self {
            summary: String::new(),
            requirements_analysis: RequirementsAnalysis::default(),
            architectural_decisions: Vec::new(),
            steps: Vec::new(),
            critical_files: Vec::new(),
            risks: Vec::new(),
            alternatives: Vec::new(),
            estimated_complexity: Complexity::Medium,
            estimated_hours: None,
            recommendations: None,
        }
    }
}

impl PlanResultData {
    /// Create a new plan result
    pub fn new() -> Self {
        Self::default()
    }

    /// Set summary
    pub fn with_summary(mut self, summary: impl Into<String>) -> Self {
        self.summary = summary.into();
        self
    }

    /// Set requirements analysis
    pub fn with_requirements_analysis(mut self, analysis: RequirementsAnalysis) -> Self {
        self.requirements_analysis = analysis;
        self
    }

    /// Set architectural decisions
    pub fn with_architectural_decisions(mut self, decisions: Vec<ArchitecturalDecision>) -> Self {
        self.architectural_decisions = decisions;
        self
    }

    /// Set implementation steps
    pub fn with_steps(mut self, steps: Vec<PlanStep>) -> Self {
        self.steps = steps;
        self
    }

    /// Set critical files
    pub fn with_critical_files(mut self, files: Vec<CriticalFile>) -> Self {
        self.critical_files = files;
        self
    }

    /// Set risks
    pub fn with_risks(mut self, risks: Vec<Risk>) -> Self {
        self.risks = risks;
        self
    }

    /// Set alternatives
    pub fn with_alternatives(mut self, alternatives: Vec<Alternative>) -> Self {
        self.alternatives = alternatives;
        self
    }

    /// Set estimated complexity
    pub fn with_estimated_complexity(mut self, complexity: Complexity) -> Self {
        self.estimated_complexity = complexity;
        self
    }

    /// Set estimated hours
    pub fn with_estimated_hours(mut self, hours: f32) -> Self {
        self.estimated_hours = Some(hours);
        self
    }

    /// Set recommendations
    pub fn with_recommendations(mut self, recommendations: Vec<String>) -> Self {
        self.recommendations = Some(recommendations);
        self
    }

    /// Calculate total estimated hours from steps
    pub fn calculate_total_hours(&self) -> f32 {
        self.steps.iter().filter_map(|s| s.estimated_hours).sum()
    }
}

/// Plan Agent for implementation planning
///
/// Provides functionality for:
/// - Requirements analysis
/// - Risk assessment
/// - Implementation step generation
/// - Alternative approach generation
///
/// IMPORTANT: This agent operates in READ-ONLY mode.
/// It does not modify any files in the target directory.
pub struct PlanAgent {
    options: PlanOptions,
    /// Track files that were read (for verification)
    files_read: std::cell::RefCell<Vec<PathBuf>>,
}

impl PlanAgent {
    /// Create a new plan agent with options
    pub fn new(options: PlanOptions) -> Self {
        Self {
            options,
            files_read: std::cell::RefCell::new(Vec::new()),
        }
    }

    /// Get the options
    pub fn options(&self) -> &PlanOptions {
        &self.options
    }

    /// Get the effective working directory
    fn working_directory(&self) -> PathBuf {
        self.options
            .working_directory
            .clone()
            .unwrap_or_else(|| PathBuf::from("."))
    }

    /// Get list of files that were read (for testing read-only mode)
    pub fn files_read(&self) -> Vec<PathBuf> {
        self.files_read.borrow().clone()
    }

    /// Record a file read operation
    fn record_file_read(&self, path: &Path) {
        self.files_read.borrow_mut().push(path.to_path_buf());
    }

    /// Read file content (read-only operation)
    fn read_file_content(&self, path: &Path) -> PlanResult<String> {
        if !path.exists() {
            return Err(PlanError::FileNotFound(path.display().to_string()));
        }
        self.record_file_read(path);
        std::fs::read_to_string(path).map_err(PlanError::from)
    }

    /// Create a comprehensive implementation plan
    pub async fn create_plan(&self) -> PlanResult<PlanResultData> {
        if self.options.task.trim().is_empty() {
            return Err(PlanError::InvalidTask("Task cannot be empty".to_string()));
        }

        // Analyze requirements
        let requirements_analysis = self.analyze_requirements().await?;

        // Identify critical files
        let critical_files = self.identify_files().await?;

        // Assess risks
        let risks = self.assess_risks().await?;

        // Generate alternatives
        let alternatives = self.generate_alternatives().await?;

        // Generate implementation steps
        let steps = self.generate_steps(&critical_files, &risks);

        // Calculate complexity and time estimates
        let estimated_complexity = self.estimate_complexity(&critical_files, &risks);
        let estimated_hours = self.estimate_hours(&steps, &estimated_complexity);

        // Generate architectural decisions
        let architectural_decisions = self.generate_architectural_decisions(&requirements_analysis);

        // Generate summary
        let summary = self.generate_summary(
            &requirements_analysis,
            &critical_files,
            &risks,
            &estimated_complexity,
        );

        // Generate recommendations
        let recommendations = self.generate_recommendations(&risks, &alternatives);

        Ok(PlanResultData::new()
            .with_summary(summary)
            .with_requirements_analysis(requirements_analysis)
            .with_architectural_decisions(architectural_decisions)
            .with_steps(steps)
            .with_critical_files(critical_files)
            .with_risks(risks)
            .with_alternatives(alternatives)
            .with_estimated_complexity(estimated_complexity)
            .with_estimated_hours(estimated_hours)
            .with_recommendations(recommendations))
    }

    /// Analyze requirements from the task description
    pub async fn analyze_requirements(&self) -> PlanResult<RequirementsAnalysis> {
        let task = &self.options.task;

        // Parse functional requirements from task
        let functional_requirements = self.extract_functional_requirements(task);

        // Parse non-functional requirements
        let non_functional_requirements = self.extract_non_functional_requirements(task);

        // Generate assumptions
        let assumptions = self.generate_assumptions(task);

        // Generate questions
        let questions = self.generate_questions(task);

        // Define scope
        let scope = self.define_scope(task);

        Ok(RequirementsAnalysis::new(task)
            .with_functional_requirements(functional_requirements)
            .with_non_functional_requirements(non_functional_requirements)
            .with_assumptions(assumptions)
            .with_questions(questions)
            .with_scope(scope))
    }

    /// Extract functional requirements from task description
    fn extract_functional_requirements(&self, task: &str) -> Vec<String> {
        let mut requirements = Vec::new();
        let task_lower = task.to_lowercase();

        // Look for action verbs that indicate functional requirements
        let action_patterns = [
            ("implement", "Implement"),
            ("create", "Create"),
            ("add", "Add"),
            ("build", "Build"),
            ("develop", "Develop"),
            ("support", "Support"),
            ("enable", "Enable"),
            ("allow", "Allow"),
            ("provide", "Provide"),
        ];

        for (pattern, prefix) in action_patterns {
            if task_lower.contains(pattern) {
                requirements.push(format!("{} the requested functionality", prefix));
                break;
            }
        }

        // Add the main task as a requirement
        if requirements.is_empty() {
            requirements.push(format!("Complete: {}", task));
        }

        // Add context-based requirements
        if let Some(context) = &self.options.context {
            requirements.push(format!("Consider context: {}", context));
        }

        requirements
    }

    /// Extract non-functional requirements
    fn extract_non_functional_requirements(&self, task: &str) -> Vec<String> {
        let mut requirements = Vec::new();
        let task_lower = task.to_lowercase();

        // Check for performance requirements
        if task_lower.contains("fast")
            || task_lower.contains("performance")
            || task_lower.contains("efficient")
        {
            requirements.push("Ensure optimal performance".to_string());
        }

        // Check for security requirements
        if task_lower.contains("secure")
            || task_lower.contains("security")
            || task_lower.contains("auth")
        {
            requirements.push("Implement security best practices".to_string());
        }

        // Check for scalability requirements
        if task_lower.contains("scale") || task_lower.contains("scalable") {
            requirements.push("Design for scalability".to_string());
        }

        // Check for testing requirements
        if task_lower.contains("test") || task_lower.contains("testing") {
            requirements.push("Include comprehensive tests".to_string());
        }

        // Add perspective-based requirements
        if let Some(perspective) = &self.options.perspective {
            requirements.push(format!("Focus on {} aspects", perspective));
        }

        // Add constraint-based requirements
        if let Some(constraints) = &self.options.constraints {
            for constraint in constraints {
                requirements.push(format!("Constraint: {}", constraint));
            }
        }

        requirements
    }

    /// Generate assumptions based on task
    fn generate_assumptions(&self, task: &str) -> Vec<String> {
        let mut assumptions = Vec::new();

        // Basic assumptions
        assumptions.push("Existing codebase follows established patterns".to_string());
        assumptions.push("Required dependencies are available".to_string());

        // Task-specific assumptions
        if task.to_lowercase().contains("api") {
            assumptions.push("API follows RESTful conventions".to_string());
        }

        if task.to_lowercase().contains("database") || task.to_lowercase().contains("db") {
            assumptions.push("Database schema can be modified if needed".to_string());
        }

        assumptions
    }

    /// Generate questions for clarification
    fn generate_questions(&self, task: &str) -> Vec<String> {
        let mut questions = Vec::new();

        // Generic questions based on thoroughness
        match self.options.thoroughness {
            ThoroughnessLevel::VeryThorough => {
                questions.push("What are the expected performance requirements?".to_string());
                questions.push("Are there any specific security considerations?".to_string());
                questions.push("What is the expected timeline for completion?".to_string());
            }
            ThoroughnessLevel::Medium => {
                questions.push("Are there any specific constraints to consider?".to_string());
            }
            ThoroughnessLevel::Quick => {}
        }

        // Task-specific questions
        if task.to_lowercase().contains("integration") {
            questions.push("What external systems need to be integrated?".to_string());
        }

        questions
    }

    /// Define scope boundaries
    fn define_scope(&self, task: &str) -> ScopeDefinition {
        let mut in_scope = vec![task.to_string()];
        let mut out_of_scope = Vec::new();
        let mut future_considerations = Vec::new();

        // Add context to scope
        if let Some(context) = &self.options.context {
            in_scope.push(context.clone());
        }

        // Common out-of-scope items
        out_of_scope.push("Major architectural changes unless required".to_string());
        out_of_scope.push("Unrelated feature modifications".to_string());

        // Future considerations
        future_considerations.push("Performance optimization opportunities".to_string());
        future_considerations.push("Additional feature enhancements".to_string());

        ScopeDefinition::new()
            .with_in_scope(in_scope)
            .with_out_of_scope(out_of_scope)
            .with_future_considerations(future_considerations)
    }
}

impl PlanAgent {
    /// Identify critical files for implementation
    pub async fn identify_files(&self) -> PlanResult<Vec<CriticalFile>> {
        let mut critical_files = Vec::new();
        let working_dir = self.working_directory();

        // If existing code paths are provided, analyze them
        if let Some(existing_paths) = &self.options.existing_code {
            for path in existing_paths {
                let full_path = if path.is_absolute() {
                    path.clone()
                } else {
                    working_dir.join(path)
                };

                if full_path.exists() {
                    // Read file to analyze (read-only)
                    if let Ok(_content) = self.read_file_content(&full_path) {
                        let file = CriticalFile::new(
                            path.clone(),
                            "Specified in existing code paths",
                            ModificationType::Modify,
                        )
                        .with_priority(8);
                        critical_files.push(file);
                    }
                }
            }
        }

        // Use explore agent to find relevant files based on task keywords
        let keywords = self.extract_keywords(&self.options.task);
        if !keywords.is_empty() && working_dir.exists() {
            let explore_options = ExploreOptions::new(keywords.join(" "))
                .with_target_path(&working_dir)
                .with_thoroughness(self.options.thoroughness)
                .with_max_results(self.options.thoroughness.max_files() / 4);

            let explore_agent = ExploreAgent::new(explore_options);
            if let Ok(result) = explore_agent.explore().await {
                for file_path in result.files.iter().take(10) {
                    // Record that we read this file
                    self.record_file_read(file_path);

                    let file = CriticalFile::new(
                        file_path.clone(),
                        "Found via keyword search",
                        ModificationType::Review,
                    )
                    .with_priority(5);

                    // Avoid duplicates
                    if !critical_files.iter().any(|f| f.path == file.path) {
                        critical_files.push(file);
                    }
                }
            }
        }

        // Sort by priority
        critical_files.sort_by(|a, b| b.priority.cmp(&a.priority));

        Ok(critical_files)
    }

    /// Extract keywords from task description
    fn extract_keywords(&self, task: &str) -> Vec<String> {
        let stop_words = [
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has",
            "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must",
            "shall", "can", "need", "to", "of", "in", "for", "on", "with", "at", "by", "from",
            "as", "into", "through", "and", "or", "but", "if", "then", "else", "when", "where",
            "why", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some",
            "such", "no", "not", "only", "own", "same", "so", "than", "too", "very", "just",
            "also", "now", "here", "there", "this", "that", "these", "those",
        ];

        task.split_whitespace()
            .map(|w| w.to_lowercase())
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
            .filter(|w| w.len() > 2 && !stop_words.contains(&w.as_str()))
            .take(5)
            .collect()
    }

    /// Assess risks for the implementation
    pub async fn assess_risks(&self) -> PlanResult<Vec<Risk>> {
        let mut risks = Vec::new();
        let task_lower = self.options.task.to_lowercase();

        // Technical risks
        if task_lower.contains("refactor") || task_lower.contains("rewrite") {
            risks.push(
                Risk::new(
                    "R001",
                    "Refactoring may introduce regressions",
                    RiskCategory::Technical,
                    RiskSeverity::Medium,
                )
                .with_likelihood(0.4)
                .with_impact("Existing functionality may break")
                .with_mitigation(vec![
                    "Write comprehensive tests before refactoring".to_string(),
                    "Refactor in small, incremental steps".to_string(),
                    "Use feature flags for gradual rollout".to_string(),
                ]),
            );
        }

        // Security risks
        if task_lower.contains("auth")
            || task_lower.contains("security")
            || task_lower.contains("password")
        {
            risks.push(
                Risk::new(
                    "R002",
                    "Security implementation may have vulnerabilities",
                    RiskCategory::Security,
                    RiskSeverity::High,
                )
                .with_likelihood(0.3)
                .with_impact("Potential security breach")
                .with_mitigation(vec![
                    "Follow security best practices".to_string(),
                    "Conduct security review".to_string(),
                    "Use established security libraries".to_string(),
                ]),
            );
        }

        // Performance risks
        if task_lower.contains("performance")
            || task_lower.contains("optimize")
            || task_lower.contains("scale")
        {
            risks.push(
                Risk::new(
                    "R003",
                    "Performance improvements may not meet targets",
                    RiskCategory::Performance,
                    RiskSeverity::Medium,
                )
                .with_likelihood(0.3)
                .with_impact("System may not meet performance requirements")
                .with_mitigation(vec![
                    "Establish baseline metrics".to_string(),
                    "Profile before and after changes".to_string(),
                    "Set clear performance targets".to_string(),
                ]),
            );
        }

        // Compatibility risks
        if task_lower.contains("api")
            || task_lower.contains("interface")
            || task_lower.contains("breaking")
        {
            risks.push(
                Risk::new(
                    "R004",
                    "API changes may break existing clients",
                    RiskCategory::Compatibility,
                    RiskSeverity::High,
                )
                .with_likelihood(0.4)
                .with_impact("Existing integrations may fail")
                .with_mitigation(vec![
                    "Version the API".to_string(),
                    "Provide migration guide".to_string(),
                    "Maintain backward compatibility where possible".to_string(),
                ]),
            );
        }

        // Dependency risks
        if task_lower.contains("dependency")
            || task_lower.contains("upgrade")
            || task_lower.contains("library")
        {
            risks.push(
                Risk::new(
                    "R005",
                    "Dependency changes may cause conflicts",
                    RiskCategory::Dependency,
                    RiskSeverity::Medium,
                )
                .with_likelihood(0.3)
                .with_impact("Build or runtime failures")
                .with_mitigation(vec![
                    "Test dependency updates in isolation".to_string(),
                    "Review changelogs for breaking changes".to_string(),
                    "Pin dependency versions".to_string(),
                ]),
            );
        }

        // Testing risks
        if task_lower.contains("test") || task_lower.contains("coverage") {
            risks.push(
                Risk::new(
                    "R006",
                    "Test coverage may be insufficient",
                    RiskCategory::Testing,
                    RiskSeverity::Low,
                )
                .with_likelihood(0.2)
                .with_impact("Bugs may go undetected")
                .with_mitigation(vec![
                    "Set coverage targets".to_string(),
                    "Include edge cases in tests".to_string(),
                    "Use property-based testing".to_string(),
                ]),
            );
        }

        // Add a general risk if no specific risks identified
        if risks.is_empty() {
            risks.push(
                Risk::new(
                    "R000",
                    "General implementation risk",
                    RiskCategory::Technical,
                    RiskSeverity::Low,
                )
                .with_likelihood(0.2)
                .with_impact("Minor issues during implementation")
                .with_mitigation(vec![
                    "Follow coding standards".to_string(),
                    "Review code before merging".to_string(),
                ]),
            );
        }

        // Sort by severity
        risks.sort_by(|a, b| {
            let severity_order = |s: &RiskSeverity| match s {
                RiskSeverity::Critical => 0,
                RiskSeverity::High => 1,
                RiskSeverity::Medium => 2,
                RiskSeverity::Low => 3,
            };
            severity_order(&a.severity).cmp(&severity_order(&b.severity))
        });

        Ok(risks)
    }
}

impl PlanAgent {
    /// Generate alternative implementation approaches
    pub async fn generate_alternatives(&self) -> PlanResult<Vec<Alternative>> {
        let mut alternatives = Vec::new();
        let task_lower = self.options.task.to_lowercase();

        // Standard approach
        let standard = Alternative::new(
            "ALT001",
            "Standard Implementation",
            "Implement the feature using conventional patterns and practices",
        )
        .with_pros(vec![
            "Well-understood approach".to_string(),
            "Easier to maintain".to_string(),
            "Lower risk".to_string(),
        ])
        .with_cons(vec![
            "May not be optimal for all cases".to_string(),
            "Could be slower to implement".to_string(),
        ])
        .with_complexity(Complexity::Medium)
        .as_recommended();

        alternatives.push(standard);

        // Incremental approach
        if task_lower.contains("refactor")
            || task_lower.contains("migrate")
            || task_lower.contains("upgrade")
        {
            let incremental = Alternative::new(
                "ALT002",
                "Incremental Migration",
                "Implement changes gradually with feature flags and parallel systems",
            )
            .with_pros(vec![
                "Lower risk of breaking changes".to_string(),
                "Easier rollback".to_string(),
                "Can validate at each step".to_string(),
            ])
            .with_cons(vec![
                "Takes longer to complete".to_string(),
                "Temporary complexity during transition".to_string(),
            ])
            .with_complexity(Complexity::High);

            alternatives.push(incremental);
        }

        // Performance-focused approach
        if task_lower.contains("performance")
            || task_lower.contains("optimize")
            || task_lower.contains("fast")
        {
            let performance = Alternative::new(
                "ALT003",
                "Performance-Optimized",
                "Focus on performance from the start with optimized data structures and algorithms",
            )
            .with_pros(vec![
                "Better performance outcomes".to_string(),
                "Scalable from the start".to_string(),
            ])
            .with_cons(vec![
                "More complex implementation".to_string(),
                "May be premature optimization".to_string(),
            ])
            .with_complexity(Complexity::High);

            alternatives.push(performance);
        }

        // Minimal viable approach
        let minimal = Alternative::new(
            "ALT004",
            "Minimal Viable Implementation",
            "Implement only the core functionality with minimal features",
        )
        .with_pros(vec![
            "Fastest to implement".to_string(),
            "Lower initial complexity".to_string(),
            "Quick feedback loop".to_string(),
        ])
        .with_cons(vec![
            "May need significant expansion later".to_string(),
            "Could accumulate technical debt".to_string(),
        ])
        .with_complexity(Complexity::Low);

        alternatives.push(minimal);

        Ok(alternatives)
    }

    /// Generate implementation steps
    fn generate_steps(&self, critical_files: &[CriticalFile], risks: &[Risk]) -> Vec<PlanStep> {
        let mut steps = Vec::new();
        let mut step_number = 1;

        // Step 1: Analysis and preparation
        steps.push(
            PlanStep::new(
                step_number,
                "Analysis and Preparation",
                "Review existing code and understand the current implementation",
            )
            .with_files(critical_files.iter().map(|f| f.path.clone()).collect())
            .with_estimated_hours(1.0)
            .with_verification(vec![
                "Understand current architecture".to_string(),
                "Identify integration points".to_string(),
            ]),
        );
        step_number += 1;

        // Step 2: Design
        steps.push(
            PlanStep::new(
                step_number,
                "Design",
                "Create detailed design for the implementation",
            )
            .with_dependencies(vec![1])
            .with_estimated_hours(2.0)
            .with_verification(vec![
                "Design document reviewed".to_string(),
                "Edge cases identified".to_string(),
            ]),
        );
        step_number += 1;

        // Step 3: Core implementation
        let core_files: Vec<PathBuf> = critical_files
            .iter()
            .filter(|f| f.modification_type != ModificationType::Review)
            .map(|f| f.path.clone())
            .collect();

        steps.push(
            PlanStep::new(
                step_number,
                "Core Implementation",
                "Implement the main functionality",
            )
            .with_files(core_files)
            .with_dependencies(vec![2])
            .with_estimated_hours(4.0)
            .with_verification(vec![
                "Core functionality works".to_string(),
                "Code compiles without errors".to_string(),
            ]),
        );
        step_number += 1;

        // Step 4: Testing
        steps.push(
            PlanStep::new(
                step_number,
                "Testing",
                "Write and run tests for the implementation",
            )
            .with_dependencies(vec![3])
            .with_estimated_hours(2.0)
            .with_verification(vec![
                "Unit tests pass".to_string(),
                "Integration tests pass".to_string(),
                "Edge cases covered".to_string(),
            ]),
        );
        step_number += 1;

        // Step 5: Risk mitigation (if high-severity risks exist)
        let high_risks: Vec<&Risk> = risks
            .iter()
            .filter(|r| matches!(r.severity, RiskSeverity::High | RiskSeverity::Critical))
            .collect();

        if !high_risks.is_empty() {
            let mitigation_desc = high_risks
                .iter()
                .map(|r| format!("- {}: {}", r.id, r.description))
                .collect::<Vec<_>>()
                .join("\n");

            steps.push(
                PlanStep::new(
                    step_number,
                    "Risk Mitigation",
                    format!(
                        "Address identified high-severity risks:\n{}",
                        mitigation_desc
                    ),
                )
                .with_dependencies(vec![3])
                .with_estimated_hours(2.0)
                .with_verification(
                    high_risks
                        .iter()
                        .map(|r| format!("Risk {} mitigated", r.id))
                        .collect(),
                ),
            );
            step_number += 1;
        }

        // Step 6: Documentation
        steps.push(
            PlanStep::new(
                step_number,
                "Documentation",
                "Update documentation and add code comments",
            )
            .with_dependencies(vec![step_number - 1])
            .with_estimated_hours(1.0)
            .as_optional()
            .with_verification(vec![
                "README updated".to_string(),
                "API documentation complete".to_string(),
            ]),
        );
        step_number += 1;

        // Step 7: Review and finalization
        steps.push(
            PlanStep::new(
                step_number,
                "Review and Finalization",
                "Code review and final adjustments",
            )
            .with_dependencies(vec![step_number - 1])
            .with_estimated_hours(1.0)
            .with_verification(vec![
                "Code review completed".to_string(),
                "All feedback addressed".to_string(),
            ]),
        );

        steps
    }

    /// Estimate complexity based on files and risks
    fn estimate_complexity(&self, critical_files: &[CriticalFile], risks: &[Risk]) -> Complexity {
        let file_count = critical_files.len();
        let high_risk_count = risks
            .iter()
            .filter(|r| matches!(r.severity, RiskSeverity::High | RiskSeverity::Critical))
            .count();

        // Calculate complexity score
        let mut score = 0;

        // File count contribution
        score += match file_count {
            0..=2 => 1,
            3..=5 => 2,
            6..=10 => 3,
            11..=20 => 4,
            _ => 5,
        };

        // Risk contribution
        score += match high_risk_count {
            0 => 0,
            1 => 1,
            2..=3 => 2,
            _ => 3,
        };

        // Thoroughness contribution
        score += match self.options.thoroughness {
            ThoroughnessLevel::Quick => 0,
            ThoroughnessLevel::Medium => 1,
            ThoroughnessLevel::VeryThorough => 2,
        };

        // Map score to complexity
        match score {
            0..=2 => Complexity::Trivial,
            3..=4 => Complexity::Low,
            5..=6 => Complexity::Medium,
            7..=8 => Complexity::High,
            _ => Complexity::VeryHigh,
        }
    }

    /// Estimate hours based on steps and complexity
    fn estimate_hours(&self, steps: &[PlanStep], complexity: &Complexity) -> f32 {
        let base_hours: f32 = steps.iter().filter_map(|s| s.estimated_hours).sum();
        base_hours * complexity.hours_multiplier()
    }

    /// Generate architectural decisions
    fn generate_architectural_decisions(
        &self,
        requirements: &RequirementsAnalysis,
    ) -> Vec<ArchitecturalDecision> {
        let mut decisions = Vec::new();

        // Decision based on task type
        if !requirements.functional_requirements.is_empty() {
            decisions.push(
                ArchitecturalDecision::new(
                    "AD001",
                    "Implementation Approach",
                    "Use modular design with clear separation of concerns",
                )
                .with_context("Need to implement new functionality while maintaining code quality")
                .with_rationale("Modular design allows for easier testing and maintenance")
                .with_consequences(vec![
                    "Code will be more maintainable".to_string(),
                    "May require additional abstraction layers".to_string(),
                ]),
            );
        }

        // Decision based on constraints
        if let Some(constraints) = &self.options.constraints {
            if !constraints.is_empty() {
                decisions.push(
                    ArchitecturalDecision::new(
                        "AD002",
                        "Constraint Handling",
                        format!(
                            "Design to accommodate constraints: {}",
                            constraints.join(", ")
                        ),
                    )
                    .with_context("Implementation must work within specified constraints")
                    .with_rationale("Constraints define the boundaries of acceptable solutions"),
                );
            }
        }

        decisions
    }

    /// Generate summary
    fn generate_summary(
        &self,
        requirements: &RequirementsAnalysis,
        critical_files: &[CriticalFile],
        risks: &[Risk],
        complexity: &Complexity,
    ) -> String {
        let mut summary = String::new();

        summary.push_str(&format!("# Implementation Plan: {}\n\n", self.options.task));

        summary.push_str(&format!(
            "## Overview\n\nThis plan addresses {} functional requirements and {} non-functional requirements.\n\n",
            requirements.functional_requirements.len(),
            requirements.non_functional_requirements.len()
        ));

        summary.push_str(&format!(
            "## Scope\n\n- {} critical files identified\n- {} risks assessed\n- Complexity: {:?} ({})\n\n",
            critical_files.len(),
            risks.len(),
            complexity,
            complexity.description()
        ));

        if !risks.is_empty() {
            let high_risks = risks
                .iter()
                .filter(|r| matches!(r.severity, RiskSeverity::High | RiskSeverity::Critical))
                .count();
            if high_risks > 0 {
                summary.push_str(&format!(
                    "## Risk Summary\n\n⚠️ {} high-severity risks identified that require attention.\n\n",
                    high_risks
                ));
            }
        }

        summary
    }

    /// Generate recommendations
    fn generate_recommendations(
        &self,
        risks: &[Risk],
        alternatives: &[Alternative],
    ) -> Vec<String> {
        let mut recommendations = Vec::new();

        // Risk-based recommendations
        for risk in risks
            .iter()
            .filter(|r| matches!(r.severity, RiskSeverity::High | RiskSeverity::Critical))
        {
            recommendations.push(format!(
                "Address {} before proceeding: {}",
                risk.id, risk.description
            ));
        }

        // Alternative-based recommendations
        if let Some(recommended) = alternatives.iter().find(|a| a.recommended) {
            recommendations.push(format!(
                "Consider using '{}' approach: {}",
                recommended.name, recommended.description
            ));
        }

        // General recommendations
        recommendations.push("Review the plan with stakeholders before implementation".to_string());
        recommendations.push("Set up monitoring for the implementation progress".to_string());

        recommendations
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_complexity_hours_multiplier() {
        assert_eq!(Complexity::Trivial.hours_multiplier(), 0.5);
        assert_eq!(Complexity::Low.hours_multiplier(), 1.0);
        assert_eq!(Complexity::Medium.hours_multiplier(), 2.0);
        assert_eq!(Complexity::High.hours_multiplier(), 4.0);
        assert_eq!(Complexity::VeryHigh.hours_multiplier(), 8.0);
    }

    #[test]
    fn test_risk_creation() {
        let risk = Risk::new(
            "R001",
            "Test risk",
            RiskCategory::Technical,
            RiskSeverity::High,
        )
        .with_likelihood(0.7)
        .with_impact("High impact")
        .with_mitigation(vec!["Mitigation 1".to_string()]);

        assert_eq!(risk.id, "R001");
        assert_eq!(risk.description, "Test risk");
        assert_eq!(risk.likelihood, 0.7);
        assert_eq!(risk.impact, "High impact");
        assert_eq!(risk.mitigation.len(), 1);
    }

    #[test]
    fn test_risk_likelihood_clamping() {
        let risk = Risk::new("R001", "Test", RiskCategory::Technical, RiskSeverity::Low)
            .with_likelihood(1.5);
        assert_eq!(risk.likelihood, 1.0);

        let risk = Risk::new("R002", "Test", RiskCategory::Technical, RiskSeverity::Low)
            .with_likelihood(-0.5);
        assert_eq!(risk.likelihood, 0.0);
    }

    #[test]
    fn test_critical_file_creation() {
        let file = CriticalFile::new("src/main.rs", "Main entry point", ModificationType::Modify)
            .with_priority(9)
            .with_estimated_changes(50);

        assert_eq!(file.path, PathBuf::from("src/main.rs"));
        assert_eq!(file.reason, "Main entry point");
        assert_eq!(file.priority, 9);
        assert_eq!(file.estimated_changes, Some(50));
    }

    #[test]
    fn test_critical_file_priority_clamping() {
        let file = CriticalFile::new("test.rs", "Test", ModificationType::Create).with_priority(15);
        assert_eq!(file.priority, 10);
    }

    #[test]
    fn test_plan_step_creation() {
        let step = PlanStep::new(1, "Step 1", "Description")
            .with_files(vec![PathBuf::from("file.rs")])
            .with_dependencies(vec![])
            .with_estimated_hours(2.0)
            .with_verification(vec!["Test passes".to_string()]);

        assert_eq!(step.step_number, 1);
        assert_eq!(step.title, "Step 1");
        assert_eq!(step.files.len(), 1);
        assert_eq!(step.estimated_hours, Some(2.0));
        assert!(!step.optional);
    }

    #[test]
    fn test_plan_step_optional() {
        let step = PlanStep::new(1, "Optional Step", "Description").as_optional();
        assert!(step.optional);
    }

    #[test]
    fn test_alternative_creation() {
        let alt = Alternative::new("ALT001", "Standard", "Standard approach")
            .with_pros(vec!["Pro 1".to_string()])
            .with_cons(vec!["Con 1".to_string()])
            .with_complexity(Complexity::Low)
            .as_recommended();

        assert_eq!(alt.id, "ALT001");
        assert!(alt.recommended);
        assert_eq!(alt.complexity, Complexity::Low);
    }

    #[test]
    fn test_architectural_decision_creation() {
        let decision = ArchitecturalDecision::new("AD001", "Title", "Decision")
            .with_context("Context")
            .with_rationale("Rationale")
            .with_consequences(vec!["Consequence".to_string()]);

        assert_eq!(decision.id, "AD001");
        assert_eq!(decision.context, "Context");
        assert_eq!(decision.rationale, "Rationale");
    }

    #[test]
    fn test_requirements_analysis_creation() {
        let analysis = RequirementsAnalysis::new("Test task")
            .with_functional_requirements(vec!["FR1".to_string()])
            .with_non_functional_requirements(vec!["NFR1".to_string()])
            .with_assumptions(vec!["Assumption".to_string()]);

        assert_eq!(analysis.original_task, "Test task");
        assert_eq!(analysis.functional_requirements.len(), 1);
        assert_eq!(analysis.non_functional_requirements.len(), 1);
    }

    #[test]
    fn test_scope_definition() {
        let scope = ScopeDefinition::new()
            .with_in_scope(vec!["In scope".to_string()])
            .with_out_of_scope(vec!["Out of scope".to_string()])
            .with_future_considerations(vec!["Future".to_string()]);

        assert_eq!(scope.in_scope.len(), 1);
        assert_eq!(scope.out_of_scope.len(), 1);
        assert_eq!(scope.future_considerations.len(), 1);
    }

    #[test]
    fn test_plan_options_builder() {
        let options = PlanOptions::new("Test task")
            .with_context("Context")
            .with_constraints(vec!["Constraint".to_string()])
            .with_perspective("security")
            .with_thoroughness(ThoroughnessLevel::VeryThorough);

        assert_eq!(options.task, "Test task");
        assert_eq!(options.context, Some("Context".to_string()));
        assert_eq!(options.perspective, Some("security".to_string()));
        assert_eq!(options.thoroughness, ThoroughnessLevel::VeryThorough);
    }

    #[test]
    fn test_plan_result_data_builder() {
        let result = PlanResultData::new()
            .with_summary("Summary")
            .with_estimated_complexity(Complexity::High)
            .with_estimated_hours(10.0);

        assert_eq!(result.summary, "Summary");
        assert_eq!(result.estimated_complexity, Complexity::High);
        assert_eq!(result.estimated_hours, Some(10.0));
    }

    #[test]
    fn test_plan_result_calculate_total_hours() {
        let mut result = PlanResultData::new();
        result.steps = vec![
            PlanStep::new(1, "Step 1", "Desc").with_estimated_hours(2.0),
            PlanStep::new(2, "Step 2", "Desc").with_estimated_hours(3.0),
            PlanStep::new(3, "Step 3", "Desc"), // No hours
        ];

        assert_eq!(result.calculate_total_hours(), 5.0);
    }

    #[test]
    fn test_plan_agent_creation() {
        let options = PlanOptions::new("Test task");
        let agent = PlanAgent::new(options);

        assert_eq!(agent.options().task, "Test task");
        assert!(agent.files_read().is_empty());
    }

    #[test]
    fn test_extract_keywords() {
        let options = PlanOptions::new("Implement user authentication with JWT tokens");
        let agent = PlanAgent::new(options);

        let keywords = agent.extract_keywords("Implement user authentication with JWT tokens");

        assert!(!keywords.is_empty());
        assert!(keywords.iter().any(|k| k == "implement"
            || k == "user"
            || k == "authentication"
            || k == "jwt"
            || k == "tokens"));
    }

    #[tokio::test]
    async fn test_analyze_requirements() {
        let options = PlanOptions::new("Implement secure API endpoint")
            .with_context("REST API")
            .with_constraints(vec!["Must use HTTPS".to_string()]);

        let agent = PlanAgent::new(options);
        let analysis = agent.analyze_requirements().await.unwrap();

        assert_eq!(analysis.original_task, "Implement secure API endpoint");
        assert!(!analysis.functional_requirements.is_empty());
        assert!(!analysis.non_functional_requirements.is_empty());
    }

    #[tokio::test]
    async fn test_assess_risks_security() {
        let options = PlanOptions::new("Implement authentication system");
        let agent = PlanAgent::new(options);
        let risks = agent.assess_risks().await.unwrap();

        assert!(!risks.is_empty());
        assert!(risks
            .iter()
            .any(|r| matches!(r.category, RiskCategory::Security)));
    }

    #[tokio::test]
    async fn test_assess_risks_performance() {
        let options = PlanOptions::new("Optimize database performance");
        let agent = PlanAgent::new(options);
        let risks = agent.assess_risks().await.unwrap();

        assert!(!risks.is_empty());
        assert!(risks
            .iter()
            .any(|r| matches!(r.category, RiskCategory::Performance)));
    }

    #[tokio::test]
    async fn test_generate_alternatives() {
        let options = PlanOptions::new("Refactor legacy code");
        let agent = PlanAgent::new(options);
        let alternatives = agent.generate_alternatives().await.unwrap();

        assert!(!alternatives.is_empty());
        assert!(alternatives.iter().any(|a| a.recommended));
        // Should have incremental approach for refactoring
        assert!(alternatives.iter().any(|a| a.name.contains("Incremental")));
    }

    #[tokio::test]
    async fn test_create_plan_empty_task() {
        let options = PlanOptions::new("");
        let agent = PlanAgent::new(options);
        let result = agent.create_plan().await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PlanError::InvalidTask(_)));
    }

    #[tokio::test]
    async fn test_create_plan_success() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("main.rs"), "fn main() {}").unwrap();

        let options = PlanOptions::new("Add logging to the application")
            .with_working_directory(temp_dir.path())
            .with_thoroughness(ThoroughnessLevel::Quick);

        let agent = PlanAgent::new(options);
        let result = agent.create_plan().await.unwrap();

        assert!(!result.summary.is_empty());
        assert!(!result.steps.is_empty());
        assert!(!result.alternatives.is_empty());
    }

    #[tokio::test]
    async fn test_identify_files_with_existing_code() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.rs");
        fs::write(&file_path, "// test file").unwrap();

        let options = PlanOptions::new("Test task")
            .with_working_directory(temp_dir.path())
            .with_existing_code(vec![PathBuf::from("test.rs")]);

        let agent = PlanAgent::new(options);
        let files = agent.identify_files().await.unwrap();

        assert!(!files.is_empty());
        assert!(files
            .iter()
            .any(|f| f.path.to_string_lossy().contains("test.rs")));
    }

    #[tokio::test]
    async fn test_read_only_mode() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("readonly.rs");
        let original_content = "// original content";
        fs::write(&file_path, original_content).unwrap();

        let options = PlanOptions::new("Analyze the code")
            .with_working_directory(temp_dir.path())
            .with_existing_code(vec![PathBuf::from("readonly.rs")]);

        let agent = PlanAgent::new(options);
        let _ = agent.create_plan().await.unwrap();

        // Verify file was not modified
        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, original_content);

        // Verify file was read
        let files_read = agent.files_read();
        assert!(!files_read.is_empty());
    }

    #[test]
    fn test_estimate_complexity_low() {
        let options = PlanOptions::new("Simple task").with_thoroughness(ThoroughnessLevel::Quick);
        let agent = PlanAgent::new(options);

        let files = vec![CriticalFile::new(
            "file1.rs",
            "Test",
            ModificationType::Modify,
        )];
        let risks = vec![];

        let complexity = agent.estimate_complexity(&files, &risks);
        assert!(matches!(complexity, Complexity::Trivial | Complexity::Low));
    }

    #[test]
    fn test_estimate_complexity_high() {
        let options =
            PlanOptions::new("Complex task").with_thoroughness(ThoroughnessLevel::VeryThorough);
        let agent = PlanAgent::new(options);

        let files: Vec<CriticalFile> = (0..15)
            .map(|i| CriticalFile::new(format!("file{}.rs", i), "Test", ModificationType::Modify))
            .collect();

        let risks = vec![
            Risk::new(
                "R1",
                "Risk 1",
                RiskCategory::Security,
                RiskSeverity::Critical,
            ),
            Risk::new("R2", "Risk 2", RiskCategory::Technical, RiskSeverity::High),
        ];

        let complexity = agent.estimate_complexity(&files, &risks);
        assert!(matches!(
            complexity,
            Complexity::High | Complexity::VeryHigh
        ));
    }

    #[test]
    fn test_generate_steps() {
        let options = PlanOptions::new("Test task");
        let agent = PlanAgent::new(options);

        let files = vec![CriticalFile::new(
            "file1.rs",
            "Test",
            ModificationType::Modify,
        )];
        let risks = vec![Risk::new(
            "R1",
            "High risk",
            RiskCategory::Security,
            RiskSeverity::High,
        )];

        let steps = agent.generate_steps(&files, &risks);

        assert!(!steps.is_empty());
        // Should have analysis, design, implementation, testing, risk mitigation, docs, review
        assert!(steps.len() >= 5);
        // Steps should be numbered sequentially
        for (i, step) in steps.iter().enumerate() {
            assert_eq!(step.step_number, i + 1);
        }
    }

    #[test]
    fn test_modification_type_default() {
        assert_eq!(ModificationType::default(), ModificationType::Modify);
    }

    #[test]
    fn test_risk_category_default() {
        assert_eq!(RiskCategory::default(), RiskCategory::Technical);
    }

    #[test]
    fn test_risk_severity_default() {
        assert_eq!(RiskSeverity::default(), RiskSeverity::Medium);
    }

    #[test]
    fn test_complexity_default() {
        assert_eq!(Complexity::default(), Complexity::Medium);
    }
}
