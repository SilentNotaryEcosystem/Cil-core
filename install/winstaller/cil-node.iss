#define CompanyName "Silent Notary"
#define MyAppName "Silent Notary Net"
#define GenerateWalletName "Generate Wallet"
#define MyAppShortName "SilentNotary"
#define MyAppLCShortName "silentnotarynet"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Silent Notary"
#define MyAppURL "https://silentnotary.com/"
#define MyAppExeName "start-server.bat"
#define GenerateWalletExeName "generate-wallet.bat"

#define MyAppIcon "silentnotary.ico"

#define NODE "node-v10.15.3-x64.msi"


[Setup]
AppId={{A43FBD15-F47B-4B39-88DD-88DD67910D11}
AppName={#CompanyName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName=C:\{#MyAppShortName}
DisableDirPage=yes
DefaultGroupName={#CompanyName}
DisableProgramGroupPage=no
OutputDir=c:\_
OutputBaseFilename={#MyAppShortName}Setup
SetupIconFile=C:\_\core\winstaller\silentnotary.ico
Compression=lzma
SolidCompression=yes


[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 6.1; Check: not IsAdminInstallMode


[Files]
Source: "C:\_\core\winstaller\start-server.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "C:\_\core\winstaller\generate-wallet.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "C:\_\core\winstaller\{#NODE}"; DestDir: "{app}"; Flags: ignoreversion
Source: "C:\_\core\cil-core\*"; DestDir: "{app}\cil-core"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "C:\_\core\cil-utils\*"; DestDir: "{app}\cil-utils"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "C:\_\core\winstaller\silentnotary.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppIcon}"
Name: "{autodesktop}\Silent Notary\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppIcon}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppIcon}"; Tasks: quicklaunchicon

Name: "{autoprograms}\{#GenerateWalletName}"; Filename: "{app}\{#GenerateWalletExeName}"; IconFilename: "{app}\{#MyAppIcon}"
Name: "{autodesktop}\Silent Notary\{#GenerateWalletName}"; Filename: "{app}\{#GenerateWalletExeName}"; IconFilename: "{app}\{#MyAppIcon}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#GenerateWalletName}"; Filename: "{app}\{#GenerateWalletExeName}"; IconFilename: "{app}\{#MyAppIcon}"; Tasks: quicklaunchicon


[Run]
Filename: "{sys}\msiexec.exe"; Parameters: "/passive /i ""{app}\{#NODE}""";

; Add Firewall Rules
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Node In"" program=""{pf64}\nodejs\node.exe"" dir=in action=allow enable=yes"; Flags: runhidden;
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Node Out"" program=""{pf64}\nodejs\node.exe"" dir=out action=allow enable=yes"; Flags: runhidden;

