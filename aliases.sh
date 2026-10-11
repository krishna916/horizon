# Bash / Zsh Aliases for Horizon Management (Git Bash / Linux)
# Add these to your ~/.bashrc or ~/.zshrc file:

if [ -n "${BASH_VERSION:-}" ]; then
  HORIZON_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
elif [ -n "${ZSH_VERSION:-}" ]; then
  HORIZON_ROOT="${${(%):-%N}:A:h}"
fi

alias horizon-db='docker compose -f "$HORIZON_ROOT/server/compose.yaml" up -d'
alias horizon-backend='cd "$HORIZON_ROOT/server" && ./mvnw spring-boot:run'
alias horizon-frontend='cd "$HORIZON_ROOT/client" && npm run dev'
