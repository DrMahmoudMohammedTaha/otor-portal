/* ==========================================================================
   OTOR Single Page Application Frontend Script
   Supporting Role-Based Access Control (Admin & Sheikh Portals)
   ========================================================================== */

const API_BASE = "/api";

// State management
let currentRole = null;
let sessionToken = null;
let loggedSheikhId = null;
let currentSheikhsLoadId = 0;

// ==========================================
// Session Handling Functions
// ==========================================
function getSession() {
    sessionToken = localStorage.getItem("otor_token");
    currentRole = localStorage.getItem("otor_role");
    const sheikhIdRaw = localStorage.getItem("otor_sheikh_id");
    loggedSheikhId = sheikhIdRaw ? parseInt(sheikhIdRaw, 10) : null;
    return !!sessionToken || currentRole === "guest";
}

function saveSession(token, role, name, sheikhId) {
    localStorage.setItem("otor_token", token);
    localStorage.setItem("otor_role", role);
    localStorage.setItem("otor_name", name);
    if (sheikhId) {
        localStorage.setItem("otor_sheikh_id", sheikhId);
    } else {
        localStorage.removeItem("otor_sheikh_id");
    }
    sessionToken = token;
    currentRole = role;
    loggedSheikhId = sheikhId;
}

function clearSession() {
    localStorage.removeItem("otor_token");
    localStorage.removeItem("otor_role");
    localStorage.removeItem("otor_name");
    localStorage.removeItem("otor_sheikh_id");
    sessionToken = null;
    currentRole = null;
    loggedSheikhId = null;
}

// Fetch helper that automatically attaches authorization token headers
async function fetchSecure(url, options = {}) {
    if (!options.headers) {
        options.headers = {};
    }
    if (sessionToken) {
        options.headers["Authorization"] = `Bearer ${sessionToken}`;
    }
    if (options.body && !(options.body instanceof FormData)) {
        options.headers["Content-Type"] = "application/json";
    }
    
    const response = await fetch(url, options);
    if (response.status === 403 || response.status === 401) {
        // Session expired or unauthorized -> logout
        showToast("Session expired or unauthorized.", "error");
        handleLogout();
        throw new Error("Unauthorized");
    }
    return response;
}

// ==========================================
// Application Startup & Event Listeners
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
});

function initApp() {
    if (getSession()) {
        document.getElementById("login-overlay").classList.add("hidden");
        document.getElementById("app-workspace").classList.remove("hidden");
        
        applyRoleInterface();
    } else {
        document.getElementById("login-overlay").classList.remove("hidden");
        document.getElementById("app-workspace").classList.add("hidden");
    }
}

// Apply visual overrides based on role
function applyRoleInterface() {
    const adminNav = document.getElementById("admin-nav");
    const sheikhNav = document.getElementById("sheikh-nav");
    const guestNav = document.getElementById("guest-nav");
    const packageBadge = document.getElementById("package-badge-container");
    
    // Default resets
    adminNav.classList.add("hidden");
    sheikhNav.classList.add("hidden");
    if (guestNav) guestNav.classList.add("hidden");
    packageBadge.classList.add("hidden");
    
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    
    if (currentRole === "admin") {
        adminNav.classList.remove("hidden");
        packageBadge.classList.remove("hidden");
        
        // Show first admin page (orders)
        document.getElementById("orders-page").classList.add("active");
        document.getElementById("nav-orders").classList.add("active");
        
        // Load admin resources
        loadOrders();
        loadSheikhs();
        loadPackageTimer();
        loadExpenses();
    } else if (currentRole === "sheikh") {
        sheikhNav.classList.remove("hidden");
        
        // Show sheikh portal
        document.getElementById("sheikh-portal-page").classList.add("active");
        document.getElementById("nav-sheikh-portal").classList.add("active");
        
        // Load sheikh database records
        loadSheikhPortal();
    } else if (currentRole === "guest") {
        if (guestNav) guestNav.classList.remove("hidden");
        
        // Show gallery showroom
        document.getElementById("gallery-page").classList.add("active");
        const navGalleryGuest = document.getElementById("nav-gallery-guest");
        if (navGalleryGuest) navGalleryGuest.classList.add("active");
        
        // Load default gallery category
        const activeCategoryTab = document.querySelector("#gallery-category-tabs .tab-item.active");
        const defaultCategory = activeCategoryTab ? activeCategoryTab.getAttribute("data-category") : "1_ejaza";
        loadGallery(defaultCategory);
    }
}

function handleLogout() {
    clearSession();
    initApp();
    showToast("Logged out successfully.");
}

