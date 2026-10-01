use super::*;

pub(super) fn plain(lines: &[Line<'static>]) -> Vec<String> {
    lines
        .iter()
        .map(|line| {
            line.spans
                .iter()
                .map(|span| span.content.as_ref())
                .collect()
        })
        .collect()
}

#[test]
fn unified_diff_uses_stable_line_numbers_and_gutter_signs() {
    let lines = render(
        "@@ -98,3 +98,3 @@\n line 98\n-line 99\n+line 99 changed\n line 100",
        None,
        Path::new(""),
    );

    assert_eq!(
        plain(&lines),
        vec![
            "  98  line 98",
            "  99 -line 99",
            "  99 +line 99 changed",
            " 100  line 100",
        ]
    );
    assert_eq!(lines[1].spans[1].style.fg, Some(Color::Red));
    assert_eq!(lines[2].spans[1].style.fg, Some(Color::Green));
}

#[test]
fn file_metadata_and_unscoped_additions_keep_distinct_styles() {
    let lines = render(
        "updated src/lib.rs\n--- a/src/lib.rs\n+++ b/src/lib.rs\n+new",
        None,
        Path::new(""),
    );

    assert_eq!(lines[0].spans[0].style.fg, Some(Color::Blue));
    assert_eq!(lines[1].spans[0].style.fg, Some(Color::DarkGray));
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::DarkGray));
    assert_eq!(lines[3].spans[1].style.fg, Some(Color::Green));
}

#[test]
fn long_diff_lines_wrap_with_an_aligned_continuation_gutter() {
    let lines = render(
        "@@ -123 +123 @@\n+alpha界beta-gamma",
        Some(15),
        Path::new(""),
    );

    assert_eq!(plain(&lines), vec![" 123 +alpha界be", "      ta-gamma"]);
    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .map(|span| display_width(span.content.as_ref()))
            .sum::<usize>()
            <= 15
    }));
}

#[test]
fn one_column_wrap_uses_a_visible_placeholder_for_wide_graphemes() {
    assert_eq!(hard_wrap("界", 1), vec!["…"]);
}

#[test]
fn narrow_wrap_preserves_emoji_and_cjk_graphemes() {
    let wrapped = hard_wrap("🚀界e", 4);

    assert_eq!(wrapped, vec!["🚀界", "e"]);
    assert!(wrapped.iter().all(|line| display_width(line) <= 4));
}

#[test]
fn fallback_wrapping_uses_display_width_for_tabs_and_wide_chars() {
    let lines = render("@@ -1 +1 @@\n+abcd\t界🙂", Some(8), Path::new(""));

    assert!(lines.len() >= 2, "expected wrapped output, got {lines:?}");
    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .map(|span| display_width(span.content.as_ref()))
            .sum::<usize>()
            <= 8
    }));
}

#[test]
fn tabs_and_blank_context_lines_preserve_diff_geometry() {
    let lines = render("@@ -1,2 +1,2 @@\n \n-\told\n+\tnew", None, Path::new(""));

    assert_eq!(
        plain(&lines),
        vec!["   1  ", "   2 -    old", "   2 +    new",]
    );
}

#[test]
fn file_blocks_show_counts_relative_paths_renames_and_unscoped_line_numbers() {
    let lines = render(
        "added /workspace/src/new.rs\n+one\n+two\nupdated /workspace/src/old.rs → /workspace/src/current.rs\n@@ -8 +8 @@\n-old\n+new",
        None,
        Path::new("/workspace"),
    );

    assert_eq!(
        plain(&lines),
        vec![
            "added src/new.rs (+2 -0)",
            "   1 +one",
            "   2 +two",
            "updated src/old.rs → src/current.rs (+1 -1)",
            "   8 -old",
            "   8 +new",
        ]
    );
}

#[test]
fn multiple_hunks_use_a_vertical_ellipsis_instead_of_protocol_headers() {
    let lines = render(
        "updated example.txt\n@@ -1,2 +1,2 @@\n one\n-old\n+new\n@@ -8,2 +8,2 @@\n eight\n-nine\n+nine changed",
        None,
        Path::new(""),
    );
    let text = plain(&lines);

    assert_eq!(text[0], "updated example.txt (+2 -2)");
    assert!(text.iter().any(|line| line.trim() == "⋮"));
    assert!(text.iter().all(|line| !line.starts_with("@@")));
    assert!(text.iter().any(|line| line.contains("8  eight")));
    assert!(text.iter().any(|line| line.contains("9 +nine changed")));
}

