cd "%~dp0cil-core"
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe" "%~dp0\cil-core\.\index.js" %*
) ELSE (
  node "%~dp0\cil-core\.\index.js" %*
)
pause