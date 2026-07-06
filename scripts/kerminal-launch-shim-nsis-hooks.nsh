; @author kongweiguang
;
; Keep the external launch shim replaceable on same-version reinstalls and
; uninstall it from the user-visible Kerminal installation directory.

!macro NSIS_HOOK_PREINSTALL
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim.exe"
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim-sidecar.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\kerminal-launch-shim-sidecar.exe" 0 +2
    CopyFiles /SILENT "$INSTDIR\kerminal-launch-shim-sidecar.exe" "$INSTDIR\kerminal-launch-shim.exe"
  IfFileExists "$INSTDIR\kerminal-launch-shim.exe" 0 +2
    Goto +2
  MessageBox MB_ICONEXCLAMATION|MB_OK "Kerminal launch shim was not installed. Rebuild with npm run prepare:launch-shim-sidecar before packaging."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim.exe"
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim-sidecar.exe"
!macroend
