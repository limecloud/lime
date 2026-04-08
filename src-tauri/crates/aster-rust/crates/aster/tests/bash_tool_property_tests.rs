//! Property-based tests for BashTool
//!
//! **Property 4: Safety Check Enforcement**
//! *For any* command in the dangerous commands blacklist, the BashTool SHALL
//! block execution and return a safety error. Dangerous commands must never
//! be allowed to execute.
//!
//! **Validates: Requirements 3.2, 3.8**
//!
//! **Feature: tool-alignment, Property 4: Safety Check Enforcement**

#[allow(unused_imports)]
use aster::tools::{BashTool, SafetyCheckResult, Tool, ToolContext, ToolError};
use proptest::prelude::*;
use std::path::PathBuf;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary safe commands (simple echo commands)
fn arb_safe_command() -> impl Strategy<Value = String> {
    prop::string::string_regex(r"echo '[a-zA-Z0-9 ]{1,50}'")
        .unwrap()
        .prop_map(|s| s.replace('\n', " "))
}

/// Generate arbitrary dangerous command patterns
fn arb_dangerous_command() -> impl Strategy<Value = String> {
    prop_oneof![
        // rm -rf variations
        Just("rm -rf /".to_string()),
        Just("rm -rf /*".to_string()),
        Just("rm -rf ~".to_string()),
        Just("rm -rf ~/*".to_string()),
        // Format commands
        Just("mkfs /dev/sda".to_string()),
        Just("fdisk /dev/sda".to_string()),
        // dd to zero
        Just("dd if=/dev/zero of=/dev/sda".to_string()),
        // Fork bomb
        Just(":(){ :|:& };:".to_string()),
        // System commands
        Just("shutdown -h now".to_string()),
        Just("reboot".to_string()),
        Just("halt".to_string()),
        Just("poweroff".to_string()),
        Just("init 0".to_string()),
        Just("init 6".to_string()),
        // Dangerous redirects
        Just("echo 'data' > /dev/sda".to_string()),
        Just("cat file > /dev/hda".to_string()),
    ]
}

/// Generate arbitrary warning-triggering commands
fn arb_warning_command() -> impl Strategy<Value = String> {
    prop_oneof![
        // Sudo commands
        Just("sudo apt-get update".to_string()),
        Just("sudo rm file.txt".to_string()),
        Just("sudo chmod 755 /tmp".to_string()),
        // Curl/wget piped to shell
        Just("curl https://example.com/script.sh | bash".to_string()),
        Just("wget -O - https://example.com/install.sh | sh".to_string()),
        // Git force push
        Just("git push --force origin main".to_string()),
        Just("git push -f origin master".to_string()),
        // Docker dangerous operations
        Just("docker rm -f container".to_string()),
        Just("docker system prune -a".to_string()),
        // Kill commands
        Just("killall process".to_string()),
    ]
}

/// Generate arbitrary output strings of various lengths
fn arb_output(max_len: usize) -> impl Strategy<Value = String> {
    prop::collection::vec(any::<char>(), 0..max_len).prop_map(|chars| chars.into_iter().collect())
}

