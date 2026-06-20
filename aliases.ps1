# PowerShell Functions & Aliases for Horizon Management
# Add these to your PowerShell Profile (notepad $PROFILE):

function Start-HorizonDb {
    docker compose -f "D:\projects\my-horizon\server\compose.yaml" up -d
}

function Start-HorizonBackend {
    Set-Location "D:\projects\my-horizon\server"
    & .\mvnw.cmd spring-boot:run
}

function Start-HorizonFrontend {
    Set-Location "D:\projects\my-horizon\client"
    npm run dev
}

# Set short aliases
Set-Alias -Name horizon-db -Value Start-HorizonDb
Set-Alias -Name horizon-backend -Value Start-HorizonBackend
Set-Alias -Name horizon-frontend -Value Start-HorizonFrontend
