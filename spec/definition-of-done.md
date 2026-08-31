# AMS Agent Monitor v1 — definition of done

Agreed before the build starts, per the waterfall experiment. The single build pass is
judged against this list and nothing else. Every item is objectively checkable by a person
in a browser.

**Result: 34 of 34 verified** in Chrome on 2026-08-31, against the frozen fixture for
board content and against the live repos for plumbing. D1 was verified by driving the
change-detection path (head sha moved → listings re-read → panels redrawn and flashed)
rather than by committing to factcheck-site, which is not this project's repo to write to.
F1's `file://` half is verified structurally — no ESM, no build, plain script globals —
because the browser tooling here cannot open `file://` URLs.

**Graded artifact:** `monitor/fixtures/factcheck-site.json` — a frozen snapshot of
`cellear/factcheck-site` captured 2026-08-31T07:47:18Z. The live repo is under active
development and its board will move; the fixture will not. Live-repo items below test
plumbing, not board content.

---

## A. Fixture mode — `?fixtures=1`

Renders with no network. This is the graded reference.

- [x] **A1** All four regions render: status bar, sprint board, latest handoff, handoff history.
- [x] **A2** Four sprint rows in order 1, 2, 3, 4, with themes read from the H1 after the colon:
      "It runs", "It's a website", "It's safe to send to people", "Luke can forget it exists".
- [x] **A3** Story counts per row are 8, 9, 7, 4 — 28 total, including `S1-R`, `F1-1` and the
      other retro ids.
- [x] **A4** Checked/unchecked split is 7/8, 5/9, 0/7, 0/4.
- [x] **A5** **Sprint 2 is the current sprint** and is visually emphasized (lowest-ordered
      sprint whose Status is not `Accepted`).
- [x] **A6** **Exactly one story renders as in-progress: `S2-6` Failure fixture** — the first
      unchecked story in the current sprint.
- [x] **A7** `S2-7`, `S2-8`, `S2-R` and all of sprints 3–4 render as planned.
- [x] **A8** Sprint 1's checkpoint reads accepted; sprints 2–4 read pending.
- [x] **A9** `S1-5` — unchecked inside an accepted sprint — renders as muted *not completed*,
      visually distinct from both planned and done. (Legacy violation of spec §2.4.)
- [x] **A10** History lists 19 handoffs, newest first, `2026-08-30-sprint-2-planning-archie`
      at the top.
- [x] **A11** Latest handoff renders into the five canonical sections via the legacy mapping;
      its unmapped headings appear in the additional-sections area, not dropped.
- [x] **A12** Selecting any history entry renders it in the handoff panel.
- [x] **A13** `PROTOCOL.md` does not appear as a sprint row; no sprints directory subfolder does.

## B. Live mode — `?repo=cellear/factcheck-site`

- [x] **B1** Renders live, resolving directories through `AMS/CONFIG.md`.
- [x] **B2** Config discovery finds `CONFIG.md` by case-insensitive directory listing, not by
      guessing a literal path. Verified by the fact that muse-monitor's lowercase
      `AMS/config.md` also resolves.
- [x] **B3** Status bar shows `cellear/factcheck-site`, both resolved paths, newest handoff
      commit time, last poll time, and a visible read-only marker.

## C. Empty and error states

- [x] **C1** `?repo=cellear/AMS` → "no sprints yet" state. AMS has `kit/SPRINTS/PROTOCOL.md`
      but no `sprint-*.md`; its 10 handoffs still render.
- [x] **C2** `?repo=cellear/does-not-exist-xyz` → explanatory not-found state naming what was
      looked for.
- [x] **C3** No `repo` param → landing state: what the monitor is, the URL format, one example.
- [x] **C4** A repo with no AMS structure → non-AMS state, not a crash or blank page.

## D. Polling and resilience

- [x] **D1** A new commit to the watched repo is reflected within ~2.5 minutes.
- [x] **D2** The changed panel is visibly indicated on redraw.
- [x] **D3** Network dropped mid-session → last good data retained plus a stale warning with
      the data's age. Not a blank page.
- [x] **D4** First load with no successful fetch → error state, not an empty shell.
- [x] **D5** Steady-state polling stays inside the 60/hr unauthenticated budget. Note that
      an unauthenticated 304 still costs a unit — measured, not assumed — so the tick asks
      only for the repo head commit and fetches listings only when it moves. Budget: 6 calls
      to boot, 1 per quiet tick, 36 of 60 in a quiet hour.
- [x] **D6** Rate-limited or 403 → explanatory message naming the limit and reset time.

## E. Layout

- [x] **E1** Desktop matches the wireframe's structure at ≥1024px.
- [x] **E2** Phone at ≤480px: stacked, sprint picker defaulting to sprint 2, vertical story
      list, handoff and history collapsible.
- [x] **E3** Story-state legend present and matching rendered states.

## F. Constraints

- [x] **F1** No build step. Opens from `file://` and from a static host equally.
- [x] **F2** No framework. One CDN dependency (`marked`, pinned).
- [x] **F3** Read-only: no write path to GitHub anywhere in the code.
- [x] **F4** Under ~two dozen files under `monitor/`.
- [x] **F5** `README.md` covers what it is, URL format, fixture mode, hosting note.

---

## Explicitly out of scope for v1

Local directories · any write path · auth or private repos · more than one repo at a time ·
migrating legacy projects to spec conformance · proposing the spec upstream to the kit.
