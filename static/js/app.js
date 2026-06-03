/* ==========================================================================
   OTOR Single Page Application Frontend Script
   Supporting Role-Based Access Control (Admin & Sheikh Portals)
   ========================================================================== */

const API_BASE = "/api";

// Safe wrapper for localStorage to handle third-party cookie/storage blockages inside iframes (e.g. Hugging Face Spaces)
const safeStorage = {
    _mem: {},
    getItem(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn("Storage item fetch failed for key: " + key, e);
            return this._mem[key] || null;
        }
    },
    setItem(key, val) {
        try {
            localStorage.setItem(key, val);
        } catch (e) {
            console.warn("Storage item save failed for key: " + key, e);
            this._mem[key] = val;
        }
    },
    removeItem(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn("Storage item remove failed for key: " + key, e);
            delete this._mem[key];
        }
    }
};

// State management
let currentRole = null;
let sessionToken = null;
let loggedSheikhId = null;
let currentSheikhsLoadId = 0;
let localeData = null;
let currentLang = safeStorage.getItem("otor_lang") || "en";

// ==========================================
// Session Handling Functions
// ==========================================
function getSession() {
    sessionToken = safeStorage.getItem("otor_token");
    currentRole = safeStorage.getItem("otor_role");
    const sheikhIdRaw = safeStorage.getItem("otor_sheikh_id");
    loggedSheikhId = sheikhIdRaw ? parseInt(sheikhIdRaw, 10) : null;
    return !!sessionToken || currentRole === "guest";
}

function saveSession(token, role, name, sheikhId) {
    safeStorage.setItem("otor_token", token);
    safeStorage.setItem("otor_role", role);
    safeStorage.setItem("otor_name", name);
    if (sheikhId) {
        safeStorage.setItem("otor_sheikh_id", sheikhId);
    } else {
        safeStorage.removeItem("otor_sheikh_id");
    }
    sessionToken = token;
    currentRole = role;
    loggedSheikhId = sheikhId;
}

function clearSession() {
    safeStorage.removeItem("otor_token");
    safeStorage.removeItem("otor_role");
    safeStorage.removeItem("otor_name");
    safeStorage.removeItem("otor_sheikh_id");
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
        showToast(translate("toast_session_expired", "Session expired or unauthorized."), "error");
        handleLogout();
        throw new Error("Unauthorized");
    }
    return response;
}

// ==========================================
// Application Startup & Event Listeners
// ==========================================
// ==========================================
// Localization / Multi-Language Support
// ==========================================
async function initLocalization() {
    try {
        const res = await fetch("/static/localization.json");
        localeData = await res.json();
    } catch (err) {
        console.error("Failed to load localization data", err);
    }
    await applyLanguage(currentLang);
}

async function applyLanguage(lang) {
    currentLang = lang;
    safeStorage.setItem("otor_lang", lang);
    
    document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", lang);
    
    const toggleText = document.getElementById("lang-toggle-text");
    if (toggleText) {
        toggleText.textContent = lang === "en" ? "العربية" : "English";
    }
    
    // Translate static elements with data-i18n
    document.querySelectorAll("[data-i18n]").forEach(elem => {
        const key = elem.getAttribute("data-i18n");
        const translation = translate(key, null);
        if (translation !== null) {
            elem.textContent = translation;
        }
    });
    
    // Translate inputs/textareas placeholders with data-i18n-placeholder
    document.querySelectorAll("[data-i18n-placeholder]").forEach(elem => {
        const key = elem.getAttribute("data-i18n-placeholder");
        const translation = translate(key, null);
        if (translation !== null) {
            elem.setAttribute("placeholder", translation);
        }
    });
    
    // If the session has already loaded, re-render the workspace to apply localized rows/badges
    if (sessionToken !== null || currentRole === "guest") {
        applyRoleInterface();
    }
}

function toggleLanguage() {
    const nextLang = currentLang === "en" ? "ar" : "en";
    applyLanguage(nextLang);
}

function translate(key, defaultVal, params = null) {
    if (!localeData || !localeData[currentLang] || !localeData[currentLang][key]) {
        let val = defaultVal;
        if (val === null || val === undefined) return null;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                val = val.replace(`{${k}}`, v);
            }
        }
        return val;
    }
    let val = localeData[currentLang][key];
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            val = val.replace(`{${k}}`, v);
        }
    }
    return val;
}

