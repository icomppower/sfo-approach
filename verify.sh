#!/usr/bin/env bash
# Runs the gates in gates/gates.json with the Harbor Engine gate runner.
#   ./verify.sh            all gates
#   ./verify.sh g1         just those
cd "$(dirname "$0")" && exec node_modules/harbor-engine/gates/verify.sh "$@"
