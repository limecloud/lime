use super::super::{TextArea, TextAreaState};
use crate::terminal_hyperlinks::strip_osc8;
use crate::width::display_width;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::StatefulWidgetRef;

type LinkedCell = (u16, u16, String, String);

fn linked_cells(buf: &Buffer) -> Vec<LinkedCell> {
    buf.area
        .positions()
        .filter_map(|position| {
            let symbol = buf[position].symbol();
            let (prefix, rest) = symbol.split_once("\x1b]8;;")?;
            if !prefix.is_empty() {
                return None;
            }
            let (destination, _) = rest.split_once('\x07')?;
            Some((
                position.x,
                position.y,
                strip_osc8(symbol),
                destination.to_string(),
            ))
        })
        .collect()
}

fn linked_text(cells: &[LinkedCell]) -> String {
    cells.iter().map(|(_, _, text, _)| text.as_str()).collect()
}

fn hyperlink_snapshot(buf: &Buffer) -> String {
    (0..buf.area.height)
        .map(|row| {
            let text = (0..buf.area.width)
                .map(|column| strip_osc8(buf[(column, row)].symbol()))
                .collect::<String>();
            format!("|{text}|")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn assert_destination(buf: &Buffer, destination: &str) -> Vec<LinkedCell> {
    let linked = linked_cells(buf);
    assert!(!linked.is_empty(), "expected OSC 8 cells for {destination}");
    assert!(linked.iter().all(|(_, _, _, target)| target == destination));
    linked
}

fn render(text: &str, width: u16, height: u16) -> (TextArea, TextAreaState, Buffer) {
    let mut textarea = TextArea::new();
    textarea.insert_str(text);
    let area = Rect::new(0, 0, width, height);
    let mut buf = Buffer::empty(area);
    let mut state = TextAreaState::default();
    StatefulWidgetRef::render_ref(&(&textarea), area, &mut buf, &mut state);
    (textarea, state, buf)
}

#[test]
fn wrapped_url_fragments_keep_the_complete_destination() {
    let url = "https://github.com/openai/codex/pull/20252";
    let (_, _, buf) = render(&format!("Fix CI on {url}"), 26, 5);
    let linked = assert_destination(&buf, url);
    assert_eq!(linked_text(&linked), url);
    assert!(linked.windows(2).any(|pair| pair[0].1 != pair[1].1));
}

#[test]
fn composer_wrapped_url_fragments_keep_the_complete_destination() {
    let url = "https://github.com/openai/codex/pull/20252";
    let mut app = crate::app::App::default();
    app.chat_widget
        .bottom_pane
        .composer
        .insert(&format!("Fix CI on {url}"));
    let backend = ratatui::backend::TestBackend::new(34, 8);
    let mut terminal = ratatui::Terminal::new(backend).expect("terminal");
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .expect("draw");
    let linked = assert_destination(terminal.backend().buffer(), url);
    assert_eq!(linked_text(&linked), url);
    assert!(linked.windows(2).any(|pair| pair[0].1 != pair[1].1));
}

#[test]
fn scrolled_url_fragments_keep_the_offscreen_destination() {
    let url = "https://example.test/alpha/beta/gamma/delta/epsilon";
    let (_, state, buf) = render(url, 16, 2);
    let visible_url = linked_text(&assert_destination(&buf, url));
    assert!(state.scroll > 0);
    assert_ne!(visible_url, url);
    assert!(url.ends_with(&visible_url));
}

#[test]
fn long_drafts_reuse_hyperlink_detection_across_cursor_redraws() {
    let text = "x".repeat(64 * 1024);
    let (mut textarea, mut state, mut buf) = render(&text, 80, 2);
    let area = buf.area;

    let first_cache = {
        let cache = textarea.wrap_cache.borrow();
        let hyperlinks = cache
            .as_ref()
            .expect("wrap cache")
            .hyperlinks
            .get()
            .unwrap();
        hyperlinks as *const super::HyperlinkCache
    };

    textarea.set_cursor(text.len() - 1);
    StatefulWidgetRef::render_ref(&(&textarea), area, &mut buf, &mut state);

    let cache = textarea.wrap_cache.borrow();
    let second_cache = cache
        .as_ref()
        .expect("wrap cache")
        .hyperlinks
        .get()
        .unwrap();
    assert!(std::ptr::eq(first_cache, second_cache));
}

#[test]
fn hyperlink_cache_is_invalidated_when_text_changes() {
    let (_, _, _) = render("https://example.test/a", 20, 2);
    let mut textarea = TextArea::new();
    textarea.insert_str("https://example.test/a");
    let area = Rect::new(0, 0, 20, 2);
    let mut buf = Buffer::empty(area);
    let mut state = TextAreaState::default();
    StatefulWidgetRef::render_ref(&(&textarea), area, &mut buf, &mut state);
    assert!(!textarea
        .wrap_cache
        .borrow()
        .as_ref()
        .expect("wrap cache")
        .hyperlinks
        .get()
        .expect("hyperlink cache")
        .hyperlinks
        .is_empty());

    textarea.replace("plain text".to_string());
    StatefulWidgetRef::render_ref(&(&textarea), area, &mut buf, &mut state);
    assert!(textarea
        .wrap_cache
        .borrow()
        .as_ref()
        .expect("wrap cache")
        .hyperlinks
        .get()
        .expect("hyperlink cache")
        .hyperlinks
        .is_empty());
}

#[test]
fn joined_emoji_preserve_complete_url_cell_ranges() {
    let url = "https://example.test/👩‍💻/path";
    let (_, _, buf) = render(&format!("👩‍💻 {url} tail"), 16, 6);
    let linked = assert_destination(&buf, url);
    assert_eq!(linked_text(&linked), url);
    assert!(linked
        .iter()
        .all(|(x, _, text, _)| { usize::from(*x) + display_width(text) <= 16 }));
}

#[test]
fn maximum_length_urls_render_without_osc8_annotations() {
    let prefix = "https://example.test/";
    let text = format!("{prefix}{}", "a".repeat(8 * 1024));
    let (_, _, buf) = render(&text, 80, 2);
    assert!(linked_cells(&buf).is_empty());
    assert!(!hyperlink_snapshot(&buf).contains("\x1b]8;;"));
}

#[test]
fn distinct_urls_respect_punctuation_wide_prefixes_and_tabs() {
    let first = "https://one.test/a";
    let second = "https://two.test/b";
    let (_, _, buf) = render(&format!("界 {first},\t{second}"), 20, 6);
    for destination in [first, second] {
        let cells = linked_cells(&buf)
            .into_iter()
            .filter(|(_, _, _, target)| target == destination)
            .collect::<Vec<_>>();
        assert_eq!(linked_text(&cells), destination);
    }
}

#[test]
fn many_urls_render_with_the_complete_destination() {
    let destination = "https://x.io";
    let text = format!("{destination} ").repeat(1_000);
    let (_, state, buf) = render(&text, 80, 2);
    assert!(state.scroll > 0);
    assert_destination(&buf, destination);
}

#[test]
fn unicode_whitespace_separates_url_destinations() {
    let first = "https://one.test/a";
    let second = "https://two.test/b";
    for separator in ['\u{2003}', '\u{a0}', '\u{2007}', '\u{202f}', '\u{2028}'] {
        let (_, _, buf) = render(&format!("{first}{separator}{second}"), 20, 4);
        for destination in [first, second] {
            let cells = linked_cells(&buf)
                .into_iter()
                .filter(|(_, _, _, target)| target == destination)
                .collect::<Vec<_>>();
            assert_eq!(linked_text(&cells), destination);
        }
    }
}

#[test]
fn masked_url_input_never_exposes_hyperlink_destinations() {
    let url = "https://example.test/secret";
    let mut textarea = TextArea::new();
    textarea.insert_str(url);
    let area = Rect::new(0, 0, 40, 2);
    let mut buf = Buffer::empty(area);
    let mut state = TextAreaState::default();
    textarea.render_ref_masked(area, &mut buf, &mut state, '*');

    assert!(linked_cells(&buf).is_empty());
    let visible = (0..area.width)
        .map(|column| strip_osc8(buf[(column, 0)].symbol()))
        .collect::<String>();
    assert!(visible.trim().chars().all(|character| character == '*'));
    assert!(!visible.contains("example.test"));
}

#[test]
fn url_hyperlinks_preserve_existing_highlight_styles() {
    let url = "https://example.test/highlight";
    let mut textarea = TextArea::new();
    textarea.insert_str(url);
    let area = Rect::new(0, 0, 40, 2);
    let mut buf = Buffer::empty(area);
    let mut state = TextAreaState::default();
    let style = ratatui::style::Style::default().fg(ratatui::style::Color::Yellow);
    textarea.render_ref_styled_with_highlights(
        area,
        &mut buf,
        &mut state,
        ratatui::style::Style::default(),
        &[(0..url.len(), style)],
    );

    let linked = assert_destination(&buf, url);
    assert_eq!(linked_text(&linked), url);
    assert!(buf[(0, 0)].style().fg == Some(ratatui::style::Color::Yellow));
}
