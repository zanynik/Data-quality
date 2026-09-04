# Data Quality Studio

A lightweight, metadata-driven data-quality MVP for CSV files.

## Live application

The static frontend is published through GitHub Pages. It runs entirely in the browser: uploaded CSV data is not sent to a server.

## Features

- CSV, semicolon-separated, and tab-separated input up to 25 MB
- Automatic column profiling and starter-rule inference
- YAML-configured completeness, accuracy, and validity checks
- Dataset, dimension, column, and failed-row drilldowns
- Search, filters, remediation suggestions, CSV export, and print/PDF output
- Downloadable dbt Core + DuckDB + Python starter framework

## Local development

```bash
npm ci
npm run dev
```

Run the automated workflow test with:

```bash
npm test
```

The full dbt/DuckDB implementation is in [`starter-kit/`](starter-kit/README.md).

## Project layout

- `dist/` — deployable browser application
- `starter-kit/` — dbt Core, DuckDB, Python, macros, and example YAML rules
- `tests/` — end-to-end DOM workflow test
- `.github/workflows/pages.yml` — test and GitHub Pages deployment
