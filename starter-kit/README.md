# Data Quality Service MVP

A metadata-driven local data-quality framework built with dbt Core, DuckDB and Python. Add or change checks in `config/rules.yml`; application code does not change.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python scripts/run_quality.py data/customer_orders.csv --rules config/rules.yml
```

The command loads the CSV into `quality.duckdb`, generates dbt metadata from YAML, runs reusable dbt tests with failure storage, and writes `reports/index.html` plus `reports/failures.csv`.

## Architecture

1. `run_quality.py` loads any CSV as strings into DuckDB to preserve invalid source values.
2. `rules.yml` is compiled into dbt `schema.yml` generic-test declarations.
3. dbt executes the reusable macros in `macros/tests.sql` and stores failing rows.
4. The runner reads dbt artifacts and audit tables, calculates weighted scores, and emits portable HTML/CSV outputs.

Rule score = `1 - failed rows / evaluated rows`. Dimension scores are weighted by evaluated rows. Overall score is the configured weighted mean of completeness, accuracy and validity.

## Roadmap

- Persist run summaries for trend comparison
- Add scheduled execution in CI and alert thresholds
- Add cross-dataset lookup rules and warehouse adapters
- Add statistical anomaly detection and schema drift
- Publish reports to object storage and add role-based access
