# AMS Agent Monitor — implementation plan

## Overview

- A read-only, static web page that renders any AMS-using GitHub repo as a sprint board plus handoff viewer, polling for new commits and redrawing. A window, not a control panel.
- Generic by design: the repo is given by query string with no default, because the AMS setup wizard may eventually offer the monitor to every AMS project.
- SPRINTS is required. The board is the point; a repo without sprint files gets an explanatory empty state, not a degraded handoffs-only view.
- Everything is parsed from the repo per the existing AMS kit protocols (`kit/AGENT.md`, `kit/SPRINTS/PROTOCOL.md`), including `CONFIG.md`-driven directory resolution. Where real files are messier than the protocol (free-form handoff headings, `sprint-5a.md`), the monitor is tolerant; where tolerance fails, the fix is making the files cleaner, not the parser smarter.
- Static files, no build step, no framework. Multiple files allowed (soft target: under ~two dozen). CDN-loaded markdown renderer. Hostable on GitHub Pages.
- Built as a waterfall experiment: this plan, `spec/ams-monitor-format.md` (canonical syntax) and `spec/definition-of-done.md` (the graded checklist) define "done" before the build starts.
- Reference repo is `cellear/factcheck-site`: mid-build, so it has a genuine current sprint, and it already writes the canonical forms. `cellear/muse-monitor` is retained only as a legacy-tolerance test — all nine of its sprints are accepted, so it cannot exercise in-progress state.

## Expected behavior

### Loading and configuration
- URL shape: `monitor/index.html?repo=owner/name`. Optional: `&fixtures=1` (render the bundled snapshot, no network).
- No `repo` param → an explanatory landing state: what the monitor is, the URL format, one example.
- Directory resolution follows the agent protocol: **list** the `AMS/` (then `.ams/`) directory via the contents API and match the config file case-insensitively — do not fetch a literal `AMS/CONFIG.md`, because raw.githubusercontent.com is case-sensitive and muse-monitor ships lowercase `AMS/config.md`. Canonical casing is `CONFIG.md` (spec §1); the case-insensitive match is legacy tolerance. Then read `components` and directory settings from its tables, honoring the "Your value" column, and resolve each directory inside the AMS dir first, then the project root. No CONFIG at all → try conventional defaults (`AMS/SPRINTS`, `SPRINTS`, same for `HANDOFF`) before declaring the repo non-AMS.
- Repo not found, private, or no AMS structure → explanatory empty state naming what was looked for and not found.
- SPRINTS dir present but empty of `sprint-*.md` files → the "no sprints yet" empty state (handoff panels still render if handoffs exist, but the page says the board is waiting for sprint files).

### Status bar (wireframe pin 1)
- Shows: `owner/repo` and the resolved sprints/handoff paths, when the newest handoff was committed, when the page last successfully polled, and a "Read-only" marker.
- On fetch failure the page keeps the last successful data and the status bar shows a stale-data warning with the age of the data. First load with nothing fetched yet → error/empty state instead.

### Sprint board (pins 2–3)
- One row per sprint file, ordered by sprint id: numeric on the leading digits, then lexicographic on any lowercase-letter suffix (`5` < `5a` < `5b` < `6`). factcheck-site uses plain `1`–`4`; the suffix rule exists for muse-monitor's `5a`/`5b`. Non-sprint files in the sprints dir (`roadmap.md`, `PROTOCOL.md`, `acceptance/` subdir) are ignored.
- Each row: sprint name and theme from the H1, split on the **first colon** — `# Sprint 2: It's a website`. Not on the em-dash: only some sprints have one, and where present it belongs to the theme. Stories left-to-right from `### {id} · {title} · [ ]` headings, where `{id}` matches `S{n}-{m}`, `S{n}-R` (retro) or `F{n}-{m}` (fix story) — regex `^###\s+(\S+)\s+·\s+(.+?)\s+·\s+\[([ x])\]\s*$`, verified against all 28 factcheck-site stories. A checkpoint cell at the row's end reads "Accepted ✓" when `**Status:**` is `Accepted`, otherwise pending.
- Story states: checked `[x]` = done; the first unchecked story in the current sprint = in progress; every other unchecked story = planned. One legacy-only fourth state: an unchecked story inside an **accepted** sprint renders muted as *not completed*, visually distinct from planned — going forward spec §2.4 forbids accepting a sprint with unchecked stories, so this state should never appear in conforming repos. It appears once in the fixture (`S1-5`). Legend matches the wireframe plus this state.
- Current sprint = the **lowest**-ordered sprint whose `**Status:**` is not `Accepted` — the sprint actually being worked, not the furthest-planned one. In the fixture that is sprint 2, with sprints 3 and 4 already written but pending. Its row is visually emphasized. If every sprint is accepted (muse-monitor), the last is current-but-complete: emphasized, checkpoint accepted, and no story marked in-progress.

