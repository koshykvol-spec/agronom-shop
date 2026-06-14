#!/usr/bin/env bash
# ============================================================
# Одна команда: регенерує sitemap.xml + noscript-пререндер
# і деплоїть сайт на Cloudflare Pages.
#
# Використання:   ./deploy.sh
# Потребує:
#   - .cf-secrets з CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PAGES_PROJECT
#   - python3
#   - wrangler у PATH (npm i -g wrangler@3) або змінна WRANGLER=шлях/до/wrangler
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

[ -f .cf-secrets ] || { echo "❌ Немає .cf-secrets (скопіюйте з .cf-secrets.example і заповніть)"; exit 1; }
val(){ grep "^$1=" .cf-secrets | head -1 | cut -d= -f2- | tr -d '\r'; }
export CLOUDFLARE_API_TOKEN="$(val CLOUDFLARE_API_TOKEN)"
export CLOUDFLARE_ACCOUNT_ID="$(val CLOUDFLARE_ACCOUNT_ID)"
PROJECT="$(val PAGES_PROJECT)"; PROJECT="${PROJECT:-agronom1}"
export WRANGLER="${WRANGLER:-wrangler}"   # prerender.py читає його, щоб тягнути категорії з D1

echo "1/3 ▸ Регенерую noscript-каталог (sitemap.xml — динамічний: functions/sitemap.xml.js)…"
python3 prerender.py

echo "2/3 ▸ Готую чисту папку для завантаження…"
DEPLOY="$(mktemp -d)"
rsync -a \
  --exclude='.git' --exclude='.cf-secrets' --exclude='.cf-secrets.example' \
  --exclude='.gitignore' --exclude='cloudflare-worker' --exclude='docs' \
  --exclude='__pycache__' --exclude='node_modules' --exclude='*.py' \
  --exclude='deploy.sh' --exclude='.wrangler' \
  --exclude='/IMG/' --exclude='/IMG_*/' --exclude='/thumb/' \
  ./ "$DEPLOY/"

# Кеш-бастинг: версіонуємо спільні асети ?v=<час деплою> у HTML (Pages кешує статику ~4 год;
# _headers це не перекриває, тож деплої видно одразу лише через зміну URL асета).
VER="$(date +%s)"
for a in app.js cart.js footer.js seo-jsonld.js seasonal-helper.js style.css recipes.css; do
  ae="$(printf '%s' "$a" | sed 's/\./\\./g')"
  find "$DEPLOY" -name '*.html' -print0 | xargs -0 sed -i "s#=\"$ae\"#=\"$a?v=$VER\"#g"
done
echo "    версія асетів: $VER"

echo "3/3 ▸ Деплой на Cloudflare Pages (проєкт: $PROJECT)…"
"$WRANGLER" pages deploy "$DEPLOY" --project-name="$PROJECT" --branch=main --commit-dirty=true --commit-message="deploy"
rm -rf "$DEPLOY"
echo "✅ Готово."
