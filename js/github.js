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
     Case-sensitive, which is why config discovery lists the directory.

     `version` is the blob sha the directory listing reported for this file. It
     is not read by the server — it is there to make the URL change whenever the
     content changes.

     Without it every body request names the mutable ref HEAD, and that URL is
     cached: raw.githubusercontent serves `max-age=300`, and the response also
     sits in a Fastly POP. Change detection meanwhile compares the IMMUTABLE
     blob sha from the API. The two can disagree, and the failure is silent and
     file-specific: the listing says a file changed, the app refetches it, a
     cache answers with the previous body, and the board renders content that
     does not match the sha it just verified — while the status bar reports that
     it checked a moment ago. Observed on 2026-09-02 against factcheck-site,
     where sprint-4.md rendered S4-1 and S4-R as open for ~16 hours after they
     were ticked, while sprint-5.md, fetched in the same pass, was current.

     Keying the URL to the sha gives each version its own resource, so a cache
     holding the old body can never answer a request for the new one. That entry
     is still a hit for the URL it belongs to, which is what caches are for; it
     is simply no longer the URL being asked for. */
  function raw(repo, path, ref, version) {
    var url = RAW + '/' + repo + '/' + (ref || 'HEAD') + '/' + path;
    if (version) url += '?v=' + encodeURIComponent(version);
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
