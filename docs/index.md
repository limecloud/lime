---
layout: home

hero:
  name: Agent Knowledge
  text: A portable standard for source-grounded knowledge packs.
  tagline: Give agents facts, source trails, constraints, and maintained context without confusing knowledge with procedural skills.
  actions:
    - theme: brand
      text: Read the specification
      link: /specification
    - theme: alt
      text: Start authoring
      link: /authoring/quickstart

features:
  - title: Source-grounded
    details: Keep raw sources, maintained wiki pages, compiled runtime views, and citation anchors in separate layers.
  - title: Progressive disclosure
    details: Inspired by Agent Skills: clients load compact metadata first, then guides, context packs, and deep evidence only when needed.
  - title: Skill-compatible
    details: Agent Knowledge packs are data assets. Agent Skills remain procedural assets that build, lint, query, or use them.
  - title: Local-first friendly
    details: Works as plain files in Git, desktop apps, notebooks, or hosted workspaces. Indexes are rebuildable acceleration layers.
  - title: Auditable
    details: Track ingest runs, lint findings, review state, confidence, source anchors, and claim status.
  - title: Runtime-ready
    details: Define how agents resolve context budgets, treat knowledge as data, and avoid prompt-injection from sources.
---

## Why this standard exists

Agent Skills gave agents a simple way to load procedural capability: instructions, scripts, references, and assets. Agent Knowledge applies the same file-first philosophy to durable knowledge assets.

The goal is not to replace RAG, wikis, notebooks, or skills. The goal is to define a small portable package format that lets agents answer these questions reliably:

- What knowledge exists?
- What sources does it come from?
- Which parts are confirmed, draft, stale, or disputed?
- What context should be loaded for this task?
- Which claims can be traced back to source material?
- Which indexes are acceleration layers rather than facts?

## Core shape

```directory
customer-onboarding/
├── KNOWLEDGE.md      # Required: metadata + usage guide
├── sources/          # Raw source files, treated as read-only evidence
├── wiki/             # Maintained pages, decisions, entities, concepts
├── compiled/         # Runtime views: facts, playbooks, boundaries
├── indexes/          # Optional, rebuildable search/vector/graph indexes
├── runs/             # Ingest, lint, review, query logs
└── assets/           # Optional diagrams, templates, examples
```

## Design rule

Knowledge packs are facts and context. Skills are methods and workflows.

Use Agent Skills to build, update, lint, and query Agent Knowledge packs. Do not hide real customer or domain knowledge inside a global skill when it needs its own source trail, status, ownership, and review lifecycle.
