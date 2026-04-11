$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Run-Step {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host "`n==> $Name" -ForegroundColor Cyan
    & $Command
}

Run-Step -Name "Verify Tauri command contract" -Command {
    node scripts/check-tauri-command-contract.js
}

Run-Step -Name "Frontend lint" -Command {
    pnpm.cmd --dir desktop lint
}

Run-Step -Name "Frontend tests" -Command {
    pnpm.cmd --dir desktop test
}

Run-Step -Name "Frontend build" -Command {
    pnpm.cmd --dir desktop build
}

Run-Step -Name "Rust check" -Command {
    cargo check -p meetfree --locked
}

Run-Step -Name "Rust lib tests" -Command {
    cargo test -p meetfree --lib --locked
}

Write-Host "`nRelease smoke gate passed." -ForegroundColor Green
