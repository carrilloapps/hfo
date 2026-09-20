#!/usr/bin/env bash
#
# Full local security + quality sweep, everything through Docker so the only
# host requirement is a working daemon.
#
#   ./scripts/security-scan.sh              # semgrep, trivy, gitleaks
#   ./scripts/security-scan.sh --with-sonar # also SonarQube Community
#   ./scripts/security-scan.sh --sonar-only
#   ./scripts/security-scan.sh --stop-sonar # tear the server back down
#
# Reports land in .security/ (gitignored). Exits non-zero if any scanner
# reports a finding, so it drops straight into CI or a pre-release gate.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.security"
mkdir -p "$OUT"

# Docker on Windows wants a drive-letter path; Git Bash hands us /c/... .
if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then
  MOUNT="$(cygpath -w "$ROOT")"
  export MSYS_NO_PATHCONV=1
else
  MOUNT="$ROOT"
fi

SEMGREP_IMAGE="semgrep/semgrep:latest"
TRIVY_IMAGE="aquasec/trivy:latest"
GITLEAKS_IMAGE="zricethezav/gitleaks:latest"
SONAR_SCANNER_IMAGE="sonarsource/sonar-scanner-cli:latest"
SONAR_SERVER_IMAGE="sonarqube:community"
SONAR_CONTAINER="hfo-sonarqube"
SONAR_URL="http://localhost:9000"

