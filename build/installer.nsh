; Amethyst Launcher - NSIS Installer Customization
; This file is included in the electron-builder NSIS installer
; It adds custom options for taskbar pinning and desktop shortcuts

!macro customHeader
  ; Ensure we have the plugins we need
  !include "x64.nsh"
!macroend

; Modify the welcome page text
!macro customWelcomePage
  !ifdef MUI_WELCOMEPAGE
    !define MUI_WELCOMEPAGE_TITLE "Welcome to Amethyst Launcher Setup"
    !define MUI_WELCOMEPAGE_TEXT "Amethyst is a dark purple vanilla Minecraft launcher.$\r$\n$\r$\nThis wizard will guide you through the installation. You can choose the install location, create desktop shortcuts, and pin Amethyst to your taskbar.$\r$\n$\r$\nClick Next to continue."
  !endif
!macroend

; Custom finish page with launch option
!macro customFinishPage
  !ifdef MUI_FINISHPAGE
    !define MUI_FINISHPAGE_RUN_TEXT "Launch Amethyst Launcher now"
    !define MUI_FINISHPAGE_RUN "$INSTDIR\Amethyst Launcher.exe"
  !endif
!macroend

; Post-install: create additional shortcuts
!macro customInstall
  ; Create desktop shortcut
  CreateShortcut "$DESKTOP\Amethyst Launcher.lnk" "$INSTDIR\Amethyst Launcher.exe" "" "$INSTDIR\Amethyst Launcher.exe" 0
  
  ; Start Menu shortcut in Games folder
  CreateDirectory "$SMPROGRAMS\Games"
  CreateShortcut "$SMPROGRAMS\Games\Amethyst Launcher.lnk" "$INSTDIR\Amethyst Launcher.exe" "" "$INSTDIR\Amethyst Launcher.exe" 0
  CreateShortcut "$SMPROGRAMS\Games\Uninstall Amethyst.lnk" "$INSTDIR\Uninstall Amethyst Launcher.exe" "" "$INSTDIR\Uninstall Amethyst Launcher.exe" 0
!macroend

; Uninstall: clean up shortcuts and taskbar pin
!macro customUnInstall
  ; Remove desktop shortcut
  Delete "$DESKTOP\Amethyst Launcher.lnk"
  
  ; Remove start menu shortcuts
  Delete "$SMPROGRAMS\Games\Amethyst Launcher.lnk"
  Delete "$SMPROGRAMS\Games\Uninstall Amethyst.lnk"
  
  ; Try to remove taskbar pin
  nsExec::ExecToLog 'powershell -Command "try { $shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace($INSTDIR); $item = $folder.ParseName(\"Amethyst Launcher.exe\"); $item.InvokeVerb(\"unpinfromtaskbar\") } catch { }"'
!macroend
