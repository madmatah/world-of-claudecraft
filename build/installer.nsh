; installer.nsh - electron-builder (NSIS) customization for World of ClaudeCraft.
;
; app-builder-lib auto-includes this file when it sits at build/installer.nsh
; (the directories.buildResources dir), and package.json's "nsis": { "include" }
; key pins the same path explicitly for reviewers. The include is compiled into
; the shared header used by BOTH the installer and the uninstaller, so the
; customUnInstall macro below is defined and run at uninstall time.
;
; Why this exists: electron/gpu_preference.cjs writes a per-app Windows GPU
; preference on every packaged launch, under
;   HKCU\Software\Microsoft\DirectX\UserGpuPreferences
; as a value NAMED by this app's installed exe path ("$INSTDIR\<exe>"), with data
; GpuPreference=2 (force the discrete GPU). Nothing else removes that value, so
; without this hook an uninstall would leave a dangling per-user entry: it keeps
; steering a now-deleted exe path and lingers in
; Settings > System > Display > Graphics. The uninstaller deletes just that one
; VALUE, never the key. The key is machine-wide and also holds other apps' values
; plus the user's global DirectXUserGlobalSettings value, so deleting the key
; would clobber unrelated settings.
;
; Guarded by ${ifNot} ${isUpdated}: an auto-update reruns the old version's
; uninstaller, and removing the preference there would make the Graphics entry
; flicker off and back on across every update. The value name (the install path)
; is stable across updates, so leaving it in place on update is correct; it is
; removed only on a real uninstall.
;
; Scope: the website NSIS channel only. The Steam "dir" depots ship with no
; uninstaller hook, so a Steam uninstall leaves the value as an accepted, harmless
; per-user orphan (see docs/desktop-release.md).
;
; The key string here mirrors USER_GPU_PREFERENCES_KEY in
; electron/gpu_preference.cjs; tests/desktop_uninstall_cleanup.test.ts pins the
; two together so the write and the delete can never drift apart silently.

; The "WoC config detector" Start-menu shortcut: the same exe with the
; --test-backends flag, which runs the GPU backend probe (src/probe/,
; electron/backend_probe_parent.cjs) instead of the game. A PRODUCT NAME kept
; identical in every language, like "World of ClaudeCraft" itself, so it is a
; literal here and no i18n gate applies. Website NSIS channel only (the Steam
; depot gets a launch type instead, docs/desktop-release.md). Deleted on a
; real uninstall under the same isUpdated guard as the registry value: an
; auto-update reruns the old uninstaller, and the shortcut must survive it.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\WoC config detector.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--test-backends"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\DirectX\UserGpuPreferences" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Delete "$SMPROGRAMS\WoC config detector.lnk"
  ${endif}
!macroend