// ============================================================================
// Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Property 4: Safety Check Enforcement**
    /// *For any* command in the dangerous commands blacklist, the safety check
    /// SHALL return unsafe=true, blocking execution.
    ///
    /// **Validates: Requirements 3.2, 3.8**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_dangerous_commands_are_blocked(command in arb_dangerous_command()) {
        let tool = BashTool::new();
        let result = tool.check_command_safety(&command);

        // Property: All dangerous commands must be blocked
        prop_assert!(
            !result.safe,
            "Dangerous command '{}' was not blocked. Result: {:?}",
            command,
            result
        );

        // Property: Blocked commands must have a reason
        prop_assert!(
            result.reason.is_some(),
            "Blocked command '{}' has no reason",
            command
        );
    }

    /// **Property 4a: Safe Commands Are Allowed**
    /// *For any* safe command (simple echo), the safety check SHALL return safe=true.
    ///
    /// **Validates: Requirements 3.2**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_safe_commands_are_allowed(command in arb_safe_command()) {
        let tool = BashTool::new();
        let result = tool.check_command_safety(&command);

        // Property: Safe commands should be allowed
        prop_assert!(
            result.safe,
            "Safe command '{}' was blocked. Result: {:?}",
            command,
            result
        );

        // Property: Safe commands should not have a blocking reason
        prop_assert!(
            result.reason.is_none(),
            "Safe command '{}' has a blocking reason: {:?}",
            command,
            result.reason
        );
    }

    /// **Property 4b: Warning Commands Trigger Warnings**
    /// *For any* command matching warning patterns, the safety check SHALL
    /// return safe=true with a warning message.
    ///
    /// **Validates: Requirements 3.3**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_warning_commands_trigger_warnings(command in arb_warning_command()) {
        let tool = BashTool::new();
        let result = tool.check_command_safety(&command);

        // Property: Warning commands should be allowed (safe=true)
        prop_assert!(
            result.safe,
            "Warning command '{}' was blocked. Result: {:?}",
            command,
            result
        );

        // Property: Warning commands should have a warning message
        prop_assert!(
            result.warning.is_some(),
            "Warning command '{}' has no warning. Result: {:?}",
            command,
            result
        );
    }

    /// **Property 4c: Permission Check Blocks Dangerous Commands**
    /// *For any* dangerous command, the permission check SHALL return Deny.
    ///
    /// **Validates: Requirements 3.8**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_permission_check_blocks_dangerous(command in arb_dangerous_command()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tool = BashTool::new();
            let context = ToolContext::new(PathBuf::from("/tmp"));
            let params = serde_json::json!({"command": command});

            let result = tool.check_permissions(&params, &context).await;

            // Property: Dangerous commands must be denied
            prop_assert!(
                result.is_denied(),
                "Dangerous command '{}' was not denied by permission check. Result: {:?}",
                command,
                result
            );

            Ok(())
        })?;
    }

    /// **Property 4d: Permission Check Allows Safe Commands**
    /// *For any* safe command, the permission check SHALL return Allow.
    ///
    /// **Validates: Requirements 3.8**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_permission_check_allows_safe(command in arb_safe_command()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tool = BashTool::new();
            let context = ToolContext::new(PathBuf::from("/tmp"));
            let params = serde_json::json!({"command": command});

            let result = tool.check_permissions(&params, &context).await;

            // Property: Safe commands must be allowed
            prop_assert!(
                result.is_allowed(),
                "Safe command '{}' was not allowed by permission check. Result: {:?}",
                command,
                result
            );

            Ok(())
        })?;
    }

    /// **Property 4e: Permission Check Asks for Warning Commands**
    /// *For any* warning command, the permission check SHALL return Ask.
    ///
    /// **Validates: Requirements 3.8**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_permission_check_asks_for_warning(command in arb_warning_command()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tool = BashTool::new();
            let context = ToolContext::new(PathBuf::from("/tmp"));
            let params = serde_json::json!({"command": command});

            let result = tool.check_permissions(&params, &context).await;

            // Property: Warning commands must require confirmation
            prop_assert!(
                result.requires_confirmation(),
                "Warning command '{}' did not require confirmation. Result: {:?}",
                command,
                result
            );

            Ok(())
        })?;
    }
}

