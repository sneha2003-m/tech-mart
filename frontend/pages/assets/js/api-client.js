(() => {
  "use strict";

  const sessionKey = "techmart.api.session";
  let session = readStoredSession();

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey);
      if (!raw) return null;
      const storedSession = JSON.parse(raw);
      if (storedSession?.token) {
        localStorage.removeItem(sessionKey);
        sessionStorage.removeItem(sessionKey);
        return null;
      }
      return storedSession;
    } catch (error) {
      console.error("Could not read the saved API session.", error);
      localStorage.removeItem(sessionKey);
      sessionStorage.removeItem(sessionKey);
      return null;
    }
  }

  function saveSession(value, remember) {
    localStorage.removeItem(sessionKey);
    sessionStorage.removeItem(sessionKey);
    const { token, ...account } = value;
    (remember ? localStorage : sessionStorage).setItem(sessionKey, JSON.stringify(account));
    session = account;
  }

  function clearSession() {
    localStorage.removeItem(sessionKey);
    sessionStorage.removeItem(sessionKey);
    session = null;
  }

  async function request(path, options = {}) {
    const { includeMeta = false, ...fetchOptions } = options;
    const headers = { Accept: "application/json", ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`/api${path}`, {
      ...fetchOptions,
      credentials: "same-origin",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 204) return null;
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("The server returned an unreadable response.");
    }
    if (!response.ok) {
      if (response.status === 401) clearSession();
      throw new Error(payload?.message || `The request failed with HTTP ${response.status}.`);
    }
    return includeMeta ? payload : payload.data;
  }

  async function listAll(path) {
    const items = [];
    let page = 1;
    let total = Infinity;
    while (items.length < total) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await request(`${path}${separator}page=${page}&limit=100`, { includeMeta: true });
      items.push(...response.data);
      total = response.pagination?.total ?? items.length;
      page += 1;
    }
    return items;
  }

  const id = (value) => String(value);

  async function login(email, password, remember) {
    const result = await request("/auth/login", {
      method: "POST",
      body: { email, password, remember },
    });
    saveSession(result.user, remember);
    return session;
  }

  async function validateSession() {
    try {
      const user = await request("/auth/me");
      session = { ...session, ...user };
      return session;
    } catch (error) {
      clearSession();
      if (error.message !== "Failed to fetch" && !error.message.includes("invalid or expired")) {
        console.warn("Saved API session could not be restored:", error.message);
      }
      return null;
    }
  }

  async function logout() {
    try {
      if (session) await request("/auth/logout", { method: "POST" });
    } finally {
      clearSession();
    }
  }

  async function loadWorkspace(user, { from = "", to = "" } = {}) {
    const range = new URLSearchParams();
    if (from) range.set("from", from);
    if (to) range.set("to", to);
    const suffix = range.size ? `?${range}` : "";
    const canManageOrders = ["Administrator", "Order / Operations Staff"].includes(user.role);
    const canManageInventory = ["Administrator", "Inventory Staff"].includes(user.role);
    const canImport = ["Administrator", "Inventory Staff"].includes(user.role);
    const isAdmin = user.role === "Administrator";
    const [
      rawProducts,
      rawCategories,
      runtime,
      dashboard,
      sales,
      inventoryReport,
      rawNotifications,
      rawCustomers,
      rawOrders,
      rawPayments,
      rawMovements,
      rawImports,
      rawStaff,
      rawAudit,
    ] = await Promise.all([
      listAll(`/products?includeInactive=${canManageInventory}`),
      request("/categories"),
      request("/config"),
      request(`/dashboard/summary${suffix}`),
      request(`/reports/sales${suffix}`),
      request("/reports/inventory"),
      request("/notifications"),
      canManageOrders ? listAll("/customers") : Promise.resolve([]),
      canManageOrders ? listAll("/orders") : Promise.resolve([]),
      canManageOrders ? listAll("/payments") : Promise.resolve([]),
      canManageInventory ? request("/inventory/movements") : Promise.resolve([]),
      canImport ? request("/imports/history") : Promise.resolve([]),
      isAdmin ? request("/staff") : Promise.resolve([]),
      isAdmin ? listAll("/audit") : Promise.resolve([]),
    ]);
    const customers = rawCustomers.map((item) => ({ ...item, id: id(item.id) }));
    const products = rawProducts.map((item) => ({
      ...item,
      id: id(item.id),
      categoryId: item.categoryId == null ? "" : id(item.categoryId),
      externalId: item.externalId || null,
    }));
    const orders = rawOrders.map((item) => ({
      ...item,
      id: id(item.id),
      customerId: id(item.customerId),
      orderNumber: item.number,
      history: [],
      items: [],
    }));
    const payments = rawPayments.map((item) => ({
      ...item,
      id: id(item.id),
      orderId: id(item.orderId),
      reference: item.reference || "Pending",
      method: item.method || "Simulated",
    }));
    return {
      products,
      categories: rawCategories.map((item) => ({ ...item, id: id(item.id) })),
      customers: customers.map((item) => ({
        ...item,
        orderCount: item.orderCount || 0,
        totalSpent: item.totalSpent || 0,
        phone: item.phone || "",
      })),
      orders,
      payments,
      movements: rawMovements.map((item) => ({
        ...item,
        id: id(item.id),
        productId: id(item.productId),
        change: item.changeQuantity,
        actor: item.actor || "—",
      })),
      notifications: rawNotifications.map((item) => ({ ...item })),
      imports: rawImports,
      audit: rawAudit.map((item) => ({
        ...item,
        id: id(item.id),
        entity: item.entityType,
        actor: item.actorEmail || "—",
        detail: item.details,
      })),
      staff: rawStaff.map((item) => ({ ...item, id: id(item.id) })),
      dashboard,
      runtime,
      sales,
      inventory: inventoryReport,
    };
  }

  async function orderDetail(orderId) {
    const order = await request(`/orders/${Number(orderId)}`);
    return {
      ...order,
      id: id(order.id),
      customerId: id(order.customerId),
      items: order.items.map((item) => ({ ...item, productId: id(item.productId) })),
      history: (order.statusHistory || []).map((item) => ({
        status: item.status,
        at: item.changedAt,
        note: item.note,
        actor: item.actorEmail,
      })),
      payments: order.payments.map((item) => ({ ...item, id: id(item.id), orderId: id(item.orderId) })),
      paymentMethod: order.payments[0]?.method || "Simulated",
      number: order.orderNumber,
    };
  }

  window.TechMartApi = {
    clearSession,
    getSession: () => session,
    loadWorkspace,
    login,
    logout,
    orderDetail,
    request,
    validateSession,
  };
})();
