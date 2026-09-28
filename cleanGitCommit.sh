#!/usr/bin/env bash
# Folds the unpushed local commits into one clean commit without any file
# larger than 50 MB, then pushes. Run from anywhere inside the repository.
#
#   ./cleanGitCommit.sh                         # full run, keeps datasets_sources/ in git (sharded)
#   ./cleanGitCommit.sh --ignore-sources        # full run, stops tracking datasets_sources/ (files stay on disk)
#   ./cleanGitCommit.sh --continue [--ignore-sources]  # resume from step 4 after an interrupted run
#   ./cleanGitCommit.sh --rollback <backup>     # restore: git reset --hard to the backup branch
#                                               #   and restore the working tree from the backup copy
#
# A full run does:
#   1. backup: a copy of the working tree (without models/ and node_modules/) next to the repo, plus a backup branch
#   2. check: no file over 50 MB on disk
#   3. reset: git fetch + git reset --soft origin/main (the working tree is not touched)
#   4. rebuild the index from the working tree
#   5. check: nothing staged over 50 MB
#   6. one commit
#   7. push after confirmation
set -euo pipefail

LIMIT=50000000
MESSAGE="Sharded large data files, one model language, regenerated corpora"
ROOT="$(git rev-parse --show-toplevel)"
NAME="$(basename "$ROOT")"
cd "$ROOT"

if [ "${1:-}" = "--rollback" ]; then
  BACKUP="${2:?usage: $0 --rollback <backup-name>}"
  COPY="$(dirname "$ROOT")/$BACKUP"
  echo "== Rollback to branch $BACKUP"
  git reset --hard "$BACKUP"
  if [ -d "$COPY" ]; then
    echo "== Restoring working tree from $COPY (models/ and node_modules/ are left as they are)"
    rsync -a --delete --exclude .git --exclude models --exclude node_modules "$COPY/" "$ROOT/"
  else
    echo "   No copy found at $COPY; only the git state was restored."
  fi
  echo "Rollback done."
  exit 0
fi

IGNORE_SOURCES=0
CONTINUE=0
for arg in "$@"; do
  [ "$arg" = "--ignore-sources" ] && IGNORE_SOURCES=1
  [ "$arg" = "--continue" ] && CONTINUE=1
done

if [ $CONTINUE -eq 0 ]; then
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="backup-before-clean-$STAMP"
COPY="$(dirname "$ROOT")/$BACKUP"

echo "== 1. Backup"
git branch "$BACKUP"
echo "   branch $BACKUP at $(git rev-parse --short HEAD)"
echo "   copying working tree to $COPY (without models/ and node_modules/) ..."
rsync -a --exclude models --exclude node_modules "$ROOT/" "$COPY/"
echo "   copy done: $(du -sh "$COPY" | cut -f1)"

echo "== 2. No file over 50 MB on disk"
if [ -f tools/shard-large-files.mjs ]; then
  node tools/shard-large-files.mjs --check
else
  big=$(git ls-files -co --exclude-standard -z | xargs -0 -r stat -c '%s %n' 2>/dev/null | awk -v l=$LIMIT '$1>l')
  if [ -n "$big" ]; then echo "Files over 50 MB:"; echo "$big"; exit 1; fi
fi

echo "== 3. Fetch and reset the unpushed local commits (git reset --soft; working tree untouched)"
git fetch origin
AHEAD=$(git rev-list --count origin/main..HEAD)
echo "   $AHEAD local commit(s) will be folded into one"
git reset --soft origin/main

else
  echo "== Continuing from step 4 (backup and reset already done)"
  BACKUP="$(git branch --list 'backup-before-clean-*' --format='%(refname:short)' | sort | tail -1)"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "HEAD is not origin/main; run without --continue"; exit 1; }
  echo "   latest backup branch: $BACKUP"
fi

if [ $IGNORE_SOURCES -eq 1 ]; then
  echo "== 3b. Stop tracking datasets_sources/"
  grep -qxF "datasets_sources/" .gitignore || echo "datasets_sources/" >> .gitignore
fi

echo "== 4. Rebuild the index from the working tree"
git reset -q          # index := HEAD (origin/main); working tree untouched
git add -A

echo "== 5. Nothing staged over 50 MB"
fail=0
while read -r mode hash stage path; do
  size=$(git cat-file -s "$hash")
  if [ "$size" -gt $LIMIT ]; then echo "   TOO LARGE: $((size/1000000)) MB $path"; fail=1; fi
done < <(git ls-files -s)
if [ $fail -ne 0 ]; then
  echo "Aborting before commit. Restore with: $0 --rollback $BACKUP"
  exit 1
fi

echo "== 6. Commit"
git commit -q -m "$MESSAGE"
git --no-pager log --oneline -1
git --no-pager diff --stat origin/main..HEAD | tail -1

read -r -p "== 7. Push to origin/main now? [y/N] " answer
if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
  git push origin main
else
  echo "   Not pushed. Push later with: git push origin main"
fi
echo "Done. Rollback if needed: $0 --rollback $BACKUP"
