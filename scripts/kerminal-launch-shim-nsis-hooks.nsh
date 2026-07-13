; @author kongweiguang
;
; Keep the external launch shim replaceable on same-version reinstalls and
; upgrades, and remove both names during uninstall. Installation fails closed
; if the bundled sidecar cannot be materialized under the stable public name.

!macro NSIS_HOOK_PREINSTALL
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim.exe"
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim-sidecar.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\kerminal-launch-shim-sidecar.exe" +2 0
    Abort "Kerminal launch shim sidecar is missing from the installation package."
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\kerminal-launch-shim-sidecar.exe" "$INSTDIR\kerminal-launch-shim.exe"
  IfErrors 0 +2
    Abort "Kerminal launch shim could not be installed."
  IfFileExists "$INSTDIR\kerminal-launch-shim.exe" +2 0
    Abort "Kerminal launch shim installation could not be verified."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 仅清理由本次安装拥有的 opt-in 协议，不能删除后来被其它程序接管的关联。
  ReadRegStr $0 HKCU "Software\Classes\kerminal\shell\open\command" ""
  StrCmp $0 '$\"$INSTDIR\kerminal.exe$\" $\"%1$\"' 0 +2
    DeleteRegKey HKCU "Software\Classes\kerminal"
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim.exe"
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim-sidecar.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ReadRegStr $0 HKCU "Software\Classes\kerminal\shell\open\command" ""
  StrCmp $0 '$\"$INSTDIR\kerminal.exe$\" $\"%1$\"' 0 +2
    DeleteRegKey HKCU "Software\Classes\kerminal"
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim.exe"
  Delete /REBOOTOK "$INSTDIR\kerminal-launch-shim-sidecar.exe"
!macroend
