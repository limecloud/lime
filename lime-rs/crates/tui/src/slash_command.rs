use crate::locale::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SlashCommand {
    Model,
    Plan,
    Effort,
    Permissions,
    Status,
    Statusline,
    Title,
    Pwd,
    Copy,
    Export,
    Agents,
    MultiAgents,
    Resume,
    Mcp,
    Raw,
    Vim,
    Init,
    New,
    Rename,
    Compact,
    Archive,
    Delete,
    Fork,
    Review,
    Experimental,
    Quit,
    Clear,
    Config,
    Hooks,
    Skills,
    Keymap,
    Memory,
    Usage,
    Stop,
    Warnings,
    Diff,
    Cd,
    Plugins,
    Mention,
    Goal,
    Memories,
    Recap,
    Ps,
}

impl SlashCommand {
    pub(crate) const ALL: [Self; 43] = [
        Self::Model,
        Self::Plan,
        Self::Effort,
        Self::Permissions,
        Self::Status,
        Self::Statusline,
        Self::Title,
        Self::Pwd,
        Self::Copy,
        Self::Export,
        Self::Agents,
        Self::MultiAgents,
        Self::Resume,
        Self::Mcp,
        Self::Raw,
        Self::Vim,
        Self::Init,
        Self::New,
        Self::Rename,
        Self::Compact,
        Self::Archive,
        Self::Delete,
        Self::Fork,
        Self::Review,
        Self::Experimental,
        Self::Quit,
        Self::Clear,
        Self::Config,
        Self::Hooks,
        Self::Skills,
        Self::Keymap,
        Self::Memory,
        Self::Usage,
        Self::Stop,
        Self::Warnings,
        Self::Diff,
        Self::Cd,
        Self::Plugins,
        Self::Mention,
        Self::Goal,
        Self::Memories,
        Self::Recap,
        Self::Ps,
    ];

    pub(crate) const fn command(self) -> &'static str {
        match self {
            Self::Model => "model",
            Self::Plan => "plan",
            Self::Effort => "effort",
            Self::Permissions => "permissions",
            Self::Status => "status",
            Self::Statusline => "statusline",
            Self::Title => "title",
            Self::Pwd => "pwd",
            Self::Copy => "copy",
            Self::Export => "export",
            Self::Agents => "agents",
            Self::MultiAgents => "subagents",
            Self::Resume => "resume",
            Self::Mcp => "mcp",
            Self::Raw => "raw",
            Self::Vim => "vim",
            Self::Init => "init",
            Self::New => "new",
            Self::Rename => "rename",
            Self::Compact => "compact",
            Self::Archive => "archive",
            Self::Delete => "delete",
            Self::Fork => "fork",
            Self::Review => "review",
            Self::Experimental => "experimental",
            Self::Quit => "quit",
            Self::Clear => "clear",
            Self::Config => "config",
            Self::Hooks => "hooks",
            Self::Skills => "skills",
            Self::Keymap => "keymap",
            Self::Memory => "memory",
            Self::Usage => "usage",
            Self::Stop => "stop",
            Self::Warnings => "warnings",
            Self::Diff => "diff",
            Self::Cd => "cd",
            Self::Plugins => "plugins",
            Self::Mention => "mention",
            Self::Goal => "goal",
            Self::Memories => "memories",
            Self::Recap => "recap",
            Self::Ps => "ps",
        }
    }

    pub(crate) const fn requires_argument(self) -> bool {
        matches!(self, Self::Rename)
    }

    pub(crate) const fn supports_inline_args(self) -> bool {
        matches!(
            self,
            Self::Model
                | Self::Effort
                | Self::Permissions
                | Self::Mcp
                | Self::Export
                | Self::Pwd
                | Self::Rename
        )
    }

    pub(crate) fn description(self, locale: Locale) -> &'static str {
        locale.slash_command_description(self)
    }

    pub(crate) fn from_name(name: &str) -> Option<Self> {
        if name == "cwd" {
            return Some(Self::Pwd);
        }
        if name == "exit" {
            return Some(Self::Quit);
        }
        Self::ALL
            .into_iter()
            .find(|command| command.command() == name)
    }
}

pub(crate) fn command_filter(text: &str) -> Option<&str> {
    let first_line = text.lines().next()?;
    if first_line != text {
        return None;
    }
    let filter = first_line.strip_prefix('/')?;
    (!filter.chars().any(char::is_whitespace)).then_some(filter)
}

pub(crate) fn command_from_prompt(prompt: &str) -> Option<SlashCommand> {
    let name = prompt.split_whitespace().next()?.strip_prefix('/')?;
    SlashCommand::from_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_only_accepts_a_single_leading_command_token() {
        assert_eq!(command_filter("/"), Some(""));
        assert_eq!(command_filter("/mo"), Some("mo"));
        assert_eq!(command_filter("/model "), None);
        assert_eq!(command_filter("hello /model"), None);
        assert_eq!(command_filter("/model\nnext"), None);
    }

    #[test]
    fn command_catalog_is_the_prompt_parser_fact_source() {
        assert_eq!(
            SlashCommand::ALL.map(SlashCommand::command),
            [
                "model",
                "plan",
                "effort",
                "permissions",
                "status",
                "statusline",
                "title",
                "pwd",
                "copy",
                "export",
                "agents",
                "subagents",
                "resume",
                "mcp",
                "raw",
                "vim",
                "init",
                "new",
                "rename",
                "compact",
                "archive",
                "delete",
                "fork",
                "review",
                "experimental",
                "quit",
                "clear",
                "config",
                "hooks",
                "skills",
                "keymap",
                "memory",
                "usage",
                "stop",
                "warnings",
                "diff",
                "cd",
                "plugins",
                "mention",
                "goal",
                "memories",
                "recap",
                "ps",
            ]
        );
        for command in SlashCommand::ALL {
            let prompt = format!("/{}", command.command());
            assert_eq!(command_from_prompt(&prompt), Some(command));
        }
        assert_eq!(command_from_prompt("/unknown"), None);
        assert_eq!(command_from_prompt("ordinary input"), None);
        assert_eq!(command_from_prompt("/cwd"), Some(SlashCommand::Pwd));
    }
}
