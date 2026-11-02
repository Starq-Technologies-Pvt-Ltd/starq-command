@echo off
setlocal
rem STARQ // COMMAND - one-click standalone daily-driver launch (command-local/v1).
rem Backs up the operating database, starts data+pm+ui (building if available),
rem and opens the Founder interface. No Hermes, Herdr, Room broker or WSL needed.
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "%~dp0scripts\command-local-start.ps1"
exit /b %ERRORLEVEL%
