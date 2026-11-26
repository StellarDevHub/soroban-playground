/**
 * TestRunnerPanel — Interactive Automated Test Runner
 *
 * Issue #2051 / FRONTEND-281
 *
 * Parses cargo test JSON message streams into structured test-suite cards,
 * renders inline pass/fail assertion badges, and maps code coverage line
 * highlights from lcov/llvm-cov output onto editor gutter decorations.
 *
 * This module is intentionally framework-free vanilla JS so it slots into the
 * same no-build Soroban Playground runtime as playground.js.
 *
 * Public API
 * ----------
 *   const panel = new TestRunnerPanel(containerEl);
 *   panel.loadOutput(rawCargoTestJson);     // JSON-event stream (string)
 *   panel.loadCoverage(lcovText);           // lcov coverage report (string)
 *   panel.clear();
 *
 * The panel owns its own DOM subtree inside `containerEl` and applies
 * gutter decorations to any Monaco editor instances found under
 * `.monaco-editor` via the global `monaco` object when available.
 */
'use strict';

import { parseCargoTestOutput, parseLcov } from './test-runner-parser.js';

/* ─────────────────────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────────────────────── */

const CSS_PREFIX = 'trp';

/* ─────────────────────────────────────────────────────────────────────────────
   TestRunnerPanel class
───────────────────────────────────────────────────────────────────────────── */

export class TestRunnerPanel {
  /**
   * @param {HTMLElement} container  Mounting point for the panel's DOM.
   */
  constructor(container) {
    if (!container) throw new Error('TestRunnerPanel: container element is required');
    this._container = container;
    this._suites = [];
    this._coverage = null;
    this._decorationIds = [];   // Monaco decoration handle IDs
    this._monacoEditor = null;
    this._render();
  }

  /* ── Public ─────────────────────────────────────────────────────────────── */

  /**
   * Parse a `cargo test -- --format json` output stream and re-render.
   * @param {string} raw  Raw stdout from `cargo test`.
   */
  loadOutput(raw) {
    this._suites = parseCargoTestOutput(raw);
    this._renderSuites();
    this._applyDecorations();
  }

  /**
   * Parse an lcov coverage report and re-render coverage highlights.
   * @param {string} lcovText  Contents of lcov.info (or llvm-cov export).
   */
  loadCoverage(lcovText) {
    this._coverage = parseLcov(lcovText);
    this._renderCoverageBar();
    this._applyDecorations();
  }

  /** Remove all results and decorations, return panel to empty state. */
  clear() {
    this._suites = [];
    this._coverage = null;
    this._clearDecorations();
    this._render();
  }

  /**
   * Wire a Monaco editor instance so the panel can place gutter decorations.
   * Call after the editor has been mounted.
   * @param {object} editor  monaco.editor.IStandaloneCodeEditor
   */
  setEditor(editor) {
    this._monacoEditor = editor;
    this._applyDecorations();
  }

  /* ── Internal render helpers ─────────────────────────────────────────────── */

  _render() {
    this._container.innerHTML = '';
    this._container.className = `${CSS_PREFIX}-panel`;

    const header = this._makeHeader();
    this._container.appendChild(header);

    this._suiteArea = document.createElement('div');
    this._suiteArea.className = `${CSS_PREFIX}-suites`;
    this._container.appendChild(this._suiteArea);

    this._coverageBar = document.createElement('div');
    this._coverageBar.className = `${CSS_PREFIX}-coverage-bar`;
    this._coverageBar.hidden = true;
    this._container.appendChild(this._coverageBar);

    this._emptyState = document.createElement('div');
    this._emptyState.className = `${CSS_PREFIX}-empty`;
    this._emptyState.textContent = 'No test output loaded. Run cargo test --format json and paste the output here.';
    this._container.appendChild(this._emptyState);

    if (this._suites.length) this._renderSuites();
    if (this._coverage) this._renderCoverageBar();
  }

  _makeHeader() {
    const bar = document.createElement('div');
    bar.className = `${CSS_PREFIX}-header`;

    const title = document.createElement('span');
    title.className = `${CSS_PREFIX}-title`;
    title.textContent = 'Test Runner';
    bar.appendChild(title);

    this._summaryChip = document.createElement('span');
    this._summaryChip.className = `${CSS_PREFIX}-summary-chip`;
    this._summaryChip.hidden = true;
    bar.appendChild(this._summaryChip);

    return bar;
  }

