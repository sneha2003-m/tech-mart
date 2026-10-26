const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const app = require("../../backend/server");

test("HTTP responses include security headers and do not cache runtime config", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/config`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).data.paymentSimulationEnabled, true);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("invalid auth mode is rejected before database access", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        password: "not-a-real-password",
        authMode: "unsupported",
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /authMode must be bearer or cookie/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("login rate limit returns the standard API error response", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const responses = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      responses.push(await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "invalid", password: "invalid" }),
      }));
    }
    assert.equal(responses[0].status, 400);
    assert.equal(responses[4].status, 429);
    assert.deepEqual(await responses[4].json(), {
      success: false,
      message: "Too many sign-in attempts. Try again later.",
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("an invalid HttpOnly session cookie is rejected as an invalid token", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { cookie: "techmart_session=not-a-jwt" },
    });
    assert.equal(response.status, 401);
    assert.match((await response.json()).message, /authentication token is invalid or expired/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("production startup rejects weak or missing deployment secrets", () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB: process.env.MONGODB_DB,
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "short";
    process.env.MONGODB_URI = "mongodb://localhost";
    process.env.MONGODB_DB = "techmart";
    assert.throws(app.validateProductionConfig, /JWT_SECRET/);

    process.env.JWT_SECRET = "a".repeat(64);
    assert.throws(app.validateProductionConfig, /JWT_SECRET/);
    process.env.JWT_SECRET = "0123456789abcdef".repeat(4);
    delete process.env.MONGODB_URI;
    assert.throws(app.validateProductionConfig, /MONGODB_URI and MONGODB_DB/);

    process.env.MONGODB_URI = "mongodb://localhost";
    assert.doesNotThrow(app.validateProductionConfig);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("production startup refuses demo-tagged records without changing them", async () => {
  const db = {
    collection(name) {
      return {
        findOne: async () => (name === "payments" ? { _id: "existing-demo-payment" } : null),
      };
    },
  };
  await assert.rejects(app.assertNoDemoData(db), /database contains demo seed records/);
});

test("demo seed and clear scripts refuse production mode before database access", () => {
  for (const script of ["seed-demo.js", "clear-demo.js"]) {
    assert.throws(
      () => execFileSync(process.execPath, [
        path.join(__dirname, "..", "..", "backend", "scripts", script),
      ], {
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
        stdio: "pipe",
      }),
      (error) => error.status === 1 && error.stderr.toString().includes("cannot be"),
    );
  }
});
