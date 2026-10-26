const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { getDatabase, getNextId, withTransaction } = require("./database");
const { allowRoles, getJwtSecret, requireAuth, roles } = require("./auth");
const { asyncRoute, httpError, isPositiveInteger } = require("./http");

const router = express.Router();
const admin = allowRoles("Administrator");
const inventoryStaff = allowRoles("Administrator", "Inventory Staff");
const orderStaff = allowRoles("Administrator", "Order / Operations Staff");
const readStaff = allowRoles(...roles);
const now = () => new Date();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ success: false, message: "Too many sign-in attempts. Try again later." });
  },
});

function requireText(value, name, maxLength = 255) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw httpError(400, `${name} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function requireMoney(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 999999999) {
    throw httpError(400, `${name} must be a number between 0 and 999999999.`);
  }
  return value;
}

function requireStockCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4294967295) {
    throw httpError(400, `${name} must be an integer between 0 and 4294967295.`);
  }
  return value;
}

function parsePage(value, fallback, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw httpError(400, `Pagination values must be between 1 and ${maximum}.`);
  }
  return parsed;
}

function parseDateRange(query) {
  const from = query.from === undefined ? null : new Date(`${query.from}T00:00:00.000Z`);
  const to = query.to === undefined ? null : new Date(`${query.to}T00:00:00.000Z`);
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))
      || (from && from.toISOString().slice(0, 10) !== query.from)
      || (to && to.toISOString().slice(0, 10) !== query.to)) {
    throw httpError(400, "from and to must be valid dates in YYYY-MM-DD format.");
  }
  if (from && to && from > to) throw httpError(400, "from must be on or before to.");
  const filter = {};
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) {
      const exclusiveTo = new Date(to);
      exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);
      filter.createdAt.$lt = exclusiveTo;
    }
  }
  return filter;
}

async function recordAudit(db, request, action, entityType, entityId, details, session) {
  await db.collection("audit_logs").insertOne({
    id: await getNextId(db, "audit_logs", session),
    actorId: Number(request.user.sub),
    actorEmail: request.user.email,
    action,
    entityType,
    entityId: entityId == null ? null : String(entityId),
    details: String(details || "").slice(0, 1000),
    createdAt: now(),
  }, { session });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicProduct(product, category) {
  return {
    id: product.id,
    ...(product.externalId ? { externalId: product.externalId } : {}),
    name: product.name,
    sku: product.sku,
    categoryId: product.categoryId ?? null,
    ...(category === undefined ? {} : { category: category?.name ?? null }),
    price: product.price,
    quantity: product.quantity,
    threshold: product.threshold,
    active: product.active,
    ...(product.createdAt ? { createdAt: product.createdAt } : {}),
  };
}

async function getCategoryMap(db, categoryIds) {
  const ids = [...new Set(categoryIds.filter((id) => id != null))];
  if (!ids.length) return new Map();
  const categories = await db.collection("categories").find({ id: { $in: ids } }).toArray();
  return new Map(categories.map((category) => [category.id, category]));
}

router.post("/auth/login", loginRateLimit, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = request.body?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || !password) {
    throw httpError(400, "A valid email and password are required.");
  }
  if (request.body?.authMode !== undefined
      && request.body.authMode !== "bearer"
      && request.body.authMode !== "cookie") {
    throw httpError(400, "authMode must be bearer or cookie.");
  }

  const db = await getDatabase();
  const user = await db.collection("staff_users").findOne({ email, active: true });
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!passwordMatches) throw httpError(401, "Email or password is incorrect.");

  const token = jwt.sign(
    { email: user.email, role: user.role, jti: randomUUID(), tokenVersion: user.tokenVersion ?? 0 },
    getJwtSecret(),
    { subject: String(user.id), expiresIn: "8h" },
  );
  const bearerMode = request.body?.authMode === "bearer";
  if (!bearerMode) {
    response.cookie("techmart_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api",
      ...(request.body.remember === true ? { maxAge: 8 * 60 * 60 * 1000 } : {}),
    });
  }
  response.json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, role: user.role },
      ...(bearerMode ? { token } : {}),
    },
  });
}));

router.get("/auth/me", requireAuth, (request, response) => {
  response.json({
    success: true,
    data: { id: request.user.sub, email: request.user.email, role: request.user.role },
  });
});

router.post("/auth/logout", requireAuth, asyncRoute(async (request, response) => {
  const db = await getDatabase();
  await db.collection("revoked_tokens").updateOne(
    { jti: request.user.jti },
    {
      $setOnInsert: {
        jti: request.user.jti,
        userId: Number(request.user.sub),
        expiresAt: new Date(request.user.exp * 1000),
      },
    },
    { upsert: true },
  );
  response.clearCookie("techmart_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
  });
  response.status(204).end();
}));

router.get("/categories", requireAuth, readStaff, asyncRoute(async (request, response) => {
  const db = await getDatabase();
  const categories = await db.collection("categories")
    .find({})
    .sort({ nameKey: 1 })
    .project({ _id: 0, nameKey: 0 })
    .toArray();
  response.json({ success: true, data: categories });
}));

router.patch("/categories/:id", requireAuth, admin, asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  if (!isPositiveInteger(id)) throw httpError(400, "Category id must be a positive integer.");
  const keys = Object.keys(request.body || {});
  if (!keys.length || keys.some((key) => !["name", "description", "active"].includes(key))) {
    throw httpError(400, "Provide supported category fields: name, description, or active.");
  }
  const update = {};
  if (Object.hasOwn(request.body, "name")) {
    update.name = requireText(request.body.name, "name");
    update.nameKey = update.name.toLocaleLowerCase("en");
  }
  if (Object.hasOwn(request.body, "description")) {
    update.description = request.body.description === null
      ? null
      : requireText(request.body.description, "description", 1000);
  }
  if (Object.hasOwn(request.body, "active")) {
    if (typeof request.body.active !== "boolean") throw httpError(400, "active must be a boolean.");
    update.active = request.body.active;
  }
  const db = await getDatabase();
  const category = await db.collection("categories").findOneAndUpdate(
    { id },
    { $set: update },
    { returnDocument: "after", includeResultMetadata: false },
  );
  if (!category) throw httpError(404, "Category not found.");
  await recordAudit(db, request, "Updated category", "category", id, JSON.stringify(update));
  response.json({ success: true, data: { id, name: category.name, description: category.description, active: category.active } });
}));

router.delete("/categories/:id", requireAuth, admin, asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  if (!isPositiveInteger(id)) throw httpError(400, "Category id must be a positive integer.");
  const db = await getDatabase();
  const result = await db.collection("categories").updateOne({ id, active: true }, { $set: { active: false } });
  if (!result.matchedCount) throw httpError(404, "Active category not found.");
  await recordAudit(db, request, "Deactivated category", "category", id, "Category retained for historical product references.");
  response.status(204).end();
}));

router.get("/dashboard/summary", requireAuth, readStaff, asyncRoute(async (request, response) => {
  const db = await getDatabase();
  const orderFilter = parseDateRange(request.query);
  const [orders, totalProducts, lowStockProducts] = await Promise.all([
    db.collection("orders").find(orderFilter, { projection: { total: 1, status: 1, paymentStatus: 1 } }).toArray(),
    db.collection("products").countDocuments({ active: true }),
    db.collection("products").countDocuments({ active: true, $expr: { $lte: ["$quantity", "$threshold"] } }),
  ]);
  const summary = orders.reduce((totals, order) => {
    totals.orderCount++;
    if (order.status === "Pending") totals.pendingOrders++;
    if (order.paymentStatus === "Pending") {
      totals.pendingPayments++;
      totals.pendingPaymentAmount += order.total;
    }
    if (order.paymentStatus === "Paid" && order.status !== "Cancelled") totals.revenue += order.total;
    return totals;
  }, { revenue: 0, orderCount: 0, pendingOrders: 0, totalProducts, lowStockProducts, pendingPayments: 0, pendingPaymentAmount: 0 });
  response.json({ success: true, data: summary });
}));

router.post("/categories", requireAuth, admin, asyncRoute(async (request, response) => {
  const name = requireText(request.body?.name, "name");
  const description = request.body?.description == null
    ? null
    : requireText(request.body.description, "description", 1000);
  const db = await getDatabase();
  const category = {
    id: await getNextId(db, "categories"),
    name,
    nameKey: name.toLocaleLowerCase("en"),
    description,
    active: true,
    createdAt: now(),
  };
  await db.collection("categories").insertOne(category);
  await recordAudit(db, request, "Created category", "category", category.id, name);
  response.status(201).json({
    success: true,
    data: { id: category.id, name, description, active: true },
  });
}));

router.get("/products", requireAuth, readStaff, asyncRoute(async (request, response) => {
  const page = parsePage(request.query.page, 1, 100000);
  const limit = parsePage(request.query.limit, 50, 100);
  const filter = {};
  if (request.query.includeInactive !== "true") filter.active = true;
  else if (request.user.role !== "Administrator" && request.user.role !== "Inventory Staff") {
    throw httpError(403, "Your account cannot view inactive products.");
  }
  if (request.query.q !== undefined) {
    const query = requireText(request.query.q, "q", 100);
    const expression = new RegExp(escapeRegex(query), "i");
    filter.$or = [{ name: expression }, { sku: expression }];
  }
  if (request.query.categoryId !== undefined) {
    const categoryId = Number(request.query.categoryId);
    if (!isPositiveInteger(categoryId)) throw httpError(400, "categoryId must be a positive integer.");
    filter.categoryId = categoryId;
  }
  if (request.query.lowStock === "true") filter.$expr = { $lte: ["$quantity", "$threshold"] };
  else if (request.query.lowStock !== undefined && request.query.lowStock !== "false") {
    throw httpError(400, "lowStock must be true or false.");
  }

  const db = await getDatabase();
  const productsCollection = db.collection("products");
  const [products, total] = await Promise.all([
    productsCollection.find(filter, { projection: { _id: 0, skuKey: 0 } })
      .sort({ id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    productsCollection.countDocuments(filter),
  ]);
  const categories = await getCategoryMap(db, products.map((product) => product.categoryId));
  response.json({
    success: true,
    data: products.map((product) => publicProduct(product, categories.get(product.categoryId))),
    pagination: { page, limit, total },
  });
}));

router.post("/products", requireAuth, inventoryStaff, asyncRoute(async (request, response) => {
  const name = requireText(request.body?.name, "name");
  const sku = requireText(request.body?.sku, "sku", 80);
  const price = requireMoney(request.body?.price, "price");
  const quantity = requireStockCount(request.body?.quantity ?? 0, "quantity");
  const threshold = requireStockCount(request.body?.threshold ?? 5, "threshold");
  const categoryId = request.body?.categoryId ?? null;
  if (categoryId !== null && !isPositiveInteger(categoryId)) {
    throw httpError(400, "categoryId must be a positive integer or null.");
  }

  const product = await withTransaction(async (db, session) => {
    if (categoryId !== null && !await db.collection("categories").findOne({ id: categoryId, active: true }, { session })) {
      throw httpError(400, "categoryId does not refer to an active category.");
    }
    const document = {
      id: await getNextId(db, "products", session),
      name,
      sku,
      skuKey: sku.toLocaleLowerCase("en"),
      categoryId,
      price,
      quantity,
      threshold,
      active: true,
      createdAt: now(),
    };
    await db.collection("products").insertOne(document, { session });
    if (quantity > 0) {
      const actor = await db.collection("staff_users").findOne(
        { id: Number(request.user.sub) },
        { projection: { email: 1 }, session },
      );
      await db.collection("stock_movements").insertOne({
        id: await getNextId(db, "stock_movements", session),
        productId: document.id,
        productName: document.name,
        sku: document.sku,
        changeQuantity: quantity,
        reason: "Initial stock",
        reference: "product-created",
        actorId: Number(request.user.sub),
        actorEmail: actor?.email ?? null,
        createdAt: now(),
      }, { session });
    }
    await recordAudit(db, request, "Created product", "product", document.id, `SKU ${sku}; quantity ${quantity}`, session);
    return document;
  });
  response.status(201).json({ success: true, data: publicProduct(product) });
}));

router.patch("/products/:id", requireAuth, inventoryStaff, asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  if (!isPositiveInteger(id)) throw httpError(400, "Product id must be a positive integer.");
  const allowed = ["name", "sku", "price", "quantity", "threshold", "categoryId", "active"];
  const keys = Object.keys(request.body || {});
  if (!keys.length || keys.some((key) => !allowed.includes(key))) {
    throw httpError(400, "Provide one or more supported product fields.");
  }

  const update = {};
  for (const key of keys) {
    const value = request.body[key];
    if (key === "name") update.name = requireText(value, key);
    else if (key === "sku") {
      update.sku = requireText(value, key, 80);
      update.skuKey = update.sku.toLocaleLowerCase("en");
    } else if (key === "price") update.price = requireMoney(value, key);
    else if (key === "quantity") update.quantity = requireStockCount(value, key);
    else if (key === "threshold") update.threshold = requireStockCount(value, key);
    else if (key === "active") {
      if (value !== true) throw httpError(403, "Products must be deactivated through the administrator-only DELETE operation.");
      update.active = true;
    }
    else if (key === "categoryId") {
      if (value !== null && !isPositiveInteger(value)) {
        throw httpError(400, "categoryId must be a positive integer or null.");
      }
      update.categoryId = value;
    }
  }

  const product = await withTransaction(async (db, session) => {
    const products = db.collection("products");
    const existing = await products.findOne({ id }, { session });
    if (!existing) throw httpError(404, "Product not found.");
    if (!existing.active && update.active !== true) throw httpError(404, "Product not found.");
    if (update.categoryId != null && !await db.collection("categories").findOne({ id: update.categoryId, active: true }, { session })) {
      throw httpError(400, "categoryId does not refer to an active category.");
    }
    if (Object.hasOwn(update, "quantity") && update.quantity !== existing.quantity) {
      const changeQuantity = update.quantity - existing.quantity;
      const actor = await db.collection("staff_users").findOne({ id: Number(request.user.sub) }, { projection: { email: 1 }, session });
      await db.collection("stock_movements").insertOne({
        id: await getNextId(db, "stock_movements", session),
        productId: id,
        productName: existing.name,
        sku: existing.sku,
        changeQuantity,
        reason: "Product edit stock correction",
        reference: null,
        actorId: Number(request.user.sub),
        actorEmail: actor?.email ?? null,
        createdAt: now(),
      }, { session });
    }
    const result = await products.updateOne({ id, active: existing.active }, { $set: update }, { session });
    if (!result.matchedCount) throw httpError(409, "Product changed; reload and try again.");
    await recordAudit(db, request, "Updated product", "product", id, JSON.stringify(update), session);
    return products.findOne({ id }, { projection: { _id: 0, skuKey: 0 }, session });
  });
  response.json({ success: true, data: publicProduct(product) });
}));

router.delete("/products/:id", requireAuth, admin, asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  if (!isPositiveInteger(id)) throw httpError(400, "Product id must be a positive integer.");
  const result = await (await getDatabase()).collection("products").updateOne(
    { id, active: true },
    { $set: { active: false } },
  );
  if (!result.matchedCount) throw httpError(404, "Product not found.");
  await recordAudit(await getDatabase(), request, "Deactivated product", "product", id, "Product retained for order history.");
  response.status(204).end();
}));

router.get("/customers", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  const page = parsePage(request.query.page, 1, 100000);
  const limit = parsePage(request.query.limit, 50, 100);
  const query = request.query.q === undefined ? "" : requireText(request.query.q, "q", 100);
  const filter = query
    ? { $or: [{ name: new RegExp(escapeRegex(query), "i") }, { email: new RegExp(escapeRegex(query), "i") }] }
    : {};
  const db = await getDatabase();
  const [customers, total] = await Promise.all([
    db.collection("customers").find(filter, { projection: { _id: 0 } })
    .sort({ id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray(),
    db.collection("customers").countDocuments(filter),
  ]);
  response.json({ success: true, data: customers, pagination: { page, limit, total } });
}));

router.post("/customers", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  const name = requireText(request.body?.name, "name");
  const email = requireText(request.body?.email, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "email must be valid.");
  const phone = request.body?.phone == null ? null : requireText(request.body.phone, "phone", 40);
  const db = await getDatabase();
  const customer = {
    id: await getNextId(db, "customers"),
    name,
    email,
    phone,
    orderCount: 0,
    totalSpent: 0,
    createdAt: now(),
  };
  await db.collection("customers").insertOne(customer);
  await recordAudit(db, request, "Created customer", "customer", customer.id, email);
  response.status(201).json({
    success: true,
    data: { id: customer.id, name, email, phone },
  });
}));

router.get("/orders", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  const page = parsePage(request.query.page, 1, 100000);
  const limit = parsePage(request.query.limit, 50, 100);
  const filter = {};
  if (request.query.status !== undefined) {
    if (!["Pending", "Processing", "Shipped", "Delivered", "Cancelled"].includes(request.query.status)) {
      throw httpError(400, "status is not supported.");
    }
    filter.status = request.query.status;
  }
  if (request.query.paymentStatus !== undefined) {
    if (!["Pending", "Paid", "Failed", "Refunded"].includes(request.query.paymentStatus)) {
      throw httpError(400, "paymentStatus is not supported.");
    }
    filter.paymentStatus = request.query.paymentStatus;
  }
  if (request.query.q !== undefined) {
    const query = requireText(request.query.q, "q", 100);
    filter.orderNumber = new RegExp(escapeRegex(query), "i");
  }
  const db = await getDatabase();
  const [orders, total] = await Promise.all([
    db.collection("orders").find(filter, { projection: { _id: 0 } })
    .sort({ id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray(),
    db.collection("orders").countDocuments(filter),
  ]);
  const customerIds = [...new Set(orders.map((order) => order.customerId))];
  const customers = customerIds.length
    ? await db.collection("customers").find({ id: { $in: customerIds } }).toArray()
    : [];
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  response.json({
    success: true,
    data: orders.map((order) => ({
      id: order.id,
      number: order.orderNumber,
      customerId: order.customerId,
      customer: customerNames.get(order.customerId) ?? null,
      total: order.total,
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
    })),
    pagination: { page, limit, total },
  });
}));

router.get("/orders/:id", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  if (!isPositiveInteger(id)) throw httpError(400, "Order id must be a positive integer.");
  const db = await getDatabase();
  const order = await db.collection("orders").findOne({ id }, { projection: { _id: 0 } });
  if (!order) throw httpError(404, "Order not found.");
  const [customer, payments] = await Promise.all([
    db.collection("customers").findOne({ id: order.customerId }, { projection: { _id: 0, password: 0 } }),
    db.collection("payments").find({ orderId: id }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
  ]);
  response.json({
    success: true,
    data: {
      ...order,
      customer: customer ? { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone } : null,
      payments,
    },
  });
}));

router.post("/orders", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  const customerId = request.body?.customerId;
  const items = request.body?.items;
  if (!isPositiveInteger(customerId)) throw httpError(400, "customerId must be a positive integer.");
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    throw httpError(400, "items must contain between 1 and 100 products.");
  }
  const quantities = new Map();
  for (const item of items) {
    if (!item || !isPositiveInteger(item.productId) || !isPositiveInteger(item.quantity)) {
      throw httpError(400, "Each item must have a positive productId and quantity.");
    }
    const combinedQuantity = (quantities.get(item.productId) || 0) + item.quantity;
    if (!Number.isSafeInteger(combinedQuantity) || combinedQuantity > 4294967295) {
      throw httpError(400, "The combined quantity for a product exceeds the stock limit.");
    }
    quantities.set(item.productId, combinedQuantity);
  }

  const order = await withTransaction(async (db, session) => {
    if (!await db.collection("customers").findOne({ id: customerId }, { session })) {
      throw httpError(404, "Customer not found.");
    }
    const productIds = [...quantities.keys()].sort((a, b) => a - b);
    const products = await db.collection("products")
      .find({ id: { $in: productIds }, active: true }, { session })
      .sort({ id: 1 })
      .toArray();
    if (products.length !== productIds.length) {
      throw httpError(400, "One or more products are unavailable.");
    }
    const byId = new Map(products.map((product) => [product.id, product]));
    let total = 0;
    for (const [productId, quantity] of quantities) {
      const product = byId.get(productId);
      if (product.quantity < quantity) throw httpError(409, `Insufficient stock for ${product.name}.`);
      total += product.price * quantity;
      if (total > 9999999999.99) throw httpError(400, "The order total exceeds the supported amount.");
    }

    const orderNumber = `TM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const orderId = await getNextId(db, "orders", session);
    const createdAt = now();
    const actor = await db.collection("staff_users").findOne(
      { id: Number(request.user.sub) },
      { projection: { email: 1 }, session },
    );
    const orderItems = [...quantities].map(([productId, quantity]) => {
      const product = byId.get(productId);
      return {
        productId,
        name: product.name,
        sku: product.sku,
        quantity,
        unitPrice: product.price,
      };
    });
    await db.collection("orders").insertOne({
      id: orderId,
      orderNumber,
      customerId,
      items: orderItems,
      total,
      status: "Pending",
      paymentStatus: "Pending",
      createdAt,
      statusHistory: [{
        status: "Pending",
        changedAt: createdAt,
        actorId: Number(request.user.sub),
        actorEmail: actor?.email ?? null,
        note: "Order created",
      }],
    }, { session });

    for (const [productId, quantity] of quantities) {
      const product = byId.get(productId);
      const stockUpdate = await db.collection("products").updateOne(
        { id: productId, active: true, quantity: { $gte: quantity } },
        { $inc: { quantity: -quantity } },
        { session },
      );
      if (!stockUpdate.matchedCount) throw httpError(409, `Insufficient stock for ${product.name}.`);
      await db.collection("stock_movements").insertOne({
        id: await getNextId(db, "stock_movements", session),
        productId,
        productName: product.name,
        sku: product.sku,
        changeQuantity: -quantity,
        reason: "Order placed",
        reference: orderNumber,
        actorId: Number(request.user.sub),
        actorEmail: actor?.email ?? null,
        createdAt,
      }, { session });
    }
    await db.collection("customers").updateOne(
      { id: customerId },
      { $inc: { orderCount: 1, totalSpent: total } },
      { session },
    );
    await db.collection("payments").insertOne({
      id: await getNextId(db, "payments", session),
      orderId,
      amount: total,
      status: "Pending",
      reference: null,
      method: "Simulated",
      createdAt,
    }, { session });
    await recordAudit(db, request, "Created order", "order", orderId, `${orderNumber}; total ${total}`, session);
    return { id: orderId, number: orderNumber, customerId, total, status: "Pending", paymentStatus: "Pending" };
  });
  response.status(201).json({ success: true, data: order });
}));

