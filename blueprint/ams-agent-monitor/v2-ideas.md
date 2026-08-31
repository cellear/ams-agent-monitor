# AMS Agent Monitor — v2 ideas

Captured 2026-08-31, after Luke saw v1 running with real data. Raw capture for a
Blueprint session; not a plan. One section per idea, in the order raised.

---

## 1. Repo picker instead of the landing help message

**What Luke asked for:** launching the page with no `repo` parameter — for example
by double-clicking `index.html` in the Finder — currently shows a help message
telling the user to add a parameter to the URL. Replace that with a form field the
user can type a repo into, and a control to load it.

**Input formats to accept:**

- `cellear/factcheck-site` — bare `owner/name`
- `https://github.com/cellear/factcheck-site` — the full URL as copied from the
  browser address bar

**Explicitly forward-looking:** the same field should eventually accept other git
hosts — GitLab and Bitbucket named. That is a v2+ direction, not necessarily this
change, but the input parsing and the fetch layer should not be written in a way
that makes it harder later.

**Why it matters:** it makes the page work as an application for someone who has
never seen a query string, and it removes the only step in v1 that requires
editing a URL by hand.

**Notes from the build (not decisions):**

- Setting `location.search` works from `file://`, so a typed repo can load without
  a server. `?fixtures=1` still needs HTTP.
- v1 already validates `owner/name` in `js/config.js`; URL-shaped input is new.
- Multi-host support reaches past parsing into `js/github.js`, whose API shapes,
  raw-content host and rate-limit headers are GitHub-specific.

**Open, to settle in Blueprint:** whether the picker persists after a repo loads
as a way to switch projects, or only appears on the landing screen; whether the
typed repo updates the URL so the result stays shareable and bookmarkable;
whether recently-viewed repos are remembered.

**Decided:** landing screen only for MVP. A persistent switcher goes to the
backlog — wanted, but not before Luke has a read on how big the codebase is
getting. Include it in MVP only if it turns out to be cheap.

---

## Cross-cutting constraint: keep the codebase legible

Raised while deciding the scope of idea 1, and it governs every idea below.

Luke wants to gauge how complicated the codebase is getting before committing to
additions, including ones that look easy. Features that are individually cheap
are still spent against a budget he wants to see before spending.

**So every idea in this document needs a size estimate before it is accepted**,
and Blueprint should treat total size as a first-class constraint rather than an
afterthought. The v1 plan's soft target — under roughly two dozen files under
`monitor/` — is the existing expression of this.

**Where v1 actually landed:** 1,410 lines across 12 files.

| File | Lines |
|---|---|
| `js/app.js` | 386 |
| `js/render.js` | 247 |
| `css/monitor.css` | 149 |
| `js/ams.js` | 140 |
| `js/sprints.js` | 138 |
| `js/handoffs.js` | 125 |
| `js/github.js` | 115 |
| `index.html` | 85 |
| `js/config.js` | 25 |

`app.js` is already the largest file and the one most likely to absorb new
features by default. If it keeps growing it is the first candidate for a split.

---

## 2. Shade completed and in-progress stories so progress reads at a glance

**What Luke asked for:** the trail of stories is too subtle — it is hard to pick
out where the project currently is. Fill completed stories and the in-progress
story with a shade; leave future stories white as they are now. The filled run
then shows how far the project has got.

**Acceptance criterion, in Luke's words:** you should be able to tell from across
the room. This is a distance-legibility requirement, not a styling preference —
it argues for real contrast rather than a subtle tint, and it should be checked
by looking at the board from a few metres away, not by reading a hex value.

**Current v1 behaviour, for contrast:** every story box is white regardless of
state. State is carried only by a 9px dot (filled / half / ring) and the border
(solid / dashed), which is what makes it too subtle.

**Design conflict to resolve — the "not completed" state.** v1 already fills one
kind of story: an unchecked story inside an accepted sprint (`S1-5` in
factcheck-site) renders muted grey with a `--fill` background, to mark work that
was dropped rather than work that is upcoming. If shading starts to mean
"progress", that grey fill becomes ambiguous — a dropped story would read as a
done one, which is the opposite of the truth. Whatever shade is chosen for
done/in-progress has to stay clearly distinct from it, or the dropped state needs
a different treatment entirely (an outline, a strike, a distinct hue).

**Open, to settle in Blueprint:** whether done and in-progress share one shade or
take two; if one, what still distinguishes the current story at distance (border
weight, a marker, position); how the shading behaves on the phone layout, where
stories are a vertical list rather than a horizontal trail.

