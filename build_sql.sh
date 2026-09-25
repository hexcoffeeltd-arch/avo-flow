#!/bin/sh
# รวมไฟล์ SQL เป็นไฟล์เดียวสำหรับวางใน Neon SQL Editor
cd "$(dirname "$0")/.."
{ echo "-- AVO FLOW install — generated $(date -u +%Y-%m-%d). Run once on an empty database (safe to re-run to update functions)."; echo "begin;";
  for f in sql/01_tables.sql sql/02_core.sql sql/03_api_master.sql sql/04_api_stock.sql sql/05_api_sales.sql sql/06_setup.sql; do echo; echo "-- ==== $f ===="; cat "$f"; done; echo "commit;"; } > sql/avo_flow_install.sql
echo "wrote sql/avo_flow_install.sql"
