# Generates NSIS installer bitmaps (sidebar + header) from public/logo.png.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-installer-assets.ps1
# ASCII-only on purpose: PS 5.1 misreads BOM-less UTF-8, so CJK text is built from codepoints.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path $root 'public\logo.png'
$outDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$logo = [System.Drawing.Image]::FromFile($logoPath)
# 'MiYu' (CJK) built from codepoints to keep this file ASCII-safe
$miyu = -join ([char]0x5BC6, [char]0x8BED)

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.InterpolationMode = 'HighQualityBicubic'
  return $bmp, $g
}

function Draw-Background($g, [int]$w, [int]$h) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 20, 18, 43),
    [System.Drawing.Color]::FromArgb(255, 76, 56, 122),
    90.0)
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()
  # soft glow blobs for a glassy feel
  $glow1 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 255, 255, 255))
  $glow2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 168, 130, 255))
  $g.FillEllipse($glow1, ($w * -0.35), ($h * -0.12), ($w * 1.1), ($w * 1.1))
  $g.FillEllipse($glow2, ($w * 0.35), ($h * 0.62), ($w * 1.2), ($w * 1.2))
  $glow1.Dispose(); $glow2.Dispose()
}

function Draw-LogoTile($g, [int]$x, [int]$y, [int]$size) {
  $radius = [int]($size * 0.22)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $size - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $size - $d, $y + $size - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $state = $g.Save()
  $g.SetClip($path)
  $g.DrawImage($logo, $x, $y, $size, $size)
  $g.Restore($state)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 255, 255, 255), 2)
  $g.DrawPath($pen, $path)
  $pen.Dispose(); $path.Dispose()
}

function Save-Bmp24($bmp, [string]$path) {
  # NSIS is happiest with 24bpp BMP
  $out = New-Object System.Drawing.Bitmap($bmp.Width, $bmp.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
  $g.Dispose()
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $out.Dispose()
}

$white = [System.Drawing.Brushes]::White
$center = New-Object System.Drawing.StringFormat
$center.Alignment = 'Center'

# ---- Sidebar: shown at 164x314, rendered 2x for high-DPI sharpness ----
$w = 328; $h = 628
$bmp, $g = New-Canvas $w $h
Draw-Background $g $w $h
$tile = 148
Draw-LogoTile $g ([int](($w - $tile) / 2)) 128 $tile
$fontName = New-Object System.Drawing.Font('Segoe UI', 34, [System.Drawing.FontStyle]::Bold)
$fontCjk = New-Object System.Drawing.Font('Microsoft YaHei UI', 22, [System.Drawing.FontStyle]::Regular)
$dim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(190, 255, 255, 255))
$g.DrawString('CipherTalk', $fontName, $white, ($w / 2), 320, $center)
$g.DrawString($miyu, $fontCjk, $dim, ($w / 2), 390, $center)
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 168, 130, 255))
$g.FillRectangle($accent, (($w - 56) / 2), 456, 56, 5)
$accent.Dispose()
Save-Bmp24 $bmp (Join-Path $outDir 'installerSidebar.bmp')
$g.Dispose(); $bmp.Dispose()

# ---- Header: shown at 150x57, rendered 2x ----
$w = 300; $h = 114
$bmp, $g = New-Canvas $w $h
Draw-Background $g $w $h
Draw-LogoTile $g 22 21 72
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
$g.DrawString('CipherTalk', $fontSmall, $white, 110, 36)
Save-Bmp24 $bmp (Join-Path $outDir 'installerHeader.bmp')
$g.Dispose(); $bmp.Dispose()

$logo.Dispose()
$fontName.Dispose(); $fontCjk.Dispose(); $fontSmall.Dispose(); $dim.Dispose()
Write-Host "Done: $outDir\installerSidebar.bmp, installerHeader.bmp"