function setupEventListeners() {
    // ------------------------------------------
    // Login Screen Handlers
    // ------------------------------------------
    const roleRadioAdmin = document.querySelector('input[name="login-role"][value="admin"]');
    const roleRadioSheikh = document.querySelector('input[name="login-role"][value="sheikh"]');
    const loginPasswordGroup = document.getElementById("login-password-group");
    const loginPhoneGroup = document.getElementById("login-phone-group");
    const loginForm = document.getElementById("login-form");
    
    roleRadioAdmin.addEventListener("change", () => {
        loginPasswordGroup.classList.remove("hidden");
        loginPhoneGroup.classList.add("hidden");
    });
    
    roleRadioSheikh.addEventListener("change", () => {
        loginPasswordGroup.classList.add("hidden");
        loginPhoneGroup.classList.remove("hidden");
    });
    
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const selectedRole = document.querySelector('input[name="login-role"]:checked').value;
        const password = document.getElementById("login-password").value;
        const phone = document.getElementById("login-phone").value;
        
        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: selectedRole, password, phone })
            });
            
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || "Authentication failed.");
            }
            
            const data = await response.json();
            saveSession(data.token, data.role, data.name, data.sheikh_id);
            
            // Clean fields
            document.getElementById("login-password").value = "";
            document.getElementById("login-phone").value = "";
            
            showToast(`Welcome, ${data.name}!`, "success");
            initApp();
            
        } catch (err) {
            showToast(err.message, "error");
        }
    });

    const btnGalleryAccess = document.getElementById("btn-gallery-access");
    if (btnGalleryAccess) {
        btnGalleryAccess.addEventListener("click", () => {
            saveSession("", "guest", "Guest Viewer", "");
            initApp();
            showToast("Accessed Showcase Gallery as Guest.");
        });
    }

    // ------------------------------------------
    // Global Navigation & Logout
    // ------------------------------------------
    document.querySelectorAll(".nav-item[data-page]").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const targetPage = item.getAttribute("data-page");
            
            document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
            document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
            
            document.getElementById(targetPage).classList.add("active");
            item.classList.add("active");
            
            // Refresh lists upon navigational entry
            if (targetPage === "orders-page") loadOrders();
            if (targetPage === "sheikhs-page") loadSheikhs();
            if (targetPage === "expenses-page") loadExpenses();
            if (targetPage === "sheikh-portal-page") loadSheikhPortal();
            if (targetPage === "gallery-page") {
                const activeCategoryTab = document.querySelector("#gallery-category-tabs .tab-item.active");
                const category = activeCategoryTab ? activeCategoryTab.getAttribute("data-category") : "1_ejaza";
                loadGallery(category);
            }
        });
    });
    
    document.getElementById("nav-logout").addEventListener("click", (e) => {
        e.preventDefault();
        handleLogout();
    });

    // ------------------------------------------
    // Admin: Active Orders Tab Filtering
    // ------------------------------------------
    document.querySelectorAll(".tab-item").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab-item").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            loadOrders();
        });
    });

    // ------------------------------------------
    // Sheikh: Portal Subtabs
    // ------------------------------------------
    const shTabActive = document.getElementById("sh-tab-active-orders");
    const shTabHistory = document.getElementById("sh-tab-history");
    const shActivePanel = document.getElementById("sh-active-orders-panel");
    const shHistoryPanel = document.getElementById("sh-history-panel");
    
    shTabActive.addEventListener("click", () => {
        shTabActive.classList.add("active");
        shTabHistory.classList.remove("active");
        shActivePanel.classList.add("active");
        shHistoryPanel.classList.remove("active");
        loadSheikhPortal();
    });
    
    shTabHistory.addEventListener("click", () => {
        shTabActive.classList.remove("active");
        shTabHistory.classList.add("active");
        shActivePanel.classList.remove("active");
        shHistoryPanel.classList.add("active");
        loadSheikhPortal();
    });

    // ------------------------------------------
    // Orders CRUD Modals
    // ------------------------------------------
    document.getElementById("btn-new-order").addEventListener("click", () => openOrderFormModal(null));
    document.getElementById("btn-close-order-form").addEventListener("click", () => closeOrderFormModal());
    document.getElementById("order-submit-form").addEventListener("submit", handleOrderSubmit);
    
    // ------------------------------------------
    // Sheikhs CRUD Modals
    // ------------------------------------------
    document.getElementById("btn-new-sheikh").addEventListener("click", () => openSheikhFormModal(null));
    document.getElementById("btn-close-sheikh-form").addEventListener("click", () => closeSheikhFormModal());
    document.getElementById("sheikh-submit-form").addEventListener("submit", handleSheikhSubmit);
    document.getElementById("sheikhs-search-input").addEventListener("input", debounce(loadSheikhs, 300));
    
    // ------------------------------------------
    // Order Detail Modal Elements
    // ------------------------------------------
    document.getElementById("btn-close-details").addEventListener("click", () => {
        document.getElementById("details-modal").classList.add("hidden");
    });
    
    // Detail Modal Subtabs
    const subtabItems = document.getElementById("subtab-view-items");
    const subtabBulk = document.getElementById("subtab-bulk-insert");
    const tabItemsContent = document.getElementById("modal-tab-items-content");
    const tabBulkContent = document.getElementById("modal-tab-bulk-content");
    
    subtabItems.addEventListener("click", () => {
        subtabItems.classList.add("active");
        subtabBulk.classList.remove("active");
        tabItemsContent.classList.add("active");
        tabBulkContent.classList.remove("active");
    });
    
    subtabBulk.addEventListener("click", () => {
        subtabItems.classList.remove("active");
        subtabBulk.classList.add("active");
        tabItemsContent.classList.remove("active");
        tabBulkContent.classList.add("active");
    });
    
    document.getElementById("btn-add-item").addEventListener("click", handleAddSingleItem);
    document.getElementById("btn-submit-bulk").addEventListener("click", handleBulkParse);

    // ------------------------------------------
    // Cashbox & Printing Invoice Calculator
    // ------------------------------------------
    const calcInputs = document.querySelectorAll(".calc-input");
    calcInputs.forEach(input => {
        input.addEventListener("input", recalculateInvoice);
    });
    
    document.getElementById("btn-calc-clear").addEventListener("click", () => {
        calcInputs.forEach(i => i.value = "");
        recalculateInvoice();
    });
    
    document.getElementById("btn-copy-ussd").addEventListener("click", () => {
        const ussdBox = document.getElementById("ussd-output");
        ussdBox.select();
        document.execCommand("copy");
        showToast("Vodafone Cash USSD Code copied to clipboard!", "success");
    });
    
    document.querySelectorAll(".quick-phones-grid button").forEach(btn => {
        btn.addEventListener("click", () => {
            const phone = btn.getAttribute("data-phone");
            updateUSSDCode(phone, getInvoiceTotal());
        });
    });

    // ------------------------------------------
    // Expenses Ledger
    // ------------------------------------------
    document.getElementById("expense-add-form").addEventListener("submit", handleExpenseSubmit);
    
    // ------------------------------------------
    // Package Indicator Action (Admin only)
    // ------------------------------------------
    document.getElementById("package-timer-btn").addEventListener("click", async () => {
        if (currentRole !== "admin") return;
        if (!confirm("Are you sure you want to start a new print run? This will reset the elapsed time counter.")) return;
        try {
            const res = await fetchSecure(`${API_BASE}/package/start`, { method: "POST" });
            if (res.ok) {
                showToast("New package run initialized!", "success");
                loadPackageTimer();
            }
        } catch (e) {
            console.error(e);
        }
    });

    // ------------------------------------------
    // Showcase Gallery category tab switching
    // ------------------------------------------
    const galleryTabsList = document.getElementById("gallery-category-tabs");
    if (galleryTabsList) {
        galleryTabsList.querySelectorAll(".tab-item").forEach(tab => {
            tab.addEventListener("click", () => {
                galleryTabsList.querySelectorAll(".tab-item").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                const category = tab.getAttribute("data-category");
                loadGallery(category);
            });
        });
    }

    // ------------------------------------------
    // Fullscreen Gallery Viewer Handlers
    // ------------------------------------------
    const closeBtn = document.getElementById("btn-close-gallery-viewer");
    const viewerModal = document.getElementById("gallery-viewer-modal");
    if (closeBtn && viewerModal) {
        const closeViewer = () => {
            viewerModal.classList.add("hidden");
            document.getElementById("gallery-viewer-img").src = "";
        };
        closeBtn.addEventListener("click", closeViewer);
        viewerModal.addEventListener("click", (e) => {
            if (e.target === viewerModal || e.target === closeBtn) {
                closeViewer();
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !viewerModal.classList.contains("hidden")) {
                closeViewer();
            }
        });
    }


    // ------------------------------------------
    // Active Orders Search Handler
    // ------------------------------------------
    const ordersSearchInput = document.getElementById("orders-search-input");
    if (ordersSearchInput) {
        ordersSearchInput.addEventListener("input", debounce(loadOrders, 300));
    }

    // ------------------------------------------
    // Sheikh Details View Modals & Tabs Handlers
    // ------------------------------------------
    const closeSheikhDetailsBtn = document.getElementById("btn-close-sheikh-details");
    if (closeSheikhDetailsBtn) {
        closeSheikhDetailsBtn.addEventListener("click", closeSheikhDetailsModal);
    }

    const sheikhDetailsModal = document.getElementById("sheikh-details-modal");
    if (sheikhDetailsModal) {
        sheikhDetailsModal.addEventListener("click", (e) => {
            if (e.target === sheikhDetailsModal) {
                closeSheikhDetailsModal();
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const m = document.getElementById("sheikh-details-modal");
            if (m && !m.classList.contains("hidden")) {
                closeSheikhDetailsModal();
            }
        }
    });

    const tabSheikhGeneral = document.getElementById("sheikh-tab-general");
    const tabSheikhActive = document.getElementById("sheikh-tab-active-orders-btn");
    const tabSheikhHistory = document.getElementById("sheikh-tab-history-orders-btn");

    const panelSheikhGeneral = document.getElementById("sheikh-tab-general-content");
    const panelSheikhActive = document.getElementById("sheikh-tab-active-orders-content");
    const panelSheikhHistory = document.getElementById("sheikh-tab-history-orders-content");

    if (tabSheikhGeneral && tabSheikhActive && tabSheikhHistory) {
        tabSheikhGeneral.addEventListener("click", () => {
            tabSheikhGeneral.classList.add("active");
            tabSheikhActive.classList.remove("active");
            tabSheikhHistory.classList.remove("active");
            
            panelSheikhGeneral.classList.add("active");
            panelSheikhActive.classList.remove("active");
            panelSheikhHistory.classList.remove("active");
        });
        
        tabSheikhActive.addEventListener("click", () => {
            tabSheikhGeneral.classList.remove("active");
            tabSheikhActive.classList.add("active");
            tabSheikhHistory.classList.remove("active");
            
            panelSheikhGeneral.classList.remove("active");
            panelSheikhActive.classList.add("active");
            panelSheikhHistory.classList.remove("active");
        });
        
        tabSheikhHistory.addEventListener("click", () => {
            tabSheikhGeneral.classList.remove("active");
            tabSheikhActive.classList.remove("active");
            tabSheikhHistory.classList.add("active");
            
            panelSheikhGeneral.classList.remove("active");
            panelSheikhActive.classList.remove("active");
            panelSheikhHistory.classList.add("active");
        });
    }

    // ------------------------------------------
    // Sheikh dedicated profile button handler
    // ------------------------------------------
    const btnSheikhProfile = document.getElementById("btn-sheikh-my-profile");
    if (btnSheikhProfile) {
        btnSheikhProfile.addEventListener("click", showLoggedSheikhProfile);
    }
}

