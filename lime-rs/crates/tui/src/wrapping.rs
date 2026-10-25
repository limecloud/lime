//! Lime-native terminal line wrapping with URL-aware heuristics.
//!
//! Wrapping remains a render concern: the canonical Thread/Turn/Item model is
//! never rewritten. The module preserves ratatui span styles while ensuring
//! URLs are not split at `/` or `-`.

use std::borrow::Cow;
use std::ops::Range;

use ratatui::text::{Line, Span};
use textwrap::core::Word;
use textwrap::word_splitters::split_words;
use textwrap::{Options, WordSeparator, WordSplitter};
use unicode_segmentation::UnicodeSegmentation;

use crate::line_truncation::line_width;
use crate::render::line_utils::push_owned_lines;
use crate::width::display_width;
mod projected;
mod source;
mod url;
use projected::{project_halfwidth_sound_marks, wrap_projected_ranges};
pub(crate) use source::{adaptive_wrap_line_with_source, word_wrap_line_with_source, WrappedLine};
use url::*;
pub(crate) use url::{line_contains_url_like, line_has_mixed_url_and_non_url_tokens};

/// Textwrap options using ratatui lines for styled indentation.
#[derive(Debug, Clone)]
pub(crate) struct RtOptions<'a> {
    pub(crate) width: usize,
    pub(crate) line_ending: textwrap::LineEnding,
    pub(crate) initial_indent: Line<'a>,
    pub(crate) subsequent_indent: Line<'a>,
    pub(crate) break_words: bool,
    pub(crate) wrap_algorithm: textwrap::WrapAlgorithm,
    pub(crate) word_separator: textwrap::WordSeparator,
    pub(crate) word_splitter: textwrap::WordSplitter,
}

impl From<usize> for RtOptions<'_> {
    fn from(width: usize) -> Self {
        Self::new(width)
    }
}

impl<'a> RtOptions<'a> {
    pub(crate) fn new(width: usize) -> Self {
        Self {
            width,
            line_ending: textwrap::LineEnding::LF,
            initial_indent: Line::default(),
            subsequent_indent: Line::default(),
            break_words: true,
            wrap_algorithm: textwrap::WrapAlgorithm::FirstFit,
            word_separator: WordSeparator::new(),
            word_splitter: WordSplitter::HyphenSplitter,
        }
    }

    pub(crate) fn initial_indent(self, value: Line<'a>) -> Self {
        Self {
            initial_indent: value,
            ..self
        }
    }

    #[allow(dead_code)]
    pub(crate) fn subsequent_indent(self, value: Line<'a>) -> Self {
        Self {
            subsequent_indent: value,
            ..self
        }
    }

    pub(crate) fn break_words(self, value: bool) -> Self {
        Self {
            break_words: value,
            ..self
        }
    }

    pub(crate) fn word_separator(self, value: WordSeparator) -> Self {
        Self {
            word_separator: value,
            ..self
        }
    }

    #[allow(dead_code)]
    pub(crate) fn wrap_algorithm(self, value: textwrap::WrapAlgorithm) -> Self {
        Self {
            wrap_algorithm: value,
            ..self
        }
    }

    pub(crate) fn word_splitter(self, value: WordSplitter) -> Self {
        Self {
            word_splitter: value,
            ..self
        }
    }
}

/// Return source ranges for wrapped lines, including a one-byte cursor sentinel.
#[allow(dead_code)]
pub(crate) fn wrap_ranges<'a, O>(text: &str, width_or_options: O) -> Vec<Range<usize>>
where
    O: Into<Options<'a>>,
{
    let opts = width_or_options.into();
    if let Some(projected) = project_halfwidth_sound_marks(text) {
        return wrap_projected_ranges(&projected, &opts, /*include_trailing_spaces*/ true);
    }
    let mut lines: Vec<Range<usize>> = Vec::new();
    let mut cursor = 0usize;
    for (line_index, line) in textwrap::wrap(text, &opts).iter().enumerate() {
        match line {
            std::borrow::Cow::Borrowed(slice) => {
                let range = borrowed_slice_range(text, slice).unwrap_or_else(|| {
                    let synthetic_prefix = if line_index == 0 {
                        opts.initial_indent
                    } else {
                        opts.subsequent_indent
                    };
                    map_owned_wrapped_line_to_range(text, cursor, slice, synthetic_prefix)
                });
                let start = range.start;
                let end = range.end;
                let trailing_spaces = text[end..].chars().take_while(|c| *c == ' ').count();
                lines.push(start..end + trailing_spaces + 1);
                cursor = end + trailing_spaces;
            }
            std::borrow::Cow::Owned(slice) => {
                let synthetic_prefix = if line_index == 0 {
                    opts.initial_indent
                } else {
                    opts.subsequent_indent
                };
                let mapped = map_owned_wrapped_line_to_range(text, cursor, slice, synthetic_prefix);
                let trailing_spaces = text[mapped.end..].chars().take_while(|c| *c == ' ').count();
                lines.push(mapped.start..mapped.end + trailing_spaces + 1);
                cursor = mapped.end + trailing_spaces;
            }
        }
    }
    lines
}

