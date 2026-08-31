/* Pure model → DOM rendering. Global: AMSRender. No fetching here. */
var AMSRender = (function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* Markdown via the CDN renderer, with a plain-text fallback if it failed to
     load. Links open in a new tab; relative repo links resolve to github.com. */
  function markdown(text, repo) {
    if (!text) return '';
    if (typeof window.marked === 'undefined') {
      var pre = el('pre'); pre.textContent = text; return pre.outerHTML;
    }
    var html = window.marked.parse(text);
    var box = el('div');
    box.innerHTML = html;
    box.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
      if (repo && !/^#/.test(href)) {
        a.href = 'https://github.com/' + repo + '/blob/HEAD/' + href.replace(/^\.?\//, '');
        a.target = '_blank'; a.rel = 'noopener noreferrer';
      }
    });
    box.querySelectorAll('script').forEach(function (s) { s.remove(); });
    return box.innerHTML;
  }

  function relTime(iso, now) {
    if (!iso) return 'unknown';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return 'unknown';
    var s = Math.max(0, Math.round(((now || Date.now()) - t) / 1000));
    if (s < 45) return s + ' s ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    var d = Math.round(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 30) return d + ' d ago';
    return new Date(t).toISOString().slice(0, 10);
  }

  /* relTime clamps to the past, so a rate-limit reset (always in the future)
     rendered as "0 s". Countdowns need their own formatter. */
  function untilTime(iso, now) {
    if (!iso) return 'shortly';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return 'shortly';
    var s = Math.round((t - (now || Date.now())) / 1000);
    if (s <= 0) return 'now';
    if (s < 60) return 'in ' + s + ' s';
    var m = Math.round(s / 60);
    if (m < 60) return 'in ' + m + ' min';
    var h = Math.round(m / 60);
    return 'in ' + h + ' h';
  }

  var DOT = { done: 'dot', progress: 'dot half', planned: 'dot ring', stale: 'dot stale' };
  var MARK = { done: '\u2713', progress: '\u22EF', planned: '', stale: '\u2013' };
  var STATE_LABEL = {
    done: 'done', progress: 'in progress', planned: 'planned',
    stale: 'not completed \u2014 the sprint was accepted with this story still open'
  };

  /* ---------- status bar (pin 1) ---------- */
  function statusBar(s) {
    var bar = $('bar');
    bar.classList.toggle('stale', !!s.stale);
    $('bar-repo').textContent = s.repo || '—';
    $('bar-paths').textContent = s.paths || '';
    $('bar-latest').textContent = 'Last handoff: ' + relTime(s.latestCommit);
    $('bar-polled').textContent = s.stale
      ? 'Stale — last good data ' + relTime(s.lastGood)
      : 'Checked ' + relTime(s.lastPolled);
    $('bar-note').textContent = s.note || '';
    $('bar-note').classList.toggle('hidden', !s.note);

    var refresh = $('refresh');
    if (refresh) {
      refresh.disabled = !!s.refreshing;
      refresh.textContent = s.refreshing ? 'Refreshing…' : 'Refresh';
    }
    var tok = $('token-toggle');
    if (tok) {
      tok.classList.toggle('on', !!s.authenticated);
      tok.textContent = s.authenticated ? 'Token ✓' : 'Token';
      tok.title = s.authenticated
        ? 'Signed in with a token — updating live'
        : 'Add a GitHub token to watch this repo live';
    }
  }

  /* Says what the token does and what it currently buys. */
  function tokenNote(authenticated, rate) {
    var n = $('token-note');
    if (!n) return;
    var budget = (rate && rate.remaining !== null)
      ? ' ' + rate.remaining + ' of ' + rate.limit + ' requests left this hour.' : '';
    n.textContent = authenticated
      ? 'Stored in this browser only. Updating live every 30 s.' + budget
      : 'Without a token the page updates only when you press Refresh, and GitHub '
        + 'allows 60 requests an hour. A fine-grained token with read-only access to '
        + 'public repositories is enough. It is stored in this browser and never sent '
        + 'anywhere but GitHub.' + budget;
  }

  /* ---------- board (pins 2-3) ---------- */
  function storyNode(st, colours) {
    var n = el('div', 'box story ' + st.state);
    n.dataset.story = st.id;

    /* Only done and in-progress carry an agent fill. Planned stays white so the
       filled run shows how far the sprint has got, and the dropped state keeps
       its hatch. */
    var c = colours && st.owner ? colours[st.owner] : null;
    if (c && (st.state === 'done' || st.state === 'progress')) {
      n.style.background = c.fill;
      n.style.borderColor = c.edge;
    }

    /* Id and agent share the top row. The agent is on every card, not only the
       coloured ones: a planned story has no fill, so without a name there is no
       way to see that the next four are all Sandy's. */
    var head = el('span', 'story-head');
    head.appendChild(el('span', 'sid', st.id));
    if (st.owners && st.owners.length) {
      var who = el('span', 'who', st.owners.length > 1
        ? st.owners[0] + ' +' + (st.owners.length - 1)
        : st.owners[0]);
      /* Tint only where the card itself is not already the agent's colour, so
         a run of planned stories is still scannable by eye. */
      if (c && st.state !== 'done' && st.state !== 'progress') who.style.color = c.edge;
      who.title = st.owners.join(' and ');
      head.appendChild(who);
    }
    n.appendChild(head);

    var ttl = el('span', 'ttl');
    ttl.appendChild(el('b', null, st.title));
    n.appendChild(ttl);
    var mark = el('span', 'mark', MARK[st.state] || '');
    n.appendChild(mark);

    /* No title attribute: the popup replaces it, and both together means the
       browser tooltip fights the panel a second later. */
    n.tabIndex = 0;
    return n;
  }

  function sprintNode(s, colours) {
    var row = el('div', 'sprint' + (s.isCurrent ? ' cur' : ''));
    row.dataset.sprint = s.id;

    var name = el('div', 'box name');
    name.appendChild(document.createTextNode(s.name));
    if (s.theme) name.appendChild(el('small', null, s.theme));
    row.appendChild(name);

    var stories = el('div', 'stories');
    if (!s.stories.length) stories.appendChild(el('div', 'emptyrow', 'No stories in this sprint file.'));
    s.stories.forEach(function (st) { stories.appendChild(storyNode(st, colours)); });
    row.appendChild(stories);

    var accepted = s.acceptance.accepted;
    row.appendChild(el('div', 'box check' + (accepted ? '' : ' pending'),
      accepted ? 'Accepted ✓' : 'Accepted'));
    /* Phone-only duplicate of the checkpoint, shown under the story list. */
    row.appendChild(el('div', 'box mcheck' + (accepted ? '' : ' pending'),
      accepted ? 'Accepted ✓' : 'Accepted — pending'));
    return row;
  }

  function board(model, selectedId) {
    var host = $('board');
    clear(host);
    if (!model.sprints.length) { agentLegend([]); return; }

    var roster = AMSAgents.roster(model.sprints);
    var colours = {};
    roster.forEach(function (r) { colours[r.name] = r.colour; });

    model.sprints.forEach(function (s) {
      var row = sprintNode(s, colours);
      if (s.id === selectedId) row.classList.add('shown');
      host.appendChild(row);
    });
    agentLegend(roster);

    var tabs = $('tabs');
    clear(tabs);
    model.sprints.forEach(function (s) {
      var b = el('button', null, s.name.replace(/^Sprint\s*/i, 'S'));
      b.setAttribute('aria-selected', String(s.id === selectedId));
      b.dataset.sprint = s.id;
      tabs.appendChild(b);
    });
  }

  /* ---------- story popup ---------- */

  /* Fields are a list, not hand-placed markup, so adding or dropping one is a
     line here rather than a layout change. Anything absent is skipped. */
  var POPUP_FIELDS = [
    { label: 'Owner',      get: function (st) { return st.owners && st.owners.length ? st.owners.join(' and ') : null; } },
    { label: 'Model',      get: function (st) { return st.model; },      mono: true },
    { label: 'Size',       get: function (st) { return st.size; } },
    { label: 'Depends on', get: function (st) { return st.dependsOn; } }
  ];

  /* Story text is markdown, so `code` and **bold** would otherwise show their
     own punctuation. Inline only — a list item is not the place for block
     elements — with a plain-text fallback if the CDN renderer is unavailable. */
  function inlineMarkdown(node, text) {
    if (window.marked && typeof window.marked.parseInline === 'function') {
      var box = el('span');
      try {
        box.innerHTML = window.marked.parseInline(String(text));
        box.querySelectorAll('script,img,iframe').forEach(function (n) { n.remove(); });
        box.querySelectorAll('a[href]').forEach(function (a) {
          a.target = '_blank'; a.rel = 'noopener noreferrer';
        });
        node.appendChild(box);
        return node;
      } catch (e) { /* fall through to text */ }
    }
    node.appendChild(document.createTextNode(String(text)));
    return node;
  }

  var popupEl = null, popupTimer = null, popupFor = null;

  function ensurePopup() {
    if (popupEl) return popupEl;
    popupEl = el('div', 'storypop hidden');
    /* On the body, so a card near the edge of the board is not clipped by the
       scrolling containers it sits inside. */
    document.body.appendChild(popupEl);
    popupEl.addEventListener('mouseenter', function () { clearTimeout(popupTimer); });
    popupEl.addEventListener('mouseleave', hidePopup);
    return popupEl;
  }

  function buildPopup(st, colours, handoffs) {
    var box = el('div');

    var head = el('div', 'storypop-head');
    head.appendChild(el('span', 'storypop-id', st.id));
    head.appendChild(el('span', 'storypop-title', st.title));
    box.appendChild(head);

    var badge = el('div', 'storypop-state ' + st.state, STATE_LABEL[st.state]);
    var c = colours && st.owner ? colours[st.owner] : null;
    if (c) { badge.style.borderLeft = '4px solid ' + c.edge; }
    box.appendChild(badge);

    var dl = el('dl', 'storypop-fields');
    POPUP_FIELDS.forEach(function (f) {
      var v = f.get(st);
      if (!v) return;
      dl.appendChild(el('dt', null, f.label));
      dl.appendChild(el('dd', f.mono ? 'mono' : null, v));
    });
    if (dl.children.length) box.appendChild(dl);

    (st.sections || []).forEach(function (sec) {
      box.appendChild(el('div', 'storypop-label', sec.label));
      var ul = el('ul', 'storypop-list');
      sec.items.forEach(function (item) {
        var li = el('li', item.done === null ? null : (item.done ? 'ticked' : 'unticked'));
        if (item.done !== null) li.appendChild(el('span', 'tick', item.done ? '\u2713' : '\u25CB'));
        inlineMarkdown(li, item.text);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });

    if (handoffs && handoffs.length) {
      box.appendChild(el('div', 'storypop-label', handoffs.length > 1 ? 'Handoffs' : 'Handoff'));
      var hl = el('ul', 'storypop-list');
      handoffs.forEach(function (h) {
        hl.appendChild(el('li', null, (h.agent ? h.agent + ' \u00B7 ' : '') +
          (h.commit ? relTime(h.commit) : (h.date || ''))));
      });
      box.appendChild(hl);
    }
    return box;
  }

  /* Placed beside the card, flipped or nudged so it stays on screen. */
  function positionPopup(card) {
    var r = card.getBoundingClientRect();
    var p = popupEl.getBoundingClientRect();
    var gap = 8;
    var left = r.right + gap;
    if (left + p.width > window.innerWidth - 8) left = r.left - p.width - gap;
    if (left < 8) left = Math.max(8, Math.min(r.left, window.innerWidth - p.width - 8));
    var top = r.top + window.scrollY - 4;
    if (top + p.height > window.scrollY + window.innerHeight - 8) {
      top = window.scrollY + window.innerHeight - p.height - 8;
    }
    if (top < window.scrollY + 8) top = window.scrollY + 8;
    popupEl.style.left = Math.round(left) + 'px';
    popupEl.style.top = Math.round(top) + 'px';
  }

  function showPopup(card, st, colours, handoffs) {
    var pop = ensurePopup();
    if (popupFor === st.id && !pop.classList.contains('hidden')) return;
    popupFor = st.id;
    clear(pop);
    pop.appendChild(buildPopup(st, colours, handoffs));
    pop.classList.remove('hidden');
    positionPopup(card);
  }

  function hidePopup() {
    clearTimeout(popupTimer);
    popupFor = null;
    if (popupEl) popupEl.classList.add('hidden');
  }

  /* Who is on this board, and in what colour. */
  function agentLegend(roster) {
    var host = $('agents');
    if (!host) return;
    clear(host);
    host.classList.toggle('hidden', !roster.length);
    roster.forEach(function (r) {
      var s = el('span');
      var sw = el('i');
      sw.style.background = r.colour.fill;
      sw.style.borderColor = r.colour.edge;
      s.appendChild(sw);
      s.appendChild(document.createTextNode(r.name));
      host.appendChild(s);
    });
  }

  /* ---------- latest handoff (pin 4) ---------- */
  function handoff(h, opts) {
    opts = opts || {};
    $('ho-title').textContent = h ? (h.label || h.file) : '—';
    $('ho-when').textContent = h && h.date ? '— ' + h.date : '';
    var back = $('ho-back');
    back.classList.toggle('hidden', !opts.historical);

    var host = $('ho-body');
    clear(host);
    if (!h) {
      host.appendChild(el('p', 'lbl', 'No handoff files found.'));
      return;
    }

    var dl = el('dl');
    h.sections.forEach(function (sec) {
      dl.appendChild(el('dt', null, sec.name));
      var dd = el('dd');
      if (!sec.parts.length) {
        dd.className = 'empty';
        dd.textContent = '—';
      } else {
        sec.parts.forEach(function (p) {
          /* Show the file's own wording when it differs from the canonical name,
             so the legacy mapping is visible rather than silent. */
          if (!p.canonical) dd.appendChild(el('div', 'srcname', p.heading));
          var md = el('div', 'md');
          md.innerHTML = markdown(p.body, opts.repo);
          dd.appendChild(md);
        });
      }
      dl.appendChild(dd);
    });
    host.appendChild(dl);

    if (h.prompt) {
      var pr = el('div', 'prompt');
      pr.appendChild(el('div', 'lbl', h.prompt.heading));
      var pm = el('div', 'md');
      pm.innerHTML = markdown(h.prompt.body, opts.repo);
      pr.appendChild(pm);
      host.appendChild(pr);
    }

    if (h.extras.length) {
      var ex = el('div', 'extras');
      ex.appendChild(el('span', 'lbl', 'Additional sections'));
      h.extras.forEach(function (e) {
        ex.appendChild(el('div', 'srcname', e.heading));
        var m = el('div', 'md');
        m.innerHTML = markdown(e.body, opts.repo);
        ex.appendChild(m);
      });
      host.appendChild(ex);
    }
  }

  /* ---------- history (pin 5) ---------- */
  function history(entries, selectedFile) {
    var host = $('hist');
    clear(host);
    if (!entries.length) {
      host.appendChild(el('p', 'lbl', 'No handoffs yet.'));
      return;
    }
    entries.forEach(function (e) {
      var b = el('button');
      b.dataset.file = e.name;
      b.setAttribute('aria-current', String(e.name === selectedFile));
      b.appendChild(el('span', 'name', e.label || e.name));
      b.appendChild(el('span', 'when', e.commit ? relTime(e.commit) : (e.date || '')));
      host.appendChild(b);
    });
  }

  /* ---------- whole-page states ---------- */
  function state(title, bodyNodes) {
    $('app').classList.add('hidden');
    var host = $('state');
    host.classList.remove('hidden');
    clear(host);
    var box = el('div', 'state');
    box.appendChild(el('h2', null, title));
    (bodyNodes || []).forEach(function (n) { box.appendChild(n); });
    host.appendChild(box);
  }
  function showApp() {
    $('state').classList.add('hidden');
    $('app').classList.remove('hidden');
  }
  function p(html) { var n = el('p'); n.innerHTML = html; return n; }

  /* Repo entry for the landing screen. Accepts owner/name or a pasted GitHub
     address; validation and navigation are the caller's, so this stays a view. */
  function repoForm(opts) {
    var form = el('form', 'repoform');
    form.setAttribute('novalidate', 'novalidate');

    var label = el('label', null, 'Repository');
    label.setAttribute('for', 'repo-input');
    form.appendChild(label);

    var row = el('div', 'repoform-row');
    var input = el('input');
    input.id = 'repo-input';
    input.type = 'text';
    input.value = opts.value || '';
    input.placeholder = 'owner/name  —  or  https://github.com/owner/name';
    input.autocomplete = 'off';
    input.spellcheck = false;
    row.appendChild(input);

    var go = el('button', 'primary', 'Watch it');
    go.type = 'submit';
    row.appendChild(go);
    form.appendChild(row);

    var err = el('div', 'repoform-error');
    err.setAttribute('role', 'alert');
    if (opts.error) err.textContent = opts.error;
    else err.classList.add('hidden');
    form.appendChild(err);

    function showError(message) {
      err.textContent = message;
      err.classList.remove('hidden');
      input.focus();
      input.select();
    }
    input.addEventListener('input', function () { err.classList.add('hidden'); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      opts.onSubmit(input.value, showError);
    });

    setTimeout(function () { input.focus(); }, 0);
    return form;
  }

  function flash(ids) {
    ids.forEach(function (id) {
      var n = $(id);
      if (!n) return;
      n.classList.remove('changed');
      void n.offsetWidth;   /* restart the animation */
      n.classList.add('changed');
    });
  }

  return {
    statusBar: statusBar, tokenNote: tokenNote, board: board, handoff: handoff, history: history,
    state: state, showApp: showApp, p: p, el: el, flash: flash, repoForm: repoForm,
    showPopup: showPopup, hidePopup: hidePopup, POPUP_FIELDS: POPUP_FIELDS,
    relTime: relTime, untilTime: untilTime, markdown: markdown
  };
})();
