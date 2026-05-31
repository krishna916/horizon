# Tech Stack & Libraries Context

This document is an evolving ledger of the project's technology stack, including specific frameworks, build tools, and external libraries. Its purpose is to provide an AI Technical Architect with explicit context of what dependencies are available and what patterns have been established.

---

## 🏗️ Backend Stack (Java / Spring Boot)

**Base Configuration:**
- **Language:** Java 25
- **Framework:** Spring Boot 4.0.6
- **Build Tool:** Maven

### Core Libraries & Starters
- **Spring WebMVC** (`spring-boot-starter-webmvc`): For building RESTful APIs.
- **Spring Data JPA** (`spring-boot-starter-data-jpa`): ORM and database access layer.
- **Spring Security** (`spring-boot-starter-security`): For authentication and authorization.
- **Spring Boot Actuator** (`spring-boot-starter-actuator`): For application monitoring and metrics.
- **Spring Boot RestClient** (`spring-boot-starter-restclient`): For declarative HTTP communications.
- **Resilience4j** (`spring-cloud-starter-circuitbreaker-resilience4j`): For circuit breakers and fault tolerance.

### Database & Migrations
- **PostgreSQL** (`postgresql` JDBC driver): Primary relational database.
- **Flyway** (`spring-boot-starter-flyway`, `flyway-database-postgresql`): For SQL-based schema versioning.

### Development & API Documentation
- **Lombok** (`lombok`): Boilerplate reduction.
- **Spring Boot DevTools** (`spring-boot-devtools`): Hot-reloading and development-time enhancements.
- **Spring Boot Docker Compose** (`spring-boot-docker-compose`): Automatic local database container management via `compose.yaml`.
- **SpringDoc OpenAPI** (`springdoc-openapi-starter-webmvc-ui` v3.0.2): Swagger UI for automated API documentation.

### Testing
- **Spring Boot Test** (`spring-boot-starter-test`, webmvc-test, data-jpa-test, etc.): Comprehensive testing utilities.
- **Testcontainers** (`spring-boot-testcontainers`, `testcontainers-junit-jupiter`, `testcontainers-postgresql`): For integration testing against ephemeral database instances.

---

## 🎨 Frontend Stack (React / Vite)

**Base Configuration:**
- **Language:** TypeScript 6.0.2
- **Framework:** React 19 (`react`, `react-dom` ^19.2.6)
- **Build Tool:** Vite 8.0.12

### Compiler & Toolchain
- **React Compiler** (`babel-plugin-react-compiler` ^1.0.0): Automatic memoization and optimization for React 19.
- **Babel Ecosystem** (`@babel/core` ^7.29.0, `@rolldown/plugin-babel` ^0.2.3): Integrated into Vite to support the React Compiler.

### Linting & Typings
- **ESLint** (^10.3.0): Configured with `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`.
- **TypeScript ESLint** (`typescript-eslint` ^8.59.2): For rigorous type checking during linting.

### Styling & UI Components
- **TailwindCSS v4** (`tailwindcss` ^4.x): Utility-first CSS framework. Integrated via `@tailwindcss/vite` — no separate `tailwind.config.ts` file required in v4.
- **shadcn/ui** (Radix Vega preset, `radix-vega` style): Component system with copy-owned components generated into `src/components/ui/`. Configured via [`components.json`](file:///D:/projects/my-horizon/client/components.json).
- **Radix UI** (via shadcn): Headless, accessible UI primitives. Included transitively through shadcn components.
- **Lucide React** (`lucide-react`): Icon library. Default for the Vega preset.
- **clsx** + **tailwind-merge**: Power the `cn()` utility in `src/lib/utils.ts`. Used for safe conditional class merging.
- **class-variance-authority (CVA)** (`class-variance-authority`): Used to define type-safe component variant APIs (e.g., button sizes, variants).
- **tw-animate-css**: Installed by shadcn init — provides `@keyframes` animation utilities.
- **@fontsource-variable/geist**: Variable Geist font, installed by shadcn Vega preset. Used as the default `--font-sans`.

### `cn()` Utility
All components use the `cn()` function from `@/lib/utils`:
```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## 💡 Recommendations for Future Evolution

As the project grows, this document should be updated to track additional technical decisions. To best serve an AI Technical Architect, consider adding the following sections when applicable:

1. **Custom Abstractions & Wrappers:** Document any custom wrappers around external libraries (e.g., custom Axios instances, global Spring exception handlers, custom authentication filters).
2. **Styling & UI Components:** Once decided, track the CSS framework (e.g., Tailwind, Vanilla) and any component libraries (e.g., shadcn/ui, Radix).
3. **External Integrations:** Maintain a registry of third-party SaaS tools/APIs (e.g., SendGrid, Stripe, AWS S3) and their corresponding SDK versions.
4. **State Management:** Note the chosen global state management library (e.g., Zustand, Redux, Context API) if the frontend complexity requires one.
5. **Testing Frameworks (Frontend):** Log the chosen frontend testing tools (e.g., Vitest, Playwright, React Testing Library).
6. **Infrastructure & CI/CD:** Document GitHub Actions workflows, deployment scripts, or Vercel/Railway environment specific setups.
