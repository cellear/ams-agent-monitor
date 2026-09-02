/* Orchestration: boot, poll, change detection, selection. Global: AMSApp. */
var AMSApp = (function () {
  'use strict';

  /* Authenticated: poll, because 5,000/hour affords it. Unauthenticated: no
     timer at all — the user presses Refresh. Either way the work is the same
     "fetch the listings and redraw", so there is one path, not two. */
  var POLL_MS = 30000;
  var R = AMSRender;

  var state = {
    cfg: null, repo: null, resolved: null,
    board: null, handoffIndex: [], handoffCache: {},
    selectedFile: null, selectedSprint: null,
    lastPolled: null, lastGood: null, latestCommit: null,
    stale: false, note: '', timer: null, booted: false, refreshing: false
  };

  /* ---------- shared shaping ---------- */

  function buildBoard(files) {
    return AMSSprints.build(files.map(function (f) {
      return AMSSprints.parseFile(f.name, f.body);
    }));
  }

  function indexHandoffs(entries) {
    return AMSHandoffs.sortIndex(entries.filter(AMSHandoffs.isHandoffFile))
      .map(function (e) {
        return { name: e.name, path: e.path, sha: e.sha,
                 date: AMSHandoffs.dateFromName(e.name),
                 storyId: AMSHandoffs.storyIdFromName(e.name),
                 agent: AMSHandoffs.agentFromName(e.name),
                 label: AMSHandoffs.labelFromName(e.name), commit: e.commit || null };
      });
  }

  function paintAll(changed) {
    var b = state.board;
    R.statusBar({
      repo: state.repo || 'fixture snapshot',
      paths: state.resolved
        ? [state.resolved.sprints && state.resolved.sprints.path,
           state.resolved.handoff && state.resolved.handoff.path].filter(Boolean).join(' · ')
        : '',
      latestCommit: state.latestCommit, lastPolled: state.lastPolled,
      lastGood: state.lastGood, stale: state.stale, note: state.note,
      refreshing: state.refreshing, authenticated: AMSGitHub.hasToken()
    });
    R.tokenNote(AMSGitHub.hasToken(), AMSGitHub.rate);

    if (b) {
      if (!state.selectedSprint || !b.sprints.some(function (s) { return s.id === state.selectedSprint; })) {
        state.selectedSprint = b.current ? b.current.id : (b.sprints[0] && b.sprints[0].id);
      }
      R.board(b, state.selectedSprint);
    }
    document.getElementById('board-empty').classList.toggle('hidden', !!(b && b.sprints.length));

    R.history(state.handoffIndex, state.selectedFile);
    var sel = state.selectedFile || (state.handoffIndex[0] && state.handoffIndex[0].name);
    var parsed = sel ? state.handoffCache[sel] : null;
    R.handoff(parsed, {
      repo: state.repo,
      historical: !!(state.selectedFile && state.handoffIndex[0] &&
                     state.selectedFile !== state.handoffIndex[0].name)
    });
    R.showApp();
    if (changed && changed.length) R.flash(changed);
  }

  /* ---------- fixture mode ---------- */

  function bootFixtures() {
    return fetch('fixtures/factcheck-site.json').then(function (r) {
      if (!r.ok) throw new Error('fixture fetch ' + r.status);
      return r.json();
    }).then(function (fx) {
      state.repo = fx.repo + ' (frozen snapshot)';
      state.resolved = {
        sprints: { path: 'AMS/SPRINTS' }, handoff: { path: 'AMS/HANDOFF' }
      };
      state.board = buildBoard(
        fx.sprints.filter(function (s) { return s.body && AMSSprints.isSprintFile(s); })
      );
      state.handoffIndex = indexHandoffs(fx.handoffs);
      fx.handoffs.forEach(function (h) {
        state.handoffCache[h.name] = AMSHandoffs.parse(h.name, h.body);
      });
      /* The snapshot has no commit times. Use the newest handoff's own filename
         date so the bar reports the handoff's age, not the capture's. */
      var newestFx = state.handoffIndex[0];
      state.latestCommit = newestFx && newestFx.date ? newestFx.date + 'T12:00:00Z' : fx._captured;
      state.lastPolled = fx._captured;
      state.lastGood = fx._captured;
      state.note = 'fixture';
      state.booted = true;
      paintAll();
    });
  }

  /* ---------- live mode ---------- */

  function loadSprints(res) {
    if (!res.sprints) return Promise.resolve(null);
    var files = res.sprints.entries.filter(AMSSprints.isSprintFile);
    return Promise.all(files.map(function (e) {
      /* e.sha keys the fetch to this exact version of the file: the listing
         is what told us the file changed, so the body must be read at the sha
         the listing reported, not at whatever a cache still holds for HEAD. */
      return AMSGitHub.raw(state.repo, e.path, null, e.sha).then(function (body) {
        return { name: e.name, body: body };
      });
    })).then(buildBoard);
  }

  function loadHandoffIndex(res) {
    if (!res.handoff) return Promise.resolve([]);
    return Promise.resolve(indexHandoffs(res.handoff.entries));
  }

  function loadHandoffBody(entry) {
    if (!entry) return Promise.resolve(null);
    if (state.handoffCache[entry.name]) return Promise.resolve(state.handoffCache[entry.name]);
    return AMSGitHub.raw(state.repo, entry.path, null, entry.sha).then(function (body) {
      state.handoffCache[entry.name] = AMSHandoffs.parse(entry.name, body);
      return state.handoffCache[entry.name];
    });
  }

  function bootLive() {
    return AMSGitHub.repoInfo(state.repo).then(function () {
      return AMSRepo.resolve(state.repo, AMSGitHub);
    }).then(function (res) {
      state.resolved = res;
      if (res.verdict === 'not-ams') { showNotAms(res); return null; }

      return Promise.all([loadSprints(res), loadHandoffIndex(res)]).then(function (r) {
        state.board = r[0];
        state.handoffIndex = r[1];

        if (res.verdict === 'no-sprints') {
          document.getElementById('board-empty').textContent =
            'No sprint files in ' + (res.sprints ? res.sprints.path : (res.amsDir + '/SPRINTS')) +
            '. The board is waiting for files named sprint-*.md.';
          document.getElementById('board-empty').classList.remove('hidden');
        }

        var newest = state.handoffIndex[0];
        return Promise.all([
          loadHandoffBody(newest),
          newest ? AMSGitHub.lastCommit(state.repo, newest.path).catch(function () { return null; })
                 : Promise.resolve(null)
        ]).then(function (x) {
          if (x[1]) { state.latestCommit = x[1].date; if (newest) newest.commit = x[1].date; }
          state.lastPolled = new Date().toISOString();
          state.lastGood = state.lastPolled;
          state.booted = true;
          paintAll();
          schedule();
        });
      });
    }).catch(showBootError);
  }

  /* ---------- polling ---------- */

  function schedule() {
    if (state.timer) clearTimeout(state.timer);
    /* Only the authenticated path runs on a timer. Without a token the page
       waits for the Refresh button, which is the whole reason the ETag and
       head-commit machinery could be deleted. */
    if (AMSGitHub.hasToken()) state.timer = setTimeout(function () { refresh(); }, POLL_MS);
  }

  /* Re-read both listings and whatever changed under them. Called by the timer
     when authenticated, and by the Refresh button always. */
  function refresh(opts) {
    if (!state.resolved || !state.repo) { schedule(); return Promise.resolve(); }
    var res = state.resolved, changed = [], work = [];
    state.refreshing = true;
    if (opts && opts.manual) paintAll();

    return Promise.all([
      res.handoff ? AMSGitHub.listDir(state.repo, res.handoff.path) : Promise.resolve(null),
      res.sprints ? AMSGitHub.listDir(state.repo, res.sprints.path) : Promise.resolve(null)
    ]).then(function (r) {
      var hoRes = r[0], spRes = r[1];

      if (hoRes) {
        var next = indexHandoffs(hoRes.entries);
        var before = state.handoffIndex.map(function (e) { return e.name + ':' + e.sha; }).join('|');
        var after = next.map(function (e) { return e.name + ':' + e.sha; }).join('|');
        if (before !== after) {
          /* A changed sha means the body is stale even under the same name. */
          next.forEach(function (e) {
            var prev = state.handoffIndex.filter(function (p) { return p.name === e.name; })[0];
            if (prev && prev.sha !== e.sha) delete state.handoffCache[e.name];
            if (prev && prev.commit) e.commit = prev.commit;
          });
          state.handoffIndex = next;
          changed.push('acc-handoff', 'acc-history');
          var newest = next[0];
          if (newest) {
            work.push(loadHandoffBody(newest));
            work.push(AMSGitHub.lastCommit(state.repo, newest.path).then(function (c) {
              if (c) { state.latestCommit = c.date; newest.commit = c.date; }
            }, function () {}));
          }
        }
      }

      if (spRes) {
        var sBefore = res.sprints.entries.map(function (e) { return e.name + ':' + e.sha; }).join('|');
        var sAfter = spRes.entries.map(function (e) { return e.name + ':' + e.sha; }).join('|');
        if (sBefore !== sAfter) {
          res.sprints.entries = spRes.entries;
          changed.push('main');
          work.push(loadSprints(res).then(function (b) { if (b) state.board = b; }));
        }
      }

      return Promise.all(work).then(function () {
        state.lastPolled = new Date().toISOString();
        state.lastGood = state.lastPolled;
        state.stale = false;
        state.refreshing = false;
        state.note = changed.length ? 'updated just now' : '';
        paintAll(changed);
        schedule();
      });
    }).catch(function (err) {
      /* Keep the last good data; say how old it is and why it is not moving. */
      state.refreshing = false;
      state.stale = true;
      state.note = err.kind === 'rate-limited'
        ? 'rate limited — resumes ' + R.untilTime(AMSGitHub.rate.reset)
        : err.kind === 'bad-token' ? 'token rejected'
        : err.kind === 'transient' ? 'network unreachable'
        : (err.message || 'refresh failed');
      paintAll();
      schedule();
    });
  }

  /* ---------- states ---------- */

  /* The landing screen is a form, not instructions. Opening index.html straight
     from the Finder is a normal way in, and it should not require editing a
     query string by hand. */
  function showLanding(prefill, error) {
    R.state('AMS Agent Monitor', [
      R.p('A read-only window on any GitHub repository that uses <strong>AMS</strong> ' +
          'as its methodology. It reads that project\u2019s sprint and handoff files and ' +
          'draws them as a board. It never writes anything.'),
      R.repoForm({
        value: prefill || '',
        error: error || null,
        onSubmit: function (raw, showError) {
          var parsed = AMSConfig.parseRepoInput(raw);
          if (!parsed.ok) { showError(repoInputError(parsed)); return; }
          /* Navigate rather than boot in place, so the resulting board has a
             URL that can be bookmarked and shared. */
          /* Not encodeURIComponent: it escapes the slash to %2F, and these URLs
             get shared. The value is already validated against REPO_RE, so the
             only characters in it are safe in a query string. */
          window.location.search = '?repo=' + parsed.repo;
        }
      }),
      R.p('Try <a href="?repo=cellear/factcheck-site">cellear/factcheck-site</a>, ' +
          'or open the bundled snapshot with no network at all: ' +
          '<a href="?fixtures=1">the example board</a>.')
    ]);
  }

  /* One place that turns a parse failure into something a person can act on. */
  function repoInputError(parsed) {
    switch (parsed.reason) {
      case 'empty':
        return 'Enter a repository first.';
      case 'unsupported-host':
        return parsed.host + ' is not supported yet \u2014 this reads GitHub only. ' +
               'The address looks right otherwise.';
      case 'unknown-host':
        return 'Nothing is known about ' + parsed.host + '. Paste a github.com address, ' +
               'or just owner/name.';
      default:
        return 'That does not look like a repository. Use owner/name, or paste the ' +
               'GitHub address of one.';
    }
  }

  function showBadRepo(repo, parsed) {
    showLanding(repo, parsed ? repoInputError(parsed)
                             : 'That does not look like a repository.');
  }

  function showNotAms(res) {
    var dirs = (res.tried && res.tried.length) ? res.tried : ['AMS/', '.ams/'];
    R.state('No AMS structure in this repository', [
      R.p('Looked for a config file in <code>' +
          dirs.map(escapeHtml).join('</code> and <code>') + '</code>, then for ' +
          '<code>SPRINTS/</code> and <code>HANDOFF/</code> inside those directories ' +
          'and at the repository root.'),
      R.p('Found none of them, so <code>' + escapeHtml(state.repo) +
          '</code> does not appear to use AMS.'),
      R.p('If it does, check that the directories are committed and public.')
    ]);
  }

  function showBootError(err) {
    if (err && err.kind === 'not-found') {
      R.state('Repository not found', [
        R.p('<code>' + escapeHtml(state.repo) + '</code> could not be read.'),
        R.p('It may not exist, or it may be private — this monitor is unauthenticated ' +
            'and reads public repositories only.')
      ]);
      return;
    }
    if (err && err.kind === 'rate-limited') {
      R.state('GitHub rate limit reached', [
        R.p('Unauthenticated GitHub API access is limited to 60 requests per hour per IP.'),
        R.p('The limit resets ' + R.untilTime(AMSGitHub.rate.reset) + '.'),
        R.p('The bundled snapshot needs no API calls: <a href="?fixtures=1">?fixtures=1</a>')
      ]);
      return;
    }
    R.state('Could not load this repository', [
      R.p(escapeHtml((err && err.message) || 'Unknown error') + '.'),
      R.p('The bundled snapshot works offline: <a href="?fixtures=1">?fixtures=1</a>')
    ]);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- events ---------- */

  function wire() {
    document.getElementById('hist').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-file]');
      if (!b) return;
      var entry = state.handoffIndex.filter(function (x) { return x.name === b.dataset.file; })[0];
      if (!entry) return;
      state.selectedFile = entry.name;
      loadHandoffBody(entry).then(function () {
        if (state.repo && !entry.commit) {
          AMSGitHub.lastCommit(state.repo, entry.path).then(function (c) {
            if (c) { entry.commit = c.date; paintAll(); }
          }, function () {});
        }
        paintAll();
      });
    });

    document.getElementById('ho-back').addEventListener('click', function () {
      state.selectedFile = null;
      paintAll();
    });

    /* Story popup. Delegated, so it survives every board redraw. Desktop only:
       a hover panel has no meaning on a touch screen, where tap-to-expand is
       the backlog answer. */
    var board = document.getElementById('board');
    var HOVER_DELAY = 140;      /* long enough not to flash while crossing cards */
    var hoverTimer = null;

    function storyUnder(target) {
      var card = target.closest ? target.closest('.story[data-story]') : null;
      if (!card || !state.board) return null;
      var st = null;
      state.board.sprints.some(function (sp) {
        return sp.stories.some(function (x) {
          if (x.id === card.dataset.story) { st = x; return true; }
          return false;
        });
      });
      return st ? { card: card, story: st } : null;
    }

    function colourMap() {
      var m = {};
      if (state.board) {
        AMSAgents.roster(state.board.sprints).forEach(function (r) { m[r.name] = r.colour; });
      }
      return m;
    }

    function handoffsFor(id) {
      return state.handoffIndex.filter(function (h) { return h.storyId === id; });
    }

    function openFor(hit, immediate) {
      clearTimeout(hoverTimer);
      var run = function () { R.showPopup(hit.card, hit.story, colourMap(), handoffsFor(hit.story.id)); };
      if (immediate) run(); else hoverTimer = setTimeout(run, HOVER_DELAY);
    }

    if (window.matchMedia('(hover: hover)').matches) {
      board.addEventListener('mouseover', function (e) {
        var hit = storyUnder(e.target);
        if (hit) openFor(hit);
      });
      board.addEventListener('mouseout', function (e) {
        if (!storyUnder(e.target)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(R.hidePopup, HOVER_DELAY);
      });
    }
    /* Keyboard reaches the same panel: the cards are focusable. */
    board.addEventListener('focusin', function (e) {
      var hit = storyUnder(e.target);
      if (hit) openFor(hit, true);
    });
    board.addEventListener('focusout', R.hidePopup);
    window.addEventListener('scroll', R.hidePopup, { passive: true });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') R.hidePopup();
    });

    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-sprint]');
      if (!b) return;
      state.selectedSprint = b.dataset.sprint;
      paintAll();
    });

    document.querySelectorAll('.acc-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = document.getElementById(btn.dataset.acc);
        var open = box.dataset.open === 'true';
        box.dataset.open = String(!open);
        btn.querySelector('.chev').textContent = open ? '▸' : '▾';
      });
    });

    document.getElementById('refresh').addEventListener('click', function () {
      if (state.cfg && state.cfg.mode === 'fixtures') return;
      refresh({ manual: true });
    });

    var bar = document.getElementById('tokenbar');
    document.getElementById('token-toggle').addEventListener('click', function () {
      bar.classList.toggle('hidden');
      if (!bar.classList.contains('hidden')) document.getElementById('token-input').focus();
    });

    document.getElementById('token-save').addEventListener('click', function () {
      var input = document.getElementById('token-input');
      AMSGitHub.setToken(input.value);
      input.value = '';                       /* never leave it on screen */
      bar.classList.add('hidden');
      paintAll();
      /* Re-fetch immediately: the new budget may unblock what was rate-limited,
         and this is also where a bad token surfaces. */
      if (state.resolved) refresh({ manual: true }); else if (state.repo) bootLive();
      schedule();
    });

    document.getElementById('token-clear').addEventListener('click', function () {
      AMSGitHub.setToken(null);
      document.getElementById('token-input').value = '';
      if (state.timer) clearTimeout(state.timer);
      paintAll();
    });

    /* Relative times drift; refresh the bar without refetching. */
    setInterval(function () { if (state.booted) paintAll(); }, 30000);
  }

  function start() {
    wire();
    var cfg = AMSConfig.read();
    state.cfg = cfg;

    if (cfg.mode === 'fixtures') {
      return bootFixtures().catch(function (e) {
        R.state('Could not load the bundled snapshot', [
          R.p(escapeHtml(e.message)),
          R.p('If this page was opened directly from the filesystem, the browser may block ' +
              'reading <code>fixtures/factcheck-site.json</code>. Serve the directory over ' +
              'HTTP instead — for example <code>python3 -m http.server</code>.')
        ]);
      });
    }
    if (cfg.reason === 'no-repo') return showLanding();
    if (cfg.reason === 'bad-repo') return showBadRepo(cfg.repo, cfg.parsed);

    state.repo = cfg.repo;
    return bootLive();
  }

  return { start: start, _state: state, refresh: refresh };
})();

document.addEventListener('DOMContentLoaded', AMSApp.start);
