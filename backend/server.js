const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { closeDatabase, connectDatabase, getDatabase } = require("./src/database");
const apiRoutes = require("./src/routes");

const app = express();
const port = Number(process.env.PORT || 3001);
const frontendPages = path.resolve(__dirname, "..", "frontend", "pages");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const proxyHops = process.env.TRUST_PROXY_HOPS === undefined
  ? 0
  : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isSafeInteger(proxyHops) || proxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
}

function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 64 || new Set(secret).size < 16 || /replace|example|sample|changeme/i.test(secret)) {
    throw new Error("Production requires a unique, randomly generated JWT_SECRET of at least 64 characters.");
  }
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) {
    throw new Error("Production requires MONGODB_URI and MONGODB_DB.");
  }
}

async function assertNoDemoData(db) {
  const [demoAudit, demoCategory, demoProduct, demoCustomer, demoOrder, demoPayment, demoMovement] = await Promise.all([
    db.collection("audit_logs").findOne({ entityType: "demo_seed", entityId: "demo" }, { projection: { _id: 1 } }),
    db.collection("categories").findOne({ nameKey: /^demo-/i }, { projection: { _id: 1 } }),
    db.collection("products").findOne({ sku: /^DEMO-/i }, { projection: { _id: 1 } }),
    db.collection("customers").findOne({ email: /^demo-.*@example\.invalid$/i }, { projection: { _id: 1 } }),
    db.collection("orders").findOne({ orderNumber: /^DEMO-/i }, { projection: { _id: 1 } }),
    db.collection("payments").findOne({ reference: /^DEMO-/i }, { projection: { _id: 1 } }),
    db.collection("stock_movements").findOne({ reference: /^DEMO-/i }, { projection: { _id: 1 } }),
  ]);
  if (demoAudit || demoCategory || demoProduct || demoCustomer || demoOrder || demoPayment || demoMovement) {
    throw new Error("Production startup is blocked because this database contains demo seed records. Preserve this dataset and configure a separate production database.");
  }
}

const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ success: false, message: "Too many requests. Please try again later." });
  },
});

app.disable("x-powered-by");
app.set("trust proxy", proxyHops);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  strictTransportSecurity: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));
app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) response.setHeader("Cache-Control", "no-store");
  const origin = request.get("origin");
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let sameOrigin = false;
  if (origin) {
    try {
      sameOrigin = new URL(origin).host === request.get("host");
    } catch {
      sameOrigin = false;
    }
  }
  if (origin && !sameOrigin && !allowedOrigins.includes(origin)) {
    response.status(403).json({ success: false, message: "This origin is not allowed to access the API." });
    return;
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
  }
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  next();
});
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", async (request, response, next) => {
  try {
    await (await getDatabase()).command({ ping: 1 });
    response.json({ success: true, data: { status: "ok", database: "connected" } });
  } catch (error) {
    next(error);
  }
});
app.get("/api/health/live", (_request, response) => {
  response.json({ success: true, data: { status: "ok" } });
});
app.get("/api/config", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    success: true,
    data: { paymentSimulationEnabled: process.env.NODE_ENV !== "production" },
  });
});
app.use("/api", apiRateLimit, apiRoutes);

app.get("/", (request, response) => {
  response.sendFile(path.join(frontendPages, "index.html"));
});

app.get(["/index.html", "/pages/index.html"], (request, response) => {
  response.redirect(302, "/");
});

const legacyPageRoutes = {
  "/admin-login.html": "login",
  "/dashboard.html": "dashboard",
  "/business-overview.html": "reports",
  "/products.html": "products",
  "/products-preview.html": "products",
  "/categories.html": "categories",
  "/inventory.html": "inventory",
  "/orders.html": "orders",
  "/order-details.html": "orders",
  "/shipping-delivery.html": "shipping",
  "/customers.html": "customers",
  "/payments.html": "payments",
  "/reports-analytics.html": "reports",
  "/external-api-imports.html": "imports",
  "/notifications.html": "notifications",
  "/staff-roles.html": "staff",
  "/activity-logs.html": "activity",
  "/settings.html": "settings",
};

app.get(Object.keys(legacyPageRoutes), (request, response) => {
  response.redirect(302, `/#${legacyPageRoutes[request.path]}`);
});

app.use(
  "/vendor/bootstrap",
  express.static(path.join(__dirname, "node_modules", "bootstrap", "dist")),
);
app.use("/assets", express.static(path.join(frontendPages, "assets")));

app.use("/api", (request, response) => {
  response.status(404).json({
    success: false,
    message: "API route not found.",
  });
});

app.use((request, response, next) => {
  if (request.method === "GET" && path.extname(request.path).toLowerCase() === ".html") {
    response.redirect(302, "/#dashboard");
    return;
  }
  next();
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : error.code === 11000
      ? 409
      : 500;
  if (status === 500) {
    console.error("API request failed.", error);
  }
  response.status(status).json({
    success: false,
    message: status === 500
      ? "An unexpected server error occurred."
      : error.code === 11000
        ? "A record with this value already exists."
        : error.message,
  });
});

if (require.main === module) {
  validateProductionConfig();
  connectDatabase()
    .then(async (db) => {
      if (process.env.NODE_ENV === "production") await assertNoDemoData(db);
      const server = app.listen(port, () => {
        console.log(`TechMart is available at http://localhost:${port}`);
      });
      let shuttingDown = false;
      const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.info(`Received ${signal}; stopping the HTTP server.`);
        const timeout = setTimeout(() => {
          console.error("Graceful shutdown timed out; closing active HTTP connections.");
          server.closeAllConnections();
        }, 10000);
        timeout.unref();
        server.close(async (error) => {
          clearTimeout(timeout);
          if (error) {
            console.error("Could not close the HTTP server cleanly.", error);
            process.exitCode = 1;
          }
          try {
            await closeDatabase();
          } catch (closeError) {
            console.error("Could not close the MongoDB client cleanly.", closeError);
            process.exitCode = 1;
          }
        });
      };
      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch(async (error) => {
      console.error("Could not complete TechMart startup.", error);
      await closeDatabase().catch((closeError) => {
        console.error("Could not close the MongoDB client cleanly.", closeError);
      });
      process.exitCode = 1;
    });
}

app.validateProductionConfig = validateProductionConfig;
app.assertNoDemoData = assertNoDemoData;
module.exports = app;
