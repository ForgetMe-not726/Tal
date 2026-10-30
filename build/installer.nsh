; 卸载时保留安装目录下的 document 工作区（教材、OCR、版本、导出）。
; 删除应用文件与随包资源，但不递归删除 $INSTDIR，避免把老师的数据一起删掉。
!macro customUnInstall
  IfFileExists "$INSTDIR\document\*.*" 0 +3
  MessageBox MB_OK|MB_ICONINFORMATION "工作区 document 会保留在安装目录，不会被卸载程序删除。"
!macroend

!macro customRemoveFiles
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.*"
  ; document 还在时 RMDir 会失败，这是有意的：数据保留
  RMDir "$INSTDIR"
!macroend
