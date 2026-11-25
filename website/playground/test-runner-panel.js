/**
 * test-runner-panel.js — Browser entry-point for the Test Runner section.
 *
 * Issue #2051 / FRONTEND-281
 *
 * Wires the textarea controls in index.html to TestRunnerPanel.
 * Loaded as <script type="module"> after the DOM is ready.
 *
 * Because the playground ships with no bundler, we import the parser directly
 * from the shared source path using a URL-relative bare path.  The panel class
 * is inlined below instead of re-importing from the frontend/ source tree so
 * the playground remains a pure static site with zero build steps.
 */
'use strict';

import { parseCargoTestOutput, parseLcov } from '../../frontend/src/components/test-runner-parser.js';

/* ─────────────────────────────────────────────────────────────────────────────
   Minimal DOM helpers (match playground.js conventions)
───────────────────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const CSS_PREFIX = 'trp';

const STATUS_ICONS = { passed: '✓', failed: '✗', ignored: '—', panic: '⚠' };

function formatMs(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

function covClass(pct) {
  if (pct >= 80) return CSS_PREFIX + '-cov-high';
  if (pct >= 50) return CSS_PREFIX + '-cov-mid';
  return CSS_PREFIX + '-cov-low';
}

/* ─────────────────────────────────────────────────────────────────────────────
   TestRunnerPanel (inline, no bundler dependency)
───────────────────────────────────────────────────────────────────────────── */

class TestRunnerPanel {
  constructor(container) {
    this._container = container;
    this._suites = [];
    this._coverage = null;
    this._render();
  }

  loadOutput(raw) {
    this._suites = parseCargoTestOutput(raw);
    this._renderSuites();
  }

  loadCoverage(lcovText) {
    this._coverage = parseLcov(lcovText);
    this._renderCoverageBar();
  }

  clear() {
    this._suites = [];
    this._coverage = null;
    this._render();
  }

  _render() {
    this._container.innerHTML = '';
    this._container.className = CSS_PREFIX + '-panel';

    this._container.appendChild(this._makeHeader());

    this._suiteArea = document.createElement('div');
    this._suiteArea.className = CSS_PREFIX + '-suites';
    this._container.appendChild(this._suiteArea);

    this._coverageEl = document.createElement('div');
    this._coverageEl.className = CSS_PREFIX + '-coverage-bar';
    this._coverageEl.hidden = true;
    this._container.appendChild(this._coverageEl);

    this._emptyEl = document.createElement('div');
    this._emptyEl.className = CSS_PREFIX + '-empty';
    this._emptyEl.textContent = 'Paste cargo test JSON output above and click "Parse & display results".';
    this._container.appendChild(this._emptyEl);
  }

  _makeHeader() {
    const bar = document.createElement('div');
    bar.className = CSS_PREFIX + '-header';

    const title = document.createElement('span');
    title.className = CSS_PREFIX + '-title';
    title.textContent = 'Test Results';
    bar.appendChild(title);

    this._summaryChip = document.createElement('span');
    this._summaryChip.className = CSS_PREFIX + '-summary-chip';
    this._summaryChip.hidden = true;
    bar.appendChild(this._summaryChip);

    return bar;
  }

  _renderSuites() {
    this._suiteArea.innerHTML = '';
    this._emptyEl.hidden = this._suites.length > 0;

    let totalPassed = 0, totalFailed = 0, totalIgnored = 0;
    for (const suite of this._suites) {
      totalPassed += suite.passed;
      totalFailed += suite.failed;
      totalIgnored += suite.ignored;
      this._suiteArea.appendChild(this._makeSuiteCard(suite));
    }

    if (this._suites.length) {
      const total = totalPassed + totalFailed + totalIgnored;
      this._summaryChip.hidden = false;
      this._summaryChip.textContent = totalPassed + '/' + total + ' passed';
      this._summaryChip.className = CSS_PREFIX + '-summary-chip ' +
        (totalFailed > 0 ? CSS_PREFIX + '-chip-fail' : CSS_PREFIX + '-chip-pass');
    } else {
      this._summaryChip.hidden = true;
    }
  }

  _makeSuiteCard(suite) {
    const card = document.createElement('div');
    card.className = CSS_PREFIX + '-suite-card';

    const head = document.createElement('div');
    head.className = CSS_PREFIX + '-suite-head';

    const badge = document.createElement('span');
    badge.className = CSS_PREFIX + '-suite-badge ' +
      (suite.failed > 0 ? CSS_PREFIX + '-badge-fail' : CSS_PREFIX + '-badge-pass');
    badge.textContent = suite.failed > 0 ? 'FAIL' : 'PASS';
    head.appendChild(badge);

    const name = document.createElement('span');
    name.className = CSS_PREFIX + '-suite-name';
    name.textContent = suite.name || 'unnamed suite';
    head.appendChild(name);

    const stats = document.createElement('span');
    stats.className = CSS_PREFIX + '-suite-stats';
    stats.textContent = suite.passed + ' passed · ' + suite.failed + ' failed · ' + suite.ignored + ' ignored';
    head.appendChild(stats);

    if (suite.elapsed_ms != null) {
      const el = document.createElement('span');
      el.className = CSS_PREFIX + '-elapsed';
      el.textContent = formatMs(suite.elapsed_ms);
      head.appendChild(el);
    }

    card.appendChild(head);

    if (suite.tests && suite.tests.length) {
      const list = document.createElement('ul');
      list.className = CSS_PREFIX + '-test-list';
      for (const t of suite.tests) list.appendChild(this._makeTestRow(t));
      card.appendChild(list);
    }

    return card;
  }