  _renderSuites() {
    this._suiteArea.innerHTML = '';
    this._emptyState.hidden = this._suites.length > 0;

    let totalPassed = 0;
    let totalFailed = 0;
    let totalIgnored = 0;

    for (const suite of this._suites) {
      totalPassed += suite.passed;
      totalFailed += suite.failed;
      totalIgnored += suite.ignored;
      this._suiteArea.appendChild(this._makeSuiteCard(suite));
    }

    // Update summary chip
    if (this._suites.length) {
      const total = totalPassed + totalFailed + totalIgnored;
      this._summaryChip.hidden = false;
      this._summaryChip.textContent = `${totalPassed}/${total} passed`;
      this._summaryChip.className = `${CSS_PREFIX}-summary-chip ${totalFailed > 0 ? CSS_PREFIX + '-chip-fail' : CSS_PREFIX + '-chip-pass'}`;
    } else {
      this._summaryChip.hidden = true;
    }
  }

  _makeSuiteCard(suite) {
    const card = document.createElement('div');
    card.className = `${CSS_PREFIX}-suite-card`;

    // Suite header row
    const head = document.createElement('div');
    head.className = `${CSS_PREFIX}-suite-head`;

    const badge = document.createElement('span');
    badge.className = `${CSS_PREFIX}-suite-badge ${suite.failed > 0 ? CSS_PREFIX + '-badge-fail' : CSS_PREFIX + '-badge-pass'}`;
    badge.textContent = suite.failed > 0 ? 'FAIL' : 'PASS';
    badge.setAttribute('aria-label', suite.failed > 0 ? 'Suite failed' : 'Suite passed');
    head.appendChild(badge);

    const suiteName = document.createElement('span');
    suiteName.className = `${CSS_PREFIX}-suite-name`;
    suiteName.textContent = suite.name || 'unnamed suite';
    head.appendChild(suiteName);

    const stats = document.createElement('span');
    stats.className = `${CSS_PREFIX}-suite-stats`;
    stats.textContent = `${suite.passed} passed · ${suite.failed} failed · ${suite.ignored} ignored`;
    head.appendChild(stats);

    if (suite.elapsed_ms != null) {
      const elapsed = document.createElement('span');
      elapsed.className = `${CSS_PREFIX}-elapsed`;
      elapsed.textContent = formatMs(suite.elapsed_ms);
      head.appendChild(elapsed);
    }

    card.appendChild(head);

    // Test case rows
    if (suite.tests && suite.tests.length) {
      const list = document.createElement('ul');
      list.className = `${CSS_PREFIX}-test-list`;
      for (const t of suite.tests) {
        list.appendChild(this._makeTestRow(t));
      }
      card.appendChild(list);
    }

    return card;
  }

  _makeTestRow(test) {
    const li = document.createElement('li');
    li.className = `${CSS_PREFIX}-test-row ${CSS_PREFIX}-test-${test.status}`;
    li.setAttribute('data-test-name', test.name);

    // Status badge
    const badge = document.createElement('span');
    badge.className = `${CSS_PREFIX}-inline-badge ${CSS_PREFIX}-inline-${test.status}`;
    badge.setAttribute('aria-label', test.status);
    badge.textContent = STATUS_ICONS[test.status] || test.status;
    li.appendChild(badge);

    // Test name
    const name = document.createElement('span');
    name.className = `${CSS_PREFIX}-test-name`;
    name.textContent = test.name;
    li.appendChild(name);

    // Line number hint (if extracted from name)
    if (test.line != null) {
      const lineHint = document.createElement('span');
      lineHint.className = `${CSS_PREFIX}-line-hint`;
      lineHint.textContent = `line ${test.line}`;
      li.appendChild(lineHint);
    }

    if (test.elapsed_ms != null) {
      const elapsed = document.createElement('span');
      elapsed.className = `${CSS_PREFIX}-elapsed ${CSS_PREFIX}-elapsed-inline`;
      elapsed.textContent = formatMs(test.elapsed_ms);
      li.appendChild(elapsed);
    }

    // Assertion / panic output
    if (test.stdout) {
      const details = document.createElement('details');
      details.className = `${CSS_PREFIX}-test-details`;
      if (test.status === 'failed' || test.status === 'panic') details.open = true;

      const summary = document.createElement('summary');
      summary.className = `${CSS_PREFIX}-test-summary`;
      summary.textContent = (test.status === 'failed' || test.status === 'panic')
        ? 'Show failure output' : 'Show output';
      details.appendChild(summary);

      const pre = document.createElement('pre');
      pre.className = `${CSS_PREFIX}-test-stdout`;
      pre.textContent = test.stdout;
      details.appendChild(pre);

      li.appendChild(details);
    }

    return li;
  }