**Size estimate:** small. Mostly `css/monitor.css`; the state classes
(`done` / `progress` / `planned` / `stale`) are already on the DOM, so no
JavaScript change is required unless the dropped state needs new markup.

### 2a. Per-agent pastel fills on completed stories

**What Luke asked for:** completed stories get pastel fills, light enough that
black text stays legible. **Each agent gets its own colour**, so the fill says at
a glance who did the work. Tentative assignments, mirroring how Luke colours the
agent terminals: Cody light blue, Sandy orange, Archie brown. Treat these as
provisional — they will probably change.

**Backlog:** an option for darker fills with light text.

**Feasibility — confirmed against real data.** The monitor does not currently read
agent attribution, but the repos already record it. Every story carries a
structured line directly under its heading:

```
**Owner:** Cody · **Model:** `claude-sonnet-5` · **Size:** m · **Depends on:** S2-2
```

Coverage is **100% in both reference projects** — 28/28 stories in factcheck-site,
38/38 in muse-monitor. No AMS process change is needed to ship this.

**But the owner values need normalising.** The agent name is the leading token;
everything after a bracket or dash is commentary:

| Raw value | Agent |
|---|---|
| `Cody` | Cody |
| `Sandy (Junior — Haiku 4.5)` | Sandy |
| `Quinn (QA — hired for this by Hannah)` | Quinn |
| `Cody (Senior — Sonnet 5) — goroutine/channel synchronization is a design question…` | Cody |

**Multi-agent stories are real and need a rule.** Eight of the 66 stories across
the two projects name two people:

- `Nadia (runs it) and Lila (writes it)` — all four factcheck-site retro stories
- `Luke (runs Muse) + Cody (Sonnet 5, analysis)` — muse-monitor Sprint 0

Options: colour by the first-named agent, split the fill between both, or fall
back to neutral. Undecided.

**Agents seen across the two projects:** Cody, Sandy, Quinn, Lila, Nadia, Archie,
Luke, Fable. Eight, and a ninth (Hannah) is referenced. A palette needs to cover
roughly this many and stay pastel enough for black text.

**Size estimate:** small-to-moderate. A parser addition in `js/sprints.js` (read
and normalise `**Owner:**`), a colour map, and CSS. The spec gains a section
pinning the Owner line's format.

### 2b. Mark newly changed stories after a poll

**What Luke asked for:** when the monitor notices a change, the newly changed
stories should be easy to pick out. A different shade, a "new" tag, or some other
visual indicator — the mechanism is open, the requirement is that a change is
obvious.

**Relationship to v1:** v1 flashes a whole panel for 2.2 seconds on change
(`.changed`, `--flash`) and writes "updated just now" in the status bar. That is
panel-level and it fades. This asks for something story-level and persistent
enough to still be visible when you look up.

**Open, to settle in Blueprint:** how long the marker persists — until the next
poll, until the user interacts, or for a fixed time; whether it survives a page
reload (which would need stored state, since a reload currently has no memory of
what was there before); whether a story that changes state (planned → in progress
→ done) is marked differently from a story that is newly added.

**Interaction with 2a:** if completed stories are already filled per-agent, a
"changed" shade cannot be another fill without fighting the agent colours. A
border, an outline, a corner tag or a badge is more likely to survive that
collision.

**Size estimate:** moderate. Needs before/after story-level diffing in
`js/app.js` (v1 only diffs at the file-listing level), plus render and CSS work.

**Decided — how agents get their colours:** auto-assign from a fixed pastel
palette, with an optional per-project override. Auto-assignment means the monitor
self-colours on any AMS repo with no configuration, which it must, since it is
generic and will meet rosters it has never seen. A project that cares about
specific colours can pin them.

Assignment must be **deterministic** — the same agent gets the same colour on
every load and in every browser, so a hash of the normalised agent name into the
palette rather than first-seen order, which would shuffle when a sprint's story
order changes.

**Where the override could live — both reference projects already have a roster.**
`AMS/OFFICES/` holds one directory per agent, and `OFFICES` is a declared AMS
component in factcheck-site's `CONFIG.md`:

```
AMS/OFFICES/{archie,cody,hannah,lila,nadia,quinn,sandy}/
    identity.md   desk.md   open-threads.md   working-notes.md
```

