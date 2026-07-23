# VibeBoard card conventions

This project is managed by VibeBoard. Cards are markdown files in folders.

## Layout
- Two boards: `product/` (what/why) and `engineering/` (how).
- **Column = folder.** e.g. `product/in-progress/P-001.md`.
- `archive/` (per board) holds soft-deleted cards; it is not a column.

## Card file
One card = one `.md` file with YAML frontmatter + a markdown body:
```
---
id: E-010            # P-### product, E-### engineering; zero-padded; NEVER change on move
title: ...
description: ...     # optional short miniature summary
order: 20            # position within the column
tags: [backend]
links: [P-001]       # engineering cards reference their parent product card(s)
group: sync-epic     # optional grouping label
created: 2026-07-23
---
Markdown body.
```

## Rules for agents
- To create a card, pick the next id = highest existing of that prefix + 1.
- To move a card, move its file to another column folder — do not change its id.
- Board and column come from the file path, never from frontmatter.
- Product↔engineering links live only on the engineering card's `links` list.
