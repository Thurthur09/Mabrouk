# Découpe les 6 avatars de design/avatars-source.jpg vers client/public/avatars/1..6.jpg
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile("$root\design\avatars-source.jpg")
$sx = $src.Width / 595.0
$sy = $src.Height / 446.0
$boxes = @(
  @(32, 22, 198, 214), @(224, 22, 390, 214), @(415, 22, 580, 214),
  @(32, 240, 198, 431), @(224, 240, 390, 431), @(415, 240, 580, 431)
)
$i = 1
foreach ($b in $boxes) {
  $x = [int]($b[0] * $sx); $y = [int]($b[1] * $sy)
  $w = [int](($b[2] - $b[0]) * $sx); $h = [int](($b[3] - $b[1]) * $sy)
  $side = [Math]::Min($w, $h)
  $cx = $x + [int](($w - $side) / 2); $cy = $y + [int](($h - $side) / 2)
  $bmp = New-Object System.Drawing.Bitmap 256, 256
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $dst = New-Object System.Drawing.Rectangle 0, 0, 256, 256
  $rect = New-Object System.Drawing.Rectangle $cx, $cy, $side, $side
  $g.DrawImage($src, $dst, $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $bmp.Save("$root\client\public\avatars\$i.jpg", [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose(); $bmp.Dispose(); $i++
}
$src.Dispose()
