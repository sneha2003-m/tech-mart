const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const { closeDatabase, getDatabase, getNextId } = require("../src/database");

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Set ADMIN_EMAIL to a valid email address.");
  }
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("Set ADMIN_PASSWORD to a password of at least 12 characters.");
  }

  try {
    const db = await getDatabase();
    const hash = await bcrypt.hash(password, 12);
    const collection = db.collection("staff_users");
    const existing = await collection.findOne({ email });
    const values = {
      passwordHash: hash,
      role: "Administrator",
      active: true,
    };
    if (existing) {
      await collection.updateOne({ id: existing.id }, { $set: values, $inc: { tokenVersion: 1 } });
    } else {
      await collection.insertOne({
        id: await getNextId(db, "staff_users"),
        email,
        ...values,
        tokenVersion: 0,
        createdAt: new Date(),
      });
    }
    console.log(`Administrator account is ready for ${email}.`);
  } finally {
    await closeDatabase();
  }
}

seedAdmin()
  .catch((error) => {
    console.error("Could not create the administrator account.", error);
    process.exitCode = 1;
  });
