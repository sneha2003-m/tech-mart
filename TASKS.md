# SRS Completion Tasks

This checklist tracks closure of the gaps identified in the SRS review. A task
is marked complete only after its implementation and relevant verification.

## Backend API

- [x] Add server-backed logout/session invalidation and expose authenticated
  user details to the UI.
- [x] Complete category create, read, update, and safe-deactivation operations.
- [x] Add order detail responses and durable, dated order status history.
- [x] Implement simulated payment attempts with explicit success/failure,
  payment references, and multiple attempts per order.
- [x] Add database-derived dashboard summaries and date-filtered sales,
  product-performance, and inventory reports.
- [x] Add low-stock/order/payment notifications and important-action audit
  records.
- [x] Add backend pagination/filtering to large order and customer lists.
- [x] Verify authorization, validation, status transitions, stock restoration,
  payment attempts, reports, audit records, and session invalidation through
  authenticated API smoke checks; model suite also passes.

## Frontend integration

- [x] Replace preview-only login and local session with the authenticated API.
- [x] Load and mutate products, categories, inventory, orders, customers, and
  payments through the API.
- [x] Connect dashboard and reports to database-backed endpoints and filters.
- [x] Add order-detail/status-history and payment-attempt experiences.
- [x] Connect imports, notifications, and settings to their real backend
  behavior; clearly distinguish unsupported administration features.
- [x] Display loading, empty, validation, and API error states accessibly.
- [x] Keep authoritative business records in MongoDB; browser storage holds
  only account display data while the authentication token stays in an
  HttpOnly cookie.
- [x] Add visible pagination controls to product, order, and customer screens.
- [x] Persist import history and show per-product failure reasons.
- [x] Clear notification read state when a notification resolves.
- [x] Prevent a successful login from being immediately logged out on the
  initial `#login` route.

## Operations and acceptance

- [x] Document MongoDB backup and restore, deployment configuration, and
  limitations.
- [x] Check the mobile responsive layout, sign-in labels/status messages,
  server-side role enforcement, and HttpOnly cookie authentication.
- [x] Run backend tests and focused authenticated API/UI smoke checks,
  including a browser sign-in, dashboard/orders walkthrough, and a 390px
  viewport overflow check.
- [x] Review the remaining checklist against FR-01–FR-36, NFR-01–NFR-15, and
  AC-01–AC-18; record any scope that is intentionally deferred.

## Remaining environment-specific acceptance

- [ ] Benchmark dashboard/list performance using representative production
  data volumes and the deployment environment.
- [ ] Complete tablet/desktop and cross-browser testing, a screen-reader review,
  and a backup restore drill against a disposable database.
- [ ] Exercise all AC-01–AC-18 scenarios with the project owner across each
  staff role. Live API smoke checks cover the core workflows, not this full
  user-acceptance matrix.

## Production hardening baseline

- [x] Add security headers, no-store API responses, bounded request bodies,
  IP-based rate limits, production secret validation, and graceful shutdown.
- [x] Use an HttpOnly, SameSite Strict browser session cookie and revoke it on
  logout; keep bearer-token access opt-in for non-browser API clients.
- [x] Block demo seed/clear operations and prevent production startup against
  databases that still contain known demo records without modifying them.
- [ ] Before launch, choose hosting/payment providers, configure a shared
  rate-limit store for multiple instances, rotate exposed credentials, and
  complete deployment monitoring, backup/recovery, and payment integration.

Real payment-gateway processing is intentionally excluded: payment outcomes
are simulated, and the app does not collect card details. External imports
depend on DummyJSON availability. No data migration from the former MySQL
setup is performed automatically.