### Latest handoff (pin 4)
- Newest handoff (by filename date, tie-broken by commit time) rendered with best-effort section mapping: known heading synonyms are bucketed into the five-section layout — Context, What's done, What's next, Notes/blockers, Files/references — and anything unrecognized is rendered as-is below, under its own headings.
- The header line (persona · model · story) and a `## Prompt for Next Assistant` section are surfaced distinctly when present.
- Body content renders as markdown via the CDN renderer, links opening in new tabs, relative repo links rewritten to github.com URLs.

### Handoff history (pin 5)
- All handoff files newest-first with relative commit times ("2 h ago"). Selecting one swaps it into the handoff panel (marked as historical, with a "back to latest" affordance).

### Polling and change indication
- Fixed ~2-minute poll, unauthenticated, no token support in v1.
- Conditional requests (ETag / If-None-Match) on every poll — GitHub 304s don't count against the 60/hour budget, so steady-state polling is nearly free and the budget is spent only when something actually changed.
- When a poll brings new data: changed panels get a brief highlight, and the status bar notes what changed ("new handoff 40s ago") until the user interacts.

### Phone layout (pins 6–8)
- Same content stacked, via CSS media query: compressed status bar; sprint picker tabs (defaulting to current sprint) over a vertical story list; checkpoint line under the list; latest-handoff and history as collapsible sections.

## Implementation plan

All files under a `monitor/` root (deployable as-is to GitHub Pages). CDN dependency: `marked` (pinned version) for markdown.

- `index.html` — page shell: status bar, board region, side panels, empty/error state containers, both layouts driven by one DOM + media queries. Loads marked from CDN, then the modules below as plain `<script>` files (each defining one global namespace object — no build, no ESM/CORS issues when opened from `file://`).
- `css/monitor.css` — desktop grid, phone stack, story-state styles (done/in-progress/planned), current-sprint emphasis, change-highlight animation, empty states.
- `js/config.js` — query-string parsing (`repo`, `fixtures`), validation of `owner/name`.
- `js/github.js` — fetch wrapper for the GitHub contents API and raw.githubusercontent.com: ETag cache, 304 handling, rate-limit header awareness, error classification (transient vs. config), commit-time lookup for handoff files.
- `js/ams.js` — CONFIG.md discovery and parsing (markdown tables → `components`, directory settings), directory resolution order (CONFIG value → `AMS/<name>` → root), "is this an AMS repo" verdict.
- `js/sprints.js` — sprint dir listing → board model: filename filter (`sprint-*.md`, excluding subdirs and `roadmap.md`), id ordering, per-file parse (H1 → name/theme on first colon, story-heading regex → id/title/checkbox, `## Acceptance` → status). Acceptance is read from the `**Status:**` line, not from body non-emptiness: canonically a bare `Accepted`/`Pending`, with legacy tolerance for `✓ Accepted`, `✅ **ACCEPTED** by …` and trailing prose via case-insensitive contains-"accepted". Derives current sprint and in-progress story. Returns plain data objects.
- `js/handoffs.js` — handoff dir listing → sorted index (filename date + commit time); per-file parse: header line, heading mapping → five-section buckets, leftovers, `Prompt for Next Assistant` extraction. Mapping is case-insensitive, whitespace-normalized **substring** match on the keyword table in spec §3.1, first rule wins — exact-set matching is not viable, as `Files created or modified` alone appears in four casings. Verified: every one of the 19 factcheck-site and 58 muse-monitor handoffs maps to at least one section; unmatched headings (6 and 28 respectively) render in an additional-sections area rather than being dropped.
- `js/render.js` — pure model→DOM rendering for every region, including relative-time formatting and the changed-panel highlight hooks.
- `js/app.js` — orchestration: boot (config → resolve → first fetch → render), poll loop, change detection (compare shas/ETags), stale/error state transitions, history selection.
- `fixtures/factcheck-site.json` — frozen snapshot of `cellear/factcheck-site` (CONFIG, `AMS/` listing, 4 sprint files, 19 handoffs with bodies and shas), captured 2026-08-31T07:47:18Z; served to the same code paths in place of `js/github.js` responses when `fixtures=1`. Already captured and committed. The live repo is under active development, so the fixture — not the live board — is the graded artifact.
- `README.md` — what it is, URL format, hosting note, fixture mode, pointers to `spec/ams-monitor-format.md` and `spec/definition-of-done.md`.
- Alongside the monitor (not part of the static site): `spec/ams-monitor-format.md`, written PR-ready against `kit/SPRINTS/PROTOCOL.md` and `kit/AGENT.md`. **Decided: hold the PR** until the monitor has proven these forms render. Do not propose it upstream during this build.

