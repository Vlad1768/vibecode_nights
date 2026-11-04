#!/usr/bin/env bash
# Копирует скиллы .claude/skills → .agents/skills (оттуда их читает Codex).
# Убирает поля frontmatter, которые понимает только Claude Code, и подставляет понятный текст вместо $ARGUMENTS.
# Запускай после любой правки скиллов: bash scripts/sync-agents-skills.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
rm -rf .agents/skills
mkdir -p .agents/skills
for d in .claude/skills/*/; do
  n="$(basename "$d")"
  cp -R "$d" ".agents/skills/$n"
  f=".agents/skills/$n/SKILL.md"
  awk '
    NR == 1 && /^---/ { fm = 1; print; next }
    fm && /^---/      { fm = 0; print; next }
    fm && /^(argument-hint|arguments|disable-model-invocation|user-invocable|allowed-tools|disallowed-tools|model|effort|context|agent|background|hooks|paths|shell|when_to_use):/ { next }
    { gsub(/`\$ARGUMENTS`/, "«текст, который человек написал после команды»"); print }
  ' "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
done
echo "Готово: $(ls .agents/skills | wc -l | tr -d ' ') скиллов → .agents/skills (для Codex). Не правь их руками — правь .claude/skills и запускай этот скрипт."
