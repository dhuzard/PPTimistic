param([Parameter(Mandatory=$true)][string]$Deck, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$application = $null
$presentation = $null
$existingPowerPoint = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
try {
  $application = New-Object -ComObject PowerPoint.Application
  # Open read-only, without a presentation window. Never modify the source deck.
  $presentation = $application.Presentations.Open($Deck, -1, 0, 0)
  for ($slideIndex = 1; $slideIndex -le $presentation.Slides.Count; $slideIndex++) {
    $imagePath = Join-Path $Destination ('slide-{0:D3}.png' -f $slideIndex)
    $presentation.Slides.Item($slideIndex).Export($imagePath, 'PNG', 1600, 900)
  }
  $presentation.SaveAs((Join-Path $Destination 'presentation.pdf'), 32)
} finally {
  if ($null -ne $presentation) { $presentation.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
  if ($null -ne $application) {
    # PowerPoint may reuse a user's running COM server. Never quit their session,
    # or an application with presentations they opened during our export.
    if (-not $existingPowerPoint -and $application.Presentations.Count -eq 0) { $application.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
  }
  [GC]::Collect()
}