muse-monitor has `AMS/OFFICES/` too. So the override has an idiomatic home —
a colour field in each agent's `identity.md`, or a single roster table — and the
monitor can also use the directory listing as the canonical agent roster rather
than inferring one from whoever happens to own a story.

Cost check: reading `OFFICES/` is one extra API call at boot, and reading a
colour from every `identity.md` is one raw fetch per agent (unmetered, but
serial latency). Blueprint should decide whether the override is worth that, or
whether a single roster file is the better shape.

`AMS/Personas.md` additionally maps persona → name → role (Cody = Coder, Lila =
Librarian, Hannah = HR). Not needed for colour, but it is where a tooltip or
legend could get "Cody — Coder" rather than just "Cody".

**Degrade gracefully:** muse-monitor does not declare `OFFICES` in its config,
and other projects may have no roster at all. Missing roster means auto-assign
only; it must never be an error state.

---

## 3. Hover popup on a story block

**What Luke asked for:** mousing over a story block shows a popup with
information about that story — title plus whatever else is useful. Luke was
explicit that he did not know what data exists, and named some guesses: when it
was run, token cost ("probably hard"), what time, where it ran, commit info.

**Inventory of what is actually available.** Measured across factcheck-site's 28
stories.

### Free — already in the story block, 100% coverage

| Field | Example |
|---|---|
| Story id and title | `S2-5 · Result page` |
| State | done / in progress / planned / not completed |
| **Owner** | `Cody` — also drives the agent colours in idea 2a |
| **Model** | `claude-sonnet-5` — which model did the work |
| **Size** | `s` / `m` |
| **Depends on** | `S2-3, S1-5` — could become links to those stories |
| **Scope** | 1–3 bullets describing the work |
| **Acceptance criteria** | Ticked checklist; 53 across 28 stories, 1–4 per story |

Sprint retro stories additionally carry `Accepted when`, `Status`, `Date` and
`Reviewed by`.

All of this is already fetched — the sprint file is in memory. A popup built from
these costs **zero extra API calls**.

### Cheap — by linking handoffs to stories

**13 of 19 factcheck-site handoffs name a story in the filename**
(`handoff-2026-08-26-s1-2-spike-script-cody.md` → `S1-2`). The link works in both
directions, and gives a date and an author per story. This is the honest answer
to "when was it run" — the handoff's date, not a true timestamp. Two handoffs can
name the same story (`S1-R` has both a retro and a learnings handoff), so it is
one-to-many.

Costs nothing extra: the handoff index is already loaded.

### Expensive — commit information

Per-story commit attribution means finding the commit where that story's checkbox
flipped, which needs the sprint file's commit history plus a diff per commit.
That is many API calls against a 60/hour budget, for a hover. If commit data is
wanted, the affordable version is the sprint file's own last-modified commit,
shared by every story in that sprint — one call, much less precise.

### Not available at all

- **Token cost.** Not in the repo. This is agent telemetry, and nothing in AMS
  currently writes it down. It would need a process change — agents recording
  spend per story — before any monitor could show it. Luke's instinct that this
  one is hard was right, and the reason is that the data does not exist rather
  than that it is difficult to fetch.
- **Where it ran.** Not recorded anywhere.
- **Duration / wall-clock time.** Not recorded per story. Handoff filename dates
  give a day, not a time.

**Open, to settle in Blueprint:** which fields make the cut; hover versus click
(hover is awkward on a phone, which has no hover state — the phone story list may
need tap-to-expand instead); whether the popup is a tooltip or a panel; whether
`Depends on` becomes navigable.

**Size estimate:** small if it draws only on already-parsed data — a parser
addition in `js/sprints.js` to keep the story body fields, plus render and CSS.
Moderate if handoff-to-story linking is included. Expensive and rate-limit-risky
if per-story commit data is included.

**Decided:** desktop-only for MVP; tap-to-expand on the phone goes to the
backlog. Include **all the zero-cost fields** — Owner, Model, Size, Depends on,
Scope, acceptance criteria with tick state — plus the linked handoff where the
filename names the story. Exclude token cost (data does not exist), where-it-ran
(same), and per-story commit lookups (rate-limit cost).

Luke will look at the result and then decide whether he wants more or less. So
build the popup so fields are easy to add and remove — a list driven by data
rather than hand-placed markup.

---

## 4. Stories as square boxes, one row per sprint

**What Luke asked for:** story blocks become squares with wrapped text, so every
story in a sprint sits on a single line on desktop. Long story names cut off
rather than growing the box.

