const API_BASE_URL = 'http://localhost:5000/api';

const CATEGORY_STYLES = {
  Audio:       { badge: "bg-violet-100 text-violet-700", icon: "fa-headphones",         grad: "from-violet-500 to-fuchsia-500" },
  Wearables:   { badge: "bg-cyan-100 text-cyan-700",     icon: "fa-clock",              grad: "from-cyan-500 to-blue-500" },
  Keyboards:   { badge: "bg-amber-100 text-amber-700",   icon: "fa-keyboard",           grad: "from-amber-500 to-orange-500" },
  Accessories: { badge: "bg-emerald-100 text-emerald-700", icon: "fa-plug-circle-bolt", grad: "from-emerald-500 to-teal-500" },
};

/* --- Real API layer (Connected to Node.js/MySQL) ---- */

async function apiGetProducts() {
  try {
    const res = await fetch(`${API_BASE_URL}/products`);
    if (!res.ok) throw new Error("Failed to fetch products");
    const json = await res.json();
    
    
    if (json && Array.isArray(json.data)) return json.data;
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.products)) return json.products;
    
    return [];
  } catch (err) {
    console.error("Failed to fetch products:", err);
    return [];
  }
}

async function apiGetCategories() {
  try {
    const res = await fetch(`${API_BASE_URL}/categories`);
    if (!res.ok) throw new Error("Failed to fetch categories");
    const data = await res.json();
    if (Array.isArray(data)) {
      return data.map(c => typeof c === 'object' ? (c.category_name || c.name || c.title || '') : c).filter(Boolean);
    }
    return ["Audio", "Wearables", "Keyboards", "Accessories"];
  } catch (err) {
    console.warn("Categories API fail, using fallback:", err);
    return ["Audio", "Wearables", "Keyboards", "Accessories"];
  }
}

async function apiGetFlashSales() {
  return {
    flash_sale_id: 1,
    discount_percent: 20,
    end_time: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    product_ids: [1, 2],
  };
}

