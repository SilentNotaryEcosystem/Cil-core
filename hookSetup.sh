#!/bin/sh
# ./hook_setup.sh
set -e

HERE=$(realpath $(dirname "$0"))
GITDIR="$HERE/.git"
HOOKDIR="$GITDIR/hooks"
HUSKY_HOOKS="$HERE/.husky"

for F in `ls "$HUSKY_HOOKS"`; do
    P="$HUSKY_HOOKS/$F"
    if [ -f "$P" ] ; then
        HOOK_FILE="$HOOKDIR/$F"
        echo "#!/bin/sh" > "$HOOK_FILE"
        echo "sh \"$P\"" >> "$HOOK_FILE"
        chmod +x "$HOOK_FILE"
    fi
done
