const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { closeDatabase, connectDatabase } = require("../src/database");
const { collections } = require("../src/models");

async function setupDatabase() {
  try {
    const db = await connectDatabase({ updateExistingSchema: true });
    console.log(`MongoDB schema and indexes are ready in "${db.databaseName}".`);
    console.log(`Configured collections: ${Object.keys(collections).join(", ")}.`);
  } finally {
    await closeDatabase();
  }
}

setupDatabase().catch((error) => {
  console.error("Could not initialize the MongoDB schema.", error);
  process.exitCode = 1;
});
