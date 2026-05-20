// ==========================================================================
// OTOR QuranCertification Portal - Single Page Application JS Engine
// ==========================================================================

// Global SPA state
let activePage = "orders-page";
let activeOrderFilter = "ALL";
let currentOrderDetailsId = null;
let sheikhsCache = []; // Caches sheikhs list for dropdown populating

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupNavigation();
    setupDashboard();
    setupSheikhs();
    setupCashbox();
    setupExpenses();
    setupPackageTimer();
    setupModals();
    
    // Initial data load
    loadOrders();
    loadSheikhsDropdown();
    loadPackageStatus();
}

// ==========================================
// 1. Navigation & Routing
// ==========================================
function setupNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const pageId = item.getAttribute("data-page");
            
            // Toggle active sidebar items
            navItems.forEach(nav => nav.classList.remove("active"));
            item.classList.add("active");
            
            // Toggle visible page sections
            document.querySelectorAll(".page-section").forEach(sec => sec.classList.remove("active"));
            document.getElementById(pageId).classList.add("active");
            
            activePage = pageId;
            
            // Fetch fresh data for respective page
            if (pageId === "orders-page") {
                loadOrders();
            } else if (pageId === "sheikhs-page") {
                loadSheikhs();
            } else if (pageId === "expenses-page") {
                loadExpenses();
            }
        });
    });
}

// Toast utility
function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast ${type}`;
    
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 3000);
}

// ==========================================
// 2. Orders Dashboard
// ==========================================
function setupDashboard() {
    // Tabs clicking
    const tabs = document.querySelectorAll(".tab-item");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            activeOrderFilter = tab.getAttribute("data-state");
            loadOrders();
        });
    });

    // Add Order Button
    document.getElementById("btn-new-order").addEventListener("click", () => {
        openOrderFormModal();
    });

    // Handle Order form submit
    document.getElementById("order-submit-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const id = document.getElementById("order-form-id").value;
        const payload = {
            sheikh_id: parseInt(document.getElementById("order-sheikh-id").value),
            contents: document.getElementById("order-contents").value,
            cost: parseFloat(document.getElementById("order-cost").value),
            paid: parseFloat(document.getElementById("order-paid").value),
            state: document.getElementById("order-state").value,
            degree: parseFloat(document.getElementById("order-degree").value),
            comment: document.getElementById("order-comment").value
        };

        try {
            let response;
            if (id) {
                // Update
                response = await fetch(`/api/orders/${id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            } else {
                // Create
                response = await fetch("/api/orders", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            }

            if (response.ok) {
                showToast(id ? "Order updated successfully." : "Order created successfully.");
                closeModal("order-form-modal");
                loadOrders();
            } else {
                showToast("Failed to save order.", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Network error saving order.", "error");
        }
    });
}

