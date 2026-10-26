# TechMart test scenarios

This folder is intentionally outside `frontend/` and `backend/`. It contains
quality assurance assets; it is not shipped or served as application code.

## Automated checks

Run the backend model and schema tests from the project root:

```sh
npm --prefix backend test
```

Automated test files live in `tests/backend/`.

## Manual acceptance scenarios

Run against a disposable or explicitly approved test database. Do not use
production data. Create unique temporary records and remove only those records
after each run.

1. **Login and roles:** Sign in with an active staff account; verify the
   account's permitted pages and API operations. Verify a forbidden operation
   returns `403`.
2. **Logout and account disablement:** Log out and verify the previous token
   returns `401`. Disable a test staff account and verify its existing token
   also stops working.
3. **Catalog and categories:** Create, edit, and deactivate test categories
   and products. Confirm a category with active products cannot be removed in
   a way that breaks those products.
4. **Inventory:** Adjust stock with a reason; verify the resulting quantity,
   movement record, and low-stock notification. Resolve the low-stock
   condition, confirm its notification disappears, then recreate it and
   verify read state is not carried over.
5. **Order and stock lifecycle:** Create an order and verify prices are taken
   from the catalog, stock is reserved, and the order snapshot is retained.
   Cancel an eligible order and verify stock is restored once. Reject
   duplicate or disallowed status transitions.
6. **Payment attempts:** Record a failed simulated attempt followed by a
   successful attempt. Verify both attempts are retained, the order payment
   status is updated, and a paid order rejects further attempts.
7. **Dashboard and reports:** Set date ranges and compare dashboard, sales,
   product, and inventory summaries to the test records.
8. **Notifications and audit:** Mark alerts read, verify the state is scoped
   to the current user, and confirm important changes appear in the
   administrator audit view.
9. **Imports and pagination:** Preview selected external products; verify
   invalid items show a reason and import results remain in history. Verify
   pagination/filtering returns the expected records across pages.
10. **Responsive and accessible UI:** Test supported desktop/tablet/mobile
    sizes, keyboard-only operation, form labels, status/error announcements,
    and a screen reader. Confirm no unwanted horizontal page overflow.
11. **Operations:** Back up a disposable database, restore to a separate
    disposable database, and verify the restored collections and indexes.

Record environment, role, test data identifiers, expected result, actual
result, and pass/fail separately when executing these scenarios. These
scenarios describe acceptance coverage; they are not all automated tests.
