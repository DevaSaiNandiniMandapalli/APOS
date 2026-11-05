# Security Policy

## Supported versions

APOS is developed on feature branches and released from `master`. Only the latest
release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Report it privately
through GitHub's **Security → Report a vulnerability** advisory flow on this
repository, including:

- the affected route, tool or module;
- reproduction steps and, if possible, a proof of concept;
- the impact you believe it has.

We aim to acknowledge reports within a few days and will credit reporters who
want to be named.

## Secrets

This project never ships credentials. Provide configuration only through
environment variables:

- `SARVAM_API_KEY` — server-only key for the Sarvam 105B AI route.
- `SARVAM_API_URL` / `SARVAM_MODEL` — optional overrides for the AI endpoint.

`.env` files are git-ignored. Do not paste keys into issues, pull requests or
client-side code. The browser never receives the AI key; requests are proxied by
`/api/ai`.

## Scope

In scope: the Next.js web app, the FastAPI backend, and the build/CI
configuration in this repository. Out of scope: third-party services and
dependency vulnerabilities that already have an upstream advisory (report those
upstream).
