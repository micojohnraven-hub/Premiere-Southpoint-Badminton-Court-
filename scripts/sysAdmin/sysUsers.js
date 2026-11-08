import { supabase } from '../supabase/supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {
    const get = (id) => document.getElementById(id);

    const elements = {
        sidebar: document.querySelector('.sidebar'),
        toggle: document.querySelector('.toggle'),

        userTable: get('userTable'),
        userSearch: get('userSearch'),
        filterChips: document.querySelectorAll('.filter-chip'),
        selectAll: get('selectAll'),
        bulkBar: get('bulkBar'),
        selectedCount: get('selectedCount'),

        bulkClearBtn: get('bulkClearBtn'),
        bulkExportBtn: get('bulkExportBtn'),
        bulkSuspendBtn: get('bulkSuspendBtn'),
        bulkActivateBtn: get('bulkActivateBtn'),

        exportBtn: get('exportBtn'),
        exportPdfBtn: get('exportPdfBtn'),

        statTotal: get('statTotal'),
        statActive: get('statActive'),
        statSuspended: get('statSuspended'),

        addUserBtn: get('addUserBtn'),
        addUserModal: get('addUserModal'),
        confirmAddUser: get('confirmAddUser'),
        newUserName: get('newUserName'),
        newUserEmail: get('newUserEmail'),
        newUserRole: get('newUserRole'),
        editUserRole: get('editUserRole'),
        editUserStatus: get('editUserStatus'),
        saveUserBtn: get('saveUserBtn'),

        profileModal: get('profileModal'),
        profHeaderRole: get('profHeaderRole'),
        profName: get('profName'),
        profEmail: get('profEmail'),
        profUsername: get('profUsername'),
        profContact: get('profContact'),
        profGender: get('profGender'),
        profRole: get('profRole'),
        profStatus: get('profStatus'),
        profJoinDate: get('profJoinDate'),
        profSessionFee: get('profSessionFee'),
        profSkill: get('profSkill'),

        modalWinrate: get('modalWinrate'),
        modalGamesPlayed: get('modalGamesPlayed'),
        modalViolations: get('modalViolations'),
        profileStatusIndicator: get('profileStatusIndicator'),

        modalOverlay: get('modalOverlay'),
        modalMessage: get('modalMessage'),
        modalConfirm: get('modalConfirm'),
        modalCancel: get('modalCancel'),

        suspensionNotice: get('suspensionNotice'),
        displaySuspensionReason: get('displaySuspensionReason'),

        logoutBtn: get('logoutBtn')
    };

    const showCustomModal = (message, options = {}) => {
        const {
            isInput = false,
            confirmText = 'Confirm',
            cancelText = 'Cancel', // 👈 1. ADD THIS
            isDanger = false,
            placeholder = 'Enter reason here...',
            hideCancel = false,
            hideConfirm = false,
            title = 'Notification',
            duration = 2000
        } = options;

        return new Promise((resolve) => {
            const inputField = get('modalInput');
            const iconBadge = get('modalIconBadge');
            const icon = get('modalIcon');
            const closeX = get('modalCloseX');

            // Set Title & Message
            get('modalTitle').innerText = title;
            elements.modalMessage.innerText = message;

            // Danger vs Success styling & icons
            if (isDanger) {
                elements.modalOverlay.classList.add('danger-mode');
                if (iconBadge) iconBadge.className = 'modal-icon-badge danger';
                if (icon) icon.className = 'bx bx-error-circle';
            } else {
                elements.modalOverlay.classList.remove('danger-mode');
                if (iconBadge) iconBadge.className = 'modal-icon-badge success';
                if (icon) icon.className = 'bx bx-check-circle';
            }

            // Input handling
            inputField.value = '';
            inputField.placeholder = placeholder;
            inputField.style.display = isInput ? 'block' : 'none';

            // Buttons
            elements.modalCancel.style.display = hideCancel ? 'none' : 'block';
            elements.modalConfirm.style.display = hideConfirm ? 'none' : 'block';
            elements.modalConfirm.innerText = confirmText;
            elements.modalCancel.innerText = cancelText; //

            // Remove inline style background so CSS danger classes take over cleanly
            elements.modalConfirm.style.background = '';

            elements.modalOverlay.classList.add('active');
            if (isInput) setTimeout(() => inputField.focus(), 50);

            const cleanup = () => {
                elements.modalConfirm.removeEventListener('click', handleConfirm);
                elements.modalCancel.removeEventListener('click', handleCancel);
                if (closeX) closeX.removeEventListener('click', handleCancel);
            };

            const close = (result) => {
                elements.modalOverlay.classList.remove('active');
                cleanup();
                resolve(result);
            };

            const handleConfirm = () => {
                const value = inputField.value.trim();
                close(isInput ? value : true);
            };

            const handleCancel = () => {
                close(false);
            };

            const handleCloseX = () => {
                close(null); // 👈 Cancels without triggering PDF
            };

            elements.modalConfirm.addEventListener('click', handleConfirm);
            elements.modalCancel.addEventListener('click', handleCancel);
            if (closeX) closeX.addEventListener('click', handleCloseX);

            if (hideCancel && hideConfirm) {
                setTimeout(() => close(true), duration);
            }
        });
    };
    
    let currentUserData = null;

    /* SIDEBAR */

    if (elements.sidebar && elements.toggle) {
        const savedState = localStorage.getItem('sidebarState');

        if (savedState === 'closed') {
            elements.sidebar.classList.add('close');
        }

        elements.toggle.addEventListener('click', () => {
            elements.sidebar.classList.toggle('close');

            localStorage.setItem(
                'sidebarState',
                elements.sidebar.classList.contains('close')
                    ? 'closed'
                    : 'open'
            );
        });
    }

    const sidebarLinks = document.querySelectorAll(
        '.sidebar .menu-bar .nav-link a'
    );

    const currentPage =
        window.location.pathname.split('/').pop() || 'login.html';

    sidebarLinks.forEach(link => {
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('active');
            link.parentElement.classList.add('active');
        }
    });

    /* LOGOUT */

    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener(
            'click',
            async (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();

                const { error } = await supabase.auth.signOut();

                if (error) {
                    console.error('Logout Error:', error.message);

                    await showCustomModal(
                        `Unable to log out: ${error.message}`,
                        {
                            title: 'Logout Error',
                            isDanger: true,
                            hideCancel: true
                        }
                    );

                    return;
                }

                window.location.href = '../auth/login.html';
            },
            true
        );
    }

    /* USER MANAGEMENT */

    const fetchUsers = async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('full_name', { ascending: true });

        if (error) {
            console.error('Error loading users:', error.message);
            return;
        }

        elements.userTable.innerHTML = '';

        data.forEach(renderUserRow);

        updateStats(data);
        updateBulkCount();
        applyFilters();
    };

    const renderUserRow = (user) => {
        const role = (user.role || 'player').toLowerCase();
        const status = (user.status || 'active').toLowerCase();
        const isSuspended = status === 'suspended';

        const tr = document.createElement('tr');

        tr.className = 'user-row';
        tr.dataset.id = user.id;
        tr.dataset.email = user.email || '';
        tr.dataset.role = role;

        tr.innerHTML = `
            <td>
                <input type="checkbox" class="user-checkbox">
            </td>

            <td class="p-name">
                ${user.full_name || 'No Name'}
                <br>
                <small>${user.email || 'N/A'}</small>
            </td>

            <td>
                <span class="badge role-${role}">
                    ${formatRole(role)}
                </span>
            </td>

            <td>
                <span class="status-pill ${status}">
                    ${formatStatus(status)}
                </span>
            </td>

            <td style="text-align: center;">
                <div class="action-btns">
                    <button
                        class="action-btn view"
                        title="View Profile">
                        <i class="bx bx-show"></i>
                    </button>

                    <button
                        class="action-btn fix"
                        title="Reset Credentials">
                        <i class="bx bx-key"></i>
                    </button>

                    <button
                        class="action-btn ${isSuspended ? 'restore' : 'suspend'}"
                        title="${isSuspended ? 'Reactivate' : 'Suspend Account'}">
                        <i class="bx ${isSuspended ? 'bx-undo' : 'bx-user-x'}"></i>
                    </button>
                </div>
            </td>
        `;

        elements.userTable.appendChild(tr);
    };

    /* STATISTICS */

    const updateStats = (data) => {
        elements.statTotal.innerText = data.length;

        elements.statActive.innerText = data.filter(
            user => (user.status || 'active').toLowerCase() === 'active'
        ).length;

        elements.statSuspended.innerText = data.filter(
            user => (user.status || '').toLowerCase() === 'suspended'
        ).length;
    };

    /* SEARCH & FILTER */

    const filterBtn = get('filterBtn');
    const filterDropdown = get('filterDropdown');
    const filterWrapper = get('filterWrapper');
    const resetFilterBtn = get('resetFilterBtn');
    const filterDot = get('filterDot');

    // 1. Toggle dropdown when clicking the filter icon
    if (filterBtn) {
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            filterDropdown.classList.toggle('active');
            filterBtn.classList.toggle('active');
        });
    }

    // 2. Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (filterWrapper && !filterWrapper.contains(e.target)) {
            filterDropdown.classList.remove('active');
            filterBtn.classList.remove('active');
        }
    });

    // 3. Handle Role & Status Chip selection
    document.querySelectorAll('#roleChips .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#roleChips .filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            applyFilters();
        });
    });

    document.querySelectorAll('#statusChips .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#statusChips .filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            applyFilters();
        });
    });

    // 4. Reset Filters button
    if (resetFilterBtn) {
        resetFilterBtn.addEventListener('click', () => {
            document.querySelectorAll('#roleChips .filter-chip').forEach(c => c.classList.remove('active'));
            document.querySelector('#roleChips [data-filter="all users"]').classList.add('active');

            document.querySelectorAll('#statusChips .filter-chip').forEach(c => c.classList.remove('active'));
            document.querySelector('#statusChips [data-status="all"]').classList.add('active');

            elements.userSearch.value = '';
            applyFilters();
        });
    }

    // 5. Apply filters across Search, Role, and Status
    const applyFilters = () => {
        const searchTerm = elements.userSearch.value.trim().toLowerCase();

        const activeRoleChip = document.querySelector('#roleChips .filter-chip.active');
        const selectedRole = activeRoleChip ? activeRoleChip.dataset.filter : 'all users';

        const activeStatusChip = document.querySelector('#statusChips .filter-chip.active');
        const selectedStatus = activeStatusChip ? activeStatusChip.dataset.status : 'all';

        // Check if any non-default filter is applied (shows green dot on filter button)
        const isCustomFilter = selectedRole !== 'all users' || selectedStatus !== 'all';
        if (filterDot) {
            filterDot.classList.toggle('active', isCustomFilter);
        }

        const rows = document.querySelectorAll('.user-row');
        let visibleCount = 0; // 👈 Count matching rows

        rows.forEach(row => {
            const rowText = row.innerText.toLowerCase();
            const rowRole = (row.dataset.role || '').toLowerCase();
            const rowStatus = (row.querySelector('.status-pill')?.innerText || '').trim().toLowerCase();

            // Match Search
            const matchesSearch = rowText.includes(searchTerm);

            // Match Role
            let matchesRole = false;
            if (selectedRole === 'all users') {
                matchesRole = true;
            } else if (selectedRole === 'employee') {
                matchesRole = (rowRole === 'staff' || rowRole === 'employee');
            } else if (selectedRole === 'admins') {
                matchesRole = (rowRole === 'sys_admin' || rowRole === 'business_admin');
            } else {
                matchesRole = (rowRole === selectedRole);
            }

            // Match Status
            let matchesStatus = false;
            if (selectedStatus === 'all') {
                matchesStatus = true;
            } else {
                matchesStatus = (rowStatus === selectedStatus);
            }

            const isVisible = matchesSearch && matchesRole && matchesStatus;
            row.style.display = isVisible ? '' : 'none';

            if (isVisible) visibleCount++;
        });

        // 👇 SHOW / HIDE "NO DATA FOUND" EMPTY STATE
        let noDataRow = elements.userTable.querySelector('.no-data-row');
        if (visibleCount === 0) {
            if (!noDataRow) {
                noDataRow = document.createElement('tr');
                noDataRow.className = 'no-data-row';
                noDataRow.innerHTML = `
                    <td colspan="5" class="no-data-cell">
                        <div class="empty-state">
                            <i class='bx bx-search-alt'></i>
                            <h3>No Users Found</h3>
                            <p>There's nothing to see here. Try adjusting your search or filters.</p>
                        </div>
                    </td>
                `;
                elements.userTable.appendChild(noDataRow);
            }
        } else if (noDataRow) {
            noDataRow.remove();
        }

        updateBulkCount();
    };

    elements.userSearch.addEventListener('input', applyFilters);

    /* BULK SELECTION */

    const updateBulkCount = () => {
        const checked =
            document.querySelectorAll('.user-checkbox:checked');

        const count = checked.length;

        elements.selectedCount.innerText = count;

        if (count > 0) {
            elements.bulkBar.classList.add('active');
        } else {
            elements.bulkBar.classList.remove('active');
            elements.selectAll.checked = false;
        }
    };

    elements.selectAll.addEventListener('change', () => {
        const checked = elements.selectAll.checked;

        const visibleCheckboxes = document.querySelectorAll(
            '.user-row:not([style*="display: none"]) .user-checkbox'
        );

        visibleCheckboxes.forEach(
            checkbox => checkbox.checked = checked
        );

        updateBulkCount();
    });

    elements.userTable.addEventListener('change', (e) => {
        if (e.target.classList.contains('user-checkbox')) {
            updateBulkCount();
        }
    });

    /* ---> BULK ACTION LISTENERS <--- */

    const getSelectedRows = () => {
        return Array.from(document.querySelectorAll('.user-checkbox:checked'))
            .map(cb => cb.closest('.user-row'))
            .filter(Boolean);
    };

    // Deselect All / Clear
    if (elements.bulkClearBtn) {
        elements.bulkClearBtn.addEventListener('click', () => {
            document.querySelectorAll('.user-checkbox').forEach(cb => cb.checked = false);
            elements.selectAll.checked = false;
            updateBulkCount();
        });
    }

    // Bulk Export
    if (elements.bulkExportBtn) {
        elements.bulkExportBtn.addEventListener('click', async () => {
            const selectedRows = getSelectedRows();
            const selectedIds = selectedRows.map(r => r.dataset.id);
            const count = selectedIds.length;

            if (count === 0) return;

            // Fetch selected user data
            const { data, error } = await supabase
                .from('profiles')
                .select('full_name, email, role, status, player_level')
                .in('id', selectedIds)
                .order('full_name', { ascending: true });

            if (error || !data) {
                await showCustomModal('Unable to fetch selected users.', {
                    title: 'Export Error',
                    isDanger: true,
                    hideCancel: true
                });
                return;
            }

            // Ask user for choice
            const choice = await showCustomModal(
                `Choose format to export ${count} selected account(s):`,
                {
                    title: 'Export Format',
                    confirmText: '📊 Download CSV',
                    cancelText: '📄 Download PDF',
                    duration: 0
                }
            );

            // If user closed with "X", do nothing
            if (choice === null) return;

            if (choice === true) {
                // 1. DOWNLOAD CSV
                const csvContent =
                    'Full Name,Email,Role,Status,Skill\n' +
                    data.map(u => `"${u.full_name || ''}","${u.email || ''}","${u.role || ''}","${u.status || ''}","${u.player_level || ''}"`).join('\n');

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `Selected_Users_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
                URL.revokeObjectURL(url);
            } else if (choice === false) {
                // 2. DOWNLOAD PDF
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();

                doc.setFontSize(16);
                doc.setTextColor(18, 38, 29);
                doc.text('Southpoint - Selected Users Report', 14, 18);

                doc.setFontSize(9);
                doc.setTextColor(100, 116, 139);
                doc.text(`Generated on: ${new Date().toLocaleDateString()} | Selected: ${data.length}`, 14, 25);

                const tableRows = data.map(u => [
                    u.full_name || 'N/A',
                    u.email || 'N/A',
                    formatRole(u.role || 'player').toUpperCase(),
                    formatStatus(u.status || 'active').toUpperCase(),
                    u.player_level || 'N/A'
                ]);

                doc.autoTable({
                    head: [['FULL NAME', 'EMAIL', 'ROLE', 'STATUS', 'SKILL LEVEL']],
                    body: tableRows,
                    startY: 30,
                    theme: 'striped',
                    headStyles: { fillColor: [5, 185, 5], textColor: 255, fontStyle: 'bold' },
                    styles: { fontSize: 8, cellPadding: 3.5 }
                });

                doc.save(`Selected_Users_${new Date().toISOString().split('T')[0]}.pdf`);
            }
        });
    }

    // Bulk Suspend
    if (elements.bulkSuspendBtn) {
        elements.bulkSuspendBtn.addEventListener('click', async () => {
            const selectedRows = getSelectedRows();
            const selectedIds = selectedRows.map(r => r.dataset.id);
            const count = selectedIds.length;

            if (count === 0) return; // Guard: prevents running on 0 selection

            const reason = await showCustomModal(
                `Are you sure you want to suspend ${count} selected account(s)? Please provide a reason:`,
                {
                    isInput: true,
                    isDanger: true,
                    confirmText: 'Suspend All',
                    title: `Bulk Suspend (${count} users)`
                }
            );

            if (reason === false) return;
            if (!reason) {
                await showCustomModal('A suspension reason is required.', {
                    title: 'Reason Required',
                    isDanger: true,
                    hideCancel: true
                });
                return;
            }

            const { error } = await supabase
                .from('profiles')
                .update({ status: 'suspended', suspension_reason: reason })
                .in('id', selectedIds);

            if (error) {
                await showCustomModal(`Failed to suspend accounts: ${error.message}`, {
                    title: 'Error',
                    isDanger: true,
                    hideCancel: true
                });
                return;
            }

            await showCustomModal(`${count} accounts suspended successfully.`, {
                title: 'Success',
                hideCancel: true,
                hideConfirm: true,
                duration: 1500
            });

            fetchUsers();
        });
    }

    // Bulk Reactivate
    if (elements.bulkActivateBtn) {
        elements.bulkActivateBtn.addEventListener('click', async () => {
            const selectedRows = getSelectedRows();
            const selectedIds = selectedRows.map(r => r.dataset.id);
            const count = selectedIds.length;

            if (count === 0) return; // Guard: prevents running on 0 selection

            const confirmed = await showCustomModal(
                `Reactivate ${count} selected user account(s)?`,
                {
                    title: `Bulk Reactivate (${count} users)`,
                    confirmText: 'Reactivate All'
                }
            );

            if (!confirmed) return;

            const { error } = await supabase
                .from('profiles')
                .update({ status: 'active', suspension_reason: null })
                .in('id', selectedIds);

            if (error) {
                await showCustomModal(`Failed to reactivate accounts: ${error.message}`, {
                    title: 'Error',
                    isDanger: true,
                    hideCancel: true
                });
                return;
            }

            await showCustomModal(`${count} accounts reactivated successfully.`, {
                title: 'Success',
                hideCancel: true,
                hideConfirm: true,
                duration: 1500
            });

            fetchUsers();
        });
    }
    
    /* EXPORT */

    elements.exportBtn.onclick = async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select(
                'full_name, email, role, status, player_level'
            );

        if (error) {
            await showCustomModal(
                'Unable to export users.',
                {
                    title: 'Export Error',
                    isDanger: true,
                    hideCancel: true
                }
            );
            return;
        }

        const csvContent =
            'Full Name,Email,Role,Status,Skill\n' +
            data.map(user =>
                `"${user.full_name || ''}","${user.email || ''}","${user.role || ''}","${user.status || ''}","${user.player_level || ''}"`
            ).join('\n');

        const blob = new Blob(
            [csvContent],
            { type: 'text/csv;charset=utf-8;' }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download =
            `Users_${new Date().toISOString().split('T')[0]}.csv`;

        link.click();

        URL.revokeObjectURL(url);
    };

    /* EXPORT PDF */
    if (elements.exportPdfBtn) {
        elements.exportPdfBtn.onclick = async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('full_name, email, role, status, player_level')
                .order('full_name', { ascending: true });

            if (error || !data) {
                await showCustomModal('Unable to load users for PDF export.', {
                    title: 'Export Error',
                    isDanger: true,
                    hideCancel: true
                });
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // Header Title & Date
            doc.setFontSize(16);
            doc.setTextColor(18, 38, 29);
            doc.text('Southpoint - User Accounts Report', 14, 18);

            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            doc.text(`Generated on: ${dateStr} | Total Records: ${data.length}`, 14, 25);

            // Table Data
            const tableRows = data.map(u => [
                u.full_name || 'N/A',
                u.email || 'N/A',
                formatRole(u.role || 'player').toUpperCase(),
                formatStatus(u.status || 'active').toUpperCase(),
                u.player_level || 'N/A'
            ]);

            doc.autoTable({
                head: [['FULL NAME', 'EMAIL', 'ROLE', 'STATUS', 'SKILL LEVEL']],
                body: tableRows,
                startY: 30,
                theme: 'striped',
                headStyles: { fillColor: [5, 185, 5], textColor: 255, fontStyle: 'bold' },
                styles: { fontSize: 8, cellPadding: 3.5 }
            });

            doc.save(`Users_Report_${new Date().toISOString().split('T')[0]}.pdf`);

            await showCustomModal('PDF report downloaded successfully!', {
                title: 'Success',
                hideCancel: true,
                hideConfirm: true,
                duration: 1500
            });
        };
    }

    /* ADD USER */

    elements.addUserBtn.onclick = () => {
        elements.addUserModal.classList.add('active');
    };

    get('closeAddUser').onclick =
        get('cancelAddUser').onclick = () => {
            elements.addUserModal.classList.remove('active');
        };

    elements.confirmAddUser.onclick = async () => {
        const name = elements.newUserName.value.trim();
        const email = elements.newUserEmail.value.trim();
        const role = elements.newUserRole.value;

        if (!name || !email) {
            await showCustomModal(
                'Please fill in all required fields.',
                {
                    title: 'Missing Information',
                    isDanger: true,
                    hideCancel: true
                }
            );
            return;
        }

        const { error } = await supabase
            .from('profiles')
            .insert([{
                full_name: name,
                email,
                role,
                status: 'active',
                created_at: new Date()
            }]);

        if (error) {
            await showCustomModal(
                `Error creating account: ${error.message}`,
                {
                    title: 'Error',
                    isDanger: true,
                    hideCancel: true
                }
            );
            return;
        }

        elements.addUserModal.classList.remove('active');

        elements.newUserName.value = '';
        elements.newUserEmail.value = '';

        await showCustomModal(
            'Account created successfully.',
            {
                title: 'Success',
                hideCancel: true,
                hideConfirm: true,
                duration: 1500
            }
        );

        fetchUsers();
    };

    /* TABLE ACTIONS */

    elements.userTable.onclick = async (e) => {
        const row = e.target.closest('tr');

        if (!row) return;

        const id = row.dataset.id;
        const email = row.dataset.email;

        /* VIEW PROFILE */

        if (e.target.closest('.view')) {
            e.preventDefault();
            e.stopPropagation();

            openProfileModal(id);
            return;
        }

        /* RESET PASSWORD */

        if (e.target.closest('.fix')) {
            const confirmed = await showCustomModal(
                `Send password reset link to ${email}?`,
                {
                    title: 'Reset Security',
                    confirmText: 'Send Link'
                }
            );

            if (!confirmed) return;

            const { error } =
                await supabase.auth.resetPasswordForEmail(email);

            if (error) {
                await showCustomModal(
                    `Unable to send reset link: ${error.message}`,
                    {
                        title: 'Error',
                        isDanger: true,
                        hideCancel: true
                    }
                );
                return;
            }

            showCustomModal(
                'Password reset link sent successfully.',
                {
                    title: 'Success',
                    confirmText: 'OK',
                    hideCancel: true
                }
            );

            return;
        }

        /* SUSPEND */

        if (e.target.closest('.suspend')) {
            const reason = await showCustomModal(
                'Please provide a reason for suspending this account.',
                {
                    isInput: true,
                    isDanger: true,
                    confirmText: 'Suspend Account',
                    title: 'Suspend Account'
                }
            );

            if (reason === false) return;

            if (!reason) {
                await showCustomModal(
                    'A reason is required to suspend this account.',
                    {
                        title: 'Reason Required',
                        isDanger: true,
                        hideCancel: true
                    }
                );
                return;
            }

            const { error } = await supabase
                .from('profiles')
                .update({
                    status: 'suspended',
                    suspension_reason: reason
                })
                .eq('id', id);

            if (error) {
                await showCustomModal(
                    `Error suspending account: ${error.message}`,
                    {
                        title: 'Error',
                        isDanger: true,
                        hideCancel: true
                    }
                );
                return;
            }

            await showCustomModal(
                'The account has been suspended successfully.',
                {
                    title: 'Success',
                    hideCancel: true,
                    hideConfirm: true,
                    duration: 1500
                }
            );

            fetchUsers();
            return;
        }

        /* REACTIVATE */

        if (e.target.closest('.restore')) {
            const confirmed = await showCustomModal(
                'Reactivate this user account?',
                {
                    title: 'Reactivate Account',
                    confirmText: 'Reactivate'
                }
            );

            if (!confirmed) return;

            const { error } = await supabase
                .from('profiles')
                .update({
                    status: 'active',
                    suspension_reason: null
                })
                .eq('id', id);

            if (error) {
                await showCustomModal(
                    `Error reactivating account: ${error.message}`,
                    {
                        title: 'Error',
                        isDanger: true,
                        hideCancel: true
                    }
                );
                return;
            }

            await showCustomModal(
                'The account has been reactivated successfully.',
                {
                    title: 'Success',
                    hideCancel: true,
                    hideConfirm: true,
                    duration: 1500
                }
            );

            fetchUsers();
        }
    };

    /* PROFILE HELPERS */

    const formatRole = (role) => {
        const roles = {
            player: 'Player',
            coach: 'Coach',
            employee: 'Employee',
            sys_admin: 'System Administrator',
            business_admin: 'Business Administrator'
        };

        return roles[role] || role;
    };

    const formatStatus = (status) => {
        const statuses = {
            active: 'Active',
            inactive: 'Inactive',
            pending: 'Pending',
            suspended: 'Suspended',
            banned: 'Banned'
        };

        return statuses[status] || status;
    };

    /* PROFILE MODAL */

    const openProfileModal = async (userId) => {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Error loading profile:', error);
            return;
        }

        currentUserData = data;

        if (elements.editUserRole) elements.editUserRole.value = (data.role || 'player').toLowerCase();
        if (elements.editUserStatus) elements.editUserStatus.value = (data.status || 'active').toLowerCase();

        const role = (data.role || 'player').toLowerCase();
        const status = (data.status || 'active').toLowerCase();

        const isPlayer = role === 'player';
        const isCoach = role === 'coach';

        elements.profName.innerText =
            data.full_name || 'No Name';

        elements.profUsername.innerText =
            data.username || 'N/A';

        elements.profEmail.innerText =
            data.email || 'N/A';

        elements.profContact.innerText =
            data.contact_number || 'N/A';

        elements.profGender.innerText = data.gender
            ? data.gender.charAt(0).toUpperCase() +
              data.gender.slice(1)
            : 'N/A';

        // ✅ Replace the old profRole/profStatus lines with this safe check:
        if (elements.profRole) elements.profRole.innerText = formatRole(role);
        if (elements.profStatus) elements.profStatus.innerText = formatStatus(status);

        elements.profHeaderRole.innerText =
            formatRole(role);

        elements.profHeaderRole.innerText =
            formatRole(role);

        elements.profJoinDate.innerText = data.created_at
            ? new Date(data.created_at).toLocaleDateString(
                'en-US',
                {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }
            )
            : 'N/A';

        elements.profileStatusIndicator.className =
            `status-indicator ${
                status === 'active'
                    ? 'active'
                    : 'inactive'
            }`;

        /* PLAYER INFORMATION */

        const playerInfo =
            document.querySelectorAll('.player-info');

        const playerStats =
            document.querySelector('.player-stats');

        playerInfo.forEach(item => {
            item.style.display =
                isPlayer ? 'block' : 'none';
        });

        if (playerStats) {
            playerStats.style.display =
                isPlayer ? 'grid' : 'none';
        }

        if (isPlayer) {
            elements.profSkill.innerText =
                data.player_level || 'Not Qualified';

            elements.modalWinrate.innerText =
                `${Number(data.winrate || 0).toFixed(1)}%`;

            elements.modalGamesPlayed.innerText =
                Number(data.games_played || 0);

            if (elements.modalViolations) {
                elements.modalViolations.innerText =
                    Number(data.violations || 0);
            }
        }

        /* COACH INFORMATION */

        const coachInfo =
            document.querySelectorAll('.coach-info');

        coachInfo.forEach(item => {
            item.style.display =
                isCoach ? 'block' : 'none';
        });

        if (isCoach) {
            elements.profSessionFee.innerText =
                data.session_fee !== null &&
                data.session_fee !== undefined
                    ? `₱${Number(data.session_fee).toLocaleString(
                        'en-PH',
                        {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        }
                    )}`
                    : 'N/A';
        }

        /* SUSPENSION INFORMATION */

        if (status === 'suspended') {
            elements.suspensionNotice.style.display =
                'block';

            elements.displaySuspensionReason.innerText =
                data.suspension_reason ||
                'No specific reason provided.';
        } else {
            elements.suspensionNotice.style.display =
                'none';

            elements.displaySuspensionReason.innerText =
                '';
        }

        elements.profileModal.classList.add('active');
    };


    get('closeProfile').onclick =
        get('closeProfileBtn').onclick = () => {
            elements.profileModal.classList.remove('active');
        };

        /* SAVE ROLE & STATUS VIA SECURE RPC */
    if (elements.saveUserBtn) {
        elements.saveUserBtn.addEventListener('click', async () => {
            if (!currentUserData) return;

            const newRole = elements.editUserRole.value;
            const newStatus = elements.editUserStatus.value;

            // Confirm prompt
            const confirmed = await showCustomModal(
                `Update ${currentUserData.full_name || 'this user'} to Role: "${formatRole(newRole)}" and Status: "${formatStatus(newStatus)}"?`,
                {
                    title: 'Confirm Role & Status Change',
                    confirmText: 'Save Changes'
                }
            );

            if (!confirmed) return;

            // Call the secure RPC function
            const { data, error } = await supabase.rpc('admin_update_user_role_and_status', {
                target_user_id: currentUserData.id,
                new_role: newRole,
                new_status: newStatus
            });

            if (error) {
                await showCustomModal(error.message, {
                    title: 'Update Failed',
                    isDanger: true,
                    hideCancel: true
                });
                return;
            }

            elements.profileModal.classList.remove('active');

            await showCustomModal('User role and status updated successfully!', {
                title: 'Success',
                hideCancel: true,
                hideConfirm: true,
                duration: 1500
            });

            // Refresh table to reflect the changes
            fetchUsers();
        });
    }

    fetchUsers();
});