// ==========================================
// SHEIKH PORTAL BUSINESS LOGIC
// ==========================================
async function loadSheikhPortal() {
    if (!loggedSheikhId) return;
    
    try {
        // Welcome and Stats header
        const statsRes = await fetchSecure(`${API_BASE}/sheikhs/${loggedSheikhId}/stats`);
        const stats = await statsRes.json();
        
        document.getElementById("sheikh-portal-welcome").textContent = `Welcome, Sheikh ${stats.name}`;
        document.getElementById("sh-stat-active").textContent = stats.active_orders_count;
        document.getElementById("sh-stat-plates").textContent = stats.total_historical_items;
        
        // Fetch active queue to compute total pending balance (rest)
        const activeRes = await fetchSecure(`${API_BASE}/orders?sheikh_id=${loggedSheikhId}`);
        const activeOrders = await activeRes.json();
        
        let totalRest = 0;
        activeOrders.forEach(o => totalRest += (o.rest || 0));
        document.getElementById("sh-stat-balance").textContent = `${totalRest.toFixed(2)} L.E`;
        
        // Populate specific selected subtab panel
        const isActiveTab = document.getElementById("sh-tab-active-orders").classList.contains("active");
        if (isActiveTab) {
            renderSheikhActiveOrders(activeOrders);
        } else {
            const historyRes = await fetchSecure(`${API_BASE}/orders/history?sheikh_id=${loggedSheikhId}`);
            const historyOrders = await historyRes.json();
            renderSheikhHistoryOrders(historyOrders);
        }
        
    } catch (e) {
        console.error(e);
    }
}

function renderSheikhActiveOrders(orders) {
    const body = document.getElementById("sh-orders-body");
    body.innerHTML = "";
    
    if (orders.length === 0) {
        body.innerHTML = `<tr><td colspan="7" style="text-align:center;">No active orders currently in print queues.</td></tr>`;
        return;
    }
    
    orders.forEach(o => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>#${o.id}</td>
            <td>${escapeHTML(o.contents || "-")}</td>
            <td>${(o.cost || 0).toFixed(2)} L.E</td>
            <td>${(o.paid || 0).toFixed(2)} L.E</td>
            <td class="text-danger">${(o.rest || 0).toFixed(2)} L.E</td>
            <td><span class="badge badge-${o.state.toLowerCase()}">${o.state}</span></td>
            <td>
                <button class="btn btn-secondary btn-small" onclick="showOrderDetails(${o.id})">
                    🔍 View items
                </button>
            </td>
        `;
        body.appendChild(tr);
    });
}

function renderSheikhHistoryOrders(history) {
    const body = document.getElementById("sh-history-body");
    body.innerHTML = "";
    
    if (history.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;">No historical completed orders found.</td></tr>`;
        return;
    }
    
    history.forEach(o => {
        const tr = document.createElement("tr");
        const dateStr = o.update_date ? new Date(o.update_date).toLocaleDateString() : "-";
        tr.innerHTML = `
            <td>#${o.id}</td>
            <td>${escapeHTML(o.contents || "-")}</td>
            <td>${(o.cost || 0).toFixed(2)} L.E</td>
            <td>${(o.paid || 0).toFixed(2)} L.E</td>
            <td>${dateStr}</td>
            <td><span class="badge badge-deliver">COMPLETED</span></td>
        `;
        body.appendChild(tr);
    });
}

// ==========================================
// ADMIN WORKSPACE LOADERS
// ==========================================

