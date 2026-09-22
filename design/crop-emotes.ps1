# Découpe les 12 stickers d'astronaute de design/emotes-source.png (grille 6x2)
# vers client/public/emotes/1..12.png
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile("$root\design\emotes-source.png")
$cols = 6
$rows = 2
$cellW = $src.Width / $cols
$cellH = $src.Height / $rows
$pad = 3
$outW = 160
$outH = 140
$i = 1
for ($r = 0; $r -lt $rows; $r++) {
  for ($c = 0; $c -lt $cols; $c++) {
    $x = [int]($c * $cellW) + $pad
    $y = [int]($r * $cellH) + $pad
    $w = [int]($cellW) - 2 * $pad
    $h = [int]($cellH) - 2 * $pad
    $bmp = New-Object System.Drawing.Bitmap $outW, $outH
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $dst = New-Object System.Drawing.Rectangle 0, 0, $outW, $outH
    $rect = New-Object System.Drawing.Rectangle $x, $y, $w, $h
    $g.DrawImage($src, $dst, $rect, [System.Drawing.GraphicsUnit]::Pixel)
    $bmp.Save("$root\client\public\emotes\$i.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $i++
  }
}
$src.Dispose()
