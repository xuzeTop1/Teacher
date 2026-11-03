param(
    [string]$ModelSource = '<FINETUNE_PROJECT>\export\qwen2.5-0.5b-bkt-v2-q4_k_m.gguf'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$modelSha = 'daed6c55a53da9196c8ce1f6ce5b645d731ad628d3b78946b0f564dd56e83cf8'
$revision = '932a68e06845a1240227b6cb8d8c6ba38fdbef8d'
$archiveSha = 'b21c204aee49bb35cd3498157d7cd9037cb251df9f6edef107fcbf07c91c6f58'
if ((Get-FileHash -LiteralPath $ModelSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelSha) {
    throw 'Expected the approved v2 model. Source hash mismatch.'
}
$assets = Join-Path $projectRoot 'app/src/main/assets/local-coach'
New-Item -ItemType Directory -Path $assets -Force | Out-Null
Copy-Item -LiteralPath $ModelSource -Destination (Join-Path $assets 'qwen2.5-0.5b-bkt-v2-q4_k_m.gguf')
$vendor = Join-Path $projectRoot 'app/src/main/cpp/vendor'
$source = Join-Path $vendor 'llama.cpp'
if (!(Test-Path -LiteralPath $source)) {
    New-Item -ItemType Directory -Path $vendor -Force | Out-Null
    $archive = Join-Path $vendor 'llama-source.zip'
    Invoke-WebRequest -Uri "https://codeload.github.com/ggml-org/llama.cpp/zip/$revision" -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveSha) {
        throw 'Official llama.cpp source archive hash mismatch.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $vendor
    Move-Item -LiteralPath (Join-Path $vendor "llama.cpp-$revision") -Destination $source
    Remove-Item -LiteralPath $archive
}
Write-Output 'Pinned llama.cpp source and verified Qwen v2 model are ready.'