async function loadOrders() {
    try {
        const response = await fetch(`/api/orders?state=${activeOrderFilter}`);
        const data = await response.json();
        
        const body = document.getElementById("orders-list-body");
        body.innerHTML = "";
        
        const emptyState = document.getElementById("orders-empty");
        if (data.length === 0) {
            emptyState.classList.remove("hidden");
            return;
        }
        emptyState.classList.add("hidden");
        
        data.forEach(order => {
            const tr = document.createElement("tr");
            
            // Double-click row opens Details drawer
            tr.addEventListener("dblclick", () => {
                openDetailsModal(order.id);
            });
            
            const cost = order.cost || 0;
            const paid = order.paid || 0;
            const rest = order.rest || 0;
            
            tr.innerHTML = `
                <td><strong>#${order.id}</strong></td>
                <td>
                    <div style="font-weight: 600;">${order.sheikh_name || '-'}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${order.sheikh_phone || ''} (${order.sheikh_city || ''})</div>
                </td>
                <td>${order.contents || '-'}</td>
                <td>${cost.toLocaleString()} L.E</td>
                <td>${paid.toLocaleString()} L.E</td>
                <td class="${rest > 0 ? 'text-danger' : 'text-success'}">${rest.toLocaleString()} L.E</td>
                <td>${order.degree || 0}</td>
                <td><span class="badge badge-${order.state.toLowerCase()}">${order.state}</span></td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn btn-details" title="Order Details" onclick="openDetailsModal(${order.id})">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </button>
                        <button class="action-btn" title="Edit Order" onclick="editOrder(${order.id})">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="action-btn" title="Cycle State Up" onclick="cycleOrderState(${order.id}, '${order.state}', 'up')">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        </button>
                        <button class="action-btn" title="Cycle State Down" onclick="cycleOrderState(${order.id}, '${order.state}', 'down')">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                        <button class="action-btn" title="Open Sheikh Folder" onclick="openSheikhFolder('${order.sheikh_name}')">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        </button>
                        <button class="action-btn btn-delete" title="Delete Order" onclick="deleteOrder(${order.id}, '${order.sheikh_name}')">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            
            body.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
        showToast("Error loading active orders.", "error");
    }
}

// Cycles order states up/down (VBA KeyCode state shift)
const STATE_SEQUENCE = ["NEXT", "DESIGN", "PRINT", "POST", "DELIVER", "DONE"];

async function cycleOrderState(id, currentState, direction) {
    const idx = STATE_SEQUENCE.indexOf(currentState.toUpperCase());
    if (idx === -1) return;
    
    let nextIdx = idx;
    if (direction === "up") {
        nextIdx = Math.min(STATE_SEQUENCE.length - 1, idx + 1);
    } else {
        nextIdx = Math.max(0, idx - 1);
    }
    
    if (nextIdx === idx) return; // No change
    
    const targetState = STATE_SEQUENCE[nextIdx];
    
    try {
        const response = await fetch(`/api/orders/${id}/state`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: targetState })
        });
        const result = await response.json();
        
        if (response.ok) {
            if (result.status === "state_coerced_to_deliver") {
                showToast("Cannot set state to DONE until REST payment is 0. Resetting to DELIVER.", "error");
            } else if (result.status === "archived") {
                showToast("Order completed and archived to History successfully.");
            } else {
                showToast(`Order state transitioned to ${targetState}.`);
            }
            loadOrders();
        } else {
            showToast("Failed to transition order state.", "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Network error cycling state.", "error");
    }
}

async function openSheikhFolder(name) {
    if (!name) return;
    try {
        const response = await fetch("/api/system/open-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sheikh_name: name })
        });
        const data = await response.json();
        
        if (response.ok) {
            showToast(`Opened explorer window at: ${data.path}`);
        } else {
            showToast(`Error opening folder: ${data.detail}`, "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Local explorer folder could not be opened.", "error");
    }
}

async function editOrder(id) {
    try {
        const response = await fetch(`/api/orders/${id}`);
        const data = await response.json();
        if (response.ok && !data.archived) {
            openOrderFormModal(data.order);
        } else {
            showToast("Cannot edit completed or non-existent order.", "error");
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteOrder(id, name) {
    if (confirm(`Are you sure you want to delete order #${id} for Sheikh ${name}? This will delete all its line item records.`)) {
        try {
            const response = await fetch(`/api/orders/${id}`, { method: "DELETE" });
            if (response.ok) {
                showToast("Order and associated contents deleted.");
                loadOrders();
            } else {
                showToast("Failed to delete order.", "error");
            }
        } catch (err) {
            console.error(err);
        }
    }
}

// ==========================================
// 3. Sheikh Directory
// ==========================================
function setupSheikhs() {
    // Search input
    document.getElementById("sheikhs-search-input").addEventListener("input", (e) => {
        loadSheikhs(e.target.value);
    });

    // Add sheikh btn
    document.getElementById("btn-new-sheikh").addEventListener("click", () => {
        openSheikhFormModal();
    });

    // Sheikh form submit
    document.getElementById("sheikh-submit-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const id = document.getElementById("sheikh-form-id").value;
        const payload = {
            name: document.getElementById("sheikh-name").value,
            gender: document.getElementById("sheikh-gender").value === "true",
            phone: document.getElementById("sheikh-phone").value,
            receiver_name: document.getElementById("sheikh-receiver-name").value,
            country: document.getElementById("sheikh-country").value,
            city: document.getElementById("sheikh-city").value,
            address: document.getElementById("sheikh-address").value,
            info: document.getElementById("sheikh-info").value,
            comment: document.getElementById("sheikh-comment").value
        };

        try {
            let response;
            if (id) {
                response = await fetch(`/api/sheikhs/${id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            } else {
                response = await fetch("/api/sheikhs", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            }

            if (response.ok) {
                showToast(id ? "Sheikh updated." : "Sheikh created.");
                closeModal("sheikh-form-modal");
                loadSheikhs();
                loadSheikhsDropdown();
            } else {
                showToast("Failed to save sheikh.", "error");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

async function loadSheikhsDropdown() {
    try {
        const response = await fetch("/api/sheikhs");
        const data = await response.json();
        sheikhsCache = data;
        
        const selectEl = document.getElementById("order-sheikh-id");
        selectEl.innerHTML = '<option value="">-- Choose Partner --</option>';
        data.forEach(sheikh => {
            selectEl.innerHTML += `<option value="${sheikh.id}">${sheikh.name}</option>`;
        });
    } catch (err) {
        console.error(err);
    }
}

async function loadSheikhs(search = "") {
    try {
        const response = await fetch(`/api/sheikhs?search=${search}`);
        const sheikhs = await response.json();
        
        const body = document.getElementById("sheikhs-list-body");
        body.innerHTML = "";
        
        for (const sheikh of sheikhs) {
            // Get statistics asynchronously (total cost, items count)
            const statsResp = await fetch(`/api/sheikhs/${sheikh.id}/stats`);
            const stats = await statsResp.json();
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>#${sheikh.id}</strong></td>
                <td>
                    <div style="font-weight: 600;">${sheikh.name}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${sheikh.receiver_name ? 'Receiver: ' + sheikh.receiver_name : ''}</div>
                </td>
                <td>${sheikh.phone || '-'}</td>
                <td>${sheikh.gender ? 'Male' : 'Female'}</td>
                <td>${sheikh.city || ''}, ${sheikh.country || ''}</td>
                <td>${stats.total_historical_cost.toLocaleString()} L.E</td>
                <td>${stats.total_historical_items.toLocaleString()} plates</td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn" title="Edit Sheikh" onclick="editSheikh(${sheikh.id})">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="action-btn" title="Open Sheikh Folder" onclick="openSheikhFolder('${sheikh.name}')">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        </button>
                        <button class="action-btn btn-delete" title="Delete Sheikh" onclick="deleteSheikh(${sheikh.id}, '${sheikh.name}')">
                            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            body.appendChild(tr);
        }
    } catch (err) {
        console.error(err);
    }
}

async function editSheikh(id) {
    try {
        const response = await fetch(`/api/sheikhs/${id}`);
        const sheikh = await response.json();
        if (response.ok) {
            openSheikhFormModal(sheikh);
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteSheikh(id, name) {
    if (confirm(`Are you sure you want to delete Sheikh ${name}?`)) {
        try {
            const response = await fetch(`/api/sheikhs/${id}`, { method: "DELETE" });
            if (response.ok) {
                showToast("Sheikh partner deleted.");
                loadSheikhs();
                loadSheikhsDropdown();
            } else {
                showToast("Could not delete sheikh.", "error");
            }
        } catch (err) {
            console.error(err);
        }
    }
}

// ==========================================
// 4. Cashbox & Invoice Calculator
// ==========================================
function setupCashbox() {
    const calcInputs = document.querySelectorAll(".calc-input");
    calcInputs.forEach(input => {
        input.addEventListener("input", recalculateInvoice);
    });

    document.getElementById("btn-calc-clear").addEventListener("click", () => {
        calcInputs.forEach(input => input.value = "");
        recalculateInvoice();
    });

    // Copy USSD code
    document.getElementById("btn-copy-ussd").addEventListener("click", () => {
        const ussd = document.getElementById("ussd-output").value;
        navigator.clipboard.writeText(ussd);
        showToast("USSD code copied to clipboard!");
    });

    // Quick contacts
    const phoneBtns = document.querySelectorAll(".quick-phones-grid button");
    phoneBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const phone = btn.getAttribute("data-phone");
            updateUSSDPhone(phone);
        });
    });
}

let lastCalculatedCost = 0;

function recalculateInvoice() {
    const a4_200 = parseInt(document.getElementById("calc-a4-200").value) || 0;
    const a4_300 = parseInt(document.getElementById("calc-a4-300").value) || 0;
    const a3_200 = parseInt(document.getElementById("calc-a3-200").value) || 0;
    const a3_300 = parseInt(document.getElementById("calc-a3-300").value) || 0;
    const land_200 = parseInt(document.getElementById("calc-landscape-200").value) || 0;
    const color_80 = parseInt(document.getElementById("calc-color-80").value) || 0;
    const gray_80 = parseInt(document.getElementById("calc-gray-80").value) || 0;

    let invoice = "Invoice details:\n";
    let total = 0;

    if (a4_200 > 0) {
        const sub = a4_200 * 1.5;
        invoice += `${sub} L.E --> ${a4_200} sheets --> a4 - 200 gm\n`;
        total += sub;
    }
    if (a4_300 > 0) {
        const sub = a4_300 * 2.0;
        invoice += `${sub} L.E --> ${a4_300} sheets --> a4 - 300 gm\n`;
        total += sub;
    }
    if (a3_200 > 0) {
        const sub = a3_200 * 3.0;
        invoice += `${sub} L.E --> ${a3_200} sheets --> a3 - 200 gm\n`;
        total += sub;
    }
    if (a3_300 > 0) {
        const sub = a3_300 * 4.0;
        invoice += `${sub} L.E --> ${a3_300} sheets --> a3 - 300 gm\n`;
        total += sub;
    }
    if (land_200 > 0) {
        const sub = land_200 * 4.0;
        invoice += `${sub} L.E --> ${land_200} sheets --> landscape 200 gm\n`;
        total += sub;
    }
    if (color_80 > 0) {
        const sub = color_80 * 0.9;
        invoice += `${sub} L.E --> ${color_80} sheets --> 80 gm color landscape\n`;
        total += sub;
    }
    if (gray_80 > 0) {
        const sub = gray_80 * 0.45;
        invoice += `${sub} L.E --> ${gray_80} sheets --> 80 gm grayscale landscape\n`;
        total += sub;
    }

    invoice += `\nTotal printing cost = ${total} L.E\n`;
    document.getElementById("calc-result-text").value = total > 0 ? invoice : "";

    lastCalculatedCost = total;
    updateUSSDCode();
}

function updateUSSDPhone(phone) {
    const currentUSSD = document.getElementById("ussd-output").value;
    const parts = currentUSSD.split("*");
    
    // USSD structure: *9*7*phone*amount#
    if (parts.length >= 5) {
        parts[3] = phone;
        document.getElementById("ussd-output").value = parts.join("*");
    } else {
        document.getElementById("ussd-output").value = `*9*7*${phone}*${lastCalculatedCost}#`;
    }
}

function updateUSSDCode() {
    const currentUSSD = document.getElementById("ussd-output").value;
    const parts = currentUSSD.split("*");
    
    let phone = "phone";
    if (parts.length >= 5) {
        phone = parts[3];
    }
    
    document.getElementById("ussd-output").value = `*9*7*${phone}*${lastCalculatedCost}#`;
}

// ==========================================
// 5. Expenses Ledger
// ==========================================
function setupExpenses() {
    document.getElementById("expense-add-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const payload = {
            expense: document.getElementById("exp-name").value,
            amount: parseFloat(document.getElementById("exp-amount").value),
            category: document.getElementById("exp-category").value,
            comment: document.getElementById("exp-comment").value
        };

        try {
            const response = await fetch("/api/expenses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                showToast("Expense recorded successfully.");
                document.getElementById("expense-add-form").reset();
                loadExpenses();
            } else {
                showToast("Failed to save expense.", "error");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

async function loadExpenses() {
    try {
        // Load past log
        const listResp = await fetch("/api/expenses");
        const expenses = await listResp.json();
        
        const body = document.getElementById("expenses-list-body");
        body.innerHTML = "";
        
        expenses.forEach(exp => {
            const tr = document.createElement("tr");
            const dateStr = exp.due_date ? new Date(exp.due_date).toLocaleDateString() : "-";
            tr.innerHTML = `
                <td><strong>${exp.expense}</strong></td>
                <td><span class="badge badge-next">${exp.category}</span></td>
                <td>${exp.amount.toLocaleString()} L.E</td>
                <td>${dateStr}</td>
                <td style="color:var(--text-muted); font-size: 0.85rem;">${exp.comment || '-'}</td>
            `;
            body.appendChild(tr);
        });

        // Load Category breakdown widgets
        const catResp = await fetch("/api/expenses/categories");
        const categories = await catResp.json();
        
        const grid = document.getElementById("category-totals-container");
        grid.innerHTML = "";
        
        categories.forEach(c => {
            grid.innerHTML += `
                <div class="category-summary-card">
                    <span class="category-sum-val">${c.total.toLocaleString()} L.E</span>
                    <span class="category-sum-name">${c.category}</span>
                </div>
            `;
        });
    } catch (err) {
        console.error(err);
    }
}

// ==========================================
// 6. Package Status Indicator (check_package logic)
// ==========================================
function setupPackageTimer() {
    document.getElementById("package-timer-btn").addEventListener("click", async () => {
        if (confirm("Start a new mailing package package timer now?")) {
            try {
                const response = await fetch("/api/package/start", { method: "POST" });
                if (response.ok) {
                    showToast("New package started.");
                    loadPackageStatus();
                }
            } catch (err) {
                console.error(err);
            }
        }
    });
}

async function loadPackageStatus() {
    try {
        const response = await fetch("/api/package/status");
        const data = await response.json();
        
        const btn = document.getElementById("package-timer-btn");
        const elapsed = data.days_elapsed;
        
        btn.textContent = elapsed;
        btn.className = "package-btn"; // Reset base classes
        
        // Color transition logic (VBA check_package)
        if (elapsed < 7) {
            btn.classList.add("green");
        } else if (elapsed < 14) {
            btn.classList.add("yellow");
        } else if (elapsed < 21) {
            btn.classList.add("orange");
        } else {
            btn.classList.add("red");
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================
// 7. Modals Controllers (Open/Close)
// ==========================================
function setupModals() {
    // Backdrop clicking closes modal
    document.querySelectorAll(".modal-backdrop").forEach(modal => {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                modal.classList.add("hidden");
            }
        });
    });

    // Close button clicking
    document.getElementById("btn-close-details").addEventListener("click", () => closeModal("details-modal"));
    document.getElementById("btn-close-order-form").addEventListener("click", () => closeModal("order-form-modal"));
    document.getElementById("btn-close-sheikh-form").addEventListener("click", () => closeModal("sheikh-form-modal"));
}

function openModal(id) {
    document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
}

// Order Form Modal
function openOrderFormModal(order = null) {
    const title = document.getElementById("order-form-title");
    const saveBtn = document.getElementById("btn-save-order");
    const form = document.getElementById("order-submit-form");
    
    form.reset();

    if (order) {
        title.textContent = `Edit Order #${order.id}`;
        saveBtn.textContent = "Save Changes";
        document.getElementById("order-form-id").value = order.id;
        document.getElementById("order-sheikh-id").value = order.sheikh_id || "";
        document.getElementById("order-contents").value = order.contents || "";
        document.getElementById("order-cost").value = order.cost || 0.0;
        document.getElementById("order-paid").value = order.paid || 0.0;
        document.getElementById("order-state").value = order.state || "NEXT";
        document.getElementById("order-degree").value = order.degree || 0;
        document.getElementById("order-comment").value = order.comment || "";
    } else {
        title.textContent = "New Order Partner";
        saveBtn.textContent = "Create Order";
        document.getElementById("order-form-id").value = "";
    }
    
    openModal("order-form-modal");
}

// Sheikh Form Modal
function openSheikhFormModal(sheikh = null) {
    const title = document.getElementById("sheikh-form-title");
    const saveBtn = document.getElementById("btn-save-sheikh");
    const form = document.getElementById("sheikh-submit-form");
    
    form.reset();

    if (sheikh) {
        title.textContent = `Edit Sheikh #${sheikh.id}`;
        saveBtn.textContent = "Save Changes";
        document.getElementById("sheikh-form-id").value = sheikh.id;
        document.getElementById("sheikh-name").value = sheikh.name;
        document.getElementById("sheikh-gender").value = sheikh.gender ? "true" : "false";
        document.getElementById("sheikh-phone").value = sheikh.phone || "";
        document.getElementById("sheikh-receiver-name").value = sheikh.receiver_name || "";
        document.getElementById("sheikh-country").value = sheikh.country || "Egypt";
        document.getElementById("sheikh-city").value = sheikh.city || "";
        document.getElementById("sheikh-address").value = sheikh.address || "";
        document.getElementById("sheikh-info").value = sheikh.info || "";
        document.getElementById("sheikh-comment").value = sheikh.comment || "";
    } else {
        title.textContent = "Add New Sheikh";
        saveBtn.textContent = "Create Sheikh Partner";
        document.getElementById("sheikh-form-id").value = "";
    }
    
    openModal("sheikh-form-modal");
}

// Order Details & Drawer Modal
async function openDetailsModal(orderId) {
    currentOrderDetailsId = orderId;
    
    try {
        const response = await fetch(`/api/orders/${orderId}`);
        const data = await response.json();
        
        if (!response.ok) {
            showToast("Failed to fetch order details.", "error");
            return;
        }

        const isArchived = data.archived;
        const order = data.order;
        const sheikh = data.sheikh;

        // Set Header details
        document.getElementById("details-modal-title").textContent = `Order #${order.id} details`;
        document.getElementById("details-modal-subtitle").textContent = isArchived ? "Archived/Completed Historical Order" : "Active Certification Queue Order";
        
        // Populate Sheikh Block
        if (sheikh) {
            document.getElementById("det-sheikh-name").textContent = sheikh.name || "-";
            document.getElementById("det-sheikh-phone").textContent = sheikh.phone || "-";
            document.getElementById("det-sheikh-city").textContent = sheikh.city || "-";
            document.getElementById("det-sheikh-address").textContent = sheikh.address || "-";
        } else {
            // Archived order caches name on order directly
            document.getElementById("det-sheikh-name").textContent = order.sheikh_name || "-";
            document.getElementById("det-sheikh-phone").textContent = order.p_phone || "-";
            document.getElementById("det-sheikh-city").textContent = order.p_city || "-";
            document.getElementById("det-sheikh-address").textContent = order.p_address || "-";
        }

        // Populate Order details
        const stateBadge = document.getElementById("det-order-state");
        stateBadge.textContent = order.state;
        stateBadge.className = `badge badge-${order.state.toLowerCase()}`;
        
        document.getElementById("det-order-cost").textContent = `${(order.cost || 0).toLocaleString()} L.E`;
        document.getElementById("det-order-paid").textContent = `${(order.paid || 0).toLocaleString()} L.E`;
        
        const restEl = document.getElementById("det-order-rest");
        restEl.textContent = `${(order.rest || 0).toLocaleString()} L.E`;
        if (order.rest > 0) {
            restEl.className = "text-danger";
        } else {
            restEl.className = "text-success";
        }

        // Default tabs configuration
        setupDetailsTabs();
        
        // Load details items list
        loadDetailsItems();

        openModal("details-modal");
    } catch (err) {
        console.error(err);
        showToast("Error retrieving order drawer contents.", "error");
    }
}

function setupDetailsTabs() {
    const tabItemsBtn = document.getElementById("subtab-view-items");
    const tabBulkBtn = document.getElementById("subtab-bulk-insert");
    
    const panelItems = document.getElementById("modal-tab-items-content");
    const panelBulk = document.getElementById("modal-tab-bulk-content");

    // Clear state
    tabItemsBtn.classList.add("active");
    tabBulkBtn.classList.remove("active");
    panelItems.classList.add("active");
    panelBulk.classList.remove("active");

    // Clicking
    tabItemsBtn.onclick = () => {
        tabItemsBtn.classList.add("active");
        tabBulkBtn.classList.remove("active");
        panelItems.classList.add("active");
        panelBulk.classList.remove("active");
    };

    tabBulkBtn.onclick = () => {
        tabBulkBtn.classList.add("active");
        tabItemsBtn.classList.remove("active");
        panelBulk.classList.add("active");
        panelItems.classList.remove("active");
    };

    // Sub add item event listener setup
    document.getElementById("btn-add-item").onclick = async () => {
        const student = document.getElementById("new-item-student").value;
        const gender = document.getElementById("new-item-gender").value;
        const qeraa = document.getElementById("new-item-qeraa").value;
        const tareq = document.getElementById("new-item-qeraa").value;

        if (!student) {
            showToast("Student Name is required.", "error");
            return;
        }

        const payload = {
            order_id: currentOrderDetailsId,
            type: "EJAZA",
            student_name: student,
            student_gender: gender,
            qeraa: qeraa,
            tareq: tareq,
            amount: 1.0,
            cost: 0.0
        };

        try {
            const resp = await fetch("/api/content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (resp.ok) {
                showToast("Line item added successfully.");
                document.getElementById("new-item-student").value = "";
                document.getElementById("new-item-qeraa").value = "";
                document.getElementById("new-item-tareq").value = "";
                loadDetailsItems();
            } else {
                showToast("Failed to add line item.", "error");
            }
        } catch (err) {
            console.error(err);
        }
    };

    // Sub bulk items parse and submit
    document.getElementById("btn-submit-bulk").onclick = async () => {
        const rawText = document.getElementById("bulk-raw-text").value;
        if (!rawText.trim()) {
            showToast("Raw text list is empty.", "error");
            return;
        }

        try {
            const resp = await fetch("/api/content/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    order_id: currentOrderDetailsId,
                    raw_text: rawText
                })
            });
            const data = await resp.json();
            
            if (resp.ok) {
                showToast(`Parsed and imported ${data.inserted_count} lines successfully.`);
                document.getElementById("bulk-raw-text").value = "";
                // Toggle back to list tab
                tabItemsBtn.click();
                loadDetailsItems();
            } else {
                showToast("Error parsing student rows.", "error");
            }
        } catch (err) {
            console.error(err);
        }
    };
}

async function loadDetailsItems() {
    if (!currentOrderDetailsId) return;
    try {
        const response = await fetch(`/api/content?order_id=${currentOrderDetailsId}`);
        const items = await response.json();
        
        const body = document.getElementById("details-items-body");
        body.innerHTML = "";
        
        items.forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><span class="badge badge-next">${item.type}</span></td>
                <td><strong>${item.student_name || '-'}</strong></td>
                <td>${item.student_gender || '-'}</td>
                <td>${item.qeraa || '-'}</td>
                <td>${item.tareq || '-'}</td>
                <td>
                    <button class="action-btn btn-delete" title="Remove Item" onclick="deleteContentItem(${item.id})">
                        <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            `;
            body.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
    }
}

async function deleteContentItem(id) {
    if (confirm("Delete this content line item?")) {
        try {
            const response = await fetch(`/api/content/${id}`, { method: "DELETE" });
            if (response.ok) {
                showToast("Content item deleted.");
                loadDetailsItems();
            } else {
                showToast("Could not delete item.", "error");
            }
        } catch (err) {
            console.error(err);
        }
    }
}

// Window references for onclick handlers
window.openDetailsModal = openDetailsModal;
window.editOrder = editOrder;
window.deleteOrder = deleteOrder;
window.cycleOrderState = cycleOrderState;
window.openSheikhFolder = openSheikhFolder;
window.editSheikh = editSheikh;
window.deleteSheikh = deleteSheikh;
window.deleteContentItem = deleteContentItem;