async function apiGetTopSelling() {
  try {
    const res = await fetch(`${API_BASE_URL}/products/top-selling`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

/* APP STATE & LOCAL STORAGE */

let cachedProducts = [];
let cachedCategories = [];
let cachedFlashSale = null;
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let currentUser = JSON.parse(localStorage.getItem('userInfo')) || null;
let activeCategory = "All";
let searchQuery = "";
let pendingCheckout = false;

/* FORMATTING & UTILS */

function formatTaka(amount) {
  return "৳" + Number(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function isFlashActive() {
  return cachedFlashSale && new Date() < new Date(cachedFlashSale.end_time);
}

function getFlashPrice(product) {
  const pId = product.product_id || product.id;
  if (isFlashActive() && cachedFlashSale.product_ids.includes(pId)) {
    return Math.round(product.price * (1 - cachedFlashSale.discount_percent / 100));
  }
  return null;
}

function stockBadge(stock) {
  if (stock === 0) return { label: "Out of Stock", style: "bg-rose-100 text-rose-700" };
  if (stock <= 5) return { label: "Low Stock", style: "bg-amber-100 text-amber-700" };
  return { label: "In Stock", style: "bg-emerald-100 text-emerald-700" };
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
}

/* TOAST NOTIFICATION */

let toastTimer = null;
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toastIcon");
  if (!toast) return;
  document.getElementById("toastMessage").textContent = message;
  if (icon) {
    icon.className = type === "error"
      ? "fa-solid fa-circle-exclamation text-rose-400 mt-0.5"
      : "fa-solid fa-circle-check text-emerald-400 mt-0.5";
  }
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

/* PRODUCT CARD RENDERING */

function productCardHtml(product, opts = {}) {
  const pId = product.product_id || product.id;
  const categoryName = product.category_name || product.category || "Accessories";
  const style = CATEGORY_STYLES[categoryName] || CATEGORY_STYLES.Accessories;
  const stock = stockBadge(product.stock_quantity ?? product.stock ?? 0);
  const flashPrice = getFlashPrice(product);
  const outOfStock = (product.stock_quantity ?? product.stock ?? 0) === 0;

  return `
    <div class="fade-in card-hover bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
      <div class="relative h-36 bg-gradient-to-br ${style.grad} flex items-center justify-center">
        <i class="fa-solid ${style.icon} text-white text-4xl opacity-90"></i>
        ${opts.isTopSeller ? `<span class="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 text-orange-600 text-[10px] font-bold uppercase tracking-wide"><i class="fa-solid fa-fire text-[10px]"></i> Top Seller</span>` : ""}
        ${flashPrice ? `<span class="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-900/90 text-cyan-300 text-[10px] font-bold uppercase tracking-wide"><i class="fa-solid fa-bolt text-[10px]"></i> -${cachedFlashSale.discount_percent}%</span>` : ""}
      </div>
      <div class="p-4 flex flex-col flex-1">
        <span class="inline-block w-fit px-2 py-0.5 rounded-full text-[11px] font-semibold ${style.badge} mb-2">${escapeHtml(categoryName)}</span>
        <h3 class="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 min-h-[2.5rem]">${escapeHtml(product.name)}</h3>

        <div class="flex items-center gap-2 mt-2">
          ${flashPrice
            ? `<span class="font-mono font-bold text-slate-900">${formatTaka(flashPrice)}</span>
               <span class="font-mono text-xs text-slate-400 line-through">${formatTaka(product.price)}</span>`
            : `<span class="font-mono font-bold text-slate-900">${formatTaka(product.price)}</span>`
          }
        </div>

        <span class="inline-flex w-fit px-2 py-0.5 rounded-full text-[10px] font-semibold mt-2 ${stock.style}">${stock.label}</span>

        <div class="flex items-center gap-2 mt-4">
          <button ${outOfStock ? "disabled" : ""} onclick="addToCart(${pId})"
            class="flex-1 text-xs font-semibold py-2.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
            <i class="fa-solid fa-cart-plus mr-1"></i> Add
          </button>
          <button ${outOfStock ? "disabled" : ""} onclick="buyNow(${pId})"
            class="flex-1 text-xs font-semibold py-2.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed">
            Buy Now
          </button>
        </div>
      </div>
    </div>`;
}

/* CATEGORY & CATALOG CONTROL */

function renderCategoryControls() {
  const pillContainer = document.getElementById("categoryPills");
  const select = document.getElementById("headerCategorySelect");

  const all = ["All", ...(Array.isArray(cachedCategories) ? cachedCategories : [])];
  
  if (pillContainer) {
    pillContainer.innerHTML = all.map(cat => `
      <button onclick="setActiveCategory('${escapeHtml(cat)}')" data-cat-pill="${escapeHtml(cat)}"
        class="pill shrink-0 px-4 py-2 rounded-full text-sm font-medium border ${cat.toLowerCase() === activeCategory.toLowerCase() ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}">
        ${escapeHtml(cat)}
      </button>`).join("");
  }

  if (select) {
    select.innerHTML = all.map(cat => `<option value="${escapeHtml(cat)}">${cat === "All" ? "All Categories" : escapeHtml(cat)}</option>`).join("");
    select.value = activeCategory;
    select.onchange = (e) => setActiveCategory(e.target.value);
  }
}

function setActiveCategory(category) {
  activeCategory = category;
  const select = document.getElementById("headerCategorySelect");
  if (select) select.value = category;
  renderCategoryControls();
  renderCatalog();
}

async function renderTopSellers() {
  const grid = document.getElementById("topSellersGrid");
  if (!grid) return;
  grid.innerHTML = Array.from({ length: 4 }).map(() => `<div class="h-64 rounded-2xl skeleton"></div>`).join("");

  const topSelling = await apiGetTopSelling();
  grid.innerHTML = topSelling.length > 0
    ? topSelling.map(p => productCardHtml(p, { isTopSeller: true })).join("")
    : `<p class="text-xs text-slate-400">অর্ডার শুরু হলে সেরা পণ্যগুলো এখানে দেখাবে।</p>`;
}

function renderCatalog() {
  const grid = document.getElementById("productGrid");
  const emptyState = document.getElementById("emptyState");
  const heading = document.getElementById("catalogHeading");
  const countLabel = document.getElementById("catalogCount");

  if (!grid) return;
  if (heading) heading.textContent = activeCategory === "All" ? "All Products" : activeCategory;

  const productsToFilter = Array.isArray(cachedProducts) ? cachedProducts : [];

  const filtered = productsToFilter.filter(p => {
    const catName = String(p.category_name || p.category || "").trim().toLowerCase();
    const currentCat = activeCategory.trim().toLowerCase();
    
    const matchesCategory = currentCat === "all" || catName === currentCat;
    const matchesSearch = !searchQuery || (p.name && p.name.toLowerCase().includes(searchQuery)) || catName.includes(searchQuery);
    return matchesCategory && matchesSearch;
  });

  if (countLabel) countLabel.textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"}`;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    grid.classList.add("hidden");
    if (emptyState) {
      emptyState.classList.remove("hidden");
      emptyState.classList.add("flex");
    }
    return;
  }

  grid.classList.remove("hidden");
  if (emptyState) {
    emptyState.classList.add("hidden");
    emptyState.classList.remove("flex");
  }
  grid.innerHTML = filtered.map(p => productCardHtml(p)).join("");
}

function handleSearch() {
  const input = document.getElementById("searchInput");
  if (input) {
    searchQuery = input.value.trim().toLowerCase();
    renderCatalog();
  }
}

/* CART OPERATIONS & REAL CHECKOUT */

function addToCart(productId, quantity = 1) {
  const product = (Array.isArray(cachedProducts) ? cachedProducts : []).find(p => (p.product_id || p.id) === productId);
  if (!product) return;

  const stock = product.stock_quantity ?? product.stock ?? 0;
  if (stock === 0) return;

  const unitPrice = getFlashPrice(product) || product.price;
  const existing = cart.find(item => item.product_id === productId);

  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({
      product_id: productId,
      name: product.name,
      category: product.category_name || product.category,
      price: unitPrice,
      quantity
    });
  }

  saveCart();
  updateCartBadge();
  renderCartItems();
  showToast(`"${product.name}" কার্টে যুক্ত করা হয়েছে।`);
}

function buyNow(productId) {
  addToCart(productId);
  openCartDrawer();
}

function changeQty(productId, delta) {
  const item = cart.find(i => i.product_id === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter(i => i.product_id !== productId);
  }
  saveCart();
  updateCartBadge();
  renderCartItems();
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.product_id !== productId);
  saveCart();
  updateCartBadge();
  renderCartItems();
}

function cartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function updateCartBadge() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const badge = document.getElementById("cartBadge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function renderCartItems() {
  const list = document.getElementById("cartItemsList");
  const emptyState = document.getElementById("cartEmptyState");
  const footer = document.getElementById("cartFooter");

  if (!list) return;

  if (cart.length === 0) {
    list.innerHTML = "";
    list.classList.add("hidden");
    if (footer) footer.classList.add("hidden");
    if (emptyState) emptyState.classList.remove("hidden");
    return;
  }

  list.classList.remove("hidden");
  if (footer) footer.classList.remove("hidden");
  if (emptyState) emptyState.classList.add("hidden");

  list.innerHTML = cart.map(item => {
    const style = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.Accessories;
    return `
      <div class="flex items-center gap-3">
        <div class="w-14 h-14 shrink-0 rounded-xl bg-gradient-to-br ${style.grad} flex items-center justify-center">
          <i class="fa-solid ${style.icon} text-white text-lg"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-slate-800 truncate">${escapeHtml(item.name)}</p>
          <p class="text-xs text-slate-500 font-mono mt-0.5">${formatTaka(item.price)} each</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="changeQty(${item.product_id}, -1)" class="w-7 h-7 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs">−</button>
          <span class="w-5 text-center text-sm font-medium">${item.quantity}</span>
          <button onclick="changeQty(${item.product_id}, 1)" class="w-7 h-7 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs">+</button>
        </div>
        <button onclick="removeFromCart(${item.product_id})" class="text-slate-300 hover:text-rose-500 transition ml-1">
          <i class="fa-solid fa-trash-can text-xs"></i>
        </button>
      </div>`;
  }).join("");

  const subtotalEl = document.getElementById("cartSubtotal");
  const totalEl = document.getElementById("cartTotal");
  if (subtotalEl) subtotalEl.textContent = formatTaka(cartTotal());
  if (totalEl) totalEl.textContent = formatTaka(cartTotal());
}

function openCartDrawer() {
  renderCartItems();
  const overlay = document.getElementById("cartOverlay");
  const panel = document.getElementById("cartPanel");
  if (overlay) overlay.classList.remove("hidden");
  if (panel) requestAnimationFrame(() => panel.classList.remove("translate-x-full"));
}

function closeCartDrawer() {
  const overlay = document.getElementById("cartOverlay");
  const panel = document.getElementById("cartPanel");
  if (panel) panel.classList.add("translate-x-full");
  if (overlay) setTimeout(() => overlay.classList.add("hidden"), 300);
}

/* REAL AUTHENTICATION (NODE.JS SERVER) */

function handleAuthButtonClick() {
  if (currentUser) {
    logout();
  } else {
    openAuthModal("login");
  }
}

function openAuthModal(mode) {
  switchAuthTab(mode || "login");
  const modal = document.getElementById("authModal");
  if (modal) modal.classList.remove("hidden");
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (modal) modal.classList.add("hidden");
  pendingCheckout = false;
}

function switchAuthTab(mode) {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginTab = document.getElementById("tabLoginBtn");
  const registerTab = document.getElementById("tabRegisterBtn");

  const showLogin = mode === "login";
  if (loginForm) loginForm.classList.toggle("hidden", !showLogin);
  if (registerForm) registerForm.classList.toggle("hidden", showLogin);
  if (loginTab) loginTab.className = `flex-1 text-sm font-medium py-2 rounded-full transition ${showLogin ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`;
  if (registerTab) registerTab.className = `flex-1 text-sm font-medium py-2 rounded-full transition ${!showLogin ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`;
}

function setLoggedInUI() {
  const label = document.getElementById("authButtonLabel");
  const btn = document.getElementById("authButton");
  if (label) label.textContent = currentUser ? currentUser.name.split(" ")[0] : "Login / Register";
  if (btn) {
    const icon = btn.querySelector("i");
    if (icon) icon.className = currentUser ? "fa-solid fa-circle-user text-xs" : "fa-regular fa-user text-xs";
  }
}

async function handleLogin(event) {
  event.preventDefault();
  
  const form = event.target;
  const email = form.querySelector('input[type="email"]').value;
  const password = form.querySelector('input[type="password"]').value;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `Login failed (${res.status})`);
    }

    const data = await res.json();

    localStorage.setItem('authToken', data.token);
    localStorage.setItem('userInfo', JSON.stringify(data.user));
    currentUser = data.user;

    if (currentUser && (currentUser.role || '').toLowerCase() === 'admin') {
      window.location.href = 'admin.html';
      return;
    }

    closeAuthModal();
    setLoggedInUI();
    showToast(`Welcome back, ${currentUser.name || 'User'}!`);

    if (pendingCheckout) {
      pendingCheckout = false;
      submitOrder();
    }

  } catch (err) {
    console.error("Login Error:", err);
    alert(err.message || "Server error, check if backend is running!");
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const name = document.getElementById("regName").value;
  const email = event.target.querySelector('input[type="email"]').value;
  const password = event.target.querySelector('input[type="password"]').value;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();

    if (res.ok) {
      showToast("Account created successfully! Please login");
      switchAuthTab("login");
    } else {
      showToast(data.message || "Registration error", "error");
    }
  } catch (err) {
    showToast("Server connection error", "error");
  }
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('userInfo');
  currentUser = null;
  setLoggedInUI();
  showToast("Logout successfully");
}

