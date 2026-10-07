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
}

impl SlashCommand {
    pub(crate) const ALL: [Self; 16] = [
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
        }
    }

    pub(crate) const fn requires_argument(self) -> bool {
        matches!(self, Self::Effort | Self::Permissions)
    }

    pub(crate) fn description(self, locale: Locale) -> &'static str {
        locale.slash_command_description(self)
    }

    pub(crate) fn from_name(name: &str) -> Option<Self> {
        if name == "cwd" {
            return Some(Self::Pwd);
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
