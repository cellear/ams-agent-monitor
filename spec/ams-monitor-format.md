# AMS machine-readable format — canonical syntax

Status: **proposed**, not yet upstream. Written PR-ready against `kit/SPRINTS/PROTOCOL.md`
and `kit/AGENT.md`; hold the PR until the monitor has proven these forms render.

This does not invent a standard. The kit already specifies sprint files, story headings and
an `## Acceptance` block. Projects drifted. This pins the drift into one machine-readable
form so a tool can parse it without guessing.

**Scope rule:** binding on files written from adoption onward. Existing projects are
non-conforming by permission, not by error. `cellear/muse-monitor` and the pre-adoption
history of `cellear/factcheck-site` stay as they are; migrating them is a separate,
optional job.

---

## 1. Config file

`{ams_dir}/CONFIG.md` — **uppercase**, matching the kit.

Lowercase `config.md` (as in muse-monitor) is non-conforming. raw.githubusercontent.com is
case-sensitive, so casing is load-bearing, not cosmetic.

## 2. Sprint files

`{sprints_dir}/sprint-{id}.md`

`{id}` is one or more digits, optionally followed by lowercase letters: `1`, `7`, `5a`, `5b`.
Ordering is numeric on the digits, then lexicographic on the suffix — `5` < `5a` < `5b` < `6`.

Files in the sprints directory that do not match `sprint-*.md` are ignored (`roadmap.md`,
`PROTOCOL.md`, and any subdirectory such as `acceptance/`).

### 2.1 Title

The first line is an H1:

```
# Sprint {id}: {theme}
```

Split on the **first colon**. Everything after it is the theme, verbatim — em-dashes,
commas and sub-clauses included. Do not split on the em-dash: only some sprints have one.

```
# Sprint 2: It's a website                                    ✅
# Sprint 5a: UI v1, part 1 — scaffold, SSE store, session list ✅ theme keeps the dash
# Sprint 3 — Live Tailing                                      ❌ no colon
```

### 2.2 Stories

```
### {story-id} · {title} · [ ]
```

Separator is a middle dot `·` (U+00B7) with a single space either side. The checkbox is the
last thing on the line: `[ ]` open, `[x]` done, lowercase x.

`{story-id}` is `{letter(s)}{sprint-id}-{seq}`, where `{seq}` is digits or letters:

| Form | Meaning | Example |
|---|---|---|
| `S{n}-{m}` | ordinary story | `S2-4` |
| `S{n}-R` | sprint retro | `S2-R` |
| `F{n}-{m}` | fix story, added after a failed demo | `F1-1` |

Regex: `^###\s+(\S+)\s+·\s+(.+?)\s+·\s+\[([ x])\]\s*$`

### 2.3 Acceptance

```
## Acceptance

**Status:** Accepted
**Date:** 2026-08-29
**Reviewed by:** Luke
```

`**Status:**` takes exactly one bare word — `Accepted` or `Pending`. No check marks, no
bold on the value, no trailing prose on that line. Narrative belongs in the paragraphs
below the three fields.

```
**Status:** Accepted                                  ✅
**Status:** ✓ Accepted                                ❌
**Status:** ✅ **ACCEPTED** by Luke (PO), 2026-08-16   ❌
**Status:** Accepted — Luke, in-session, after ...     ❌ prose on the status line
```

An `## Acceptance` block whose Status is absent or empty means not accepted. An empty block
is the tell that acceptance was never recorded.

### 2.4 Accepting a sprint requires every story checked

**A sprint may not be Accepted while any story is `[ ]`.** At acceptance, each story is
checked, moved to a later sprint, or moved to the kit's existing
`## Deferred to later sprints` section. This is a process rule with a parsing payoff: it
means an unchecked box always denotes work still ahead, so the board needs no
"deferred" state.

Legacy files that violate this (factcheck-site `S1-5`; muse-monitor sprints 1, 2, 4, 5a)
render as a muted *not completed*, visually distinct from planned.

### 2.5 Derived board state

- **Current sprint** — lowest-ordered sprint whose Status is not `Accepted`.
- **In progress** — the first `[ ]` story in the current sprint. Exactly one, or none if
  the sprint is fully checked and awaiting acceptance.
- **Planned** — every other `[ ]` story.
- **Checkpoint** — the row-end cell: `Accepted ✓` when Status is `Accepted`, else pending.

## 3. Handoff files

`{handoff_dir}/handoff-{YYYY-MM-DD}-{slug}-{agent}.md`

Five canonical `##` headings, this casing, in this order:

```
## Context
## What's done
## What's next
## Notes / blockers
## Files / references
```

Optionally followed by `## Prompt for Next Assistant`, which the monitor extracts and
displays separately. Any other `##` section is preserved and shown in an "additional
sections" area rather than discarded.

### 3.1 Legacy heading mapping

Pre-adoption handoffs (58 in muse-monitor across 82 distinct headings, 19 in
factcheck-site across 21) are mapped by case-insensitive, whitespace-normalized
**substring** match, first rule that hits:

| Canonical | Matches on |
|---|---|
| Context | `summary`, `current state`, `the project` |
| What's done | `what was done`, `what was attempted`, `outcome`, `what worked` |
| What's next | `next steps`, `recommendations` |
| Notes / blockers | `open question`, `blocker`, `what didn't`, `judgment call`, `judgement call`, `design note`, `overstepped`, `finding` |
| Files / references | `files created`, `files modified`, `files created/modified`, `stray files` |

Exact-set matching is not viable: `Files created or modified` appears in four casings
across the two projects. Every handoff in both projects hits at least one rule.
