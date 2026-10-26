const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const {
  closeDatabase,
  getDatabase,
  getNextId,
  withTransaction,
} = require("../src/database");

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function seedDemo() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo data cannot be seeded while NODE_ENV is production.");
  }
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) throw new Error("Set ADMIN_EMAIL to the seeded administrator email.");

  try {
    const db = await getDatabase();
    const existingDemo = await db.collection("categories").findOne({ nameKey: "demo-audio" });
    if (existingDemo) {
      throw new Error("Demo data already exists. Run \"npm run demo:clear\" before seeding it again.");
    }

    await withTransaction(async (database, session) => {
      const admin = await database.collection("staff_users").findOne(
        { email: adminEmail, role: "Administrator", active: true },
        { projection: { id: 1, email: 1 }, session },
      );
      if (!admin) throw new Error("An active administrator is required before seeding demo data.");

      const categories = [
        { name: "Demo Audio", nameKey: "demo-audio", description: "Sample audio products" },
        { name: "Demo Computers", nameKey: "demo-computers", description: "Sample computers and displays" },
        { name: "Demo Accessories", nameKey: "demo-accessories", description: "Sample technology accessories" },
      ].map((category) => ({ ...category, active: true, createdAt: daysAgo(30) }));
      for (const category of categories) {
        category.id = await getNextId(database, "categories", session);
      }
      await database.collection("categories").insertMany(categories, { session });
      const categoryIds = new Map(categories.map((category) => [category.nameKey, category.id]));

      const products = [
        { name: "Demo Wireless Headphones", sku: "DEMO-AUDIO-001", category: "demo-audio", price: 12999, quantity: 3, threshold: 5 },
        { name: "Demo Bluetooth Speaker", sku: "DEMO-AUDIO-002", category: "demo-audio", price: 5999, quantity: 14, threshold: 4 },
        { name: "Demo Laptop 14-inch", sku: "DEMO-COMPUTER-001", category: "demo-computers", price: 74999, quantity: 8, threshold: 3 },
        { name: "Demo 27-inch Monitor", sku: "DEMO-COMPUTER-002", category: "demo-computers", price: 22999, quantity: 2, threshold: 4 },
        { name: "Demo USB-C Hub", sku: "DEMO-ACCESSORY-001", category: "demo-accessories", price: 3499, quantity: 22, threshold: 6 },
        { name: "Demo Mechanical Keyboard", sku: "DEMO-ACCESSORY-002", category: "demo-accessories", price: 7999, quantity: 9, threshold: 3 },
      ].map((product) => ({
        name: product.name,
        sku: product.sku,
        skuKey: product.sku.toLocaleLowerCase("en"),
        categoryId: categoryIds.get(product.category),
        price: product.price,
        quantity: product.quantity,
        threshold: product.threshold,
        active: true,
        createdAt: daysAgo(30),
      }));
      for (const product of products) {
        product.id = await getNextId(database, "products", session);
      }
      await database.collection("products").insertMany(products, { session });

      const customers = [
        ["Aarav Sample", "demo-aarav@example.invalid", "+91 90000 00001"],
        ["Diya Sample", "demo-diya@example.invalid", "+91 90000 00002"],
        ["Kabir Sample", "demo-kabir@example.invalid", "+91 90000 00003"],
        ["Mira Sample", "demo-mira@example.invalid", "+91 90000 00004"],
      ].map(([name, email, phone]) => ({
        name,
        email,
        phone,
        orderCount: 0,
        totalSpent: 0,
        createdAt: daysAgo(20),
      }));
      for (const customer of customers) {
        customer.id = await getNextId(database, "customers", session);
      }
      await database.collection("customers").insertMany(customers, { session });

      const productBySku = new Map(products.map((product) => [product.sku, product]));
      const orderSpecs = [
        { customer: 0, sku: "DEMO-AUDIO-001", quantity: 1, status: "Processing", paymentStatus: "Paid", age: 1 },
        { customer: 1, sku: "DEMO-COMPUTER-001", quantity: 1, status: "Shipped", paymentStatus: "Paid", age: 2 },
        { customer: 2, sku: "DEMO-ACCESSORY-001", quantity: 2, status: "Delivered", paymentStatus: "Paid", age: 3 },
        { customer: 3, sku: "DEMO-COMPUTER-002", quantity: 1, status: "Pending", paymentStatus: "Pending", age: 0 },
        { customer: 0, sku: "DEMO-AUDIO-002", quantity: 1, status: "Pending", paymentStatus: "Failed", age: 4 },
      ];
      const orders = [];
      const payments = [];
      const movements = [];
      const unitsSold = new Map();
      for (const [index, spec] of orderSpecs.entries()) {
        const product = productBySku.get(spec.sku);
        const customer = customers[spec.customer];
        const createdAt = daysAgo(spec.age);
        const total = product.price * spec.quantity;
        const statuses = spec.status === "Processing"
          ? ["Pending", "Processing"]
          : spec.status === "Shipped"
            ? ["Pending", "Processing", "Shipped"]
            : spec.status === "Delivered"
              ? ["Pending", "Processing", "Shipped", "Delivered"]
              : ["Pending"];
        const statusHistory = statuses.map((status, statusIndex) => ({
          status,
          changedAt: new Date(createdAt.getTime() + statusIndex * 60 * 60 * 1000),
          actorId: admin.id,
          actorEmail: admin.email,
          note: "Sample demo order",
        }));
        const id = await getNextId(database, "orders", session);
        const orderNumber = `DEMO-${String(index + 1).padStart(4, "0")}`;
        orders.push({
          id,
          orderNumber,
          customerId: customer.id,
          items: [{
            productId: product.id,
            name: product.name,
            sku: product.sku,
            quantity: spec.quantity,
            unitPrice: product.price,
          }],
          total,
          status: spec.status,
          paymentStatus: spec.paymentStatus,
          createdAt,
          statusHistory,
        });
        payments.push({
          id: await getNextId(database, "payments", session),
          orderId: id,
          amount: total,
          status: spec.paymentStatus,
          reference: `DEMO-PAY-${String(index + 1).padStart(4, "0")}`,
          method: "Simulated",
          createdAt,
        });
        unitsSold.set(product.id, (unitsSold.get(product.id) || 0) + spec.quantity);
        movements.push({
          id: await getNextId(database, "stock_movements", session),
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          changeQuantity: -spec.quantity,
          reason: "Sample demo order",
          reference: orderNumber,
          actorId: admin.id,
          actorEmail: admin.email,
          createdAt,
        });
        customer.orderCount++;
        if (spec.paymentStatus === "Paid") customer.totalSpent += total;
      }

      for (const product of products) {
        movements.push({
          id: await getNextId(database, "stock_movements", session),
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          changeQuantity: product.quantity + (unitsSold.get(product.id) || 0),
          reason: "Demo opening stock",
          reference: "DEMO-OPENING-STOCK",
          actorId: admin.id,
          actorEmail: admin.email,
          createdAt: daysAgo(30),
        });
      }

      await database.collection("orders").insertMany(orders, { session });
      await database.collection("payments").insertMany(payments, { session });
      await database.collection("stock_movements").insertMany(movements, { session });
      await database.collection("customers").bulkWrite(customers.map((customer) => ({
        updateOne: {
          filter: { id: customer.id },
          update: { $set: { orderCount: customer.orderCount, totalSpent: customer.totalSpent } },
        },
      })), { session });
      await database.collection("audit_logs").insertOne({
        id: await getNextId(database, "audit_logs", session),
        actorId: admin.id,
        actorEmail: admin.email,
        action: "Loaded demo data",
        entityType: "demo_seed",
        entityId: "demo",
        details: "Created sample categories, products, customers, orders, payments, and stock movements.",
        createdAt: new Date(),
      }, { session });
    });

    console.log("Demo data created: 3 categories, 6 products, 4 customers, and 5 orders.");
    console.log("These records use DEMO- product/order identifiers and example.invalid customer emails.");
  } finally {
    await closeDatabase();
  }
}

seedDemo().catch((error) => {
  console.error("Could not seed demo data.", error);
  process.exitCode = 1;
});
