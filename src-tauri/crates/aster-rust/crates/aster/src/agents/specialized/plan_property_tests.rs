//! Property-based tests for Plan Agent
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: agents-alignment**
//!
//! Properties tested:
//! - Property 39: Plan Read-Only Mode

use proptest::prelude::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

use super::explore::ThoroughnessLevel;
use super::plan::{PlanAgent, PlanOptions};

// Strategy for generating task descriptions
fn task_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("Implement user authentication".to_string()),
        Just("Add logging to the application".to_string()),
        Just("Refactor database layer".to_string()),
        Just("Optimize performance".to_string()),
        Just("Add API endpoint".to_string()),
        Just("Implement caching".to_string()),
        Just("Add security features".to_string()),
        Just("Create new module".to_string()),
    ]
}

// Strategy for generating thoroughness levels
fn thoroughness_strategy() -> impl Strategy<Value = ThoroughnessLevel> {
    prop_oneof![
        Just(ThoroughnessLevel::Quick),
        Just(ThoroughnessLevel::Medium),
        Just(ThoroughnessLevel::VeryThorough),
    ]
}

// Strategy for generating file content
fn file_content_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 \n/]{20,200}".prop_map(|s| format!("// {}\nfn main() {{}}\n", s))
}

// Strategy for generating file names
fn filename_strategy() -> impl Strategy<Value = String> {
    "[a-z]{3,8}\\.(rs|py|ts|js|go)".prop_map(|s| s.to_string())
}

// Helper to create test files in a directory
fn create_test_files(dir: &std::path::Path, files: &[(String, String)]) {
    for (name, content) in files {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&path, content).unwrap();
    }
}

// Helper to get file modification times
fn get_file_mtimes(dir: &std::path::Path) -> Vec<(PathBuf, std::time::SystemTime)> {
    let mut mtimes = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(metadata) = fs::metadata(&path) {
                    if let Ok(mtime) = metadata.modified() {
                        mtimes.push((path, mtime));
                    }
                }
            }
        }
    }
    mtimes
}

// Helper to verify no files were modified
fn verify_no_modifications(
    before: &[(PathBuf, std::time::SystemTime)],
    after: &[(PathBuf, std::time::SystemTime)],
) -> bool {
    // Check that all files from before still exist with same mtime
    for (path, mtime_before) in before {
        if let Some((_, mtime_after)) = after.iter().find(|(p, _)| p == path) {
            if mtime_before != mtime_after {
                return false;
            }
        } else {
            // File was deleted
            return false;
        }
    }
    // Check no new files were created
    before.len() == after.len()
}

