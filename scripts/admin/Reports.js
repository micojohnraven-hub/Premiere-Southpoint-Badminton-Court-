import { supabase } from "../supabase/supabaseClient.js";

let allReports = [];
let filteredReports = [];
let currentReportPage = 1;
const rowsPerPage = 5;
let activeFilter = "all";

async function loadReports() {
    const reservationReports = await loadReservationReports();
    const issueReports = await loadCourtIssueReports();

    allReports = [...reservationReports, ...issueReports]
        .sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));

    applyFilter();
}

async function loadReservationReports() {
    const { data, error } = await supabase
        .from("reservations")
        .select(`id, start_time, end_time, reservation_date, status, created_at,
            profiles(full_name, username), courts(name)`)
        .order("reservation_date", { ascending: false });

    if (error) {
        console.error("Reservation report error:", error.message);
        return [];
    }

    return (data || []).map(r => ({
        type: "usage",
        typeLabel: "Court Usage",
        court: r.courts?.name || "Unknown Court",
        details: `${r.start_time || "-"} – ${r.end_time || "-"}`,
        dateTime: formatDate(r.reservation_date),
        status: formatReservationStatus(r.status),
        person: r.profiles?.full_name || r.profiles?.username || "Unknown Player",
        sortDate: r.created_at || r.reservation_date
    }));
}

async function loadCourtIssueReports() {
    const { data: issues, error } = await supabase
        .from("court_issues")
        .select(`id, issue_type, description, status, created_at, reported_by,
            reporter_role, courts(name)`)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Issue report error:", error.message);
        return [];
    }

    const reporterIds = [...new Set((issues || []).map(i => i.reported_by).filter(Boolean))];
    let profilesMap = {};

    if (reporterIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
            .from("profiles")
            .select("id, full_name, username")
            .in("id", reporterIds);

        if (!profileError && profiles) {
            profiles.forEach(p => {
                profilesMap[p.id] = p.full_name || p.username || "Unknown User";
            });
        }
    }

    return (issues || []).map(issue => ({
        type: "issue",
        typeLabel: "Issue",
        court: issue.courts?.name || "Unknown Court",
        person: profilesMap[issue.reported_by] || "Unknown Reporter",
        details: `${formatIssueType(issue.issue_type)}: ${issue.description}`,
        dateTime: formatDateTime(issue.created_at),
        status: formatIssueStatus(issue.status),
        sortDate: issue.created_at
    }));
}

function applyFilter() {
    filteredReports = activeFilter === "all"
        ? allReports
        : allReports.filter(r => r.type === activeFilter);

    currentReportPage = 1;
    displayTable();
}

function filterReports(type) {
    activeFilter = type;
    document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
    event.target.classList.add("active");
    applyFilter();
}

