//! Rendering helpers for Lime-native command execution cells.

use crate::locale::Locale;

use super::model::CommandOutput;

pub(crate) struct OutputLinesParams {
    pub(crate) line_limit: usize,
    pub(crate) only_err: bool,
    pub(crate) include_angle_pipe: bool,
    pub(crate) include_prefix: bool,
    pub(crate) locale: Locale,
}

pub(crate) struct OutputLines {
    pub(crate) lines: Vec<String>,
    pub(crate) omitted: Option<usize>,
}

pub(crate) fn output_lines(
    output: Option<&CommandOutput>,
    params: OutputLinesParams,
) -> OutputLines {
    let OutputLinesParams {
        line_limit,
        only_err,
        include_angle_pipe,
        include_prefix,
        locale,
    } = params;
    let Some(output) = output else {
        return OutputLines {
            lines: Vec::new(),
            omitted: None,
        };
    };
    if only_err && output.exit_code == 0 {
        return OutputLines {
            lines: Vec::new(),
            omitted: None,
        };
    }

    let (total, retained) = output.line_counts();
    let retained_lines = output.lines();
    let head_end = total.min(line_limit).min(retained);
    let mut lines = retained_lines
        .iter()
        .take(head_end)
        .enumerate()
        .map(|(index, line)| {
            let prefix = if !include_prefix {
                ""
            } else if index == 0 && include_angle_pipe {
                "  └ "
            } else {
                "    "
            };
            format!("{prefix}{line}")
        })
        .collect::<Vec<_>>();

    let tail_len = total
        .saturating_sub(head_end)
        .min(line_limit)
        .min(retained.saturating_sub(head_end));
    let omitted = total.saturating_sub(head_end + tail_len);
    let omitted = (omitted > 0).then_some(omitted);
    if let Some(omitted) = omitted {
        lines.push(locale.output_omitted_lines(omitted));
    }

    let tail_start = retained_lines.len().saturating_sub(tail_len);
    lines.extend(retained_lines[tail_start..].iter().map(|line| {
        if include_prefix {
            format!("    {line}")
        } else {
            line.clone()
        }
    }));

    OutputLines { lines, omitted }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_line_command_compact_when_fits() {
        let output = CommandOutput::new(0, "ok".to_string());
        let rendered = output_lines(
            Some(&output),
            OutputLinesParams {
                line_limit: 5,
                only_err: false,
                include_angle_pipe: false,
                include_prefix: false,
                locale: Locale::EnUs,
            },
        );
        assert_eq!(rendered.lines, vec!["ok"]);
        assert_eq!(rendered.omitted, None);
    }
}
