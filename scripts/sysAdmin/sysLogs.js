import { supabase } from "../supabase/supabaseClient.js";

export const saveLog = async (category, event, userInvolved, status = 'success') => {
    const { error } = await supabase
        .from('system_logs')
        .insert([{ 
            category: category.toUpperCase(),
            event: event, 
            user_involved: userInvolved, 
            status: status.toLowerCase()
        }]);
    if (error) console.error("Error saving log:", error.message);
};

document.addEventListener('DOMContentLoaded', async () => { 
    const logTableBody = document.getElementById('logTableBody');
    if (!logTableBody) return; 

    const elements = {
        logTableBody: logTableBody,
        logSearch: document.getElementById('logSearch'),
        categoryFilter: document.getElementById('categoryFilter'),
        filterBtns: document.querySelectorAll('.btn-filter[data-filter]'),
        liveToggle: document.getElementById('liveToggle'),
        clearLogsBtn: document.getElementById('clearLogs'),
        exportBtn: document.getElementById('exportBtn'), 
        totalEventsLabel: document.getElementById('totalEvents'),
        criticalErrorsLabel: document.getElementById('criticalErrors'),
        systemHealthLabel: document.getElementById('systemHealth'),

        logoutBtn: document.getElementById('logoutBtn'),
    };

    const escapeHTML = (value) => {
        const div = document.createElement("div");
        div.textContent = value ?? "";
        return div.innerHTML;
    };

    // --- TOAST NOTIFICATIONS ---
    const showAlert = (title, message, type = "success") => {
        const container = document.getElementById("notification-container");
        if (!container) return;

        const alert = document.createElement("div");
        alert.className = `toast ${type}`;

        const icons = {
            success: "bx-check-circle",
            error: "bx-error-circle",
            info: "bx-info-circle"
        };

        alert.innerHTML = `
            <i class="bx ${icons[type] || icons.success}"></i>
            <div class="toast-content">
                <span class="toast-title">${escapeHTML(title)}</span>
                <span class="toast-msg">${escapeHTML(message)}</span>
            </div>
        `;

        container.appendChild(alert);

        setTimeout(() => {
            alert.style.opacity = "0";
            setTimeout(() => alert.remove(), 400);
        }, 4000);
    };

if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        const { error } = await supabase.auth.signOut();

        if (error) {
            showAlert(
                "Logout Failed",
                error.message,
                "error"
            );
            return;
        }

        window.location.href = "../auth/login.html";
    }, true);
}

    // --- 1. EXPORT CSV ENGINE ---
    const exportToCSV = () => {
        const rows = Array.from(document.querySelectorAll('.log-row'));
        const visibleRows = rows.filter(row => row.style.display !== 'none');

        if (visibleRows.length === 0) {
            showAlert("Nothing to Export", "No logs to export with current filters.", "error");
            return;
        }

        let csvContent = "Timestamp,Category,Event,User,Status\n";

        visibleRows.forEach(row => {
            const data = Array.from(row.cells).map(cell => `"${cell.innerText.trim().replace(/\n/g, " ")}"` );
            csvContent += data.join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Southpoint_Logs_${new Date().toLocaleDateString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showAlert("Exported", "Logs have been exported to CSV.");
    };

    // --- 2. FILTERING LOGIC ---
    const applyAllFilters = () => {
        const searchValue = elements.logSearch?.value.toLowerCase() || "";
        const selectedCategory = elements.categoryFilter?.value || "all"; 
        const activeStatusBtn = document.querySelector('.btn-filter.active');
        const selectedStatus = activeStatusBtn ? activeStatusBtn.getAttribute('data-filter') : 'all';

        const rows = document.querySelectorAll('.log-row');
        rows.forEach(row => {
            const rowText = row.innerText.toLowerCase();
            const rowStatus = row.getAttribute('data-status'); 
            const catSpan = row.querySelector('.cat-label');
            const rowCategory = catSpan ? catSpan.innerText.trim() : "";
            
            const matchesSearch = rowText.includes(searchValue);
            let matchesStatus = (selectedStatus === 'all' || rowStatus === selectedStatus);
            if (selectedStatus === 'error' && (rowStatus === 'critical' || rowStatus === 'error')) matchesStatus = true;
            const matchesCategory = (selectedCategory === 'all' || rowCategory === selectedCategory);
            
            row.style.display = (matchesSearch && matchesStatus && matchesCategory) ? "" : "none";
        });
    };

    // --- 3. RENDER & STATS ---
    const renderLogRow = (log, isNew = false) => {
        const tr = document.createElement('tr');
        tr.className = `log-row ${isNew ? 'new-log' : ''}`;
        const status = (log.status || 'success').toLowerCase();
        tr.setAttribute('data-status', status);
        const time = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        tr.innerHTML = `
            <td>${escapeHTML(time)}</td>
            <td><span class="cat-label">${escapeHTML((log.category || 'SYSTEM').toUpperCase())}</span></td>
            <td class="p-name">${escapeHTML(log.event)}</td>
            <td>${escapeHTML(log.user_involved || 'System_Auto')}</td>
            <td style="text-align: center;"><span class="badge status-${status}">${escapeHTML(status.toUpperCase())}</span></td>
        `;

        if (isNew) {
            elements.logTableBody.prepend(tr);
            updateStatsLive(log);
        } else {
            elements.logTableBody.appendChild(tr);
        }
        applyAllFilters();
    };

    const updateStatsLive = (newLog) => {
        const status = (newLog.status || '').toLowerCase();

        const currentTotal =
            parseInt(elements.totalEventsLabel.innerText.replace(/,/g, '')) || 0;

        const currentErrors =
            parseInt(elements.criticalErrorsLabel.innerText) || 0;

        const isError =
            status === 'critical' || status === 'error';

        const newTotal = currentTotal + 1;
        const newErrors = isError
            ? currentErrors + 1
            : currentErrors;

        const health = newTotal > 0
            ? ((newTotal - newErrors) / newTotal) * 100
            : 100;

        elements.totalEventsLabel.innerText =
            newTotal.toLocaleString();

        elements.criticalErrorsLabel.innerText =
            newErrors.toString().padStart(2, '0');

        elements.systemHealthLabel.innerText =
            `${health.toFixed(1)}%`;
    };

    const fetchLogs = async () => {
        const { data, error } = await supabase
            .from('system_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            showAlert("Error", error.message, "error");
            return;
        }

        elements.logTableBody.innerHTML = '';

        data.forEach(log => renderLogRow(log));

        const now = new Date();
        const last24Hours =
            new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const recentLogs = data.filter(log =>
            new Date(log.created_at) >= last24Hours
        );

        const criticalLogs = recentLogs.filter(log => {
            const status = (log.status || '').toLowerCase();
            return status === 'critical' || status === 'error';
        });

        const total = recentLogs.length;
        const critical = criticalLogs.length;

        const health = total > 0
            ? ((total - critical) / total) * 100
            : 100;

        elements.totalEventsLabel.innerText =
            total.toLocaleString();

        elements.criticalErrorsLabel.innerText =
            critical.toString().padStart(2, '0');

        elements.systemHealthLabel.innerText =
            `${health.toFixed(1)}%`;
    };

    // --- 4. EVENT LISTENERS ---
    fetchLogs();

    elements.exportBtn?.addEventListener('click', exportToCSV);

    elements.logSearch?.addEventListener('keyup', applyAllFilters);
    elements.categoryFilter?.addEventListener('change', applyAllFilters);
    
    elements.filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyAllFilters();
        });
    });

    elements.clearLogsBtn?.addEventListener('click', async () => {
        const confirmed = await showConfirm(
            "Clear display logs? The database will not be affected.",
            "Clear Display",
            true
        );

        if (confirmed) {
            elements.logTableBody.innerHTML = '';
            showAlert("Cleared", "Display logs have been cleared.");
        }
    });
});