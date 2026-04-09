@echo off
REM 自畵像 — 스테이지 테스트 후 자동 커밋 (Windows)
REM 사용법: scripts\stage_commit.bat A "긴 축어록 처리"

setlocal

set STAGE=%~1
set MSG=%~2

if "%STAGE%"=="" (
    echo 사용법: stage_commit.bat ^<STAGE^> ^<커밋 메시지^>
    echo 예시:   stage_commit.bat A "긴 축어록 처리"
    exit /b 1
)

if "%MSG%"=="" set MSG=Stage %STAGE%

cd /d "%~dp0.."

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   自畵像 Stage %STAGE% 테스트 시작
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REM 서버 실행
echo [1/3] 서버 시작...
start /b python server.py
timeout /t 3 /nobreak > nul

REM 테스트 실행
echo [2/3] 테스트 실행...
set TEST_FILES=tests/test_server.py
set UI_TEST=tests/test_ui_stage_%STAGE%.py
if exist "%UI_TEST%" set TEST_FILES=%TEST_FILES% %UI_TEST%

pytest %TEST_FILES% -v --tb=short
set TEST_RESULT=%ERRORLEVEL%

REM 서버 종료
echo [3/3] 서버 종료...
taskkill /f /im python.exe /fi "WINDOWTITLE eq server*" > nul 2>&1

echo.
if %TEST_RESULT%==0 (
    echo ✅ 테스트 통과 → 커밋합니다
    git add -A
    git commit -m "Add: %MSG% (Stage %STAGE%) - tests passing^

Co-Authored-By: Claude Sonnet 4.6 ^<noreply@anthropic.com^>"
    echo ✅ 커밋 완료
) else (
    echo ❌ 테스트 실패 → 커밋하지 않습니다
    exit /b 1
)
