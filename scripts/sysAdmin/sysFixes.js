import { supabase } from '../supabase/supabaseClient.js';
import { saveLog } from '../sysAdmin/sysLogs.js';

document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        tableBody: document.getElementById('fixTableBody'),
        searchInput: document.getElementById('fixSearch'),
        newTicketBtn: document.getElementById('newTicketBtn'),
        openLabel: document.getElementById('openTicketsCount'),
        resolvedLabel: document.getElementById('resolvedTodayCount'),

        createModal: document.getElementById('createTicketModal'),
        closeCreate: document.getElementById('closeCreateModal'),
        cancelCreate: document.getElementById('cancelCreate'),
        confirmCreateBtn: document.getElementById('confirmCreateTicket'),
        newCourt: document.getElementById('newCourt'),
        newType: document.getElementById('newIssueType'),
        newPriority: document.getElementById('newPriority'),
        newDesc: document.getElementById('newDescription'),

        selectAll: document.getElementById('selectAll'),
        bulkMenu: document.getElementById('bulkMenu'),
        selectedCount: document.getElementById('selectedCount'),

        logoutBtn: document.getElementById('logoutBtn'),

        modalOverlay: document.getElementById('modalOverlay'),
        modalTitle: document.getElementById('modalTitle'),
        modalMessage: document.getElementById('modalMessage'),
        modalConfirm: document.getElementById('modalConfirm'),
        modalCancel: document.getElementById('modalCancel')
    };

    const chipBtns = document.querySelectorAll('.chip[data-filter]');

    const escapeHTML = (value) => {
        const div = document.createElement('div');
        div.textContent = value ?? '';
        return div.innerHTML;
    };

    const showAlert = (title, message, type = 'success') => {
        const container = document.getElementById('notification-container');
        if (!container) return;

        const icons = {
            success: 'bx-check-circle',
            error: 'bx-error-circle',
            info: 'bx-info-circle'
        };

        const alert = document.createElement('div');
        alert.className = `toast ${type}`;

        alert.innerHTML = `
            <i class="bx ${icons[type] || icons.success}"></i>
            <div class="toast-content">
                <span class="toast-title">${escapeHTML(title)}</span>
                <span class="toast-msg">${escapeHTML(message)}</span>
            </div>
        `;

        container.appendChild(alert);

        setTimeout(() => {
            alert.style.opacity = '0';

            setTimeout(() => {
                alert.remove();
            }, 400);
        }, 4000);
    };

    const showConfirm = (message, title = 'Confirm Action', danger = false) => {
        return new Promise((resolve) => {
            elements.modalTitle.textContent = title;
            elements.modalMessage.textContent = message;

            elements.modalConfirm.classList.toggle('btn-danger', danger);

            elements.modalOverlay.classList.add('active');

            const confirmHandler = () => {
                cleanup();
                elements.modalOverlay.classList.remove('active');
                resolve(true);
            };

            const cancelHandler = () => {
                cleanup();
                elements.modalOverlay.classList.remove('active');
                resolve(false);
            };

            const cleanup = () => {
                elements.modalConfirm.removeEventListener(
                    'click',
                    confirmHandler
                );

                elements.modalCancel.removeEventListener(
                    'click',
                    cancelHandler
                );
            };

            elements.modalConfirm.addEventListener(
                'click',
                confirmHandler
            );

            elements.modalCancel.addEventListener(
                'click',
                cancelHandler
            );
        });
    };

    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener(
            'click',
            async (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();

                const { error } = await supabase.auth.signOut();

                if (!error) {
                    window.location.href = '../auth/login.html';
                } else {
                    showAlert(
                        'Error',
                        `Logging out: ${error.message}`,
                        'error'
                    );
                }
            },
            true
        );
    }

    const fetchCourts = async () => {
        const { data, error } = await supabase
            .from('courts')
            .select('id, name')
            .order('name');

        if (error || !data) {
            showAlert(
                'Error',
                'Unable to load Court List.',
                'error'
            );
            return;
        }

        if (!data.length) {
            showAlert(
                'No Courts',
                'No courts found. Add a court first before creating a ticket.',
                'info'
            );
        }

        elements.newCourt.innerHTML = data
            .map(
                court =>
                    `<option value="${court.id}">
                        ${escapeHTML(court.name)}
                    </option>`
            )
            .join('');
    };

    const fetchTickets = async () => {
        const { data, error } = await supabase
            .from('court_issues')
            .select('*')
            .order('created_at', {
                ascending: false
            });

        if (error) {
            showAlert(
                'Error',
                error.message,
                'error'
            );
            return;
        }

        elements.tableBody.innerHTML = '';

        if (!data.length) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center empty-row">
                        No fix requests found.
                    </td>
                </tr>
            `;
        } else {
            data.forEach(issue => {
                renderTicketRow(issue);
            });
        }

        calculateDynamicStats(data);
        updateBulkMenu();
    };

    const calculateDynamicStats = (data) => {
        const today = new Date().toLocaleDateString(
            'en-CA',
            {
                timeZone: 'Asia/Manila'
            }
        );

        const open = data.filter(
            issue => issue.status !== 'resolved'
        ).length;

        elements.openLabel.innerText = open;

        const resolvedToday = data.filter(issue => {
            if (
                issue.status !== 'resolved' ||
                !issue.resolved_at
            ) {
                return false;
            }

            const resolvedDate = new Date(
                issue.resolved_at
            ).toLocaleDateString(
                'en-CA',
                {
                    timeZone: 'Asia/Manila'
                }
            );

            return resolvedDate === today;
        }).length;

        elements.resolvedLabel.innerText =
            `+${resolvedToday
                .toString()
                .padStart(2, '0')}`;
    };

    const renderTicketRow = (issue) => {
        const tr = document.createElement('tr');

        tr.className = 'fix-row';

        const priority = (
            issue.priority || 'low'
        ).toLowerCase();

        tr.setAttribute(
            'data-priority',
            priority
        );

        tr.setAttribute(
            'data-id',
            issue.id
        );

        const role = (
            issue.reporter_role || 'Staff'
        ).replace('_', ' ');

        const initial =
            role.charAt(0).toUpperCase();

        tr.innerHTML = `
            <td>
                <input
                    type="checkbox"
                    class="row-checkbox"
                >
            </td>

            <td>
                #FIX-${issue.id
                    .toString()
                    .padStart(3, '0')}
            </td>

            <td>
                <div class="tech-info">
                    <div class="tech-avatar">
                        ${initial}
                    </div>

                    <span class="role-label">
                        ${escapeHTML(role)}
                    </span>
                </div>
            </td>

            <td>
                <span class="cat-label">
                    ${escapeHTML(
                        (
                            issue.issue_type ||
                            'SYSTEM'
                        ).toUpperCase()
                    )}
                </span>
            </td>

            <td class="p-name">
                ${escapeHTML(
                    issue.description ||
                    'No description provided'
                )}

                <div class="progress-container">
                    <div class="progress-bar"></div>
                </div>
            </td>

            <td>
                <span class="badge priority-${priority}">
                    ${escapeHTML(priority)}
                </span>
            </td>

            <td class="text-center">
                <span class="badge status-${issue.status}">
                    ${escapeHTML(issue.status)}
                </span>
            </td>

            <td class="text-center">
                ${
                    issue.status !== 'resolved'
                        ? `
                            <button
                                class="action-btn start-fix-btn"
                                title="Start Fix"
                            >
                                <i class='bx bx-play-circle'></i>
                            </button>
                        `
                        : `
                            <i
                                class='bx bx-check-double text-success'
                                title="Resolved"
                            ></i>
                        `
                }
            </td>
        `;

        elements.tableBody.appendChild(tr);
    };

    const updateBulkMenu = () => {
        const count =
            document.querySelectorAll(
                '.row-checkbox:checked'
            ).length;

        elements.bulkMenu.style.display =
            count > 0 ? 'flex' : 'none';

        elements.selectedCount.innerText =
            `${count} Selected`;

        document
            .querySelectorAll('.fix-row')
            .forEach(row => {
                const checkbox =
                    row.querySelector(
                        '.row-checkbox'
                    );

                if (!checkbox) return;

                row.classList.toggle(
                    'selected',
                    checkbox.checked
                );
            });
    };

    window.bulkResolve = async () => {
        const checkedBoxes = Array.from(
            document.querySelectorAll(
                '.row-checkbox:checked'
            )
        );

        const ids = checkedBoxes
            .map(
                checkbox =>
                    checkbox
                        .closest('.fix-row')
                        ?.getAttribute('data-id')
            )
            .filter(Boolean);

        if (!ids.length) {
            showAlert(
                'No Selection',
                'Please select at least one ticket.',
                'error'
            );
            return;
        }

        const confirmed = await showConfirm(
            `Are you sure you want to resolve ${ids.length} selected tickets?`,
            'Resolve Tickets'
        );

        if (!confirmed) return;

        const { error } = await supabase
            .from('court_issues')
            .update({
                status: 'resolved',
                resolved_at: new Date().toISOString()
            })
            .in('id', ids);

        if (error) {
            console.error(
                'Resolve Error:',
                error
            );

            showAlert(
                'Error',
                `Unable to resolve tickets: ${error.message}`,
                'error'
            );

            return;
        }

        try {
            await saveLog(
                'SYSTEM',
                `Bulk Resolved ${ids.length} Technical Tickets`,
                'Sys_Admin',
                'success'
            );
        } catch (logError) {
            console.error(
                'Log Error:',
                logError
            );
        }

        showAlert(
            'Resolved',
            `${ids.length} ticket(s) marked as resolved.`
        );

        elements.selectAll.checked = false;

        await fetchTickets();
    };

    window.bulkDelete = async () => {
        const checkedBoxes = Array.from(
            document.querySelectorAll(
                '.row-checkbox:checked'
            )
        );

        const ids = checkedBoxes
            .map(
                checkbox =>
                    checkbox
                        .closest('.fix-row')
                        ?.getAttribute('data-id')
            )
            .filter(Boolean);

        if (!ids.length) {
            showAlert(
                'No Selection',
                'Please select at least one ticket.',
                'error'
            );
            return;
        }

        const confirmed = await showConfirm(
            `Are you sure you want to permanently delete ${ids.length} selected tickets? This cannot be undone.`,
            'Delete Tickets',
            true
        );

        if (!confirmed) return;

        const { error } = await supabase
            .from('court_issues')
            .delete()
            .in('id', ids);

        if (error) {
            console.error(
                'Delete Error:',
                error
            );

            showAlert(
                'Error',
                `Unable to delete tickets: ${error.message}`,
                'error'
            );

            return;
        }

        try {
            await saveLog(
                'SYSTEM',
                `Deleted ${ids.length} Technical Tickets from database`,
                'Sys_Admin',
                'warning'
            );
        } catch (logError) {
            console.error(
                'Log Error:',
                logError
            );
        }

        showAlert(
            'Deleted',
            `${ids.length} ticket(s) permanently deleted.`
        );

        elements.selectAll.checked = false;

        await fetchTickets();
    };

    elements.newTicketBtn.addEventListener(
        'click',
        () => {
            elements.createModal.classList.add(
                'active'
            );
        }
    );

    elements.confirmCreateBtn.addEventListener(
        'click',
        async () => {
            const courtVal =
                elements.newCourt.value;

            const priorityVal =
                elements.newPriority.value;

            const typeVal =
                elements.newType.value;

            const descVal =
                elements.newDesc.value.trim();

            if (!descVal) {
                showAlert(
                    'Required',
                    'Please enter an issue description.',
                    'error'
                );
                return;
            }

            if (!courtVal) {
                showAlert(
                    'Required',
                    'Please select the affected court.',
                    'error'
                );
                return;
            }

            elements.confirmCreateBtn.innerHTML =
                "<i class='bx bx-loader-alt bx-spin'></i> Processing...";

            elements.confirmCreateBtn.disabled = true;

            const {
                data: authData
            } = await supabase.auth.getUser();

            const newIssue = {
                court_id: courtVal,
                issue_type: typeVal,
                description: descVal,
                status: 'pending',
                priority: priorityVal,
                reported_by:
                    authData?.user?.id || null,
                reporter_role: 'sys_admin',
                created_at:
                    new Date().toISOString()
            };

            const { error } =
                await supabase
                    .from('court_issues')
                    .insert([newIssue]);

            if (error) {
                showAlert(
                    'Error',
                    error.message,
                    'error'
                );
            } else {
                try {
                    await saveLog(
                        'SYSTEM',
                        `New Technical Ticket Created: ${typeVal}`,
                        'Sys_Admin',
                        'warning'
                    );
                } catch (logError) {
                    console.error(
                        'Log Error:',
                        logError
                    );
                }

                showAlert(
                    'Created',
                    'New fix request has been logged.'
                );

                elements.createModal.classList.remove(
                    'active'
                );

                elements.newDesc.value = '';

                await fetchTickets();
            }

            elements.confirmCreateBtn.innerHTML =
                'Create Ticket';

            elements.confirmCreateBtn.disabled =
                false;
        }
    );

    [
        elements.closeCreate,
        elements.cancelCreate
    ].forEach(btn => {
        btn.addEventListener(
            'click',
            () => {
                elements.createModal.classList.remove(
                    'active'
                );
            }
        );
    });

    const filterTable = () => {
        const query =
            elements.searchInput.value.toLowerCase();

        const activeChipEl =
            document.querySelector(
                '.chip[data-filter].active'
            );

        const activeChip =
            activeChipEl
                ? activeChipEl.getAttribute('data-filter')
                : 'all';

        document
            .querySelectorAll('.fix-row')
            .forEach(row => {
                const textMatch =
                    row.innerText
                        .toLowerCase()
                        .includes(query);

                const priority =
                    row.getAttribute(
                        'data-priority'
                    ) || 'low';

                const priorityMatch =
                    activeChip === 'all' ||
                    priority === activeChip;

                row.style.display =
                    textMatch && priorityMatch
                        ? ''
                        : 'none';
            });
    };

    elements.searchInput.addEventListener(
        'keyup',
        filterTable
    );

    chipBtns.forEach(btn => {
        btn.addEventListener(
            'click',
            () => {
                document
                    .querySelectorAll('.chip[data-filter].active')
                    .forEach(activeChip => {
                        activeChip.classList.remove('active');
                    });

                btn.classList.add('active');

                filterTable();
            }
        );
    });

    elements.selectAll.addEventListener(
        'change',
        () => {
            document
                .querySelectorAll('.row-checkbox')
                .forEach(cb => {
                    const row =
                        cb.closest('.fix-row');

                    if (
                        row &&
                        row.style.display !== 'none'
                    ) {
                        cb.checked =
                            elements.selectAll.checked;
                    }
                });

            updateBulkMenu();
        }
    );

    elements.tableBody.addEventListener(
        'change',
        e => {
            if (
                e.target.classList.contains(
                    'row-checkbox'
                )
            ) {
                updateBulkMenu();
            }
        }
    );

    elements.tableBody.addEventListener(
        'click',
        e => {
            const startBtn =
                e.target.closest(
                    '.start-fix-btn'
                );

            if (startBtn) {
                handleStartFix(startBtn);
            }
        }
    );

    const handleStartFix = btn => {
        const row =
            btn.closest('.fix-row');

        const dbId =
            row.getAttribute('data-id');

        const desc =
            row
                .querySelector('.p-name')
                .childNodes[0]
                .textContent
                .trim();

        const bar =
            row.querySelector(
                '.progress-bar'
            );

        btn.disabled = true;

        btn.innerHTML =
            "<i class='bx bx-loader-alt bx-spin'></i>";

        row.querySelector(
            '.progress-container'
        ).style.display = 'block';

        let width = 0;

        const timer = setInterval(
            async () => {
                if (width >= 100) {
                    clearInterval(timer);

                    const { error } =
                        await supabase
                            .from('court_issues')
                            .update({
                                status: 'resolved',
                                resolved_at:
                                    new Date().toISOString()
                            })
                            .eq('id', dbId);

                    if (error) {
                        console.error(
                            'Start Fix Error:',
                            error
                        );

                        showAlert(
                            'Error',
                            `Unable to complete fix: ${error.message}`,
                            'error'
                        );

                        btn.disabled = false;

                        btn.innerHTML =
                            "<i class='bx bx-play-circle'></i>";

                        return;
                    }

                    try {
                        await saveLog(
                            'SYSTEM',
                            `Technical Fix Completed: ${desc}`,
                            'Sys_Admin',
                            'success'
                        );
                    } catch (logError) {
                        console.error(
                            'Log Error:',
                            logError
                        );
                    }

                    showAlert(
                        'Fix Completed',
                        `"${desc}" has been marked as resolved.`
                    );

                    await fetchTickets();
                } else {
                    width +=
                        Math.random() * 35;

                    bar.style.width =
                        `${Math.min(
                            width,
                            100
                        )}%`;
                }
            },
            500
        );
    };

    const toggle =
        document.querySelector('.toggle');

    if (toggle) {
        toggle.addEventListener(
            'click',
            () => {
                document
                    .querySelector('nav')
                    .classList.toggle('close');
            }
        );
    }

    await fetchCourts();
    await fetchTickets();
});