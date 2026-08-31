/* Query-string configuration. Global: AMSConfig */
var AMSConfig = (function () {
  'use strict';

  var REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

  function read(search) {
    var q = new URLSearchParams(search === undefined ? window.location.search : search);
    var repo = (q.get('repo') || '').trim().replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
    var fixtures = q.get('fixtures') === '1';

    if (fixtures) {
      return { mode: 'fixtures', repo: null, valid: true };
    }
    if (!repo) {
      return { mode: 'none', repo: null, valid: false, reason: 'no-repo' };
    }
    if (!REPO_RE.test(repo)) {
      return { mode: 'live', repo: repo, valid: false, reason: 'bad-repo' };
    }
    return { mode: 'live', repo: repo, valid: true };
  }

  return { read: read, REPO_RE: REPO_RE };
})();
