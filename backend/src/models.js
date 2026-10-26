const integer = { bsonType: ["int", "long", "double"], multipleOf: 1 };
const numeric = { bsonType: ["int", "long", "double", "decimal"] };
const timestamp = { bsonType: "date" };
const nullableString = { bsonType: ["string", "null"] };
const nullableInteger = { bsonType: [...integer.bsonType, "null"] };

const collections = {
  staff_users: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "email", "passwordHash", "role", "active", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          email: { bsonType: "string", maxLength: 254 },
          passwordHash: { bsonType: "string" },
          role: {
            bsonType: "string",
            enum: ["Administrator", "Order / Operations Staff", "Inventory Staff", "Report Viewer"],
          },
          active: { bsonType: "bool" },
          tokenVersion: { ...integer, minimum: 0 },
          createdAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { email: 1 }, unique: true },
    ],
  },
  categories: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "name", "nameKey", "description", "active", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          name: { bsonType: "string", minLength: 1, maxLength: 255 },
          nameKey: { bsonType: "string", minLength: 1, maxLength: 255 },
          description: nullableString,
          active: { bsonType: "bool" },
          createdAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { nameKey: 1 }, unique: true },
    ],
  },
  products: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "name", "sku", "skuKey", "categoryId", "price", "quantity", "threshold", "active", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          externalId: { bsonType: "string" },
          name: { bsonType: "string", minLength: 1, maxLength: 255 },
          sku: { bsonType: "string", minLength: 1, maxLength: 80 },
          skuKey: { bsonType: "string", minLength: 1, maxLength: 80 },
          categoryId: nullableInteger,
          price: { ...numeric, minimum: 0, maximum: 999999999.99 },
          quantity: { ...integer, minimum: 0, maximum: 4294967295 },
          threshold: { ...integer, minimum: 0, maximum: 4294967295 },
          active: { bsonType: "bool" },
          createdAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { skuKey: 1 }, unique: true },
      {
        key: { externalId: 1 },
        unique: true,
        partialFilterExpression: { externalId: { $type: "string" } },
      },
      { key: { active: 1, id: -1 } },
      { key: { active: 1, categoryId: 1, id: -1 } },
    ],
  },
  customers: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "name", "email", "phone", "orderCount", "totalSpent", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          name: { bsonType: "string", minLength: 1, maxLength: 255 },
          email: { bsonType: "string", maxLength: 254 },
          phone: nullableString,
          orderCount: { ...integer, minimum: 0 },
          totalSpent: { ...numeric, minimum: 0 },
          createdAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { email: 1 }, unique: true },
    ],
  },
  orders: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "orderNumber", "customerId", "items", "total", "status", "paymentStatus", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          orderNumber: { bsonType: "string", minLength: 1, maxLength: 40 },
          customerId: { ...integer, minimum: 1 },
          items: {
            bsonType: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              bsonType: "object",
              required: ["productId", "name", "sku", "quantity", "unitPrice"],
              properties: {
                productId: { ...integer, minimum: 1 },
                name: { bsonType: "string", minLength: 1, maxLength: 255 },
                sku: { bsonType: "string", minLength: 1, maxLength: 80 },
                quantity: { ...integer, minimum: 1, maximum: 4294967295 },
                unitPrice: { ...numeric, minimum: 0, maximum: 999999999.99 },
              },
            },
          },
          total: { ...numeric, minimum: 0, maximum: 9999999999.99 },
          status: {
            bsonType: "string",
            enum: ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"],
          },
          paymentStatus: {
            bsonType: "string",
            enum: ["Pending", "Paid", "Failed", "Refunded"],
          },
          createdAt: timestamp,
          statusHistory: {
            bsonType: "array",
            maxItems: 20,
            items: {
              bsonType: "object",
              required: ["status", "changedAt", "actorId", "actorEmail"],
              properties: {
                status: { bsonType: "string", enum: ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"] },
                changedAt: timestamp,
                actorId: nullableInteger,
                actorEmail: nullableString,
                note: nullableString,
              },
            },
          },
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { orderNumber: 1 }, unique: true },
      { key: { customerId: 1, id: -1 } },
    ],
  },
  payments: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "orderId", "amount", "status", "reference", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          orderId: { ...integer, minimum: 1 },
          amount: { ...numeric, minimum: 0, maximum: 9999999999.99 },
          status: {
            bsonType: "string",
            enum: ["Pending", "Paid", "Failed", "Refunded"],
          },
          reference: nullableString,
          method: nullableString,
          createdAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { orderId: 1, id: -1 } },
    ],
  },
  stock_movements: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "productId", "productName", "sku", "changeQuantity", "reason", "reference", "actorId", "actorEmail", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          productId: { ...integer, minimum: 1 },
          productName: { bsonType: "string", minLength: 1, maxLength: 255 },
          sku: { bsonType: "string", minLength: 1, maxLength: 80 },
          changeQuantity: { ...integer, minimum: -4294967295, maximum: 4294967295 },
          reason: { bsonType: "string", minLength: 1, maxLength: 255 },
          reference: nullableString,
          actorId: nullableInteger,
          actorEmail: nullableString,
          createdAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { productId: 1, id: -1 } },
    ],
  },
  audit_logs: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id", "actorId", "actorEmail", "action", "entityType", "entityId", "details", "createdAt"],
        properties: {
          id: { ...integer, minimum: 1 },
          actorId: nullableInteger,
          actorEmail: nullableString,
          action: { bsonType: "string", minLength: 1, maxLength: 120 },
          entityType: { bsonType: "string", minLength: 1, maxLength: 80 },
          entityId: nullableString,
          details: { bsonType: "string", maxLength: 1000 },
          createdAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { id: 1 }, unique: true },
      { key: { createdAt: -1 } },
      { key: { actorId: 1, createdAt: -1 } },
    ],
  },
  notification_reads: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "userId", "readAt"],
        properties: {
          _id: { bsonType: "string", minLength: 1 },
          userId: { ...integer, minimum: 1 },
          readAt: timestamp,
        },
      },
    },
    indexes: [{ key: { userId: 1, readAt: -1 } }],
  },
  revoked_tokens: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["jti", "userId", "expiresAt"],
        properties: {
          jti: { bsonType: "string", minLength: 1 },
          userId: { ...integer, minimum: 1 },
          expiresAt: timestamp,
        },
      },
    },
    indexes: [
      { key: { jti: 1 }, unique: true },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ],
  },
  counters: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "value"],
        properties: {
          _id: { bsonType: "string", minLength: 1 },
          value: { ...integer, minimum: 0 },
        },
      },
    },
    indexes: [],
  },
};

module.exports = { collections };
