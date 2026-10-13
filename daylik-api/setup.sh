#!/bin/bash
# Tworzy bazę D1 na koncie, na które zalogowany jest wrangler, wpisuje jej ID do wrangler.toml, zakłada tabelę i deployuje.
set -e
cd "$(dirname "$0")"
OUT=$(npx wrangler d1 create daylik-decisions --location weur 2>&1 || true)
echo "$OUT"
ID=$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -z "$ID" ]; then
  ID=$(npx wrangler d1 list --json | python3 -c "import sys,json;print(next(d['uuid'] for d in json.load(sys.stdin) if d['name']=='daylik-decisions'))")
fi
echo "Database ID: $ID"
sed -i '' -E "s/database_id = \".*\"/database_id = \"$ID\"/" wrangler.toml
npx wrangler d1 execute daylik-decisions --remote --file=schema.sql -y
npx wrangler deploy