/// Like `wrap_ranges` but returns ranges without trailing whitespace and
/// without the sentinel extra byte. Suitable for general wrapping where
/// trailing spaces should not be preserved.
pub(crate) fn wrap_ranges_trim<'a, O>(text: &str, width_or_options: O) -> Vec<Range<usize>>
where
    O: Into<Options<'a>>,
{
    let opts = width_or_options.into();
    if let Some(projected) = project_halfwidth_sound_marks(text) {
        return wrap_projected_ranges(&projected, &opts, /*include_trailing_spaces*/ false);
    }
    let mut lines: Vec<Range<usize>> = Vec::new();
    let mut cursor = 0usize;
    for (line_index, line) in textwrap::wrap(text, &opts).iter().enumerate() {
        match line {
            std::borrow::Cow::Borrowed(slice) => {
                let range = borrowed_slice_range(text, slice).unwrap_or_else(|| {
                    let synthetic_prefix = if line_index == 0 {
                        opts.initial_indent
                    } else {
                        opts.subsequent_indent
                    };
                    map_owned_wrapped_line_to_range(text, cursor, slice, synthetic_prefix)
                });
                cursor = range.end;
                lines.push(range);
            }
            std::borrow::Cow::Owned(slice) => {
                let synthetic_prefix = if line_index == 0 {
                    opts.initial_indent
                } else {
                    opts.subsequent_indent
                };
                let mapped = map_owned_wrapped_line_to_range(text, cursor, slice, synthetic_prefix);
                lines.push(mapped.clone());
                cursor = mapped.end;
            }
        }
    }
    lines
}

fn borrowed_slice_range(text: &str, slice: &str) -> Option<Range<usize>> {
    let text_start = text.as_ptr() as usize;
    let text_end = text_start.checked_add(text.len())?;
    let slice_start = slice.as_ptr() as usize;
    let slice_end = slice_start.checked_add(slice.len())?;

    if slice_start < text_start || slice_end > text_end {
        return None;
    }

    Some((slice_start - text_start)..(slice_end - text_start))
}

/// Maps an owned (materialized) wrapped line back to a byte range in `text`.
fn map_owned_wrapped_line_to_range(
    text: &str,
    cursor: usize,
    wrapped: &str,
    synthetic_prefix: &str,
) -> Range<usize> {
    let wrapped = if synthetic_prefix.is_empty() {
        wrapped
    } else {
        wrapped.strip_prefix(synthetic_prefix).unwrap_or(wrapped)
    };

    let mut start = cursor;
    while start < text.len() && !wrapped.starts_with(' ') {
        let Some(ch) = text[start..].chars().next() else {
            break;
        };
        if ch != ' ' {
            break;
        }
        start += ch.len_utf8();
    }

    let mut end = start;
    let mut saw_source_char = false;
    let mut chars = wrapped.chars().peekable();
    while let Some(ch) = chars.next() {
        if end < text.len() {
            let Some(src) = text[end..].chars().next() else {
                unreachable!("checked end < text.len()");
            };
            if ch == src {
                end += src.len_utf8();
                saw_source_char = true;
                continue;
            }
        }

        // textwrap can materialize owned lines when penalties are inserted.
        // The default penalty is a trailing '-'; it does not correspond to
        // source bytes, so we skip it while keeping byte ranges in source text.
        if ch == '-' && chars.peek().is_none() {
            continue;
        }

        // Non-source chars can be synthesized by textwrap in owned output
        // (e.g. non-space indent prefixes). Keep going and map the source bytes
        // we can confidently match instead of crashing the app.
        if !saw_source_char {
            continue;
        }

        tracing::warn!(
            wrapped = %wrapped,
            cursor,
            end,
            "wrap_ranges: could not fully map owned line; returning partial source range"
        );
        break;
    }

    start..end
}

/// Wraps a single ratatui `Line`, automatically switching to URL-preserving
/// options when the line contains a URL-like token.
#[must_use]
pub(crate) fn adaptive_wrap_line<'a>(line: &'a Line<'a>, base: RtOptions<'a>) -> Vec<Line<'a>> {
    adaptive_wrap_line_with_source(line, base)
        .into_iter()
        .map(|wrapped| wrapped.line)
        .collect()
}