  _makeTestRow(test) {
    const li = document.createElement('li');
    li.className = CSS_PREFIX + '-test-row ' + CSS_PREFIX + '-test-' + test.status;
    li.setAttribute('data-test-name', test.name);

    const badge = document.createElement('span');
    badge.className = CSS_PREFIX + '-inline-badge ' + CSS_PREFIX + '-inline-' + test.status;
    badge.setAttribute('aria-label', test.status);
    badge.textContent = STATUS_ICONS[test.status] || test.status;
    li.appendChild(badge);

    const nameEl = document.createElement('span');
    nameEl.className = CSS_PREFIX + '-test-name';
    nameEl.textContent = test.name;
    li.appendChild(nameEl);

    if (test.line != null) {
      const hint = document.createElement('span');
      hint.className = CSS_PREFIX + '-line-hint';
      hint.textContent = 'line ' + test.line;
      li.appendChild(hint);
    }

    if (test.elapsed_ms != null) {
      const el = document.createElement('span');
      el.className = CSS_PREFIX + '-elapsed ' + CSS_PREFIX + '-elapsed-inline';
      el.textContent = formatMs(test.elapsed_ms);
      li.appendChild(el);
    }

    if (test.stdout) {
      const details = document.createElement('details');
      details.className = CSS_PREFIX + '-test-details';
      if (test.status === 'failed' || test.status === 'panic') details.open = true;

      const summary = document.createElement('summary');
      summary.className = CSS_PREFIX + '-test-summary';
      summary.textContent = (test.status === 'failed' || test.status === 'panic')
        ? 'Show failure output' : 'Show output';
      details.appendChild(summary);

      const pre = document.createElement('pre');
      pre.className = CSS_PREFIX + '-test-stdout';
      pre.textContent = test.stdout;
      details.appendChild(pre);

      li.appendChild(details);
    }

    return li;
  }

  _renderCoverageBar() {
    if (!this._coverage || !this._coverage.totalFound) {
      this._coverageEl.hidden = true;
      return;
    }
    this._coverageEl.hidden = false;
    this._coverageEl.innerHTML = '';

    const { totalHit, totalFound, files } = this._coverage;
    const pct = Math.round((totalHit / totalFound) * 1000) / 10;

    const header = document.createElement('div');
    header.className = CSS_PREFIX + '-cov-header';
    const label = document.createElement('span');
    label.className = CSS_PREFIX + '-cov-label';
    label.textContent = 'Coverage: ' + pct + '%';
    header.appendChild(label);
    const detail = document.createElement('span');
    detail.className = CSS_PREFIX + '-cov-detail';
    detail.textContent = totalHit + ' / ' + totalFound + ' lines hit';
    header.appendChild(detail);
    this._coverageEl.appendChild(header);

    const track = document.createElement('div');
    track.className = CSS_PREFIX + '-cov-track';
    const fill = document.createElement('div');
    fill.className = CSS_PREFIX + '-cov-fill ' + covClass(pct);
    fill.style.width = pct + '%';
    fill.setAttribute('role', 'progressbar');
    fill.setAttribute('aria-valuenow', pct);
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    fill.setAttribute('aria-label', 'Code coverage ' + pct + '%');
    track.appendChild(fill);
    this._coverageEl.appendChild(track);

    if (files && files.length) {
      const ul = document.createElement('ul');
      ul.className = CSS_PREFIX + '-cov-files';
      for (const f of files) {
        const filePct = f.found > 0 ? Math.round((f.hit / f.found) * 1000) / 10 : 0;
        const li = document.createElement('li');
        li.className = CSS_PREFIX + '-cov-file';
        const fn = document.createElement('span');
        fn.className = CSS_PREFIX + '-cov-fname';
        fn.textContent = f.name;
        li.appendChild(fn);
        const fp = document.createElement('span');
        fp.className = CSS_PREFIX + '-cov-fpct ' + covClass(filePct);
        fp.textContent = filePct + '%';
        li.appendChild(fp);
        ul.appendChild(li);
      }
      this._coverageEl.appendChild(ul);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Wire up controls
───────────────────────────────────────────────────────────────────────────── */

const panelEl = $('testRunnerPanel');
const outputArea = $('testOutputArea');
const coverageArea = $('coverageArea');
const runBtn = $('runTestsBtn');
const clearBtn = $('clearTestsBtn');

if (panelEl && outputArea && runBtn) {
  const panel = new TestRunnerPanel(panelEl);

  runBtn.addEventListener('click', () => {
    const raw = outputArea.value.trim();
    if (!raw) return;
    panel.loadOutput(raw);

    const lcov = coverageArea ? coverageArea.value.trim() : '';
    if (lcov) panel.loadCoverage(lcov);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (outputArea) outputArea.value = '';
      if (coverageArea) coverageArea.value = '';
      panel.clear();
    });
  }
}
