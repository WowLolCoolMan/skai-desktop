param(
    [string]$InputDirectory = (Join-Path $PSScriptRoot "generated"),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "generated")
)

# Keeps the runtime deliberately simple: one transparent 6-frame horizontal
# strip per pet/state. Walk source art may have a larger generated canvas; this
# pass crops each frame by alpha, preserves aspect ratio, and locks its baseline.
Add-Type -AssemblyName System.Drawing.Common

$frameSize = 256
$frameCount = 6
$pets = @("percy", "rocky", "byte", "sprout", "nova", "ember")
# These pets ship hand-tuned walk strips that were not produced from their walk sources.
# Regenerating them here would replace the newer art, so their walk strip is left as is.
$handTunedWalkPets = @("byte", "nova", "rocky")
$states = @("idle", "walk", "thinking", "coding", "coding_malicious", "stuck", "success", "error")
$pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb

function Get-AlphaBounds([System.Drawing.Bitmap]$bitmap, [int]$left, [int]$width) {
    $minX = $left + $width; $minY = $bitmap.Height; $maxX = $left - 1; $maxY = -1
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = $left; $x -lt $left + $width; $x++) {
            if ($bitmap.GetPixel($x, $y).A -gt 20) {
                if ($x -lt $minX) { $minX = $x }; if ($y -lt $minY) { $minY = $y }
                if ($x -gt $maxX) { $maxX = $x }; if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt $minX -or $maxY -lt $minY) { throw "Frame has no visible alpha content." }
    return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

function Normalize-WalkStrip([string]$pet) {
    $source = [System.Drawing.Bitmap]::new((Join-Path $OutputDirectory "$pet-walk-source.png"))
    try {
        $sourceFrameWidth = [int]($source.Width / $frameCount)
        $strip = [System.Drawing.Bitmap]::new($frameSize * $frameCount, $frameSize, $pixelFormat)
        $graphics = [System.Drawing.Graphics]::FromImage($strip)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            for ($index = 0; $index -lt $frameCount; $index++) {
                $bounds = Get-AlphaBounds $source ($index * $sourceFrameWidth) $sourceFrameWidth
                $crop = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height, $pixelFormat)
                $cropGraphics = [System.Drawing.Graphics]::FromImage($crop)
                try {
                    $cropGraphics.Clear([System.Drawing.Color]::Transparent)
                    $cropGraphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $bounds.Width, $bounds.Height), $bounds, [System.Drawing.GraphicsUnit]::Pixel)
                    $scale = [Math]::Min(232.0 / $bounds.Width, 232.0 / $bounds.Height)
                    $drawWidth = [int][Math]::Round($bounds.Width * $scale)
                    $drawHeight = [int][Math]::Round($bounds.Height * $scale)
                    $drawX = [int][Math]::Round(($frameSize - $drawWidth) / 2.0)
                    $drawY = $frameSize - 12 - $drawHeight
                    $graphics.DrawImage($crop, [System.Drawing.Rectangle]::new($index * $frameSize + $drawX, $drawY, $drawWidth, $drawHeight))
                } finally { $cropGraphics.Dispose(); $crop.Dispose() }
            }
            $strip.Save((Join-Path $OutputDirectory "$pet-walk-frames.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $strip.Dispose() }
    } finally { $source.Dispose() }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
foreach ($pet in $pets) {
    if ($handTunedWalkPets -notcontains $pet) { Normalize-WalkStrip $pet }
    foreach ($state in $states) {
        if ($state -eq "walk") { continue }
        $sourcePath = Join-Path $InputDirectory "$pet-$state-frames.png"
        $targetPath = Join-Path $OutputDirectory "$pet-$state-frames.png"
        if (-not (Test-Path $sourcePath)) { throw "Missing strip: $sourcePath" }
        # By default the strips already live in generated/, so there is nothing to copy.
        if ([System.IO.Path]::GetFullPath($sourcePath) -ne [System.IO.Path]::GetFullPath($targetPath)) {
            Copy-Item $sourcePath $targetPath -Force
        }
    }
}
Write-Output "Built $($pets.Count * $states.Count) independent six-frame pet strips in $OutputDirectory."