/// Wraps multiple input lines with URL-aware heuristics, applying
/// `initial_indent` to the first line and `subsequent_indent` to the rest.
#[allow(private_bounds)]
pub(crate) fn adaptive_wrap_lines<'a, I, L>(
    lines: I,
    width_or_options: RtOptions<'a>,
) -> Vec<Line<'static>>
where
    I: IntoIterator<Item = L>,
    L: IntoLineInput<'a>,
{
    let base_opts = width_or_options;
    let mut out = Vec::new();

    for (idx, line) in lines.into_iter().enumerate() {
        let line_input = line.into_line_input();
        let opts = if idx == 0 {
            base_opts.clone()
        } else {
            base_opts
                .clone()
                .initial_indent(base_opts.subsequent_indent.clone())
        };

        let wrapped = adaptive_wrap_line(line_input.as_ref(), opts);
        push_owned_lines(&wrapped, &mut out);
    }

    out
}

#[must_use]
pub(crate) fn word_wrap_line<'a, O>(line: &'a Line<'a>, width_or_options: O) -> Vec<Line<'a>>
where
    O: Into<RtOptions<'a>>,
{
    word_wrap_line_with_source(line, width_or_options)
        .into_iter()
        .map(|wrapped| wrapped.line)
        .collect()
}

fn word_wrap_flattened_line<'a>(
    line: &'a Line<'a>,
    flat: &str,
    span_bounds: &[(Range<usize>, ratatui::style::Style)],
    rt_opts: RtOptions<'a>,
) -> Vec<WrappedLine<'a>> {
    let opts = Options::new(rt_opts.width)
        .line_ending(rt_opts.line_ending)
        .break_words(rt_opts.break_words)
        .wrap_algorithm(rt_opts.wrap_algorithm)
        .word_separator(rt_opts.word_separator)
        .word_splitter(rt_opts.word_splitter);

    let initial_width_available = opts
        .width
        .saturating_sub(line_width(&rt_opts.initial_indent))
        .max(1);
    let initial_wrapped = wrap_ranges_trim(flat, opts.clone().width(initial_width_available));
    let Some(first_line_range) = initial_wrapped.first() else {
        return vec![WrappedLine {
            line: rt_opts.initial_indent.clone(),
            range: 0..0,
            prefix_bytes: rt_opts
                .initial_indent
                .spans
                .iter()
                .map(|span| span.content.len())
                .sum(),
        }];
    };

    let mut out = Vec::new();
    let mut first_line = rt_opts.initial_indent.clone().style(line.style);
    {
        let sliced = slice_line_spans(line, span_bounds, first_line_range);
        let mut spans = first_line.spans;
        spans.extend(sliced.spans.into_iter().map(|s| s.patch_style(line.style)));
        first_line.spans = spans;
        out.push(WrappedLine {
            line: first_line,
            range: first_line_range.clone(),
            prefix_bytes: rt_opts
                .initial_indent
                .spans
                .iter()
                .map(|span| span.content.len())
                .sum(),
        });
    }

    let base = first_line_range.end;
    let skip_leading_spaces = flat[base..].chars().take_while(|c| *c == ' ').count();
    let base = base + skip_leading_spaces;
    let subsequent_width_available = opts
        .width
        .saturating_sub(line_width(&rt_opts.subsequent_indent))
        .max(1);
    let remaining_wrapped = wrap_ranges_trim(&flat[base..], opts.width(subsequent_width_available));
    for range in &remaining_wrapped {
        if range.is_empty() {
            continue;
        }
        let mut subsequent_line = rt_opts.subsequent_indent.clone().style(line.style);
        let offset_range = (range.start + base)..(range.end + base);
        let sliced = slice_line_spans(line, span_bounds, &offset_range);
        let mut spans = subsequent_line.spans;
        spans.extend(sliced.spans.into_iter().map(|s| s.patch_style(line.style)));
        subsequent_line.spans = spans;
        out.push(WrappedLine {
            line: subsequent_line,
            range: offset_range,
            prefix_bytes: rt_opts
                .subsequent_indent
                .spans
                .iter()
                .map(|span| span.content.len())
                .sum(),
        });
    }

    out
}

#[derive(Clone, Debug)]
struct MixedUrlWord {
    range: Range<usize>,
    is_url: bool,
}

impl MixedUrlWord {
    fn width(&self, text: &str) -> usize {
        display_width(&text[self.range.clone()])
    }
}

