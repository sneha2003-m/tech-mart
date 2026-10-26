
      const today = new Date();

      function dateDaysAgo(days) {
        const date = new Date(today);
        date.setDate(date.getDate() - days);
        return [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-");
      }

      const demoOrders = [
        { number: "TM-1048", customer: "Rohan Verma", daysAgo: 0, total: 29990, payment: "Paid", status: "Processing" },
        { number: "TM-1047", customer: "Ananya Patel", daysAgo: 1, total: 114900, payment: "Paid", status: "Shipped" },
        { number: "TM-1046", customer: "Karan Sharma", daysAgo: 2, total: 8995, payment: "Pending", status: "Pending" },
        { number: "TM-1045", customer: "Sneha Menon", daysAgo: 4, total: 48450, payment: "Paid", status: "Delivered" },
        { number: "TM-1044", customer: "Devendra Kumar", daysAgo: 8, total: 9499, payment: "Paid", status: "Delivered" },
        { number: "TM-1043", customer: "Isha Nair", daysAgo: 12, total: 2799, payment: "Failed", status: "Pending" },
        { number: "TM-1042", customer: "Kabir Shah", daysAgo: 21, total: 15990, payment: "Paid", status: "Cancelled" },
        { number: "TM-1041", customer: "Maya Rao", daysAgo: 35, total: 72900, payment: "Paid", status: "Delivered" },
      ].map((order) => ({ ...order, date: dateDaysAgo(order.daysAgo) }));

      const demoProducts = [
        { name: "Sony WH-1000XM5", sku: "SNY-XM5-BLK", quantity: 2, threshold: 5 },
        { name: "MacBook Air M2", sku: "APL-MBA-M2-MD", quantity: 3, threshold: 5 },
        { name: "Logitech MX Master 3S", sku: "LOG-MXM3S-GR", quantity: 4, threshold: 4 },
        { name: "Keychron K2 Pro", sku: "KEY-K2P-BLK", quantity: 18, threshold: 5 },
        { name: "Dell UltraSharp 27", sku: "DEL-U2723QE", quantity: 12, threshold: 4 },
        { name: "Anker USB-C Hub", sku: "ANK-7IN1-HUB", quantity: 3, threshold: 6 },
      ];

      const dateFilter = document.querySelector("#date-filter");
      const startDate = document.querySelector("#start-date");
      const endDate = document.querySelector("#end-date");
      const filterError = document.querySelector("#filter-error");
      const currency = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      });

      function setText(id, value) {
        document.getElementById(id).textContent = value;
      }

      function renderOrders(orders) {
        const tableBody = document.querySelector("#recent-orders");
        tableBody.replaceChildren();

        if (orders.length === 0) {
          const row = document.createElement("tr");
          const cell = document.createElement("td");
          cell.colSpan = 6;
          cell.className = "empty-row";
          cell.textContent = "No demo orders found for this date range.";
          row.append(cell);
          tableBody.append(row);
          return;
        }

        for (const order of orders.slice(0, 6)) {
          const row = document.createElement("tr");
          const values = [
            order.number,
            order.customer,
            new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
              new Date(`${order.date}T00:00:00`),
            ),
            currency.format(order.total),
          ];

          for (const value of values) {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
          }

          for (const [value, kind] of [
            [order.payment, order.payment.toLowerCase()],
            [order.status, order.status.toLowerCase()],
          ]) {
            const cell = document.createElement("td");
            const badge = document.createElement("span");
            badge.className = `badge ${kind}`;
            badge.textContent = value;
            cell.append(badge);
            row.append(cell);
          }

          tableBody.append(row);
        }
      }

      function renderLowStock() {
        const lowStockProducts = demoProducts.filter(
          (product) => product.quantity <= product.threshold,
        );
        const list = document.querySelector("#low-stock-list");
        list.replaceChildren();
        setText("metric-products", String(demoProducts.length));
        setText("metric-low-stock", String(lowStockProducts.length));

        if (lowStockProducts.length === 0) {
          const message = document.createElement("p");
          message.className = "stock-item";
          message.textContent = "No products are at or below their stock threshold.";
          list.append(message);
          return;
        }

        for (const product of lowStockProducts) {
          const item = document.createElement("div");
          item.className = "stock-item";
          const identity = document.createElement("div");
          const name = document.createElement("div");
          name.className = "stock-name";
          name.textContent = product.name;
          const sku = document.createElement("div");
          sku.className = "stock-sku";
          sku.textContent = `SKU: ${product.sku}`;
          identity.append(name, sku);
          const count = document.createElement("div");
          count.className = "stock-count";
          count.textContent = `${product.quantity} in stock · threshold ${product.threshold}`;
          item.append(identity, count);
          list.append(item);
        }
      }

      function updateDashboard(from, through) {
        const matchingOrders = demoOrders.filter(
          (order) => order.date >= from && order.date <= through,
        );
        const revenue = matchingOrders
          .filter((order) => order.payment === "Paid" && order.status !== "Cancelled")
          .reduce((sum, order) => sum + order.total, 0);
        const pendingOrders = matchingOrders.filter((order) => order.status === "Pending").length;
        const pendingPayments = matchingOrders.filter((order) => order.payment === "Pending");
        const pendingPaymentAmount = pendingPayments.reduce((sum, order) => sum + order.total, 0);

        setText("metric-revenue", currency.format(revenue));
        setText("metric-orders", String(matchingOrders.length));
        setText("metric-pending-orders", String(pendingOrders));
        setText("metric-pending-payments", currency.format(pendingPaymentAmount));
        setText(
          "metric-pending-payment-count",
          `${pendingPayments.length} pending payment${pendingPayments.length === 1 ? "" : "s"} in range`,
        );
        renderOrders(matchingOrders);
      }

      dateFilter.addEventListener("submit", (event) => {
        event.preventDefault();
        if (startDate.value > endDate.value) {
          filterError.textContent = "The start date must be on or before the end date.";
          filterError.hidden = false;
          return;
        }

        filterError.hidden = true;
        updateDashboard(startDate.value, endDate.value);
      });

      const todayString = dateDaysAgo(0);
      startDate.value = dateDaysAgo(6);
      endDate.value = todayString;
      startDate.max = todayString;
      endDate.max = todayString;
      updateDashboard(startDate.value, endDate.value);
      renderLowStock();
    