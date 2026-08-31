/* Integration checks: drive the real index.html with ?fixtures=1 in an iframe.
   No second copy of the page skeleton, so these cannot drift from what ships.
   Global: AMSPageChecks. */
var AMSPageChecks = (function () {
  'use strict';

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function load(query) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe');
      f.className = 'probe';
      f.src = 'index.html' + query;
      f.addEventListener('load', function () { resolve(f); });
      f.addEventListener('error', function () { reject(new Error('iframe failed')); });
      document.getElementById('probes').appendChild(f);
    });
  }

  /* The fixture is fetched, so wait for the board rather than a fixed delay. */
  function ready(f, selector, timeout) {
    var end = Date.now() + (timeout || 8000);
    return (function poll() {
      var d = f.contentDocument;
      if (d && d.querySelector(selector)) return Promise.resolve(f);
      if (Date.now() > end) return Promise.reject(new Error('timed out waiting for ' + selector));
      return wait(120).then(poll);
    })();
  }

  function run(results) {
    var ctx = new AMSChecks.Ctx(results, 'page — fixture board');
    var f;

    return load('?fixtures=1')
      .then(function (frame) { f = frame; return ready(f, '#board .sprint'); })
      .then(function () { return wait(400); })
      .then(function () {
        var d = f.contentDocument, w = f.contentWindow;
        var q = function (s) { return Array.prototype.slice.call(d.querySelectorAll(s)); };
        var rows = q('#board .sprint');

        ctx.ok(['bar', 'board', 'ho-body', 'hist'].every(function (i) { return d.getElementById(i); }),
          'all four regions render');
        ctx.eq(rows.map(function (r) { return r.dataset.sprint; }), ['1', '2', '3', '4'],
          'sprints in order');
        ctx.eq(rows.map(function (r) { return r.querySelector('.name small').textContent; }),
          ['It runs', "It's a website", "It's safe to send to people", 'Luke can forget it exists'],
          'themes read from the H1 after the colon');
        ctx.eq(rows.map(function (r) { return r.querySelectorAll('.story').length; }), [8, 9, 7, 4],
          'story counts');
        ctx.eq(q('#board .story').length, 28, '28 stories in total');
        ctx.eq(rows.map(function (r) { return r.querySelectorAll('.story.done').length; }), [7, 5, 0, 0],
          'completed counts');
        ctx.eq(rows.filter(function (r) { return r.classList.contains('cur'); })
          .map(function (r) { return r.dataset.sprint; }), ['2'], 'sprint 2 is current');

        var prog = q('#board .story.progress');
        ctx.eq(prog.length, 1, 'exactly one story in progress');
        ctx.eq(prog[0].dataset.story, 'S2-6', 'S2-6 is the in-progress story');

        var stale = q('#board .story.stale');
        ctx.eq(stale.map(function (s) { return s.dataset.story; }), ['S1-5'],
          'S1-5 is the only dropped story');
        ctx.ok(/gradient/.test(w.getComputedStyle(stale[0]).backgroundImage),
          'the dropped story is hatched, not flat grey');

        ctx.eq(rows[0].querySelector('.check').textContent, 'Accepted ✓', 'sprint 1 accepted');
        ctx.ok(rows.slice(1).every(function (r) { return r.querySelector('.check').classList.contains('pending'); }),
          'sprints 2–4 pending');
        ctx.ok(!rows.some(function (r) { return /PROTOCOL/i.test(r.textContent); }),
          'PROTOCOL.md is not a row');

        /* Colour carries meaning only where the card is filled. */
        ctx.ok(q('#board .story.done').every(function (s) {
          return w.getComputedStyle(s).backgroundColor !== 'rgb(255, 255, 255)'; }),
          'completed stories are filled');
        ctx.ok(q('#board .story.planned').every(function (s) {
          return w.getComputedStyle(s).backgroundColor === 'rgb(255, 255, 255)'; }),
          'planned stories stay white');
        ctx.ok(q('.story[data-story]').every(function (s) { return s.querySelector('.who'); }),
          'every card names its agent');
        ctx.eq(q('[data-sprint="3"] .story .who').slice(0, 5).map(function (n) { return n.textContent; }),
          ['Sandy', 'Cody', 'Cody', 'Cody', 'Sandy'], 'a planned streak is readable');
        ctx.eq(q('#agents span').length, 6, 'legend lists six agents');

        /* Geometry: a title that outgrows its card would spill over the mark. */
        ctx.ok(q('.story').every(function (s) {
          var r = s.getBoundingClientRect(); return Math.abs(r.width - r.height) < 3; }),
          'cards are square');
        ctx.ok(q('.story').every(function (s) {
          return s.querySelector('.ttl b').getBoundingClientRect().bottom
               <= s.getBoundingClientRect().bottom - 2; }),
          'long titles clamp inside the card');

        ctx.eq(q('#hist button').length, 19, '19 handoffs listed');
        ctx.ok(/sprint 2 planning/.test(q('#hist button')[0].textContent),
          'newest handoff first');
        ctx.eq(q('#ho-body dt').map(function (n) { return n.textContent; }),
          ['Context', "What's done", "What's next", 'Notes / blockers', 'Files / references'],
          'handoff renders into the five canonical sections');
        ctx.ok(q('#ho-body .srcname').length > 0,
          'legacy heading wording is shown rather than hidden');

        ctx.ok(!d.getElementById('state') || d.getElementById('state').classList.contains('hidden'),
          'no error state on a good load');
        ctx.ok(w.AMSApp._state.timer === null, 'fixture mode runs no timer');
        ctx.ok(!w.AMSGitHub.hasToken(), 'no token is stored by default');
        return null;
      })
      .then(function () {
        /* The popup is the only route to story detail, so it is checked here. */
        var d = f.contentDocument;
        var card = d.querySelector('[data-story="S2-4"]');
        card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return wait(320).then(function () {
          var pctx = new AMSChecks.Ctx(results, 'page — story popup');
          var pop = d.querySelector('.storypop');
          pctx.ok(pop && !pop.classList.contains('hidden'), 'opens on hover');
          if (!pop) return;
          pctx.ok(/Form page with predicted countdown/.test(pop.textContent), 'names the story');
          pctx.ok(['Cody', 'claude-sonnet-5', 'S2-2'].every(function (v) {
            return pop.textContent.indexOf(v) !== -1; }), 'owner, model and dependency shown');
          pctx.ok(/Scope/.test(pop.textContent) && /Acceptance criteria/.test(pop.textContent),
            'scope and criteria shown');
          pctx.eq(pop.querySelectorAll('.storypop-list li.ticked').length, 2,
            'criteria carry their tick state');
          pctx.ok(/Handoff/.test(pop.textContent) && /cody/.test(pop.textContent),
            'the handoff written about this story is linked');
          pctx.ok(!!pop.querySelector('code') && !/\*\*/.test(pop.textContent),
            'markdown is rendered, not shown literally');
          pctx.ok(pop.parentElement === d.body, 'attached to the body so edge cards are not clipped');
          var r = pop.getBoundingClientRect();
          pctx.ok(r.left >= -1 && r.right <= f.contentWindow.innerWidth + 1, 'stays on screen');
          card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        });
      })
      .then(function () {
        /* Phone layout: same content, one sprint at a time. */
        var mf;
        return load('?fixtures=1')
          .then(function (frame) {
            mf = frame; mf.style.width = '400px';
            return ready(mf, '#board .sprint');
          })
          .then(function () { return wait(500); })
          .then(function () {
            var mctx = new AMSChecks.Ctx(results, 'page — phone layout');
            var d = mf.contentDocument, w = mf.contentWindow;
            var vis = function (el) { return el && w.getComputedStyle(el).display !== 'none'; };
            mctx.ok(vis(d.getElementById('tabs')), 'sprint picker appears');
            mctx.eq(Array.prototype.slice.call(d.querySelectorAll('#board .sprint'))
              .filter(vis).map(function (r) { return r.dataset.sprint; }), ['2'],
              'one sprint shown, defaulting to the current one');
            mctx.eq(d.querySelector('#tabs button[aria-selected="true"]').textContent, 'S2',
              'the picker marks the current sprint');
            mctx.ok(!vis(d.querySelector('#board .check')) && vis(d.querySelector('#board .mcheck')),
              'checkpoint moves below the story list');
            mctx.eq(d.getElementById('acc-handoff').dataset.open, 'true', 'handoff open by default');
            mctx.eq(d.getElementById('acc-history').dataset.open, 'false', 'history collapsed');
            mctx.ok(d.documentElement.scrollWidth <= w.innerWidth + 1, 'no horizontal scrolling');
          });
      })
      .then(function () {
        var lctx = new AMSChecks.Ctx(results, 'page — landing');
        return load('').then(function (lf) {
          return ready(lf, '.repoform').then(function () {
            var d = lf.contentDocument;
            lctx.ok(!!d.getElementById('repo-input'), 'landing offers a repo field');
            var form = d.querySelector('.repoform'), err = d.querySelector('.repoform-error');
            d.getElementById('repo-input').value = 'https://gitlab.com/a/b';
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            lctx.ok(/GitLab/.test(err.textContent), 'an unsupported host is named, not dismissed');
            d.getElementById('repo-input').value = 'nonsense';
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            lctx.ok(/does not look like a repository/.test(err.textContent),
              'junk input gets actionable guidance');
          });
        });
      })
      .catch(function (e) {
        results.push({ suite: 'page', label: 'integration run failed', pass: false, detail: e.message });
      });
  }

  return { run: run };
})();
