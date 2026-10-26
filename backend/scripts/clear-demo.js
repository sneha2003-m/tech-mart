const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { closeDatabase, getDatabase } = require("../src/database");

async function clearDemo() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo data cannot be cleared while NODE_ENV is production.");
  }
  try {
    const db = await getDatabase();
    const [products, customers, categories, orders] = await Promise.all([
      db.collection("products").find({ sku: /^DEMO-/i }, { projection: { id: 1 } }).toArray(),
      db.collection("customers").find({ email: /^demo-.*@example\.invalid$/i }, { projection: { id: 1 } }).toArray(),
      db.collection("categories").find({ nameKey: /^demo-/i }, { projection: { id: 1 } }).toArray(),
      db.collection("orders").find({ orderNumber: /^DEMO-/i }, { projection: { id: 1 } }).toArray(),
    ]);
    const productIds = products.map((item) => item.id);
    const customerIds = customers.map((item) => item.id);
    const categoryIds = categories.map((item) => item.id);
    const orderIds = orders.map((item) => item.id);

    if (!productIds.length && !customerIds.length && !categoryIds.length && !orderIds.length) {
      console.log("No demo records found; nothing was removed.");
      return;
    }

    const linkedOrders = await db.collection("orders").find({
      orderNumber: { $not: /^DEMO-/i },
      $or: [
        { customerId: { $in: customerIds } },
        { "items.productId": { $in: productIds } },
      ],
    }, { projection: { orderNumber: 1 } }).limit(1).toArray();
    if (linkedOrders.length) {
      throw new Error(`Demo records are referenced by non-demo order ${linkedOrders[0].orderNumber}; clear was stopped to preserve order history.`);
    }
    const linkedProducts = await db.collection("products").find({
      active: true,
      sku: { $not: /^DEMO-/i },
      categoryId: { $in: categoryIds },
    }, { projection: { sku: 1 } }).limit(1).toArray();
    if (linkedProducts.length) {
      throw new Error(`Demo category is used by non-demo product ${linkedProducts[0].sku}; clear was stopped to preserve catalog data.`);
    }

    const reads = productIds.length || orderIds.length
      ? await db.collection("notification_reads").find({
        _id: { $regex: `:(stock|order):(${[...productIds, ...orderIds].join("|")})$` },
      }, { projection: { _id: 1 } }).toArray()
      : [];

    await db.collection("payments").deleteMany({ orderId: { $in: orderIds } });
    await db.collection("stock_movements").deleteMany({
      $or: [
        { productId: { $in: productIds } },
        { reference: { $regex: /^DEMO-/i } },
      ],
    });
    await db.collection("orders").deleteMany({ id: { $in: orderIds } });
    await db.collection("products").deleteMany({ id: { $in: productIds } });
    await db.collection("customers").deleteMany({ id: { $in: customerIds } });
    await db.collection("categories").deleteMany({ id: { $in: categoryIds } });
    if (reads.length) {
      await db.collection("notification_reads").deleteMany({
        _id: { $in: reads.map((item) => item._id) },
      });
    }
    await db.collection("audit_logs").deleteMany({
      $or: [
        { entityType: "demo_seed", entityId: "demo" },
        { entityType: "order", entityId: { $in: orderIds.map(String) } },
        { entityType: "product", entityId: { $in: productIds.map(String) } },
        { entityType: "category", entityId: { $in: categoryIds.map(String) } },
        { entityType: "customer", entityId: { $in: customerIds.map(String) } },
      ],
    });
    console.log(`Removed demo records only: ${productIds.length} products, ${customerIds.length} customers, ${categoryIds.length} categories, and ${orderIds.length} orders.`);
  } finally {
    await closeDatabase();
  }
}

clearDemo().catch((error) => {
  console.error("Could not clear demo data.", error);
  process.exitCode = 1;
});