**Change from v1:** stories are currently variable-width pills on a single line
of text (`white-space:nowrap`, ellipsis, `max-width:270px`) in a wrapping flex
row, so a nine-story sprint spills onto three rows of uneven boxes. The new shape
is a fixed-count row of equal squares with text wrapped and clamped inside.

**The constraint this runs into.** Fitting every story on one line means the
square shrinks as the story count grows. Measured against v1's real layout —
330px side panel, 170px sprint-name column, 110px checkpoint:

| Window | 4 stories | 7 stories | 9 stories (factcheck-site sprint 2) |
|---|---|---|---|
| 1280px | 146px | 80px | **60px** |
| 1400px | 176px | 97px | **74px** |
| 1680px | 246px | 137px | **105px** |
| 1920px | 306px | 171px | **132px** |

Nine stories on a 1400px window gives roughly a 74px square. That holds about
three short wrapped words at a readable size — "Prompt-caching measurement" would
truncate. This is in direct tension with idea 2's acceptance criterion, that the
board reads from across the room: one row is tidier, but small squares are less
legible, not more.

Largest sprint seen in the reference projects is 9 stories (factcheck-site sprint
2); muse-monitor's largest is 7.

**Open, to settle in Blueprint:** what happens as story count grows — squares
shrink to fit (all visible, tiny when many), squares stay a fixed minimum and the
row scrolls horizontally (legible, but some stories off-screen, which weakens the
progress-at-a-glance goal), or shrink to a floor and then scroll. Also: how many
wrapped lines before the text clamps, and whether the story id stays visible when
the title is cut.

**Note:** reclaiming width is possible if squares turn out too small — the side
panel is a fixed 330px and the sprint-name column 170px; either could give
ground, or the board could go full-width with the panels below it.

**Size estimate:** small — `css/monitor.css` only, unless a scrolling row or a
responsive square size needs measurement in JavaScript.

**Decided:** either behaviour is acceptable. Luke: "row scrolls sideways with some
stories off-screen is fine — if the user doesn't like that, create sprints with
fewer stories." Alternative he offered and the vision slide supports: fit 5–6
stories per row and let the rest wrap.

**Recommendation: cap the row at 5–6 and wrap.** The vision slide shows a maximum
of five per row, wrapping preserves the across-the-room goal, and nothing goes
off-screen. Note this makes the change from v1 *equal-sized squares with a capped
column count*, rather than literally one line per sprint — a nine-story sprint
still takes two rows, but they are even rows of equal boxes instead of three
ragged ones.

### The vision slide

`blueprint/ams-agent-monitor/reference/05-sprints-board-scene-v1.jpg` — copied out
of `INCOMING/`. Luke's caveat: its story names are unrealistically short, so real
data will look busier.

What it shows that v1 does not:

- **Story cards are equal squares** with text wrapped to two lines, pinned like
  index cards. Five per row at most.
- **Status lives inside the card**, as a large icon at the bottom centre: green
  tick for done, orange ellipsis for in progress, empty circle for planned. v1
  uses a 9px dot beside the text — far less visible, which is exactly the
  "too subtle" complaint behind idea 2.
- **Each card has a coloured pin at the top**, and the pin colour tracks the
  **sprint** — blue sprint 1, green sprint 2, purple sprint 3, orange sprint 4.
  The sprint's name box and checkpoint carry the same colour.
- **An arrow** runs from the sprint name box into the story row.
- **The checkpoint is a rosette** — "Demo" or "Accepted" with a ribbon.
- Warm paper aesthetic throughout; v1 is a monochrome wireframe.

**Conflict to resolve:** the slide colours by *sprint*; idea 2a colours by
*agent*. Both cannot own the card's main fill. Options: agent colour fills the
card body while sprint colour stays on the pin, the name box and the checkpoint;
or the slide's sprint colouring is dropped in favour of agent colouring. The pin
is a natural home for one of the two.

**Decided:** drop sprint colouring. It was there to make the slide pretty, not to
carry meaning. **Agent colour is the only colour on the board**, which keeps one
colour dimension with one meaning — the fill answers "who did this" and nothing
competes with it. Luke reserves the right to change his mind once he sees it, so
keep the sprint-colour hook cheap to reintroduce (a class on the row, unused).

---

## 5. Require a GitHub token for MVP; put the unauthenticated version on the backlog

**What Luke asked for:** a lot of v1's design went into fitting inside the
unauthenticated 60-requests-per-hour budget. For MVP, require a token instead and
backlog the free version, to be revisited once there is experience with a less
compromised UI.