fn mixed_url_wrap_line<'a>(
    line: &'a Line<'a>,
    flat: &str,
    span_bounds: &[(Range<usize>, ratatui::style::Style)],
    rt_opts: RtOptions<'a>,
) -> Vec<WrappedLine<'a>> {
    let initial_width_available = rt_opts
        .width
        .saturating_sub(line_width(&rt_opts.initial_indent))
        .max(1);
    let subsequent_width_available = rt_opts
        .width
        .saturating_sub(line_width(&rt_opts.subsequent_indent))
        .max(1);
    let ranges = mixed_url_wrap_ranges(flat, initial_width_available, subsequent_width_available);

    let mut out = Vec::new();
    for (idx, range) in ranges.iter().enumerate() {
        let mut wrapped_line = if idx == 0 {
            rt_opts.initial_indent.clone()
        } else {
            rt_opts.subsequent_indent.clone()
        }
        .style(line.style);
        let sliced = slice_line_spans(line, span_bounds, range);
        let mut spans = wrapped_line.spans;
        spans.extend(
            sliced
                .spans
                .into_iter()
                .map(|span| span.patch_style(line.style)),
        );
        wrapped_line.spans = spans;
        out.push(WrappedLine {
            line: wrapped_line,
            range: range.clone(),
            prefix_bytes: if idx == 0 {
                &rt_opts.initial_indent
            } else {
                &rt_opts.subsequent_indent
            }
            .spans
            .iter()
            .map(|span| span.content.len())
            .sum(),
        });
    }

    if out.is_empty() {
        vec![WrappedLine {
            line: rt_opts.initial_indent.clone(),
            range: 0..0,
            prefix_bytes: rt_opts
                .initial_indent
                .spans
                .iter()
                .map(|span| span.content.len())
                .sum(),
        }]
    } else {
        out
    }
}

fn mixed_url_wrap_ranges(
    text: &str,
    initial_width: usize,
    subsequent_width: usize,
) -> Vec<Range<usize>> {
    let leading_space_width = text.chars().take_while(|ch| *ch == ' ').count();
    let mut words = Vec::new();
    let mut cursor = 0usize;
    for word in WordSeparator::AsciiSpace.find_words(text) {
        let word_start = cursor;
        let word_end = word_start + word.word.len();
        let trailing_space_end = word_end + word.whitespace.len();
        if !word.word.is_empty() {
            words.push(MixedUrlWord {
                range: word_start..word_end,
                is_url: is_url_like_token(word.word),
            });
        }
        cursor = trailing_space_end;
    }

    let mut lines = Vec::new();
    let mut line_start = None;
    let mut line_end = 0usize;
    let mut line_width = 0usize;
    let mut line_limit = initial_width.max(1);

    for word in words {
        let mut pending = split_mixed_url_word(text, word, line_limit);
        let mut pending_idx = 0usize;

        while let Some(piece) = pending.get(pending_idx).cloned() {
            let empty_line_prefix_width = if line_start.is_none() && lines.is_empty() {
                leading_space_width
            } else {
                0
            };
            let empty_line_piece_limit = line_limit.saturating_sub(empty_line_prefix_width).max(1);
            let mut indivisible = false;
            if line_start.is_none() && !piece.is_url && piece.width(text) > empty_line_piece_limit {
                let split = split_mixed_url_word(text, piece.clone(), empty_line_piece_limit);
                if split.len() > 1 {
                    pending.splice(pending_idx..=pending_idx, split);
                    continue;
                }
                indivisible = true;
            }

            let piece_width = piece.width(text);
            let inter_word_space = line_start
                .map(|_| text[line_end..piece.range.start].len())
                .unwrap_or(0);
            let fits = if line_start.is_none() {
                piece.is_url
                    || indivisible
                    || empty_line_prefix_width + piece_width <= line_limit
                    || empty_line_prefix_width >= line_limit
            } else {
                line_width + inter_word_space + piece_width <= line_limit
            };

            if fits {
                if line_start.is_none() {
                    let is_first_output_line = lines.is_empty();
                    let start = if is_first_output_line {
                        0
                    } else {
                        piece.range.start
                    };
                    line_start = Some(start);
                    line_width = if is_first_output_line {
                        leading_space_width + piece_width
                    } else {
                        piece_width
                    };
                } else {
                    line_width += inter_word_space + piece_width;
                }
                line_end = piece.range.end;
                pending_idx += 1;
                continue;
            }

            if let Some(start) = line_start.take() {
                lines.push(start..line_end);
            }
            line_end = 0;
            line_width = 0;
            line_limit = subsequent_width.max(1);
        }
    }

    if let Some(start) = line_start {
        lines.push(start..line_end);
    }

    lines
}

