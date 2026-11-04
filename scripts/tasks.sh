#!/usr/bin/env bash
# Работа с TASKS.md без гонок и конфликтов. Запускать из любой папки репозитория.
#
#   scripts/tasks.sh free                       свободные задачи, у которых готовы зависимости
#   scripts/tasks.sh status                     кто что делает, сколько осталось
#   scripts/tasks.sh claim T3 Имя               захватить задачу (pull → проверка → коммит → push, с повтором)
#   scripts/tasks.sh done T3 Имя "заметка"      закрыть задачу: «готово: Имя» + заметка
#   scripts/tasks.sh add "Задача" "Где" [T1,T2] добавить задачу в конец таблицы (ID выдаётся сам)
#   scripts/tasks.sh block T3 "причина"         пометить блок
#   scripts/tasks.sh release T3                 вернуть задачу в «свободна»
#
# Коды выхода: 0 — ок, 1 — ошибка git/данных, 2 — задача занята, 3 — не готовы зависимости.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT"
FILE="TASKS.md"
BRANCH="$(git branch --show-current)"
MAX_TRIES=8

die() { echo "ОШИБКА: $*" >&2; exit 1; }
[ -f "$FILE" ] || die "нет $FILE в корне репозитория"
[ -n "$BRANCH" ] || die "detached HEAD — переключись на ветку (git switch main)"

clean_cell() { # убрать из значения символы, ломающие таблицу
  local v="$1"
  v="${v//|//}"
  printf '%s' "$v" | tr '\r\n\t' '   '
}

# Один разборщик таблицы на все запросы (меньше процессов — быстрее в Git Bash на Windows).
# MODE: field (ID_, COL_) | unmet (ID_) | free | status
query() {
  MODE_="$1" ID_="${2:-}" COL_="${3:-0}" awk '
    function trim(s) { gsub(/\r/, "", s); gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    /^\|/ {
      n = split($0, f, "|"); if (n < 7) next
      id = trim(f[2]); if (id == "ID" || id ~ /^[-: ]*$/) next
      cnt++; ids[cnt] = id
      for (i = 1; i <= 6; i++) cell[id, i] = trim(f[i + 1])
    }
    # Обрезка длинного текста по границе слова (пробел — один байт, так кириллица не ломается в любом awk)
    function short(s, n,    t, k) {
      if (length(s) <= n) return s
      t = substr(s, 1, n)
      for (k = length(t); k > n / 3; k--) if (substr(t, k, 1) == " ") return substr(t, 1, k - 1) "…"
      return t "…"
    }
    function unmet(id,    d, k, m, out, st) {
      m = split(cell[id, 4], d, /[ ,;]+/); out = ""
      for (k = 1; k <= m; k++) {
        if (d[k] == "" || d[k] == "—" || d[k] == "-" || d[k] == "–" || d[k] == "нет") continue
        st = cell[d[k], 5]
        if (st !~ /^готово/) out = out " " d[k] "(" (st == "" ? "нет такой задачи" : st) ")"
      }
      return substr(out, 2)
    }
    function free_list(    k, id, found) {
      for (k = 1; k <= cnt; k++) {
        id = ids[k]
        if (cell[id, 2] == "…" || cell[id, 2] == "...") continue   # строка-заготовка, задачи ещё нет
        if (cell[id, 5] == "свободна" && unmet(id) == "") { printf "  %-5s %s  [%s]\n", id, short(cell[id, 2], 150), short(cell[id, 3], 60); found = 1 }
      }
      if (!found) print "  (свободных задач с готовыми зависимостями нет)"
    }
    END {
      M = ENVIRON["MODE_"]; T = ENVIRON["ID_"]
      if (M == "field") { if ((T, 1) in cell) print cell[T, ENVIRON["COL_"] + 0]; exit }
      if (M == "unmet") { print unmet(T); exit }
      if (M == "free")  { free_list(); exit }
      if (M == "status") {
        for (k = 1; k <= cnt; k++) {
          id = ids[k]; st = cell[id, 5]
          if (st ~ /^готово/) dn++
          else if (st == "свободна") fr++
          else if (st ~ /^в работе/) work = work sprintf("  %-5s %-26s %s\n", id, st, short(cell[id, 2], 110))
          else if (st ~ /^блок/)     blk  = blk  sprintf("  %-5s %-26s %s\n", id, st, short(cell[id, 2], 110))
        }
        printf "Всего: %d · готово: %d · свободно: %d\n", cnt, dn, fr
        if (work != "") printf "В работе:\n%s", work
        if (blk  != "") printf "Блоки:\n%s", blk
        print "Можно брать:"; free_list()
      }
    }' "$FILE"
}

# Записать значение в ячейку: set_cell ID номер_колонки(1..6) значение
set_cell() {
  local tmp; tmp="$(mktemp)"
  ID_="$1" COL_="$2" VAL_="$(clean_cell "$3")" awk '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    {
      line = $0; cr = ""
      if (sub(/\r$/, "", line)) cr = "\r"
      if (line ~ /^\|/) {
        n = split(line, f, "|")
        if (n >= 7 && trim(f[2]) == ENVIRON["ID_"]) {
          f[ENVIRON["COL_"] + 1] = ENVIRON["VAL_"]
          out = "|"
          for (i = 2; i < n; i++) { v = trim(f[i]); out = out (v == "" ? " " : " " v " ") "|" }
          print out cr; next
        }
      }
      print $0
    }' "$FILE" > "$tmp" && cat "$tmp" > "$FILE" && rm -f "$tmp"
}

sync() {
  git pull --rebase --autostash -q origin "$BRANCH" \
    || die "git pull --rebase не прошёл. Разреши конфликт, сохранив изменения ОБЕИХ сторон (git status подскажет), и повтори."
}