router.patch("/orders/:id/status", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  const nextStatus = request.body?.status;
  const transitions = {
    Pending: ["Processing", "Cancelled"],
    Processing: ["Shipped", "Cancelled"],
    Shipped: ["Delivered"],
    Delivered: [],
    Cancelled: [],
  };
  if (!isPositiveInteger(id)) throw httpError(400, "Order id must be a positive integer.");
  if (!Object.hasOwn(transitions, nextStatus)) throw httpError(400, "status is not supported.");

  await withTransaction(async (db, session) => {
    const orders = db.collection("orders");
    const order = await orders.findOne({ id }, { session });
    if (!order) throw httpError(404, "Order not found.");
    if (!transitions[order.status].includes(nextStatus)) {
      throw httpError(409, `Order cannot transition from ${order.status} to ${nextStatus}.`);
    }
    const update = await orders.updateOne(
      { id, status: order.status },
      { $set: { status: nextStatus }, $push: { statusHistory: {
        $each: [{
          status: nextStatus,
          changedAt: now(),
          actorId: Number(request.user.sub),
          actorEmail: request.user.email,
          note: typeof request.body?.note === "string" ? request.body.note.trim().slice(0, 255) || null : null,
        }],
        $slice: -20,
      } } },
      { session },
    );
    if (!update.matchedCount) throw httpError(409, "The order status changed; reload and try again.");

    const actor = await db.collection("staff_users").findOne(
      { id: Number(request.user.sub) },
      { projection: { email: 1 }, session },
    );
    if (nextStatus === "Cancelled") {
      for (const item of order.items) {
        await db.collection("products").updateOne(
          { id: item.productId },
          { $inc: { quantity: item.quantity } },
          { session },
        );
        const product = await db.collection("products").findOne(
          { id: item.productId },
          { projection: { name: 1, sku: 1 }, session },
        );
        await db.collection("stock_movements").insertOne({
          id: await getNextId(db, "stock_movements", session),
          productId: item.productId,
          productName: product?.name ?? item.name,
          sku: product?.sku ?? item.sku,
          changeQuantity: item.quantity,
          reason: "Order cancelled",
          reference: order.orderNumber,
          actorId: Number(request.user.sub),
          actorEmail: actor?.email ?? null,
          createdAt: now(),
        }, { session });
      }
    }
    await recordAudit(db, request, "Updated order status", "order", id, `${order.status} -> ${nextStatus}`, session);
  });
  response.json({ success: true, data: { id, status: nextStatus } });
}));

