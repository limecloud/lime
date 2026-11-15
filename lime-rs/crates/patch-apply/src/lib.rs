mod apply;
mod invocation;
mod parser;
mod seek_sequence;
mod streaming_parser;
mod text_file;

pub use apply::{
    apply_hunks_to_workdir, apply_patch_to_workdir, AppliedPatchChange, AppliedPatchFileChange,
    ApplyPatchError, ApplyPatchReport,
};
pub use parser::{
    parse_patch, Hunk, ParseError, UpdateFileChunk, ADD_FILE_MARKER,
    BEGIN_PATCH_MARKER, DELETE_FILE_MARKER, END_PATCH_MARKER, UPDATE_FILE_MARKER,
};

/// Both the raw PATCH argument to `apply_patch` as well as the PATCH argument
/// parsed into hunks.
#[derive(Debug, PartialEq)]
pub struct ApplyPatchArgs {
    pub patch: String,
    pub hunks: Vec<Hunk>,
    pub workdir: Option<String>,
    pub environment_id: Option<String>,
}
pub use seek_sequence::seek_sequence;
pub use invocation::{maybe_parse_apply_patch, ExtractHeredocError, MaybeApplyPatch};
pub use streaming_parser::StreamingPatchParser;
