// Adapted from upstream `protocol/src/permissions*` and the
// `SandboxPolicy`/`NetworkAccess`/`WritableRoot` types of
// `protocol/src/protocol.rs` at
// 1885417cd45a8da5bfdeb7864a5380a7481d48f2 (Apache-2.0); see licenses/OpenAI-NOTICE.txt.
//!
//! Domain filesystem/network sandbox policy. Serialized wire DTOs stay in
//! `app-server-protocol`; this crate owns matching, projection and the
//! per-path decisions shared by the sandbox and tool executors.

pub mod permissions;
pub mod sandbox_policy;

pub use permissions::*;
pub use sandbox_policy::*;