/* CHECKOUT PROCESS WITH MYSQL DATABASE */

function handleCheckout() {
  if (cart.length === 0) return;

  const token = localStorage.getItem('authToken');
  if (!token || !currentUser) {
    pendingCheckout = true;
    closeCartDrawer();
    openAuthModal("login");
    return;
  }

  submitOrder();
}

async function submitOrder() {
  const token = localStorage.getItem('authToken');
  const checkoutBtn = document.getElementById("checkoutBtn");

  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = "Placing order…";
  }

  try {
    const payload = {
      cartItems: cart,
      totalAmount: cartTotal()
    };

    const response = await fetch(`${API_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok) {
      cart = [];
      saveCart();
      updateCartBadge();
      renderCartItems();
      closeCartDrawer();
      showToast(`Order #${result.orderId || result.id} saved successfully!`);
    } else {
      showToast(result.message || "Order not saved", "error");
    }
  } catch (err) {
    console.error('Order Error:', err);
    showToast("Technical error for processing order", "error");
  } finally {
    if (checkoutBtn) {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = "Proceed to Checkout";
    }
  }
}

/* --- 1. RENDER ACTIVE FLASH SALES --- */
async function loadFlashSales() {
  try {
    const res = await fetch(`${API_BASE_URL}/flash-sales`);
    const sales = await res.json();
    const container = document.getElementById("flashSaleContainer");

    if (!container || sales.length === 0) return;

    container.innerHTML = sales.map(item => {
      const discountPrice = Math.round(item.price * (1 - item.discount_percentage / 100));
      return `
        <div class="p-4 border rounded-xl bg-gradient-to-r from-violet-50 to-pink-50 flex justify-between items-center">
          <div>
            <span class="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">FLASH SALE -${item.discount_percentage}%</span>
            <h4 class="font-bold text-slate-800 mt-1">${escapeHtml(item.name)}</h4>
            <div class="flex items-center gap-2">
              <span class="text-slate-900 font-bold">${formatTaka(discountPrice)}</span>
              <span class="text-xs text-slate-400 line-through">${formatTaka(item.price)}</span>
            </div>
          </div>
          <button onclick="addToCart(${item.product_id})" class="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold">
            Grab Now
          </button>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Flash sale load failed", err);
  }
}

/* --- 2. USER LOYALTY BADGE DISPLAY --- */
async function loadUserLoyalty() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE_URL}/users/${currentUser.user_id}/loyalty`);
    const data = await res.json();
    
    const badgeEl = document.getElementById("userLoyaltyBadge");
    if (badgeEl && data) {
      badgeEl.innerHTML = `
        <span class="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-800 font-semibold">
          <i class="fa-solid fa-crown text-amber-500"></i> ${data.tier_level} (${data.loyalty_points} pts)
        </span>`;
    }
  } catch (err) {
    console.error("Loyalty data error", err);
  }
}

/* --- 3. PRODUCT REVIEWS MODAL/RENDER --- */
async function showProductReviews(productId) {
  try {
    const res = await fetch(`${API_BASE_URL}/products/${productId}/reviews`);
    const reviews = await res.json();
    
    const reviewList = document.getElementById("reviewsList");
    if (!reviewList) return;

    reviewList.innerHTML = reviews.length > 0 
      ? reviews.map(r => `
          <div class="border-b py-2">
            <div class="flex justify-between items-center">
              <span class="text-xs font-bold text-slate-700">${escapeHtml(r.user_name)}</span>
              <span class="text-amber-400 text-xs">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
            </div>
            <p class="text-xs text-slate-600 mt-0.5">${escapeHtml(r.comment)}</p>
          </div>
        `).join('')
      : `<p class="text-xs text-slate-400">Kono review nei. Prothom review din!</p>`;

  } catch (err) {
    console.error("Reviews load failed", err);
  }
}

/* APP INITIALIZATION */

async function init() {
  const grid = document.getElementById("productGrid");
  if (grid) grid.innerHTML = Array.from({ length: 8 }).map(() => `<div class="h-72 rounded-2xl skeleton"></div>`).join("");

  const [products, categories, flashSale] = await Promise.all([
    apiGetProducts(),
    apiGetCategories(),
    apiGetFlashSales()
  ]);

  cachedProducts = products;
  cachedCategories = categories;
  cachedFlashSale = flashSale;

  renderCategoryControls();
  renderCatalog();
  renderTopSellers();
  updateCartBadge();
  setLoggedInUI();
}

document.addEventListener("DOMContentLoaded", init);