document.addEventListener("DOMContentLoaded", async () => {
    await initLocalization();
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
    const sanadNav = document.getElementById("sanad-nav");
    const packageBadge = document.getElementById("package-badge-container");
    
    // Default resets
    adminNav.classList.add("hidden");
    sheikhNav.classList.add("hidden");
    if (guestNav) guestNav.classList.add("hidden");
    if (sanadNav) sanadNav.classList.add("hidden");
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
    } else if (currentRole === "sanad") {
        if (sanadNav) sanadNav.classList.remove("hidden");
        
        // Show sanad explorer page
        document.getElementById("sanad-explorer-page").classList.add("active");
        const navSanadPortal = document.getElementById("nav-sanad-portal");
        if (navSanadPortal) navSanadPortal.classList.add("active");
        
        // Load Sanad Explorer data
        initSanadExplorer();
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
    showToast(translate("toast_logged_out", "Logged out successfully."));
}

function setupEventListeners() {
    // ------------------------------------------
    // Login Screen Handlers
    // ------------------------------------------
    const roleRadioAdmin = document.querySelector('input[name="login-role"][value="admin"]');
    const roleRadioSheikh = document.querySelector('input[name="login-role"][value="sheikh"]');
    const roleRadioSanad = document.querySelector('input[name="login-role"][value="sanad"]');
    const loginPasswordGroup = document.getElementById("login-password-group");
    const loginPhoneGroup = document.getElementById("login-phone-group");
    const loginForm = document.getElementById("login-form");
    
    if (roleRadioAdmin) {
        roleRadioAdmin.addEventListener("change", () => {
            loginPasswordGroup.classList.remove("hidden");
            loginPhoneGroup.classList.add("hidden");
        });
    }
    
    if (roleRadioSheikh) {
        roleRadioSheikh.addEventListener("change", () => {
            loginPasswordGroup.classList.add("hidden");
            loginPhoneGroup.classList.remove("hidden");
        });
    }

    if (roleRadioSanad) {
        roleRadioSanad.addEventListener("change", () => {
            loginPasswordGroup.classList.remove("hidden");
            loginPhoneGroup.classList.add("hidden");
        });
    }
    
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
            
            showToast(translate("toast_welcome", "Welcome, {name}!", { name: data.name }), "success");
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
            showToast(translate("toast_guest_access", "Accessed Showcase Gallery as Guest."));
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
            if (targetPage === "orders-history-page") loadHistoryOrders();
            if (targetPage === "sheikhs-page") loadSheikhs();
            if (targetPage === "expenses-page") loadExpenses();
            if (targetPage === "sheikh-portal-page") loadSheikhPortal();
            if (targetPage === "sanad-explorer-page") initSanadExplorer();
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

    const langToggle = document.getElementById("nav-lang-toggle");
    if (langToggle) {
        langToggle.addEventListener("click", (e) => {
            e.preventDefault();
            toggleLanguage();
        });
    }

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
        showToast(translate("toast_ussd_copied", "Vodafone Cash USSD Code copied to clipboard!"), "success");
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
        if (!confirm(translate("confirm_new_package", "Are you sure you want to start a new print run? This will reset the elapsed time counter."))) return;
        try {
            const res = await fetchSecure(`${API_BASE}/package/start`, { method: "POST" });
            if (res.ok) {
                showToast(translate("toast_package_init", "New package run initialized!"), "success");
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
    // Order History Search Handler
    // ------------------------------------------
    const historySearchInput = document.getElementById("history-search-input");
    if (historySearchInput) {
        historySearchInput.addEventListener("input", debounce(loadHistoryOrders, 300));
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

    // Initialize Sanad Event Listeners
    setupSanadEventListeners();
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
        
        document.getElementById("sheikh-portal-welcome").textContent = `${translate("sheikh_portal_welcome", "Welcome Sheikh")} ${stats.name}`;
        document.getElementById("sh-stat-active").textContent = stats.active_orders_count;
        document.getElementById("sh-stat-plates").textContent = stats.total_historical_items;
        
        // Fetch active queue to compute total pending balance (rest)
        const activeRes = await fetchSecure(`${API_BASE}/orders?sheikh_id=${loggedSheikhId}`);
        const activeOrders = await activeRes.json();
        
        let totalRest = 0;
        activeOrders.forEach(o => totalRest += (o.rest || 0));
        document.getElementById("sh-stat-balance").textContent = `${totalRest.toFixed(2)} ${translate("currency_le", "L.E")}`;
        
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
        body.innerHTML = `<tr><td colspan="7" style="text-align:center;">${translate("empty_orders_queue", "No active orders currently in print queues.")}</td></tr>`;
        return;
    }
    
    orders.forEach(o => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>#${o.id}</td>
            <td>${escapeHTML(o.contents || "-")}</td>
            <td>${(o.cost || 0).toFixed(2)} ${translate("currency_le", "L.E")}</td>
            <td>${(o.paid || 0).toFixed(2)} ${translate("currency_le", "L.E")}</td>
            <td class="text-danger">${(o.rest || 0).toFixed(2)} ${translate("currency_le", "L.E")}</td>
            <td><span class="badge badge-${o.state.toLowerCase()}">${translate("state_" + o.state.toLowerCase(), o.state)}</span></td>
            <td>
                <button class="btn btn-secondary btn-small" onclick="showOrderDetails(${o.id})">
                    🔍 ${translate("tooltip_view_details", "View Details")}
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
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;">${translate("empty_history_orders", "No historical completed orders found.")}</td></tr>`;
        return;
    }
    
    history.forEach(o => {
        const tr = document.createElement("tr");
        const dateStr = o.update_date ? new Date(o.update_date).toLocaleDateString() : "-";
        tr.innerHTML = `
            <td>#${o.id}</td>
            <td>${escapeHTML(o.contents || "-")}</td>
            <td>${(o.cost || 0).toFixed(2)} ${translate("currency_le", "L.E")}</td>
            <td>${(o.paid || 0).toFixed(2)} ${translate("currency_le", "L.E")}</td>
            <td>${dateStr}</td>
            <td><span class="badge badge-deliver">${translate("state_completed", "COMPLETED")}</span></td>
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
                <td><span class="badge badge-${o.state.toLowerCase()}">${translate("state_" + o.state.toLowerCase(), o.state)}</span></td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn btn-details" onclick="showOrderDetails(${o.id})" title="${translate("tooltip_details", "Details & Certificates")}">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="cycleOrderState(${o.id}, '${o.state}')" title="${translate("tooltip_cycle", "Cycle Next State")}">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="openOrderFormModal(${o.id})" title="${translate("tooltip_edit", "Edit Info")}">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="action-btn btn-delete" onclick="handleDeleteOrder(${o.id})" title="${translate("tooltip_delete", "Delete")}">
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

// Load Order History
async function loadHistoryOrders() {
    if (currentRole !== "admin") return;
    const queryVal = document.getElementById("history-search-input").value.trim();
    const url = queryVal ? `${API_BASE}/orders/history?search=${encodeURIComponent(queryVal)}` : `${API_BASE}/orders/history`;
    
    try {
        const res = await fetchSecure(url);
        const history = await res.json();
        
        const body = document.getElementById("history-list-body");
        const emptyState = document.getElementById("history-empty");
        
        body.innerHTML = "";
        
        if (history.length === 0) {
            emptyState.classList.remove("hidden");
            return;
        }
        emptyState.classList.add("hidden");
        
        history.forEach(o => {
            const tr = document.createElement("tr");
            const dateStr = o.update_date ? new Date(o.update_date).toLocaleDateString() : "-";
            tr.innerHTML = `
                <td>#${o.id}</td>
                <td>
                    <div style="font-weight: 600;">${escapeHTML(o.sheikh_name)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(o.p_phone || "")} ${escapeHTML(o.p_city || "")}</div>
                </td>
                <td>${escapeHTML(o.contents || "-")}</td>
                <td>${(o.cost || 0).toFixed(2)}</td>
                <td>${(o.paid || 0).toFixed(2)}</td>
                <td>${dateStr}</td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn btn-details" onclick="showOrderDetails(${o.id})" title="${translate("tooltip_details", "Details & Certificates")}">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
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
                showToast(translate("toast_order_deliver_pending", "Order transitioned to DELIVER due to outstanding payment balance."), "warning");
            } else if (data.status === "archived") {
                showToast(translate("toast_order_archived", "Order fully paid and archived to Order History!"), "success");
            } else {
                showToast(translate("toast_order_cycled", "Order status cycled to {state}!", { state: translate("state_" + nextState.toLowerCase(), nextState) }), "success");
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
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${s.gender ? translate("gender_male_desc", "Male (معلم)") : translate("gender_female_desc", "Female (معلمة)")}</div>
                </td>
                <td>${escapeHTML(s.phone || "-")}</td>
                <td>${s.gender ? translate("gender_male", "Male") : translate("gender_female", "Female")}</td>
                <td>${escapeHTML(s.city || "")} ${escapeHTML(s.country || "")}</td>
                <td>${stats.total_historical_cost.toFixed(2)} ${translate("currency_le", "L.E")}</td>
                <td>${stats.total_historical_items} ${translate("unit_plates", "plates")}</td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn btn-details" onclick="event.stopPropagation(); openSystemSheikhFolder('${s.name}')" title="${translate("tooltip_folder", "Open Local Storage Folder")}">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="event.stopPropagation(); openSheikhFormModal(${s.id})" title="${translate("tooltip_edit", "Edit Info")}">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="action-btn btn-delete" onclick="event.stopPropagation(); handleDeleteSheikh(${s.id})" title="${translate("tooltip_delete", "Delete")}">
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
            showToast(translate("toast_folder_opened", "Opened folder locally for {name}.", { name: name }), "success");
        } else {
            const err = await res.json();
            showToast(translate("toast_folder_error", "Local open error: {error}", { error: err.detail }), "error");
        }
    } catch (e) {
        showToast(translate("toast_local_machine_only", "Open folder triggers are only supported when running the server on a local machine."), "warning");
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
    document.getElementById("modal-tab-bulk-content").classList.add("hidden");

    try {
        const res = await fetchSecure(`${API_BASE}/orders/${orderId}`);
        const data = await res.json();
        
        document.getElementById("details-modal-title").textContent = `${translate("det_title", "Order Details")} #${orderId}`;
        
        // Populate profile card
        if (data.order) {
            document.getElementById("det-sheikh-name").textContent = data.order.sheikh_name || "-";
            document.getElementById("det-order-state").textContent = translate("state_" + data.order.state.toLowerCase(), data.order.state);
            document.getElementById("det-order-state").className = `badge badge-${data.order.state.toLowerCase()}`;
            document.getElementById("det-order-cost").textContent = `${data.order.cost.toFixed(2)} ${translate("currency_le", "L.E")}`;
            document.getElementById("det-order-paid").textContent = `${data.order.paid.toFixed(2)} ${translate("currency_le", "L.E")}`;
            document.getElementById("det-order-rest").textContent = `${data.order.rest.toFixed(2)} ${translate("currency_le", "L.E")}`;
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
        
        if (currentRole === "sheikh" || data.archived) {
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
        loadOrderContentItems(orderId, !!data.archived);
        
        // Show modal
        document.getElementById("details-modal").classList.remove("hidden");
        
    } catch (e) {
        console.error(e);
    }
}

async function loadOrderContentItems(orderId, isArchived = false) {
    try {
        const res = await fetchSecure(`${API_BASE}/content?order_id=${orderId}`);
        const items = await res.json();
        
        const body = document.getElementById("details-items-body");
        body.innerHTML = "";
        
        if (items.length === 0) {
            body.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">${translate("empty_certificate_lines", "No certificate lines found.")}</td></tr>`;
            return;
        }
        
        items.forEach(i => {
            const tr = document.createElement("tr");
            
            // Build action buttons row conditionally based on role and archive status
            let actionTd = "";
            if (currentRole === "admin" && !isArchived) {
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
                <td>${i.student_gender ? (i.student_gender.toLowerCase() === 'male' ? translate("gender_male", "Male") : translate("gender_female", "Female")) : "-"}</td>
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
        showToast(translate("toast_student_name_required", "Student name is required."), "error");
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
            showToast(translate("toast_item_added", "Line item added successfully!"), "success");
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
        showToast(translate("toast_parse_empty", "Please enter text lines to parse."), "error");
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
            showToast(translate("toast_parsed_lines", "Parsed and imported {count} lines!", { count: data.inserted_count }), "success");
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
    if (!confirm(translate("confirm_delete_item", "Are you sure you want to delete this certificate item?"))) return;
    try {
        const res = await fetchSecure(`${API_BASE}/content/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast(translate("toast_item_deleted", "Item deleted."));
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
            showToast(isEdit ? translate("toast_order_updated", "Order details updated.") : translate("toast_order_registered", "New order registered!"), "success");
            closeOrderFormModal();
            loadOrders();
        }
    } catch (e) {
        console.error(e);
    }
}

async function handleDeleteOrder(id) {
    if (!confirm(translate("confirm_delete_order", "Are you sure you want to delete this order? All related line certificate items will be permanently erased."))) return;
    try {
        const res = await fetchSecure(`${API_BASE}/orders/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast(translate("toast_order_deleted", "Order and certificate contents deleted."));
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
    document.getElementById("sheikh-det-phone-city").textContent = `${sheikh.phone || translate("no_phone", "No Phone")} | ${sheikh.city || translate("no_city", "No City")}`;
    
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
    document.getElementById("sheikh-det-stat-cost").textContent = `${stats.total_historical_cost.toFixed(2)} ${translate("currency_le", "L.E")}`;
    document.getElementById("sheikh-det-stat-items").textContent = `${stats.total_historical_items} ${translate("unit_plates", "plates")}`;
    document.getElementById("sheikh-det-stat-active").textContent = stats.active_orders_count;
    
    // 6. Populate General Info Fields
    document.getElementById("sheikh-det-receiver").textContent = sheikh.receiver_name || "-";
    document.getElementById("sheikh-det-country").textContent = sheikh.country || "-";
    document.getElementById("sheikh-det-city").textContent = sheikh.city || "-";
    document.getElementById("sheikh-det-address").textContent = sheikh.address || "-";
    document.getElementById("sheikh-det-info").textContent = sheikh.info || translate("no_edu_remarks", "No educational remarks recorded.");
    document.getElementById("sheikh-det-comment").textContent = sheikh.comment || translate("no_internal_comments", "No internal comments.");
    
    // 7. Load Active & History Orders in parallel
    const activeBody = document.getElementById("sheikh-det-active-orders-body");
    const historyBody = document.getElementById("sheikh-det-history-orders-body");
    
    activeBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">${translate("loading_active_orders", "Loading active orders...")}</td></tr>`;
    historyBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">${translate("loading_order_history", "Loading order history...")}</td></tr>`;
    
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
            activeBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">${translate("empty_active_orders", "No active orders.")}</td></tr>`;
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
                    <td><span class="badge badge-${o.state.toLowerCase()}">${translate("state_" + o.state.toLowerCase(), o.state)}</span></td>
                    <td>
                        <button class="action-btn btn-details" onclick="event.stopPropagation(); closeSheikhDetailsModal(); showOrderDetails(${o.id})" title="${translate("tooltip_view_details", "View Details")}">
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
            historyBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">${translate("empty_completed_orders", "No completed orders.")}</td></tr>`;
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
                    <td><span class="badge badge-deliver">${translate("state_completed", "COMPLETED")}</span></td>
                    <td>
                        <button class="action-btn btn-details" onclick="event.stopPropagation(); closeSheikhDetailsModal(); showOrderDetails(${o.id})" title="${translate("tooltip_view_details", "View Details")}">
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
        activeBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-danger);">${translate("error_load_active_orders", "Failed to load active orders.")}</td></tr>`;
        historyBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-danger);">${translate("error_load_order_history", "Failed to load order history.")}</td></tr>`;
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
            showToast(translate("toast_profile_load_failed", "Failed to load profile details."), "error");
        }
    } catch (e) {
        console.error("Error loading profile info", e);
        showToast(translate("toast_profile_load_failed", "Failed to load profile details."), "error");
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
            showToast(isEdit ? translate("toast_sheikh_updated", "Sheikh details updated.") : translate("toast_sheikh_added", "New sheikh added successfully!"), "success");
            closeSheikhFormModal();
            loadSheikhs();
        }
    } catch (e) {
        console.error(e);
    }
}

async function handleDeleteSheikh(id) {
    if (!confirm(translate("confirm_delete_sheikh", "Are you sure you want to delete this sheikh? Active orders linked to them will remain, but database constraints will be updated."))) return;
    try {
        const res = await fetchSecure(`${API_BASE}/sheikhs/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast(translate("toast_sheikh_deleted", "Sheikh deleted successfully."));
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
                    <td><span class="badge badge-next">${translate("exp_cat_" + e.category.toLowerCase(), e.category)}</span></td>
                    <td>${e.amount.toFixed(2)} ${translate("currency_le", "L.E")}</td>
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
                <span class="category-sum-name">${translate("exp_cat_" + c.category.toLowerCase(), c.category)}</span>
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
            showToast(translate("toast_expense_added", "Expense record added."), "success");
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
    grid.innerHTML = `<div style="text-align: center; width: 100%; color: var(--text-secondary); padding: 2rem;">${translate("loading_gallery_items", "Loading gallery items...")}</div>`;
    
    try {
        const res = await fetch(`/api/gallery/${category}`);
        if (!res.ok) {
            throw new Error("Failed to load gallery category");
        }
        const images = await res.json();
        
        grid.innerHTML = "";
        if (images.length === 0) {
            grid.innerHTML = `<div style="text-align: center; width: 100%; color: var(--text-muted); padding: 2rem;">${translate("empty_gallery", "No design previews available in this category.")}</div>`;
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
    } catch (err) {
        console.error(err);
        grid.innerHTML = `<div style="text-align: center; width: 100%; color: var(--color-danger); padding: 2rem;">${translate("error_gallery", "Error loading gallery images.")}</div>`;
    }
}

// ==========================================
// SANAD EXPLORER WORKSPACE & DATA LOGIC
// ==========================================
let allNarrators = [];
let currentTreeData = null;
let currentStudentsList = [];

async function initSanadExplorer() {
    try {
        const response = await fetchSecure(`/api/sanad/narrators`);
        allNarrators = await response.json();
    } catch (e) {
        console.error("Failed to load narrators database", e);
    }
}

function setupSanadEventListeners() {
    const searchInput = document.getElementById('sheikh-search');
    const suggestionsBox = document.getElementById('suggestions');
    const idSearchInput = document.getElementById('sheikh-id-search');

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            suggestionsBox.innerHTML = '';
            
            if (query.length < 2) {
                suggestionsBox.style.display = 'none';
                return;
            }

            const matches = allNarrators.filter(n => n.name.toLowerCase().includes(query));
            
            if (matches.length === 0) {
                suggestionsBox.style.display = 'none';
                return;
            }

            matches.slice(0, 10).forEach(match => {
                const div = document.createElement('div');
                div.className = 'sanad-suggestion-item';
                div.innerHTML = `
                    <div>${escapeHTML(match.name)}</div>
                    <div class="item-meta">معرّف: ${match.id} | بلد: ${escapeHTML(match.country || '-')} | مدينة: ${escapeHTML(match.city || '-')}</div>
                `;
                div.addEventListener('click', () => {
                    searchInput.value = match.name;
                    idSearchInput.value = match.id;
                    suggestionsBox.style.display = 'none';
                    loadIsnad(match.id);
                });
                suggestionsBox.appendChild(div);
            });

            suggestionsBox.style.display = 'block';
        });

        document.addEventListener('click', (e) => {
            if (e.target !== searchInput && e.target !== suggestionsBox) {
                suggestionsBox.style.display = 'none';
            }
        });
    }

    if (idSearchInput) {
        idSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const val = parseInt(idSearchInput.value);
                if (val > 0) {
                    loadIsnad(val);
                }
            }
        });
    }

    const otherSearchInput = document.getElementById('other-sheikh-search');
    const otherSuggestionsBox = document.getElementById('other-suggestions');
    
    if (otherSearchInput) {
        otherSearchInput.addEventListener('input', () => {
            const query = otherSearchInput.value.trim().toLowerCase();
            otherSuggestionsBox.innerHTML = '';
            
            if (query.length < 2) {
                otherSuggestionsBox.style.display = 'none';
                return;
            }

            const currentId = parseInt(document.getElementById('info-id').innerText);
            const matches = allNarrators.filter(n => n.name.toLowerCase().includes(query) && n.id !== currentId);
            
            if (matches.length === 0) {
                otherSuggestionsBox.style.display = 'none';
                return;
            }

            matches.slice(0, 10).forEach(match => {
                const div = document.createElement('div');
                div.className = 'sanad-suggestion-item';
                div.innerHTML = `
                    <div>${escapeHTML(match.name)}</div>
                    <div class="item-meta">معرّف: ${match.id} | بلد: ${escapeHTML(match.country || '-')} | مدينة: ${escapeHTML(match.city || '-')}</div>
                `;
                div.addEventListener('click', () => {
                    otherSearchInput.value = match.name;
                    document.getElementById('other-sheikh-id').value = match.id;
                    otherSuggestionsBox.style.display = 'none';
                    
                    document.getElementById('selected-other-name').innerText = match.name;
                    document.getElementById('selected-other-id').innerText = match.id;
                    document.getElementById('selected-other-sheikh-preview').style.display = 'block';
                });
                otherSuggestionsBox.appendChild(div);
            });

            otherSuggestionsBox.style.display = 'block';
        });

        document.addEventListener('click', (e) => {
            if (e.target !== otherSearchInput && e.target !== otherSuggestionsBox) {
                otherSuggestionsBox.style.display = 'none';
            }
        });
    }

    window.addEventListener('click', (e) => {
        const studentsModal = document.getElementById('students-modal');
        if (e.target === studentsModal) {
            closeStudentsModal();
        }
        const addModal = document.getElementById('add-sheikh-modal');
        if (e.target === addModal) {
            closeAddSheikhModal();
        }
        const egazaModal = document.getElementById('add-egaza-modal');
        if (e.target === egazaModal) {
            closeAddEgazaModal();
        }
        const editEgazaLinkModal = document.getElementById('edit-egaza-link-modal');
        if (e.target === editEgazaLinkModal) {
            closeEditEgazaLinkModal();
        }
    });
}

async function loadIsnad(sheikhId) {
    document.getElementById('welcome-message').style.display = 'none';
    document.getElementById('loading-spinner').style.display = 'block';
    document.getElementById('tree-viewport').style.display = 'none';
    document.getElementById('path-viewport').style.display = 'none';
    const textViewport = document.getElementById('text-viewport');
    if (textViewport) textViewport.style.display = 'none';

    let activeView = 'tree';
    const btnPath = document.getElementById('btn-path');
    const btnText = document.getElementById('btn-text');
    if (btnPath && btnPath.classList.contains('active')) {
        activeView = 'path';
    } else if (btnText && btnText.classList.contains('active')) {
        activeView = 'text';
    }

    document.getElementById('view-toggle-bar').style.display = 'none';
    document.getElementById('btn-print').style.display = 'none';
    document.getElementById('btn-students').style.display = 'none';
    document.getElementById('details-card').style.display = 'none';

    try {
        const details = await (await fetchSecure(`/api/sanad/narrators/${sheikhId}`)).json();
        
        document.getElementById('details-card').style.display = 'block';
        document.getElementById('sheikh-detail-name').innerText = details.name;
        document.getElementById('info-id').innerText = details.id;
        document.getElementById('edit-name').value = details.name || '';
        document.getElementById('edit-country').value = details.country || '';
        document.getElementById('edit-city').value = details.city || '';
        
        let birthText = details.birth_date || '';
        if (birthText.includes(' ')) {
            birthText = birthText.split(' ')[0];
        }
        if (birthText === 'N/A' || birthText === 'None') {
            birthText = '';
        }
        document.getElementById('edit-birth').value = birthText;
        document.getElementById('edit-details').value = details.info || '';
        document.getElementById('edit-notes').value = details.notes || '';

        currentTreeData = await (await fetchSecure(`/api/sanad/isnad/${sheikhId}`)).json();

        const treeRootDiv = document.getElementById('isnad-tree-root');
        treeRootDiv.innerHTML = '';
        
        const ul = document.createElement('ul');
        ul.appendChild(renderTreeNodeHTML(currentTreeData, null, 0));
        treeRootDiv.appendChild(ul);

        const pathViewport = document.getElementById('path-viewport');
        pathViewport.innerHTML = '';
        renderPathListHTML(currentTreeData, pathViewport);

        document.getElementById('loading-spinner').style.display = 'none';
        document.getElementById('view-toggle-bar').style.display = 'flex';
        document.getElementById('btn-print').style.display = 'flex';
        document.getElementById('btn-students').style.display = 'flex';
        switchView(activeView);
    } catch (e) {
        document.getElementById('loading-spinner').style.display = 'none';
        alert("خطأ: لم يتم العثور على الشيخ أو حدث خطأ أثناء الاتصال بالخادم.");
        console.error(e);
    }
}

function renderTreeNodeHTML(node, parentId = null, depth = 0) {
    const li = document.createElement('li');
    
    if (parentId && node.link_id) {
        const lineConnector = document.createElement('div');
        lineConnector.className = 'sanad-tree-line-connector';
        lineConnector.title = "انقر مزدوجاً لتعديل أو حذف هذه الإجازة";
        lineConnector.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            openEditEgazaLinkModal(node.link_id, parentId, node.id, node.name, node.qeraa || '', node.tareq || '');
        });
        li.appendChild(lineConnector);
    }
    
    const nodeDiv = document.createElement('div');
    let levelClass = 'level-3';
    if (depth === 0) levelClass = 'level-0';
    else if (depth === 1) levelClass = 'level-1';
    else if (depth === 2) levelClass = 'level-2';
    nodeDiv.className = `sanad-tree-node ${levelClass}`;
    
    let metaHtml = '';
    if (node.qeraa || node.tareq) {
        metaHtml = `<div class="node-meta">${escapeHTML(node.qeraa || '')} ${node.tareq ? ' - ' + escapeHTML(node.tareq) : ''}</div>`;
    }
    
    let countLabel = '';
    if (node.teachers && node.teachers.length > 0) {
        countLabel = ` <span class="toggle-btn" style="color: var(--sanad-accent-gold); font-size: 0.8em; margin-right: 5px; font-weight: bold; cursor: pointer;">[+] (${node.teachers.length})</span>`;
    }

    nodeDiv.innerHTML = `
        <div>${escapeHTML(node.name)}${countLabel}</div>
        ${metaHtml}
    `;
    
    li.appendChild(nodeDiv);

    if (node.teachers && node.teachers.length > 0) {
        const ul = document.createElement('ul');
        const isCollapsed = (depth >= 2);
        if (isCollapsed) {
            ul.style.display = 'none';
        } else {
            const btn = nodeDiv.querySelector('.toggle-btn');
            if (btn) btn.innerText = ` [-] (${node.teachers.length})`;
        }

        node.teachers.forEach(teacher => {
            ul.appendChild(renderTreeNodeHTML(teacher, node.id, depth + 1));
        });
        li.appendChild(ul);
        
        const toggleBtn = nodeDiv.querySelector('.toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (ul.style.display === 'none') {
                    ul.style.display = 'flex';
                    toggleBtn.innerText = ` [-] (${node.teachers.length})`;
                } else {
                    ul.style.display = 'none';
                    toggleBtn.innerText = ` [+] (${node.teachers.length})`;
                }
            });
        }
    }

    nodeDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-btn')) return;
        loadIsnad(node.id);
    });

    return li;
}

function renderPathListHTML(node, container, index = 1) {
    const div = document.createElement('div');
    div.className = 'sanad-path-step';
    
    let metaText = 'نقطة الانطلاق (أصل السند)';
    if (node.qeraa || node.tareq) {
        metaText = `الرواية: ${escapeHTML(node.qeraa || '-')} | الطريق: ${escapeHTML(node.tareq || '-')}`;
    }

    div.innerHTML = `
        <div class="sanad-step-num">${index}</div>
        <div class="sanad-step-details">
            <div class="sanad-step-name">${escapeHTML(node.name)}</div>
            <div class="sanad-step-meta">${metaText} (معرّف ID: ${node.id})</div>
        </div>
    `;
    
    div.addEventListener('click', () => loadIsnad(node.id));
    container.appendChild(div);

    if (node.teachers && node.teachers.length > 0) {
        if (node.teachers.length > 1) {
            const notice = document.createElement('div');
            notice.style.cssText = 'color: var(--sanad-accent-gold); font-size: 0.85rem; padding-right: 50px; font-weight: bold; font-family: "Amiri"';
            notice.innerText = `[تفرع السند: يتبع هذا المستوى ${node.teachers.length} شيوخ مختلفين. تم إظهار المسار الأول بالأسفل. شاهد عرض "شجرة السند" لرؤية التفرعات بالكامل]`;
            container.appendChild(notice);
        }
        renderPathListHTML(node.teachers[0], container, index + 1);
    }
}

function getSheikhTitle(name, id) {
    const narrator = allNarrators.find(n => n.id === id);
    if (narrator && narrator.gender === "Female") {
        return "الشيخة / " + name;
    }
    if (name && (name.startsWith("أم ") || name.startsWith("ام ") || name.startsWith("فاطمة") || name.startsWith("عائشة") || name.startsWith("خديجة"))) {
        return "الشيخة / " + name;
    }
    return "الشيخ / " + name;
}

function generateIsnadText(node, visited = new Set()) {
    if (!node || visited.has(node.id)) return "";
    visited.add(node.id);
    
    let text = "";
    if (node.teachers && node.teachers.length > 0) {
        const title = getSheikhTitle(node.name, node.id);
        text += `<p style="margin-bottom: 8px;">تلقى <strong>${escapeHTML(title)}</strong> عن كل من:</p>`;
        text += `<ol style="margin-right: 25px; margin-bottom: 20px; list-style-type: decimal; padding-right: 15px;">`;
        node.teachers.forEach((teacher) => {
            const tTitle = getSheikhTitle(teacher.name, teacher.id);
            let meta = "";
            if (teacher.qeraa || teacher.tareq) {
                meta = ` <span style="color: var(--sanad-text-muted); font-size: 0.85em; font-family: 'Inter', sans-serif;">(بقراءة: ${escapeHTML(teacher.qeraa || '-')}${teacher.tareq ? ' من طريق ' + escapeHTML(teacher.tareq) : ''})</span>`;
            }
            text += `<li style="margin-bottom: 4px; font-weight: bold;">${escapeHTML(tTitle)}${meta}</li>`;
        });
        text += `</ol>`;
        
        node.teachers.forEach((teacher) => {
            text += generateIsnadText(teacher, visited);
        });
    }
    return text;
}

function switchView(viewType) {
    const btnTree = document.getElementById('btn-tree');
    const btnPath = document.getElementById('btn-path');
    const btnText = document.getElementById('btn-text');
    const treeViewport = document.getElementById('tree-viewport');
    const pathViewport = document.getElementById('path-viewport');
    const textViewport = document.getElementById('text-viewport');

    btnTree.className = 'sanad-view-btn';
    btnPath.className = 'sanad-view-btn';
    if (btnText) btnText.className = 'sanad-view-btn';
    
    treeViewport.style.display = 'none';
    pathViewport.style.display = 'none';
    if (textViewport) textViewport.style.display = 'none';

    if (viewType === 'tree') {
        btnTree.className = 'sanad-view-btn active';
        treeViewport.style.display = 'flex';
    } else if (viewType === 'path') {
        btnPath.className = 'sanad-view-btn active';
        pathViewport.style.display = 'flex';
    } else if (viewType === 'text') {
        if (btnText) btnText.className = 'sanad-view-btn active';
        if (textViewport) {
            textViewport.style.display = 'block';
            textViewport.innerHTML = generateIsnadText(currentTreeData);
            if (textViewport.innerHTML === "") {
                textViewport.innerHTML = `<div style="text-align: center; color: var(--sanad-text-muted); font-family: 'Amiri', serif; font-size: 1.2rem; padding: 40px 0;">لا يوجد شيوخ مسجلين لهذا الشيخ لعرض نص السند.</div>`;
            }
        }
    }
}

function printWorkspace() {
    let sheikhName = "عام";
    const detailNameEl = document.getElementById('sheikh-detail-name');
    if (detailNameEl && detailNameEl.innerText && detailNameEl.innerText !== 'بطاقة المعلم') {
        sheikhName = detailNameEl.innerText.trim();
    } else if (currentTreeData && currentTreeData.name) {
        sheikhName = currentTreeData.name.trim();
    }
    
    const originalTitle = document.title;
    document.title = `شجرة سند - ${sheikhName}`;
    window.print();
    document.title = originalTitle;
}

async function openStudentsModal() {
    const modal = document.getElementById('students-modal');
    const searchInput = document.getElementById('students-search');
    searchInput.value = '';
    
    const sheikhName = document.getElementById('sheikh-detail-name').innerText;
    const sheikhId = document.getElementById('info-id').innerText;
    document.getElementById('modal-title').innerText = `طلاب الشيخ: ${sheikhName}`;
    
    const container = document.getElementById('students-list-container');
    container.innerHTML = '<div style="text-align: center; padding: 20px;"><div class="sanad-spinner" style="display: block; position: static; margin: 0 auto;"></div></div>';
    
    modal.style.display = 'flex';
    modal.offsetHeight; 
    modal.classList.add('show');
    
    try {
        const res = await fetchSecure(`/api/sanad/narrators/${sheikhId}/students`);
        currentStudentsList = await res.json();
        renderStudentsList(currentStudentsList);
    } catch (e) {
        container.innerHTML = '<div class="sanad-no-students-msg">حدث خطأ أثناء تحميل قائمة الطلاب.</div>';
        console.error(e);
    }
}

function closeStudentsModal() {
    const modal = document.getElementById('students-modal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

function renderStudentsList(list) {
    const container = document.getElementById('students-list-container');
    container.innerHTML = '';
    
    if (list.length === 0) {
        container.innerHTML = '<div class="sanad-no-students-msg">لا يوجد طلاب مسجلين لهذا الشيخ.</div>';
        return;
    }
    
    list.forEach(student => {
        const div = document.createElement('div');
        div.className = 'sanad-student-item';
        
        let locationInfo = [];
        if (student.country) locationInfo.push(student.country);
        if (student.city) locationInfo.push(student.city);
        const locationText = locationInfo.length > 0 ? ` | ${locationInfo.join(' - ')}` : '';
        
        let routeText = '';
        if (student.qeraa || student.tareq) {
            routeText = `<div class="sanad-student-route">${escapeHTML(student.qeraa || '')} ${student.tareq ? ' - ' + escapeHTML(student.tareq) : ''}</div>`;
        }
        
        div.innerHTML = `
            <div class="sanad-student-details">
                <div class="sanad-student-name">${escapeHTML(student.name)}</div>
                <div class="sanad-student-meta">معرف ID: ${student.id}${escapeHTML(locationText)}</div>
            </div>
            ${routeText}
        `;
        
        div.addEventListener('click', () => {
            closeStudentsModal();
            document.getElementById('sheikh-search').value = student.name;
            document.getElementById('sheikh-id-search').value = student.id;
            loadIsnad(student.id);
        });
        
        container.appendChild(div);
    });
}

function filterStudents() {
    const query = document.getElementById('students-search').value.trim().toLowerCase();
    if (!query) {
        renderStudentsList(currentStudentsList);
        return;
    }
    const filtered = currentStudentsList.filter(s => s.name.toLowerCase().includes(query) || s.id.toString().includes(query));
    renderStudentsList(filtered);
}

async function updateSheikhInfo() {
    const sheikhId = document.getElementById('info-id').innerText;
    const updatedData = {
        name: document.getElementById('edit-name').value.trim(),
        country: document.getElementById('edit-country').value.trim(),
        city: document.getElementById('edit-city').value.trim(),
        birth_date: document.getElementById('edit-birth').value.trim(),
        info: document.getElementById('edit-details').value.trim(),
        notes: document.getElementById('edit-notes').value.trim()
    };
    
    if (!updatedData.name) {
        alert("خطأ: يجب إدخال اسم الشيخ.");
        return;
    }
    
    const updateBtn = document.getElementById('btn-update-sheikh');
    const originalText = updateBtn.innerText;
    updateBtn.innerText = '⌛ جاري التحديث...';
    updateBtn.disabled = true;
    
    try {
        const res = await fetchSecure(`/api/sanad/narrators/${sheikhId}`, {
            method: 'PUT',
            body: JSON.stringify(updatedData)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to update narrator details");
        }
        
        alert("تم تحديث بيانات الشيخ بنجاح!");
        
        const narratorIndex = allNarrators.findIndex(n => n.id == sheikhId);
        if (narratorIndex !== -1) {
            allNarrators[narratorIndex].name = updatedData.name;
            allNarrators[narratorIndex].country = updatedData.country;
            allNarrators[narratorIndex].city = updatedData.city;
        }
        
        document.getElementById('sheikh-detail-name').innerText = updatedData.name;
        loadIsnad(sheikhId);
    } catch (e) {
        alert(`حدث خطأ أثناء التحديث: ${e.message}`);
        console.error(e);
    } finally {
        updateBtn.innerText = originalText;
        updateBtn.disabled = false;
    }
}

async function deleteSheikh() {
    const sheikhId = document.getElementById('info-id').innerText;
    const sheikhName = document.getElementById('sheikh-detail-name').innerText;
    
    const confirmed = confirm(`هل أنت متأكد تماماً من حذف الشيخ "${sheikhName}" (ID: ${sheikhId})؟\nسيؤدي هذا إلى حذف بياناته وجميع علاقات القراءة (الشيوخ والتلاميذ) المرتبطة به نهائياً.`);
    if (!confirmed) {
        return;
    }
    
    const deleteBtn = document.getElementById('btn-delete-sheikh');
    const originalText = deleteBtn.innerText;
    deleteBtn.innerText = '⌛ جاري الحذف...';
    deleteBtn.disabled = true;
    
    try {
        const res = await fetchSecure(`/api/sanad/narrators/${sheikhId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to delete narrator");
        }
        
        alert("تم حذف الشيخ وجميع علاقاته بنجاح!");
        
        allNarrators = allNarrators.filter(n => n.id != sheikhId);
        
        document.getElementById('sheikh-search').value = '';
        document.getElementById('sheikh-id-search').value = '';
        
        document.getElementById('details-card').style.display = 'none';
        document.getElementById('welcome-message').style.display = 'block';
        document.getElementById('tree-viewport').style.display = 'none';
        document.getElementById('path-viewport').style.display = 'none';
        document.getElementById('view-toggle-bar').style.display = 'none';
        document.getElementById('btn-print').style.display = 'none';
        document.getElementById('btn-students').style.display = 'none';
        
    } catch (e) {
        alert(`حدث خطأ أثناء الحذف: ${e.message}`);
        console.error(e);
    } finally {
        deleteBtn.innerText = originalText;
        deleteBtn.disabled = false;
    }
}

function openAddSheikhModal() {
    const modal = document.getElementById('add-sheikh-modal');
    
    document.getElementById('new-name').value = '';
    document.getElementById('new-country').value = '';
    document.getElementById('new-city').value = '';
    document.getElementById('new-birth').value = '';
    document.getElementById('new-details').value = '';
    document.getElementById('new-notes').value = '';
    
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('show');
}

function closeAddSheikhModal() {
    const modal = document.getElementById('add-sheikh-modal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

async function saveNewSheikh() {
    const name = document.getElementById('new-name').value.trim();
    const country = document.getElementById('new-country').value.trim();
    const city = document.getElementById('new-city').value.trim();
    const birth_date = document.getElementById('new-birth').value.trim();
    const info = document.getElementById('new-details').value.trim();
    const notes = document.getElementById('new-notes').value.trim();
    
    if (!name) {
        alert("خطأ: يجب إدخال اسم الشيخ.");
        return;
    }
    
    const saveBtn = document.getElementById('btn-save-new-sheikh');
    const originalText = saveBtn.innerText;
    saveBtn.innerText = '⌛ جاري الإضافة...';
    saveBtn.disabled = true;
    
    try {
        const res = await fetchSecure('/api/sanad/narrators', {
            method: 'POST',
            body: JSON.stringify({ name, country, city, birth_date, info, notes })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to create narrator");
        }
        
        const data = await res.json();
        const newId = data.id;
        
        alert("تم إضافة الشيخ بنجاح!");
        closeAddSheikhModal();
        
        const newSheikh = {
            id: newId,
            name: name,
            country: country,
            city: city,
            gender: "Male"
        };
        allNarrators.push(newSheikh);
        
        document.getElementById('sheikh-search').value = name;
        document.getElementById('sheikh-id-search').value = newId;
        loadIsnad(newId);
    } catch (e) {
        alert(`حدث خطأ أثناء الإضافة: ${e.message}`);
        console.error(e);
    } finally {
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;
    }
}

function openAddEgazaModal() {
    const modal = document.getElementById('add-egaza-modal');
    const currentName = document.getElementById('sheikh-detail-name').innerText;
    
    document.getElementById('egaza-modal-title').innerText = `إضافة إجازة جديدة للشيخ: ${currentName}`;
    
    document.getElementById('other-sheikh-search').value = '';
    document.getElementById('other-sheikh-id').value = '';
    document.getElementById('egaza-qeraa').value = '';
    document.getElementById('egaza-tareq').value = '';
    document.getElementById('selected-other-sheikh-preview').style.display = 'none';
    
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('show');
}

function closeAddEgazaModal() {
    const modal = document.getElementById('add-egaza-modal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

async function saveEgazaRelation() {
    const currentId = parseInt(document.getElementById('info-id').innerText);
    const otherId = parseInt(document.getElementById('other-sheikh-id').value);
    
    if (!otherId) {
        alert("خطأ: يرجى البحث واختيار الشيخ الآخر.");
        return;
    }
    
    const qeraa = document.getElementById('egaza-qeraa').value.trim();
    const tareq = document.getElementById('egaza-tareq').value.trim();
    
    const role = document.querySelector('input[name="egaza-role"]:checked').value;
    let teacher_id, student_id;
    if (role === 'current-is-teacher') {
        teacher_id = currentId;
        student_id = otherId;
    } else {
        teacher_id = otherId;
        student_id = currentId;
    }
    
    const saveBtn = document.getElementById('btn-save-egaza');
    const originalText = saveBtn.innerText;
    saveBtn.innerText = '⌛ جاري الإضافة...';
    saveBtn.disabled = true;
    
    try {
        const res = await fetchSecure('/api/sanad/egazas', {
            method: 'POST',
            body: JSON.stringify({ teacher_id, student_id, qeraa, tareq })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to create egaza relationship");
        }
        
        alert("تم إضافة الإجازة بنجاح!");
        closeAddEgazaModal();
        loadIsnad(currentId);
    } catch (e) {
        alert(`حدث خطأ أثناء إضافة الإجازة: ${e.message}`);
        console.error(e);
    } finally {
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;
    }
}

function openEditEgazaLinkModal(linkId, studentId, teacherId, teacherName, qeraa, tareq) {
    const modal = document.getElementById('edit-egaza-link-modal');
    
    document.getElementById('edit-link-id').value = linkId;
    document.getElementById('edit-link-student-id').value = studentId;
    document.getElementById('edit-link-teacher-id').value = teacherId;
    
    const studentNarrator = allNarrators.find(n => n.id === studentId);
    const studentName = studentNarrator ? studentNarrator.name : `غير معروف (ID: ${studentId})`;
    
    document.getElementById('edit-link-teacher-name').innerText = teacherName;
    document.getElementById('edit-link-student-name').innerText = studentName;
    
    document.getElementById('edit-link-qeraa').value = qeraa;
    document.getElementById('edit-link-tareq').value = tareq;
    
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('show');
}

function closeEditEgazaLinkModal() {
    const modal = document.getElementById('edit-egaza-link-modal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

async function saveUpdatedEgazaLink() {
    const linkId = document.getElementById('edit-link-id').value;
    const qeraa = document.getElementById('edit-link-qeraa').value.trim();
    const tareq = document.getElementById('edit-link-tareq').value.trim();
    
    const saveBtn = document.getElementById('btn-update-egaza-link');
    const originalText = saveBtn.innerText;
    saveBtn.innerText = '⌛ جاري الحفظ...';
    saveBtn.disabled = true;
    
    try {
        const res = await fetchSecure(`/api/sanad/egazas/${linkId}`, {
            method: 'PUT',
            body: JSON.stringify({ qeraa, tareq })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to update Egaza");
        }
        
        alert("تم تحديث بيانات الإجازة بنجاح!");
        closeEditEgazaLinkModal();
        
        const mainSheikhId = parseInt(document.getElementById('info-id').innerText);
        if (mainSheikhId > 0) {
            loadIsnad(mainSheikhId);
        }
    } catch (e) {
        alert(`حدث خطأ أثناء الحفظ: ${e.message}`);
        console.error(e);
    } finally {
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;
    }
}

async function deleteEgazaLink() {
    const linkId = document.getElementById('edit-link-id').value;
    const teacherName = document.getElementById('edit-link-teacher-name').innerText;
    const studentName = document.getElementById('edit-link-student-name').innerText;
    
    const confirmed = confirm(`هل أنت متأكد من حذف هذه الإجازة بين المعلم "${teacherName}" والطالب "${studentName}"؟\nسيؤدي هذا إلى قطع اتصال السند بينهما في هذا المسار.`);
    if (!confirmed) {
        return;
    }
    
    const deleteBtn = document.getElementById('btn-delete-egaza-link');
    const originalText = deleteBtn.innerText;
    deleteBtn.innerText = '⌛ جاري الحذف...';
    deleteBtn.disabled = true;
    
    try {
        const res = await fetchSecure(`/api/sanad/egazas/${linkId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to delete Egaza");
        }
        
        alert("تم حذف الإجازة وقطع مسار السند بنجاح!");
        closeEditEgazaLinkModal();
        
        const mainSheikhId = parseInt(document.getElementById('info-id').innerText);
        if (mainSheikhId > 0) {
            loadIsnad(mainSheikhId);
        }
    } catch (e) {
        alert(`حدث خطأ أثناء الحذف: ${e.message}`);
        console.error(e);
    } finally {
        deleteBtn.innerText = originalText;
        deleteBtn.disabled = false;
    }
}
