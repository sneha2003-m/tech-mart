# TechMart Admin

TechMart is an admin-focused product, inventory, order, payment, and reporting application. Frontend files and backend API are maintained in separate `frontend/` and `backend/` folders. The backend serves the static frontend for local development.

## Run locally

Requirements: Node.js 22+, npm, and MongoDB Atlas or a MongoDB replica set. Multi-document transactions are used to keep order, payment, and inventory changes consistent; a standalone MongoDB server is not sufficient.

1. Install backend dependencies from the project root: `npm --prefix backend install`.
2. Create a MongoDB Atlas cluster and database user, or configure a local MongoDB replica set. Add the application host to the Atlas network access list.
3. Configure `backend/.env` (copy `backend/.env.example` if needed). Set `MONGODB_URI` to the connection string supplied by Atlas (or use `mongodb://127.0.0.1:27017/techmartdB?replicaSet=rs0` for a local replica set), set `MONGODB_DB=techmartdB`, and enter the initial administrator email and password.
4. Set a random `JWT_SECRET` of at least 64 characters. Never use the sample values in deployment.
5. Run `npm --prefix backend run setup:db` to create the application collections, JSON Schema validators, and indexes. The database user must have permission to create collections/indexes and update collection validators (`dbAdmin` and `readWrite` on the target database).
6. Run `npm --prefix backend run seed:admin` to create or reset the administrator account. `ADMIN_PASSWORD` must contain at least 12 characters.
7. Start the app with `npm --prefix backend run dev` or `npm --prefix backend start`.
8. Open `http://localhost:3001`. Set `PORT` to use a different port.

For a local MongoDB installation, start `mongod` with replica-set mode enabled (for example, `mongod --replSet rs0`), then initialize the replica set once with `mongosh --eval "rs.initiate()"`. MongoDB Atlas replica sets support transactions without this local initialization. The server verifies that schema setup has been completed before it starts.

An Atlas connection string has the form `mongodb+srv://<database-user>:<url-encoded-password>@<cluster-host>/techmartdB?retryWrites=true&w=majority`. Keep it in `.env`, not in source control. Replace the placeholders with the values shown for your cluster; URL-encode any special characters in the database password.

For a separately hosted frontend, set `CORS_ORIGINS` to a comma-separated list of exact trusted origins (scheme and host, with no path). Leave it unset if the API is only called from the same origin.

## Backend API

Current browser authentication uses an HttpOnly session cookie by default. The bearer-token login described in older notes is opt-in: API clients must request `{ "authMode": "bearer" }`; the frontend does not store that token.

For browser requests, use the HttpOnly session cookie. API clients that explicitly request bearer mode may send the returned token. Use
`POST /api/auth/logout` to revoke the current session.

API responses use `{ "success": true, "data": ... }` on success and `{ "success": false, "message": ... }` on errors. Login uses an HttpOnly cookie by default; bearer-mode clients receive a signed token in the response.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Check server and MongoDB connectivity |
| POST | `/api/auth/login`, `/api/auth/logout` | Sign in and revoke the current session |
| GET | `/api/auth/me` | Read the signed-in account |
| GET, POST | `/api/categories` | List categories; administrator creates categories |
| PATCH, DELETE | `/api/categories/:id` | Edit or safely deactivate a category |
| GET, POST | `/api/products` | List/filter or create products |
| PATCH, DELETE | `/api/products/:id` | Edit or deactivate a product |
| GET, POST | `/api/customers` | List customers and create customer records |
| GET, POST | `/api/orders` | List orders and place an order |
| GET | `/api/orders/:id` | Read order details, status history, and payment attempts |
| PATCH | `/api/orders/:id/status` | Advance or cancel an order |
| POST | `/api/orders/:id/payment-attempt` | Record simulated payment success or failure |
| GET | `/api/payments` | List payment records |
| GET | `/api/inventory/movements` | Review stock movements |
| POST | `/api/inventory/adjustments` | Adjust stock with a required reason |
| GET | `/api/dashboard/summary`, `/api/reports/sales`, `/api/reports/inventory` | Read database-derived dashboard and reporting data |
| GET, POST | `/api/notifications`, `/api/notifications/read` | List alerts and mark them read |
| GET | `/api/audit` | Review the administrator-only audit history |
| GET, POST | `/api/staff` | List or create staff accounts (administrator only) |
| PATCH | `/api/staff/:id` | Change staff role, password, or active state |
| GET | `/api/imports/dummyjson/preview` | Fetch and validate external products before selection |
| GET | `/api/imports/history` | Review persisted import results |
| POST | `/api/imports/dummyjson` | Import selected DummyJSON products using a supplied USD-to-INR rate |

Browser authentication uses the `techmart_session` HttpOnly cookie by default. The cookie is SameSite Strict, scoped to `/api`, and secure in production; the “Remember” option changes it from a browser-session cookie to an eight-hour cookie. JWTs are not saved in browser storage. Non-browser API clients may request a bearer token by including `{ "authMode": "bearer" }` in the login body, then send that short-lived token in the Authorization header. Logout revokes either session and clears the browser cookie.

### MongoDB collections

`npm --prefix backend run setup:db` provisions the API's collections with strict MongoDB JSON Schema validators and the unique/query indexes used by the routes:

- `staff_users`, `categories`, `products`, and `customers` store independently managed records with unique email, category-name, and SKU keys.
- `orders` embeds a bounded snapshot of each purchased product (up to 100 lines) so the order remains readable if a product is later renamed or repriced.
- `payments` keeps payment attempts independently queryable; it is a record store, not a payment processor.
- `stock_movements` stores product and staff display snapshots for the audit trail, avoiding joins on every movement read.
- `audit_logs`, `notification_reads`, and `revoked_tokens` retain auditable changes, per-user alert state, and logout revocations.
- `counters` maintains numeric API IDs.

Product listing supports `q`, `categoryId`, `lowStock=true|false`, `page`, and `limit` query parameters; orders and customers also support server-side pagination. Creating an order accepts a `customerId` and `items` array of `{ "productId": 1, "quantity": 2 }`; prices are read from MongoDB, order lines are embedded as immutable snapshots, stock is checked and decremented in a transaction, and payment and movement records are created atomically. Customer order totals are maintained transactionally. Order cancellation restores stock transactionally and only once. Staff roles are checked on the server for protected operations. Import history is retained in the audit log and available to administrators and inventory staff.

The frontend signs in through the API and uses MongoDB-backed records for business data. Browser sign-in uses an `HttpOnly`, `SameSite=Strict` cookie, with a session lifetime unless “Remember” is selected; JWTs are not stored in browser storage. API clients that cannot use cookies may send `{ "authMode": "bearer" }` at login and use the returned short-lived token as a bearer credential. Existing MySQL data is not migrated automatically; export and import any records you need before switching databases. Payments are simulated records only; no payment gateway or real card data is used.

## Project layout

- `frontend/pages/` contains the static HTML, CSS, and JavaScript.
- `backend/` contains the Express server, MongoDB models and connection, API routes, and database setup and seed scripts.
- `tests/` is separate from the application and contains automated tests and manual acceptance scenarios.
- `TASKS.md` tracks implementation progress; it is not part of the runnable application.
- `backend/.env` contains local secrets and is ignored by Git; never commit it or share Atlas credentials.

## Backup and restore

Install MongoDB Database Tools and create a protected backup before upgrades or database maintenance:

```sh
mongodump --uri="<MongoDB connection string>" --db=techmartdB --out=./backups
```

Restore into a disposable database first and verify the data before restoring to the active database:

```sh
mongorestore --uri="<MongoDB connection string>" --nsFrom="techmartdB.*" --nsTo="techmartdB.*" ./backups/techmartdB
```

Treat backups as sensitive data, restrict access, encrypt them at rest and in transit, and regularly test restores. Do not commit backup files.

## Deployment and validation

Set `NODE_ENV=production`, `PORT`, `MONGODB_URI`, `MONGODB_DB`, and a unique randomly generated `JWT_SECRET` of at least 64 characters in the deployment environment. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are needed by the one-time account seed command, not by normal application startup. Use least-privilege database credentials and a restricted Atlas network access list. Set `CORS_ORIGINS` only for a separately hosted frontend. If the app is behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops; do not guess or trust arbitrary forwarded headers. Terminate HTTPS at the trusted edge and redirect HTTP to HTTPS there. Provision a clean production database with `setup:db`, create the administrator with `seed:admin`, then start with `npm --prefix backend start`; the backend serves the frontend on the same origin by default.

For example, generate a fresh URL-safe secret in PowerShell with `$bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)`. Store it only in the deployment secret manager; never reuse or post a secret that has appeared in a chat or source file.

The server sets Helmet security headers, a restrictive content-security policy, `no-store` on API responses, and IP-based throttles (300 API requests per minute; 5 failed login attempts per 15 minutes). The built-in rate-limit store is process-local: configure a shared store before running multiple app instances or workers, otherwise limits do not coordinate across instances. Production disables the simulated payment outcome API and the demo-data seed/clear scripts, and startup refuses a database containing records tagged by the demo seeder. Preserve the existing sample database and configure a separate, clean production database; no records are removed by this guard. A real payment provider and reconciliation flow must be selected and integrated before processing real customer payments.

Run the backend test suite with `npm --prefix backend test`. Test code and manual scenarios are maintained outside the app in `tests/`; see [tests/SCENARIOS.md](./tests/SCENARIOS.md). Automated tests and authenticated smoke checks cover principal workflows. Visual browser/device compatibility, production-scale performance, deployment monitoring, distributed rate limiting, and disaster-recovery drills still require environment-specific acceptance testing.

For a sample workspace, run `npm --prefix backend run seed:demo` after the database and administrator are set up. It adds clearly labeled `DEMO-` products and orders plus customers ending in `example.invalid`; it does not replace existing records and will not seed twice. To remove the sample records later, run `npm --prefix backend run demo:clear`. Cleanup targets those demo identifiers only and stops if a demo product or customer has been used by a non-demo order.

## Important limitations

This is an SRS-oriented application, not a production payment system. Simulated payment outcomes must not be used for real transactions, and no card details should be entered. External product imports depend on the availability and terms of DummyJSON. MongoDB transactions require Atlas or a replica set. Production operation still requires deployment-specific hardening, monitoring, protected backups, and tested recovery procedures.
