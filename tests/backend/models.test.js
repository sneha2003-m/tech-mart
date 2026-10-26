const test = require("node:test");
const assert = require("node:assert/strict");
const { collections } = require("../../backend/src/models");

test("MongoDB schemas cover every collection used by the API", () => {
  const expected = [
    "staff_users",
    "categories",
    "products",
    "customers",
    "orders",
    "payments",
    "stock_movements",
    "audit_logs",
    "notification_reads",
    "revoked_tokens",
    "counters",
  ];
  assert.deepEqual(Object.keys(collections).sort(), expected.sort());
});

test("application collections require strict JSON Schema validation", () => {
  for (const [name, definition] of Object.entries(collections)) {
    assert.ok(definition.validator.$jsonSchema.required.length > 0, `${name} must require core fields`);
    assert.ok(Array.isArray(definition.indexes), `${name} must declare its indexes`);
    assert.equal(
      definition.indexes.some((index) => (
        index.unique && (index.key.id === 1 || index.key.jti === 1)
      )),
      !["counters", "notification_reads"].includes(name),
      `${name} must uniquely index its application id or token id`,
    );
  }
  assert.equal(
    collections.products.validator.$jsonSchema.properties.quantity.multipleOf,
    1,
  );
});

test("orders embed a bounded snapshot of purchased items", () => {
  const orderSchema = collections.orders.validator.$jsonSchema.properties;
  const items = orderSchema.items;
  assert.equal(items.bsonType, "array");
  assert.equal(items.maxItems, 100);
  assert.deepEqual(
    items.items.required,
    ["productId", "name", "sku", "quantity", "unitPrice"],
  );
  assert.equal(orderSchema.statusHistory.maxItems, 20);
});

test("payment attempts can be stored independently for an order", () => {
  assert.ok(collections.payments.indexes.some((index) => index.key.orderId === 1 && !index.unique));
  assert.equal(collections.payments.validator.$jsonSchema.properties.method.bsonType[1], "null");
});

test("authentication revocation records expire after their token lifetime", () => {
  assert.ok(collections.revoked_tokens.indexes.some((index) => index.expireAfterSeconds === 0));
});

test("product identity and external import keys have unique indexes", () => {
  const indexes = collections.products.indexes;
  assert.ok(indexes.some((index) => index.unique && index.key.skuKey === 1));
  assert.ok(indexes.some((index) => (
    index.unique
    && index.key.externalId === 1
    && index.partialFilterExpression.externalId.$type === "string"
  )));
});
