---
name: testing-spring-integration
description: Use when writing, modifying, or debugging backend integration tests in Spring Boot, particularly when testing Spring Session authentication, using MockMvc, handling JDBC timezone configurations, or using PostgreSQL Testcontainers.
---

# Testing Spring Boot Integration

This skill defines conventions and patterns for writing robust integration tests for Spring Boot controllers and repositories in the Horizon backend.

## Core Patterns

### 1. JVM Timezone for PostgreSQL
PostgreSQL 17 may reject JDBC connections from systems with timezones like `Asia/Calcutta` during test execution or CLI commands.
- **Maven Command Line**: Always pass `-Duser.timezone=UTC` to avoid connection handshake errors:
  ```powershell
  .\mvnw.cmd test "-Duser.timezone=UTC"
  ```
- **Surefire Plugins**: Configure `<argLine>-Duser.timezone=UTC</argLine>` in `pom.xml` for tests. Programmatic timezone overrides in Java run too late for initial connection configurations.

### 2. Spring Session JDBC & MockMvc Testing
When testing controllers secured by Spring Security and Spring Session JDBC, use the following MockMvc patterns:

- **Session Invalidation Check**: Use `mockSession.isInvalid()` to check if a `MockHttpSession` has been invalidated (not `isInvalidated()`).
- **Authenticated Mock Requests**: Programmatic session invalidation during login causes `request.getSession()` to return `null`. To perform authenticated calls on downstream endpoints, extract the `SESSION` cookie from the login response and attach it to downstream requests:
  ```java
  // 1. Authenticate to retrieve the cookie
  MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
          .contentType(MediaType.APPLICATION_JSON)
          .content(objectMapper.writeValueAsString(loginRequest)))
      .andExpect(status().isOk())
      .andReturn();

  Cookie sessionCookie = result.getResponse().getCookie("SESSION");
  assertThat(sessionCookie).isNotNull();

  // 2. Attach the cookie to downstream requests
  mockMvc.perform(get("/api/v1/users/me").cookie(sessionCookie))
      .andExpect(status().isOk());
  ```

### 3. Repository Integration Tests
- **Database Context**: Complex repository queries (e.g., today, search, inbox) must run against a real database instance to verify behavior correctly.
- **PostgreSQL Testcontainers**: Use PostgreSQL Testcontainers by importing the test configuration:
  ```java
  @SpringBootTest(classes = HorizonApplication.class)
  @ActiveProfiles("test")
  @AutoConfigureMockMvc
  @Import(TestcontainersConfiguration.class)
  class MyRepositoryTest { ... }
  ```

## Common Mistakes

- **Using `@BeforeAll` for Timezone**: Programmatic timezone setup inside test code executes after the JDBC driver initializes the connection pool, failing to prevent connection handshake failures. Use `-Duser.timezone=UTC` instead.
- **Failing to Attach Cookies**: Attaching `@WithMockUser` does not work correctly when endpoints expect Spring Session JDBC authentication. Always extract the `SESSION` cookie from login responses in MockMvc tests.