fn split_mixed_url_word(text: &str, word: MixedUrlWord, line_limit: usize) -> Vec<MixedUrlWord> {
    if word.is_url || word.width(text) <= line_limit {
        return vec![word];
    }

    let mut pieces = Vec::new();
    let mut start = word.range.start;
    let mut width = 0usize;
    for (offset, grapheme) in text[word.range.clone()].grapheme_indices(/*is_extended*/ true) {
        let grapheme_width = display_width(grapheme);
        if width > 0 && width + grapheme_width > line_limit.max(1) {
            let end = word.range.start + offset;
            pieces.push(MixedUrlWord {
                range: start..end,
                is_url: false,
            });
            start = end;
            width = 0;
        }
        width += grapheme_width;
    }
    if start < word.range.end {
        pieces.push(MixedUrlWord {
            range: start..word.range.end,
            is_url: false,
        });
    }
    pieces
}

fn flatten_line(line: &Line<'_>) -> (String, Vec<(Range<usize>, ratatui::style::Style)>) {
    let mut text = String::new();
    let mut spans = Vec::new();
    let mut cursor = 0;
    for span in &line.spans {
        let start = cursor;
        text.push_str(span.content.as_ref());
        cursor += span.content.len();
        spans.push((start..cursor, span.style));
    }
    (text, spans)
}

fn slice_line_spans<'a>(
    original: &'a Line<'a>,
    bounds: &[(Range<usize>, ratatui::style::Style)],
    requested: &Range<usize>,
) -> Line<'a> {
    let mut output = Vec::new();
    for (index, (bound, style)) in bounds.iter().enumerate() {
        if bound.end <= requested.start {
            continue;
        }
        if bound.start >= requested.end {
            break;
        }
        let start = bound.start.max(requested.start) - bound.start;
        let end = bound.end.min(requested.end) - bound.start;
        if start < end {
            let content = original.spans[index].content.as_ref();
            output.push(Span {
                style: *style,
                content: Cow::Borrowed(&content[start..end]),
            });
        }
    }
    Line {
        style: original.style,
        alignment: original.alignment,
        spans: output,
    }
}

/// Wrap a sequence of lines and return owned output suitable for a transcript.
#[allow(dead_code, private_bounds)]
pub(crate) fn word_wrap_lines<'a, I, O, L>(lines: I, options: O) -> Vec<Line<'static>>
where
    I: IntoIterator<Item = L>,
    L: IntoLineInput<'a>,
    O: Into<RtOptions<'a>>,
{
    let base_opts: RtOptions<'a> = options.into();
    let mut out = Vec::new();

    for (idx, line) in lines.into_iter().enumerate() {
        let line_input = line.into_line_input();
        let opts = if idx == 0 {
            base_opts.clone()
        } else {
            base_opts
                .clone()
                .initial_indent(base_opts.subsequent_indent.clone())
        };
        let wrapped = word_wrap_line(line_input.as_ref(), opts);
        push_owned_lines(&wrapped, &mut out);
    }

    out
}

#[derive(Debug)]
enum LineInput<'a> {
    Borrowed(&'a Line<'a>),
    Owned(Line<'a>),
}

impl<'a> LineInput<'a> {
    fn as_ref(&self) -> &Line<'a> {
        match self {
            Self::Borrowed(line) => line,
            Self::Owned(line) => line,
        }
    }
}

#[allow(dead_code)]
trait IntoLineInput<'a> {
    fn into_line_input(self) -> LineInput<'a>;
}

impl<'a> IntoLineInput<'a> for &'a Line<'a> {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Borrowed(self)
    }
}

#[allow(dead_code)]
impl<'a> IntoLineInput<'a> for &'a mut Line<'a> {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Borrowed(self)
    }
}

impl<'a> IntoLineInput<'a> for Line<'a> {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Owned(self)
    }
}

impl<'a> IntoLineInput<'a> for &'a str {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Owned(Line::from(self))
    }
}

impl<'a> IntoLineInput<'a> for String {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Owned(Line::from(self))
    }
}

#[allow(dead_code)]
impl<'a> IntoLineInput<'a> for Cow<'a, str> {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Owned(Line::from(self))
    }
}

#[allow(dead_code)]
impl<'a> IntoLineInput<'a> for Span<'a> {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Owned(Line::from(self))
    }
}

#[allow(dead_code)]
impl<'a> IntoLineInput<'a> for Vec<Span<'a>> {
    fn into_line_input(self) -> LineInput<'a> {
        LineInput::Owned(Line::from(self))
    }
}

#[cfg(test)]
#[path = "wrapping/tests.rs"]
mod tests;