// Load package counter
async function loadPackageTimer() {
    try {
        const res = await fetchSecure(`${API_BASE}/package/status`);
        const data = await res.json();
        const btn = document.getElementById("package-timer-btn");
        
        btn.textContent = `${data.days_elapsed}d`;
        
        btn.className = "package-btn";
        if (data.days_elapsed < 3) {
            btn.classList.add("green");
        } else if (data.days_elapsed < 6) {
            btn.classList.add("yellow");
        } else if (data.days_elapsed < 9) {
            btn.classList.add("orange");
        } else {
            btn.classList.add("red");
        }
    } catch (e) {
        console.error(e);
    }
}

// Load Active Orders
async function loadOrders() {
    if (currentRole !== "admin") return;
    const activeTab = document.querySelector(".tab-item.active");
    const stateFilter = activeTab ? activeTab.getAttribute("data-state") : "ALL";
    
    try {
        const res = await fetchSecure(`${API_BASE}/orders?state=${stateFilter}`);
        const orders = await res.json();
        
        const body = document.getElementById("orders-list-body");
        const emptyState = document.getElementById("orders-empty");
        
        body.innerHTML = "";
        
        if (orders.length === 0) {
            emptyState.classList.remove("hidden");
            return;
        }
        emptyState.classList.add("hidden");
        
        orders.forEach(o => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>#${o.id}</td>
                <td>
                    <div style="font-weight: 600;">${escapeHTML(o.sheikh_name)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(o.sheikh_phone || "")} ${escapeHTML(o.sheikh_city || "")}</div>
                </td>
                <td>${escapeHTML(o.contents || "-")}</td>
                <td>${o.cost.toFixed(2)}</td>
                <td>${o.paid.toFixed(2)}</td>
                <td class="${o.rest > 0 ? 'text-danger' : 'text-success'}">${o.rest.toFixed(2)}</td>
                <td>${o.degree}</td>
                <td><span class="badge badge-${o.state.toLowerCase()}">${o.state}</span></td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn btn-details" onclick="showOrderDetails(${o.id})" title="Details & Certificates">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="cycleOrderState(${o.id}, '${o.state}')" title="Cycle Next State">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="openOrderFormModal(${o.id})" title="Edit Details">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="action-btn btn-delete" onclick="handleDeleteOrder(${o.id})" title="Delete Order">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            `;
            body.appendChild(tr);
        });
        
    } catch (e) {
        console.error(e);
    }
}

// State cycling machine transitions
async function cycleOrderState(id, currentState) {
    const states = ["NEXT", "DESIGN", "PRINT", "POST", "DELIVER", "DONE"];
    const curIndex = states.indexOf(currentState.toUpperCase());
    if (curIndex === -1 || curIndex === states.length - 1) return;
    
    const nextState = states[curIndex + 1];
    
    try {
        const response = await fetchSecure(`${API_BASE}/orders/${id}/state`, {
            method: "PUT",
            body: JSON.stringify({ state: nextState })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === "state_coerced_to_deliver") {
                showToast("Order transitioned to DELIVER due to outstanding payment balance.", "warning");
            } else if (data.status === "archived") {
                showToast("Order fully paid and archived to Order History!", "success");
            } else {
                showToast(`Order status cycled to ${nextState}!`, "success");
            }
            loadOrders();
        }
    } catch (e) {
        console.error(e);
    }
}

// Load Sheikh List
async function loadSheikhs() {
    if (currentRole !== "admin") return;
    const queryVal = document.getElementById("sheikhs-search-input").value.trim();
    const url = queryVal ? `${API_BASE}/sheikhs?search=${encodeURIComponent(queryVal)}` : `${API_BASE}/sheikhs`;
    
    const loadId = ++currentSheikhsLoadId;
    
    try {
        const res = await fetchSecure(url);
        const sheikhs = await res.json();
        
        // Fetch all stats in parallel
        const sheikhsWithStats = await Promise.all(sheikhs.map(async s => {
            try {
                const statsRes = await fetchSecure(`${API_BASE}/sheikhs/${s.id}/stats`);
                const stats = await statsRes.json();
                return { s, stats };
            } catch (err) {
                console.error("Error loading stats for sheikh " + s.id, err);
                return { s, stats: { total_historical_cost: 0, total_historical_items: 0, active_orders_count: 0 } };
            }
        }));
        
        // If another load has started since, discard these results
        if (loadId !== currentSheikhsLoadId) return;
        
        const body = document.getElementById("sheikhs-list-body");
        body.innerHTML = "";
        
        sheikhsWithStats.forEach(({ s, stats }) => {
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            tr.onclick = (e) => {
                // If clicked on an action button, don't open details modal
                if (e.target.closest("button") || e.target.closest("svg")) return;
                showSheikhDetailsModal(s, stats);
            };
            
            tr.innerHTML = `
                <td>#${s.id}</td>
                <td>
                    <div style="font-weight: 600;">${escapeHTML(s.name)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${s.gender ? "Male (معلم)" : "Female (معلمة)"}</div>
                </td>
                <td>${escapeHTML(s.phone || "-")}</td>
                <td>${s.gender ? "Male" : "Female"}</td>
                <td>${escapeHTML(s.city || "")} ${escapeHTML(s.country || "")}</td>
                <td>${stats.total_historical_cost.toFixed(2)} L.E</td>
                <td>${stats.total_historical_items} plates</td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn btn-details" onclick="event.stopPropagation(); openSystemSheikhFolder('${s.name}')" title="Open Local Storage Folder">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="event.stopPropagation(); openSheikhFormModal(${s.id})" title="Edit Info">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="action-btn btn-delete" onclick="event.stopPropagation(); handleDeleteSheikh(${s.id})" title="Delete Partner">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            `;
            body.appendChild(tr);
        });
        
    } catch (e) {
        console.error(e);
    }
}

// Trigger Windows Explorer folder creation and loading
async function openSystemSheikhFolder(name) {
    try {
        const res = await fetchSecure(`${API_BASE}/system/open-folder`, {
            method: "POST",
            body: JSON.stringify({ sheikh_name: name })
        });
        if (res.ok) {
            showToast(`Opened folder locally for ${name}.`, "success");
        } else {
            const err = await res.json();
            showToast(`Local open error: ${err.detail}`, "error");
        }
    } catch (e) {
        showToast("Open folder triggers are only supported when running the server on a local machine.", "warning");
    }
}

// ==========================================
// CERTIFICATE LINE ITEMS & BULK EJAZA DETAILS
// ==========================================
let activeDetailsOrderId = null;

