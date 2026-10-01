//! Tool-mention syntax and path-preserving history encoding, shared with submission lowering.

use agent_protocol::TextElement;
use std::collections::{HashMap, VecDeque};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LinkedMention {
    pub(crate) sigil: char,
    pub(crate) mention: String,
    pub(crate) path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DecodedHistoryText {
    pub(crate) text: String,
    pub(crate) mentions: Vec<LinkedMention>,
    pub(crate) text_elements: Vec<TextElement>,
}

pub(crate) fn encode_history_mentions_at_elements(
    text: &str,
    mentions: &[LinkedMention],
    elements: &[TextElement],
) -> String {
    let mut paths: HashMap<(char, &str), VecDeque<&str>> = HashMap::new();
    for mention in mentions {
        paths
            .entry((mention.sigil, &mention.mention))
            .or_default()
            .push_back(&mention.path);
    }
    let mut out = String::new();
    let mut position = 0;
    for element in elements {
        let range = element.byte_range.start..element.byte_range.end;
        let Some(token) = text.get(range.clone()) else {
            continue;
        };
        if range.start < position || range.is_empty() {
            continue;
        }
        let Some(name) = token
            .strip_prefix('$')
            .filter(|name| !name.is_empty() && name.bytes().all(is_mention_name_char))
        else {
            continue;
        };
        let Some(path) = paths.get_mut(&('$', name)).and_then(VecDeque::pop_front) else {
            continue;
        };
        out.push_str(&text[position..range.start]);
        out.push_str(&format!("[${name}]({path})"));
        position = range.end;
    }
    out.push_str(&text[position..]);
    out
}

pub(crate) fn decode_history_mentions(text: &str) -> DecodedHistoryText {
    let mut decoded = DecodedHistoryText {
        text: String::new(),
        mentions: Vec::new(),
        text_elements: Vec::new(),
    };
    let mut index = 0;
    while index < text.len() {
        if let Some((name, path, end)) =
            parse_linked_tool_mention(text, index, '$').filter(|(name, path, _)| {
                !is_common_env_var(name)
                    && (path.starts_with("skill://")
                        || path
                            .rsplit(['/', '\\'])
                            .next()
                            .is_some_and(|name| name.eq_ignore_ascii_case("SKILL.md")))
            })
        {
            let start = decoded.text.len();
            let token = format!("${name}");
            decoded.text.push_str(&token);
            decoded
                .text_elements
                .push(TextElement::new(start..decoded.text.len(), Some(token)));
            decoded.mentions.push(LinkedMention {
                sigil: '$',
                mention: name.to_string(),
                path: path.to_string(),
            });
            index = end;
        } else {
            let ch = text[index..].chars().next().expect("UTF-8 cursor");
            decoded.text.push(ch);
            index += ch.len_utf8();
        }
    }
    decoded
}

pub(crate) fn parse_linked_tool_mention(
    text: &str,
    start: usize,
    sigil: char,
) -> Option<(&str, &str, usize)> {
    let bytes = text.as_bytes();
    if bytes.get(start) != Some(&b'[') || bytes.get(start + 1) != Some(&(sigil as u8)) {
        return None;
    }
    let name_start = start + 2;
    if !is_mention_name_char(*bytes.get(name_start)?) {
        return None;
    }
    let mut name_end = name_start + 1;
    while bytes
        .get(name_end)
        .is_some_and(|byte| is_mention_name_char(*byte))
    {
        name_end += 1;
    }
    if bytes.get(name_end) != Some(&b']') {
        return None;
    }
    let mut path_start = name_end + 1;
    while bytes.get(path_start).is_some_and(u8::is_ascii_whitespace) {
        path_start += 1;
    }
    if bytes.get(path_start) != Some(&b'(') {
        return None;
    }
    let path_end = path_start + 1 + text.get(path_start + 1..)?.find(')')?;
    let path = text.get(path_start + 1..path_end)?.trim();
    (!path.is_empty()).then(|| (&text[name_start..name_end], path, path_end + 1))
}

pub(crate) fn is_mention_name_char(byte: u8) -> bool {
    matches!(byte, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-')
}

pub(crate) fn is_common_env_var(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "PATH"
            | "HOME"
            | "USER"
            | "SHELL"
            | "PWD"
            | "TMPDIR"
            | "TEMP"
            | "TMP"
            | "LANG"
            | "TERM"
            | "XDG_CONFIG_HOME"
    )
}

#[cfg(test)]
#[path = "mention_codec_tests.rs"]
mod tests;
