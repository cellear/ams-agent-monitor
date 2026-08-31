# AMS Agent Monitor

A read-only web page that watches any GitHub repository using
[AMS](https://github.com/cellear/AMS) as its methodology, and draws that
project's state as a sprint board: what is done, what is being worked on, and
what is ahead.

It reads sprint and handoff files straight from the repo. It does not talk to
any agent or LLM, and it has no write path — every request it makes is a GET.

## Use it

```
index.html?repo=owner/name
```

For example, `?repo=cellear/factcheck-site`.

There is no default repository. The monitor is generic: point it at whichever
AMS project you want to watch.

| URL | What it does |
|---|---|
| `?repo=owner/name` | Watch a public repo, polling every 2 minutes |
| `?fixtures=1` | Render the bundled snapshot with no network access |
| *(no parameter)* | Explain itself and show the URL format |

Public repositories only. The monitor is unauthenticated, so a private repo
reports as not found.

## What it shows

1. **Status bar** — repo and resolved directories, when the newest handoff
   landed, when the page last polled, and a read-only marker.
2. **Sprint board** — one row per sprint, stories left to right, checkpoint at
   the row's end. The current sprint is emphasized.
3. **Latest handoff** — rendered into the five canonical sections.
4. **Handoff history** — newest first; select one to view it.

On a phone the board becomes a sprint picker over a vertical story list, and
the two panels collapse into accordions.

## How it finds things

The AMS directory (`AMS/`, then `.ams/`) is listed and the config file matched
case-insensitively — `raw.githubusercontent.com` is case-sensitive, and
projects differ on `CONFIG.md` versus `config.md`. Directory settings come from
the config's tables, honoring the "Your value" column; tables under an
"Example" heading are skipped, since the kit's template ships one. Each
directory is then looked for inside the AMS directory first, then at the
repository root.

A repo with no `sprint-*.md` files still renders its handoffs, with the board
showing what it is waiting for.

## Rate limits

Unauthenticated GitHub API access allows 60 requests per hour per IP, and an
unauthenticated `304 Not Modified` **still costs a request** — measured, not
assumed. So each poll asks one question: has the repository's head commit
moved? Only when it has are the directory listings re-read.

Booting costs 6 requests; a quiet tick costs 1. A fully quiet hour uses 36 of
60. File contents come from `raw.githubusercontent.com`, which is not metered.

If the limit is reached anyway, the page keeps the last good data, says so, and
names when the limit resets.

## Files

```
index.html              page shell
css/monitor.css         desktop and phone layouts
js/config.js            query-string parsing
js/github.js            GET-only API and raw fetch, ETag cache, rate awareness
js/ams.js               CONFIG discovery, directory resolution
js/sprints.js           sprint files → board model
js/handoffs.js          handoff files → five-section model
js/render.js            model → DOM
js/app.js               boot, poll loop, change detection, selection
fixtures/               frozen snapshot used by ?fixtures=1
```

No build step and no framework. One CDN dependency, `marked`, pinned. Open
`index.html` directly or serve the directory over HTTP.

> Opening from `file://` works for a live repo, but `?fixtures=1` needs HTTP,
> because browsers block reading the local JSON snapshot. `python3 -m http.server`
> from this directory is enough.

## The format it expects

Canonical syntax is in [`../spec/ams-monitor-format.md`](../spec/ams-monitor-format.md);
what "finished" means for v1 is in
[`../spec/definition-of-done.md`](../spec/definition-of-done.md).

The parser is canonical-first with a documented tolerance layer for files
written before that spec existed — mixed heading casings, decorated acceptance
status lines, lowercase config filenames. Where a legacy form is used, the
page shows the file's own wording rather than hiding the difference.
