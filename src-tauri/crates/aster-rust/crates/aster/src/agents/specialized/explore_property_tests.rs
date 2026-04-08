//! Property-based tests for Explore Agent
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: agents-alignment**
//!
//! Properties tested:
//! - Property 35: Explore Thoroughness Scaling
//! - Property 36: File Pattern Search Accuracy

use proptest::prelude::*;
use std::fs;
use tempfile::TempDir;

use super::explore::{ExploreAgent, ExploreOptions, ThoroughnessLevel};

// Strategy for generating thoroughness levels
fn thoroughness_strategy() -> impl Strategy<Value = ThoroughnessLevel> {
    prop_oneof![
        Just(ThoroughnessLevel::Quick),
        Just(ThoroughnessLevel::Medium),
        Just(ThoroughnessLevel::VeryThorough),
    ]
}

// Strategy for generating file extensions
fn extension_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("rs".to_string()),
        Just("py".to_string()),
        Just("ts".to_string()),
        Just("js".to_string()),
        Just("go".to_string()),
        Just("txt".to_string()),
    ]
}

// Strategy for generating search queries
fn query_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z]{2,10}".prop_map(|s| s.to_string())
}

#[allow(dead_code)]
// Strategy for generating file content (for future use)
fn file_content_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 \n]{10,200}".prop_map(|s| s.to_string())
}

// Helper to create test files in a directory
fn create_test_structure(dir: &std::path::Path, num_files: usize, extension: &str) -> Vec<String> {
    let mut created_files = Vec::new();
    for i in 0..num_files {
        let filename = format!("file{}.{}", i, extension);
        let content = format!("// File {} content\nfn test_{}() {{}}\n", i, i);
        let path = dir.join(&filename);
        fs::write(&path, &content).unwrap();
        created_files.push(filename);
    }
    created_files
}

// Helper to create nested directory structure
fn create_nested_structure(dir: &std::path::Path, depth: usize, files_per_level: usize) {
    let mut current = dir.to_path_buf();
    for level in 0..depth {
        for i in 0..files_per_level {
            let filename = format!("level{}_file{}.rs", level, i);
            let content = format!(
                "// Level {} File {}\npub fn func_{}_{} () {{}}\n",
                level, i, level, i
            );
            fs::write(current.join(&filename), content).unwrap();
        }
        if level < depth - 1 {
            let subdir = current.join(format!("subdir{}", level));
            fs::create_dir_all(&subdir).unwrap();
            current = subdir;
        }
    }
}

