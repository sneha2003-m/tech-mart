const jwt = require("jsonwebtoken");
const { getDatabase } = require("./database");
const { httpError } = require("./http");

const roles = [
  "Administrator",
  "Order / Operations Staff",
  "Inventory Staff",
  "Report Viewer",
];

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

async function requireAuth(request, response, next) {
  const authorization = request.get("authorization") || "";
  const match = authorization.match(/^Bearer ([^\s]+)$/);
  const sessionCookie = request.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("techmart_session="));
  const cookieToken = sessionCookie?.slice("techmart_session=".length);
  const token = match?.[1] || cookieToken;
  if (!token) {
    next(httpError(401, "An authenticated session is required."));
    return;
  }

  try {
    const user = jwt.verify(token, getJwtSecret());
    if (!user.jti || !Number.isSafeInteger(Number(user.sub))) {
      throw httpError(401, "The authentication token is invalid or expired.");
    }
    const db = await getDatabase();
    const [revoked, staff] = await Promise.all([
      db.collection("revoked_tokens").findOne({ jti: user.jti }),
      db.collection("staff_users").findOne({
        id: Number(user.sub),
        email: user.email,
        role: user.role,
        active: true,
      }, { projection: { _id: 1, tokenVersion: 1 } }),
    ]);
    if (revoked || !staff || (staff.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      next(httpError(401, "The authentication token is invalid or expired."));
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    if (error.status === 401) {
      next(error);
      return;
    }
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      next(httpError(401, "The authentication token is invalid or expired."));
      return;
    }
    next(error);
  }
}

function allowRoles(...allowedRoles) {
  return (request, response, next) => {
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      return next(httpError(403, "Your account does not have permission to perform this action."));
    }
    next();
  };
}

module.exports = { allowRoles, getJwtSecret, requireAuth, roles };
