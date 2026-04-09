#!/bin/bash
# 自畵像 — 스테이지 테스트 후 자동 커밋
#
# 사용법:
#   ./scripts/stage_commit.sh A "긴 축어록 처리"
#   ./scripts/stage_commit.sh B "찾기 바꾸기 및 주석 버튼"
#
# 동작:
#   1. 서버 백그라운드 실행
#   2. pytest 실행 (서버 유닛 + 해당 스테이지 테스트)
#   3. 통과 → git commit / 실패 → 종료 (커밋 안 함)

set -e

STAGE="${1:-}"
MSG="${2:-Stage $STAGE}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$STAGE" ]; then
  echo "사용법: $0 <STAGE> <커밋 메시지>"
  echo "예시:   $0 A '긴 축어록 처리'"
  exit 1
fi

cd "$ROOT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  自畵像 Stage $STAGE 테스트 시작"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. 서버 실행 ──────────────────────────────
echo "[1/3] 서버 시작..."
python server.py &
SERVER_PID=$!

# 서버 준비 대기
for i in {1..10}; do
  if curl -s http://localhost:5000/login > /dev/null 2>&1; then
    echo "      서버 준비 완료 (PID: $SERVER_PID)"
    break
  fi
  sleep 1
done

# ── 2. 테스트 실행 ────────────────────────────
echo "[2/3] 테스트 실행..."

# 서버 유닛 테스트 항상 포함
# 스테이지별 UI 테스트 추가
TEST_FILES="tests/test_server.py"
UI_TEST="tests/test_ui_stage_$(echo $STAGE | tr '[:upper:]' '[:lower:]').py"
if [ -f "$UI_TEST" ]; then
  TEST_FILES="$TEST_FILES $UI_TEST"
fi

# 테스트 실행
pytest $TEST_FILES -v --tb=short 2>&1
TEST_RESULT=$?

# ── 3. 서버 종료 ──────────────────────────────
echo "[3/3] 서버 종료..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# ── 결과 ─────────────────────────────────────
echo ""
if [ $TEST_RESULT -eq 0 ]; then
  echo "✅ 테스트 통과 → 커밋합니다"
  echo ""
  git add -A
  git commit -m "$(cat <<EOF
Add: $MSG (Stage $STAGE)

- 테스트 통과 확인 후 자동 커밋
- 테스트: $TEST_FILES

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
  echo ""
  echo "✅ 커밋 완료"
else
  echo "❌ 테스트 실패 → 커밋하지 않습니다"
  echo "   pytest 출력을 확인하고 수정 후 다시 실행하세요."
  exit 1
fi