undo_local_commit() {
  git reset -q --soft HEAD~1
  git restore --staged --worktree -- "$FILE" 2>/dev/null || git checkout -q HEAD -- "$FILE"
}

# Общий цикл: pull → проверка и правка ($1) → коммит ($2) → push; при гонке — откат своей правки и заново
edit_loop() {
  local fn="$1" msg="$2" err try
  [ -z "$(git status --porcelain -- "$FILE")" ] \
    || die "в $FILE есть незакоммиченные правки. Закоммить их (git commit -m '...' -- $FILE) или откати и повтори."
  for try in $(seq 1 "$MAX_TRIES"); do
    sync
    "$fn"
    if git diff --quiet -- "$FILE"; then echo "Нечего менять — $FILE уже в нужном состоянии."; return 0; fi
    git commit -q -m "$msg" -- "$FILE"
    if err="$(git push -q origin "HEAD:$BRANCH" 2>&1)"; then return 0; fi
    undo_local_commit
    case "$err" in
      *rejected*|*"fetch first"*|*non-fast-forward*) ;;
      *) die "git push не прошёл (не гонка — проверь доступ и сеть): $err" ;;
    esac
    echo "Пуш отклонён: кто-то запушил раньше. Повтор $try/$MAX_TRIES…" >&2
    sleep $(( (RANDOM % 3) + 1 ))
  done
  die "не удалось запушить за $MAX_TRIES попыток"
}

# ---------- правки ----------

do_claim() {
  local st unmet
  st="$(query field "$ID" 5)"
  [ -n "$st" ] || die "задачи $ID нет в $FILE"
  case "$(query field "$ID" 2)" in "…"|"...") die "$ID — заготовка без текста. Ведущий ещё не нарезал задачи (/kickoff)." ;; esac
  [ "$st" = "в работе: $NAME" ] && return 0
  if [ "$st" != "свободна" ]; then
    echo "ЗАНЯТО: $ID — «$st». Свободные сейчас:" >&2; query free >&2; exit 2
  fi
  unmet="$(query unmet "$ID")"
  if [ -n "$unmet" ]; then
    echo "НЕ ГОТОВЫ ЗАВИСИМОСТИ $ID: $unmet. Свободные сейчас:" >&2; query free >&2; exit 3
  fi
  set_cell "$ID" 5 "в работе: $NAME"
}

do_done() {
  local st; st="$(query field "$ID" 5)"
  [ -n "$st" ] || die "задачи $ID нет в $FILE"
  case "$st" in
    "в работе: $NAME"|свободна|готово*|блок*) ;;
    *) die "$ID сейчас «$st» — это не твоя задача. Закрывать чужие нельзя." ;;
  esac
  set_cell "$ID" 5 "готово: $NAME"
  [ -z "$NOTE" ] || set_cell "$ID" 6 "$NOTE"
}

do_block()   { [ -n "$(query field "$ID" 5)" ] || die "задачи $ID нет"; set_cell "$ID" 5 "блок: $NOTE"; }
do_release() { [ -n "$(query field "$ID" 5)" ] || die "задачи $ID нет"; set_cell "$ID" 5 "свободна"; }

do_add() {
  local tmp row
  NEW_ID="T$(awk '
      function trim(s) { gsub(/\r/, "", s); gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
      /^\|/ { split($0, f, "|"); id = trim(f[2]); if (id ~ /^T[0-9]+$/) { n = substr(id, 2) + 0; if (n > m) m = n } }
      END { print m + 1 }' "$FILE")"
  row="| $NEW_ID | $(clean_cell "$TITLE") | $(clean_cell "$WHERE") | $(clean_cell "${DEPS:-—}") | свободна | |"
  tmp="$(mktemp)"
  ROW_="$row" awk '
    { lines[NR] = $0; if ($0 ~ /^\|/ && !ended) { last = NR; started = 1 } else if (started) ended = 1 }
    END { for (i = 1; i <= NR; i++) { print lines[i]; if (i == last) print ENVIRON["ROW_"] } }
  ' "$FILE" > "$tmp" && cat "$tmp" > "$FILE" && rm -f "$tmp"
}

pull_quiet() { git pull --rebase --autostash -q origin "$BRANCH" 2>/dev/null || echo "(pull не прошёл — показываю локальную версию)" >&2; }

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

cmd="${1:-}"; shift || true
case "$cmd" in
  free)    pull_quiet; query free ;;
  status)  pull_quiet; query status ;;
  claim)   ID="${1:?ID задачи}"; NAME="${2:?Имя}"; edit_loop do_claim "claim $ID: $NAME"; echo "ЗАХВАЧЕНО: $ID — в работе: $NAME. Можно писать код." ;;
  done)    ID="${1:?ID задачи}"; NAME="${2:?Имя}"; NOTE="${3:-}"; edit_loop do_done "done $ID"; echo "ЗАКРЫТО: $ID — готово: $NAME" ;;
  block)   ID="${1:?ID задачи}"; NOTE="${2:?причина}"; edit_loop do_block "block $ID: $NOTE"; echo "БЛОК: $ID — $NOTE" ;;
  release) ID="${1:?ID задачи}"; edit_loop do_release "release $ID"; echo "ОСВОБОЖДЕНО: $ID" ;;
  add)     TITLE="${1:?текст задачи}"; WHERE="${2:?файлы/папки}"; DEPS="${3:-—}"; NEW_ID=""
           edit_loop do_add "add $TITLE"; echo "ДОБАВЛЕНО: $NEW_ID — $TITLE" ;;
  *)       usage ;;
esac
