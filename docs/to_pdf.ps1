# Word COM で目次を更新し、PDF に出力する
param([string]$Dir)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

Get-ChildItem -Path $Dir -Filter *.docx | ForEach-Object {
  $src = $_.FullName
  $pdf = [System.IO.Path]::ChangeExtension($src, '.pdf')
  $doc = $word.Documents.Open($src, $false, $false)
  try {
    # 目次のページ番号を確定させる
    if ($doc.TablesOfContents.Count -gt 0) { $doc.TablesOfContents.Item(1).Update() }
    $doc.Fields.Update() | Out-Null
    $doc.Repaginate()
    $pages = $doc.ComputeStatistics(2)   # wdStatisticPages
    $doc.Save()
    $doc.ExportAsFixedFormat($pdf, 17)   # wdExportFormatPDF
    Write-Output ("{0}`t{1} pages" -f $_.Name, $pages)
  } finally {
    $doc.Close(0)
  }
}

$word.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