async function showOrderDetails(orderId) {
    activeDetailsOrderId = orderId;
    
    // Default subtabs
    document.getElementById("subtab-view-items").classList.add("active");
    document.getElementById("subtab-bulk-insert").classList.remove("active");
    document.getElementById("modal-tab-items-content").classList.add("active");
    document.getElementById("modal-tab-bulk-content").classList.remove("none");
    document.getElementById("modal-tab-bulk-content").classList.add("hidden");

    try {
        const res = await fetchSecure(`${API_BASE}/orders/${orderId}`);
        const data = await res.json();
        
        document.getElementById("details-modal-title").textContent = `Order #${orderId} Overview`;
        
        // Populate profile card
        if (data.order) {
            document.getElementById("det-sheikh-name").textContent = data.order.sheikh_name || "-";
            document.getElementById("det-order-state").textContent = data.order.state;
            document.getElementById("det-order-state").className = `badge badge-${data.order.state.toLowerCase()}`;
            document.getElementById("det-order-cost").textContent = `${data.order.cost.toFixed(2)} L.E`;
            document.getElementById("det-order-paid").textContent = `${data.order.paid.toFixed(2)} L.E`;
            document.getElementById("det-order-rest").textContent = `${data.order.rest.toFixed(2)} L.E`;
        }
        
        // If sheikh details are loaded
        if (data.sheikh) {
            document.getElementById("det-sheikh-phone").textContent = data.sheikh.phone || "-";
            document.getElementById("det-sheikh-city").textContent = data.sheikh.city || "-";
            document.getElementById("det-sheikh-address").textContent = data.sheikh.address || "-";
        } else {
            // Archived fallback or sheikh-only view defaults
            document.getElementById("det-sheikh-phone").textContent = data.order.p_phone || "-";
            document.getElementById("det-sheikh-city").textContent = data.order.p_city || "-";
            document.getElementById("det-sheikh-address").textContent = data.order.p_address || "-";
        }
        
        // ==========================================
        // ROLE-BASED CONDITIONAL VIEWS FOR MODAL
        // ==========================================
        const singleFormWrapper = document.getElementById("details-add-item-form-wrapper");
        const bulkTabHeader = document.getElementById("subtab-bulk-insert");
        const itemsActionsHeader = document.getElementById("details-items-actions-header");
        
        if (currentRole === "sheikh") {
            // Hide modifications inputs & tabs
            singleFormWrapper.classList.add("hidden");
            bulkTabHeader.classList.add("hidden");
            itemsActionsHeader.classList.add("hidden");
        } else {
            // Admin permissions
            singleFormWrapper.classList.remove("hidden");
            bulkTabHeader.classList.remove("hidden");
            itemsActionsHeader.classList.remove("hidden");
        }

        // Load items list
        loadOrderContentItems(orderId);
        
        // Show modal
        document.getElementById("details-modal").classList.remove("hidden");
        
    } catch (e) {
        console.error(e);
    }
}

