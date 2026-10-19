' Starts the English Learning Companion with one double-click (no black window).
' Uses the same mode as before (npm run dev), so all your data and settings stay the same.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Already open? Don't start a second copy.
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set running = wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name='electron.exe' AND CommandLine LIKE '%English learning tools%'")
If running.Count > 0 Then
  MsgBox "English Learning Companion is already open.", 64, "English Learning Companion"
  WScript.Quit
End If

sh.CurrentDirectory = appDir
sh.Run "cmd /c npm run dev > """ & appDir & "\launch-log.txt"" 2>&1", 0, False
