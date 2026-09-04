from __future__ import annotations

import argparse
import csv
import html
import json
import subprocess
from pathlib import Path

import duckdb
import yaml

ROOT = Path(__file__).resolve().parents[1]


def dbt_test(rule: dict) -> dict:
    check = rule["check"]
    args = {"column_name": rule["column"]}
    if check == "range":
        args.update(min_value=rule.get("min"), max_value=rule.get("max"))
    elif check == "pattern":
        args["pattern"] = rule["value"]
    elif check == "allowed_values":
        args["values"] = rule["value"]
    elif check == "type":
        args["data_type"] = rule["value"]
    return {f"dq_{check}": {"name": rule["id"], "arguments": args}}


def compile_schema(config: dict) -> None:
    columns = {}
    for rule in config["rules"]:
        columns.setdefault(rule["column"], []).append(dbt_test(rule))
    schema = {"version": 2, "models": [{"name": "stg_input", "columns": [
        {"name": name, "data_tests": tests} for name, tests in columns.items()
    ]}]}
    (ROOT / "models" / "generated_schema.yml").write_text(yaml.safe_dump(schema, sort_keys=False))


def load_csv(path: Path) -> tuple[int, list[str]]:
    con = duckdb.connect(str(ROOT / "quality.duckdb"))
    quoted = str(path.resolve()).replace("'", "''")
    con.execute(f"create or replace table raw_input as select *, row_number() over () + 1 as _source_row from read_csv_auto('{quoted}', all_varchar=true, header=true)")
    count = con.execute("select count(*) from raw_input").fetchone()[0]
    columns = [r[1] for r in con.execute("pragma table_info('raw_input')").fetchall()]
    con.close()
    return count, columns


def collect(config: dict, row_count: int) -> tuple[list[dict], list[dict]]:
    run = json.loads((ROOT / "artifacts" / "run_results.json").read_text())
    by_name = {r["unique_id"].split(".")[-1]: r for r in run["results"]}
    con = duckdb.connect(str(ROOT / "quality.duckdb"), read_only=True)
    tables = con.execute("select table_schema, table_name from information_schema.tables where table_schema like '%dq_audit%'").fetchall()
    results, failures = [], []
    for rule in config["rules"]:
        artifact = by_name.get(rule["id"], {})
        failed = int(artifact.get("failures") or 0)
        results.append({**rule, "failed": failed, "evaluated": row_count, "score": 100 * (row_count - failed) / max(row_count, 1)})
        matches = [(s, t) for s, t in tables if rule["id"].lower() in t.lower()]
        if matches:
            schema, table = matches[0]
            rows = con.execute(f'select * from "{schema}"."{table}"').fetchdf().to_dict("records")
            for row in rows:
                failures.append({"rule": rule["id"], "dimension": rule["dimension"], "severity": rule["severity"], "column": rule["column"], "row": row})
    con.close()
    return results, failures


def write_report(config: dict, results: list[dict], failures: list[dict]) -> None:
    weights = {k.lower(): v for k, v in config.get("weights", {}).items()}
    dimensions = {}
    for name in ("Completeness", "Accuracy", "Validity"):
        group = [r for r in results if r["dimension"].lower() == name.lower()]
        dimensions[name] = sum(r["score"] * r["evaluated"] for r in group) / max(sum(r["evaluated"] for r in group), 1)
    overall = sum(dimensions[k] * weights.get(k.lower(), 1 / 3) for k in dimensions)
    cards = ''.join(f'<article><small>{html.escape(k)}</small><strong>{v:.1f}%</strong></article>' for k, v in dimensions.items())
    rows = ''.join(f'<tr><td>{html.escape(f["rule"])}</td><td>{html.escape(f["column"])}</td><td>{html.escape(f["severity"])}</td><td><code>{html.escape(str(f["row"]))}</code></td></tr>' for f in failures)
    page = f'''<!doctype html><meta charset="utf-8"><title>Data quality report</title><style>body{{font:16px system-ui;background:#081321;color:#eef5fb;margin:40px}}main{{max-width:1100px;margin:auto}}.score{{font-size:64px;color:#55d69e}}section{{display:flex;gap:15px}}article{{background:#102137;padding:22px;border-radius:12px;flex:1}}small,strong{{display:block}}article strong{{font-size:28px}}table{{width:100%;border-collapse:collapse;margin-top:25px}}td,th{{padding:10px;border-bottom:1px solid #26384e;text-align:left}}code{{white-space:normal;color:#9ddff0}}</style><main><h1>{html.escape(config['dataset'])}</h1><div class="score">{overall:.1f}%</div><p>Overall data quality score</p><section>{cards}</section><h2>Failed records ({len(failures)})</h2><table><tr><th>Rule</th><th>Column</th><th>Severity</th><th>Record</th></tr>{rows}</table></main>'''
    reports = ROOT / "reports"; reports.mkdir(exist_ok=True)
    (reports / "index.html").write_text(page)
    with (reports / "failures.csv").open("w", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=["rule", "dimension", "severity", "column", "row"]); writer.writeheader(); writer.writerows({**f, "row": json.dumps(f["row"], default=str)} for f in failures)


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("csv"); parser.add_argument("--rules", default="config/rules.yml"); args = parser.parse_args()
    config = yaml.safe_load((ROOT / args.rules).read_text())
    row_count, _ = load_csv(Path(args.csv)); compile_schema(config)
    subprocess.run(["dbt", "build", "--profiles-dir", str(ROOT), "--project-dir", str(ROOT)], check=True)
    results, failures = collect(config, row_count); write_report(config, results, failures)
    print(f"Score report: {ROOT / 'reports' / 'index.html'}")


if __name__ == "__main__":
    main()