function displayTable() {
    const tbody = document.getElementById("reports-body");
    if (!tbody) return;

    const start = (currentReportPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageItems = filteredReports.slice(start, end);

    document.getElementById("start-idx").innerText = filteredReports.length ? start + 1 : 0;
    document.getElementById("end-idx").innerText = Math.min(end, filteredReports.length);
    document.getElementById("total-idx").innerText = filteredReports.length;

    tbody.innerHTML = pageItems.length
        ? pageItems.map(rowHTML).join("")
        : `<tr><td colspan="6" style="text-align:center;color:#888;padding:20px;">No reports found.</td></tr>`;

    renderPagination();
}

function rowHTML(item) {
    return `<tr>
        <td><span class="type-badge ${item.type === "issue" ? "type-issue" : "type-usage"}">${item.typeLabel}</span></td>
        <td><strong>${item.court}</strong></td>
        <td>${item.person}</td>
        <td>${item.details}</td>
        <td>${item.dateTime}</td>
        <td><span class="status-badge ${getStatusClass(item.status)}">${item.status}</span></td>
    </tr>`;
}

function renderPagination() {
    const controls = document.getElementById("pagination-controls");
    if (!controls) return;

    const pageCount = Math.ceil(filteredReports.length / rowsPerPage);
    controls.innerHTML = "";

    const makeBtn = (label, disabled, onClick) => {
        const btn = document.createElement("button");
        btn.className = "page-btn";
        btn.innerHTML = label;
        btn.disabled = disabled;
        btn.onclick = onClick;
        return btn;
    };

    controls.appendChild(makeBtn("<i class='bx bx-chevron-left'></i> Prev", currentReportPage === 1, () => {
        if (currentReportPage > 1) { currentReportPage--; displayTable(); }
    }));

    const pageLabel = document.createElement("span");
    pageLabel.className = "page-indicator";
    pageLabel.innerText = pageCount ? `Page ${currentReportPage} of ${pageCount}` : "Page 0 of 0";
    controls.appendChild(pageLabel);

    controls.appendChild(makeBtn("Next <i class='bx bx-chevron-right'></i>", currentReportPage === pageCount || pageCount === 0, () => {
        if (currentReportPage < pageCount) { currentReportPage++; displayTable(); }
    }));
}

function formatReservationStatus(status) {
    const labels = {
        completed: "Done", playing: "Ongoing", confirmed: "Confirmed", pending: "Pending",
        pending_verification: "Pending Verification", queued: "Queued", no_show: "No Show", cancelled: "Cancelled"
    };
    return labels[status] || status || "-";
}

function formatIssueStatus(status) {
    const labels = { pending: "Pending", approved: "Approved", rejected: "Rejected", resolved: "Resolved" };
    return labels[status] || status || "-";
}

function formatIssueType(type) {
    const labels = { maintenance: "Maintenance", incident: "Incident" };
    return labels[type] || type || "Issue";
}

function formatDate(date) {
    if (!date) return "-";
    return new Date(date + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(dateTime) {
    if (!dateTime) return "-";
    return new Date(dateTime).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function getStatusClass(status) {
    const s = status.toLowerCase();
    if (s.includes("done") || s.includes("resolved") || s.includes("approved")) return "status-done";
    if (s.includes("ongoing") || s.includes("pending") || s.includes("queued")) return "status-ongoing";
    return "status-pending";
}

function reportSummary() {
    return {
        total: filteredReports.length,
        usage: filteredReports.filter(r => r.type === "usage").length,
        issues: filteredReports.filter(r => r.type === "issue").length,
        filterLabel: activeFilter === "all" ? "All Reports" : activeFilter === "usage" ? "Court Usage" : "Court Issues"
    };
}

function exportToCSV() {
    if (!filteredReports.length) return showAlert("No reports available to export.");

    const headers = ["Type", "Court", "Person", "Details", "Date / Time", "Status"];
    const rows = filteredReports.map(r => [r.typeLabel, r.court, r.person, r.details, r.dateTime, r.status]);
    const escapeCSV = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const csv = [headers, ...rows].map(row => row.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `Southpoint_Reports_${activeFilter}_${date}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function exportToPDF() {
    if (!window.jspdf?.jsPDF) return showAlert("PDF library is not loaded.");
    if (!filteredReports.length) return showAlert("No reports available to export.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("l", "mm", "a4");
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();

    const green = [5, 185, 5], dark = [30, 41, 59], muted = [100, 116, 139];
    const { total, usage, issues, filterLabel } = reportSummary();
    const generated = new Date().toLocaleString("en-PH");

    // Header
    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...dark);
    doc.text("Southpoint Badminton Court", 14, 16);
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...muted);
    doc.text("System Reports", 14, 22);

    doc.setFontSize(9);
    doc.text(`Report Type: ${filterLabel}`, width - 14, 16, { align: "right" });
    doc.text(`Generated: ${generated}`, width - 14, 22, { align: "right" });

    doc.setDrawColor(...green).setLineWidth(0.8);
    doc.line(14, 26, width - 14, 26);

    // Summary
    doc.setFontSize(9).setTextColor(...dark);
    doc.text(`Total Records: ${total}   |   Court Usage: ${usage}   |   Court Issues: ${issues}`, 14, 33);

    const rows = filteredReports.map(r => [r.typeLabel, r.court, r.person, r.details, r.dateTime, r.status]);

    doc.autoTable({
        startY: 38,
        head: [["TYPE", "COURT", "PERSON", "DETAILS", "DATE / TIME", "STATUS"]],
        body: rows,
        theme: "grid",
        margin: { left: 14, right: 14, bottom: 15 },
        styles: { font: "helvetica", fontSize: 8, textColor: dark, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.2 },
        headStyles: { fillColor: green, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 28 }, 1: { cellWidth: 36 }, 2: { cellWidth: 42 },
            3: { cellWidth: 92 }, 4: { cellWidth: 44 }, 5: { cellWidth: 36 }
        },
        didParseCell(data) {
            if (data.section !== "body" || data.column.index !== 5) return;
            const s = String(data.cell.raw).toLowerCase();
            if (s.includes("done") || s.includes("resolved") || s.includes("approved")) data.cell.styles.textColor = [22, 101, 52];
            else if (s.includes("pending") || s.includes("ongoing") || s.includes("queued")) data.cell.styles.textColor = [180, 83, 9];
            else if (s.includes("cancelled") || s.includes("rejected") || s.includes("no show")) data.cell.styles.textColor = [185, 28, 28];
        },
        didDrawPage() {
            doc.setDrawColor(226, 232, 240).line(14, height - 12, width - 14, height - 12);
            doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...muted);
            doc.text("Southpoint Badminton Court — System Generated Report", 14, height - 7);
            doc.text(`Page ${doc.internal.getNumberOfPages()}`, width - 14, height - 7, { align: "right" });
        }
    });

    doc.save(`Southpoint_Reports_${activeFilter}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function printFullReport() {
    if (!filteredReports.length) return showAlert("No reports available to print.");

    const { total, usage, issues, filterLabel } = reportSummary();

    const rows = filteredReports.map(r => {
        const s = String(r.status).toLowerCase();
        const statusClass = s.includes("done") || s.includes("resolved") || s.includes("approved") ? "success"
            : s.includes("pending") || s.includes("ongoing") || s.includes("queued") ? "warning"
            : s.includes("cancelled") || s.includes("rejected") || s.includes("no show") ? "danger" : "default";
        const typeClass = r.type === "issue" ? "issue" : "usage";

        return `<tr>
            <td><span class="type ${typeClass}">${escapeHTML(r.typeLabel)}</span></td>
            <td>${escapeHTML(r.court)}</td>
            <td>${escapeHTML(r.person)}</td>
            <td>${escapeHTML(r.details)}</td>
            <td>${escapeHTML(r.dateTime)}</td>
            <td><span class="status ${statusClass}">${escapeHTML(r.status)}</span></td>
        </tr>`;
    }).join("");

    const printWindow = window.open("", "_blank");
    if (!printWindow) return showAlert("Please allow pop-ups to print the report.");

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Southpoint System Reports</title>
            <style>
                @page { size: A4 landscape; margin: 12mm; }
                * { box-sizing: border-box; }
                body { margin: 0; color: #1e293b; font-family: Arial, sans-serif; font-size: 12px; }
                .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #05b905; padding-bottom: 8px; margin-bottom: 10px; }
                .brand-name { font-size: 18px; font-weight: 700; }
                .brand-subtitle { color: #64748b; font-size: 10px; }
                .report-title { text-align: right; font-size: 9px; color: #64748b; line-height: 1.6; }
                .summary { margin-bottom: 12px; font-size: 10px; color: #334155; }
                .summary b { color: #1e293b; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                th { padding: 6px; background: #05b905; color: #fff; text-align: left; font-size: 9px; }
                td { padding: 6px; border-bottom: 1px solid #e2e8f0; font-size: 10px; }
                tbody tr:nth-child(even) td { background: #f8fafc; }
                th:nth-child(1), td:nth-child(1) { width: 11%; }
                th:nth-child(2), td:nth-child(2) { width: 13%; }
                th:nth-child(3), td:nth-child(3) { width: 14%; }
                th:nth-child(4), td:nth-child(4) { width: 31%; }
                th:nth-child(5), td:nth-child(5) { width: 17%; }
                th:nth-child(6), td:nth-child(6) { width: 14%; }
                .type, .status { padding: 2px 7px; border-radius: 4px; font-size: 8px; font-weight: 700; white-space: nowrap; }
                .usage, .success { background: #ecfdf3; color: #15803d; }
                .issue, .warning { background: #fff7ed; color: #c2410c; }
                .danger { background: #fef2f2; color: #dc2626; }
                .default { background: #f1f5f9; color: #475569; }
                .footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 8px; display: flex; justify-content: space-between; }
                @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="brand-name">Southpoint Badminton Court</div>
                    <div class="brand-subtitle">System Reports</div>
                </div>
                <div class="report-title">
                    Report Type: ${escapeHTML(filterLabel)}<br>
                    Generated: ${escapeHTML(new Date().toLocaleString("en-PH"))}
                </div>
            </div>

            <div class="summary">
                <b>${total}</b> Total Records &nbsp;|&nbsp; <b>${usage}</b> Court Usage &nbsp;|&nbsp; <b>${issues}</b> Court Issues
            </div>

            <table>
                <thead>
                    <tr><th>TYPE</th><th>COURT</th><th>PERSON</th><th>DETAILS</th><th>DATE / TIME</th><th>STATUS</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>

            <div class="footer">
                <span>Southpoint Badminton Court — System Generated Report</span>
                <span>Confidential • Administrative Use</span>
            </div>
        </body>
        </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 700);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.filterReports = filterReports;
window.exportToCSV = exportToCSV;
window.exportToPDF = exportToPDF;
window.printFullReport = printFullReport;

document.addEventListener("DOMContentLoaded", loadReports);