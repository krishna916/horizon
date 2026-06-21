# AGENTS.md — horizon

Full-stack app: **React 19 + Vite (client/)** and **Spring Boot 4.0.6 + Maven (server/)** targeting Java 25.

## Architectural Boundaries

- **Modular Monolith**: Horizon remains a Modular Monolith. Do not introduce microservices, CQRS, or eventing without an ADR.
- **Cross-Module Communication**: Modules must communicate exclusively through `module.api`. Direct access to internal packages (e.g. repositories, domain models, or internal services) of other modules is strictly prohibited.
- **Ownership = Authorization**: Access is granted solely based on resource ownership. Every primary resource is owned by a specific user.
- **Decisions & Escalations**:
  - Consult [HORIZON_DECISION_SUMMARY.md](file:///D:/projects/my-horizon/docs/ai/HORIZON_DECISION_SUMMARY.md) for authoritative product and architectural decisions.
  - Follow the escalation rules in [ENG-001 Engineering Guidelines Section 15](file:///D:/projects/my-horizon/docs/ai/ENG-001%20Engineering%20Guidelines%20v1.0.md#L964) before modifying public APIs, crossing module boundaries, or changing ownership rules.

## Client & Server Agent Guides

For detailed tech stack, conventions, and commands:
- **Client (Frontend)**: Refer to [client/AGENTS.md](file:///D:/projects/my-horizon/client/AGENTS.md)
- **Server (Backend)**: Refer to [server/AGENTS.md](file:///D:/projects/my-horizon/server/AGENTS.md)

## Startup

- Run `./start.sh` from the repository root on Unix/Git Bash to start PostgreSQL, the backend (port 8081), and the frontend dev server.
- On Windows, run `.\start.ps1` in PowerShell or `start.bat` in Command Prompt to start the entire environment.
- On Windows, use `./mvnw.cmd` for Maven commands.