router.get("/inventory/movements", requireAuth, inventoryStaff, asyncRoute(async (request, response) => {
  const db = await getDatabase();
  const movements = await db.collection("stock_movements")
    .find({}, { projection: { _id: 0 } })
    .sort({ id: -1 })
    .limit(200)
    .map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      product: movement.productName,
      sku: movement.sku,
      changeQuantity: movement.changeQuantity,
      reason: movement.reason,
      reference: movement.reference,
      createdAt: movement.createdAt,
      actor: movement.actorEmail,
    }))
    .toArray();
  response.json({ success: true, data: movements });
}));

router.post("/inventory/adjustments", requireAuth, inventoryStaff, asyncRoute(async (request, response) => {
  const productId = request.body?.productId;
  const changeQuantity = request.body?.changeQuantity;
  const reason = requireText(request.body?.reason, "reason", 255);
  if (!isPositiveInteger(productId) || !Number.isSafeInteger(changeQuantity)
      || changeQuantity === 0 || Math.abs(changeQuantity) > 2147483647) {
    throw httpError(400, "productId must be positive and changeQuantity must be a non-zero integer.");
  }

  const movement = await withTransaction(async (db, session) => {
    const products = db.collection("products");
    const product = await products.findOne({ id: productId, active: true }, { session });
    if (!product) throw httpError(404, "Product not found.");
    const quantity = product.quantity + changeQuantity;
    if (quantity < 0) throw httpError(409, "An adjustment cannot make stock negative.");
    if (quantity > 4294967295) throw httpError(400, "The resulting stock exceeds the supported quantity.");
    const update = await products.updateOne(
      { id: productId, active: true, quantity: product.quantity },
      { $inc: { quantity: changeQuantity } },
      { session },
    );
    if (!update.matchedCount) throw httpError(409, "Stock changed; reload and try the adjustment again.");

    const actor = await db.collection("staff_users").findOne(
      { id: Number(request.user.sub) },
      { projection: { email: 1 }, session },
    );
    const document = {
      id: await getNextId(db, "stock_movements", session),
      productId,
      productName: product.name,
      sku: product.sku,
      changeQuantity,
      reason,
      actorId: Number(request.user.sub),
      actorEmail: actor?.email ?? null,
      reference: null,
      createdAt: now(),
    };
    await db.collection("stock_movements").insertOne(document, { session });
    await recordAudit(db, request, "Adjusted inventory", "product", productId, `${changeQuantity}; ${reason}`, session);
    return document;
  });
  response.status(201).json({
    success: true,
    data: { id: movement.id, productId, changeQuantity, reason },
  });
}));

