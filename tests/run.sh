#!/usr/bin/env bash
# Pure-Lua / Node test suite for the comment validation work.
# No OpenResty or MariaDB required.
set -u
cd "$(dirname "$0")/.."

fail=0
run() {
    echo "----- $* -----"
    if ! "$@"; then fail=1; fi
    echo
}

run lua tests/lua/test_comment_validation.lua
run lua tests/lua/test_comments_api.lua
run lua tests/lua/test_comments_datalayer.lua

if command -v node >/dev/null 2>&1; then
    run node tests/js/test_comment_validation.mjs
else
    echo "node not found, skipping tests/js"
fi

if [ "$fail" -eq 0 ]; then
    echo "ALL TESTS PASSED"
else
    echo "SOME TESTS FAILED"
fi
exit "$fail"