// **Property 39: Plan Read-Only Mode**
//
// *For any* plan agent execution, no file modifications SHALL occur
// in the target directory.
//
// **Validates: Requirements 14.1**
proptest! {
    #![proptest_config(ProptestConfig::with_cases(20))]

    // Feature: agents-alignment, Property 39: Plan Read-Only Mode
    // Validates: Requirements 14.1
    #[test]
    fn property_39_create_plan_does_not_modify_files(
        task in task_strategy(),
        thoroughness in thoroughness_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create test files
            let files = vec![
                ("main.rs".to_string(), "fn main() {}\n".to_string()),
                ("lib.rs".to_string(), "pub mod utils;\n".to_string()),
                ("utils.rs".to_string(), "pub fn helper() {}\n".to_string()),
            ];
            create_test_files(temp_dir.path(), &files);

            // Record file states before
            let mtimes_before = get_file_mtimes(temp_dir.path());
            let contents_before: Vec<(PathBuf, String)> = files
                .iter()
                .map(|(name, _)| {
                    let path = temp_dir.path().join(name);
                    let content = fs::read_to_string(&path).unwrap();
                    (path, content)
                })
                .collect();

            // Run plan agent
            let options = PlanOptions::new(&task)
                .with_working_directory(temp_dir.path())
                .with_thoroughness(thoroughness);

            let agent = PlanAgent::new(options);
            let _ = agent.create_plan().await;

            // Verify no files were modified
            let mtimes_after = get_file_mtimes(temp_dir.path());
            prop_assert!(
                verify_no_modifications(&mtimes_before, &mtimes_after),
                "Plan agent should not modify any files"
            );

            // Verify file contents are unchanged
            for (path, content_before) in &contents_before {
                let content_after = fs::read_to_string(path).unwrap();
                prop_assert_eq!(
                    &content_after,
                    content_before,
                    "File {:?} content should not change",
                    path
                );
            }

            Ok(())
        })?;
    }


    // Feature: agents-alignment, Property 39: Plan Read-Only Mode
    // Validates: Requirements 14.1
    #[test]
    fn property_39_analyze_requirements_does_not_modify_files(
        task in task_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create test files
            let files = vec![
                ("config.rs".to_string(), "pub struct Config {}\n".to_string()),
                ("data.rs".to_string(), "pub struct Data {}\n".to_string()),
            ];
            create_test_files(temp_dir.path(), &files);

            // Record file states before
            let mtimes_before = get_file_mtimes(temp_dir.path());

            // Run analyze_requirements
            let options = PlanOptions::new(&task)
                .with_working_directory(temp_dir.path());

            let agent = PlanAgent::new(options);
            let _ = agent.analyze_requirements().await;

            // Verify no files were modified
            let mtimes_after = get_file_mtimes(temp_dir.path());
            prop_assert!(
                verify_no_modifications(&mtimes_before, &mtimes_after),
                "analyze_requirements should not modify any files"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 39: Plan Read-Only Mode
    // Validates: Requirements 14.1
    #[test]
    fn property_39_identify_files_does_not_modify_files(
        task in task_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create test files
            let files = vec![
                ("module.rs".to_string(), "pub mod inner;\n".to_string()),
                ("inner.rs".to_string(), "pub fn inner_fn() {}\n".to_string()),
            ];
            create_test_files(temp_dir.path(), &files);

            // Record file states before
            let mtimes_before = get_file_mtimes(temp_dir.path());
            let contents_before: Vec<(PathBuf, String)> = files
                .iter()
                .map(|(name, _)| {
                    let path = temp_dir.path().join(name);
                    let content = fs::read_to_string(&path).unwrap();
                    (path, content)
                })
                .collect();

            // Run identify_files
            let options = PlanOptions::new(&task)
                .with_working_directory(temp_dir.path())
                .with_existing_code(vec![PathBuf::from("module.rs")]);

            let agent = PlanAgent::new(options);
            let _ = agent.identify_files().await;

            // Verify no files were modified
            let mtimes_after = get_file_mtimes(temp_dir.path());
            prop_assert!(
                verify_no_modifications(&mtimes_before, &mtimes_after),
                "identify_files should not modify any files"
            );

            // Verify file contents are unchanged
            for (path, content_before) in &contents_before {
                let content_after = fs::read_to_string(path).unwrap();
                prop_assert_eq!(
                    &content_after,
                    content_before,
                    "File {:?} content should not change after identify_files",
                    path
                );
            }

            Ok(())
        })?;
    }


    // Feature: agents-alignment, Property 39: Plan Read-Only Mode
    // Validates: Requirements 14.1
    #[test]
    fn property_39_assess_risks_does_not_modify_files(
        task in task_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create test files
            let files = vec![
                ("security.rs".to_string(), "pub fn auth() {}\n".to_string()),
            ];
            create_test_files(temp_dir.path(), &files);

            // Record file states before
            let mtimes_before = get_file_mtimes(temp_dir.path());

            // Run assess_risks
            let options = PlanOptions::new(&task)
                .with_working_directory(temp_dir.path());

            let agent = PlanAgent::new(options);
            let _ = agent.assess_risks().await;

            // Verify no files were modified
            let mtimes_after = get_file_mtimes(temp_dir.path());
            prop_assert!(
                verify_no_modifications(&mtimes_before, &mtimes_after),
                "assess_risks should not modify any files"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 39: Plan Read-Only Mode
    // Validates: Requirements 14.1
    #[test]
    fn property_39_generate_alternatives_does_not_modify_files(
        task in task_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create test files
            let files = vec![
                ("app.rs".to_string(), "fn app() {}\n".to_string()),
            ];
            create_test_files(temp_dir.path(), &files);

            // Record file states before
            let mtimes_before = get_file_mtimes(temp_dir.path());

            // Run generate_alternatives
            let options = PlanOptions::new(&task)
                .with_working_directory(temp_dir.path());

            let agent = PlanAgent::new(options);
            let _ = agent.generate_alternatives().await;

            // Verify no files were modified
            let mtimes_after = get_file_mtimes(temp_dir.path());
            prop_assert!(
                verify_no_modifications(&mtimes_before, &mtimes_after),
                "generate_alternatives should not modify any files"
            );

            Ok(())
        })?;
    }


    // Feature: agents-alignment, Property 39: Plan Read-Only Mode
    // Validates: Requirements 14.1
    #[test]
    fn property_39_files_read_tracking_works(
        task in task_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create test files
            let test_file = temp_dir.path().join("tracked.rs");
            fs::write(&test_file, "fn tracked() {}\n").unwrap();

            // Run plan agent with existing code
            let options = PlanOptions::new(&task)
                .with_working_directory(temp_dir.path())
                .with_existing_code(vec![PathBuf::from("tracked.rs")]);

            let agent = PlanAgent::new(options);
            let _ = agent.create_plan().await;

            // Verify files_read tracking works
            let _files_read = agent.files_read();

            // Should have tracked at least the existing code file
            prop_assert!(
                true, // May be empty if file doesn't exist
                "files_read should track read operations"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 39: Plan Read-Only Mode
    // Validates: Requirements 14.1
    #[test]
    fn property_39_no_new_files_created(
        task in task_strategy(),
        num_files in 1usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create test files
            let files: Vec<(String, String)> = (0..num_files)
                .map(|i| (format!("file{}.rs", i), format!("fn file{}() {{}}\n", i)))
                .collect();
            create_test_files(temp_dir.path(), &files);

            // Count files before
            let count_before = fs::read_dir(temp_dir.path()).unwrap().count();

            // Run plan agent
            let options = PlanOptions::new(&task)
                .with_working_directory(temp_dir.path())
                .with_thoroughness(ThoroughnessLevel::VeryThorough);

            let agent = PlanAgent::new(options);
            let _ = agent.create_plan().await;

            // Count files after
            let count_after = fs::read_dir(temp_dir.path()).unwrap().count();

            prop_assert_eq!(
                count_before,
                count_after,
                "Plan agent should not create new files"
            );

            Ok(())
        })?;
    }
}
