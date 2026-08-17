#!/bin/bash
# =====================================================================
# Tailwind ユーティリティの残量を数える（FLOCSS 移行の進捗確認用）
#
#   使い方:  bash scripts/countTailwind.sh                 # 全体
#            bash scripts/countTailwind.sh public/js/views  # 一部
#            bash scripts/countTailwind.sh --list <path>    # 中身を見る
#
# ★指示書に載っていた grep はそのままでは使えない。
#   `p[xytblr]?-` が FLOCSS の Project 接頭辞 `p-` に、`m[xytblr]?-` が
#   将来の `m-` に誤マッチするため、移行が終わったファイルでも 0 にならない。
#   ここでは class 属性をトークンに割ってから、FLOCSS の接頭辞
#   （l- c- p- u- js- is-）と移行途中の既知クラスを除外して数える。
# =====================================================================
set -euo pipefail

MODE="count"
if [ "${1:-}" = "--list" ]; then MODE="list"; shift; fi
TARGETS=("${@:-public/js public/index.html}")

# 移行の途中で意図的に残しているもの（Phase 5 で片付ける）
KEEP='^(heading-(l|m|r|rs)|text-(m|r|rs)|page-transition|animate-fadeIn|no-scrollbar'
KEEP+='|coach-(pulse|finger)|announce-chevron|notif-swipe-card|hidden)$'

# Tailwind っぽいトークン
TW='^(flex|grid|w-|h-|p[xytblr]?-|m[xytblr]?-|text-|bg-|border|rounded|gap-|items-|justify-'
TW+='|absolute|relative|fixed|sticky|z-|shadow|opacity-|truncate|overflow-|min-|max-|space-'
TW+='|divide-|leading-|font-|whitespace-|break-|object-|aspect-|inline|block|cursor-|active:'
TW+='|hover:|peer|ring-|backdrop-|transition|duration-|scale-|translate-|rotate-|col-|row-'
TW+='|self-|order-|list-|tracking-|underline|line-clamp-|resize|select-|pointer-events-)'

# shellcheck disable=SC2086
hits=$(grep -rhoE 'class="[^"]*"' ${TARGETS[@]} 2>/dev/null \
  | sed 's/^class="//; s/"$//' \
  | tr ' ' '\n' \
  | grep -v '^$' \
  | grep -v '\${' \
  | grep -vE '^(l|c|p|u|js|is)-' \
  | grep -vE "$KEEP" \
  | grep -E "$TW" || true)

if [ "$MODE" = "list" ]; then
  echo "$hits" | sort | uniq -c | sort -rn
else
  if [ -z "$hits" ]; then echo 0; else echo "$hits" | wc -l | tr -d ' '; fi
fi
