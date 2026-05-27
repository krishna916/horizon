# Project Context & Workflows: horizon

Welcome to **horizon**, a personal management platform. This project is structured as a full-stack application with a Java Spring Boot backend and a React/TypeScript frontend.

---

## 🏗️ Architecture Overview

The codebase is divided into two primary directories:
1. **[client](file:///D:/projects/my-horizon/client)**: Frontend application built with React 19, TypeScript, and Vite.
2. **[server](file:///D:/projects/my-horizon/server)**: Backend API built with Java 25, Spring Boot 4.0.6, and Maven.

---

## 📁 Directory Structure

```text
my-horizon/
├── client/                     # Frontend React application
│   ├── src/                    # React components and source code
│   │   ├── main.tsx            # App entry point
│   │   └── App.tsx             # Main App layout & logic
│   ├── package.json            # Node dependencies and scripts
│   ├── vite.config.ts          # Vite configuration (React Compiler enabled)
│   └── tsconfig.json           # TypeScript configuration
│
└── server/                     # Backend Spring Boot application
    ├── src/
    │   ├── main/
    │   │   ├── java/           # Java source code (com.krishnamurti.horizon)
    │   │   └── resources/      # Application properties, db migrations, templates
    │   └── test/               # JUnit tests and Testcontainers configurations
    ├── compose.yaml            # Local Docker Compose setup (PostgreSQL)
    └── pom.xml                 # Maven dependencies and build definition
```

---

## 💻 Backend: Spring Boot & Maven

The backend is built with Spring Boot 4.0.6 and targets Java 25.

### Key Backend Components & Config Files
- **[pom.xml](file:///D:/projects/my-horizon/server/pom.xml)**: Maven configuration defining dependencies, including:
  - **Spring Web** (`spring-boot-starter-webmvc`)
  - **Spring Data JPA** (`spring-boot-starter-data-jpa`)
  - **Spring Security** (`spring-boot-starter-security`)
  - **Flyway Migrations** (`spring-boot-starter-flyway`)
  - **SpringDoc OpenAPI v3** (`springdoc-openapi-starter-webmvc-ui`)
  - **Lombok** (`lombok`)
  - **Docker Compose & Testcontainers** (`spring-boot-docker-compose`, `spring-boot-testcontainers`)
- **[compose.yaml](file:///D:/projects/my-horizon/server/compose.yaml)**: Defines a PostgreSQL container (`postgres:latest`) automatically wired up during development.
- **[application.yaml](file:///D:/projects/my-horizon/server/src/main/resources/application.yaml)**: Base configuration setting the application name as `horizon`.
- **[HorizonApplication.java](file:///D:/projects/my-horizon/server/src/main/java/com/krishnamurti/horizon/HorizonApplication.java)**: The main entry point of the Spring Boot application.

### Local Development Workflows (Backend)
Navigate to the `server/` directory before running these commands:

1. **Run Application with Docker Compose**:
   ```bash
   ./mvnw spring-boot:run
   ```
   *Note: Thanks to the Spring Boot Docker Compose module integration, running this command will automatically pull and start the PostgreSQL container defined in [compose.yaml](file:///D:/projects/my-horizon/server/compose.yaml) and wire up the database connection properties dynamically.*

2. **Run Application via Testcontainers**:
   Execute the `main` method of **[TestHorizonApplication.java](file:///D:/projects/my-horizon/server/src/test/java/com/krishnamurti/horizon/TestHorizonApplication.java)**. This spins up the database dependencies using Testcontainers for isolated local runs.

3. **Running Tests**:
   ```bash
   ./mvnw test
   ```
   This runs unit and integration tests defined under `src/test/java/`.

4. **Flyway Migrations**:
   Flyway migration files should be added in SQL format to:
   `server/src/main/resources/db/migration/` (e.g. `V1__init.sql`).

---

## 🎨 Frontend: React, TS, & Vite

The frontend is a React 19 application built using Vite and TypeScript.

### Key Frontend Components & Config Files
- **[package.json](file:///D:/projects/my-horizon/client/package.json)**: Manage frontend packages and build scripts.
- **[vite.config.ts](file:///D:/projects/my-horizon/client/vite.config.ts)**: Configured with React 19 and `@rolldown/plugin-babel` supporting the new **React Compiler** preset for optimized performance.
- **[App.tsx](file:///D:/projects/my-horizon/client/src/App.tsx)**: Main application container showcasing default UI elements and routing.

### Local Development Workflows (Frontend)
Navigate to the `client/` directory before running these commands:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Dev Server (Vite)**:
   ```bash
   npm run dev
   ```
   Typically runs on [http://localhost:5173](http://localhost:5173).

3. **Build Production Bundle**:
   ```bash
   npm run build
   ```
   Compiles TypeScript files (`tsc -b`) and bundles assets via Vite.

4. **Run Linter (ESLint)**:
   ```bash
   npm run lint
   ```

---

## 💡 Developer Guidelines

* **Database Schema Changes**: Do not apply schema modifications manually. Always write a Flyway migration script in `server/src/main/resources/db/migration/`.
* **Security & Authentication**: Spring Security is active in dependencies. Make sure to define proper endpoint access rules/configurations as APIs are introduced.
* **Component Styling**: CSS framework and component library choices are **undecided** (see [docs/ai/architecture.md](file:///D:/projects/my-horizon/docs/ai/architecture.md) > Open Decisions). AI should ask the user before choosing a CSS approach for new work. Regardless of framework choice, prioritize modern, premium aesthetics (smooth transitions, proper font pairing, responsive layouts). Avoid standard browser styling.

---

## 📚 Project Foundation

For comprehensive project context, engineering philosophy, conventions, and architectural decisions, see the **AI Foundation Documents**:

→ **[docs/ai/README.md](file:///D:/projects/my-horizon/docs/ai/README.md)** — Start here

These documents are designed to be read by AI systems for long-term project context. Always consult them before making architectural or convention decisions.