#[test]
fn diff_uses_file_extension_for_syntax_highlighting() {
    let lines = render(
        "updated src/lib.rs\n@@ -1 +1 @@\n-pub fn old() {}\n+pub fn current() {}",
        None,
        Path::new(""),
    );
    let inserted = &lines[2];

    assert!(inserted.spans.len() > 3);
    assert!(inserted.spans.iter().skip(2).any(|span| {
        span.content.contains("fn")
            && span.style.fg.is_some()
            && span.style.fg != Some(Color::Green)
    }));
}

#[test]
fn rename_uses_destination_extension_for_syntax_highlighting() {
    let lines = render(
        "updated src/lib.unknown → src/lib.rs\n@@ -1 +1 @@\n-old\n+pub fn current() {}",
        None,
        Path::new(""),
    );
    let inserted = &lines[2];

    assert!(inserted.spans.len() > 3);
    assert!(inserted
        .spans
        .iter()
        .skip(2)
        .any(|span| span.content.contains("fn") && span.style.fg.is_some()));
}

#[test]
fn unknown_extension_keeps_plain_diff_coloring() {
    let lines = render("added src/data.unknown\n+plain value", None, Path::new(""));

    assert_eq!(
        plain(&lines),
        vec!["added src/data.unknown (+1 -0)", "   1 +plain value"]
    );
    assert_eq!(lines[1].spans.len(), 3);
    assert_eq!(lines[1].spans[2].style.fg, Some(Color::Green));
}

#[test]
fn syntax_highlighted_diff_wraps_without_losing_text_or_width() {
    let lines = render(
        "added src/lib.rs\n+pub fn long_name(answer: usize) -> usize { answer + 1 }",
        Some(32),
        Path::new(""),
    );

    assert!(lines.len() > 2);
    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .map(|span| display_width(span.content.as_ref()))
            .sum::<usize>()
            <= 32
    }));
    let content = plain(&lines[1..])
        .into_iter()
        .filter_map(|line| line.get(6..).map(str::to_string))
        .collect::<String>();
    assert_eq!(
        content,
        "pub fn long_name(answer: usize) -> usize { answer + 1 }"
    );
    assert!(lines
        .iter()
        .skip(1)
        .flat_map(|line| &line.spans)
        .any(|span| {
            span.content.contains("fn")
                && span.style.fg.is_some()
                && span.style.fg != Some(Color::Green)
        }));
}

#[test]
fn diff_keeps_independent_multiline_syntax_state_for_old_and_new_files() {
    let lines = render(
        "updated demo.rs\n@@ -1,3 +1,4 @@\n fn demo() {\n-let value = \"old\";\n+let value = \"hello\n+world\";\n }",
        None,
        Path::new(""),
    );
    let expected = crate::render::highlight::highlight_code_to_styled_spans(
        "fn demo() {\nlet value = \"hello\nworld\";\n}",
        "rust",
    )
    .expect("Rust highlighting");
    let expected_style = expected[2]
        .iter()
        .find(|span| span.content.contains("world"))
        .expect("multiline string span")
        .style;
    let actual_style = lines[4]
        .spans
        .iter()
        .skip(2)
        .find(|span| span.content.contains("world"))
        .expect("rendered multiline string span")
        .style;

    assert_eq!(
        actual_style,
        current_diff_render_style_context().readable(expected_style, DiffLineKind::Insert),
    );
}

#[test]
fn deleted_raw_diff_keeps_source_extension_when_destination_is_dev_null() {
    let lines = render(
        "diff --git a/src/lib.rs b/src/lib.rs\n--- a/src/lib.rs\n+++ /dev/null\n@@ -1 +0,0 @@\n-pub fn removed() {}",
        None,
        Path::new(""),
    );
    let deleted = lines.last().expect("deleted line");

    assert!(deleted.spans.len() > 3);
    assert!(deleted
        .spans
        .iter()
        .skip(2)
        .any(|span| span.content.contains("fn") && span.style.fg.is_some()));
}

