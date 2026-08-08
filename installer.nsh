; 高 DPI 支持
ManifestDPIAware true

!include "WordFunc.nsh"

; 左下角品牌栏（替换默认的 Nullsoft 字样）
!macro customHeader
  BrandingText "CipherTalk · 密语"
!macroend

; 自定义欢迎页（默认 assisted 安装器没有欢迎页，直接进目录选择）
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 CipherTalk 密语"
  !define MUI_WELCOMEPAGE_TEXT "CipherTalk 是一款安全的本地聊天记录工具。$\r$\n$\r$\n数据完全存储在本地，隐私尽在掌握。$\r$\n$\r$\n点击「下一步」开始安装。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; 自定义完成页（文案 + 保留“运行 CipherTalk”勾选框）
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_RUN_TEXT "立即启动 CipherTalk"
  !define MUI_FINISHPAGE_TITLE "安装完成"
  !define MUI_FINISHPAGE_TEXT "CipherTalk 已成功安装到你的电脑。$\r$\n$\r$\n点击「完成」关闭向导，开始使用。"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInit
  ; 设置 DPI 感知
  System::Call 'USER32::SetProcessDPIAware()'
!macroend

; 在安装开始前修正安装目录
!macro preInit
  ; 如果安装目录不以 CipherTalk 结尾，自动追加
  ${WordFind} "$INSTDIR" "\" "-1" $R0
  ${If} $R0 != "CipherTalk"
    StrCpy $INSTDIR "$INSTDIR\CipherTalk"
  ${EndIf}
!macroend

; 安装完成后检测并安装 VC++ Redistributable
!macro customInstall
  IfSilent skipVC ; 如果是静默安装（外壳调用），则跳过内部检查，避免MessageBox阻塞
  
  ; 检查 VC++ 2015-2022 x64 是否已安装
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 != "1"
    ; 未安装，显示提示并下载
    MessageBox MB_YESNO|MB_ICONQUESTION "检测到系统缺少 Visual C++ 运行库，这可能导致程序无法正常运行。$\n$\n是否立即下载并安装？（约 24MB）" IDYES downloadVC IDNO skipVC
    
    downloadVC:
      DetailPrint "正在下载 Visual C++ Redistributable..."
      SetOutPath "$TEMP"
      ; 从微软官方下载 VC++ Redistributable x64
      inetc::get /TIMEOUT=30000 /CAPTION "下载 Visual C++ 运行库" /BANNER "正在下载，请稍候..." \
        "https://aka.ms/vs/17/release/vc_redist.x64.exe" "$TEMP\vc_redist.x64.exe" /END
      Pop $0
      ${If} $0 == "OK"
        DetailPrint "下载完成，正在安装..."
        ; 使用 ShellExecute 以管理员权限运行
        ExecShell "runas" '"$TEMP\vc_redist.x64.exe"' "/install /quiet /norestart" SW_HIDE
        ; 等待安装完成
        Sleep 5000
        ; 检查是否安装成功
        ReadRegStr $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
        ${If} $1 == "1"
          DetailPrint "Visual C++ Redistributable 安装成功"
          MessageBox MB_OK|MB_ICONINFORMATION "Visual C++ 运行库安装成功！"
        ${Else}
          MessageBox MB_OK|MB_ICONEXCLAMATION "Visual C++ 运行库安装失败，您可能需要手动安装。"
        ${EndIf}
        Delete "$TEMP\vc_redist.x64.exe"
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "下载失败：$0$\n$\n您可以稍后手动下载安装 Visual C++ Redistributable。"
      ${EndIf}
      Goto doneVC
    
    skipVC:
      DetailPrint "用户跳过 Visual C++ Redistributable 安装"
    
    doneVC:
  ${Else}
    DetailPrint "Visual C++ Redistributable 已安装"
  ${EndIf}
!macroend