// **Property 35: Explore Thoroughness Scaling**
//
// *For any* explore operation, the number of results and depth of analysis
// SHALL scale with the configured thoroughness level.
//
// **Validates: Requirements 13.1, 13.7**
proptest! {
    #![proptest_config(ProptestConfig::with_cases(20))]

    // Feature: agents-alignment, Property 35: Explore Thoroughness Scaling
    // Validates: Requirements 13.1, 13.7
    #[test]
    fn property_35_thoroughness_affects_max_depth(
        thoroughness in thoroughness_strategy()
    ) {
        // Verify that different thoroughness levels have different max depths
        let quick_depth = ThoroughnessLevel::Quick.max_depth();
        let medium_depth = ThoroughnessLevel::Medium.max_depth();
        let thorough_depth = ThoroughnessLevel::VeryThorough.max_depth();

        prop_assert!(quick_depth < medium_depth, "Quick should have less depth than Medium");
        prop_assert!(medium_depth < thorough_depth, "Medium should have less depth than VeryThorough");

        // Verify the specific thoroughness level's depth is within expected range
        let depth = thoroughness.max_depth();
        prop_assert!(depth >= 2, "Min depth should be at least 2");
        prop_assert!(depth <= 10, "Max depth should be at most 10");
    }

    // Feature: agents-alignment, Property 35: Explore Thoroughness Scaling
    // Validates: Requirements 13.1, 13.7
    #[test]
    fn property_35_thoroughness_affects_max_files(
        thoroughness in thoroughness_strategy()
    ) {
        // Verify that different thoroughness levels have different max files
        let quick_files = ThoroughnessLevel::Quick.max_files();
        let medium_files = ThoroughnessLevel::Medium.max_files();
        let thorough_files = ThoroughnessLevel::VeryThorough.max_files();

        prop_assert!(quick_files < medium_files, "Quick should have fewer max files than Medium");
        prop_assert!(medium_files < thorough_files, "Medium should have fewer max files than VeryThorough");

        // Verify the specific thoroughness level's max files is within expected range
        let max_files = thoroughness.max_files();
        prop_assert!(max_files >= 50, "Min max_files should be at least 50");
        prop_assert!(max_files <= 1000, "Max max_files should be at most 1000");
    }

    // Feature: agents-alignment, Property 35: Explore Thoroughness Scaling
    // Validates: Requirements 13.1, 13.7
    #[test]
    fn property_35_thoroughness_affects_context_lines(
        thoroughness in thoroughness_strategy()
    ) {
        // Verify that different thoroughness levels have different context lines
        let quick_context = ThoroughnessLevel::Quick.context_lines();
        let medium_context = ThoroughnessLevel::Medium.context_lines();
        let thorough_context = ThoroughnessLevel::VeryThorough.context_lines();

        prop_assert!(quick_context <= medium_context, "Quick should have <= context lines than Medium");
        prop_assert!(medium_context <= thorough_context, "Medium should have <= context lines than VeryThorough");

        // Verify the specific thoroughness level's context lines is within expected range
        let context = thoroughness.context_lines();
        prop_assert!(context >= 1, "Min context lines should be at least 1");
        prop_assert!(context <= 5, "Max context lines should be at most 5");
    }

    // Feature: agents-alignment, Property 35: Explore Thoroughness Scaling
    // Validates: Requirements 13.1, 13.7
    #[test]
    fn property_35_explore_respects_max_results(
        num_files in 10usize..30usize,
        max_results in 1usize..10usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create more files than max_results
            create_test_structure(temp_dir.path(), num_files, "rs");

            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_max_results(max_results);

            let agent = ExploreAgent::new(options);
            let result = agent.explore().await.unwrap();

            prop_assert!(
                result.files.len() <= max_results,
                "Results ({}) should not exceed max_results ({})",
                result.files.len(),
                max_results
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 35: Explore Thoroughness Scaling
    // Validates: Requirements 13.1, 13.7
    #[test]
    fn property_35_higher_thoroughness_finds_more_in_deep_structure(
        files_per_level in 2usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create a deep nested structure (8 levels deep)
            create_nested_structure(temp_dir.path(), 8, files_per_level);

            // Quick exploration (max depth 2)
            let quick_options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_thoroughness(ThoroughnessLevel::Quick);
            let quick_agent = ExploreAgent::new(quick_options);
            let quick_result = quick_agent.explore().await.unwrap();

            // Very thorough exploration (max depth 10)
            let thorough_options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_thoroughness(ThoroughnessLevel::VeryThorough);
            let thorough_agent = ExploreAgent::new(thorough_options);
            let thorough_result = thorough_agent.explore().await.unwrap();

            // VeryThorough should find more files in deep structures
            prop_assert!(
                thorough_result.files.len() >= quick_result.files.len(),
                "VeryThorough ({}) should find >= files than Quick ({})",
                thorough_result.files.len(),
                quick_result.files.len()
            );

            // VeryThorough should traverse more directories
            prop_assert!(
                thorough_result.stats.directories_traversed >= quick_result.stats.directories_traversed,
                "VeryThorough should traverse >= directories than Quick"
            );

            Ok(())
        })?;
    }
}