#[test]
fn add_details() {
    let lines = render("added src/new.rs\n+one", None, Path::new(""));
    assert_eq!(plain(&lines)[0], "added src/new.rs (+1 -0)");
    assert!(plain(&lines).iter().any(|line| line.contains("one")));
}

#[test]
fn ansi16_insert_delete_no_background() {
    for background in [(0, 0, 0), (255, 255, 255)] {
        let style = DiffRenderStyleContext::new(
            Some(crate::terminal_palette::DefaultColors {
                fg: (128, 128, 128),
                bg: background,
            }),
            crate::terminal_palette::StdoutColorLevel::Ansi16,
        );
        let lines = render_with_style("@@ -1 +1 @@\n-old\n+new", None, Path::new(""), style);
        assert!(lines.iter().all(|line| line.style.bg.is_none()));
        assert!(lines
            .iter()
            .flat_map(|line| &line.spans)
            .all(|span| span.style.bg.is_none()));
        assert_eq!(lines[0].spans[1].style.fg, Some(Color::Red));
        assert_eq!(lines[1].spans[1].style.fg, Some(Color::Green));
        assert_eq!(lines[0].spans[2].style.fg, Some(Color::Red));
        assert_eq!(lines[1].spans[2].style.fg, Some(Color::Green));
    }
}

#[test]
fn apply_add_block() {
    let lines = render("added new_file.txt\n+alpha\n+beta", None, Path::new(""));
    assert_eq!(
        plain(&lines),
        vec!["added new_file.txt (+2 -0)", "   1 +alpha", "   2 +beta",]
    );
}

#[test]
fn apply_delete_block() {
    let lines = render("deleted old_file.txt\n-first\n-second", None, Path::new(""));
    assert!(plain(&lines)[0].contains("deleted old_file.txt"));
    assert!(plain(&lines).iter().any(|line| line.contains("first")));
    assert!(plain(&lines).iter().any(|line| line.contains("second")));
}

#[test]
fn apply_multiple_files_block() {
    let lines = render(
        "updated a.txt\n@@ -1 +1 @@\n-one\n+one changed\nadded b.txt\n+new",
        None,
        Path::new(""),
    );
    let text = plain(&lines).join("\n");
    assert!(text.contains("updated a.txt"));
    assert!(text.contains("added b.txt"));
    assert!(text.contains("one changed"));
}

#[test]
fn apply_update_block() {
    let lines = render(
        "updated example.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two changed\n line three",
        None,
        Path::new(""),
    );
    assert!(plain(&lines)
        .iter()
        .any(|line| line.contains("line two changed")));
    assert!(plain(&lines).iter().any(|line| line.contains("line three")));
}

#[test]
fn apply_update_block_line_numbers_three_digits_text() {
    let lines = render(
        "updated hundreds.txt\n@@ -100 +100 @@\n-old\n+new",
        None,
        Path::new(""),
    );
    assert!(plain(&lines).iter().any(|line| line.contains("100 -old")));
    assert!(plain(&lines).iter().any(|line| line.contains("100 +new")));
}

#[test]
fn apply_update_block_relativizes_path() {
    let lines = render(
        "updated /workspace/src/lib.rs\n@@ -1 +1 @@\n-old\n+new",
        None,
        Path::new("/workspace"),
    );
    assert!(plain(&lines)[0].contains("src/lib.rs"));
    assert!(!plain(&lines)[0].contains("/workspace/src"));
}

#[test]
fn apply_update_block_wraps_long_lines() {
    let lines = render(
        "added long.txt\n+this is a very long line that must wrap across several terminal columns",
        Some(24),
        Path::new(""),
    );
    assert!(lines.len() > 2);
    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .map(|span| display_width(span.content.as_ref()))
            .sum::<usize>()
            <= 24
    }));
}

#[test]
fn apply_update_block_wraps_long_lines_text() {
    let lines = render(
        "added wrap.txt\n+abcdefghijklmnopqrstuvwxyz",
        Some(12),
        Path::new(""),
    );
    assert!(lines.len() > 2);
    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .map(|span| display_width(span.content.as_ref()))
            .sum::<usize>()
            <= 12
    }));
}