async function loadOrderContentItems(orderId) {
    try {
        const res = await fetchSecure(`${API_BASE}/content?order_id=${orderId}`);
        const items = await res.json();
        
        const body = document.getElementById("details-items-body");
        body.innerHTML = "";
        
        if (items.length === 0) {
            body.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No certificate lines found.</td></tr>`;
            return;
        }
        
        items.forEach(i => {
            const tr = document.createElement("tr");
            
            // Build action buttons row conditionally based on role
            let actionTd = "";
            if (currentRole === "admin") {
                actionTd = `
                    <td>
                        <button class="action-btn btn-delete btn-small" onclick="handleDeleteContent(${i.id})">
                            &times;
                        </button>
                    </td>
                `;
            }
            
            tr.innerHTML = `
                <td><span class="badge ${i.type === 'EJAZA' ? 'badge-design' : 'badge-next'}">${i.type}</span></td>
                <td>${escapeHTML(i.student_name || "-")}</td>
                <td>${escapeHTML(i.student_gender || "-")}</td>
                <td>${escapeHTML(i.qeraa || "-")}</td>
                <td>${escapeHTML(i.student_info || "-")}</td>
                ${actionTd}
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

// Add single certification row
async function handleAddSingleItem() {
    const student = document.getElementById("new-item-student").value.trim();
    const gender = document.getElementById("new-item-gender").value;
    const qeraa = document.getElementById("new-item-qeraa").value.trim();
    const info = document.getElementById("new-item-tareq").value.trim();
    
    if (!student) {
        showToast("Student name is required.", "error");
        return;
    }
    
    const payload = {
        order_id: activeDetailsOrderId,
        type: "EJAZA",
        student_name: student,
        student_gender: gender,
        student_info: info,
        qeraa: qeraa,
        amount: 1.0,
        cost: 0.0
    };
    
    try {
        const res = await fetchSecure(`${API_BASE}/content`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast("Line item added successfully!", "success");
            // Clear inputs
            document.getElementById("new-item-student").value = "";
            document.getElementById("new-item-qeraa").value = "";
            document.getElementById("new-item-tareq").value = "";
            
            loadOrderContentItems(activeDetailsOrderId);
        }
    } catch (e) {
        console.error(e);
    }
}

// Parse multi-line EJAZA list (Command55 parsing logic)
async function handleBulkParse() {
    const rawText = document.getElementById("bulk-raw-text").value.trim();
    if (!rawText) {
        showToast("Please enter text lines to parse.", "error");
        return;
    }
    
    try {
        const res = await fetchSecure(`${API_BASE}/content/bulk`, {
            method: "POST",
            body: JSON.stringify({
                order_id: activeDetailsOrderId,
                raw_text: rawText
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            showToast(`Parsed and imported ${data.inserted_count} lines!`, "success");
            document.getElementById("bulk-raw-text").value = "";
            
            // Switch tab view back to items list
            document.getElementById("subtab-view-items").click();
            loadOrderContentItems(activeDetailsOrderId);
        }
    } catch (e) {
        console.error(e);
    }
}

// Delete individual content line item
async function handleDeleteContent(id) {
    if (!confirm("Are you sure you want to delete this certificate item?")) return;
    try {
        const res = await fetchSecure(`${API_BASE}/content/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Item deleted.");
            loadOrderContentItems(activeDetailsOrderId);
        }
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// FORMS SUBMISSION & MODALS CRUD
// ==========================================

// Order Modal Forms
async function openOrderFormModal(orderId = null) {
    const sheikhDropdown = document.getElementById("order-sheikh-id");
    
    // Populates sheikh dropdown options
    try {
        const sRes = await fetchSecure(`${API_BASE}/sheikhs`);
        const sheikhs = await sRes.json();
        sheikhDropdown.innerHTML = sheikhs.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join("");
    } catch (e) {
        console.error(e);
    }
    
    if (orderId) {
        // Edit Mode
        document.getElementById("order-form-title").textContent = "Edit Order Details";
        document.getElementById("btn-save-order").textContent = "Update Order";
        
        try {
            const res = await fetchSecure(`${API_BASE}/orders/${orderId}`);
            const data = await res.json();
            const o = data.order;
            
            document.getElementById("order-form-id").value = o.id;
            document.getElementById("order-sheikh-id").value = o.sheikh_id;
            document.getElementById("order-contents").value = o.contents || "";
            document.getElementById("order-cost").value = o.cost || 0.00;
            document.getElementById("order-paid").value = o.paid || 0.00;
            document.getElementById("order-state").value = o.state;
            document.getElementById("order-degree").value = o.degree;
            document.getElementById("order-comment").value = o.comment || "";
            
        } catch (e) {
            console.error(e);
        }
    } else {
        // Create Mode
        document.getElementById("order-form-title").textContent = "New Order";
        document.getElementById("btn-save-order").textContent = "Create Order";
        document.getElementById("order-submit-form").reset();
        document.getElementById("order-form-id").value = "";
    }
    
    document.getElementById("order-form-modal").classList.remove("hidden");
}

function closeOrderFormModal() {
    document.getElementById("order-form-modal").classList.add("hidden");
}

async function handleOrderSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("order-form-id").value;
    
    const payload = {
        sheikh_id: parseInt(document.getElementById("order-sheikh-id").value, 10),
        contents: document.getElementById("order-contents").value.trim(),
        cost: parseFloat(document.getElementById("order-cost").value) || 0.0,
        paid: parseFloat(document.getElementById("order-paid").value) || 0.0,
        state: document.getElementById("order-state").value,
        degree: parseInt(document.getElementById("order-degree").value, 10) || 0,
        comment: document.getElementById("order-comment").value.trim()
    };
    
    const isEdit = !!id;
    const url = isEdit ? `${API_BASE}/orders/${id}` : `${API_BASE}/orders`;
    const method = isEdit ? "PUT" : "POST";
    
    try {
        const res = await fetchSecure(url, {
            method: method,
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            showToast(isEdit ? "Order details updated." : "New order registered!", "success");
            closeOrderFormModal();
            loadOrders();
        }
    } catch (e) {
        console.error(e);
    }
}

async function handleDeleteOrder(id) {
    if (!confirm("Are you sure you want to delete this order? All related line certificate items will be permanently erased.")) return;
    try {
        const res = await fetchSecure(`${API_BASE}/orders/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Order and certificate contents deleted.");
            loadOrders();
        }
    } catch (e) {
        console.error(e);
    }
}

// Sheikh Modal Forms
async function openSheikhFormModal(sheikhId = null) {
    if (sheikhId) {
        document.getElementById("sheikh-form-title").textContent = "Edit Sheikh Details";
        document.getElementById("btn-save-sheikh").textContent = "Update Partner Details";
        
        try {
            const res = await fetchSecure(`${API_BASE}/sheikhs/${sheikhId}`);
            const s = await res.json();
            
            document.getElementById("sheikh-form-id").value = s.id;
            document.getElementById("sheikh-name").value = s.name;
            document.getElementById("sheikh-gender").value = s.gender ? "true" : "false";
            document.getElementById("sheikh-phone").value = s.phone || "";
            document.getElementById("sheikh-receiver-name").value = s.receiver_name || "";
            document.getElementById("sheikh-country").value = s.country || "Egypt";
            document.getElementById("sheikh-city").value = s.city || "";
            document.getElementById("sheikh-address").value = s.address || "";
            document.getElementById("sheikh-info").value = s.info || "";
            document.getElementById("sheikh-comment").value = s.comment || "";
            
        } catch (e) {
            console.error(e);
        }
    } else {
        document.getElementById("sheikh-form-title").textContent = "Add New Sheikh";
        document.getElementById("btn-save-sheikh").textContent = "Create Sheikh Partner";
        document.getElementById("sheikh-submit-form").reset();
        document.getElementById("sheikh-form-id").value = "";
    }
    document.getElementById("sheikh-form-modal").classList.remove("hidden");
}

function closeSheikhFormModal() {
    document.getElementById("sheikh-form-modal").classList.add("hidden");
}

async function showSheikhDetailsModal(sheikh, stats) {
    // 1. Reset tabs to General Info active
    const tabGen = document.getElementById("sheikh-tab-general");
    if (tabGen) tabGen.click();
    
    // 2. Set basic header details
    document.getElementById("sheikh-det-name").textContent = sheikh.name;
    document.getElementById("sheikh-det-phone-city").textContent = `${sheikh.phone || "No Phone"} | ${sheikh.city || "No City"}`;
    
    // 3. Set avatar icon based on gender
    const avatarIcon = document.getElementById("sheikh-det-avatar-icon");
    if (avatarIcon) {
        avatarIcon.textContent = sheikh.gender ? "👳" : "🧕";
    }
    
    // 4. Set Call phone URL
    const callBtn = document.getElementById("sheikh-det-call-btn");
    if (callBtn) {
        if (sheikh.phone) {
            callBtn.href = `tel:${sheikh.phone}`;
            callBtn.style.display = "inline-flex";
        } else {
            callBtn.style.display = "none";
        }
    }
    
    // 5. Populate Stats Grid
    document.getElementById("sheikh-det-stat-cost").textContent = `${stats.total_historical_cost.toFixed(2)} L.E`;
    document.getElementById("sheikh-det-stat-items").textContent = `${stats.total_historical_items} plates`;
    document.getElementById("sheikh-det-stat-active").textContent = stats.active_orders_count;
    
    // 6. Populate General Info Fields
    document.getElementById("sheikh-det-receiver").textContent = sheikh.receiver_name || "-";
    document.getElementById("sheikh-det-country").textContent = sheikh.country || "-";
    document.getElementById("sheikh-det-city").textContent = sheikh.city || "-";
    document.getElementById("sheikh-det-address").textContent = sheikh.address || "-";
    document.getElementById("sheikh-det-info").textContent = sheikh.info || "No educational remarks recorded.";
    document.getElementById("sheikh-det-comment").textContent = sheikh.comment || "No internal comments.";
    
    // 7. Load Active & History Orders in parallel
    const activeBody = document.getElementById("sheikh-det-active-orders-body");
    const historyBody = document.getElementById("sheikh-det-history-orders-body");
    
    activeBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Loading active orders...</td></tr>`;
    historyBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Loading order history...</td></tr>`;
    
    // Clear badges
    document.getElementById("sheikh-det-active-badge").textContent = "0";
    document.getElementById("sheikh-det-history-badge").textContent = "0";
    
    // Show modal first so user sees it loading
    document.getElementById("sheikh-details-modal").classList.remove("hidden");
    
    try {
        const [resActive, resHistory] = await Promise.all([
            fetchSecure(`${API_BASE}/orders?sheikh_id=${sheikh.id}`),
            fetchSecure(`${API_BASE}/orders/history?sheikh_id=${sheikh.id}`)
        ]);
        
        const activeOrders = await resActive.json();
        const historyOrders = await resHistory.json();
        
        // Update tab badges
        document.getElementById("sheikh-det-active-badge").textContent = activeOrders.length;
        document.getElementById("sheikh-det-history-badge").textContent = historyOrders.length;
        
        // Render Active Orders
        activeBody.innerHTML = "";
        if (activeOrders.length === 0) {
            activeBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No active orders.</td></tr>`;
        } else {
            activeOrders.forEach(o => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>#${o.id}</td>
                    <td>${escapeHTML(o.contents || "-")}</td>
                    <td>${o.cost.toFixed(2)}</td>
                    <td>${o.paid.toFixed(2)}</td>
                    <td class="${o.rest > 0 ? 'text-danger' : 'text-success'}">${o.rest.toFixed(2)}</td>
                    <td>${o.degree}</td>
                    <td><span class="badge badge-${o.state.toLowerCase()}">${o.state}</span></td>
                    <td>
                        <button class="action-btn btn-details" onclick="event.stopPropagation(); closeSheikhDetailsModal(); showOrderDetails(${o.id})" title="View Details">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                        </button>
                    </td>
                `;
                activeBody.appendChild(tr);
            });
        }
        
        // Render History Orders
        historyBody.innerHTML = "";
        if (historyOrders.length === 0) {
            historyBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No completed orders.</td></tr>`;
        } else {
            historyOrders.forEach(o => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>#${o.id}</td>
                    <td>${escapeHTML(o.contents || "-")}</td>
                    <td>${o.cost.toFixed(2)}</td>
                    <td>${o.paid.toFixed(2)}</td>
                    <td class="${o.rest > 0 ? 'text-danger' : 'text-success'}">${o.rest.toFixed(2)}</td>
                    <td>${o.degree}</td>
                    <td><span class="badge badge-deliver">DONE</span></td>
                    <td>
                        <button class="action-btn btn-details" onclick="event.stopPropagation(); closeSheikhDetailsModal(); showOrderDetails(${o.id})" title="View Details">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                        </button>
                    </td>
                `;
                historyBody.appendChild(tr);
            });
        }
        
    } catch (e) {
        console.error("Error loading sheikh orders inside details modal", e);
        activeBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-danger);">Failed to load active orders.</td></tr>`;
        historyBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-danger);">Failed to load order history.</td></tr>`;
    }
}