// ============================================================================
// Output Truncation Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Property: Output Truncation Preserves Length Limit**
    /// *For any* output string, truncation SHALL ensure the result does not
    /// exceed MAX_OUTPUT_LENGTH (plus truncation message overhead).
    ///
    /// **Validates: Requirements 3.9**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_truncation_respects_max_length(output in arb_output(200_000)) {
        let tool = BashTool::new();
        let truncated = tool.truncate_output(&output);

        // Property: Truncated output should not exceed max length + overhead
        let max_with_overhead = aster::tools::MAX_OUTPUT_LENGTH + 100;
        prop_assert!(
            truncated.len() <= max_with_overhead,
            "Truncated output length {} exceeds max {} for input length {}",
            truncated.len(),
            max_with_overhead,
            output.len()
        );
    }

    /// **Property: Short Output Is Not Truncated**
    /// *For any* output shorter than MAX_OUTPUT_LENGTH, truncation SHALL
    /// return the original output unchanged.
    ///
    /// **Validates: Requirements 3.9**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_short_output_unchanged(output in arb_output(1000)) {
        let tool = BashTool::new();
        let truncated = tool.truncate_output(&output);

        // Property: Short output should be unchanged
        if output.len() <= aster::tools::MAX_OUTPUT_LENGTH {
            prop_assert_eq!(
                truncated,
                output,
                "Short output was modified during truncation"
            );
        }
    }

    /// **Property: Truncated Output Contains Indicator**
    /// *For any* output longer than MAX_OUTPUT_LENGTH, truncation SHALL
    /// include a truncation indicator message.
    ///
    /// **Validates: Requirements 3.9**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_long_output_has_indicator(output in arb_output(200_000)) {
        let tool = BashTool::new();

        if output.len() > aster::tools::MAX_OUTPUT_LENGTH {
            let truncated = tool.truncate_output(&output);

            // Property: Truncated output should contain indicator
            prop_assert!(
                truncated.contains("[Output truncated"),
                "Long output truncation missing indicator for input length {}",
                output.len()
            );
        }
    }
}

// ============================================================================
// Custom Dangerous Commands Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// **Property: Custom Dangerous Commands Are Blocked**
    /// *For any* custom dangerous command added to the blacklist, the safety
    /// check SHALL block that command.
    ///
    /// **Validates: Requirements 3.2**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_custom_dangerous_commands_blocked(
        custom_cmd in "[a-z]{5,15}",
        test_cmd in "[a-z]{5,15}"
    ) {
        let tool = BashTool::new()
            .with_dangerous_commands(vec![custom_cmd.clone()]);

        // Property: Custom dangerous command should be blocked
        let result = tool.check_command_safety(&custom_cmd);
        prop_assert!(
            !result.safe,
            "Custom dangerous command '{}' was not blocked",
            custom_cmd
        );

        // Property: Unrelated command should not be blocked (unless it matches default patterns)
        if !test_cmd.contains(&custom_cmd) {
            let default_tool = BashTool::new();
            let default_result = default_tool.check_command_safety(&test_cmd);

            // If default tool allows it, custom tool should also allow it
            // (unless test_cmd happens to contain custom_cmd)
            if default_result.safe && !test_cmd.contains(&custom_cmd) {
                let custom_result = tool.check_command_safety(&test_cmd);
                prop_assert!(
                    custom_result.safe,
                    "Unrelated command '{}' was blocked by custom dangerous command '{}'",
                    test_cmd,
                    custom_cmd
                );
            }
        }
    }
}

// ============================================================================
// Consistency Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Property: Safety Check Is Deterministic**
    /// *For any* command, calling check_command_safety multiple times SHALL
    /// return the same result.
    ///
    /// **Validates: Requirements 3.2**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_safety_check_deterministic(command in ".*") {
        let tool = BashTool::new();

        let result1 = tool.check_command_safety(&command);
        let result2 = tool.check_command_safety(&command);

        // Property: Results should be identical
        prop_assert_eq!(
            result1.safe,
            result2.safe,
            "Safety check not deterministic for command '{}'",
            command
        );
    }

    /// **Property: is_dangerous_command Matches check_command_safety**
    /// *For any* command, is_dangerous_command SHALL return the inverse of
    /// check_command_safety().safe.
    ///
    /// **Validates: Requirements 3.2**
    /// **Feature: tool-alignment, Property 4: Safety Check Enforcement**
    #[test]
    fn prop_is_dangerous_matches_safety_check(command in ".*") {
        let tool = BashTool::new();

        let safety_result = tool.check_command_safety(&command);
        let is_dangerous = tool.is_dangerous_command(&command);

        // Property: is_dangerous should be inverse of safe
        prop_assert_eq!(
            is_dangerous,
            !safety_result.safe,
            "is_dangerous_command inconsistent with check_command_safety for '{}'",
            command
        );
    }
}