FAILED=()
RAN=()

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32mOK %s\033[0m\n' "$1"; }
bad()  { printf '\033[1;31mXX %s\033[0m\n' "$1"; }

run_semgrep() {
  log "semgrep — static analysis (p/default + security audit + typescript)"
  docker run --rm -v "$MOUNT:/src" -w /src "$SEMGREP_IMAGE" \
    semgrep scan \
      --config=p/default \
      --config=p/security-audit \
      --config=p/secrets \
      --config=p/typescript \
      --config=p/javascript \
      --error \
      --json-output=/src/.security/semgrep.json \
      --sarif-output=/src/.security/semgrep.sarif \
      --metrics=off \
      --exclude=node_modules --exclude=dist --exclude=coverage --exclude=.security
  local rc=$?
  RAN+=("semgrep")
  if [[ $rc -ne 0 ]]; then FAILED+=("semgrep"); bad "semgrep found issues (rc=$rc)"; else ok "semgrep clean"; fi
}

run_trivy() {
  log "trivy — dependency CVEs, misconfig, secrets, licenses"
  docker run --rm -v "$MOUNT:/src" -w /src "$TRIVY_IMAGE" \
    fs /src \
      --scanners vuln,misconfig,secret \
      --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
      --exit-code 1 \
      --no-progress \
      --timeout 20m --skip-dirs node_modules --skip-dirs dist --skip-dirs dist-bin --skip-dirs coverage --skip-dirs .security --skip-dirs .git --skip-dirs .scannerwork \
      --format table
  local rc=$?
  # Second pass purely to persist a machine-readable report.
  docker run --rm -v "$MOUNT:/src" -w /src "$TRIVY_IMAGE" \
    fs /src --scanners vuln,misconfig,secret --no-progress \
      --timeout 20m --skip-dirs node_modules --skip-dirs dist --skip-dirs dist-bin --skip-dirs coverage --skip-dirs .security --skip-dirs .git --skip-dirs .scannerwork \
      --format json --output /src/.security/trivy.json >/dev/null 2>&1
  RAN+=("trivy")
  if [[ $rc -ne 0 ]]; then FAILED+=("trivy"); bad "trivy found issues (rc=$rc)"; else ok "trivy clean"; fi
}

run_gitleaks() {
  log "gitleaks — secrets in the working tree and full git history"
  docker run --rm -v "$MOUNT:/src" -w /src "$GITLEAKS_IMAGE" \
    dir /src \
      --report-format sarif \
      --report-path /src/.security/gitleaks.sarif \
      --redact \
      --exit-code 1 \
      --log-level warn
  local rc=$?
  RAN+=("gitleaks")
  if [[ $rc -ne 0 ]]; then FAILED+=("gitleaks"); bad "gitleaks found secrets (rc=$rc)"; else ok "gitleaks clean"; fi
}

sonar_up() {
  if docker ps --format '{{.Names}}' | grep -qx "$SONAR_CONTAINER"; then
    ok "SonarQube already running"
    return 0
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$SONAR_CONTAINER"; then
    docker start "$SONAR_CONTAINER" >/dev/null
  else
    log "starting SonarQube Community (first run pulls ~700MB and takes a few minutes)"
    docker run -d --name "$SONAR_CONTAINER" \
      -p 9000:9000 \
      -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
      "$SONAR_SERVER_IMAGE" >/dev/null
  fi

  printf 'waiting for SonarQube to report UP'
  for _ in $(seq 1 120); do
    local status
    status="$(curl -fsS "$SONAR_URL/api/system/status" 2>/dev/null | sed -n 's/.*"status":"\([A-Z]*\)".*/\1/p')"
    if [[ "$status" == "UP" ]]; then printf '\n'; ok "SonarQube is UP"; return 0; fi
    printf '.'; sleep 5
  done
  printf '\n'; bad "SonarQube did not come up in time"; return 1
}

run_sonar() {
  sonar_up || { FAILED+=("sonarqube"); RAN+=("sonarqube"); return; }

  # SonarQube Community 26.x no longer ships usable default credentials: the
  # admin account has to be bootstrapped once through the web UI before the
  # API will mint a token. That is a one-time human step per server, so the
  # script takes the token from the environment and tells the user how to get
  # one rather than pretending it can log in.
  local token="${SONAR_TOKEN:-}"
  if [[ -z "$token" ]]; then
    warn "SONAR_TOKEN is not set."
    cat <<EOF

  SonarQube is running at $SONAR_URL but needs a one-time setup:

    1. Open $SONAR_URL and sign in (the server will prompt you to create
       the admin password on first visit).
    2. My Account -> Security -> Generate a token.
    3. Re-run with it exported:

         SONAR_TOKEN=<token> ./scripts/security-scan.sh --sonar-only

EOF
    FAILED+=("sonarqube (no token)"); RAN+=("sonarqube"); return
  fi

  # Coverage has to exist before the scanner reads sonar.javascript.lcov.reportPaths.
  [[ -f "$ROOT/coverage/lcov.info" ]] || warn "coverage/lcov.info missing — run 'pnpm test:coverage' for coverage in Sonar"

  log "sonar-scanner — pushing analysis to $SONAR_URL"
  docker run --rm --network host \
    -v "$MOUNT:/usr/src" \
    -e SONAR_HOST_URL="$SONAR_URL" \
    -e SONAR_TOKEN="$token" \
    "$SONAR_SCANNER_IMAGE"
  local rc=$?
  RAN+=("sonarqube")
  if [[ $rc -ne 0 ]]; then FAILED+=("sonarqube"); bad "sonar-scanner failed (rc=$rc)"; return; fi

  # Poll the quality gate rather than trusting the scanner's exit code.
  sleep 10
  local gate
  gate="$(curl -fsS -H "Authorization: Bearer $token" \
    "$SONAR_URL/api/qualitygates/project_status?projectKey=hfo-cli" \
    | sed -n 's/.*"status":"\([A-Z]*\)".*/\1/p' | head -1)"
  echo "quality gate: ${gate:-unknown}"
  if [[ "$gate" != "OK" ]]; then FAILED+=("sonarqube quality gate"); bad "quality gate ${gate:-unknown}"; else ok "quality gate OK"; fi
  echo "Browse the full report at $SONAR_URL"
}

case "${1:-}" in
  --stop-sonar) docker rm -f "$SONAR_CONTAINER" >/dev/null 2>&1 && ok "SonarQube removed"; exit 0 ;;
  --sonar-only) run_sonar ;;
  --with-sonar) run_semgrep; run_trivy; run_gitleaks; run_sonar ;;
  "")           run_semgrep; run_trivy; run_gitleaks ;;
  *)            echo "unknown flag: $1"; exit 2 ;;
esac

log "summary"
echo "ran:    ${RAN[*]:-none}"
if [[ ${#FAILED[@]} -eq 0 ]]; then
  ok "all scanners clean — reports in .security/"
  exit 0
fi
bad "issues from: ${FAILED[*]}"
echo "reports in .security/"
exit 1