function closeSheikhDetailsModal() {
    document.getElementById("sheikh-details-modal").classList.add("hidden");
}

async function showLoggedSheikhProfile() {
    if (!loggedSheikhId) return;
    try {
        const [resSheikh, resStats] = await Promise.all([
            fetchSecure(`${API_BASE}/sheikhs/${loggedSheikhId}`),
            fetchSecure(`${API_BASE}/sheikhs/${loggedSheikhId}/stats`)
        ]);
        if (resSheikh.ok && resStats.ok) {
            const sheikh = await resSheikh.json();
            const stats = await resStats.json();
            showSheikhDetailsModal(sheikh, stats);
        } else {
            showToast("Failed to load profile details.", "error");
        }
    } catch (e) {
        console.error("Error loading profile info", e);
        showToast("Failed to load profile details.", "error");
    }
}



async function handleSheikhSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("sheikh-form-id").value;
    
    const payload = {
        name: document.getElementById("sheikh-name").value.trim(),
        gender: document.getElementById("sheikh-gender").value === "true",
        phone: document.getElementById("sheikh-phone").value.trim(),
        receiver_name: document.getElementById("sheikh-receiver-name").value.trim(),
        country: document.getElementById("sheikh-country").value.trim() || "Egypt",
        city: document.getElementById("sheikh-city").value.trim(),
        address: document.getElementById("sheikh-address").value.trim(),
        info: document.getElementById("sheikh-info").value.trim(),
        comment: document.getElementById("sheikh-comment").value.trim()
    };
    
    const isEdit = !!id;
    const url = isEdit ? `${API_BASE}/sheikhs/${id}` : `${API_BASE}/sheikhs`;
    const method = isEdit ? "PUT" : "POST";
    
    try {
        const res = await fetchSecure(url, {
            method: method,
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            showToast(isEdit ? "Sheikh details updated." : "New sheikh added successfully!", "success");
            closeSheikhFormModal();
            loadSheikhs();
        }
    } catch (e) {
        console.error(e);
    }
}

