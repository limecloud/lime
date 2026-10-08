//! Canonical UserInput restoration shared by recall, queued editing and backtracking.

use super::*;

impl HistoryEntry {
    /// Lower one canonical user message into the existing composer history shape.
    ///
    /// Replay must preserve the structured input facts that the composer can restore. Review
    /// filtering is intentionally owned by the caller because it requires complete Turn
    /// metadata; this conversion only handles one already-approved UserMessage payload.
    pub(in crate::bottom_pane) fn from_user_inputs(inputs: &[UserInput]) -> Option<Self> {
        if !valid_user_inputs(inputs) {
            return None;
        }
        let mut text = String::new();
        let mut text_elements = Vec::new();
        let mut local_images = Vec::new();
        let mut remote_images = Vec::new();
        let mut mention_bindings = Vec::new();

        for input in inputs {
            match input {
                UserInput::Text {
                    text: value,
                    text_elements: elements,
                } => {
                    let offset = text.len();
                    text.push_str(value);
                    text_elements.extend(elements.iter().map(|element| {
                        TextElement::new(
                            element.byte_range.start + offset..element.byte_range.end + offset,
                            element.placeholder.clone(),
                        )
                    }));
                }
                UserInput::Image { detail, url } => {
                    remote_images.push(RemoteImageAttachment {
                        url: url.clone(),
                        detail: *detail,
                    });
                }
                UserInput::LocalImage { detail, path } => {
                    let image_number = remote_images.len() + local_images.len() + 1;
                    local_images.push(LocalImageAttachment {
                        placeholder: format!("[Image #{image_number}]"),
                        path: path.clone().into(),
                        detail: *detail,
                    });
                }
                UserInput::Skill { name, path } => mention_bindings.push(MentionBinding {
                    sigil: '$',
                    mention: name.clone(),
                    path: path.clone(),
                }),
                UserInput::Mention { name, path } => mention_bindings.push(MentionBinding {
                    sigil: '@',
                    mention: name.clone(),
                    path: path.clone(),
                }),
            }
        }

        // A canonical Skill/Mention may have no matching atomic token (including a skill-only
        // prompt). Preserve its target by inserting only the missing tokens into the editor.
        let mut available = HashMap::<String, usize>::new();
        for element in &text_elements {
            let token = &text[element.byte_range.start..element.byte_range.end];
            *available.entry(token.to_string()).or_default() += 1;
        }
        let mut present = Vec::new();
        let mut missing = Vec::new();
        for binding in mention_bindings {
            let token = format!("{}{}", binding.sigil, binding.mention);
            if let Some(count) = available.get_mut(&token).filter(|count| **count > 0) {
                *count -= 1;
                present.push(binding);
            } else {
                missing.push(binding);
            }
        }
        if !missing.is_empty() {
            let prefix = missing
                .iter()
                .map(|binding| format!("{}{}", binding.sigil, binding.mention))
                .collect::<Vec<_>>()
                .join(" ");
            let offset = prefix.len() + usize::from(!text.is_empty());
            for element in &mut text_elements {
                element.byte_range.start += offset;
                element.byte_range.end += offset;
            }
            let mut start = 0;
            let mut prefix_elements = Vec::new();
            for binding in &missing {
                let token = format!("{}{}", binding.sigil, binding.mention);
                prefix_elements.push(TextElement::new(
                    start..start + token.len(),
                    Some(token.clone()),
                ));
                start += token.len() + 1;
            }
            prefix_elements.extend(text_elements);
            text_elements = prefix_elements;
            text = if text.is_empty() {
                prefix
            } else {
                format!("{prefix} {text}")
            };
        }
        for (index, image) in local_images.iter_mut().enumerate() {
            image.placeholder = format!("[Image #{}]", remote_images.len() + index + 1);
        }
        let entry = Self {
            text,
            text_elements,
            local_images,
            remote_images,
            pending_pastes: Vec::new(),
            mention_bindings: missing.into_iter().chain(present).collect(),
        };
        (!entry.is_empty()).then_some(entry)
    }
}

pub(crate) fn valid_user_inputs(inputs: &[UserInput]) -> bool {
    !inputs.is_empty()
        && inputs.iter().all(|input| match input {
            UserInput::Text {
                text,
                text_elements,
            } => {
                text_elements.iter().all(|element| {
                    let range = element.byte_range;
                    range.start < range.end
                        && text.get(range.start..range.end).is_some_and(|value| {
                            element
                                .placeholder
                                .as_deref()
                                .is_none_or(|placeholder| placeholder == value)
                        })
                }) && text_elements
                    .windows(2)
                    .all(|pair| pair[0].byte_range.end <= pair[1].byte_range.start)
            }
            UserInput::Image { url, .. } => !url.is_empty(),
            UserInput::LocalImage { path, .. } => !path.is_empty(),
            UserInput::Skill { name, path } | UserInput::Mention { name, path } => {
                !name.is_empty()
                    && name.bytes().all(crate::mention_codec::is_mention_name_char)
                    && !path.is_empty()
            }
        })
}
