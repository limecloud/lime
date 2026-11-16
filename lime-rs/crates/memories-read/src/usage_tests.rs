//! Regression coverage for versioned memory paths in shell usage telemetry.

use super::MemoriesUsageKind;
use super::memories_usage_from_command;
use pretty_assertions::assert_eq;
use protocol::MemoryVersion;

#[test]
fn classifies_reads_in_both_memory_versions() {
    for version in [MemoryVersion::V1, MemoryVersion::V2] {
        let root = version.directory_name();
        for (reader, root) in [
            ("cat", format!("/tmp/.lime/{root}")),
            ("Get-Content", format!(r"C:\Users\test\.lime\{root}")),
        ] {
            let command = format!(
                "{reader} '{root}/memory_summary.md' && {reader} '{root}/rollout_summaries/thread.md'"
            );
            assert_eq!(
                memories_usage_from_command(&command),
                vec![
                    (MemoriesUsageKind::MemorySummary, version),
                    (MemoriesUsageKind::RolloutSummaries, version),
                ],
                "memory root: {root}"
            );
        }
    }
}

#[test]
fn attributes_mixed_version_reads_to_their_roots() {
    let command = "cat /tmp/.lime/memories/MEMORY.md \
        && sed -n '1,20p' /tmp/.lime/memories_v2/rollout_summaries/thread.md \
        && cat /tmp/.lime/memories/raw_memories.md \
        && cat /tmp/.lime/memories_v2/skills/testing/SKILL.md";
    assert_eq!(
        memories_usage_from_command(command),
        vec![
            (MemoriesUsageKind::MemoryMd, MemoryVersion::V1),
            (MemoriesUsageKind::RolloutSummaries, MemoryVersion::V2),
            (MemoriesUsageKind::RawMemories, MemoryVersion::V1),
            (MemoriesUsageKind::Skills, MemoryVersion::V2),
        ],
    );
}