router.get("/payments", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  const page = parsePage(request.query.page, 1, 100000);
  const limit = parsePage(request.query.limit, 50, 100);
  const filter = {};
  if (request.query.status !== undefined) {
    if (!["Pending", "Paid", "Failed", "Refunded"].includes(request.query.status)) {
      throw httpError(400, "status is not supported.");
    }
    filter.status = request.query.status;
  }
  const db = await getDatabase();
  const [payments, total] = await Promise.all([
    db.collection("payments").aggregate([
    { $match: filter },
    { $sort: { id: -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    {
      $lookup: {
        from: "orders",
        localField: "orderId",
        foreignField: "id",
        as: "orderDetails",
      },
    },
    { $unwind: "$orderDetails" },
    {
      $project: {
        _id: 0,
        id: 1,
        orderId: 1,
        orderNumber: "$orderDetails.orderNumber",
        amount: 1,
        status: 1,
        reference: 1,
        method: 1,
        createdAt: 1,
        attemptedAt: 1,
      },
    },
    ]).toArray(),
    db.collection("payments").countDocuments(filter),
  ]);
  response.json({ success: true, data: payments, pagination: { page, limit, total } });
}));

router.post("/orders/:id/payment-attempt", requireAuth, orderStaff, asyncRoute(async (request, response) => {
  if (process.env.NODE_ENV === "production") {
    throw httpError(503, "Simulated payment attempts are disabled in production.");
  }
  const orderId = Number(request.params.id);
  const outcome = request.body?.outcome;
  const method = request.body?.method == null ? "Simulated" : requireText(request.body.method, "method", 80);
  if (!isPositiveInteger(orderId)) throw httpError(400, "Order id must be a positive integer.");
  if (!["success", "failure"].includes(outcome)) throw httpError(400, "outcome must be success or failure.");

  const payment = await withTransaction(async (db, session) => {
    const orders = db.collection("orders");
    const order = await orders.findOne({ id: orderId }, { session });
    if (!order) throw httpError(404, "Order not found.");
    if (order.status === "Cancelled") throw httpError(409, "A cancelled order cannot receive a payment attempt.");
    if (order.paymentStatus === "Paid") throw httpError(409, "The order is already paid.");

    const payments = db.collection("payments");
    const pending = await payments.findOne({ orderId, status: "Pending" }, { sort: { id: -1 }, session });
    const paid = outcome === "success";
    const createdAt = now();
    const reference = `SIM-${randomUUID().slice(0, 12).toUpperCase()}`;
    let result;
    if (pending) {
      await payments.updateOne(
        { id: pending.id, status: "Pending" },
        { $set: { status: paid ? "Paid" : "Failed", method, reference, attemptedAt: createdAt } },
        { session },
      );
      result = { ...pending, status: paid ? "Paid" : "Failed", method, reference, attemptedAt: createdAt };
    } else {
      result = {
        id: await getNextId(db, "payments", session),
        orderId,
        amount: order.total,
        status: paid ? "Paid" : "Failed",
        reference,
        method,
        createdAt,
        attemptedAt: createdAt,
      };
      await payments.insertOne(result, { session });
    }
    await orders.updateOne({ id: orderId }, { $set: { paymentStatus: paid ? "Paid" : "Failed" } }, { session });
    await recordAudit(db, request, `Simulated payment ${paid ? "success" : "failure"}`, "payment", result.id, `${order.orderNumber}; ${reference}`, session);
    return result;
  });
  response.status(201).json({ success: true, data: { id: payment.id, orderId, status: payment.status, reference: payment.reference, method: payment.method } });
}));

