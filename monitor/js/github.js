/* GitHub read access. Global: AMSGitHub. Read-only by construction:
   every request here is a GET, and nothing else in the app fetches. */
var AMSGitHub = (function () {
  'use strict';

  var API = 'https://api.github.com';
  var RAW = 'https://raw.githubusercontent.com';

  var etags = {};    /* url → etag */
  var cache = {};    /* url → last body, for 304 replay */
  var rate  = { remaining: null, limit: null, reset: null };

  function classify(status) {
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
    if (rem !== null) {
      rate.remaining = parseInt(rem, 10);
      rate.limit = parseInt(res.headers.get('x-ratelimit-limit') || '60', 10);
      var r = res.headers.get('x-ratelimit-reset');
      rate.reset = r ? new Date(parseInt(r, 10) * 1000).toISOString() : null;
    }
  }

  /* Conditional GET against the JSON API. Note that for UNAUTHENTICATED
     requests a 304 still costs one unit of the 60/hour budget — measured
     against the live API, not assumed — so conditional requests save
     bandwidth but not quota. The poll loop is shaped around that. */
  function apiGet(path, opts) {
    opts = opts || {};
    var url = API + path;
    var headers = { 'Accept': 'application/vnd.github+json' };
    if (opts.conditional && etags[url]) headers['If-None-Match'] = etags[url];

    return fetch(url, { headers: headers }).then(function (res) {
      noteRate(res);
      if (res.status === 304) return { unchanged: true, data: cache[url] };
      if (res.status === 403 && rate.remaining === 0) {
        throw fail('rate-limited', 'GitHub API rate limit reached', { reset: rate.reset });
      }
      if (!res.ok) throw fail(classify(res.status), 'GitHub ' + res.status + ' for ' + path, { status: res.status });
      var tag = res.headers.get('etag');
      if (tag) etags[url] = tag;
      return res.json().then(function (data) {
        cache[url] = data;
        return { unchanged: false, data: data };
      });
    }, function (netErr) {
      if (netErr.kind) throw netErr;
      throw fail('transient', 'Network error: ' + netErr.message);
    });
  }

  /* File bodies come from raw.githubusercontent, which does not count against
     the API budget. Case-sensitive — hence directory listing for discovery. */
  function raw(repo, path, ref) {
    var url = RAW + '/' + repo + '/' + (ref || 'HEAD') + '/' + path;
    return fetch(url).then(function (res) {
      if (res.status === 404) throw fail('not-found', 'Missing file: ' + path);
      if (!res.ok) throw fail(classify(res.status), 'Raw fetch ' + res.status + ' for ' + path);
      return res.text();
    }, function (netErr) {
      if (netErr.kind) throw netErr;
      throw fail('transient', 'Network error fetching ' + path);
    });
  }

  function listDir(repo, path, opts) {
    return apiGet('/repos/' + repo + '/contents/' + path, opts).then(function (r) {
      if (!Array.isArray(r.data)) throw fail('not-found', path + ' is not a directory');
      return { unchanged: r.unchanged, entries: r.data };
    });
  }

  function repoInfo(repo) {
    return apiGet('/repos/' + repo).then(function (r) { return r.data; });
  }

  /* Latest commit touching a path — one call, used for the status bar and
     lazily per file when a history entry is opened. */
  /* Newest commit anywhere in the repo. One call answers "has anything changed
     at all", which is what the poll loop asks 30 times an hour. */
  function headCommit(repo, opts) {
    return apiGet('/repos/' + repo + '/commits?per_page=1', opts).then(function (r) {
      var c = r.data && r.data[0];
      return { unchanged: r.unchanged, sha: c ? c.sha : null, date: c ? c.commit.committer.date : null };
    });
  }

  function lastCommit(repo, path) {
    return apiGet('/repos/' + repo + '/commits?per_page=1&path=' + encodeURIComponent(path))
      .then(function (r) {
        var c = r.data && r.data[0];
        return c ? { sha: c.sha, date: c.commit.committer.date, message: c.commit.message } : null;
      });
  }

  return {
    apiGet: apiGet, raw: raw, listDir: listDir, repoInfo: repoInfo,
    lastCommit: lastCommit, headCommit: headCommit, rate: rate,
    reset: function () { etags = {}; cache = {}; }
  };
})();
