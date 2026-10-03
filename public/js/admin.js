/* ADMIN PANEL DASHBOARD & INVENTORY MANAGEMENT LOGIC */


/* REAL DATABASE FETCH FUNCTION */
async function fetchProductsFromDB() {
  try {
    const response = await fetch('http://localhost:5000/api/products');
    const result = await response.json();
    if (result.success && Array.isArray(result.data)) {
      return result.data;
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch products from DB:", error);
    return [];
  }
}

let LOYALTY_USERS = [];

const TOTAL_ORDERS_PROCESSED = 1842;

function isoLocal(offsetMs) {
  const d = new Date(Date.now() + offsetMs);
  d.setSeconds(0, 0);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let FLASH_SALES = [];
let nextFlashSaleId = 1;

const NETWORK_DELAY = 150;
function delay(ms = NETWORK_DELAY) { return new Promise(res => setTimeout(res, ms)); }

/* API WRAPPERS CONNECTED TO REAL DATABASE */

async function apiGetProducts() {
  return await fetchProductsFromDB();
}

async function apiSaveProduct(product) {
  const pId = product.id || product.product_id;
  const response = await fetch('http://localhost:5000/api/products' + (pId ? '/' + pId : ''), {
    method: pId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product)
  });
  return await response.json();
}

async function apiDeleteProduct(id) {
  const response = await fetch('http://localhost:5000/api/products/' + id, { method: 'DELETE' });
  return await response.json();
}

async function apiGetLoyaltyUsers() {
  const response = await fetch('http://localhost:5000/api/loyalty-stats');
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.message || 'Failed to load loyalty data');
  return result.data.map(u => ({
    id: u.user_id,
    name: u.name,
    total_spent: Number(u.total_spent || 0),
    points: Number(u.loyalty_points || 0),
    tier: u.tier_level,
    eligible: Number(u.loyalty_eligible || 0) === 1
  }));
}

async function apiGetFlashSales() {
  const response = await fetch('http://localhost:5000/api/admin/flash-sales');
  if (!response.ok) throw new Error('Failed to load flash sales');
  return await response.json();
}

async function apiLaunchFlashSale(payload) {
  const response = await fetch('http://localhost:5000/api/flash-sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not launch flash sale');
  return result.sale;
}

