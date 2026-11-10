# Builds arbeitspferd.ico: an orange spark on a dark warm tile with a small "2" for the second account.
# Run with Windows PowerShell (System.Drawing). Writes arbeitspferd.ico and arbeitspferd-preview.png next to it.
Add-Type -AssemblyName System.Drawing
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$orange = [Drawing.Color]::FromArgb(217, 119, 87)
$dark = [Drawing.Color]::FromArgb(31, 30, 29)
$cream = [Drawing.Color]::FromArgb(250, 249, 245)

function New-Tile([int]$size) {
    $bmp = New-Object Drawing.Bitmap $size, $size
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([Drawing.Color]::Transparent)
    # Rounded dark tile
    $r = [int]($size * 0.22)
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $size - $r - 1, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath((New-Object Drawing.SolidBrush $dark), $path)
    # Spark: 12 tapered rays around the centre
    $cx = $size * 0.46; $cy = $size * 0.50; $outer = $size * 0.34; $inner = $size * 0.07; $half = 0.13
    $brush = New-Object Drawing.SolidBrush $orange
    for ($i = 0; $i -lt 12; $i++) {
        $a = [Math]::PI * 2 * $i / 12
        $len = if ($i % 2) { $outer * 0.78 } else { $outer }
        $pts = [Drawing.PointF[]]@(
            (New-Object Drawing.PointF ($cx + $inner * [Math]::Cos($a - $half * 2)), ($cy + $inner * [Math]::Sin($a - $half * 2))),
            (New-Object Drawing.PointF ($cx + $len * [Math]::Cos($a)), ($cy + $len * [Math]::Sin($a))),
            (New-Object Drawing.PointF ($cx + $inner * [Math]::Cos($a + $half * 2)), ($cy + $inner * [Math]::Sin($a + $half * 2))))
        $g.FillPolygon($brush, $pts)
    }
    $g.FillEllipse($brush, $cx - $inner * 1.3, $cy - $inner * 1.3, $inner * 2.6, $inner * 2.6)
    # Badge "2" bottom right
    if ($size -ge 24) {
        $b = $size * 0.36
        $g.FillEllipse((New-Object Drawing.SolidBrush $cream), $size - $b - $size * 0.04, $size - $b - $size * 0.04, $b, $b)
        $font = New-Object Drawing.Font 'Segoe UI', ($b * 0.62), ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
        $fmt = New-Object Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
        $rect = New-Object Drawing.RectangleF ($size - $b - $size * 0.04), ($size - $b - $size * 0.04 + $b * 0.03), $b, $b
        $g.DrawString('2', $font, (New-Object Drawing.SolidBrush $dark), $rect, $fmt)
    }
    $g.Dispose()
    return $bmp
}

# ICO with PNG-compressed frames
$sizes = 16, 24, 32, 48, 64, 128, 256
$frames = foreach ($s in $sizes) { $ms = New-Object IO.MemoryStream; (New-Tile $s).Save($ms, [Drawing.Imaging.ImageFormat]::Png); , $ms.ToArray() }
$out = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $len = $frames[$i].Length
    $w.Write([byte]($s % 256)); $w.Write([byte]($s % 256)); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$len); $w.Write([uint32]$offset)
    $offset += $len
}
foreach ($f in $frames) { $w.Write($f) }
[IO.File]::WriteAllBytes("$dir\arbeitspferd.ico", $out.ToArray())
(New-Tile 256).Save("$dir\arbeitspferd-preview.png", [Drawing.Imaging.ImageFormat]::Png)
"Icon geschrieben: $dir\arbeitspferd.ico"
