//! Discover loaded subagent threads that the current process did not witness spawning.
//!
//! A resumed thread can already own child threads; only the loaded-thread list plus each
//! thread's `parent_thread_id` reveal that relationship. Registration stays with `App`.

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LoadedThreadNode {
    pub thread_id: String,
    pub parent_thread_id: Option<String>,
}

/// Returns descendants of `primary` ordered by discovery (breadth first, lexical within a layer).
pub(crate) fn descendant_thread_ids(primary: &str, loaded: &[LoadedThreadNode]) -> Vec<String> {
    let mut discovered: Vec<String> = Vec::new();
    let mut frontier = vec![primary.to_string()];
    while let Some(parent) = frontier.pop() {
        let mut children: Vec<&LoadedThreadNode> = loaded
            .iter()
            .filter(|node| node.parent_thread_id.as_deref() == Some(parent.as_str()))
            .filter(|node| node.thread_id != primary)
            .collect();
        children.sort_by(|left, right| left.thread_id.cmp(&right.thread_id));
        for child in children {
            if discovered.contains(&child.thread_id) {
                continue;
            }
            discovered.push(child.thread_id.clone());
            frontier.push(child.thread_id.clone());
        }
    }
    discovered
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(thread_id: &str, parent: Option<&str>) -> LoadedThreadNode {
        LoadedThreadNode {
            thread_id: thread_id.to_string(),
            parent_thread_id: parent.map(str::to_string),
        }
    }

    #[test]
    fn discovers_direct_and_nested_children_only() {
        let loaded = vec![
            node("primary", None),
            node("child-b", Some("primary")),
            node("child-a", Some("primary")),
            node("grandchild", Some("child-a")),
            node("unrelated", None),
        ];
        assert_eq!(
            descendant_thread_ids("primary", &loaded),
            vec![
                "child-a".to_string(),
                "child-b".to_string(),
                "grandchild".to_string()
            ]
        );
    }

    #[test]
    fn ignores_cycles_and_duplicate_parent_links() {
        let loaded = vec![
            node("primary", Some("child-a")),
            node("child-a", Some("primary")),
            node("child-a", Some("primary")),
        ];
        assert_eq!(
            descendant_thread_ids("primary", &loaded),
            vec!["child-a".to_string()]
        );
    }

    #[test]
    fn empty_when_no_loaded_child_exists() {
        assert!(descendant_thread_ids("primary", &[node("other", None)]).is_empty());
    }
}