async function apiCancelFlashSale(id) {
  const response = await fetch(`http://localhost:5000/api/flash-sales/${id}/cancel`, {
    method: 'PATCH'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not cancel flash sale');
  return result;
}

/* TAB NAVIGATION */

const TAB_META = {
  dashboard:  { title: "System Analytics & DBMS Overview", subtitle: "Live snapshot generated from stored procedures & triggers" },
  products:   { title: "Inventory & Stock Management",     subtitle: "Product catalog backed by the PRODUCTS table" },
  flashsales: { title: "Flash Sale Manager",               subtitle: "Time-boxed discount campaigns with concurrency-safe stock" },
};

function switchTab(tabName) {
  Object.keys(TAB_META).forEach(key => {
    document.getElementById(`view-${key}`).classList.toggle("hidden", key !== tabName);
    document.querySelector(`[data-tab-btn="${key}"]`).classList.toggle("active", key === tabName);
  });
  document.getElementById("pageTitle").textContent = TAB_META[tabName].title;
  document.getElementById("pageSubtitle").textContent = TAB_META[tabName].subtitle;

  if (tabName === "dashboard") renderDashboard();
  if (tabName === "products") renderProductsView();
  if (tabName === "flashsales") renderFlashSalesView();
}

/* TOAST HELPER */

let toastTimer = null;
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toastIcon");
  document.getElementById("toastMessage").textContent = message;

  if (type === "error") {
    icon.classList.remove("text-emerald-400");
    icon.classList.add("text-rose-400");
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>';
  } else {
    icon.classList.remove("text-rose-400");
    icon.classList.add("text-emerald-400");
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7"/>';
  }

  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

/* FORMATTING HELPERS */

function formatTaka(amount) {
  return "৳" + Number(amount).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function getTier(points) {
  if (points >= 1000) return "Gold";
  if (points >= 200) return "Silver";
  return "Bronze";
}

function tierBadge(tier) {
  const styles = {
    Gold:   "bg-gold-100 text-gold-700 ring-1 ring-inset ring-gold-200",
    Silver: "bg-slate-200 text-slate-700 ring-1 ring-inset ring-slate-300",
    Bronze: "bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-200",
  };
  return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${styles[tier]}">${tier}</span>`;
}

function stockStatus(qty) {
  if (qty === 0) return { label: "Out of Stock", style: "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200" };
  if (qty <= 10) return { label: "Low Stock",    style: "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200" };
  return { label: "In Stock", style: "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200" };
}

function flashSaleStatus(sale) {
  const now = Date.now();
  const start = new Date(sale.start_time).getTime();
  const end = new Date(sale.end_time).getTime();
  if (sale.status === 'Ended' || now > end) return { label: "Ended", style: "bg-slate-200 text-slate-500 ring-1 ring-inset ring-slate-300" };
  if (now < start) return { label: "Scheduled", style: "bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200" };
  return { label: "Active", style: "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200" };
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function skeletonRow(cols) {
  return `<tr>${Array.from({length: cols}).map(() => `<td class="px-5 py-4"><div class="skeleton h-4 w-full rounded"></div></td>`).join("")}</tr>`;
}

/* DASHBOARD VIEW */

let cachedLoyaltyUsers = [];
let cachedFlashSales = [];
let cachedProducts = [];

async function renderDashboard() {
  document.getElementById("loyaltyTableBody").innerHTML = skeletonRow(5).repeat(4);

  const [products, users, sales] = await Promise.all([
    apiGetProducts(),
    apiGetLoyaltyUsers(),
    apiGetFlashSales(),
  ]);

  cachedProducts = products;
  cachedLoyaltyUsers = users;
  cachedFlashSales = sales;

  const activeFlashCount = sales.filter(s => flashSaleStatus(s).label === "Active").length;
  const goldCount = users.filter(u => getTier(u.points) === "Gold").length;

  document.getElementById("metricTotalProducts").textContent = products.length.toLocaleString();
  document.getElementById("metricActiveFlash").textContent = activeFlashCount.toLocaleString();
  document.getElementById("metricTotalOrders").textContent = TOTAL_ORDERS_PROCESSED.toLocaleString();
  document.getElementById("metricGoldCustomers").textContent = goldCount.toLocaleString();

  renderLoyaltyTable();
}

function renderLoyaltyTable() {
  const query = (document.getElementById("loyaltySearch").value || "").trim().toLowerCase();
  const tbody = document.getElementById("loyaltyTableBody");

  const filtered = cachedLoyaltyUsers
    .filter(u => !query || u.name.toLowerCase().includes(query) || String(u.id).includes(query))
    .sort((a, b) => b.points - a.points);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-10 text-center text-sm text-slate-400">No customers match “${escapeHtml(query)}”.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const tier = u.tier || getTier(u.points);
    const eligibility = u.eligible
      ? '<span class="text-emerald-700 font-medium">Eligible</span>'
      : '<span class="text-slate-400">Below ৳5,000</span>';
    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-5 py-3.5 font-mono-num text-slate-500">#${u.id}</td>
        <td class="px-5 py-3.5 font-medium text-slate-800">${escapeHtml(u.name)}</td>
        <td class="px-5 py-3.5 font-mono-num text-slate-700">${formatTaka(u.total_spent)}</td>
        <td class="px-5 py-3.5 font-mono-num text-slate-700">${u.points.toLocaleString()} pts</td>
        <td class="px-5 py-3.5">${tierBadge(tier)}<div class="mt-1 text-[11px]">${eligibility}</div></td>
      </tr>`;
  }).join("");
}

/* PRODUCTS VIEW WITH MYSQL DATA COMPATIBILITY */

async function renderProductsView() {
  document.getElementById("productsTableBody").innerHTML = skeletonRow(6).repeat(5);
  cachedProducts = await apiGetProducts();
  populateCategoryFilter();
  renderProductsTable();
}

function populateCategoryFilter() {
  const select = document.getElementById("categoryFilter");
  const current = select.value || "all";
  const categories = [...new Set(cachedProducts.map(p => p.category || 'General'))].sort();
  select.innerHTML = `<option value="all">All categories</option>` +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value = categories.includes(current) ? current : "all";
}

function renderProductsTable() {
  const query = (document.getElementById("productSearch").value || "").trim().toLowerCase();
  const category = document.getElementById("categoryFilter").value;
  const tbody = document.getElementById("productsTableBody");

  const filtered = cachedProducts.filter(p => {
    const pId = p.product_id || p.id;
    const matchesQuery = !query || p.name.toLowerCase().includes(query) || String(pId).includes(query);
    const matchesCategory = category === "all" || (p.category || 'General') === category;
    return matchesQuery && matchesCategory;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-10 text-center text-sm text-slate-400">No products found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const pId = p.product_id || p.id;
    const status = stockStatus(p.stock_quantity);
    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-5 py-3.5 font-mono-num text-slate-500">#${pId}</td>
        <td class="px-5 py-3.5">
          <p class="font-medium text-slate-800">${escapeHtml(p.name)}</p>
          <p class="text-xs text-slate-400">${escapeHtml(p.category || 'General')}</p>
        </td>
        <td class="px-5 py-3.5 font-mono-num text-slate-700">${formatTaka(p.price)}</td>
        <td class="px-5 py-3.5 font-mono-num text-slate-700">${p.stock_quantity}</td>
        <td class="px-5 py-3.5"><span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${status.style}">${status.label}</span></td>
        <td class="px-5 py-3.5">
          <div class="flex items-center justify-end gap-2">
            <button onclick="openProductModal(${pId})" class="px-2.5 py-1.5 text-xs font-medium rounded-md text-brand-700 bg-brand-50 hover:bg-brand-100 transition">Edit</button>
            <button onclick="confirmDeleteProduct(${pId})" class="px-2.5 py-1.5 text-xs font-medium rounded-md text-rose-700 bg-rose-50 hover:bg-rose-100 transition">Delete</button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

function openProductModal(id) {
  const modal = document.getElementById("productModal");
  const form = document.getElementById("productForm");
  form.reset();

  if (id) {
    const product = cachedProducts.find(p => Number(p.product_id || p.id) === Number(id));
    document.getElementById("productModalTitle").textContent = "Edit Product";
    document.getElementById("productId").value = product.product_id || product.id;
    document.getElementById("productName").value = product.name;
    document.getElementById("productDescription").value = product.description || "";
    document.getElementById("productCategory").value = product.category || "";
    document.getElementById("productPrice").value = product.price;
    document.getElementById("productStock").value = product.stock_quantity;
  } else {
    document.getElementById("productModalTitle").textContent = "Add New Product";
    document.getElementById("productId").value = "";
  }

  modal.classList.remove("hidden");
}

function closeProductModal() {
  document.getElementById("productModal").classList.add("hidden");
}

async function handleSaveProduct(event) {
  event.preventDefault();
  const submitBtn = event.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  const idValue = document.getElementById("productId").value;
  const product = {
    id: idValue ? Number(idValue) : undefined,
    name: document.getElementById("productName").value.trim(),
    description: document.getElementById("productDescription").value.trim(),
    category: document.getElementById("productCategory").value.trim(),
    price: parseFloat(document.getElementById("productPrice").value),
    stock_quantity: parseInt(document.getElementById("productStock").value, 10),
  };

  try {
    await apiSaveProduct(product);
    cachedProducts = await apiGetProducts();
    populateCategoryFilter();
    renderProductsTable();
    closeProductModal();
    showToast(idValue ? "Product updated successfully." : "Product added to inventory.");
  } catch (err) {
    showToast("Could not save product. Please try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Product";
  }
}

async function confirmDeleteProduct(id) {
  const product = cachedProducts.find(p => Number(p.product_id || p.id) === Number(id));
  if (!product) return;
  const ok = confirm(`Delete "${product.name}"? This cannot be undone.`);
  if (!ok) return;

  await apiDeleteProduct(id);
  cachedProducts = await apiGetProducts();
  populateCategoryFilter();
  renderProductsTable();
  showToast(`"${product.name}" was deleted.`);
}

/* FLASH SALES VIEW */

async function renderFlashSalesView() {
  document.getElementById("flashSalesTableBody").innerHTML = skeletonRow(6).repeat(3);

  if (cachedProducts.length === 0) {
    cachedProducts = await apiGetProducts();
  }
  populateProductDropdown();

  cachedFlashSales = await apiGetFlashSales();
  renderFlashSalesTable();

  document.getElementById("fsStart").value = isoLocal(5 * 60 * 1000);
  document.getElementById("fsEnd").value = isoLocal(4 * 60 * 60 * 1000);
}

function populateProductDropdown() {
  const select = document.getElementById("fsProduct");
  select.innerHTML = cachedProducts
    .filter(p => p.stock_quantity > 0)
    .map(p => `<option value="${p.product_id || p.id}">${escapeHtml(p.name)} · ${formatTaka(p.price)} · ${p.stock_quantity} in stock</option>`)
    .join("");
}

function productName(id) {
  const p = cachedProducts.find(p => Number(p.product_id || p.id) === Number(id));
  return p ? p.name : `Product #${id}`;
}

function renderFlashSalesTable() {
  const tbody = document.getElementById("flashSalesTableBody");

  if (cachedFlashSales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-10 text-center text-sm text-slate-400">No flash sales scheduled yet.</td></tr>`;
    return;
  }

  const sorted = [...cachedFlashSales].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  tbody.innerHTML = sorted.map(sale => {
    const status = flashSaleStatus(sale);
    const isActive = status.label === "Active";
    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-5 py-3.5 font-medium text-slate-800">${escapeHtml(productName(sale.product_id))}</td>
        <td class="px-5 py-3.5 font-mono-num text-emerald-700 font-semibold">-${sale.discount_percentage}%</td>
        <td class="px-5 py-3.5 font-mono-num text-slate-700">${sale.flash_stock} units</td>
        <td class="px-5 py-3.5 text-slate-600 text-xs">
          ${formatDateTime(sale.start_time)} <span class="text-slate-300">→</span> ${formatDateTime(sale.end_time)}
        </td>
        <td class="px-5 py-3.5">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${status.style}">
            ${isActive ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot text-emerald-500"></span>' : ''}
            ${status.label}
          </span>
        </td>
        <td class="px-5 py-3.5 text-right">
          ${status.label !== "Ended" ? `<button onclick="cancelFlashSale(${sale.id})" class="px-2.5 py-1.5 text-xs font-medium rounded-md text-rose-700 bg-rose-50 hover:bg-rose-100 transition">End Sale</button>` : '<span class="text-xs text-slate-400">History</span>'}
        </td>
      </tr>`;
  }).join("");
}

async function handleLaunchFlashSale(event) {
  event.preventDefault();
  const errorEl = document.getElementById("fsFormError");
  errorEl.classList.add("hidden");

  const productId = Number(document.getElementById("fsProduct").value);
  const discount = Number(document.getElementById("fsDiscount").value);
  const flashStock = Number(document.getElementById("fsStock").value);
  const start = document.getElementById("fsStart").value;
  const end = document.getElementById("fsEnd").value;

  const product = cachedProducts.find(p => (p.product_id || p.id) === productId);
  if (new Date(end) <= new Date(start)) {
    errorEl.textContent = "End time must be after the start time.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (product && flashStock > product.stock_quantity) {
    errorEl.textContent = `Flash stock (${flashStock}) exceeds available inventory (${product.stock_quantity}).`;
    errorEl.classList.remove("hidden");
    return;
  }

  const submitBtn = document.getElementById("fsSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Launching…";

  try {
    await apiLaunchFlashSale({
      product_id: productId,
      discount_percentage: discount,
      flash_stock: flashStock,
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
    });
    cachedFlashSales = await apiGetFlashSales();
    renderFlashSalesTable();
    document.getElementById("flashSaleForm").reset();
    document.getElementById("fsStart").value = isoLocal(5 * 60 * 1000);
    document.getElementById("fsEnd").value = isoLocal(4 * 60 * 60 * 1000);
    showToast(`Flash sale launched for "${product ? product.name : 'product'}".`);
  } catch (err) {
    showToast("Could not launch flash sale. Please try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 2 3 14h7l-1 8 11-14h-7l1-6Z"/></svg>
      Launch Flash Sale`;
  }
}

async function cancelFlashSale(id) {
  const ok = confirm("Cancel this flash sale? Any in-progress discount will stop immediately.");
  if (!ok) return;
  try {
    await apiCancelFlashSale(id);
    cachedFlashSales = await apiGetFlashSales();
    renderFlashSalesTable();
    showToast("Flash sale ended.");
  } catch (err) {
    showToast(err.message || "Could not cancel flash sale.", "error");
  }
}

/* INITIALIZATION */

document.addEventListener("DOMContentLoaded", () => {
  renderDashboard();
  setInterval(() => {
    const flashView = document.getElementById("view-flashsales");
    if (flashView && !flashView.classList.contains("hidden")) renderFlashSalesTable();
  }, 30000);
});