  _renderCoverageBar() {
    if (!this._coverage) {
      this._coverageBar.hidden = true;
      return;
    }
    this._coverageBar.hidden = false;
    this._coverageBar.innerHTML = '';

    const { totalHit, totalFound, files } = this._coverage;
    const pct = totalFound > 0 ? Math.round((totalHit / totalFound) * 1000) / 10 : 0;

    const header = document.createElement('div');
    header.className = `${CSS_PREFIX}-cov-header`;

    const label = document.createElement('span');
    label.className = `${CSS_PREFIX}-cov-label`;
    label.textContent = `Coverage: ${pct}%`;
    header.appendChild(label);

    const detail = document.createElement('span');
    detail.className = `${CSS_PREFIX}-cov-detail`;
    detail.textContent = `${totalHit} / ${totalFound} lines hit`;
    header.appendChild(detail);

    this._coverageBar.appendChild(header);

    // Overall progress bar
    const track = document.createElement('div');
    track.className = `${CSS_PREFIX}-cov-track`;
    const fill = document.createElement('div');
    fill.className = `${CSS_PREFIX}-cov-fill ${covClass(pct)}`;
    fill.style.width = pct + '%';
    fill.setAttribute('aria-valuenow', pct);
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    fill.setAttribute('role', 'progressbar');
    fill.setAttribute('aria-label', `Code coverage ${pct}%`);
    track.appendChild(fill);
    this._coverageBar.appendChild(track);

    // Per-file breakdown
    if (files && files.length) {
      const fileList = document.createElement('ul');
      fileList.className = `${CSS_PREFIX}-cov-files`;
      for (const f of files) {
        const filePct = f.found > 0 ? Math.round((f.hit / f.found) * 1000) / 10 : 0;
        const item = document.createElement('li');
        item.className = `${CSS_PREFIX}-cov-file`;

        const fname = document.createElement('span');
        fname.className = `${CSS_PREFIX}-cov-fname`;
        fname.textContent = f.name;
        item.appendChild(fname);

        const fpct = document.createElement('span');
        fpct.className = `${CSS_PREFIX}-cov-fpct ${covClass(filePct)}`;
        fpct.textContent = `${filePct}%`;
        item.appendChild(fpct);

        fileList.appendChild(item);
      }
      this._coverageBar.appendChild(fileList);
    }
  }

  /* ── Monaco gutter decorations ───────────────────────────────────────────── */

  _clearDecorations() {
    if (!this._monacoEditor || !this._decorationIds.length) return;
    try {
      this._monacoEditor.deltaDecorations(this._decorationIds, []);
    } catch (_) {
      // Editor may have been disposed
    }
    this._decorationIds = [];
  }

  _applyDecorations() {
    const editor = this._monacoEditor;
    if (!editor) return;

    this._clearDecorations();
    const newDecorations = [];

    // Pass/fail gutter badges from test results
    for (const suite of this._suites) {
      for (const test of suite.tests) {
        if (test.line == null) continue;
        newDecorations.push({
          range: new monaco.Range(test.line, 1, test.line, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: `${CSS_PREFIX}-glyph-${test.status}`,
            glyphMarginHoverMessage: {
              value: `**${test.status.toUpperCase()}** \`${test.name}\``,
            },
            overviewRuler: {
              color: test.status === 'failed' ? '#f87171' : test.status === 'passed' ? '#4ade80' : '#fbbf24',
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
      }
    }

    // Coverage line highlights
    if (this._coverage) {
      for (const file of this._coverage.files) {
        for (const lineInfo of file.lines) {
          const cls = lineInfo.hits > 0
            ? `${CSS_PREFIX}-cov-hit`
            : `${CSS_PREFIX}-cov-miss`;
          newDecorations.push({
            range: new monaco.Range(lineInfo.line, 1, lineInfo.line, 1),
            options: {
              isWholeLine: true,
              className: cls,
              marginClassName: cls + '-margin',
              overviewRuler: {
                color: lineInfo.hits > 0 ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)',
                position: monaco.editor.OverviewRulerLane.Right,
              },
            },
          });
        }
      }
    }

    if (newDecorations.length) {
      try {
        this._decorationIds = editor.deltaDecorations([], newDecorations);
      } catch (_) {
        // monaco not ready
      }
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Private helpers
───────────────────────────────────────────────────────────────────────────── */

const STATUS_ICONS = {
  passed: '✓',
  failed: '✗',
  ignored: '—',
  panic: '⚠',
};

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function covClass(pct) {
  if (pct >= 80) return `${CSS_PREFIX}-cov-high`;
  if (pct >= 50) return `${CSS_PREFIX}-cov-mid`;
  return `${CSS_PREFIX}-cov-low`;
}
