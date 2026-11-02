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
        exportBtn: get('exportBtn'),

        statTotal: get('statTotal'),
        statActive: get('statActive'),
        statSuspended: get('statSuspended'),

        addUserBtn: get('addUserBtn'),
        addUserModal: get('addUserModal'),
        confirmAddUser: get('confirmAddUser'),
        newUserName: get('newUserName'),
        newUserEmail: get('newUserEmail'),
        newUserRole: get('newUserRole'),

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
            isDanger = false,
            placeholder = 'Enter reason here...',
            hideCancel = false,
            hideConfirm = false,
            title = 'Notification',
            duration = 2000
        } = options;

        return new Promise((resolve) => {
            const inputField = get('modalInput');

            elements.modalOverlay.querySelector('h3').innerText = title;
            elements.modalMessage.innerText = message;

            elements.modalCancel.style.display = hideCancel ? 'none' : 'block';
            elements.modalConfirm.style.display = hideConfirm ? 'none' : 'block';

            inputField.value = '';
            inputField.placeholder = placeholder;
            inputField.style.display = isInput ? 'block' : 'none';

            elements.modalConfirm.innerText = confirmText;
            elements.modalConfirm.style.background =
                isDanger ? '#ef4444' : '#00c800';

            elements.modalOverlay.classList.add('active');

            const cleanup = () => {
                elements.modalConfirm.removeEventListener('click', handleConfirm);
                elements.modalCancel.removeEventListener('click', handleCancel);
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

            elements.modalConfirm.addEventListener('click', handleConfirm);
            elements.modalCancel.addEventListener('click', handleCancel);

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

    const applyFilters = () => {
        const searchTerm =
            elements.userSearch.value.trim().toLowerCase();

        const activeChip =
            document.querySelector('.filter-chip.active');

        const selectedFilter =
            activeChip?.innerText.trim().toLowerCase() || 'all users';

        const rows = document.querySelectorAll('.user-row');

        rows.forEach(row => {
            const rowText = row.innerText.toLowerCase();
            const rowRole = row.dataset.role.toLowerCase();

            const matchesSearch =
                rowText.includes(searchTerm);

            let matchesFilter = false;

            if (selectedFilter === 'all users') {
                matchesFilter = true;
            } else if (selectedFilter === 'employee') {
                matchesFilter =
                    rowRole === 'staff' ||
                    rowRole === 'employee';
            } else {
                matchesFilter =
                    selectedFilter.includes(rowRole);
            }

            row.style.display =
                matchesSearch && matchesFilter ? '' : 'none';
        });

        updateBulkCount();
    };

    elements.filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            elements.filterChips.forEach(item =>
                item.classList.remove('active')
            );

            chip.classList.add('active');
            applyFilters();
        });
    });

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

        elements.profRole.innerText =
            formatRole(role);

        elements.profStatus.innerText =
            formatStatus(status);

        elements.profStatus.className =
            `status-pill ${status}`;

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

    fetchUsers();
});