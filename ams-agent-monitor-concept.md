# AMS Agent Monitor — concept brief

Input for a Blueprint planning session. This is the idea as discussed so far, not the plan. Blueprint's job is to turn it into one.

## One paragraph

A read-only web page that watches the handoff directory of any GitHub repository that uses AMS as its methodology, and shows the current state of that project as a sprint board: what's been accomplished, what's being worked on, and what's ahead. When an agent commits a new handoff, the page notices and redraws. Nobody edits anything through it. It's a window, not a control panel.

## Why

AMS (Agent Management System, github.com/cellear/AMS) manages AI coding agents with scrum practices. A project built with AMS accumulates sprint and handoff files in its own repository; AMS is the methodology, the monitored project is the subject. Agents pass work to each other through handoff files. Those files already contain the project's state — but reading them means opening that project's repo and reading markdown. The monitor makes that state glanceable, from any browser, without running anything locally.

## Decisions already made

- **Source of truth is the repo, not the agents.** The monitor reads files from GitHub. It does not talk to any LLM.
- **Hosted, static web app.** No backend. A single page that calls the GitHub API (or raw.githubusercontent.com) for a public repo. Should be hostable on GitHub Pages, possibly served from the AMS repo itself — but serving it from AMS is not the same as pointing it at AMS; wherever it is hosted, it watches whatever project repo it is given.
- **Commit-driven, polled.** Updates land when handoffs are committed, not when files are written locally. Unauthenticated GitHub API calls are limited to 60/hour per IP, so polling is on the order of every 1–2 minutes. An optional personal token could raise that.
- **Read-only.** No writes, no editing, no triggering agents. This is a hard boundary for v1.
- **Two layouts, same content.** Desktop and phone. See the wireframe (`ams-agent-monitor-wireframe.html`).

## What the page shows

Reference: the wireframe, and the "AMS – Sprints" slide from the talks.

1. **Status bar** — which repo and directory is being watched, when the newest handoff landed, when the page last polled, and a visible "read-only" marker.
2. **Sprint board** — one row per sprint. Each row: sprint name and theme, its stories left to right, and a checkpoint at the end of the row (Demo / Accepted). Each story has a status: done, in progress, or planned. The current sprint is visually emphasized.
3. **Latest handoff** — the most recent handoff file rendered as-is, in its five sections: Context, What's done, What's next, Notes/blockers, Files/references.
4. **Handoff history** — the handoff files newest-first with commit times. Selecting one shows it in the handoff panel.

On a phone: same four things, stacked. The board becomes a sprint picker (defaulting to the current sprint) above a vertical story list; handoff and history become collapsible sections underneath.

## The handoff protocol (what the page is parsing)

Each handoff is a markdown file with these sections:

- Context
- What's done
- What's next
- Notes / blockers
- Files / references

Handoffs are written at the end of an agent's work session and picked up by the next agent. Several handoffs occur within a sprint.

## Open questions — these are the ones that matter

The board can only be drawn if sprint and story structure can be recovered from a monitored repo. None of this has been pinned down yet. Blueprint should answer it by reading the AMS kit for the intended convention and a real AMS-built project for what the files actually look like in practice:

- How are handoff files named and ordered? Do the names encode sprint number and sequence?
- Where do sprint names, themes, and story lists live? In the handoffs themselves, in a separate sprint/story file, in issues, or nowhere yet?
- How is story status derived? Presumably "What's done" vs. "What's next" in the latest handoff — but is that reliable enough to draw a board from, or does AMS need a structured field?
- Where is the sprint checkpoint (Demo / Accepted) recorded?
- If the answer to any of the above is "nowhere," should the monitor define a small convention that AMS adopts, or should it degrade to showing only handoffs (panels 3 and 4) with no board?

Smaller questions Blueprint should also settle:

- Repo and path: configured in the page or given in a query string? There is no default target repo — the monitor has to work for any AMS-using project.
- Poll interval, and whether to support an optional token.
- Behavior when the API is unreachable, rate-limited, or the directory is empty.
- Implementation constraints: vanilla HTML/JS in one file, or a framework? Any build step, or none?
- How the page indicates "something changed since you last looked."

## Non-goals for v1

- Watching a local directory (a local-server or native-app version could come later).
- Any write path to the repo.
- Authentication or private repos.
- Watching more than one repo at once. The monitor targets a single AMS-using project at a time; no multi-project dashboard.
- Anything the agents do; the monitor is inert.

## About this experiment

This project is being built deliberately the opposite way from AMS: waterfall. Detailed spec first, then a single build pass. The contrast being tested is plan-heavy-up-front versus AMS's plan-light-and-iterate. The implementing agent may ask questions along the way — what stays out is the AMS process itself: no sprints, no handoffs, no mid-build demos. So the plan Blueprint produces has to be complete enough that any question during the build is a small one, not a design decision. And it needs a written definition of done, agreed before the build starts, so the result of the single pass can be judged.
