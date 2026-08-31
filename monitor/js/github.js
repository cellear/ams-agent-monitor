/* GitHub read access. Global: AMSGitHub. Read-only by construction:
   every request here is a GET, and nothing else in the app fetches.

   Authenticated access allows 5,000 requests an hour against 60. That gap is
   why v1 needed conditional requests, an ETag cache and a head-commit
   indirection to answer "did anything change" for one call. None of that is
   here: with a token there is budget to just re-fetch, and without one the page
   refreshes on command instead of on a timer. */
var AMSGitHub = (function () {
  'use strict';

  var API = 'https://api.github.com';
  var RAW = 'https://raw.githubusercontent.com';
  var TOKEN_KEY = 'ams-monitor-token';

  var token = null;
  var rate = { remaining: null, limit: null, reset: null, authenticated: false };

  /* The token lives only in this browser. A static page cannot keep a secret:
     anything in the source or the URL is visible to everyone who loads the
     page, and a token in a query string additionally leaks into history and
     referrer headers. So it is supplied by the viewer and stored locally,
     never committed and never shared. */
  function loadToken() {
    try { token = window.localStorage.getItem(TOKEN_KEY) || null; }
    catch (e) { token = null; }          /* private mode, or storage blocked */
    rate.authenticated = !!token;
    return token;
  }

  function setToken(value) {
    token = (value || '').trim() || null;
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage unavailable: the token still works for this page */ }
    rate.authenticated = !!token;
    return token;
  }

  function hasToken() { return !!token; }

  function classify(status) {
    if (status === 401) return 'bad-token';
    if (status === 404) return 'not-found';
    if (status === 403 || status === 429) return 'rate-limited';
    if (status >= 500) return 'transient';
    return 'error';
  }

  function fail(kind, message, extra) {
    var e = new Error(message);
    e.kind = kind;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  function noteRate(res) {
    var rem = res.headers.get('x-ratelimit-remaining');
    if (rem === null) return;
    rate.remaining = parseInt(rem, 10);
    rate.limit = parseInt(res.headers.get('x-ratelimit-limit') || '60', 10);
    var r = res.headers.get('x-ratelimit-reset');
    rate.reset = r ? new Date(parseInt(r, 10) * 1000).toISOString() : null;
  }

  function headers(extra) {
    var h = extra || {};
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function apiGet(path) {
    return fetch(API + path, { headers: headers({ Accept: 'application/vnd.github+json' }) })
      .then(function (res) {
        noteRate(res);
        if (res.status === 401) {
          throw fail('bad-token', 'GitHub rejected the token');
        }
        if (res.status === 403 && rate.remaining === 0) {
          throw fail('rate-limited', 'GitHub API rate limit reached', { reset: rate.reset });
        }
        if (!res.ok) {
          throw fail(classify(res.status), 'GitHub ' + res.status + ' for ' + path,
                     { status: res.status });
        }
        return res.json();
      }, function (netErr) {
        if (netErr.kind) throw netErr;
        throw fail('transient', 'Network error: ' + netErr.message);
      });
  }

  /* File bodies come from raw.githubusercontent, which is not metered.
     Case-sensitive, which is why config discovery lists the directory. */
  function raw(repo, path, ref) {
    var url = RAW + '/' + repo + '/' + (ref || 'HEAD') + '/' + path;
    return fetch(url, { headers: headers() }).then(function (res) {
      if (res.status === 404) throw fail('not-found', 'Missing file: ' + path);
      if (!res.ok) throw fail(classify(res.status), 'Raw fetch ' + res.status + ' for ' + path);
      return res.text();
    }, function (netErr) {
      if (netErr.kind) throw netErr;
      throw fail('transient', 'Network error fetching ' + path);
    });
  }

  function listDir(repo, path) {
    return apiGet('/repos/' + repo + '/contents/' + path).then(function (data) {
      if (!Array.isArray(data)) throw fail('not-found', path + ' is not a directory');
      return { entries: data };
    });
  }

  function repoInfo(repo) { return apiGet('/repos/' + repo); }

  /* Latest commit touching a path. */
  function lastCommit(repo, path) {
    return apiGet('/repos/' + repo + '/commits?per_page=1&path=' + encodeURIComponent(path))
      .then(function (data) {
        var c = data && data[0];
        return c ? { sha: c.sha, date: c.commit.committer.date, message: c.commit.message } : null;
      });
  }

  loadToken();

  return {
    apiGet: apiGet, raw: raw, listDir: listDir, repoInfo: repoInfo,
    lastCommit: lastCommit, rate: rate,
    loadToken: loadToken, setToken: setToken, hasToken: hasToken,
    TOKEN_KEY: TOKEN_KEY
  };
})();
