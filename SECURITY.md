# Security policy

Do not report vulnerabilities in public issues. Send reports to the private security contact configured by the project owner. Include reproduction steps and impact. Rotate any exposed credential immediately.

Baseline controls: deny-by-default DTO validation, Argon2id password hashing, rotating hashed refresh tokens, short-lived access tokens, RBAC, explicit CORS allowlist, Helmet headers, rate limiting, tenant-scoped data access, log redaction, UUID identifiers, and environment validation. Production deployments must use TLS, a secrets manager, least-privilege database credentials, encrypted backups, dependency scanning, MFA, CSP tuning, monitored audit events, and tested incident-response/recovery procedures.
