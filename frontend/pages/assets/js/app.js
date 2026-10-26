(() => {
  "use strict";

  const api = window.TechMartApi;
  const ROLES = [
    "Administrator",
    "Order / Operations Staff",
    "Inventory Staff",
    "Report Viewer",
  ];
  const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", code: "OV", roles: ROLES },
    { id: "products", label: "Products", code: "PR", roles: [ROLES[0], ROLES[2]] },
    { id: "categories", label: "Categories", code: "CA", roles: [ROLES[0]] },
    { id: "inventory", label: "Inventory", code: "IN", roles: [ROLES[0], ROLES[2]] },
    { id: "orders", label: "Orders", code: "OR", roles: [ROLES[0], ROLES[1]] },
    { id: "shipping", label: "Shipping & delivery", code: "SH", roles: [ROLES[0], ROLES[1]] },
    { id: "customers", label: "Customers", code: "CU", roles: [ROLES[0], ROLES[1]] },
    { id: "payments", label: "Payments", code: "PA", roles: [ROLES[0], ROLES[1]] },
    { id: "reports", label: "Reports", code: "RE", roles: ROLES },
    { id: "imports", label: "External API imports", code: "IM", roles: [ROLES[0], ROLES[2]] },
    { id: "notifications", label: "Notifications", code: "NO", roles: ROLES },
    { id: "staff", label: "Staff & roles", code: "ST", roles: [ROLES[0]] },
    { id: "activity", label: "Audit log", code: "AU", roles: [ROLES[0]] },
    { id: "settings", label: "Settings", code: "SE", roles: [ROLES[0]] },
  ];
  const TITLES = {
    dashboard: ["Dashboard", "A clear overview of orders, revenue, payments, and inventory."],
    products: ["Products", "Maintain the product catalogue, pricing, and stock thresholds."],
    categories: ["Categories", "Organise catalogue products into manageable groups."],
    inventory: ["Inventory", "Review available stock, record adjustments, and inspect movement history."],
    orders: ["Orders", "Review orders, payment state, and fulfilment status."],
    shipping: ["Shipping & delivery", "Work through eligible orders and keep delivery progress visible."],
    customers: ["Customers", "Review customer contact details and order summaries."],
    payments: ["Payments", "Review payment records separately from fulfilment status."],
    reports: ["Reports & analytics", "Explore date-filtered sales, orders, product performance, and stock."],
    imports: ["External API imports", "Preview, validate, and selectively import external product data."],
    notifications: ["Notifications", "Resolve low-stock alerts and review payment or order warnings."],
    staff: ["Staff & roles", "Review staff roles and their intended access boundaries."],
    activity: ["Audit log", "Review important changes recorded by the server."],
    settings: ["Settings", "Review project configuration and integration readiness."],
  };
  const ROLE_ACCESS = {
    Administrator: "Manages users and roles, products, categories, inventory, orders, settings, imports, reports, and audit logs.",
    "Order / Operations Staff": "Views orders and customers, updates permitted order statuses, and views stock. Cannot manage system roles.",
    "Inventory Staff": "Views products, records stock adjustments, and reviews low-stock alerts and stock history.",
    "Report Viewer": "Read-only access to permitted dashboard and report information.",
  };
  const STATUS_NEXT = {
    Pending: ["Processing", "Cancelled"],
    Processing: ["Shipped", "Cancelled"],
    Shipped: ["Delivered"],
    Delivered: [],
    Cancelled: [],
  };
  const app = document.querySelector("#app");
  const dialog = document.querySelector("#app-dialog");
  const toastRegion = document.querySelector("#toast-region");
  const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  const sourceMoney = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  let state;
  let currentSession = null;
  let toastTimer;
  let importPreview = [];
  let importBusy = false;
  let currentPage = 1;
  let ordersPage = 1;
  let customersPage = 1;
  let searchText = "";
  let listFilters = {};
  let dashboardRange = { from: daysAgo(6), to: dateInputValue(new Date()) };
  let reportRange = { from: daysAgo(29), to: dateInputValue(new Date()) };
  let workspaceLoading = false;

  function emptyState() {
    return {
      categories: [],
      products: [],
      customers: [],
      orders: [],
      payments: [],
      movements: [],
      notifications: [],
      imports: [],
      audit: [],
      staff: [],
      dashboard: {},
      runtime: { paymentSimulationEnabled: true },
      sales: {},
      inventory: { products: [] },
    };
  }

  async function reloadWorkspace({ showLoading = false } = {}) {
    if (!currentSession) return;
    if (showLoading) {
      workspaceLoading = true;
      app.innerHTML = '<div class="app-loading" role="status">Loading live TechMart data…</div>';
    }
    try {
      const range = location.hash === "#reports" ? reportRange : dashboardRange;
      state = await api.loadWorkspace(currentSession, range);
      workspaceLoading = false;
      render();
      return true;
    } catch (error) {
      workspaceLoading = false;
      if (!api.getSession()) {
        currentSession = null;
        render();
      } else {
        console.error("Could not load live TechMart data.", error);
        renderFatal(error.message);
      }
      return false;
    }
  }

  async function apiAction(path, options, successMessage, { close = false } = {}) {
    try {
      await api.request(path, options);
      if (close && dialog.open) dialog.close();
      await reloadWorkspace();
      if (successMessage) showToast(successMessage);
    } catch (error) {
      console.error("TechMart API action failed.", error);
      showToast(error.message || "The server could not complete this action.", true);
    }
  }

  function dateInputValue(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return dateInputValue(date);
  }

  function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function localDate(value) {
    if (!value) return "—";
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
  }

  function localDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
  }

  function safeClass(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  function badge(value) {
    return `<span class="status-badge ${safeClass(value)}">${escapeHtml(value)}</span>`;
  }

  function blankState(title, detail) {
    return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">⌕</div><div class="empty-title">${escapeHtml(title)}</div><p class="empty-copy">${escapeHtml(detail)}</p></div>`;
  }

  function seedState() {
    const categories = [
      { id: "cat-audio", name: "Audio", description: "Headphones and audio accessories", active: true },
      { id: "cat-computers", name: "Computers", description: "Laptops and computer hardware", active: true },
      { id: "cat-accessories", name: "Accessories", description: "Everyday technology accessories", active: true },
      { id: "cat-displays", name: "Displays", description: "Monitors and display equipment", active: true },
    ];
    const products = [
      { id: "p-1", externalId: null, name: "Sony WH-1000XM5", sku: "SNY-XM5-BLK", categoryId: "cat-audio", price: 29990, quantity: 2, threshold: 5, active: true },
      { id: "p-2", externalId: null, name: "MacBook Air M2", sku: "APL-MBA-M2-MD", categoryId: "cat-computers", price: 114900, quantity: 3, threshold: 5, active: true },
      { id: "p-3", externalId: null, name: "Logitech MX Master 3S", sku: "LOG-MXM3S-GR", categoryId: "cat-accessories", price: 8995, quantity: 4, threshold: 4, active: true },
      { id: "p-4", externalId: null, name: "Keychron K2 Pro", sku: "KEY-K2P-BLK", categoryId: "cat-accessories", price: 9499, quantity: 18, threshold: 5, active: true },
      { id: "p-5", externalId: null, name: "Dell UltraSharp 27", sku: "DEL-U2723QE", categoryId: "cat-displays", price: 48450, quantity: 12, threshold: 4, active: true },
      { id: "p-6", externalId: null, name: "Anker USB-C Hub", sku: "ANK-7IN1-HUB", categoryId: "cat-accessories", price: 2799, quantity: 3, threshold: 6, active: true },
    ];
    const customers = [
      { id: "c-1", name: "Rohan Verma", email: "rohan.verma@example.com", phone: "+91 98765 43210" },
      { id: "c-2", name: "Ananya Patel", email: "ananya.patel@example.com", phone: "+91 98765 43211" },
      { id: "c-3", name: "Karan Sharma", email: "karan.sharma@example.com", phone: "+91 98765 43212" },
      { id: "c-4", name: "Sneha Menon", email: "sneha.menon@example.com", phone: "+91 98765 43213" },
      { id: "c-5", name: "Devendra Kumar", email: "devendra.kumar@example.com", phone: "+91 98765 43214" },
      { id: "c-6", name: "Isha Nair", email: "isha.nair@example.com", phone: "+91 98765 43215" },
    ];
    const orderSeeds = [
      ["TM-1048", "c-1", 0, "Processing", "Paid", [["p-1", 1]]],
      ["TM-1047", "c-2", 1, "Shipped", "Paid", [["p-2", 1]]],
      ["TM-1046", "c-3", 2, "Pending", "Pending", [["p-3", 1]]],
      ["TM-1045", "c-4", 4, "Delivered", "Paid", [["p-5", 1]]],
      ["TM-1044", "c-5", 8, "Delivered", "Paid", [["p-4", 1]]],
      ["TM-1043", "c-6", 12, "Pending", "Failed", [["p-6", 1]]],
      ["TM-1042", "c-2", 21, "Cancelled", "Paid", [["p-3", 1]]],
      ["TM-1041", "c-1", 35, "Delivered", "Paid", [["p-2", 1]]],
    ];
    const orders = orderSeeds.map(([number, customerId, ago, status, paymentStatus, lines]) => {
      const items = lines.map(([productId, quantity]) => {
        const product = products.find((item) => item.id === productId);
        return { productId, name: product.name, sku: product.sku, quantity, unitPrice: product.price };
      });
      const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const createdAt = `${daysAgo(ago)}T10:00:00.000Z`;
      const history = [{ status, at: createdAt, note: "Demo order record" }];
      return {
        id: newId("order"),
        number,
        customerId,
        createdAt,
        status,
        paymentStatus,
        paymentMethod: "Simulated",
        total,
        items,
        history,
      };
    });
    const initialMovements = products.map((product) => ({
      id: newId("movement"),
      productId: product.id,
      change: product.quantity,
      reason: "Opening demo stock",
      createdAt: new Date().toISOString(),
      actor: "Demo setup",
    }));
    const initialPayments = orders.map((order) => ({
      id: newId("payment"),
      orderId: order.id,
      reference: `DEMO-${order.number}`,
      amount: order.total,
      method: "Simulated",
      status: order.paymentStatus,
      createdAt: order.createdAt,
    }));
    return {
      categories,
      products,
      customers,
      orders,
      payments: initialPayments,
      movements: initialMovements,
      notifications: [],
      imports: [],
      audit: [],
      staff: [
        { id: "staff-1", name: "Sneha Manoj", email: "admin@techmart.in", role: "Administrator", active: true },
        { id: "staff-2", name: "Arjun Rao", email: "arjun.rao@techmart.in", role: "Order / Operations Staff", active: true },
        { id: "staff-3", name: "Meera Shah", email: "meera.shah@techmart.in", role: "Inventory Staff", active: true },
        { id: "staff-4", name: "Nikhil Das", email: "nikhil.das@techmart.in", role: "Report Viewer", active: true },
      ],
    };
  }

  function normalizeState(value) {
    const requiredArrays = ["categories", "products", "customers", "orders", "payments", "movements", "notifications", "imports", "audit", "staff"];
    if (!value || requiredArrays.some((key) => !Array.isArray(value[key]))) {
      throw new Error("Saved preview data has an invalid structure. Use Reset preview data to restore it.");
    }
    return value;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeState(JSON.parse(saved)) : seedState();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Saved preview data could not be read. Use Reset preview data to start fresh.");
      }
      throw error;
    }
  }

  function persist(nextState, message) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    } catch (error) {
      showToast("The browser could not save this change. Check available storage and try again.", true);
      console.error("Could not persist the TechMart browser preview.", error);
      return false;
    }
    state = nextState;
    render();
    if (message) showToast(message);
    return true;
  }

  function updateState(mutator, message) {
    const nextState = structuredClone(state);
    mutator(nextState);
    return persist(nextState, message);
  }

  function addAudit(targetState, action, entity, detail) {
    targetState.audit.unshift({
      id: newId("audit"),
      action,
      entity,
      detail,
      actor: currentSession?.email || "Demo user",
      createdAt: new Date().toISOString(),
    });
    targetState.audit = targetState.audit.slice(0, 200);
  }

  function showToast(message, error = false) {
    const toast = document.createElement("div");
    toast.className = `toast${error ? " error" : ""}`;
    toast.setAttribute("role", error ? "alert" : "status");
    toast.textContent = message;
    toastRegion.replaceChildren(toast);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.remove(), 3600);
  }

  function readSession() {
    return api.getSession();
  }

  async function signOut() {
    try {
      await api.logout();
    } catch (error) {
      console.error("Could not terminate the authenticated API session.", error);
      showToast(error.message || "The session could not be revoked; the token has been cleared from this browser.", true);
    } finally {
      currentSession = null;
      state = emptyState();
      location.hash = "#login";
      render();
    }
  }

  function allowed(route) {
    return NAV_ITEMS.find((item) => item.id === route)?.roles.includes(currentSession?.role) ?? false;
  }

  function accessibleRoute(requested) {
    if (allowed(requested)) return requested;
    const firstAllowed = NAV_ITEMS.find((item) => item.roles.includes(currentSession?.role));
    return firstAllowed?.id || "dashboard";
  }

  function navMarkup(route) {
    const notifications = notificationItems().filter((item) => !item.read).length;
    const groups = [
      ["Overview", ["dashboard"]],
      ["Commerce", ["orders", "shipping", "customers", "payments"]],
      ["Catalogue", ["products", "categories", "inventory", "imports"]],
      ["Intelligence", ["reports", "notifications"]],
      ["Administration", ["staff", "activity", "settings"]],
    ];
    return groups.map(([label, ids]) => {
      const items = ids.map((id) => NAV_ITEMS.find((item) => item.id === id))
        .filter((item) => item?.roles.includes(currentSession.role));
      if (!items.length) return "";
      return `<section class="nav-group" aria-label="${label}">
        <h2 class="nav-group-label">${label}</h2>
        ${items.map((item) => `<a class="nav-link" href="#${item.id}" ${item.id === route ? 'aria-current="page"' : ""}>
          <span class="nav-icon" aria-hidden="true">${item.code}</span><span>${escapeHtml(item.label)}</span>
          ${item.id === "notifications" && notifications ? `<span class="nav-count">${notifications}</span>` : ""}
        </a>`).join("")}
      </section>`;
    }).join("");
  }

  function renderLogin() {
    app.innerHTML = `<main class="login-page">
      <aside class="login-aside" aria-label="TechMart operations workspace">
        <a class="brand" href="#login"><span class="brand-mark" aria-hidden="true">T</span><span>TECHMART<span class="brand-caption">OPERATIONS DESK</span></span></a>
        <div class="login-story">
          <span class="eyebrow">Commerce operations</span>
          <h1>Good work<br />starts with a<br /><em>clear view.</em></h1>
          <p>One working view of the catalogue, stockroom and orders in motion.</p>
        </div>
        <ol class="login-workflow" aria-label="Workspace areas">
          <li><span>01</span> Catalogue &amp; pricing</li>
          <li><span>02</span> Stock &amp; availability</li>
          <li><span>03</span> Orders &amp; fulfilment</li>
        </ol>
        <div class="login-aside-footer"><span class="status-mark" aria-hidden="true"></span> Staff workspace <span>·</span> Access controlled</div>
      </aside>
      <section class="login-card" aria-labelledby="login-title">
        <div class="login-card-top"><span class="eyebrow">Staff access</span><span class="login-index">01 / SIGN IN</span></div>
        <div class="login-heading"><h2 id="login-title">Welcome back.</h2>
          <p>Sign in with the account provided by your administrator.</p></div>
        <form class="login-form" id="login-form" data-form="login-form">
          <div class="form-field"><label class="form-label" for="login-email">Work email</label><input class="form-control" id="login-email" name="email" type="email" autocomplete="username" placeholder="name@company.com" required /></div>
          <div class="form-field"><label class="form-label" for="login-password">Password</label><div class="password-wrap"><input class="form-control" id="login-password" name="password" type="password" autocomplete="current-password" required /><button class="btn btn-secondary btn-sm" data-action="toggle-login-password" type="button">Show</button></div></div>
          <label class="remember-option"><input id="remember-login" type="checkbox" /><span>Keep me signed in on this device</span></label>
          <p class="form-message" id="login-message" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit">Sign in <span aria-hidden="true">→</span></button>
        </form>
        <div class="login-card-footer"><span>SECURE SESSION</span><p>Credentials are checked by the TechMart API. Your password is never stored in this browser.</p></div>
      </section>
    </main>`;
  }

  function renderShell(route) {
    const [title] = TITLES[route] || TITLES.dashboard;
    app.innerHTML = `<div class="app-shell">
      <a class="skip-link" href="#main-content">Skip to workspace content</a>
      <header class="topbar">
        <a class="brand topbar-brand" href="#dashboard"><span class="brand-mark" aria-hidden="true">T</span><span>TECHMART<span class="brand-caption">OPERATIONS DESK</span></span></a>
        <div class="topbar-left">
          <button class="mobile-menu" type="button" data-action="toggle-sidebar" aria-label="Toggle workspace navigation" aria-controls="sidebar" aria-expanded="false">☰</button>
          <div class="topbar-route"><span class="topbar-kicker">WORKSPACE / CURRENT VIEW</span><span class="topbar-title">${escapeHtml(title)}</span></div>
        </div>
        <div class="topbar-actions">
          <span class="workspace-context">STAFF WORKSPACE</span>
          <button class="profile-button" type="button" data-action="profile-menu" aria-label="Sign out ${escapeHtml(currentSession.email)}">
            <span class="avatar" aria-hidden="true">${escapeHtml(currentSession.email.slice(0, 1).toUpperCase())}</span>
            <span class="profile-details"><span class="profile-name">${escapeHtml(currentSession.email)}</span><span class="profile-role">${escapeHtml(currentSession.role)}</span></span>
            <span class="profile-menu-mark" aria-hidden="true">···</span>
          </button>
        </div>
      </header>
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <div class="sidebar-heading"><span>Navigation</span><span>MODULES</span></div>
        <nav class="sidebar-nav">${navMarkup(route)}</nav>
        <div class="sidebar-footer"><span class="sidebar-footer-mark" aria-hidden="true">TM</span><span><strong>TechMart workspace</strong><br />Changes are saved through the API.</span></div>
      </aside>
      <main class="workspace main-content" id="main-content">${pageMarkup(route)}</main>
    </div>`;
  }

  function pageHeader(route, actions = "") {
    const [title, description] = TITLES[route] || TITLES.dashboard;
    return `<header class="page-header"><div class="page-heading-copy"><span class="page-eyebrow">${escapeHtml(route.toUpperCase())} <span aria-hidden="true">/</span> OPERATIONS</span><h1 class="page-title">${escapeHtml(title)}</h1><p class="page-description">${escapeHtml(description)}</p></div><div class="heading-actions">${actions}</div></header>`;
  }

  function button(action, label, options = {}) {
    const kind = options.kind || "secondary";
    const extra = options.extra || "";
    const data = options.id ? ` data-id="${escapeHtml(options.id)}"` : "";
    const disabled = options.disabled ? " disabled" : "";
    return `<button class="btn btn-${kind}${options.small ? " btn-sm" : ""}" type="button" data-action="${escapeHtml(action)}"${data}${extra}${disabled}>${escapeHtml(label)}</button>`;
  }

  function categoryName(id) {
    return state.categories.find((category) => category.id === id)?.name || "Uncategorised";
  }

  function customerName(id) {
    return state.customers.find((customer) => customer.id === id)?.name || "Unknown customer";
  }

  function lowStockProducts() {
    return state.products.filter((product) => product.active && product.quantity <= product.threshold);
  }

  function notificationItems() {
    return state.notifications || [];
  }

  function dateRangeForm(from, to, target) {
    return `<form class="toolbar" data-form="${target}">
      <div class="form-field"><label class="form-label" for="${target}-from">From</label><input class="form-control" id="${target}-from" name="from" type="date" value="${escapeHtml(from)}" required /></div>
      <div class="form-field"><label class="form-label" for="${target}-to">To</label><input class="form-control" id="${target}-to" name="to" type="date" value="${escapeHtml(to)}" required /></div>
      <button class="btn btn-primary" type="submit">Apply range</button>
    </form>`;
  }

  function inRange(date, from, to) {
    const day = String(date || "").slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  }

  function dashboardMarkup() {
    const from = dashboardRange.from || daysAgo(6);
    const to = dashboardRange.to || dateInputValue(new Date());
    const orders = state.orders.filter((order) => inRange(order.createdAt, from, to));
    const summary = state.dashboard || {};
    const metrics = [
      ["Revenue", money.format(summary.revenue || 0), "Paid, non-cancelled orders in range"],
      ["Order count", String(summary.orderCount || 0), "Orders placed in selected period"],
      ["Pending orders", String(summary.pendingOrders || 0), "Awaiting required checks"],
      ["Total products", String(summary.totalProducts ?? state.products.filter((product) => product.active).length), "Active catalogue products"],
      ["Low-stock products", String(summary.lowStockProducts ?? lowStockProducts().length), "At or below configured threshold"],
      ["Pending payments", money.format(summary.pendingPaymentAmount || 0), `${summary.pendingPayments || 0} pending payment records in range`],
    ];
    return `${pageHeader("dashboard", button("refresh", "Refresh", { kind: "secondary" }))}
      <form class="toolbar dashboard-controls" data-form="dashboard-range">
        <div class="form-field"><label class="form-label" for="dashboard-from">From</label><input class="form-control" id="dashboard-from" name="from" type="date" value="${escapeHtml(from)}" required /></div>
        <div class="form-field"><label class="form-label" for="dashboard-to">To</label><input class="form-control" id="dashboard-to" name="to" type="date" value="${escapeHtml(to)}" required /></div>
        <button class="btn btn-primary" type="submit">Apply date range</button>
        <span class="form-help">Revenue counts paid orders only and excludes cancelled orders.</span>
      </form>
      <section class="metric-grid dashboard-metrics" aria-label="Business summary">${metrics.map(([label, value, foot]) =>
        `<article class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-foot">${escapeHtml(foot)}</span></article>`).join("")}</section>
      <section class="content-grid">
        <article class="panel"><div class="panel-heading"><div><h2 class="panel-title">Recent orders</h2><p class="panel-subtitle">Payment and fulfilment state remain independent.</p></div>${currentSession.role!=="Report Viewer"?'<a class="subtle-link" href="#orders">All orders →</a>':""}</div>
          ${orders.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Total</th><th>Payment</th><th>Order status</th><th></th></tr></thead><tbody>${orders.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,6).map((order) =>
            `<tr><td class="primary-text">${escapeHtml(order.number)}</td><td>${escapeHtml(customerName(order.customerId))}</td><td>${localDate(order.createdAt)}</td><td class="numeric">${money.format(order.total)}</td><td>${badge(order.paymentStatus)}</td><td>${badge(order.status)}</td><td>${button("order-detail","View",{id:order.id,small:true})}</td></tr>`).join("")}</tbody></table></div>` : blankState("No orders in this date range", "Choose a wider date range or create an order.")}</article>
        <article class="panel"><div class="panel-heading"><div><h2 class="panel-title">Low-stock products</h2><p class="panel-subtitle">Quantity is at or below the configured threshold.</p></div><a class="subtle-link" href="#inventory">Inventory →</a></div>
          ${lowStockProducts().length ? `<div class="stock-list">${lowStockProducts().slice(0,5).map((product) => `<div class="stock-row"><div><div class="stock-name">${escapeHtml(product.name)}</div><div class="stock-detail">${escapeHtml(product.sku)} · ${escapeHtml(categoryName(product.categoryId))}</div></div><div class="stock-number">${product.quantity} / ${product.threshold}</div></div>`).join("")}</div>` : blankState("Stock levels look good", "No active product is at or below its threshold.")}</article>
      </section>`;
  }

  function tableMarkup(headers, rows, emptyTitle, emptyDetail, colspan = headers.length) {
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td class="empty-state" colspan="${colspan}"><div class="empty-title">${escapeHtml(emptyTitle)}</div><p class="empty-copy">${escapeHtml(emptyDetail)}</p></td></tr>`}</tbody></table></div>`;
  }

  function productRows(items) {
    return items.map((product) => `<tr>
      <td class="primary-text">${escapeHtml(product.name)}<span class="small-muted">${escapeHtml(product.sku)}</span></td>
      <td>${escapeHtml(categoryName(product.categoryId))}</td><td class="numeric">${money.format(product.price)}</td>
      <td class="numeric">${product.quantity}</td><td class="numeric">${product.threshold}</td>
      <td>${badge(product.active ? "Active" : "Inactive")}</td>
      <td><div class="inline-actions">${button("edit-product","Edit",{id:product.id,small:true})}${product.active ? (currentSession.role==="Administrator"?button("deactivate-product","Deactivate",{id:product.id,small:true}):"") : button("activate-product","Activate",{id:product.id,small:true})}</div></td>
    </tr>`).join("");
  }

  function productsMarkup() {
    const activeCategories = state.categories.filter((category) => category.active);
    const search = searchText.toLowerCase();
    let products = state.products.filter((product) => {
      const matchesSearch = `${product.name} ${product.sku}`.toLowerCase().includes(search);
      const matchesCategory = !listFilters.category || product.categoryId === listFilters.category;
      const matchesStock = !listFilters.stock ||
        (listFilters.stock === "low" && product.active && product.quantity <= product.threshold) ||
        (listFilters.stock === "in" && product.quantity > product.threshold) ||
        (listFilters.stock === "inactive" && !product.active);
      return matchesSearch && matchesCategory && matchesStock;
    }).sort((a,b) => a.name.localeCompare(b.name));
    const pageSize = 8;
    const pageCount = Math.max(1, Math.ceil(products.length / pageSize));
    currentPage = Math.min(currentPage, pageCount);
    const visible = products.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const activeCount = state.products.filter((product) => product.active).length;
    const lowCount = lowStockProducts().length;
    return `${pageHeader("products", button("new-product","Add product",{kind:"primary"}) + button("go-imports","Import products"))}
      <section class="collection-summary" aria-label="Catalogue summary">
        <div class="collection-total"><span>CATALOGUE MATCHES</span><strong>${products.length}</strong></div>
        <div class="collection-fact"><strong>${activeCount}</strong><span>active listings</span></div>
        <div class="collection-fact"><strong>${lowCount}</strong><span>need restocking</span></div>
        <div class="collection-fact"><strong>${activeCategories.length}</strong><span>active categories</span></div>
      </section>
      <div class="toolbar"><label class="search-control"><span class="search-mark" aria-hidden="true">⌕</span><input class="form-control" data-filter="search" placeholder="Search product name or SKU" value="${escapeHtml(searchText)}" /></label>
        <select class="form-select filter-select" data-filter="category"><option value="">All categories</option>${activeCategories.map((category) => `<option value="${escapeHtml(category.id)}" ${listFilters.category === category.id ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select>
        <select class="form-select filter-select" data-filter="stock"><option value="">All stock states</option><option value="low" ${listFilters.stock === "low" ? "selected" : ""}>Low stock</option><option value="in" ${listFilters.stock === "in" ? "selected" : ""}>Above threshold</option><option value="inactive" ${listFilters.stock === "inactive" ? "selected" : ""}>Inactive</option></select>
      </div>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Product register</h2><p class="panel-subtitle">Pricing, availability, and reorder thresholds</p></div><span class="record-count">${visible.length} shown <span>/</span> ${products.length} results</span></div>${tableMarkup(["Product / SKU","Category","Price","Quantity","Threshold","Status","Actions"], productRows(visible), "No matching products", "Try changing search or filters.")}
        <footer class="table-footer"><span>Showing ${products.length ? (currentPage - 1) * pageSize + 1 : 0}–${Math.min(currentPage * pageSize, products.length)} of ${products.length} products</span>
          <div class="pagination"><button class="page-button" data-action="products-page" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""} aria-label="Previous page">‹</button><span>Page ${currentPage} of ${pageCount}</span><button class="page-button" data-action="products-page" data-page="${currentPage + 1}" ${currentPage >= pageCount ? "disabled" : ""} aria-label="Next page">›</button></div></footer></section>`;
  }

  function categoriesMarkup() {
    const search = searchText.toLowerCase();
    const categories = state.categories.filter((category) => `${category.name} ${category.description}`.toLowerCase().includes(search));
    const rows = categories.map((category) => `<tr><td class="primary-text">${escapeHtml(category.name)}</td><td>${escapeHtml(category.description || "—")}</td><td>${state.products.filter((product) => product.categoryId === category.id).length}</td><td>${badge(category.active ? "Active" : "Inactive")}</td><td><div class="inline-actions">${button("edit-category","Edit",{id:category.id,small:true})}${category.active ? button("deactivate-category","Deactivate",{id:category.id,small:true}) : button("activate-category","Activate",{id:category.id,small:true})}</div></td></tr>`).join("");
    const activeCount = categories.filter((category) => category.active).length;
    const assignedProducts = state.products.filter((product) => product.categoryId != null).length;
    return `${pageHeader("categories", button("new-category","Add category",{kind:"primary"}))}
      <section class="collection-summary" aria-label="Category summary">
        <div class="collection-total"><span>CATEGORY RESULTS</span><strong>${categories.length}</strong></div>
        <div class="collection-fact"><strong>${activeCount}</strong><span>active categories</span></div>
        <div class="collection-fact"><strong>${assignedProducts}</strong><span>products assigned</span></div>
      </section>
      <div class="toolbar"><label class="search-control"><span class="search-mark" aria-hidden="true">⌕</span><input class="form-control" data-filter="search" placeholder="Search categories" value="${escapeHtml(searchText)}" /></label></div>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Category register</h2><p class="panel-subtitle">Product groups and their catalogue coverage</p></div></div>${tableMarkup(["Category","Description","Products","Status","Actions"], rows, "No categories found", "Create a category to organise products.")}</section>`;
  }

  function inventoryMarkup() {
    const search = searchText.toLowerCase();
    const products = state.products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(search))
      .sort((a,b) => Number(a.quantity > a.threshold) - Number(b.quantity > b.threshold));
    const activeProducts = state.products.filter((product) => product.active);
    const stockUnits = activeProducts.reduce((total, product) => total + product.quantity, 0);
    const lowStockCount = lowStockProducts().length;
    const rows = products.map((product) => `<tr><td class="primary-text">${escapeHtml(product.name)}<span class="small-muted">${escapeHtml(product.sku)}</span></td><td>${escapeHtml(categoryName(product.categoryId))}</td><td class="numeric">${product.quantity}</td><td class="numeric">${product.threshold}</td><td>${badge(product.active && product.quantity <= product.threshold ? "Low" : product.active ? "In stock" : "Inactive")}</td><td>${button("adjust-stock","Adjust",{id:product.id,small:true,disabled:!product.active})}</td></tr>`).join("");
    const movements = state.movements.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10);
    return `${pageHeader("inventory", button("new-adjustment","Adjust stock",{kind:"primary"}))}
      <section class="inventory-overview" aria-label="Inventory overview">
        <div class="inventory-attention"><span>REORDER ATTENTION</span><strong>${lowStockCount}</strong><p>${lowStockCount === 1 ? "product is" : "products are"} at or below threshold</p></div>
        <div class="inventory-fact"><span>ACTIVE PRODUCTS</span><strong>${activeProducts.length}</strong></div>
        <div class="inventory-fact"><span>UNITS ON HAND</span><strong>${stockUnits.toLocaleString("en-IN")}</strong></div>
        <div class="inventory-note">Stock changes are recorded with a reason and staff attribution.</div>
      </section>
      <div class="toolbar"><label class="search-control"><span class="search-mark" aria-hidden="true">⌕</span><input class="form-control" data-filter="search" placeholder="Search product name or SKU" value="${escapeHtml(searchText)}" /></label></div>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Stock position</h2><p class="panel-subtitle">Available quantity against each reorder threshold</p></div><span class="record-count">${products.length} products</span></div>${tableMarkup(["Product / SKU","Category","Available","Threshold","Stock status","Action"], rows, "No products found", "Add products to start tracking inventory.")}</section>
      <section class="panel inventory-history"><div class="panel-heading"><div><h2 class="panel-title">Movement ledger</h2><p class="panel-subtitle">The latest recorded inventory movements</p></div></div>
        ${tableMarkup(["Product","Change","Reason","Date","Recorded by"], movements.map((movement) => {
          const product = state.products.find((item) => item.id === movement.productId);
          return `<tr><td class="primary-text">${escapeHtml(product?.name || "Removed product")}</td><td>${movement.change > 0 ? "+" : ""}${movement.change}</td><td>${escapeHtml(movement.reason)}</td><td>${localDateTime(movement.createdAt)}</td><td>${escapeHtml(movement.actor)}</td></tr>`;
        }).join(""), "No stock movements", "Adjust stock to create an inventory history record.")}</section>`;
  }

  function orderRows(orders) {
    return orders.map((order) => `<tr><td class="primary-text">${escapeHtml(order.number)}</td><td>${escapeHtml(customerName(order.customerId))}</td><td>${localDate(order.createdAt)}</td><td class="numeric">${money.format(order.total)}</td><td>${badge(order.paymentStatus)}</td><td>${badge(order.status)}</td><td>${button("order-detail","Details",{id:order.id,small:true})}</td></tr>`).join("");
  }

  function ordersMarkup() {
    const search = searchText.toLowerCase();
    const orders = state.orders.filter((order) => {
      const text = `${order.number} ${customerName(order.customerId)}`.toLowerCase();
      return text.includes(search) && (!listFilters.status || order.status === listFilters.status) &&
        (!listFilters.payment || order.paymentStatus === listFilters.payment);
    }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(orders.length / pageSize));
    ordersPage = Math.min(ordersPage, pageCount);
    const visible = orders.slice((ordersPage - 1) * pageSize, ordersPage * pageSize);
    return `${pageHeader("orders", button("new-order","Create order",{kind:"primary"}))}
      <section class="order-overview" aria-label="Orders by fulfilment stage">${[
        ["All orders", state.orders.length, "all"],
        ["To process", state.orders.filter((order) => order.status === "Pending").length, "Pending"],
        ["In progress", state.orders.filter((order) => order.status === "Processing").length, "Processing"],
        ["In transit", state.orders.filter((order) => order.status === "Shipped").length, "Shipped"],
        ["Completed", state.orders.filter((order) => order.status === "Delivered").length, "Delivered"],
      ].map(([label, value, key]) => `<div class="order-overview-item${key === "all" ? " is-current" : ""}"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join("")}</section>
      <div class="toolbar"><label class="search-control"><span class="search-mark" aria-hidden="true">⌕</span><input class="form-control" data-filter="search" placeholder="Search order number or customer" value="${escapeHtml(searchText)}" /></label>
      <select class="form-select filter-select" data-filter="status"><option value="">All order statuses</option>${["Pending","Processing","Shipped","Delivered","Cancelled"].map((status) => `<option ${listFilters.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>
      <select class="form-select filter-select" data-filter="payment"><option value="">All payment statuses</option>${["Pending","Paid","Failed"].map((status) => `<option ${listFilters.payment === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Order book</h2><p class="panel-subtitle">Payment and fulfilment are tracked separately</p></div><span class="record-count">${orders.length} orders</span></div>${tableMarkup(["Order number","Customer","Date","Total","Payment","Order status",""], orderRows(visible), "No orders found", "Change the filters or create an order.")}<footer class="table-footer"><span>Showing ${orders.length ? (ordersPage - 1) * pageSize + 1 : 0}–${Math.min(ordersPage * pageSize, orders.length)} of ${orders.length} orders</span><div class="pagination"><button class="page-button" data-action="orders-page" data-page="${ordersPage - 1}" ${ordersPage <= 1 ? "disabled" : ""} aria-label="Previous orders page">‹</button><span>Page ${ordersPage} of ${pageCount}</span><button class="page-button" data-action="orders-page" data-page="${ordersPage + 1}" ${ordersPage >= pageCount ? "disabled" : ""} aria-label="Next orders page">›</button></div></footer></section>`;
  }

  function shippingMarkup() {
    const activeOrders = state.orders.filter((order) => ["Pending","Processing","Shipped"].includes(order.status))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const rows = activeOrders.map((order) => `<tr><td class="primary-text">${escapeHtml(order.number)}</td><td>${escapeHtml(customerName(order.customerId))}</td><td>${badge(order.status)}</td><td>${badge(order.paymentStatus)}</td><td>${order.status === "Shipped" ? button("advance-order","Mark delivered",{id:order.id,small:true,kind:"primary"}) : order.status === "Processing" ? button("advance-order","Mark shipped",{id:order.id,small:true,kind:"primary"}) : button("advance-order","Start processing",{id:order.id,small:true,kind:"primary",disabled:order.paymentStatus !== "Paid"})}</td><td>${button("order-detail","Details",{id:order.id,small:true})}</td></tr>`).join("");
    return `${pageHeader("shipping")}
      <div class="metric-grid fulfilment-metrics">${[["Awaiting processing",state.orders.filter((order)=>order.status==="Pending").length],["In preparation",state.orders.filter((order)=>order.status==="Processing").length],["In transit",state.orders.filter((order)=>order.status==="Shipped").length],["Delivered",state.orders.filter((order)=>order.status==="Delivered").length],["Cancelled",state.orders.filter((order)=>order.status==="Cancelled").length],["Payment checks",state.orders.filter((order)=>order.paymentStatus!=="Paid"&&order.status!=="Cancelled").length]].map(([label,value])=>`<article class="metric-card"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong></article>`).join("")}</div>
      <section class="panel fulfilment-queue"><div class="panel-heading"><div><h2 class="panel-title">Dispatch queue</h2><p class="panel-subtitle">Available next actions for orders that are not yet complete</p></div><span class="record-count">${activeOrders.length} active orders</span></div>${tableMarkup(["Order","Customer","Order status","Payment status","Next action",""], rows, "No active fulfilment orders", "New or active orders will appear here.")}</section>`;
  }

  function customersMarkup() {
    const query = searchText.toLowerCase();
    const customers = state.customers.filter((customer) => `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase().includes(query));
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(customers.length / pageSize));
    customersPage = Math.min(customersPage, pageCount);
    const visible = customers.slice((customersPage - 1) * pageSize, customersPage * pageSize);
    const rows = visible
      .map((customer) => {
        const orders = state.orders.filter((order) => order.customerId === customer.id);
        const total = orders.filter((order) => order.paymentStatus === "Paid" && order.status !== "Cancelled")
          .reduce((sum, order) => sum + order.total, 0);
        return `<tr><td class="primary-text">${escapeHtml(customer.name)}</td><td>${escapeHtml(customer.email)}</td><td>${escapeHtml(customer.phone || "—")}</td><td>${orders.length}</td><td class="numeric">${money.format(total)}</td><td>${button("customer-detail","View",{id:customer.id,small:true})}</td></tr>`;
      }).join("");
    const customerRevenue = state.orders.filter((order) => order.paymentStatus === "Paid" && order.status !== "Cancelled")
      .reduce((sum, order) => sum + order.total, 0);
    const payingCustomers = new Set(state.orders
      .filter((order) => order.paymentStatus === "Paid" && order.status !== "Cancelled")
      .map((order) => order.customerId)).size;
    return `${pageHeader("customers")}<section class="collection-summary customer-summary" aria-label="Customer summary">
        <div class="collection-total"><span>CUSTOMER MATCHES</span><strong>${customers.length}</strong></div>
        <div class="collection-fact"><strong>${payingCustomers}</strong><span>with paid orders</span></div>
        <div class="collection-fact"><strong>${money.format(customerRevenue)}</strong><span>paid order value</span></div>
      </section><div class="toolbar"><label class="search-control"><span class="search-mark" aria-hidden="true">⌕</span><input class="form-control" data-filter="search" placeholder="Search customer name or contact" value="${escapeHtml(searchText)}" /></label></div>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Customer directory</h2><p class="panel-subtitle">Contact details and paid order history</p></div><span class="record-count">${customers.length} records</span></div>${tableMarkup(["Customer","Email","Phone","Orders","Paid order value",""], rows, "No customers found", "Customers appear when included in orders.")}<footer class="table-footer"><span>Showing ${customers.length ? (customersPage - 1) * pageSize + 1 : 0}–${Math.min(customersPage * pageSize, customers.length)} of ${customers.length} customers</span><div class="pagination"><button class="page-button" data-action="customers-page" data-page="${customersPage - 1}" ${customersPage <= 1 ? "disabled" : ""} aria-label="Previous customers page">‹</button><span>Page ${customersPage} of ${pageCount}</span><button class="page-button" data-action="customers-page" data-page="${customersPage + 1}" ${customersPage >= pageCount ? "disabled" : ""} aria-label="Next customers page">›</button></div></footer></section>`;
  }

  function paymentsMarkup() {
    const payments = state.payments.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const rows = payments.map((payment) => {
      const order = state.orders.find((item) => item.id === payment.orderId);
      const latestAttempt = payments.find((item) => item.orderId === payment.orderId)?.id === payment.id;
      const canAttempt = state.runtime?.paymentSimulationEnabled !== false
        && latestAttempt && order?.paymentStatus !== "Paid" && order?.status !== "Cancelled";
      return `<tr><td class="primary-text">${escapeHtml(payment.reference)}</td><td>${escapeHtml(order?.number || "—")}</td><td>${escapeHtml(customerName(order?.customerId))}</td><td class="numeric">${money.format(payment.amount)}</td><td>${escapeHtml(payment.method)}</td><td>${badge(payment.status)}</td><td>${canAttempt ? `<div class="inline-actions">${button("simulate-payment","Test success",{id:payment.id,small:true,kind:"primary",extra:' data-outcome="Paid"'})}${button("simulate-payment","Test failure",{id:payment.id,small:true,kind:"danger",extra:' data-outcome="Failed"'})}</div>` : state.runtime?.paymentSimulationEnabled === false ? "Unavailable in production" : "—"}</td></tr>`;
    }).join("");
    const paymentNotice = state.runtime?.paymentSimulationEnabled === false
      ? "Test payment simulation is disabled in production. Connect a payment provider before accepting or recording online payments."
      : "Payment simulation is for testing only. It is not a payment gateway; card numbers and security codes are never collected or stored.";
    return `${pageHeader("payments")}<div class="inline-alert"><strong>Payment status.</strong> ${escapeHtml(paymentNotice)}</div>
      <section class="panel">${tableMarkup(["Reference","Order","Customer","Amount","Method","Payment status","Test outcome"], rows, "No payment records", "Payment records are created with orders.")}</section>`;
  }

  function reportsMarkup() {
    const from = reportRange.from || daysAgo(29);
    const to = reportRange.to || dateInputValue(new Date());
    const sales=state.sales||{};
    const orders=sales.orders||[];
    const inventory=state.inventory?.products||[];
    const products=sales.productPerformance||[];
    const daily=(sales.dailySales||[]).map((item)=>({
      label:new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short"}).format(new Date(`${item.date}T00:00:00`)),
      value:item.revenue,
    }));
    const maxDaily=Math.max(1,...daily.map((item)=>item.value));
    const maxRevenue=Math.max(1,...products.map((item)=>item.revenue));
    const statusCounts=["Pending","Processing","Shipped","Delivered","Cancelled"].map((status)=>[
      status,orders.filter((order)=>order.status===status).length,
    ]);
    const maxStatus=Math.max(1,...statusCounts.map((item)=>item[1]));
    const stockRows=inventory.map((product)=>`<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(categoryName(product.categoryId == null?"":String(product.categoryId)))}</td><td class="numeric">${product.quantity}</td><td class="numeric">${product.threshold}</td><td>${badge(product.quantity<=product.threshold?"Low":"In stock")}</td></tr>`).join("");
    const summary=`<div class="metric-grid report-metrics">${[
      ["Sales revenue",money.format(sales.revenue||0)],
      ["Orders",String(sales.orderCount||0)],
      ["Paid orders",String(sales.paidOrders||0)],
      ["Low stock",String(state.inventory?.lowStockCount||0)],
      ["Products",String(state.inventory?.productCount||0)],
      ["Pending payments",String(state.dashboard?.pendingPayments||0)],
    ].map(([label,value])=>`<article class="metric-card"><span class="metric-label">${label}</span><strong class="metric-value">${escapeHtml(value)}</strong></article>`).join("")}</div>`;
    return `${pageHeader("reports",button("export-report","Export CSV",{kind:"primary"}))}<div class="report-controls">${dateRangeForm(from,to,"report-range")}</div>${summary}
      <div class="report-grid">
        <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Daily sales</h2><p class="panel-subtitle">Paid, non-cancelled orders in this date range</p></div></div><div class="panel-body"><div class="bar-chart">${daily.map((day)=>`<div class="bar-column"><span class="bar-value">${day.value?escapeHtml(money.format(day.value)):""}</span><div class="bar" style="height:${Math.max(3,Math.round(day.value/maxDaily*125))}px" title="${escapeHtml(money.format(day.value))}"></div><span class="bar-label">${escapeHtml(day.label)}</span></div>`).join("")||blankState("No sales in this range","Paid sales will appear after a successful simulated payment.")}</div></div></section>
        <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Orders by status</h2><p class="panel-subtitle">Selected date range</p></div></div><div class="horizontal-bars">${statusCounts.map(([status,count])=>`<div><div class="horizontal-bar-label"><span>${escapeHtml(status)}</span><strong>${count}</strong></div><div class="horizontal-track"><div class="horizontal-fill" style="width:${Math.round(count/maxStatus*100)}%"></div></div></div>`).join("")}</div></section>
        <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Top products</h2><p class="panel-subtitle">By paid order value in selected date range</p></div></div>${products.length?`<div class="horizontal-bars">${products.slice(0,5).map((product)=>`<div><div class="horizontal-bar-label"><span>${escapeHtml(product.name)} · ${product.quantity} sold</span><strong>${escapeHtml(money.format(product.revenue))}</strong></div><div class="horizontal-track"><div class="horizontal-fill" style="width:${Math.round(product.revenue/maxRevenue*100)}%"></div></div></div>`).join("")}</div>`:blankState("No paid product sales","Paid product performance will appear when orders are recorded.")}</section>
        <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Inventory levels</h2><p class="panel-subtitle">Current product quantities and thresholds</p></div></div>${tableMarkup(["Product","Category","Stock","Threshold","Status"],stockRows,"No inventory","Add products to report stock levels.")}</section>
      </div>`;
  }

  function importsMarkup() {
    const history = state.imports.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const historyRows = history.map((item)=>`<tr><td class="primary-text">${escapeHtml(item.source)}</td><td>${localDateTime(item.createdAt)}</td><td>${item.imported}</td><td>${item.updated}</td><td>${item.skipped}</td><td>${item.failed}</td><td>${item.conversionRate?`1 USD = ₹${item.conversionRate}`:"—"}</td><td>${escapeHtml(item.actor)}</td></tr>`).join("");
    const previewMarkup = importPreview.length ? `<div class="import-preview"><table class="data-table"><thead><tr><th><input type="checkbox" data-action="toggle-all-imports" aria-label="Select all preview products" checked /></th><th>Product</th><th>Category</th><th>Source price (USD)</th><th>Availability</th></tr></thead><tbody>${importPreview.map((item,index)=>{
      const existing=state.products.find((product)=>product.externalId===String(item.id));
      return `<tr><td><input type="checkbox" data-import-index="${index}" checked aria-label="Select ${escapeHtml(item.title)}" /></td><td>${escapeHtml(item.title)}<span class="small-muted">External ID ${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.category||"Uncategorised")}</td><td>${sourceMoney.format(Number(item.price)||0)}</td><td>${badge(existing?"Update existing":"New product")}</td></tr>`;
    }).join("")}</tbody></table></div>`:blankState("No import preview yet","Fetch and review external products before choosing which records to import.") ;
    return `${pageHeader("imports",button("fetch-imports",importBusy?"Fetching…":"Fetch product preview",{kind:"primary",disabled:importBusy}))}
      <div class="inline-alert"><strong>Configured source:</strong> DummyJSON public products API. The authenticated backend fetches and validates products before they are presented for selection.</div>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Preview before importing</h2><p class="panel-subtitle">Review duplicate candidates and select valid products to add or update.</p></div>${importPreview.length?button("confirm-import","Import selected",{kind:"primary"}):""}</div><div class="panel-body">${previewMarkup}</div></section>
      <section class="panel imports-history"><div class="panel-heading"><div><h2 class="panel-title">Import history</h2><p class="panel-subtitle">Recent imports appear in the server audit log.</p></div></div>${tableMarkup(["Source","Date","Imported","Updated","Skipped","Failed","USD → INR rate","Actor"],historyRows,"No import history","Completed import counts are shown after each request; the audit log records server-side imports.")}</section>`;
  }

  function notificationsMarkup() {
    const items=notificationItems().sort((a,b)=>Number(a.read)-Number(b.read));
    const rows=items.map((item)=>`<tr><td>${badge(item.type)}</td><td class="primary-text">${escapeHtml(item.title)}<span class="small-muted">${escapeHtml(item.detail)}</span></td><td>${badge(item.read?"Read":"Unread")}</td><td>${item.id.startsWith("stock:")?button("go-product","View inventory",{id:item.id.slice(6),small:true}):button("order-detail","View order",{id:item.id.split(":")[1],small:true})}</td><td>${item.read?"—":button("mark-notification-read","Mark read",{id:item.id,small:true})}</td></tr>`).join("");
    return `${pageHeader("notifications",items.some((item)=>!item.read)?button("mark-all-read","Mark all read",{kind:"primary"}):"")}<section class="panel">${tableMarkup(["Type","Alert","State","Related record",""],rows,"You’re all caught up","Low-stock and pending-payment alerts will appear here.")}</section>`;
  }

  function staffMarkup() {
    const rows=state.staff.map((person)=>`<tr><td class="primary-text">${escapeHtml(person.email)}</td><td><span class="role-chip">${escapeHtml(person.role)}</span></td><td>${badge(person.active?"Active":"Inactive")}</td><td>${button("edit-staff",person.active?"Edit":"Reactivate",{id:person.id,small:true})}${person.active&&person.id!==String(currentSession.id)?button("deactivate-staff","Deactivate",{id:person.id,small:true,kind:"danger"}):""}</td></tr>`).join("");
    return `${pageHeader("staff",button("new-staff","Add staff account",{kind:"primary"}))}<div class="inline-alert"><strong>Server-enforced roles.</strong> Staff roles are checked by the API on every protected request. Passwords are hashed and never returned to this page.</div>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Role definitions</h2><p class="panel-subtitle">SRS roles and intended access boundaries.</p></div></div><div class="horizontal-bars">${ROLES.map((role)=>`<div><div class="horizontal-bar-label"><strong>${escapeHtml(role)}</strong></div><p class="panel-subtitle">${escapeHtml(ROLE_ACCESS[role])}</p></div>`).join("")}</div></section>
      <section class="panel staff-directory"><div class="panel-heading"><div><h2 class="panel-title">Staff accounts</h2><p class="panel-subtitle">Administrator-managed server accounts.</p></div></div>${tableMarkup(["Email","Role","Status",""],rows,"No staff entries","Create an account to grant an approved role.")}</section>`;
  }

  function activityMarkup() {
    const rows=state.audit.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((item)=>`<tr><td>${localDateTime(item.createdAt)}</td><td class="primary-text">${escapeHtml(item.action)}</td><td>${escapeHtml(item.entity)}</td><td>${escapeHtml(item.detail)}</td><td>${escapeHtml(item.actor)}</td></tr>`).join("");
    return `${pageHeader("activity")}<div class="inline-alert">Important server-side changes are recorded with actor and timestamp. Audit entries are read-only.</div><section class="panel">${tableMarkup(["Date","Action","Record","Details","Actor"],rows,"No recorded activity","Audited operations will appear here.")}</section>`;
  }

  function settingsMarkup() {
    return `${pageHeader("settings")}<div class="settings-grid">
      <section class="settings-card"><h3>API and database</h3><p>Authenticated API requests are served by Express and saved in the configured MongoDB database.</p></section>
      <section class="settings-card"><h3>Session security</h3><p>Authentication uses a short-lived, HttpOnly browser cookie. Signing out revokes the current session; “Remember” keeps it on this device for up to eight hours.</p></section>
      <section class="settings-card"><h3>Payments</h3><p>Payment outcomes are simulated for development and testing only. No card numbers or security codes are collected or stored.</p></section>
      <section class="settings-card"><h3>Revenue calculation</h3><p>Reports count paid orders only and exclude cancelled orders. Tax, shipping, and discounts are not currently applied.</p></section>
      <section class="settings-card"><h3>Administrator accounts</h3><p>Use Staff &amp; roles to create or deactivate staff accounts. Keep database backups and deployment secrets outside the application source.</p></section>
    </div>`;
  }

  function pageMarkup(route) {
    const templates={
      dashboard:dashboardMarkup,
      products:productsMarkup,
      categories:categoriesMarkup,
      inventory:inventoryMarkup,
      orders:ordersMarkup,
      shipping:shippingMarkup,
      customers:customersMarkup,
      payments:paymentsMarkup,
      reports:reportsMarkup,
      imports:importsMarkup,
      notifications:notificationsMarkup,
      staff:staffMarkup,
      activity:activityMarkup,
      settings:settingsMarkup,
    };
    return (templates[route]||dashboardMarkup)();
  }

  function render() {
    if (!state) {
      state = emptyState();
    }
    currentSession=readSession();
    if(!currentSession){renderLogin();return;}
    let route=location.hash.slice(1)||"dashboard";
    if(route==="login"){
      if(currentSession)signOut();
      else renderLogin();
      return;
    }
    route=accessibleRoute(route);
    if(route!==location.hash.slice(1))location.hash=`#${route}`;
    renderShell(route);
  }

  function renderFatal(message) {
    app.innerHTML=`<main class="login-page"><section class="login-card"><h1>TechMart data could not be loaded</h1><p role="alert">${escapeHtml(message)}</p><button class="btn btn-primary" data-action="refresh" type="button">Retry</button></section></main>`;
  }

  function showDialog(title,description,content) {
    dialog.innerHTML=`<header class="dialog-header"><div><h2 class="dialog-title">${escapeHtml(title)}</h2><p class="dialog-description">${escapeHtml(description||"")}</p></div><button class="dialog-close" type="button" data-action="close-dialog" aria-label="Close dialog">×</button></header><div class="dialog-content">${content}</div>`;
    dialog.showModal();
  }

  function dialogError(form,message) {
    const existing=form.querySelector(".dialog-error");
    if(existing)existing.remove();
    const error=document.createElement("p");
    error.className="dialog-error";
    error.setAttribute("role","alert");
    error.textContent=message;
    form.prepend(error);
  }

  function categoryOptions(selected="") {
    return state.categories.filter((category)=>category.active||category.id===selected).map((category)=>`<option value="${escapeHtml(category.id)}" ${category.id===selected?"selected":""}>${escapeHtml(category.name)}${category.active?"":" (Inactive)"}</option>`).join("");
  }

  function productDialog(product=null) {
    const editing=Boolean(product);
    showDialog(editing?"Edit product":"Add product", "Enter catalogue details. SKU and numeric fields are validated before saving.",
      `<form data-form="product" data-id="${editing?escapeHtml(product.id):""}">
        <div class="form-grid">
          <div class="form-field full-width"><label class="form-label" for="product-name">Product name *</label><input class="form-control" id="product-name" name="name" maxlength="120" required value="${escapeHtml(product?.name||"")}" /></div>
          <div class="form-field"><label class="form-label" for="product-sku">SKU *</label><input class="form-control" id="product-sku" name="sku" maxlength="50" required value="${escapeHtml(product?.sku||"")}" /></div>
          <div class="form-field"><label class="form-label" for="product-category">Category *</label><select class="form-select" id="product-category" name="categoryId" required><option value="">Choose category</option>${categoryOptions(product?.categoryId||"")}</select></div>
          <div class="form-field"><label class="form-label" for="product-price">Price (INR) *</label><input class="form-control" id="product-price" name="price" type="number" min="0.01" step="0.01" required value="${product?escapeHtml(product.price):""}" /></div>
          <div class="form-field"><label class="form-label" for="product-quantity">Initial quantity *</label><input class="form-control" id="product-quantity" name="quantity" type="number" min="0" step="1" required value="${product?escapeHtml(product.quantity):"0"}" /></div>
          <div class="form-field"><label class="form-label" for="product-threshold">Low-stock threshold *</label><input class="form-control" id="product-threshold" name="threshold" type="number" min="0" step="1" required value="${product?escapeHtml(product.threshold):"5"}" /></div>
          <div class="form-field full-width"><span class="form-help">Products referenced by order history are deactivated, not permanently deleted.</span></div>
        </div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">${editing?"Save changes":"Create product"}</button></div>
      </form>`);
  }

  function categoryDialog(category=null) {
    showDialog(category?"Edit category":"Create category","Category names must be unique among active categories.",
      `<form data-form="category" data-id="${category?escapeHtml(category.id):""}"><div class="form-grid">
        <div class="form-field full-width"><label class="form-label" for="category-name">Name *</label><input class="form-control" id="category-name" name="name" maxlength="80" required value="${escapeHtml(category?.name||"")}" /></div>
        <div class="form-field full-width"><label class="form-label" for="category-description">Description</label><textarea class="form-control" id="category-description" name="description" rows="3" maxlength="240">${escapeHtml(category?.description||"")}</textarea></div>
      </div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Save category</button></div></form>`);
  }

  function staffDialog(person=null) {
    const editing=Boolean(person);
    showDialog(editing?"Update staff account":"Create staff account","Choose a server-enforced role. New and reset passwords must contain at least 12 characters.",
      `<form data-form="staff" data-id="${editing?escapeHtml(person.id):""}">
        <div class="form-field"><label class="form-label" for="staff-email">Email *</label><input class="form-control" id="staff-email" name="email" type="email" maxlength="254" required value="${escapeHtml(person?.email||"")}" ${editing?"readonly":""} /></div>
        <div class="form-field"><label class="form-label" for="staff-role">Role *</label><select class="form-select" id="staff-role" name="role" required>${ROLES.map((role)=>`<option value="${escapeHtml(role)}" ${person?.role===role?"selected":""}>${escapeHtml(role)}</option>`).join("")}</select></div>
        <div class="form-field"><label class="form-label" for="staff-password">Password ${editing?"(optional)":"*"}</label><input class="form-control" id="staff-password" name="password" type="password" minlength="12" ${editing?"":"required"} autocomplete="new-password" /><span class="form-help">Use at least 12 characters. Leave blank to keep the current password.</span></div>
        ${editing&&!person.active?'<input type="hidden" name="active" value="true" />':""}
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">${editing?"Save account":"Create account"}</button></div>
      </form>`);
  }

  function adjustmentDialog(productId="") {
    const product=state.products.find((item)=>item.id===productId);
    showDialog("Adjust inventory","Enter a positive quantity to increase stock or a negative quantity to reduce it. Stock cannot become negative.",
      `<form data-form="adjust-stock"><div class="form-grid">
        <div class="form-field full-width"><label class="form-label" for="adjust-product">Product *</label><select class="form-select" id="adjust-product" name="productId" required><option value="">Choose product</option>${state.products.filter((item)=>item.active).map((item)=>`<option value="${escapeHtml(item.id)}" ${item.id===productId?"selected":""}>${escapeHtml(item.name)} · ${escapeHtml(item.sku)} · ${item.quantity} in stock</option>`).join("")}</select></div>
        <div class="form-field"><label class="form-label" for="adjust-quantity">Quantity change *</label><input class="form-control" id="adjust-quantity" name="change" type="number" step="1" required placeholder="e.g. 5 or -2" /><span class="form-help">${product?`Current quantity: ${product.quantity}`:"Select a product to review current quantity."}</span></div>
        <div class="form-field"><label class="form-label" for="adjust-reason">Reason *</label><select class="form-select" id="adjust-reason" name="reason" required><option value="">Choose a reason</option><option>Supplier restock</option><option>Damaged goods</option><option>Stock count correction</option><option>Return received</option><option>Other</option></select></div>
        <div class="form-field full-width"><label class="form-label" for="adjust-notes">Notes</label><textarea class="form-control" id="adjust-notes" name="notes" rows="2" maxlength="240"></textarea></div>
      </div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Record adjustment</button></div></form>`);
  }

  function orderDialog() {
    const customerOptions=state.customers.map((customer)=>`<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)} · ${escapeHtml(customer.email)}</option>`).join("");
    const products=state.products.filter((product)=>product.active&&product.quantity>0);
    showDialog("Create order","The server validates stock, reads current catalogue prices, and commits the order and stock deductions together.",
      `<form data-form="order"><div class="form-grid">
        <div class="form-field full-width"><label class="form-label" for="order-customer">Customer *</label><select class="form-select" id="order-customer" name="customerId" required><option value="">Choose customer</option>${customerOptions}<option value="new">Add a new demo customer…</option></select></div>
        <div class="form-field full-width" id="new-customer-fields" hidden><label class="form-label" for="new-customer-name">Customer name *</label><input class="form-control" id="new-customer-name" name="newCustomerName" /><label class="form-label" for="new-customer-email">Customer email *</label><input class="form-control" id="new-customer-email" name="newCustomerEmail" type="email" /></div>
        <div class="form-field full-width"><label class="form-label" for="order-product">Product *</label><select class="form-select" id="order-product" name="productId" required><option value="">Choose available product</option>${products.map((product)=>`<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${money.format(product.price)} · ${product.quantity} available</option>`).join("")}</select></div>
        <div class="form-field"><label class="form-label" for="order-quantity">Quantity *</label><input class="form-control" id="order-quantity" name="quantity" type="number" min="1" step="1" value="1" required /></div>
        <div class="form-field"><label class="form-label" for="order-payment-method">Payment method</label><select class="form-select" id="order-payment-method" name="method"><option>Simulated</option><option>Cash on delivery (demo)</option><option>Bank transfer (demo)</option></select></div>
        <div class="form-field full-width"><span class="form-help" id="order-total-preview">Total will be calculated from the selected product.</span></div>
      </div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Create order</button></div></form>`);
  }

  function orderDetailDialog(orderId) {
    const order=state.orders.find((item)=>item.id===orderId);
    if(!order){showToast("That order could not be found.",true);return;}
    const customer=state.customers.find((item)=>item.id===order.customerId);
    const nextStatuses=STATUS_NEXT[order.status]||[];
    const actions=nextStatuses.map((status)=>button("set-order-status",status,{id:order.id,kind:status==="Cancelled"?"danger":"primary",extra:` data-status="${escapeHtml(status)}"`})).join("");
    const items=order.items.map((item)=>`<tr><td>${escapeHtml(item.name)}<span class="small-muted">${escapeHtml(item.sku)}</span></td><td class="numeric">${item.quantity}</td><td class="numeric">${money.format(item.unitPrice)}</td><td class="numeric">${money.format(item.unitPrice*item.quantity)}</td></tr>`).join("");
    const history=order.history.slice().sort((a,b)=>b.at.localeCompare(a.at)).map((item)=>`<div class="timeline-item"><span class="timeline-dot" aria-hidden="true"></span><div><div class="timeline-label">${escapeHtml(item.status)}${item.note?` · ${escapeHtml(item.note)}`:""}</div><div class="timeline-date">${localDateTime(item.at)}</div></div></div>`).join("");
    const paymentRows=(order.payments||[]).map((payment)=>`<tr><td>${escapeHtml(payment.reference||"—")}</td><td>${escapeHtml(payment.method||"Simulated")}</td><td>${badge(payment.status)}</td><td>${localDateTime(payment.attemptedAt||payment.createdAt)}</td></tr>`).join("");
    showDialog(`Order ${order.number}`,"Order status history and payment state are independent.",
      `<dl class="detail-list"><div><dt>Customer</dt><dd>${escapeHtml(customer?.name||"Unknown")}</dd></div><div><dt>Email</dt><dd>${escapeHtml(customer?.email||"—")}</dd></div><div><dt>Created</dt><dd>${localDateTime(order.createdAt)}</dd></div><div><dt>Order status</dt><dd>${badge(order.status)}</dd></div><div><dt>Payment status</dt><dd>${badge(order.paymentStatus)}</dd></div><div><dt>Payment method</dt><dd>${escapeHtml(order.paymentMethod||"—")}</dd></div><div><dt>Order total</dt><dd class="order-total">${money.format(order.total)}</dd></div></dl>
      <h3 class="panel-title" style="margin:20px 0 9px">Items</h3>${tableMarkup(["Product","Qty","Unit price","Line total"],items,"No order items","")}
      <h3 class="panel-title" style="margin:20px 0 3px">Status history</h3><div class="timeline">${history||blankState("No status history","")}</div>
      <h3 class="panel-title" style="margin:20px 0 8px">Payment attempts</h3>${tableMarkup(["Reference","Method","Result","Date"],paymentRows,"No payment attempts","A payment record is created with the order.")}
      <div class="dialog-actions">${actions}<button class="btn btn-secondary" type="button" data-action="close-dialog">Close</button></div>`);
  }

  function customerDetailDialog(customerId) {
    const customer=state.customers.find((item)=>item.id===customerId);
    if(!customer){showToast("That customer could not be found.",true);return;}
    const orders=state.orders.filter((order)=>order.customerId===customerId);
    const rows=orderRows(orders);
    showDialog(customer.name,"Customer contact and order-summary information.",
      `<dl class="detail-list"><div><dt>Email</dt><dd>${escapeHtml(customer.email)}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(customer.phone||"—")}</dd></div><div><dt>Total orders</dt><dd>${orders.length}</dd></div><div><dt>Paid order value</dt><dd>${money.format(orders.filter((order)=>order.paymentStatus==="Paid"&&order.status!=="Cancelled").reduce((sum,order)=>sum+order.total,0))}</dd></div></dl>
      <h3 class="panel-title" style="margin:20px 0 8px">Orders</h3>${tableMarkup(["Order","Customer","Date","Total","Payment","Status",""],rows,"No orders","")}`);
  }

  function confirmAction(title,description,formName,id,confirmLabel="Confirm",kind="danger") {
    showDialog(title,description,`<form data-form="${escapeHtml(formName)}" data-id="${escapeHtml(id||"")}"><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-${kind}" type="submit">${escapeHtml(confirmLabel)}</button></div></form>`);
  }

  function handleProductForm(form) {
    if(!form.reportValidity())return;
    const values=Object.fromEntries(new FormData(form));
    const editingId=form.dataset.id;
    const sku=values.sku.trim().toUpperCase();
    if(state.products.some((product)=>product.sku.toUpperCase()===sku&&product.id!==editingId)){
      dialogError(form,"That SKU is already assigned to another product.");return;
    }
    const price=Number(values.price),quantity=Number(values.quantity),threshold=Number(values.threshold);
    if(!Number.isFinite(price)||price<=0||!Number.isInteger(quantity)||quantity<0||!Number.isInteger(threshold)||threshold<0){
      dialogError(form,"Enter a positive price and non-negative whole-number stock and threshold values.");return;
    }
    const now=new Date().toISOString();
    const ok=updateState((next)=>{
      if(editingId){
        const product=next.products.find((item)=>item.id===editingId);
        if(!product)throw new Error("Product no longer exists.");
        Object.assign(product,{name:values.name.trim(),sku,categoryId:values.categoryId,price,quantity,threshold});
        addAudit(next,"Updated product",sku,product.name);
        if(quantity!==state.products.find((item)=>item.id===editingId).quantity){
          next.movements.unshift({id:newId("movement"),productId:editingId,change:quantity-state.products.find((item)=>item.id===editingId).quantity,reason:"Product edit stock correction",createdAt:now,actor:currentSession.email});
        }
      }else{
        const product={id:newId("product"),externalId:null,name:values.name.trim(),sku,categoryId:values.categoryId,price,quantity,threshold,active:true};
        next.products.unshift(product);
        if(quantity)next.movements.unshift({id:newId("movement"),productId:product.id,change:quantity,reason:"Initial product stock",createdAt:now,actor:currentSession.email});
        addAudit(next,"Created product",sku,product.name);
      }
    },editingId?"Product updated.":"Product created.");
    if(ok)dialog.close();
  }

  function handleCategoryForm(form) {
    if(!form.reportValidity())return;
    const values=Object.fromEntries(new FormData(form));
    const id=form.dataset.id;
    const name=values.name.trim();
    if(state.categories.some((category)=>category.active&&category.name.toLowerCase()===name.toLowerCase()&&category.id!==id)){
      dialogError(form,"An active category already uses that name.");return;
    }
    const ok=updateState((next)=>{
      if(id){
        const category=next.categories.find((item)=>item.id===id);
        Object.assign(category,{name,description:values.description.trim()});
        addAudit(next,"Updated category",name,name);
      }else{
        next.categories.push({id:newId("category"),name,description:values.description.trim(),active:true});
        addAudit(next,"Created category",name,name);
      }
    },id?"Category updated.":"Category created.");
    if(ok)dialog.close();
  }

  function handleAdjustmentForm(form) {
    if(!form.reportValidity())return;
    const values=Object.fromEntries(new FormData(form));
    const change=Number(values.change);
    const product=state.products.find((item)=>item.id===values.productId);
    if(!product||!product.active){dialogError(form,"Choose an active product.");return;}
    if(!Number.isInteger(change)||change===0){dialogError(form,"Enter a non-zero whole-number adjustment.");return;}
    if(product.quantity+change<0){dialogError(form,`Available stock is ${product.quantity}. This adjustment would make stock negative.`);return;}
    const ok=updateState((next)=>{
      const target=next.products.find((item)=>item.id===product.id);
      target.quantity+=change;
      next.movements.unshift({id:newId("movement"),productId:product.id,change,reason:`${values.reason}${values.notes.trim()?`: ${values.notes.trim()}`:""}`,createdAt:new Date().toISOString(),actor:currentSession.email});
      addAudit(next,"Adjusted inventory",product.sku,`${change>0?"+":""}${change} units · ${values.reason}`);
    },"Inventory adjustment recorded.");
    if(ok)dialog.close();
  }

  function handleOrderForm(form) {
    if(!form.reportValidity())return;
    const values=Object.fromEntries(new FormData(form));
    const product=state.products.find((item)=>item.id===values.productId);
    const quantity=Number(values.quantity);
    if(!product||!product.active){dialogError(form,"Choose an active product.");return;}
    if(!Number.isInteger(quantity)||quantity<1){dialogError(form,"Quantity must be a positive whole number.");return;}
    if(quantity>product.quantity){dialogError(form,`Only ${product.quantity} units are available.`);return;}
    let customer=state.customers.find((item)=>item.id===values.customerId);
    if(values.customerId==="new"){
      const name=values.newCustomerName.trim(),email=values.newCustomerEmail.trim().toLowerCase();
      if(!name||!email){dialogError(form,"Enter the new demo customer's name and email.");return;}
      if(state.customers.some((item)=>item.email.toLowerCase()===email)){dialogError(form,"A customer already uses that email.");return;}
      customer={id:newId("customer"),name,email,phone:""};
    }
    if(!customer){dialogError(form,"Choose a valid customer.");return;}
    const number=`TM-${Math.max(1048,...state.orders.map((order)=>Number(order.number.replace(/\D/g,""))||0))+1}`;
    const now=new Date().toISOString();
    const ok=updateState((next)=>{
      if(values.customerId==="new")next.customers.unshift(customer);
      const total=product.price*quantity;
      const order={id:newId("order"),number,customerId:customer.id,createdAt:now,status:"Pending",paymentStatus:"Pending",paymentMethod:values.method,total,items:[{productId:product.id,name:product.name,sku:product.sku,quantity,unitPrice:product.price}],history:[{status:"Pending",at:now,note:"Order created; awaiting payment"}]};
      next.products.find((item)=>item.id===product.id).quantity-=quantity;
      next.orders.unshift(order);
      next.movements.unshift({id:newId("movement"),productId:product.id,change:-quantity,reason:`Order ${number} created`,createdAt:now,actor:currentSession.email});
      next.payments.unshift({id:newId("payment"),orderId:order.id,reference:`SIM-${number}`,amount:total,method:values.method,status:"Pending",createdAt:now});
      addAudit(next,"Created order",number,`${quantity} × ${product.name}`);
    },`Demo order ${number} created; stock reserved in this browser.`);
    if(ok){dialog.close();location.hash="#orders";}
  }

  function transitionOrder(orderId,status) {
    const existing=state.orders.find((order)=>order.id===orderId);
    if(!existing){showToast("That order could not be found.",true);return;}
    if(!(STATUS_NEXT[existing.status]||[]).includes(status)){showToast(`The transition ${existing.status} → ${status} is not allowed.`,true);return;}
    if(status==="Processing"&&existing.paymentStatus!=="Paid"){showToast("A successful simulated payment is required before processing.",true);return;}
    confirmAction(`${status} order ${existing.number}?`,`This records a dated order-status history entry.${status==="Cancelled"?" Eligible cancellation restores its reserved stock exactly once.":""}`,"transition-order",`${orderId}|${status}`,`Confirm ${status}`,status==="Cancelled"?"danger":"primary");
  }

  function handleTransitionForm(form) {
    const [orderId,status]=form.dataset.id.split("|");
    const order=state.orders.find((item)=>item.id===orderId);
    if(!order||!(STATUS_NEXT[order.status]||[]).includes(status)){dialog.close();showToast("The order status changed or this transition is not allowed.",true);return;}
    const now=new Date().toISOString();
    const ok=updateState((next)=>{
      const target=next.orders.find((item)=>item.id===orderId);
      target.status=status;
      target.history.unshift({status,at:now,note:status==="Cancelled"?"Cancellation; reserved stock restored":"Status updated by authorised preview role"});
      if(status==="Cancelled"){
        for(const line of target.items){
          const product=next.products.find((item)=>item.id===line.productId);
          if(product)product.quantity+=line.quantity;
          next.movements.unshift({id:newId("movement"),productId:line.productId,change:line.quantity,reason:`Order ${target.number} cancelled; stock restored`,createdAt:now,actor:currentSession.email});
        }
      }
      addAudit(next,`Changed order to ${status}`,target.number,target.number);
    },`Order moved to ${status}.`);
    if(ok)dialog.close();
  }

  function simulatePayment(paymentId,outcome) {
    const payment=state.payments.find((item)=>item.id===paymentId);
    if(!payment||payment.status!=="Pending"){showToast("Only pending demo payments can be simulated.",true);return;}
    const ok=updateState((next)=>{
      const target=next.payments.find((item)=>item.id===paymentId);
      target.status=outcome;
      target.reference=`SIM-${outcome.toUpperCase()}-${Date.now().toString(36)}`;
      target.createdAt=new Date().toISOString();
      const order=next.orders.find((item)=>item.id===payment.orderId);
      if(order)order.paymentStatus=outcome;
      addAudit(next,`Simulated payment ${outcome}`,target.reference,order?.number||"");
    },`Demo payment marked ${outcome.toLowerCase()}.`);
    if(ok)dialog.close();
  }

  async function fetchImports() {
    if(importBusy)return;
    importBusy=true;
    render();
    try{
      const payload=await api.request("/imports/dummyjson/preview");
      if(!Array.isArray(payload))throw new Error("The import service returned an invalid product list.");
      importPreview=payload.map((item)=>({id:item.id,title:item.title,category:item.category,price:Number(item.price),sku:`DUMMY-${item.id}`,description:item.description||""}));
      showToast(`${importPreview.length} valid products are ready for preview.`);
    }catch(error){
      importPreview=[];
      console.error("Could not fetch the external product preview.",error);
      showToast(error instanceof TypeError?"Could not reach DummyJSON. Check your network connection and try again.":error.message,true);
    }finally{
      importBusy=false;
      render();
    }
  }

  function confirmImports() {
    const selected=[...document.querySelectorAll("[data-import-index]:checked")].map((checkbox)=>importPreview[Number(checkbox.dataset.importIndex)]).filter(Boolean);
    if(!selected.length){showToast("Select at least one valid product to import.",true);return;}
    showDialog("Confirm product import",`${selected.length} product${selected.length===1?"":"s"} selected. Existing external IDs will be updated; new products are added.`,
      `<form data-form="confirm-import"><p>The source prices are in US dollars. Enter the conversion rate to save catalogue prices in Indian rupees. All imported items will be added to the <strong>Imported</strong> category.</p><div class="form-field"><label class="form-label" for="import-rate">INR per USD *</label><input class="form-control" id="import-rate" name="exchangeRate" type="number" min="0.01" step="0.01" required placeholder="Enter the rate to apply" /></div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Import selected</button></div></form>`);
  }

  function handleImportForm(form) {
    const selected=[...document.querySelectorAll("[data-import-index]:checked")].map((checkbox)=>importPreview[Number(checkbox.dataset.importIndex)]).filter(Boolean);
    if(!selected.length){dialog.close();showToast("Select at least one product.",true);return;}
    if(!form.reportValidity())return;
    const exchangeRate=Number(new FormData(form).get("exchangeRate"));
    if(!Number.isFinite(exchangeRate)||exchangeRate<=0){dialogError(form,"Enter a valid positive USD-to-INR conversion rate.");return;}
    const importedCategoryName="Imported";
    const now=new Date().toISOString();
    const counts={imported:0,updated:0,skipped:0,failed:0};
    const ok=updateState((next)=>{
      let category=next.categories.find((item)=>item.name===importedCategoryName);
      if(!category){category={id:newId("category"),name:importedCategoryName,description:"Products imported from the configured external source",active:true};next.categories.push(category);}
      for(const item of selected){
        if(!Number.isFinite(item.price)||item.price<=0||!item.title.trim()){counts.failed++;continue;}
        const existing=next.products.find((product)=>product.externalId===String(item.id));
        if(existing){
          Object.assign(existing,{name:item.title.trim(),sourcePriceUsd:item.price,price:Math.round(item.price*exchangeRate*100)/100,categoryId:category.id});
          counts.updated++;
        }else{
          if(next.products.some((product)=>product.sku===item.sku)){counts.skipped++;continue;}
          next.products.unshift({id:newId("product"),externalId:String(item.id),sourcePriceUsd:item.price,name:item.title.trim(),sku:item.sku,categoryId:category.id,price:Math.round(item.price*exchangeRate*100)/100,quantity:0,threshold:5,active:true});
          counts.imported++;
        }
      }
      next.imports.unshift({id:newId("import"),source:"DummyJSON",createdAt:now,conversionRate:exchangeRate,...counts,actor:currentSession.email});
      addAudit(next,"Imported products","DummyJSON",`${counts.imported} imported · ${counts.updated} updated · ${counts.skipped} skipped · ${counts.failed} failed · 1 USD = ₹${exchangeRate}`);
    },`Import complete: ${counts.imported} imported, ${counts.updated} updated, ${counts.skipped} skipped, ${counts.failed} failed.`);
    if(ok){importPreview=[];dialog.close();}
  }

  function exportReport() {
    const from=reportRange.from||daysAgo(29),to=reportRange.to||dateInputValue(new Date());
    const lines=[["Order number","Date","Customer","Total (INR)","Payment status","Order status"].join(",")];
    state.orders.filter((order)=>inRange(order.createdAt,from,to)).forEach((order)=>{
      const values=[order.number,order.createdAt.slice(0,10),customerName(order.customerId),order.total,order.paymentStatus,order.status];
      lines.push(values.map((value)=>{
        const text=String(value);
        const safe=/^[\t\r=+\-@]/.test(text)?`'${text}`:text;
        return `"${safe.replace(/"/g,'""')}"`;
      }).join(","));
    });
    const blob=new Blob([`\uFEFF${lines.join("\r\n")}`],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download=`techmart-report-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleFormSubmit(form) {
    const formName=form.dataset.form;
    if(formName==="login-form"){
      if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      const submit=form.querySelector('button[type="submit"]');
      submit.disabled=true;
      try {
        currentSession=await api.login(values.email.trim().toLowerCase(),values.password,document.querySelector("#remember-login").checked);
        state=emptyState();
        location.hash="#dashboard";
        if(!await reloadWorkspace({showLoading:true}))return;
        render();
      } catch(error) {
        const message=document.querySelector("#login-message");
        message.textContent=error.message||"Sign-in failed. Check your credentials and try again.";
        message.className="form-message error";
        message.hidden=false;
      } finally {
        submit.disabled=false;
      }
      return;
    }
    if(formName==="product"){
      if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      const product={
        name:values.name.trim(),
        sku:values.sku.trim().toUpperCase(),
        categoryId:Number(values.categoryId),
        price:Number(values.price),
        quantity:Number(values.quantity),
        threshold:Number(values.threshold),
      };
      try {
        await api.request(form.dataset.id?`/products/${Number(form.dataset.id)}`:"/products",{
          method:form.dataset.id?"PATCH":"POST",body:product,
        });
        dialog.close();
        await reloadWorkspace();
        showToast(form.dataset.id?"Product updated in MongoDB.":"Product created in MongoDB.");
      } catch(error) { dialogError(form,error.message); }
      return;
    }
    if(formName==="category"){
      if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      const body={name:values.name.trim(),description:values.description.trim()||null};
      try {
        await api.request(form.dataset.id?`/categories/${Number(form.dataset.id)}`:"/categories",{
          method:form.dataset.id?"PATCH":"POST",body,
        });
        dialog.close();
        await reloadWorkspace();
        showToast(form.dataset.id?"Category updated.":"Category created.");
      } catch(error) { dialogError(form,error.message); }
      return;
    }
    if(formName==="adjust-stock"){
      if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      try {
        await api.request("/inventory/adjustments",{method:"POST",body:{
          productId:Number(values.productId),
          changeQuantity:Number(values.change),
          reason:[values.reason,values.notes.trim()].filter(Boolean).join(": "),
        }});
        dialog.close();
        await reloadWorkspace();
        showToast("Inventory adjustment recorded.");
      } catch(error) { dialogError(form,error.message); }
      return;
    }
    if(formName==="order"){
      if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      let customerId=Number(values.customerId);
      try {
        if(values.customerId==="new"){
          const customer=await api.request("/customers",{method:"POST",body:{
            name:values.newCustomerName.trim(),
            email:values.newCustomerEmail.trim().toLowerCase(),
          }});
          customerId=customer.id;
        }
        const order=await api.request("/orders",{method:"POST",body:{
          customerId,
          items:[{productId:Number(values.productId),quantity:Number(values.quantity)}],
        }});
        dialog.close();
        await reloadWorkspace();
        location.hash="#orders";
        showToast(`Order ${order.number} created; stock and payment record saved.`);
      } catch(error) { dialogError(form,error.message); }
      return;
    }
    if(formName==="transition-order"){
      const [orderId,status]=form.dataset.id.split("|");
      try {
        await api.request(`/orders/${Number(orderId)}/status`,{method:"PATCH",body:{status}});
        dialog.close();
        await reloadWorkspace();
        showToast(`Order moved to ${status}.`);
      } catch(error) { dialogError(form,error.message); }
      return;
    }
    if(formName==="confirm-import"){
      if(!form.reportValidity())return;
      const selected=[...document.querySelectorAll("[data-import-index]:checked")]
        .map((checkbox)=>importPreview[Number(checkbox.dataset.importIndex)])
        .filter(Boolean);
      if(!selected.length){dialogError(form,"Select at least one product.");return;}
      const exchangeRate=Number(new FormData(form).get("exchangeRate"));
      try {
        const result=await api.request("/imports/dummyjson",{method:"POST",body:{
          ids:selected.map((item)=>Number(item.id)),exchangeRate,
        }});
        dialog.close();
        importPreview=[];
        await reloadWorkspace();
        const summary=`Import complete: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed.`;
        if(result.errors?.length){
          showDialog("Import results",summary,tableMarkup(["External ID","Reason"],result.errors.map((item)=>`<tr><td>${escapeHtml(item.externalId)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join(""),"No import errors",""));
          showToast("Some selected products could not be imported. Review the listed reasons.",true);
        }else showToast(summary);
      } catch(error) { dialogError(form,error.message); }
      return;
    }
    if(formName==="staff"){
      if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      const body=form.dataset.id
        ? {role:values.role,...(values.password?{password:values.password}:{}),...(values.active?{active:true}:{})}
        : {email:values.email.trim().toLowerCase(),password:values.password,role:values.role};
      try {
        await api.request(form.dataset.id?`/staff/${Number(form.dataset.id)}`:"/staff",{
          method:form.dataset.id?"PATCH":"POST",body,
        });
        dialog.close();
        await reloadWorkspace();
        showToast(form.dataset.id?"Staff account updated.":"Staff account created.");
      } catch(error) { dialogError(form,error.message); }
      return;
    }
    if(formName==="dashboard-range"||formName==="report-range"){
      if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      if(values.from>values.to){showToast("The start date must be on or before the end date.",true);return;}
      if(formName==="dashboard-range")dashboardRange={from:values.from,to:values.to};
      else reportRange={from:values.from,to:values.to};
      await reloadWorkspace({showLoading:true});
      return;
    }
  }

  async function handleAction(target) {
    const action=target.dataset.action;
    const id=target.dataset.id;
    if(action==="toggle-login-password"){
      const input=document.querySelector("#login-password");
      const reveal=input.type==="password";
      input.type=reveal?"text":"password";
      target.textContent=reveal?"Hide":"Show";
      return;
    }
    if(action==="toggle-sidebar"){
      const sidebar=document.querySelector("#sidebar");
      const isOpen=sidebar?.classList.toggle("is-open")||false;
      target.setAttribute("aria-expanded",String(isOpen));
      return;
    }
    if(action==="profile-menu"){confirmAction("Sign out of TechMart?","Your current browser session will be revoked immediately.","sign-out","");return;}
    if(action==="close-dialog"){dialog.close();return;}
    if(action==="refresh"){if(await reloadWorkspace({showLoading:true}))showToast("Live data refreshed from the server.");return;}
    if(action==="new-product"){productDialog();return;}
    if(action==="edit-product"){const product=state.products.find((item)=>item.id===id);if(product)productDialog(product);return;}
    if(action==="deactivate-product"){confirmAction("Deactivate this product?","The product remains in saved order history. If it has orders, it will be retained rather than removed.","deactivate-product",id,"Deactivate");return;}
    if(action==="activate-product"){await apiAction(`/products/${Number(id)}`,{method:"PATCH",body:{active:true}},"Product reactivated.");return;}
    if(action==="new-category"){categoryDialog();return;}
    if(action==="edit-category"){const category=state.categories.find((item)=>item.id===id);if(category)categoryDialog(category);return;}
    if(action==="deactivate-category"){const used=state.products.some((product)=>product.categoryId===id);confirmAction("Deactivate this category?",used?"Products currently use this category. They remain unchanged, while this category is no longer offered for new products.":"This category will be marked inactive.","deactivate-category",id,"Deactivate");return;}
    if(action==="activate-category"){await apiAction(`/categories/${Number(id)}`,{method:"PATCH",body:{active:true}},"Category reactivated.");return;}
    if(action==="adjust-stock"){adjustmentDialog(id);return;}
    if(action==="new-adjustment"){adjustmentDialog();return;}
    if(action==="new-order"){orderDialog();return;}
    if(action==="order-detail"){
      try { orderDetailDialog(await api.orderDetail(id)); }
      catch(error) { showToast(error.message,true); }
      return;
    }
    if(action==="customer-detail"){customerDetailDialog(id);return;}
    if(action==="advance-order"){
      const order=state.orders.find((item)=>item.id===id);
      if(order){const next=STATUS_NEXT[order.status]?.[0];if(next)transitionOrder(id,next);}
      return;
    }
    if(action==="set-order-status"){transitionOrder(id,target.dataset.status);return;}
    if(action==="simulate-payment"){
      const payment=state.payments.find((item)=>item.id===id);
      if(!payment){showToast("Payment record not found.",true);return;}
      const outcome=target.dataset.outcome==="Paid"?"success":"failure";
      await apiAction(`/orders/${Number(payment.orderId)}/payment-attempt`,{
        method:"POST",body:{outcome,method:"Simulated"},
      },`Simulated payment ${outcome} recorded.`);
      return;
    }
    if(action==="go-imports"){location.hash="#imports";return;}
    if(action==="fetch-imports"){fetchImports();return;}
    if(action==="confirm-import"){confirmImports();return;}
    if(action==="toggle-all-imports"){
      document.querySelectorAll("[data-import-index]").forEach((checkbox)=>{checkbox.checked=target.checked;});return;
    }
    if(action==="go-product"){location.hash="#inventory";return;}
    if(action==="mark-notification-read"||action==="mark-all-read"){
      const notificationIds=action==="mark-all-read"?notificationItems().map((item)=>item.id):[id];
      await apiAction("/notifications/read",{method:"POST",body:{ids:notificationIds}},"Notification state updated.");return;
    }
    if(action==="products-page"){currentPage=Math.max(1,Number(target.dataset.page)||1);render();return;}
    if(action==="orders-page"){ordersPage=Math.max(1,Number(target.dataset.page)||1);render();return;}
    if(action==="customers-page"){customersPage=Math.max(1,Number(target.dataset.page)||1);render();return;}
    if(action==="export-report"){exportReport();return;}
    if(action==="new-staff"){staffDialog();return;}
    if(action==="edit-staff"){const person=state.staff.find((item)=>item.id===id);if(person)staffDialog(person);return;}
    if(action==="deactivate-staff"){confirmAction("Deactivate this staff account?","The account will lose API access immediately. Existing tokens will no longer be accepted.","deactivate-staff",id,"Deactivate");return;}
    if(action==="reset-demo"){showToast("Preview reset is disabled for the live MongoDB workspace.",true);return;}
  }

  async function handleConfirmedAction(form) {
    const action=form.dataset.form,id=form.dataset.id;
    if(action==="sign-out"){dialog.close();await signOut();return;}
    if(action==="deactivate-product"){
      await apiAction(`/products/${Number(id)}`,{method:"DELETE"},"Product deactivated.",{close:true});return;
    }
    if(action==="deactivate-category"){
      await apiAction(`/categories/${Number(id)}`,{method:"DELETE"},"Category deactivated.",{close:true});return;
    }
    if(action==="deactivate-staff"){
      await apiAction(`/staff/${Number(id)}`,{method:"PATCH",body:{active:false}},"Staff account deactivated.",{close:true});return;
    }
  }

  document.addEventListener("submit",(event)=>{
    const form=event.target.closest("form");
    if(!form)return;
    event.preventDefault();
    if(["sign-out","deactivate-product","deactivate-category","deactivate-staff"].includes(form.dataset.form)){void handleConfirmedAction(form);return;}
    void handleFormSubmit(form);
  });

  document.addEventListener("click",(event)=>{
    const action=event.target.closest("[data-action]");
    if(action){void handleAction(action);return;}
    if(event.target===dialog)dialog.close();
  });

  document.addEventListener("input",(event)=>{
    const filter=event.target.dataset.filter;
    if(filter==="search"){
      searchText=event.target.value;
      currentPage=1;
      ordersPage=1;
      customersPage=1;
      const position=event.target.selectionStart;
      render();
      const replacement=document.querySelector('[data-filter="search"]');
      if(replacement){replacement.focus();replacement.setSelectionRange(position,position);}
      return;
    }
    if(event.target.name==="quantity"||event.target.name==="productId"){
      const form=event.target.closest('form[data-form="order"]');
      if(!form)return;
      const product=state.products.find((item)=>item.id===form.elements.productId.value);
      const quantity=Number(form.elements.quantity.value)||0;
      const preview=form.querySelector("#order-total-preview");
      if(preview)preview.textContent=product?`Estimated total: ${money.format(product.price*quantity)} · ${product.quantity} unit(s) available`:"Total will be calculated from the selected product.";
    }
  });

  document.addEventListener("change",(event)=>{
    const filter=event.target.dataset.filter;
    if(!filter||filter==="search")return;
    listFilters[filter]=event.target.value;
    currentPage=1;
    ordersPage=1;
    customersPage=1;
    render();
  });

  document.addEventListener("change",(event)=>{
    if(event.target.id==="order-customer"){
      const fields=document.querySelector("#new-customer-fields");
      const enabled=event.target.value==="new";
      fields.hidden=!enabled;
      fields.querySelectorAll("input").forEach((input)=>{input.required=enabled;});
    }
  });

  window.addEventListener("hashchange",()=>{
    document.querySelector("#sidebar")?.classList.remove("is-open");
    searchText="";
    currentPage=1;
    ordersPage=1;
    customersPage=1;
    listFilters={};
    render();
  });

  async function boot() {
    state=emptyState();
    currentSession=await api.validateSession();
    if(!location.hash)location.hash=currentSession?"#dashboard":"#login";
    if(currentSession) await reloadWorkspace({showLoading:true});
    else render();
  }

  void boot();
})();