// **Property 36: File Pattern Search Accuracy**
//
// *For any* file pattern search, results SHALL match the specified pattern
// and be limited to the configured maximum.
//
// **Validates: Requirements 13.2**
proptest! {
    #![proptest_config(ProptestConfig::with_cases(20))]

    // Feature: agents-alignment, Property 36: File Pattern Search Accuracy
    // Validates: Requirements 13.2
    #[test]
    fn property_36_pattern_search_returns_matching_files(
        extension in extension_strategy(),
        num_matching in 3usize..10usize,
        num_other in 3usize..10usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create files with the target extension
            create_test_structure(temp_dir.path(), num_matching, &extension);

            // Create files with a different extension
            let other_ext = if extension == "rs" { "py" } else { "rs" };
            create_test_structure(temp_dir.path(), num_other, other_ext);

            let pattern = format!("*.{}", extension);
            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_patterns(vec![pattern]);

            let agent = ExploreAgent::new(options);
            let result = agent.explore().await.unwrap();

            // All returned files should match the pattern
            for file in &result.files {
                let file_ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
                prop_assert_eq!(
                    file_ext,
                    extension.as_str(),
                    "File {:?} should have extension {}",
                    file,
                    extension
                );
            }

            // Should find the matching files
            prop_assert!(
                result.files.len() >= num_matching.min(result.stats.files_scanned),
                "Should find at least {} matching files, found {}",
                num_matching,
                result.files.len()
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 36: File Pattern Search Accuracy
    // Validates: Requirements 13.2
    #[test]
    fn property_36_multiple_patterns_match_any(
        num_rs in 2usize..5usize,
        num_py in 2usize..5usize,
        num_txt in 2usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create files with different extensions
            create_test_structure(temp_dir.path(), num_rs, "rs");
            create_test_structure(temp_dir.path(), num_py, "py");
            create_test_structure(temp_dir.path(), num_txt, "txt");

            // Search for rs and py files (not txt)
            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_patterns(vec!["*.rs".to_string(), "*.py".to_string()]);

            let agent = ExploreAgent::new(options);
            let result = agent.explore().await.unwrap();

            // All returned files should be either .rs or .py
            for file in &result.files {
                let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
                prop_assert!(
                    ext == "rs" || ext == "py",
                    "File {:?} should be .rs or .py, got .{}",
                    file,
                    ext
                );
            }

            // Should not include .txt files
            let txt_count = result.files.iter()
                .filter(|f| f.extension().and_then(|e| e.to_str()) == Some("txt"))
                .count();
            prop_assert_eq!(txt_count, 0, "Should not include .txt files");

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 36: File Pattern Search Accuracy
    // Validates: Requirements 13.2
    #[test]
    fn property_36_no_pattern_returns_all_files(
        num_rs in 2usize..5usize,
        num_py in 2usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create files with different extensions
            create_test_structure(temp_dir.path(), num_rs, "rs");
            create_test_structure(temp_dir.path(), num_py, "py");

            // No pattern specified
            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path());

            let agent = ExploreAgent::new(options);
            let result = agent.explore().await.unwrap();

            // Should find all files
            let total_expected = num_rs + num_py;
            prop_assert_eq!(
                result.files.len(),
                total_expected,
                "Should find all {} files, found {}",
                total_expected,
                result.files.len()
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 36: File Pattern Search Accuracy
    // Validates: Requirements 13.2, 13.7
    #[test]
    fn property_36_pattern_search_respects_max_results(
        num_files in 10usize..20usize,
        max_results in 1usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create more files than max_results
            create_test_structure(temp_dir.path(), num_files, "rs");

            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_patterns(vec!["*.rs".to_string()])
                .with_max_results(max_results);

            let agent = ExploreAgent::new(options);
            let result = agent.explore().await.unwrap();

            prop_assert!(
                result.files.len() <= max_results,
                "Results ({}) should not exceed max_results ({})",
                result.files.len(),
                max_results
            );

            // All returned files should still match the pattern
            for file in &result.files {
                let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
                prop_assert_eq!(ext, "rs", "All files should be .rs");
            }

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 36: File Pattern Search Accuracy
    // Validates: Requirements 13.2
    #[test]
    fn property_36_find_files_method_matches_pattern(
        extension in extension_strategy(),
        num_files in 3usize..8usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create files with the target extension
            create_test_structure(temp_dir.path(), num_files, &extension);

            // Create some other files
            create_test_structure(temp_dir.path(), 3, "other");

            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path());

            let agent = ExploreAgent::new(options);
            let pattern = format!("*.{}", extension);
            let files = agent.find_files(&pattern).await.unwrap();

            // All returned files should match the pattern
            for file in &files {
                let file_ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
                prop_assert_eq!(
                    file_ext,
                    extension.as_str(),
                    "File {:?} should have extension {}",
                    file,
                    extension
                );
            }

            Ok(())
        })?;
    }
}

// **Property 37: Code Content Search**
//
// *For any* code search query, results SHALL contain the search term
// with appropriate context lines based on thoroughness.
//
// **Validates: Requirements 13.3, 13.4**
proptest! {
    #![proptest_config(ProptestConfig::with_cases(20))]

    // Feature: agents-alignment, Property 37: Code Content Search
    // Validates: Requirements 13.3, 13.4
    #[test]
    fn property_37_search_results_contain_search_term(
        keyword in "[a-zA-Z]{3,8}"
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create files with the keyword
            let content = format!(
                "// Line 1\n// Line 2\nfn {}() {{}}\n// Line 4\n// Line 5\n",
                keyword
            );
            fs::write(temp_dir.path().join("test.rs"), &content).unwrap();

            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path());

            let agent = ExploreAgent::new(options);
            let snippets = agent.search_code(&keyword).await.unwrap();

            // All snippets should contain the search term
            for snippet in &snippets {
                prop_assert!(
                    snippet.content.to_lowercase().contains(&keyword.to_lowercase()),
                    "Snippet content '{}' should contain keyword '{}'",
                    snippet.content,
                    keyword
                );
                prop_assert_eq!(
                    &snippet.matched_term,
                    &keyword,
                    "Matched term should be the search keyword"
                );
            }

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 37: Code Content Search
    // Validates: Requirements 13.3, 13.4
    #[test]
    fn property_37_context_lines_scale_with_thoroughness(
        thoroughness in thoroughness_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create a file with many lines
            let mut content = String::new();
            for i in 0..20 {
                content.push_str(&format!("// Line {}\n", i));
            }
            content.push_str("fn target_function() {}\n");
            for i in 21..40 {
                content.push_str(&format!("// Line {}\n", i));
            }
            fs::write(temp_dir.path().join("test.rs"), &content).unwrap();

            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_thoroughness(thoroughness);

            let agent = ExploreAgent::new(options);
            let snippets = agent.search_code("target_function").await.unwrap();

            let expected_context = thoroughness.context_lines();

            for snippet in &snippets {
                // Context before should be at most expected_context lines
                prop_assert!(
                    snippet.context_before.len() <= expected_context,
                    "Context before ({}) should be <= expected ({})",
                    snippet.context_before.len(),
                    expected_context
                );
                // Context after should be at most expected_context lines
                prop_assert!(
                    snippet.context_after.len() <= expected_context,
                    "Context after ({}) should be <= expected ({})",
                    snippet.context_after.len(),
                    expected_context
                );
            }

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 37: Code Content Search
    // Validates: Requirements 13.3, 13.4
    #[test]
    fn property_37_search_is_case_insensitive(
        keyword in "[a-zA-Z]{3,6}"
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create file with mixed case
            let upper_keyword = keyword.to_uppercase();
            let content = format!("fn {}() {{}}\n", upper_keyword);
            fs::write(temp_dir.path().join("test.rs"), &content).unwrap();

            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path());

            let agent = ExploreAgent::new(options);

            // Search with lowercase
            let lower_keyword = keyword.to_lowercase();
            let snippets = agent.search_code(&lower_keyword).await.unwrap();

            // Should find the uppercase version
            prop_assert!(
                !snippets.is_empty(),
                "Case-insensitive search for '{}' should find '{}'",
                lower_keyword,
                upper_keyword
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 37: Code Content Search
    // Validates: Requirements 13.3, 13.4
    #[test]
    fn property_37_search_respects_max_results(
        num_matches in 5usize..15usize,
        max_results in 1usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();

            // Create file with multiple matches
            let mut content = String::new();
            for i in 0..num_matches {
                content.push_str(&format!("fn target_func_{}() {{}}\n", i));
            }
            fs::write(temp_dir.path().join("test.rs"), &content).unwrap();

            let options = ExploreOptions::new("")
                .with_target_path(temp_dir.path())
                .with_max_results(max_results);

            let agent = ExploreAgent::new(options);
            let snippets = agent.search_code("target_func").await.unwrap();

            prop_assert!(
                snippets.len() <= max_results,
                "Search results ({}) should not exceed max_results ({})",
                snippets.len(),
                max_results
            );

            Ok(())
        })?;
    }
}

// **Property 38: Structure Analysis Completeness**
//
// *For any* analyzed file, structure analysis SHALL extract exports,
// imports, classes, functions, and interfaces where applicable.
//
// **Validates: Requirements 13.5, 13.6**
proptest! {
    #![proptest_config(ProptestConfig::with_cases(20))]

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_rust_analysis_extracts_functions(
        fn_name in "[a-z][a-z0-9_]{2,10}"
    ) {
        let temp_dir = TempDir::new().unwrap();

        let content = format!("pub fn {}() {{}}\n", fn_name);
        let file_path = temp_dir.path().join("test.rs");
        fs::write(&file_path, &content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&file_path).unwrap();

        prop_assert_eq!(analysis.language, Some("rust".to_string()));
        prop_assert!(
            analysis.functions.contains(&fn_name),
            "Should extract function '{}' from Rust file",
            fn_name
        );
        prop_assert!(
            analysis.exports.contains(&fn_name),
            "Public function '{}' should be in exports",
            fn_name
        );
    }

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_rust_analysis_extracts_structs(
        struct_name in "[A-Z][a-zA-Z0-9]{2,10}"
    ) {
        let temp_dir = TempDir::new().unwrap();

        let content = format!("pub struct {} {{}}\n", struct_name);
        let file_path = temp_dir.path().join("test.rs");
        fs::write(&file_path, &content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&file_path).unwrap();

        prop_assert!(
            analysis.types.contains(&struct_name),
            "Should extract struct '{}' from Rust file",
            struct_name
        );
        prop_assert!(
            analysis.exports.contains(&struct_name),
            "Public struct '{}' should be in exports",
            struct_name
        );
    }

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_rust_analysis_extracts_traits(
        trait_name in "[A-Z][a-zA-Z0-9]{2,10}"
    ) {
        let temp_dir = TempDir::new().unwrap();

        let content = format!("pub trait {} {{}}\n", trait_name);
        let file_path = temp_dir.path().join("test.rs");
        fs::write(&file_path, &content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&file_path).unwrap();

        prop_assert!(
            analysis.interfaces.contains(&trait_name),
            "Should extract trait '{}' as interface from Rust file",
            trait_name
        );
    }

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_python_analysis_extracts_classes(
        class_name in "[A-Z][a-zA-Z0-9]{2,10}"
    ) {
        let temp_dir = TempDir::new().unwrap();

        let content = format!("class {}:\n    pass\n", class_name);
        let file_path = temp_dir.path().join("test.py");
        fs::write(&file_path, &content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&file_path).unwrap();

        prop_assert_eq!(analysis.language, Some("python".to_string()));
        prop_assert!(
            analysis.classes.contains(&class_name),
            "Should extract class '{}' from Python file",
            class_name
        );
    }

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_python_analysis_extracts_functions(
        fn_name in "[a-z][a-z0-9_]{2,10}"
    ) {
        let temp_dir = TempDir::new().unwrap();

        let content = format!("def {}():\n    pass\n", fn_name);
        let file_path = temp_dir.path().join("test.py");
        fs::write(&file_path, &content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&file_path).unwrap();

        prop_assert!(
            analysis.functions.contains(&fn_name),
            "Should extract function '{}' from Python file",
            fn_name
        );
    }

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_typescript_analysis_extracts_interfaces(
        interface_name in "[A-Z][a-zA-Z0-9]{2,10}"
    ) {
        let temp_dir = TempDir::new().unwrap();

        let content = format!("export interface {} {{}}\n", interface_name);
        let file_path = temp_dir.path().join("test.ts");
        fs::write(&file_path, &content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&file_path).unwrap();

        prop_assert_eq!(analysis.language, Some("typescript".to_string()));
        prop_assert!(
            analysis.interfaces.contains(&interface_name),
            "Should extract interface '{}' from TypeScript file",
            interface_name
        );
        prop_assert!(
            analysis.exports.contains(&interface_name),
            "Exported interface '{}' should be in exports",
            interface_name
        );
    }

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_analysis_detects_correct_language(
        extension in prop_oneof![
            Just("rs"),
            Just("py"),
            Just("ts"),
            Just("js"),
            Just("go"),
        ]
    ) {
        let temp_dir = TempDir::new().unwrap();

        let content = "// test file\n";
        let file_path = temp_dir.path().join(format!("test.{}", extension));
        fs::write(&file_path, content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&file_path).unwrap();

        let expected_lang = match extension {
            "rs" => "rust",
            "py" => "python",
            "ts" => "typescript",
            "js" => "javascript",
            "go" => "go",
            _ => unreachable!(),
        };

        prop_assert_eq!(
            analysis.language,
            Some(expected_lang.to_string()),
            "File with .{} extension should be detected as {}",
            extension,
            expected_lang
        );
    }

    // Feature: agents-alignment, Property 38: Structure Analysis Completeness
    // Validates: Requirements 13.5, 13.6
    #[test]
    fn property_38_analysis_extracts_imports(
        module_name in "[a-z][a-z0-9_]{2,10}"
    ) {
        let temp_dir = TempDir::new().unwrap();

        // Test Rust imports
        let rust_content = format!("use {}::something;\n", module_name);
        let rust_path = temp_dir.path().join("test.rs");
        fs::write(&rust_path, &rust_content).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent.analyze_structure(&rust_path).unwrap();

        prop_assert!(
            analysis.imports.iter().any(|i| i.contains(&module_name)),
            "Should extract import containing '{}' from Rust file",
            module_name
        );
    }
}

// Additional unit tests for edge cases
#[tokio::test]
async fn property_35_empty_directory_returns_empty_results() {
    let temp_dir = TempDir::new().unwrap();

    let options = ExploreOptions::new("").with_target_path(temp_dir.path());

    let agent = ExploreAgent::new(options);
    let result = agent.explore().await.unwrap();

    assert!(result.files.is_empty());
    assert_eq!(result.stats.files_scanned, 0);
}

#[tokio::test]
async fn property_36_nonexistent_pattern_returns_empty() {
    let temp_dir = TempDir::new().unwrap();
    create_test_structure(temp_dir.path(), 5, "rs");

    let options = ExploreOptions::new("")
        .with_target_path(temp_dir.path())
        .with_patterns(vec!["*.nonexistent".to_string()]);

    let agent = ExploreAgent::new(options);
    let result = agent.explore().await.unwrap();

    assert!(result.files.is_empty());
}

#[test]
fn property_35_thoroughness_ordering_is_consistent() {
    // Verify the ordering is consistent across all metrics
    let quick = ThoroughnessLevel::Quick;
    let medium = ThoroughnessLevel::Medium;
    let thorough = ThoroughnessLevel::VeryThorough;

    // Max depth ordering
    assert!(quick.max_depth() < medium.max_depth());
    assert!(medium.max_depth() < thorough.max_depth());

    // Max files ordering
    assert!(quick.max_files() < medium.max_files());
    assert!(medium.max_files() < thorough.max_files());

    // Context lines ordering
    assert!(quick.context_lines() <= medium.context_lines());
    assert!(medium.context_lines() <= thorough.context_lines());

    // Max content size ordering
    assert!(quick.max_content_size() < medium.max_content_size());
    assert!(medium.max_content_size() < thorough.max_content_size());
}