#[test]
fn apply_update_with_rename_block() {
    let lines = render(
        "updated old_name.rs → new_name.rs\n@@ -1 +1 @@\n-old\n+new",
        None,
        Path::new(""),
    );
    assert!(plain(&lines)[0].contains("old_name.rs → new_name.rs"));
}

#[test]
fn blank_context_line() {
    let lines = render("@@ -1,2 +1,2 @@\n \n+new", None, Path::new(""));
    assert!(lines.len() >= 2);
    assert!(plain(&lines).iter().any(|line| line.contains("new")));
}

#[test]
fn cpp_module_extension_highlighting() {
    let lines = render(
        "added src/module.ixx\n+export module demo;",
        None,
        Path::new(""),
    );
    assert!(lines
        .iter()
        .flat_map(|line| &line.spans)
        .any(|span| { span.content.contains("export") && span.style.fg.is_some() }));
}

fn assert_gallery(width: usize) {
    let lines = render(
        "updated src/lib.rs\n@@ -1 +1 @@\n-old\n+new\nadded README.txt\n+hello",
        Some(width),
        Path::new(""),
    );
    assert!(!lines.is_empty());
    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .map(|span| display_width(span.content.as_ref()))
            .sum::<usize>()
            <= width
    }));
}

#[test]
fn diff_gallery_120x40() {
    assert_gallery(120);
}

#[test]
fn diff_gallery_80x24() {
    assert_gallery(80);
}

#[test]
fn diff_gallery_94x35() {
    assert_gallery(94);
}

#[test]
fn single_line_replacement_counts() {
    let lines = render(
        "updated example.txt\n@@ -1 +1 @@\n-old\n+new",
        None,
        Path::new(""),
    );
    assert!(plain(&lines)[0].contains("(+1 -1)"));
}

#[test]
fn syntax_highlighted_insert_wraps() {
    let lines = render(
        "added src/lib.rs\n+pub fn long_name(answer: usize) -> usize { answer + 1 }",
        Some(32),
        Path::new(""),
    );
    assert!(lines.len() > 2);
}

#[test]
fn syntax_highlighted_insert_wraps_text() {
    let lines = render(
        "added src/lib.rs\n+pub fn long_name(answer: usize) -> usize { answer + 1 }",
        Some(32),
        Path::new(""),
    );
    let text = plain(&lines).join("\n");
    assert!(text.contains("long_name"));
    assert!(text.contains("answer"));
}

#[test]
fn fixed_syntax_theme_uses_codex_default_diff_surface() {
    let style =
        DiffRenderStyleContext::new(None, crate::terminal_palette::StdoutColorLevel::Ansi256);
    let lines = render_with_style(
        "added src/lib.rs\n+fn main() {}",
        None,
        Path::new(""),
        style,
    );
    assert_eq!(lines[0].style.bg, None);
    assert_eq!(
        lines[1].style.bg,
        Some(crate::terminal_palette::indexed_color(22))
    );
    assert!(lines[1]
        .spans
        .iter()
        .skip(2)
        .all(|span| span.style.bg.is_none()));
}

#[test]
fn update_details_with_rename() {
    let lines = render(
        "updated old.txt → new.rs\n@@ -1 +1 @@\n-old\n+fn new() {}",
        None,
        Path::new(""),
    );
    assert!(plain(&lines)[0].contains("old.txt → new.rs"));
    assert!(lines
        .iter()
        .flat_map(|line| &line.spans)
        .any(|span| { span.content.contains("fn") && span.style.fg.is_some() }));
}

#[test]
fn vertical_ellipsis_between_hunks() {
    let lines = render(
        "updated example.txt\n@@ -1 +1 @@\n-old\n+new\n@@ -8 +8 @@\n-old\n+new",
        None,
        Path::new(""),
    );
    assert!(plain(&lines).iter().any(|line| line.trim() == "⋮"));
}

#[test]
fn wrap_behavior_insert() {
    let lines = render(
        "added src/lib.rs\n+this is a very long inserted line that should wrap across terminal columns",
        Some(20),
        Path::new(""),
    );
    assert!(lines.len() > 2);
}
