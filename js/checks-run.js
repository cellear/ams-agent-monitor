/* Runs both layers and renders the result. */
(function () {
  'use strict';

  var failuresOnly = false, lastResults = [];

  function render(results, running) {
    lastResults = results;
    var pass = results.filter(function (r) { return r.pass; }).length;
    var fail = results.length - pass;

    var sum = document.getElementById('summary');
    sum.className = 'summary' + (running ? '' : (fail ? ' bad' : ' good'));
    sum.innerHTML = '';
    var count = document.createElement('span');
    count.className = 'count';
    count.textContent = running ? '…' : (fail ? fail + ' failing' : pass + ' passing');
    sum.appendChild(count);
    var note = document.createElement('span');
    note.textContent = running ? 'running…'
      : (fail ? pass + ' of ' + results.length + ' checks pass'
              : 'all checks pass across ' + new Set(results.map(function (r) { return r.suite; })).size + ' suites');
    sum.appendChild(note);

    var host = document.getElementById('results');
    host.innerHTML = '';
    var order = [];
    var bySuite = {};
    results.forEach(function (r) {
      if (!bySuite[r.suite]) { bySuite[r.suite] = []; order.push(r.suite); }
      bySuite[r.suite].push(r);
    });

    order.forEach(function (name) {
      var items = bySuite[name];
      var shown = failuresOnly ? items.filter(function (i) { return !i.pass; }) : items;
      if (!shown.length) return;
      var failed = items.filter(function (i) { return !i.pass; }).length;

      var box = document.createElement('div');
      box.className = 'suite' + (failed ? ' failing' : '');
      var h = document.createElement('h2');
      h.appendChild(document.createTextNode(name));
      var tally = document.createElement('span');
      tally.className = 'tally';
      tally.textContent = failed ? failed + ' failing of ' + items.length
                                 : items.length + ' passing';
      h.appendChild(tally);
      box.appendChild(h);

      var ul = document.createElement('ul');
      ul.className = 'checks';
      shown.forEach(function (r) {
        var li = document.createElement('li');
        li.className = r.pass ? 'pass' : 'fail';
        var mk = document.createElement('span');
        mk.className = 'mk';
        mk.textContent = r.pass ? '✓' : '✕';
        li.appendChild(mk);
        var txt = document.createElement('span');
        txt.textContent = r.label;
        if (!r.pass && r.detail) {
          var d = document.createElement('span');
          d.className = 'detail';
          d.textContent = r.detail;
          txt.appendChild(d);
        }
        li.appendChild(txt);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      host.appendChild(box);
    });
  }

  function runAll() {
    document.getElementById('probes').innerHTML = '';
    render([], true);
    var results = AMSChecks.run();
    render(results, true);
    AMSPageChecks.run(results).then(function () {
      render(results, false);
      /* A headless runner can read these off the page. */
      window.AMS_CHECK_RESULTS = results;
      window.AMS_CHECKS_DONE = true;
    });
  }

  document.getElementById('only-failures').addEventListener('click', function () {
    failuresOnly = !failuresOnly;
    this.classList.toggle('on', failuresOnly);
    this.textContent = failuresOnly ? 'Show all' : 'Show failures only';
    render(lastResults, false);
  });
  document.getElementById('rerun').addEventListener('click', runAll);

  runAll();
})();
