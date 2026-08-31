/* Query-string and user-typed configuration. Global: AMSConfig */
var AMSConfig = (function () {
  'use strict';

  var REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

  /* Hosts are recognised even when unsupported, so an unsupported one can be
     named in the error rather than failing as "that isn't a repository".
     Adding GitLab or Bitbucket later means a fetch layer, not a new parser. */
  var HOSTS = {
    'github.com': { id: 'github', label: 'GitHub', supported: true },
    'www.github.com': { id: 'github', label: 'GitHub', supported: true },
    'gitlab.com': { id: 'gitlab', label: 'GitLab', supported: false },
    'www.gitlab.com': { id: 'gitlab', label: 'GitLab', supported: false },
    'bitbucket.org': { id: 'bitbucket', label: 'Bitbucket', supported: false },
    'www.bitbucket.org': { id: 'bitbucket', label: 'Bitbucket', supported: false }
  };

  /* Accepts what a person would plausibly paste:
       cellear/factcheck-site
       github.com/cellear/factcheck-site
       https://github.com/cellear/factcheck-site
       https://github.com/cellear/factcheck-site/tree/main/AMS
       https://github.com/cellear/factcheck-site.git
       git@github.com:cellear/factcheck-site.git
     Returns {ok, host, owner, name, repo} or {ok:false, reason, ...}. */
  function parseRepoInput(raw) {
    var text = String(raw || '').trim();
    if (!text) return { ok: false, reason: 'empty' };

    var host = null, path = text;

    var scp = /^(?:[\w.-]+@)?([\w.-]+):(.+)$/.exec(text);      /* git@host:owner/name */
    if (scp && text.indexOf('//') === -1) { host = scp[1].toLowerCase(); path = scp[2]; }
    else {
      var withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : null;
      var looksHosted = /^[\w.-]+\.[a-z]{2,}\//i.test(text);
      if (withScheme || looksHosted) {
        try {
          var u = new URL(withScheme || ('https://' + text));
          host = u.hostname.toLowerCase();
          path = u.pathname;
        } catch (e) { return { ok: false, reason: 'unparseable', input: text }; }
      }
    }

    var parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parts.length < 2) return { ok: false, reason: 'not-a-repo', input: text };

    var owner = parts[0];
    var name = parts[1].replace(/\.git$/i, '');

    var known = host ? HOSTS[host] : HOSTS['github.com'];
    if (host && !known) {
      return { ok: false, reason: 'unknown-host', host: host, input: text };
    }
    if (known && !known.supported) {
      return { ok: false, reason: 'unsupported-host', host: known.label,
               owner: owner, name: name, input: text };
    }
    if (!REPO_RE.test(owner + '/' + name)) {
      return { ok: false, reason: 'not-a-repo', input: text };
    }
    return { ok: true, host: 'github', owner: owner, name: name, repo: owner + '/' + name };
  }

  function read(search) {
    var q = new URLSearchParams(search === undefined ? window.location.search : search);
    if (q.get('fixtures') === '1') return { mode: 'fixtures', repo: null, valid: true };

    var raw = (q.get('repo') || '').trim();
    if (!raw) return { mode: 'none', repo: null, valid: false, reason: 'no-repo' };

    var parsed = parseRepoInput(raw);
    if (!parsed.ok) {
      return { mode: 'live', repo: raw, valid: false, reason: 'bad-repo', parsed: parsed };
    }
    return { mode: 'live', repo: parsed.repo, valid: true, parsed: parsed };
  }

  return { read: read, parseRepoInput: parseRepoInput, REPO_RE: REPO_RE, HOSTS: HOSTS };
})();
