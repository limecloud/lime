//! Lime-native command execution cells backed by Lime's canonical transcript projection.

mod live_output;
mod model;
mod render;

pub(crate) use model::CommandOutput;
pub(crate) use render::{output_lines, OutputLines, OutputLinesParams};
