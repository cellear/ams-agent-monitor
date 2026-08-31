/* Orchestration: boot, poll, change detection, selection. Global: AMSApp. */
var AMSApp = (function () {
  'use strict';

  var POLL_MS = 120000;              /* ~2 min; 304s are free against the budget */
  var R = AMSRender;

  var state = {
    cfg: null, repo: null, resolved: null,
    board: null, handoffIndex: [], handoffCache: {},
    selectedFile: null, selectedSprint: null,
    lastPolled: null, lastGood: null, latestCommit: null,
    stale: false, note: '', timer: null, booted: false, headSha: null
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
      lastGood: state.lastGood, stale: state.stale, note: state.note
    });

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
      return AMSGitHub.raw(state.repo, e.path).then(function (body) {
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
    return AMSGitHub.raw(state.repo, entry.path).then(function (body) {
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
                 : Promise.resolve(null),
          AMSGitHub.headCommit(state.repo).catch(function () { return null; })
        ]).then(function (x) {
          if (x[1]) { state.latestCommit = x[1].date; if (newest) newest.commit = x[1].date; }
          if (x[2]) state.headSha = x[2].sha;
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
    state.timer = setTimeout(poll, POLL_MS);
  }

  /* One call per tick. Polling both directory listings cost two units every
     time — and since an unauthenticated 304 still costs a unit, 30 ticks an
     hour would have consumed the entire 60/hour budget with nothing left for
     the boot sequence. Asking for the repo's newest commit answers "did
     anything change at all" for one unit; the listings are only fetched when
     the answer is yes. */
  function poll() {
    if (!state.resolved || !state.repo) return schedule();

    AMSGitHub.headCommit(state.repo, { conditional: true }).then(function (head) {
      var moved = head.sha && head.sha !== state.headSha;
      if (!moved) {
        state.lastPolled = new Date().toISOString();
        state.lastGood = state.lastPolled;
        state.stale = false;
        state.note = '';
        paintAll();
        return schedule();
      }
      state.headSha = head.sha;
      return refresh();
    }).catch(pollFailed);
  }

  /* Something moved: re-read both listings and whatever changed under them. */
  function refresh() {
    var res = state.resolved, changed = [], work = [];

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
        state.note = changed.length ? 'updated just now' : '';
        paintAll(changed);
        schedule();
      });
    });
  }

  /* Keep the last good data; say how old it is and why it is not moving. */
  function pollFailed(err) {
    state.stale = true;
    state.note = err.kind === 'rate-limited'
      ? 'rate limited — resumes ' + R.untilTime(AMSGitHub.rate.reset)
      : (err.kind === 'transient' ? 'network unreachable' : (err.message || 'poll failed'));
    paintAll();
    schedule();
  }

  /* ---------- states ---------- */

  function showLanding() {
    R.state('AMS Agent Monitor', [
      R.p('A read-only window on any GitHub repository that uses <strong>AMS</strong> ' +
          'as its methodology. It reads sprint and handoff files and draws them as a board. ' +
          'It never writes anything.'),
      R.p('Add a <code>repo</code> parameter to the URL:'),
      R.p('<code>' + location.pathname + '?repo=owner/name</code>'),
      R.p('For example: <a href="?repo=cellear/factcheck-site">?repo=cellear/factcheck-site</a>'),
      R.p('Or view the bundled snapshot with no network access: ' +
          '<a href="?fixtures=1">?fixtures=1</a>')
    ]);
  }

  function showBadRepo(repo) {
    R.state('That does not look like a repository', [
      R.p('<code>' + escapeHtml(repo) + '</code> is not in <code>owner/name</code> form.'),
      R.p('Try <a href="?repo=cellear/factcheck-site">?repo=cellear/factcheck-site</a>.')
    ]);
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
    if (cfg.reason === 'bad-repo') return showBadRepo(cfg.repo);

    state.repo = cfg.repo;
    return bootLive();
  }

  return { start: start, _state: state, poll: poll, refresh: refresh };
})();

document.addEventListener('DOMContentLoaded', AMSApp.start);
