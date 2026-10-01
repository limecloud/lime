use super::*;

#[test]
fn linked_syntax_preserves_utf8_offsets_and_rejects_malformed_links() {
    let text = "界 [$review-1] \n ( skill://路径/SKILL.md ) tail";
    assert_eq!(
        parse_linked_tool_mention(text, 4, '$'),
        Some(("review-1", "skill://路径/SKILL.md", text.len() - 5))
    );
    for text in [
        "[$](/SKILL.md)",
        "[$x]()",
        "[$x](/SKILL.md",
        "[$x.name](/SKILL.md)",
        "[@x](/SKILL.md)",
    ] {
        assert_eq!(parse_linked_tool_mention(text, 0, '$'), None, "{text}");
    }
}

#[test]
fn history_encoding_preserves_duplicate_paths_and_ignores_literal_tokens() {
    let text = "$review 界 $review $review";
    let start = "$review 界 ".len();
    let mentions = vec![
        LinkedMention {
            sigil: '$',
            mention: "review".into(),
            path: "/one/SKILL.md".into(),
        },
        LinkedMention {
            sigil: '$',
            mention: "review".into(),
            path: "/two/SKILL.md".into(),
        },
    ];
    let elements = vec![
        TextElement::new(start..start + 7, Some("$review".into())),
        TextElement::new(start + 8..text.len(), Some("$review".into())),
    ];
    let encoded = encode_history_mentions_at_elements(text, &mentions, &elements);
    assert_eq!(
        encoded,
        "$review 界 [$review](/one/SKILL.md) [$review](/two/SKILL.md)"
    );
    assert_eq!(
        decode_history_mentions(&encoded),
        DecodedHistoryText {
            text: text.into(),
            mentions,
            text_elements: elements
        }
    );
    assert_eq!(
        decode_history_mentions("[$HOME](/tmp/SKILL.md) [$x](https://example.test)").mentions,
        Vec::new()
    );
}
