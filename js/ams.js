/* AMS repo structure discovery. Global: AMSRepo. */
var AMSRepo = (function () {
  'use strict';

  var AMS_DIRS = ['AMS', '.ams'];
  var DEFAULTS = { sprints_dir: 'SPRINTS', handoff_dir: 'HANDOFF' };

  /* CONFIG.md holds markdown tables with a "Your value" column that overrides
     the default:  | `sprints_dir` | `SPRINTS` | `docs/sprints` |

     Every table is read EXCEPT those under a heading beginning "Example". The
     kit's CONFIG.md template ends with "## Example: using existing folders",
     holding an illustrative second table (handoff_dir → `journal`, doc_dir →
     `docs`). Every AMS project inherits it, so reading every table resolves
     the example's directories instead of the project's.

     Excluding by heading rather than allowing by heading is deliberate: the
     current kit puts the live tables under "## Components" / "## Directories",
     but muse-monitor's older CONFIG has its table in the preamble under no
     heading at all. */
  function isExampleHeading(h) { return /^example\b/i.test(h); }

  function parseConfig(text) {
    var out = { components: null, settings: {} };
    var skipping = false;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var h = /^#{2,}\s+(.+?)\s*$/.exec(line);
      if (h) { skipping = isExampleHeading(h[1].trim()); return; }
      if (skipping) return;
      if (line.indexOf('|') === -1) return;
      var cells = line.split('|').map(function (c) {
        return c.trim().replace(/^`|`$/g, '').trim();
      });
      /* Leading/trailing empty cells from the outer pipes. */
      if (cells.length && cells[0] === '') cells.shift();
      if (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.length < 2) return;
      var key = cells[0], def = cells[1], mine = cells.length > 2 ? cells[2] : '';
      if (/^-+$/.test(def) || key.toLowerCase() === 'setting' || key.toLowerCase() === 'key') return;
      var value = mine !== '' ? mine : def;
      if (key === 'components') { out.components = value; return; }
      if (/_dir$/.test(key) || key === 'epics') out.settings[key] = value;
    });
    return out;
  }

  function componentsList(cfg) {
    if (!cfg || !cfg.components) return null;
    return cfg.components.split(',').map(function (s) { return s.trim().toUpperCase(); })
      .filter(Boolean);
  }

  /* Discovery lists the AMS directory and matches the config filename
     case-insensitively. Canonical casing is CONFIG.md (spec §1), but
     muse-monitor ships lowercase config.md and raw.githubusercontent is
     case-sensitive, so a literal path would 404 there. */
  function findConfig(repo, gh) {
    var tried = [];
    function attempt(i) {
      if (i >= AMS_DIRS.length) return Promise.resolve(null);
      var dir = AMS_DIRS[i];
      tried.push(dir + '/');
      return gh.listDir(repo, dir).then(function (r) {
        var entry = r.entries.filter(function (e) {
          return e.type === 'file' && e.name.toLowerCase() === 'config.md';
        })[0];
        var names = r.entries.map(function (e) { return e.name; });
        if (!entry) return { amsDir: dir, listing: names, configPath: null, config: null };
        return gh.raw(repo, entry.path, null, entry.sha).then(function (body) {
          return { amsDir: dir, listing: names, configPath: entry.path, config: parseConfig(body) };
        });
      }, function (err) {
        if (err.kind === 'not-found') return attempt(i + 1);
        throw err;
      });
    }
    /* Always carry the list of directories tried, including when none existed:
       the non-AMS state names what was looked for, and a null here left it
       reading "Looked in  for a config file". */
    return attempt(0).then(function (r) {
      if (!r) return { amsDir: null, listing: [], configPath: null, config: null, tried: tried };
      r.tried = tried;
      return r;
    });
  }

  /* Each directory can sit inside the AMS dir or at the project root; the
     agent protocol checks CONFIG first, then AMS/<name>, then the root. */
  function resolveDir(repo, gh, amsDir, configured, fallback) {
    var name = configured || fallback;
    var candidates = [];
    if (configured && configured.indexOf('/') !== -1) candidates.push(configured);
    candidates.push(amsDir + '/' + name, name);

    function attempt(i) {
      if (i >= candidates.length) return Promise.resolve(null);
      return gh.listDir(repo, candidates[i]).then(function (r) {
        return { path: candidates[i], entries: r.entries };
      }, function (err) {
        if (err.kind === 'not-found') return attempt(i + 1);
        throw err;
      });
    }
    return attempt(0);
  }

  /* Returns {amsDir, config, sprints:{path,entries}|null, handoff:{...}|null}.
     verdict is 'ok' | 'no-sprints' | 'not-ams'. */
  function resolve(repo, gh) {
    return findConfig(repo, gh).then(function (found) {
      var amsDir = found && found.amsDir ? found.amsDir : 'AMS';
      var cfg = found && found.config ? found.config : { components: null, settings: {} };
      var comps = componentsList(cfg);

      var wantSprints = !comps || comps.indexOf('SPRINTS') !== -1;

      return Promise.all([
        wantSprints ? resolveDir(repo, gh, amsDir, cfg.settings.sprints_dir, DEFAULTS.sprints_dir)
                    : Promise.resolve(null),
        resolveDir(repo, gh, amsDir, cfg.settings.handoff_dir, DEFAULTS.handoff_dir)
      ]).then(function (r) {
        var sprints = r[0], handoff = r[1];
        var verdict = 'ok';
        if (!sprints && !handoff) verdict = 'not-ams';
        else if (!sprints || !sprints.entries.some(function (e) {
          return AMSSprints.isSprintFile(e);
        })) verdict = 'no-sprints';

        return {
          repo: repo, amsDir: amsDir, configPath: found ? found.configPath : null,
          listing: found ? found.listing : [], tried: found ? found.tried : [],
          config: cfg, sprints: sprints, handoff: handoff, verdict: verdict
        };
      });
    });
  }

  return { resolve: resolve, parseConfig: parseConfig, componentsList: componentsList,
           findConfig: findConfig, DEFAULTS: DEFAULTS };
})();
