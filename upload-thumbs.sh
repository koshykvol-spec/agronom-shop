#!/usr/bin/env bash
# Пакетна заливка мініатюр (thumb/**) у R2 bucket agronom-img під ключем thumb/<path>.
# Ідемпотентна: повторний запуск просто перезаливає. Лог — thumb-upload.log, збої — thumb-upload-fail.log.
set -u
cd "$(dirname "$0")"
val(){ grep "^$1=" .cf-secrets | head -1 | cut -d= -f2- | tr -d '\r'; }
export CLOUDFLARE_API_TOKEN="$(val CLOUDFLARE_API_TOKEN)"
export CLOUDFLARE_ACCOUNT_ID="$(val CLOUDFLARE_ACCOUNT_ID)"
W=/tmp/pw/node_modules/.bin/wrangler
LOG=thumb-upload.log
FAIL=thumb-upload-fail.log
: > "$FAIL"
total=$(find thumb -type f -name '*.webp' | wc -l)
i=0; ok=0; bad=0
echo "$(date +%H:%M:%S) старт: $total файлів" > "$LOG"
while IFS= read -r -d '' f; do
  i=$((i+1))
  if "$W" r2 object put "agronom-img/$f" --file="$f" >/dev/null 2>&1; then
    ok=$((ok+1))
  else
    bad=$((bad+1)); printf '%s\n' "$f" >> "$FAIL"
  fi
  if [ $((i % 50)) -eq 0 ]; then echo "$(date +%H:%M:%S) $i/$total  ok=$ok bad=$bad" >> "$LOG"; fi
done < <(find thumb -type f -name '*.webp' -print0)
echo "$(date +%H:%M:%S) ГОТОВО: $i/$total  ok=$ok bad=$bad" >> "$LOG"
