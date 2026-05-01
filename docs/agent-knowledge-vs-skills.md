---
title: Agent Knowledge vs Agent Skills
description: A clear boundary between knowledge assets and procedural capabilities.
---

# Agent Knowledge vs Agent Skills

Agent Knowledge is intentionally modeled after the ergonomics of Agent Skills, but it solves a different problem.

| Question | Agent Skills | Agent Knowledge |
| --- | --- | --- |
| Primary role | Procedural capability | Source-grounded knowledge asset |
| Required file | `SKILL.md` | `KNOWLEDGE.md` |
| Loaded at discovery | `name`, `description` | `name`, `description`, `type`, `status` |
| Activation content | Instructions and workflow | Usage guide and context map |
| Supporting files | scripts, references, assets | sources, wiki, compiled views, indexes, runs |
| Runtime behavior | Tells agent what to do | Gives agent facts and boundaries to use as data |
| Example | “Generate a financial report” | “Q3 revenue definitions and source evidence” |

## Borrowed from Agent Skills

Agent Knowledge borrows these ideas from Agent Skills:

- directory as package
- required top-level Markdown file
- YAML frontmatter
- progressive disclosure
- optional supporting directories
- validation tooling
- portable, version-controlled assets
- client-side discovery and activation

## Deliberate differences

Knowledge packs need concepts that skills do not:

- source provenance
- claim status
- trust level
- citation anchors
- stale and disputed states
- compiled runtime views
- rebuildable indexes
- lint and review logs

## Rule of thumb

If the asset says **how to do a task**, it is a skill.

If the asset says **what is true, sourced, allowed, disputed, or useful context**, it is knowledge.

Use both together:

```text
brand-product-builder skill
  -> creates brand-product knowledge pack
  -> scene skill uses pack to generate product copy
  -> agent cites pack sources and applies boundaries
```
