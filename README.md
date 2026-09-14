# Cephas Books Backend

Production-oriented REST API for the Cephas Books financial platform. It uses NestJS, PostgreSQL, Prisma, short-lived JWT access tokens, rotating refresh sessions, tenant-scoped queries, request validation, rate limiting, structured/redacted logs, Helmet security headers, RBAC, health checks, Swagger/OpenAPI, Docker, and Jest.

## Quick start

1. Copy `.env.example` to `.env` and replace both JWT secrets with independent random values.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Install and generate the client: `npm ci` (or `npm install` before the first lockfile exists).
4. Create the database schema: `npm run prisma:migrate -- --name init`.
5. Start the API: `npm run start:dev`.

The API is at `http://localhost:3000/api/v1`; interactive OpenAPI docs are at `http://localhost:3000/docs`.

## Structure

```text
src/
  common/       cross-cutting decorators, filters, guards and interceptors
  config/       typed, fail-fast environment validation
  database/     shared Prisma lifecycle integration
  modules/      bounded business capabilities
prisma/         schema and migrations
test/           end-to-end test configuration
```

Each request derives its organization from a verified token; resource services additionally scope every query by `organizationId`. Never accept a tenant id from client input. Money uses PostgreSQL `Decimal`, never floating point. Financial records should be voided/reversed rather than physically deleted.

## Quality gates

```bash
npm run lint
npm run test
npm run test:cov
npm run build
npm audit --audit-level=high
```

Before production, terminate TLS at a trusted proxy, use a managed secrets store, restrict Swagger, add Redis-backed distributed rate limiting, configure backups/PITR, centralize immutable audit logs, add email verification/password reset/MFA, and commission security and accounting-control reviews.