router.get("/reports/sales", requireAuth, readStaff, asyncRoute(async (request, response) => {
  const db = await getDatabase();
  const dateFilter = parseDateRange(request.query);
  const orders = await db.collection("orders").find(dateFilter, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
  const eligible = orders.filter((order) => order.paymentStatus === "Paid" && order.status !== "Cancelled");
  const productSales = new Map();
  const dailySales = new Map();
  for (const order of eligible) {
    const day = order.createdAt.toISOString().slice(0, 10);
    dailySales.set(day, (dailySales.get(day) || 0) + order.total);
    for (const item of order.items) {
      const current = productSales.get(item.productId) || { productId: item.productId, name: item.name, sku: item.sku, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.quantity * item.unitPrice;
      productSales.set(item.productId, current);
    }
  }
  response.json({
    success: true,
    data: {
      from: request.query.from || null,
      to: request.query.to || null,
      revenue: eligible.reduce((total, order) => total + order.total, 0),
      orderCount: orders.length,
      paidOrders: eligible.length,
      dailySales: [...dailySales].map(([date, revenue]) => ({ date, revenue })),
      productPerformance: [...productSales.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 100),
      orders: orders.map(({ id, orderNumber, total, status, paymentStatus, createdAt }) => ({
        id, orderNumber, total, status, paymentStatus, createdAt,
      })),
    },
  });
}));

router.get("/reports/inventory", requireAuth, readStaff, asyncRoute(async (request, response) => {
  const db = await getDatabase();
  const products = await db.collection("products").find({ active: true }, { projection: { _id: 0, skuKey: 0 } }).sort({ quantity: 1 }).toArray();
  response.json({
    success: true,
    data: {
      productCount: products.length,
      lowStockCount: products.filter((product) => product.quantity <= product.threshold).length,
      products,
    },
  });
}));

router.get("/notifications", requireAuth, readStaff, asyncRoute(async (request, response) => {
  const db = await getDatabase();
  const [products, orders, payments, readRows] = await Promise.all([
    db.collection("products").find({ active: true, $expr: { $lte: ["$quantity", "$threshold"] } }).limit(100).toArray(),
    db.collection("orders").find({ status: { $in: ["Pending", "Processing"] } }).sort({ id: -1 }).limit(100).toArray(),
    db.collection("payments").find({ status: { $in: ["Pending", "Failed"] } }).sort({ id: -1 }).limit(100).toArray(),
    db.collection("notification_reads").find({ userId: Number(request.user.sub) }).toArray(),
  ]);
  const reads = new Set(readRows.map((item) => item._id));
  const notifications = [
    ...products.map((product) => ({
      id: `stock:${product.id}`, type: "Low stock", title: `${product.name} is at or below its threshold`,
      detail: `${product.quantity} available · threshold ${product.threshold}`, createdAt: product.createdAt,
    })),
    ...orders.map((order) => ({
      id: `order:${order.id}`, type: "Order attention", title: `${order.orderNumber} is ${order.status.toLowerCase()}`,
      detail: `Order status ${order.status}; payment ${order.paymentStatus}`, createdAt: order.createdAt,
    })),
    ...payments.map((payment) => ({
      id: `payment:${payment.id}`, type: payment.status === "Failed" ? "Failed payment" : "Pending payment",
      title: `Payment ${payment.status.toLowerCase()} for order ${payment.orderId}`,
      detail: `Payment reference ${payment.reference || "pending"}`, createdAt: payment.createdAt,
    })),
  ].map((item) => ({ ...item, read: reads.has(`${request.user.sub}:${item.id}`) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const readPrefix = `${request.user.sub}:`;
  const activeIds = new Set(notifications.map((item) => item.id));
  const staleReadIds = readRows
    .filter((item) => !activeIds.has(item._id.slice(readPrefix.length)))
    .map((item) => item._id);
  if (staleReadIds.length) {
    await db.collection("notification_reads").deleteMany({ _id: { $in: staleReadIds } });
  }
  response.json({ success: true, data: notifications });
}));

router.post("/notifications/read", requireAuth, readStaff, asyncRoute(async (request, response) => {
  const ids = request.body?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 300
      || ids.some((id) => typeof id !== "string" || !/^(stock|order|payment):[1-9]\d*$/.test(id))) {
    throw httpError(400, "ids must contain one or more notification identifiers.");
  }
  const userId = Number(request.user.sub);
  const reads = dbReads(ids, userId, now());
  await (await getDatabase()).collection("notification_reads").bulkWrite(reads, { ordered: false });
  response.json({ success: true, data: { markedRead: ids.length } });
}));

function dbReads(ids, userId, readAt) {
  return [...new Set(ids)].map((id) => ({
    updateOne: {
      filter: { _id: `${userId}:${id}` },
      update: { $set: { userId, readAt } },
      upsert: true,
    },
  }));
}

router.get("/imports/history", requireAuth, readStaff, asyncRoute(async (request, response) => {
  if (!["Administrator", "Inventory Staff"].includes(request.user.role)) {
    throw httpError(403, "This account cannot view import history.");
  }
  const db = await getDatabase();
  const entries = await db.collection("audit_logs")
    .find({ entityType: "import", action: "Imported external products" }, { projection: { _id: 0 } })
    .sort({ id: -1 })
    .limit(100)
    .toArray();
  const history = entries.map((entry) => {
    const imported = entry.details.match(/(\d+) imported/);
    const updated = entry.details.match(/(\d+) updated/);
    const skipped = entry.details.match(/(\d+) skipped/);
    const failed = entry.details.match(/(\d+) failed/);
    const rate = entry.details.match(/1 USD = INR ([\d.]+)/);
    return {
      source: entry.entityId,
      createdAt: entry.createdAt,
      imported: Number(imported?.[1] || 0),
      updated: Number(updated?.[1] || 0),
      skipped: Number(skipped?.[1] || 0),
      failed: Number(failed?.[1] || 0),
      conversionRate: rate ? Number(rate[1]) : null,
      actor: entry.actorEmail,
    };
  });
  response.json({ success: true, data: history });
}));

router.get("/audit", requireAuth, admin, asyncRoute(async (request, response) => {
  const page = parsePage(request.query.page, 1, 100000);
  const limit = parsePage(request.query.limit, 50, 100);
  const db = await getDatabase();
  const [entries, total] = await Promise.all([
    db.collection("audit_logs").find({}, { projection: { _id: 0 } }).sort({ id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    db.collection("audit_logs").countDocuments(),
  ]);
  response.json({ success: true, data: entries, pagination: { page, limit, total } });
}));

router.get("/staff", requireAuth, admin, asyncRoute(async (request, response) => {
  const staff = await (await getDatabase()).collection("staff_users")
    .find({}, { projection: { _id: 0, passwordHash: 0 } }).sort({ id: -1 }).toArray();
  response.json({ success: true, data: staff });
}));

router.post("/staff", requireAuth, admin, asyncRoute(async (request, response) => {
  const email = requireText(request.body?.email, "email", 254).toLowerCase();
  const password = request.body?.password;
  const role = request.body?.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "email must be valid.");
  if (typeof password !== "string" || password.length < 12) throw httpError(400, "password must contain at least 12 characters.");
  if (!roles.includes(role)) throw httpError(400, "role is not supported.");
  const db = await getDatabase();
  const staff = {
    id: await getNextId(db, "staff_users"),
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role,
    active: true,
    tokenVersion: 0,
    createdAt: now(),
  };
  await db.collection("staff_users").insertOne(staff);
  await recordAudit(db, request, "Created staff account", "staff", staff.id, `${email}; ${role}`);
  response.status(201).json({ success: true, data: { id: staff.id, email, role, active: true } });
}));

router.patch("/staff/:id", requireAuth, admin, asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  if (!isPositiveInteger(id)) throw httpError(400, "Staff id must be a positive integer.");
  const body = request.body || {};
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !["role", "active", "password"].includes(key))) {
    throw httpError(400, "Provide role, active, and/or password.");
  }
  const update = {};
  if (Object.hasOwn(body, "role")) {
    if (!roles.includes(body.role)) throw httpError(400, "role is not supported.");
    update.role = body.role;
  }
  if (Object.hasOwn(body, "active")) {
    if (typeof body.active !== "boolean") throw httpError(400, "active must be a boolean.");
    if (id === Number(request.user.sub) && !body.active) throw httpError(400, "You cannot deactivate your own account.");
    update.active = body.active;
  }
  if (Object.hasOwn(body, "password")) {
    if (typeof body.password !== "string" || body.password.length < 12) throw httpError(400, "password must contain at least 12 characters.");
    update.passwordHash = await bcrypt.hash(body.password, 12);
  }
  const db = await getDatabase();
  const result = await db.collection("staff_users").updateOne({ id }, { $set: update, $inc: { tokenVersion: 1 } });
  if (!result.matchedCount) throw httpError(404, "Staff account not found.");
  await recordAudit(db, request, "Updated staff account", "staff", id, JSON.stringify({ ...update, passwordHash: undefined }));
  const staff = await db.collection("staff_users").findOne({ id }, { projection: { _id: 0, passwordHash: 0 } });
  response.json({ success: true, data: staff });
}));

router.get("/imports/dummyjson/preview", requireAuth, inventoryStaff, asyncRoute(async (request, response) => {
  let upstream;
  try {
    upstream = await fetch("https://dummyjson.com/products?limit=100", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw httpError(504, "The product source timed out. Try again later.");
    }
    throw httpError(502, "The product source is unavailable. Try again later.");
  }
  if (!upstream.ok) throw httpError(502, `The product source returned HTTP ${upstream.status}.`);
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    throw httpError(502, "The product source returned invalid JSON.");
  }
  if (!Array.isArray(payload.products)) throw httpError(502, "The product source returned an invalid products list.");
  const products = payload.products
    .filter((item) => item && isPositiveInteger(Number(item.id))
      && typeof item.title === "string" && item.title.trim()
      && Number.isFinite(Number(item.price)) && Number(item.price) > 0)
    .map((item) => ({
      id: Number(item.id),
      title: item.title.trim().slice(0, 255),
      category: typeof item.category === "string" ? item.category.slice(0, 100) : null,
      price: Number(item.price),
      description: typeof item.description === "string" ? item.description.slice(0, 1000) : "",
    }));
  response.json({ success: true, data: products });
}));

