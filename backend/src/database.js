const { MongoClient } = require("mongodb");
const { collections } = require("./models");

let client;
let database;
let connectionPromise;

async function connectDatabase({ updateExistingSchema = false } = {}) {
  if (database) return database;
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB || "techmart";
  if (!uri) {
    throw new Error("MONGODB_URI must be configured.");
  }
  if (/REPLACE_WITH|<db_password>/i.test(uri)) {
    throw new Error("Replace the password placeholder in MONGODB_URI with the URL-encoded MongoDB database-user password.");
  }

  connectionPromise = (async () => {
    const mongoClient = new MongoClient(uri, {
      appName: "TechMart Admin",
      serverSelectionTimeoutMS: 10000,
    });
    try {
      await mongoClient.connect();
      const db = mongoClient.db(databaseName);
      await initializeSchema(db, { updateExisting: updateExistingSchema });
      client = mongoClient;
      database = db;
      return db;
    } catch (error) {
      await mongoClient.close();
      throw error;
    }
  })();

  try {
    return await connectionPromise;
  } finally {
    connectionPromise = undefined;
  }
}

async function getDatabase() {
  return database || connectDatabase();
}

async function getNextId(db, collectionName, session) {
  const counter = await db.collection("counters").findOneAndUpdate(
    { _id: collectionName },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after", includeResultMetadata: false, session },
  );
  return counter.value;
}

async function initializeSchema(db, { updateExisting = false } = {}) {
  const existing = new Map(
    (await db.listCollections({}, { nameOnly: false }).toArray())
      .map((collection) => [collection.name, collection]),
  );

  for (const [name, definition] of Object.entries(collections)) {
    const collection = existing.get(name);
    if (!collection) {
      try {
        await db.createCollection(name, {
          validator: definition.validator,
          validationLevel: "strict",
          validationAction: "error",
        });
      } catch (error) {
        if (error.code !== 48) throw error;
      }
    } else if (updateExisting) {
      await db.command({
        collMod: name,
        validator: definition.validator,
        validationLevel: "strict",
        validationAction: "error",
      });
    } else if (!collection.options?.validator) {
      throw new Error(`MongoDB collection "${name}" is missing its schema validator. Run "npm run setup:db" using a database user with dbAdmin privileges.`);
    }

    if (updateExisting && name === "payments") {
      const indexes = await db.collection(name).indexes();
      const obsoleteSinglePaymentIndex = indexes.find((index) => (
        index.unique
        && Object.keys(index.key).length === 1
        && index.key.orderId === 1
      ));
      if (obsoleteSinglePaymentIndex) {
        await db.collection(name).dropIndex(obsoleteSinglePaymentIndex.name);
      }
    }

    if (definition.indexes.length) {
      await db.collection(name).createIndexes(definition.indexes);
    }
  }
}

async function withTransaction(callback) {
  const db = await getDatabase();
  const session = client.startSession();
  try {
    return await session.withTransaction(() => callback(db, session));
  } finally {
    await session.endSession();
  }
}

async function closeDatabase() {
  if (client) {
    await client.close();
    client = undefined;
    database = undefined;
  }
}

module.exports = {
  closeDatabase,
  connectDatabase,
  getDatabase,
  getNextId,
  initializeSchema,
  withTransaction,
};
