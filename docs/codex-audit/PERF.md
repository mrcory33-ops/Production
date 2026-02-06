# Performance Measurements

Date: 2026-02-06

## CustomGanttTable cell-loop optimization

Change: Precompute segment start lookup per row and reuse precomputed date keys to reduce per-cell scans.

Benchmark:
- Script: `docs/codex-audit/perf/custom-gantt-cell-bench.js`
- Command: `node docs/codex-audit/perf/custom-gantt-cell-bench.js`
- Scenario: 300 rows x 180 columns x 6 segments, 50 iterations

Results:
- old-loop: 35.09ms (checksum 495000)
- new-loop: 15.63ms (checksum 495000)

Interpretation: ~2.2x faster for the per-cell segment lookup loop (same checksum = same work output).