## Implementation phases

1. **Fixture-first render.** `index.html`, CSS, `config.js`, `sprints.js`, `handoffs.js`, `render.js`, the captured `fixtures/factcheck-site.json`, and enough of `app.js` to render it with `?fixtures=1`. Desktop layout matching the wireframe. No network code. *Working system: the wireframe realized against real captured data, satisfying DoD section A.*
2. **Live GitHub.** `github.js`, `ams.js`, full `app.js` boot path; render live from `?repo=cellear/factcheck-site`; empty states for no-param / bad-repo / non-AMS / no-sprints (verifiable against `cellear/AMS`). Check legacy tolerance against `?repo=cellear/muse-monitor` — lowercase config, `5a`/`5b` ordering, all-accepted board. *Working system: live one-shot rendering, no polling. DoD sections B and C.*
3. **Polling, change indication, resilience.** ETag-based poll loop, changed-panel highlights, stale-data handling, rate-limit backoff messaging. *Working system: leave it open, commit a handoff to factcheck-site, watch it redraw. DoD section D.*
4. **Phone layout and polish.** Media-query layout with sprint picker and accordions, relative-time refresh, README. *Working system: v1 complete against `spec/definition-of-done.md`. DoD sections E and F.*

## Testing strategy

- No unit tests (deliberate: if files are hard to parse, the files get fixed, not the parser).
- **Fixture mode is the reference.** `?fixtures=1` renders `fixtures/factcheck-site.json`, frozen at 2026-08-31T07:47:18Z. Immune to rate limits and to the reference repo's ongoing development.
- **The definition of done is `spec/definition-of-done.md`** — 34 checkable items across six sections, agreed before the build. The build pass is judged against that file and nothing else.
- Legacy-tolerance checks against `cellear/muse-monitor`: lowercase `AMS/config.md` resolves, `5a`/`5b` order correctly, an all-accepted board shows no in-progress story, and its messier handoff headings still map.
- Manual edge checks: a handoff with none of the known headings (everything lands in additional sections), a sprint file with zero stories, `cellear/AMS` as the no-sprints case.

## Decisions taken (previously open)

- **Reference repo: `cellear/factcheck-site`**, replacing muse-monitor. Mid-build, so it has a real current sprint; already writes the canonical forms; public. muse-monitor is now a legacy-tolerance fixture only.
- **Sprint id ordering:** digits numeric, then lowercase suffix lexicographic. `5a`/`5b` is the full extent seen in practice.
- **Acceptance detection:** the `**Status:**` line, canonically a bare `Accepted`/`Pending`; not body non-emptiness. Legacy contains-"accepted" tolerance retained.
- **Heading mapping:** case-insensitive substring match on a keyword table, not an exact set — verified to cover all 77 handoffs across both projects.
- **A sprint may not be accepted with unchecked stories** (spec §2.4). Removes the need for a general deferred state; legacy violations render muted as *not completed*.
- **Spec stays local; the kit PR is held** until the monitor proves the forms render.
- **Commit-time lookups:** filename-date ordering on first load; commit time fetched for the newest handoff only (status bar) and lazily per file on selection. Keeps first paint to three API calls.

## Open questions

None blocking. Two cosmetic items deferred to the build:

- Where the monitor repo finally lives — its own repo with GitHub Pages, or a directory inside `cellear/AMS`. Affects only the README's hosting note; decide at phase 4.
- Exact muted styling for the legacy *not completed* story state, so it reads as distinct from both planned and done without drawing the eye.
