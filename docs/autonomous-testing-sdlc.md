# Autonomous Testing SDLC (Playwright + Newman via MCP Tooling)

## Purpose
Define how to build, run, and maintain UI and API tests when there are no dedicated manual test authors, using tools to generate and stabilize tests automatically.

## Scope
- UI testing: Playwright
- API testing: Postman collections executed by Newman
- Orchestration: local MCP + local/cloud model framework
- CI platform: Jenkins
- Delivery style: microservices, service-scoped PR checks, broader main/nightly gates

## Principles
- Treat test generation as a productized pipeline, not an ad-hoc script.
- Require machine-readable inputs (contracts, route metadata, auth config) per feature.
- Keep PR feedback fast (`smoke`), and move deep coverage to main/nightly.
- Continuously regenerate and stabilize tests to handle product drift.

## Target Operating Model
1. Discover service/UI changes.
2. Generate Playwright and Postman/Newman tests from inputs.
3. Self-validate and auto-stabilize generated tests.
4. Enforce quality gates by stage (PR/main/nightly).
5. Publish reports and trend metrics.

## Inputs Required From Engineering Teams
- API contracts: OpenAPI/Swagger per service (preferred).
- UI metadata: route list/sitemap, auth entry points, critical pages.
- Test identifiers: stable selectors (`data-testid`) for key UI controls.
- Environment configuration: service URLs, auth secrets, test users.

## Outputs Produced By Tooling
- `testing/playwright/**/*.spec.ts` generated or updated specs.
- `testing/postman/collections/**/*.json` generated service collections.
- `testing/catalog.json` service-to-test mapping.
- `testing/reports/` stage reports (pass/fail, flaky, duration).

## Repository Structure
- `testing/playwright/` generated UI tests and helpers
- `testing/postman/collections/` generated API collections
- `testing/postman/environments/` env templates for Newman
- `testing/catalog.json` source-of-truth mapping
- `testing/policies.json` quality and stabilization rules
- `docs/` process docs and runbooks

## Test Taxonomy
- `smoke`: smallest set for PR safety
- `critical`: business-critical paths (auth, checkout/payment, core workflow)
- `regression`: broad coverage run on main/nightly

## Generation Pipeline

## 1) Discover
- Detect changed services from git diff + dependency map.
- Identify impacted UI flows and API endpoints.

## 2) Generate UI (Playwright)
- Seed from known routes and critical workflows.
- Generate robust locators (prefer role/testid-based selectors).
- Add base assertions:
  - route/page load checks
  - key element visible checks
  - expected state/result checks

## 3) Generate API (Postman/Newman)
- Convert OpenAPI paths to requests and tests.
- Add baseline assertions:
  - status code
  - required response fields/schema
  - auth/negative-path checks for critical endpoints

## 4) Self-Validate and Stabilize
- Run generated suites immediately.
- Auto-fix classes of failures:
  - UI locator drift, fragile waits, missing navigation assertions
  - API parameter/schema mismatches due to contract drift
- Cap retries and quarantine unstable tests with expiry rules.

## CI/CD Integration (Jenkins)

## PR Pipeline (fast)
- Detect impacted services.
- Run only impacted `smoke` tests (UI + API).
- Hard gate on `critical` failures.

## Main Pipeline (confidence)
- Run all `smoke` + selected `critical`.
- Use shared integration env + ephemeral env for critical paths.

## Nightly Pipeline (full)
- Regenerate tests.
- Run full `regression` matrix (UI + API).
- Publish quality trends and flaky test inventory.

## Quality Gates
- PR:
  - 100% pass for impacted `smoke` and `critical`
  - retry cap (for example: max 1)
- Main:
  - no unresolved P0/P1 failures
  - critical pass-rate threshold
- Nightly:
  - regression pass-rate trend not degrading
  - runtime within p95 budget

## SDLC Policy

## Definition of Ready
- API or UI change includes machine-readable inputs needed for generation.
- Acceptance criteria identify critical path impact.

## Definition of Done
- Tool-generated tests updated for changed behavior.
- PR smoke gates pass.
- No unresolved critical regressions.

## Release Readiness
- Main pipeline green on critical gate.
- Nightly trend acceptable for last defined window.
- No active expired quarantines.

## Flakiness Management
- Quarantine only with explicit reason and expiry date.
- Auto-recheck quarantined tests each night.
- Block release if quarantine budget is exceeded.

## Security and Secrets
- Use file-based secret references (for example `model.apiKeyFile`).
- Never print or expose secret file contents in logs/reports.
- Keep secret files out of VCS and protected by workspace rules.

## 2-Week Bootstrap Plan

## Week 1
- Create `testing/catalog.json` and `testing/policies.json`.
- Generate first UI smoke suite for one service.
- Generate first API smoke collection for one service.
- Wire PR Jenkins stage to run impacted smoke tests.

## Week 2
- Add stabilization loop and flaky quarantine policy.
- Add main and nightly Jenkins stages.
- Publish basic trend reports (pass-rate, flaky count, runtime).

## Metrics To Track
- PR smoke pass-rate and median runtime
- Critical failure count by service
- Flaky test rate and mean time to stabilization
- Nightly regression pass-rate trend

## Anti-Patterns To Avoid
- Generating tests without stable selectors or contracts.
- Allowing unlimited retries (hides real defects).
- Running full regression on every PR.
- Keeping quarantines indefinitely.

## Next Evolution
- Add contract diff awareness to target API tests more precisely.
- Add risk scoring per service for smarter test selection.
- Add automatic test maintenance pull requests with approval workflow.