**What this buys.** Authenticated GitHub API access is **5,000 requests per hour**
against 60 — roughly 83×. Several v1 compromises and several open questions in
this document dissolve:

| Constrained by the free budget | With a token |
|---|---|
| Poll every 2 min, one head-commit call per tick | Poll every 15–30 s; check listings directly |
| Commit times fetched only for the newest handoff, others lazily | Commit time for every handoff up front |
| Per-story commit attribution ruled out as too expensive (idea 3) | Affordable — the expensive tier of the hover popup opens up |
| Boot deliberately trimmed to 6 calls | Boot cost stops mattering |
| Reading `OFFICES/*/identity.md` per agent questioned on cost (idea 2a) | Free |

**The constraint that shapes this: a static page cannot keep a secret.** Anything
in the HTML, JS, or a query string is visible to everyone who loads the page, and
a token committed to the repo or baked into a GitHub Pages deployment is a
published credential — GitHub will revoke it on detection, and anyone who saw it
can use it until then. A query-string token additionally leaks into browser
history, bookmarks and referrer headers.

**So the token must be supplied by the viewer at runtime and stored only in that
viewer's browser** — a field on the landing screen (which idea 1 is already
building), saved to `localStorage`, never committed, never in the URL, never
shared between viewers. Each person who opens the page uses their own token.
This is also the only shape that works for a page hosted publicly.

Recommend a **fine-grained token with read-only access to public repositories**
and nothing else, which matches the monitor's read-only promise. The UI should
say plainly what the token is used for and that it stays in the browser, offer a
way to clear it, and keep working without one — degrading to the current
unauthenticated behaviour rather than refusing to run.

**Open, to settle in Blueprint:** whether "require" means the page refuses to run
without a token or simply works better with one (recommend the latter — it keeps
the zero-configuration first look that makes the repo picker worth having);
whether the token is per-repo or global; what the poll interval becomes.

**Size estimate:** small. A field on the landing form, `localStorage` read/write,
an `Authorization` header in `js/github.js`, and a revisit of the poll interval.
The saving is larger than the cost: the head-commit indirection in `js/app.js`
exists only to conserve quota.

---

## 6. Unit tests

**What Luke said:** "Maybe you were right about the need to unit tests."

Accepting the gap identified in the v1 retrospective: the 34 definition-of-done
checks were run as ad-hoc JavaScript in a browser console and passed, but nothing
was saved. They cannot be re-run, so a parser regression would now be invisible
until someone eyeballed a board. The v1 plan's "no unit tests" was a deliberate
choice — if files are hard to parse, fix the files — but that argument covers
parser *tolerance*, not parser *correctness*.

**What makes this cheap:** the parsers are already pure functions over strings
with no DOM dependency — `AMSSprints`, `AMSHandoffs`, `AMSRepo.parseConfig`,
`AMSConfig.read`. They are testable as they stand, with no refactoring.

**What the tests should cover first** — every one of these is a bug that actually
occurred during the v1 build, so the suite starts as a regression net rather than
a theoretical exercise:

- `## Acceptance` as the final section in a file (the `\Z` bug — silently read an
  accepted sprint as pending)
- `## Example` tables in `CONFIG.md` (resolved `handoff_dir` to `journal`)
- Lowercase `config.md` versus `CONFIG.md`
- Sprint id ordering: `5` < `5a` < `5b` < `6`
- Story ids `S2-4`, `S1-R`, `F1-1`
- Decorated acceptance status: `✓ Accepted`, `✅ **ACCEPTED** by …`, `Accepted — …`
- Handoff heading mapping across both projects' real headings
- Handoff filename → label, including the story-id rejoin

**Shape:** a `checks.html` that runs assertions against the bundled fixture and
prints pass/fail, plus the 34 DoD items as executable checks rather than prose.
No build step, no test runner, no dependency — consistent with the project's
constraints, and runnable by opening a file.

**Size estimate:** moderate, and it grows with each feature above. Worth pricing
against the "keep the codebase legible" constraint: it roughly doubles the file
count while adding no product behaviour.

**Decided — two phases.** v2: token, repo picker, agent colours, square cards.
v3: hover popup, unit tests. Luke: the split "feels right in terms of tangible
improvements with each version."

**Decided — the free tier updates on command, not on a timer.** Luke's proposal,
accepted. The unauthenticated path gets a refresh button; only the authenticated
path polls.

