#requires -Version 5.1
<#
  组装随包 OCR 运行时：便携 Python + MinerU venv + pipeline 模型。
  产物在 build/ocr，不提交 git；electron-builder 会把它复制到安装包的 resources/ocr。

  用法（在项目根目录）：
    powershell -ExecutionPolicy Bypass -File scripts\build-ocr-runtime.ps1
    powershell -ExecutionPolicy Bypass -File scripts\build-ocr-runtime.ps1 -PythonBase "C:\...\Python313" -MineruHome "C:\...\.venvs\mineru"
#>
param(
  [string]$PythonBase = "",
  [string]$MineruHome = (Join-Path $HOME ".venvs\mineru"),
  [string]$ModelSource = (Join-Path $HOME ".cache\modelscope\models\OpenDataLab--PDF-Extract-Kit-1.0\snapshots\master"),
  [string]$Target = (Join-Path (Get-Location) "build\ocr")
)

$ErrorActionPreference = "Stop"

if (-not $PythonBase) {
  $PythonBase = & py -3.13 -c "import sys; print(sys.base_prefix)" 2>$null
}
if (-not $PythonBase -or -not (Test-Path (Join-Path $PythonBase "python.exe"))) {
  throw "找不到 Python 3.13 基础安装。请用 -PythonBase 指定（需与 MinerU venv 同版本）。"
}
if (-not (Test-Path (Join-Path $MineruHome "Scripts\python.exe"))) {
  throw "找不到 MinerU venv：$MineruHome"
}
if (-not (Test-Path $ModelSource)) {
  throw "找不到 PDF-Extract-Kit 模型目录：$ModelSource"
}

Write-Host "Python : $PythonBase"
Write-Host "MinerU : $MineruHome"
Write-Host "Models : $ModelSource"
Write-Host "Target : $Target"

if (Test-Path $Target) {
  Remove-Item -Recurse -Force $Target
}
New-Item -ItemType Directory -Force -Path $Target | Out-Null

function Copy-Tree([string]$From, [string]$To) {
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  & robocopy $From $To /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "复制失败（$LASTEXITCODE）：$From -> $To" }
}

Copy-Tree $PythonBase (Join-Path $Target "python")
Copy-Tree $MineruHome (Join-Path $Target "venv")
Copy-Tree $ModelSource (Join-Path $Target "models\pipeline")

# venv 里的 pyvenv.cfg 记录构建机路径；桌面壳启动时会改写成实际安装路径，
# 这里先写一个明确的占位，避免把构建机用户名带进安装包。
$cfg = Join-Path $Target "venv\pyvenv.cfg"
if (Test-Path $cfg) {
  @(
    "home = <INSTALL>\resources\ocr\python"
    "include-system-site-packages = false"
    "version = 3.13.15"
    "executable = <INSTALL>\resources\ocr\python\python.exe"
  ) | Set-Content -Encoding ASCII $cfg
}

# 许可清单
$licenses = Join-Path $Target "licenses"
New-Item -ItemType Directory -Force -Path $licenses | Out-Null
$pythonLicense = Join-Path $PythonBase "LICENSE.txt"
if (Test-Path $pythonLicense) { Copy-Item $pythonLicense (Join-Path $licenses "PYTHON-LICENSE.txt") -Force }
Get-ChildItem (Join-Path $MineruHome "Lib\site-packages") -Filter "mineru*.dist-info" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  Get-ChildItem $_.FullName -Filter "LICENSE*" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $licenses ("MINERU-" + $_.Name)) -Force
  }
}
Get-ChildItem $ModelSource -Recurse -Depth 2 -Include "LICENSE*","README*" -File -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $licenses ("MODEL-" + $_.Name)) -Force
}
@"
随包 OCR 运行时
- Python: 3.13.15（基础安装）
- MinerU: 3.4.5
- 模型: PDF-Extract-Kit-1.0（pipeline）
- 页图渲染: pypdfium2
发布前按 docs/HANDOVER.md 逐项归档版本与许可证。
"@ | Set-Content -Encoding UTF8 (Join-Path $licenses "README.txt")

$size = (Get-ChildItem $Target -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1GB
Write-Host ("完成：{0}（{1:N2} GB）" -f $Target, $size)
