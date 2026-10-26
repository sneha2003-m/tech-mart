
      const screens = [
        { id: "dashboard", label: "Dashboard", path: "dashboard.html", nav: "Dashboard" },
        { id: "products", label: "Products", path: "products.html", nav: "Products" },
        { id: "categories", label: "Categories", path: "categories.html", nav: "Categories" },
        { id: "inventory", label: "Inventory", path: "inventory.html", nav: "Inventory" },
        { id: "orders", label: "Orders", path: "orders.html", nav: "Orders" },
        { id: "order-details", label: "Order details", path: "order-details.html" },
        { id: "customers", label: "Customers", path: "customers.html", nav: "Customers" },
        { id: "payments", label: "Payments", path: "payments.html", nav: "Payments" },
        { id: "shipping", label: "Shipping & delivery", path: "shipping-delivery.html", nav: "Shipping Delivery" },
        { id: "reports", label: "Reports & analytics", path: "reports-analytics.html", nav: "Reports Analytics" },
        { id: "api-imports", label: "External API imports", path: "external-api-imports.html", nav: "External API Imports" },
        { id: "staff", label: "Staff & roles", path: "staff-roles.html", nav: "Staff Roles" },
        { id: "activity-logs", label: "Activity logs", path: "activity-logs.html", nav: "Activity Logs" },
        { id: "notifications", label: "Notifications", path: "notifications.html", nav: "Notifications" },
        { id: "settings", label: "Settings", path: "settings.html", nav: "Settings" },
        { id: "login", label: "Admin login", path: "admin-login.html" },
      ];

      const picker = document.querySelector("#screen-select");
      const screenPicker = document.querySelector("#screen-picker");
      const frame = document.querySelector("#screen-frame");
      const sessionLabel = document.querySelector("#demo-session-label");
      const signOutButton = document.querySelector("#sign-out");
      const demoSessionKey = "techmart.demo.session";
      const screensById = new Map(screens.map((screen) => [screen.id, screen]));
      const screensByNavLabel = new Map(
        screens.filter((screen) => screen.nav).map((screen) => [screen.nav.toLowerCase(), screen]),
      );

      for (const screen of screens) {
        if (screen.id === "login") {
          continue;
        }

        const option = document.createElement("option");
        option.value = screen.id;
        option.textContent = screen.label;
        picker.append(option);
      }

      function clearDemoSession() {
        try {
          localStorage.removeItem(demoSessionKey);
          sessionStorage.removeItem(demoSessionKey);
        } catch (error) {
          console.error("Could not clear the browser-only demo session.", error);
        }
      }

      function readDemoSession() {
        let storedSession;
        try {
          storedSession =
            localStorage.getItem(demoSessionKey) ?? sessionStorage.getItem(demoSessionKey);
        } catch (error) {
          console.error("Could not access the browser-only demo session.", error);
          return null;
        }
        if (!storedSession) {
          return null;
        }

        let session;
        try {
          session = JSON.parse(storedSession);
        } catch (error) {
          console.error("Could not read the demo session.", error);
          clearDemoSession();
          return null;
        }

        const allowedRoles = [
          "Administrator",
          "Order / Operations Staff",
          "Inventory Staff",
          "Report Viewer",
        ];
        if (
          !session ||
          typeof session.email !== "string" ||
          !allowedRoles.includes(session.role) ||
          (session.expiresAt !== null &&
            (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()))
        ) {
          clearDemoSession();
          return null;
        }

        return session;
      }

      function showScreen(id, updateAddress = false) {
        const requestedScreen = screensById.get(id) ?? screens[0];
        const session = readDemoSession();
        const redirectedToLogin = !session && requestedScreen.id !== "login";
        const screen = redirectedToLogin
          ? screensById.get("login")
          : requestedScreen;

        screenPicker.hidden = !session;
        sessionLabel.hidden = !session;
        signOutButton.hidden = !session;
        if (session) {
          sessionLabel.textContent = `${session.role} · Demo mode`;
        }

        picker.value = screen.id;
        frame.title = screen.label;
        const nextPath = new URL(screen.path, window.location.href).href;

        if (frame.src !== nextPath) {
          frame.src = nextPath;
        }

        if ((updateAddress || redirectedToLogin) && window.location.hash !== `#${screen.id}`) {
          window.location.hash = screen.id;
        }
      }

      picker.addEventListener("change", () => showScreen(picker.value, true));
      signOutButton.addEventListener("click", () => {
        clearDemoSession();
        showScreen("login", true);
      });

      window.addEventListener("hashchange", () => {
        showScreen(window.location.hash.slice(1) || screens[0].id);
      });

      window.addEventListener("message", (event) => {
        const isSameOrigin =
          event.origin === window.location.origin ||
          (window.location.protocol === "file:" && event.origin === "null");
        if (
          !isSameOrigin ||
          event.source !== frame.contentWindow ||
          event.data?.type !== "techmart-demo-login"
        ) {
          return;
        }

        showScreen("dashboard", true);
      });

      frame.addEventListener("load", () => {
        try {
          const page = frame.contentDocument;
          if (!page) {
            return;
          }

          page.addEventListener("click", (event) => {
            if (!event.target || typeof event.target.closest !== "function") {
              return;
            }

            const link = event.target.closest('a[href="#"]');
            if (!link) {
              return;
            }

            const label = link.textContent.replace(/\s+/g, " ").trim().toLowerCase();
            const screen = [...screensByNavLabel.entries()]
              .find(([navLabel]) => label.endsWith(navLabel))?.[1];

            if (screen) {
              event.preventDefault();
              showScreen(screen.id, true);
            }
          });
        } catch (error) {
          console.error("Could not connect dashboard navigation. Use the screen picker instead.", error);
        }
      });

      showScreen(window.location.hash.slice(1) || screens[0].id);
    