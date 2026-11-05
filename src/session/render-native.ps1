param([Parameter(Mandatory=$true)][string]$Deck,[Parameter(Mandatory=$true)][int]$Slide,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$application = $null
$presentation = $null
$existing = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
try {
  $application = New-Object -ComObject PowerPoint.Application
  $application.AutomationSecurity = 3
  $presentation = $application.Presentations.Open($Deck, -1, 0, 0)
  if ($Slide -lt 1 -or $Slide -gt $presentation.Slides.Count) { throw 'Invalid slide number.' }
  $presentation.Slides.Item($Slide).Export($Destination, 'PNG', 1600, 900)
} finally {
  if ($null -ne $presentation) { $presentation.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
  if ($null -ne $application) {
    if (-not $existing -and $application.Presentations.Count -eq 0) { $application.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
  }
  [GC]::Collect()
}