async function handleDeleteSheikh(id) {
    if (!confirm("Are you sure you want to delete this sheikh? Active orders linked to them will remain, but database constraints will be updated.")) return;
    try {
        const res = await fetchSecure(`${API_BASE}/sheikhs/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Sheikh deleted successfully.");
            loadSheikhs();
        }
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// CASHBOX INVOICE PRINT CALCULATOR
// ==========================================

// Paper size and weight unit cost values
const PAPER_COSTS = {
    a4_200: 1.5,
    a4_300: 2.0,
    a3_200: 3.0,
    a3_300: 4.0,
    landscape_200: 4.0,
    color_80: 0.9,
    gray_80: 0.45
};

function getInvoiceTotal() {
    const q_a4_200 = parseInt(document.getElementById("calc-a4-200").value) || 0;
    const q_a4_300 = parseInt(document.getElementById("calc-a4-300").value) || 0;
    const q_a3_200 = parseInt(document.getElementById("calc-a3-200").value) || 0;
    const q_a3_300 = parseInt(document.getElementById("calc-a3-300").value) || 0;
    const q_land_200 = parseInt(document.getElementById("calc-landscape-200").value) || 0;
    const q_col_80 = parseInt(document.getElementById("calc-color-80").value) || 0;
    const q_gray_80 = parseInt(document.getElementById("calc-gray-80").value) || 0;

    return (q_a4_200 * PAPER_COSTS.a4_200) +
           (q_a4_300 * PAPER_COSTS.a4_300) +
           (q_a3_200 * PAPER_COSTS.a3_200) +
           (q_a3_300 * PAPER_COSTS.a3_300) +
           (q_land_200 * PAPER_COSTS.landscape_200) +
           (q_col_80 * PAPER_COSTS.color_80) +
           (q_gray_80 * PAPER_COSTS.gray_80);
}

function recalculateInvoice() {
    const q_a4_200 = parseInt(document.getElementById("calc-a4-200").value) || 0;
    const q_a4_300 = parseInt(document.getElementById("calc-a4-300").value) || 0;
    const q_a3_200 = parseInt(document.getElementById("calc-a3-200").value) || 0;
    const q_a3_300 = parseInt(document.getElementById("calc-a3-300").value) || 0;
    const q_land_200 = parseInt(document.getElementById("calc-landscape-200").value) || 0;
    const q_col_80 = parseInt(document.getElementById("calc-color-80").value) || 0;
    const q_gray_80 = parseInt(document.getElementById("calc-gray-80").value) || 0;

    const total = getInvoiceTotal();
    
    // Formats textual invoice summary (similar to VBA details text generator)
    let text = "====================================\n";
    text += "       PRINTING INVOICE DETAILS     \n";
    text += "====================================\n";
    
    if (q_a4_200 > 0) text += `A4 200gm:   ${q_a4_200} pcs x ${PAPER_COSTS.a4_200} = ${(q_a4_200 * PAPER_COSTS.a4_200).toFixed(2)} L.E\n`;
    if (q_a4_300 > 0) text += `A4 300gm:   ${q_a4_300} pcs x ${PAPER_COSTS.a4_300} = ${(q_a4_300 * PAPER_COSTS.a4_300).toFixed(2)} L.E\n`;
    if (q_a3_200 > 0) text += `A3 200gm:   ${q_a3_200} pcs x ${PAPER_COSTS.a3_200} = ${(q_a3_200 * PAPER_COSTS.a3_200).toFixed(2)} L.E\n`;
    if (q_a3_300 > 0) text += `A3 300gm:   ${q_a3_300} pcs x ${PAPER_COSTS.a3_300} = ${(q_a3_300 * PAPER_COSTS.a3_300).toFixed(2)} L.E\n`;
    if (q_land_200 > 0) text += `Land 200gm:  ${q_land_200} pcs x ${PAPER_COSTS.landscape_200} = ${(q_land_200 * PAPER_COSTS.landscape_200).toFixed(2)} L.E\n`;
    if (q_col_80 > 0) text += `Color 80gm: ${q_col_80} pcs x ${PAPER_COSTS.color_80} = ${(q_col_80 * PAPER_COSTS.color_80).toFixed(2)} L.E\n`;
    if (q_gray_80 > 0) text += `Gray 80gm:  ${q_gray_80} pcs x ${PAPER_COSTS.gray_80} = ${(q_gray_80 * PAPER_COSTS.gray_80).toFixed(2)} L.E\n`;
    
    text += "------------------------------------\n";
    text += `TOTAL BILL AMOUNT:     ${total.toFixed(2)} L.E\n`;
    text += "====================================\n";
    
    document.getElementById("calc-result-text").value = text;
    
    // Updates active USSD phone codes with invoice total values
    const currentUSSD = document.getElementById("ussd-output").value;
    const phonePart = currentUSSD.split("*")[3] || "phone";
    updateUSSDCode(phonePart, total);
}

function updateUSSDCode(phone, amount) {
    const formattedAmount = (amount || 0).toFixed(2);
    document.getElementById("ussd-output").value = `*9*7*${phone}*${formattedAmount}#`;
}

// ==========================================
// EXPENSES SUBMISSION
// ==========================================
async function loadExpenses() {
    if (currentRole !== "admin") return;
    try {
        // Load table rows
        const res = await fetchSecure(`${API_BASE}/expenses`);
        const expenses = await res.json();
        
        const body = document.getElementById("expenses-list-body");
        body.innerHTML = expenses.map(e => {
            const dateStr = e.due_date ? new Date(e.due_date).toLocaleDateString() : "-";
            return `
                <tr>
                    <td>${escapeHTML(e.name)}</td>
                    <td><span class="badge badge-next">${e.category}</span></td>
                    <td>${e.amount.toFixed(2)} L.E</td>
                    <td>${dateStr}</td>
                    <td style="color: var(--text-muted); font-size: 0.85rem;">${escapeHTML(e.comment || "-")}</td>
                </tr>
            `;
        }).join("");
        
        // Load category aggregate sums
        const catRes = await fetchSecure(`${API_BASE}/expenses/categories`);
        const categories = await catRes.json();
        
        const catContainer = document.getElementById("category-totals-container");
        catContainer.innerHTML = categories.map(c => `
            <div class="category-summary-card">
                <span class="category-sum-val">${c.total.toFixed(2)}</span>
                <span class="category-sum-name">${c.category}</span>
            </div>
        `).join("");
        
    } catch (e) {
        console.error(e);
    }
}

async function handleExpenseSubmit(e) {
    e.preventDefault();
    
    const payload = {
        name: document.getElementById("exp-name").value.trim(),
        amount: parseFloat(document.getElementById("exp-amount").value) || 0.0,
        category: document.getElementById("exp-category").value,
        comment: document.getElementById("exp-comment").value.trim()
    };
    
    try {
        const res = await fetchSecure(`${API_BASE}/expenses`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            showToast("Expense record added.", "success");
            document.getElementById("expense-add-form").reset();
            loadExpenses();
        }
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// UTILITIES: TOASTS, ESCAPING, DEBOUNCING
// ==========================================
function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove("hidden");
    
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4000);
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function loadGallery(category) {
    const grid = document.getElementById("gallery-grid");
    if (!grid) return;
    grid.innerHTML = `<div style="text-align: center; width: 100%; color: var(--text-secondary); padding: 2rem;">Loading gallery items...</div>`;
    
    try {
        const res = await fetch(`/api/gallery/${category}`);
        if (!res.ok) {
            throw new Error("Failed to load gallery category");
        }
        const images = await res.json();
        
        grid.innerHTML = "";
        if (images.length === 0) {
            grid.innerHTML = `<div style="text-align: center; width: 100%; color: var(--text-muted); padding: 2rem;">No design previews available in this category.</div>`;
            return;
        }
        
        images.forEach(filename => {
            const card = document.createElement("div");
            card.className = "gallery-card";
            
            const cleanName = escapeHTML(filename);
            
            card.innerHTML = `
                <div class="gallery-img-wrapper">
                    <img class="gallery-img" src="/static/gallery/${category}/${filename}" alt="${cleanName}" loading="lazy">
                </div>
                <div class="gallery-card-info" title="${cleanName}">${cleanName}</div>
            `;
            
            card.addEventListener("click", () => {
                const viewerModal = document.getElementById("gallery-viewer-modal");
                const viewerImg = document.getElementById("gallery-viewer-img");
                if (viewerModal && viewerImg) {
                    viewerImg.src = `/static/gallery/${category}/${filename}`;
                    viewerModal.classList.remove("hidden");
                }
            });
            
            grid.appendChild(card);
        });
    } catch (e) {
        console.error(e);
        grid.innerHTML = `<div style="text-align: center; width: 100%; color: var(--color-danger); padding: 2rem;">Error loading gallery images.</div>`;
    }
}
