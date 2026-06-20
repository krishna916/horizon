# Bash / Zsh Aliases for Horizon Management (Git Bash / Linux)
# Add these to your ~/.bashrc or ~/.zshrc file:

alias horizon-db="docker compose -f /d/projects/my-horizon/server/compose.yaml up -d"
alias horizon-backend="cd /d/projects/my-horizon/server && ./mvnw spring-boot:run"
alias horizon-frontend="cd /d/projects/my-horizon/client && npm run dev"