**Why this is worth more than the quota it saves.** v1 already fits the free
budget — 36 of 60 in a quiet hour — so this is not needed to make the numbers
work. What it buys is the deletion of the machinery that exists *only* to
conserve quota:

- the head-commit indirection in `js/app.js`, whose entire purpose is answering
  "did anything change" for one call instead of two
- the ETag/304 conditional-request cache in `js/github.js`
- the poll timer, and the stale-versus-fresh state transitions around it

With a token at 5,000/hour there is no reason to be clever: re-fetch the listings
outright every 20–30 seconds. Without one, re-fetch outright when the user asks.
**Both paths then share a single plain "fetch everything and redraw" routine**,
called by a timer or by a button. That is meaningfully *less* code than v1, which
is the opposite of what adding a feature usually costs — and it pays directly
into the keep-it-legible constraint.

Free-tier arithmetic: 6 calls to load, roughly 4–6 per manual refresh, so about
nine refreshes an hour inside the budget. Ample for a human pressing a button.

**The honest cost:** the original concept promised that "when an agent commits a
new handoff, the page notices and redraws." Without a token that promise is gone,
and the free version becomes a page you reload rather than a monitor that
watches. That is a real reduction, and the empty-state copy should say so plainly
rather than quietly degrading — something like "add a token to watch this repo
live" next to the refresh button, so the limitation reads as a choice with an
exit rather than a defect.

**Keep the refresh button in the token path too.** "Refresh now" is a good
affordance whether or not a timer is also running.

---

## Decided: the monitor gets its own repo, published with GitHub Pages

Settled 2026-08-31, closing the last open question from the v1 plan.

**Consequences:**

- **Public hosting makes the viewer-supplied token mandatory, not merely
  preferable.** Anyone can load the page, so no token can live in the source or
  the deployment. Confirms the `localStorage` design in idea 5.
- Other people can point the published page at their own AMS projects with their
  own tokens. This is what makes the generic repo picker worth building — the
  monitor stops being Luke's tool and becomes anyone's.
- The README is now a public front door rather than an internal note.
- The spec becomes publicly linkable, which strengthens the case when the kit PR
  is eventually proposed.

**Recommended layout:** move the contents of `monitor/` to the repository root so
Pages serves `https://<user>.github.io/<repo>/` rather than a `/monitor/`
subpath, and keep `spec/` and `blueprint/` alongside. They are markdown and
harmless to serve, and having the format spec publicly readable is a feature.

**Left to Luke:** creating the GitHub repo, adding the remote, enabling Pages,
and the first push. This session has a standing instruction never to push.

**Decided — the kit PR waits for v2, possibly v3.** Extend the spec with what v2
needs, then propose upstream. v2 adds a dependency the spec does not yet cover:
the `**Owner:**` line under each story heading, which drives the agent colours.
It sits at 100% coverage in both reference projects but is not pinned anywhere.

Luke asked to be reminded, so this is also recorded in session memory as
`kit-pr-deferred-until-v2` — it will surface in future sessions on this project,
not only in this file.

**Decided — keep the "not completed" state; leave `S1-5` alone.** Luke: a
grey-filled dropped story "is enough to remind us that we might want to address
it at some point." No change to factcheck-site, and the fourth state stays,
since other projects will hit it regardless.

**Palette constraint this creates:** the dropped state is grey-filled, so the
per-agent pastels in idea 2a must be **clearly distinguishable from grey at a
distance**. No beige, taupe, or desaturated near-neutrals in the agent palette,
or a dropped story will read as somebody's colour. Worth checking the palette
against the grey by eye at across-the-room distance, which is idea 2's own
acceptance criterion.

---

## Build sequence for v2

Luke left the iteration shape to the implementer, with one requirement: he wants
to see the coloured square stories once they exist. That is an intermediate
checkpoint, not the end of v2.

1. **Square cards, agent colours, bigger status icons.** → *Luke reviews here.*
   No token dependency: `**Owner:**` is already in the sprint file and the cards
   are CSS. Fastest route to something judgeable, so his reaction lands before
   anything is built on top of it.
2. **Token, refresh button, deletion of the quota-conserving machinery.**
   Invisible, and a net reduction in code.
3. **Repo picker**, carrying the token field from step 2.

**On the experiment.** Luke is not running AMS for this project — no team of
agents, one conversation with one agent — and is doing it deliberately to learn
the trade-offs. The relevant consequence for the implementer: there is no QA
persona, no architect, nobody to disagree. So flag judgement calls as they are
made rather than presenting only finished work.
