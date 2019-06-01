@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe" "%~dp0\cil-utils\.\generateWallet.js" %*
) ELSE (
  node "%~dp0\cil-utils\.\generateWallet.js" %*
)
pause