router.post("/imports/dummyjson", requireAuth, inventoryStaff, asyncRoute(async (request, response) => {
  const ids = request.body?.ids;
  const exchangeRate = request.body?.exchangeRate;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => !isPositiveInteger(id))) {
    throw httpError(400, "ids must contain between 1 and 100 positive product ids.");
  }
  if (typeof exchangeRate !== "number" || !Number.isFinite(exchangeRate)
      || exchangeRate <= 0 || exchangeRate > 1000000) {
    throw httpError(400, "exchangeRate must be a positive number no greater than 1000000.");
  }

  const uniqueIds = [...new Set(ids)];
  let upstream;
  try {
    upstream = await fetch("https://dummyjson.com/products?limit=100", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw httpError(504, "The product source timed out. Try again later.");
    }
    throw httpError(502, "The product source is unavailable. Try again later.");
  }
  if (!upstream.ok) throw httpError(502, `The product source returned HTTP ${upstream.status}.`);
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    throw httpError(502, "The product source returned invalid JSON.");
  }
  if (!Array.isArray(payload.products)) throw httpError(502, "The product source returned an invalid products list.");
  const selected = payload.products.filter((item) => uniqueIds.includes(Number(item.id)));
  if (selected.length !== uniqueIds.length) {
    throw httpError(400, "One or more selected product ids were not available from the product source.");
  }

  const results = { imported: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  await withTransaction(async (db, session) => {
    const categories = db.collection("categories");
    let category = await categories.findOne({ nameKey: "imported" }, { session });
    if (category) {
      await categories.updateOne({ id: category.id }, { $set: { active: true } }, { session });
    } else {
      category = {
        id: await getNextId(db, "categories", session),
        name: "Imported",
        nameKey: "imported",
        description: "Products imported from DummyJSON",
        active: true,
        createdAt: now(),
      };
      await categories.insertOne(category, { session });
    }

    const products = db.collection("products");
    for (const item of selected) {
      if (typeof item.title !== "string" || !item.title.trim()
          || !Number.isFinite(Number(item.price)) || Number(item.price) <= 0) {
        results.failed++;
        results.errors.push({ externalId: String(item.id), reason: "Product name or source price is invalid." });
        continue;
      }
      const externalId = String(item.id);
      const sku = `DUMMY-${externalId}`;
      const price = Math.round(Number(item.price) * exchangeRate * 100) / 100;
      if (!Number.isFinite(price) || price <= 0 || price > 999999999.99) {
        results.failed++;
        results.errors.push({ externalId, reason: "Converted price is outside the supported range." });
        continue;
      }

      const existing = await products.findOne({ externalId }, { session });
      if (existing) {
        await products.updateOne(
          { id: existing.id },
          { $set: { name: item.title.trim(), categoryId: category.id, price } },
          { session },
        );
        results.updated++;
        continue;
      }
      const skuOwner = await products.findOne({ skuKey: sku.toLocaleLowerCase("en") }, { session });
      if (skuOwner) {
        results.skipped++;
        continue;
      }
      await products.insertOne({
        id: await getNextId(db, "products", session),
        externalId,
        name: item.title.trim(),
        sku,
        skuKey: sku.toLocaleLowerCase("en"),
        categoryId: category.id,
        price,
        quantity: 0,
        threshold: 5,
        active: true,
        createdAt: now(),
      }, { session });
      results.imported++;
    }
    await recordAudit(
      db,
      request,
      "Imported external products",
      "import",
      "DummyJSON",
      `${results.imported} imported; ${results.updated} updated; ${results.skipped} skipped; ${results.failed} failed; 1 USD = INR ${exchangeRate}`,
      session,
    );
  });

  response.status(201).json({ success: true, data: { ...results, exchangeRate } });
}));

module.exports = router;
