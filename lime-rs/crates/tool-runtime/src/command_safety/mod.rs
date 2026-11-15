mod powershell_tree_sitter;

pub mod is_dangerous_command;
pub(crate) use powershell_tree_sitter::try_parse_powershell_commands;
