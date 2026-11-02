import { supabase } from "../supabase/supabaseClient.js";
import { saveLog } from "../../scripts/sysAdmin/sysLogs.js";

document.addEventListener("DOMContentLoaded", () => {
    const navLinks = document.querySelectorAll(".settings-link");
    const tabContents = document.querySelectorAll(".tab-content");

    const modal = document.getElementById("userModal");
    const openModalBtn = document.getElementById("openUserModal");
    const closeModalBtn = document.getElementById("closeUserModal");
    const cancelModalBtn = document.getElementById("cancelUserModal");

    const saveUserBtn = document.getElementById("saveUserBtn");
    const userTableBody = document.getElementById("userTableBody");

    const userModalTitle = document.getElementById("userModalTitle");
    const userModalSubtitle = document.getElementById("userModalSubtitle");

    const confirmModal = document.getElementById("confirmModal");
    const confirmTitle = document.getElementById("confirmTitle");
    const confirmMessage = document.getElementById("confirmMessage");
    const confirmOkBtn = document.getElementById("confirmOkBtn");
    const confirmCancelBtn = document.getElementById("confirmCancelBtn");
    const confirmIcon = document.getElementById("confirmIcon");

    let editingUserId = null;

    const STRONG_PASSWORD_REGEX =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,}$/;

    function getPasswordRequirementMessage() {
        return "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";
    }

    navLinks.forEach(link => {
        link.addEventListener("click", e => {
            e.preventDefault();

            navLinks.forEach(item => item.classList.remove("active"));
            tabContents.forEach(tab => tab.classList.remove("active"));

            link.classList.add("active");
            document
                .getElementById(link.dataset.section)
                ?.classList.add("active");
        });
    });

    document.getElementById("business")?.classList.add("active");
    document
        .querySelector('[data-section="business"]')
        ?.classList.add("active");

    openModalBtn?.addEventListener("click", openCreateModal);
    closeModalBtn?.addEventListener("click", closeUserModal);
    cancelModalBtn?.addEventListener("click", closeUserModal);

    window.addEventListener("click", e => {
        if (e.target === modal) {
            closeUserModal();
        }

        if (e.target === confirmModal) {
            confirmModal.classList.remove("show");
        }
    });

    loadStaffAccounts();
    loadPricing();

    async function loadStaffAccounts() {
        const { data, error } = await supabase
            .from("profiles")
            .select(`
                id,
                full_name,
                email,
                username,
                contact_number,
                role,
                status,
                locked_until,
                created_at
            `)
            .in("role", [
                "employee",
                "business_admin",
                "sys_admin"
            ])
            .order("created_at", { ascending: true });

        if (error) {
            console.error(error);

            userTableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="table-loading">
                        Failed to load accounts.
                    </td>
                </tr>
            `;

            return;
        }

        renderTable(data || []);
    }

    function renderTable(accounts) {
        if (!accounts.length) {
            userTableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="table-loading">
                        No accounts yet.
                    </td>
                </tr>
            `;

            return;
        }

        userTableBody.innerHTML = accounts.map(account => {
            const fullName = account.full_name || "Unknown User";

            const initials = fullName
                .split(/\s+/)
                .filter(Boolean)
                .map(name => name[0])
                .join("")
                .toUpperCase()
                .substring(0, 2);

            const roleLabel = getRoleLabel(account.role);

        const isLocked = 
            account.locked_until && 
            new Date(account.locked_until) > new Date();

        const status = account.status || "pending";

            return `
                <tr>
                    <td>
                        <div class="user-info">
                            <div class="user-avatar">
                                ${escapeHtml(initials)}
                            </div>

                            <div>
                                <div class="user-name">
                                    ${escapeHtml(fullName)}
                                </div>

                                <div class="user-email">
                                    ${escapeHtml(account.email || "")}
                                </div>
                            </div>
                        </div>
                    </td>

                    <td>
                        <span class="role-badge ${escapeHtml(account.role || "")}">
                            ${escapeHtml(roleLabel)}
                        </span>
                    </td>

                    <td>
                        <span class="status-badge ${
                            isLocked || status !== "active"
                                ? "badge-inactive"
                                : "badge-active"
                        }">
                            ${isLocked ? "Locked" : status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                    </td>

                    <td style="text-align:center;">
                        <div class="action-group">
                            <button
                                type="button"
                                class="action-btn edit edit-user-btn"
                                data-id="${account.id}"
                                title="Edit Account"
                            >
                                <i class="bx bx-edit"></i>
                            </button>

                            <button
                                type="button"
                                class="action-btn ${
                                    isLocked ? "unlock" : "lock"
                                } lock-user-btn"
                                data-id="${account.id}"
                                data-locked="${isLocked}"
                                data-name="${escapeHtml(fullName)}"
                                title="${
                                    isLocked
                                        ? "Unlock Account"
                                        : "Lock Account"
                                }"
                            >
                                <i class="bx ${
                                    isLocked
                                        ? "bx-lock-open"
                                        : "bx-lock-alt"
                                }"></i>
                            </button>

                            <button
                                type="button"
                                class="action-btn delete delete-user-btn"
                                data-id="${account.id}"
                                data-name="${escapeHtml(fullName)}"
                                title="Delete Account"
                            >
                                <i class="bx bx-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    }

    function getRoleLabel(role) {
        const roles = {
            employee: "Employee",
            business_admin: "Business Admin",
            sys_admin: "System Admin"
        };

        return roles[role] || role;
    }

    function openCreateModal() {
        editingUserId = null;

        userModalTitle.textContent = "Create New Account";
        userModalSubtitle.textContent = "Add a new user to the system.";
        saveUserBtn.textContent = "Create Account";

        clearUserForm();

        document.getElementById("newUserUsername").disabled = false;

        modal.classList.add("show");
    }

    async function openEditModal(userId) {
        const { data, error } = await supabase
            .from("profiles")
            .select(`
                id,
                full_name,
                email,
                username,
                contact_number,
                role
            `)
            .eq("id", userId)
            .single();

        if (error || !data) {
            console.error(error);
            showAlert("Failed to load account.", "error");
            return;
        }

        editingUserId = userId;

        userModalTitle.textContent = "Edit Account";
        userModalSubtitle.textContent =
            "Update account information and access.";

        saveUserBtn.textContent = "Save Changes";

        document.getElementById("newUserName").value =
            data.full_name || "";

        document.getElementById("newUserUsername").value =
            data.username || "";

        document.getElementById("newUserEmail").value =
            data.email || "";

        document.getElementById("newUserContact").value =
            data.contact_number || "";

        document.getElementById("newUserRole").value =
            data.role || "employee";

        document.getElementById("newUserUsername").disabled = true;

        modal.classList.add("show");
    }

    function closeUserModal() {
        modal.classList.remove("show");
        editingUserId = null;
        resetSaveButton();
    }

    function clearUserForm() {
        document.getElementById("newUserName").value = "";
        document.getElementById("newUserUsername").value = "";
        document.getElementById("newUserEmail").value = "";
        document.getElementById("newUserContact").value = "";
        document.getElementById("newUserRole").value = "employee";
    }

    saveUserBtn?.addEventListener("click", async () => {
        const name = document.getElementById("newUserName");
        const username = document.getElementById("newUserUsername");
        const email = document.getElementById("newUserEmail");
        const contact = document.getElementById("newUserContact");
        const role = document.getElementById("newUserRole");

        const contactNumber = contact.value.trim();

        if (
            !name.value.trim() ||
            !username.value.trim() ||
            !email.value.trim()
        ) {
            showAlert(
                "Please fill in all required fields.",
                "warning"
            );
            return;
        }

        if (
            contactNumber &&
            !/^09\d{9}$/.test(contactNumber)
        ) {
            showAlert(
                "Contact number must be 11 digits and start with 09.",
                "warning"
            );
            return;
        }

        if (
            ![
                "employee",
                "business_admin",
                "sys_admin"
            ].includes(role.value)
        ) {
            showAlert("Invalid account role.", "warning");
            return;
        }

        saveUserBtn.disabled = true;
        saveUserBtn.textContent =
            editingUserId ? "Saving..." : "Creating...";

        if (editingUserId) {
            await updateUser({
                id: editingUserId,
                full_name: name.value.trim(),
                email: email.value.trim(),
                contact_number: contactNumber || null,
                role: role.value
            });

            return;
        }

        const { data: sessionData } =
            await supabase.auth.getSession();

        const session = sessionData?.session;

        if (!session) {
            showAlert(
                "Your session has expired.",
                "error"
            );

            resetSaveButton();
            return;
        }

        const { data, error } =
            await supabase.functions.invoke(
                "create-staff-account",
                {
                    body: {
                        full_name: name.value.trim(),
                        username: username.value.trim(),
                        email: email.value.trim(),
                        contact_number: contactNumber || null,
                        role: role.value
                    },
                    headers: {
                        Authorization:
                            `Bearer ${session.access_token}`
                    }
                }
            );

        if (error) {
            console.error("Create account error:", error);

            showAlert(
                error.message || "Failed to create account.",
                "error"
            );

            resetSaveButton();
            return;
        }

        if (data?.error) {
            console.error(
                "Create account response:",
                data
            );

            showAlert(data.error, "error");

            resetSaveButton();
            return;
        }

        await saveLog(
            "SETTINGS",
            `Created ${getRoleLabel(role.value)} account for ${name.value.trim()}.`,
            username.value.trim(),
            "info"
        );

        closeUserModal();

        showAlert(
            "Account created successfully.",
            "success"
        );

        loadStaffAccounts();
    });

    async function updateUser(user) {
        const { data: oldUser, error: fetchError } =
            await supabase
                .from("profiles")
                .select(`
                    full_name,
                    email,
                    contact_number,
                    role,
                    username
                `)
                .eq("id", user.id)
                .single();

        if (fetchError || !oldUser) {
            console.error(fetchError);

            showAlert(
                "Failed to load current account information.",
                "error"
            );

            resetSaveButton();
            return;
        }

        const { error } = await supabase
            .from("profiles")
            .update({
                full_name: user.full_name,
                email: user.email,
                contact_number: user.contact_number,
                role: user.role
            })
            .eq("id", user.id);

        if (error) {
            console.error(error);

            showAlert(
                "Failed to update account: " +
                error.message,
                "error"
            );

            resetSaveButton();
            return;
        }

        const changes = [];

        if (oldUser.full_name !== user.full_name) {
            changes.push("name");
        }

        if (oldUser.email !== user.email) {
            changes.push("email");
        }

        if (
            (oldUser.contact_number || "") !==
            (user.contact_number || "")
        ) {
            changes.push("contact number");
        }

        if (oldUser.role !== user.role) {
            changes.push("role");
        }

        if (changes.length) {
            await saveLog(
                "SETTINGS",
                `Updated ${changes.join(", ")} for ${user.full_name}.`,
                oldUser.username || user.email,
                "info"
            );
        }

        closeUserModal();

        showAlert(
            "Account updated successfully.",
            "success"
        );

        loadStaffAccounts();
    }

    userTableBody?.addEventListener("click", async e => {
        const editBtn =
            e.target.closest(".edit-user-btn");

        if (editBtn) {
            await openEditModal(editBtn.dataset.id);
            return;
        }

        const lockBtn =
            e.target.closest(".lock-user-btn");

        if (lockBtn) {
            const isLocked =
                lockBtn.dataset.locked === "true";

            const name =
                lockBtn.dataset.name;

            if (isLocked) {
                const confirmed = await showConfirm(
                    "Unlock Account",
                    `Are you sure you want to unlock ${name}'s account?`,
                    "unlock"
                );

                if (!confirmed) return;

                await unlockAccount(
                    lockBtn.dataset.id,
                    name
                );
            } else {
                const confirmed = await showConfirm(
                    "Lock Account",
                    `Are you sure you want to lock ${name}'s account?`,
                    "lock"
                );

                if (!confirmed) return;

                await lockAccount(
                    lockBtn.dataset.id,
                    name
                );
            }

            return;
        }

        const deleteBtn =
            e.target.closest(".delete-user-btn");

        if (deleteBtn) {
            const confirmed = await showConfirm(
                "Delete Account",
                `Are you sure you want to delete ${deleteBtn.dataset.name}'s account?`,
                "delete"
            );

            if (!confirmed) return;

            await deleteAccount(
                deleteBtn.dataset.id,
                deleteBtn.dataset.name
            );
        }
    });

    async function lockAccount(userId, name) {
        const { error } =
            await supabase.rpc(
                "lock_user_account",
                {
                    p_user_id: userId
                }
            );

        if (error) {
            console.error(error);

            showAlert(
                "Failed to lock account.",
                "error"
            );

            return;
        }

        await saveLog(
            "SETTINGS",
            `Locked account for ${name}.`,
            name,
            "warning"
        );

        showAlert(
            "Account locked successfully.",
            "success"
        );

        loadStaffAccounts();
    }

    async function unlockAccount(userId, name) {
        const { error } =
            await supabase.rpc(
                "unlock_user_account",
                {
                    p_user_id: userId
                }
            );

        if (error) {
            console.error(error);

            showAlert(
                "Failed to unlock account.",
                "error"
            );

            return;
        }

        await saveLog(
            "SETTINGS",
            `Unlocked account for ${name}.`,
            name,
            "info"
        );

        showAlert(
            "Account unlocked successfully.",
            "success"
        );

        loadStaffAccounts();
    }

    async function deleteAccount(userId, name) {
        const { data: sessionData } =
            await supabase.auth.getSession();

        const session =
            sessionData?.session;

        if (!session) {
            showAlert(
                "Your session has expired.",
                "error"
            );

            return;
        }

        const { data, error } =
            await supabase.functions.invoke(
                "remove-staff-account",
                {
                    body: {
                        userId
                    },
                    headers: {
                        Authorization:
                            `Bearer ${session.access_token}`
                    }
                }
            );

        if (error || data?.error) {
            console.error(
                error || data?.error
            );

            showAlert(
                data?.error ||
                `Failed to delete ${name}'s account.`,
                "error"
            );

            return;
        }

        await saveLog(
            "SETTINGS",
            `Deleted staff account for ${name}.`,
            name,
            "warning"
        );

        showAlert(
            "Account deleted successfully.",
            "success"
        );

        loadStaffAccounts();
    }

    function showConfirm(
        title,
        message,
        type = "default"
    ) {
        return new Promise(resolve => {
            confirmTitle.textContent = title;
            confirmMessage.textContent = message;

            const icons = {
                lock: "bx-lock-alt",
                unlock: "bx-lock-open",
                delete: "bx-trash",
                default: "bx-question-mark"
            };

            confirmIcon.className =
                `bx ${icons[type] || icons.default}`;

            confirmModal.classList.add("show");

            confirmOkBtn.onclick = () => {
                confirmModal.classList.remove("show");
                resolve(true);
            };

            confirmCancelBtn.onclick = () => {
                confirmModal.classList.remove("show");
                resolve(false);
            };
        });
    }

    async function loadPricing() {
        const courtInput =
            document.getElementById("court-rate");

        const homeownerInput =
            document.getElementById("homeowner-rate");

        if (!courtInput || !homeownerInput) return;

        const { data, error } =
            await supabase
                .from("business_settings")
                .select("key, value")
                .in("key", [
                    "court_rate",
                    "homeowner_rate"
                ]);

        if (error) {
            console.error(
                "Failed to load pricing:",
                error
            );

            return;
        }

        (data || []).forEach(row => {
            if (row.key === "court_rate") {
                courtInput.value = row.value;
            }

            if (row.key === "homeowner_rate") {
                homeownerInput.value = row.value;
            }
        });
    }

    document
        .getElementById("savePricingBtn")
        ?.addEventListener("click", async () => {
            const btn =
                document.getElementById("savePricingBtn");

            const courtInput =
                document.getElementById("court-rate");

            const homeownerInput =
                document.getElementById("homeowner-rate");

            const courtRate =
                Number(courtInput.value);

            const homeownerRate =
                Number(homeownerInput.value);

            if (
                !Number.isFinite(courtRate) ||
                !Number.isFinite(homeownerRate) ||
                courtRate < 0 ||
                homeownerRate < 0
            ) {
                showAlert(
                    "Please enter valid pricing rates.",
                    "warning"
                );

                return;
            }

            const { data: currentPricing, error: fetchError } =
                await supabase
                    .from("business_settings")
                    .select("key, value")
                    .in("key", [
                        "court_rate",
                        "homeowner_rate"
                    ]);

            if (fetchError) {
                console.error(fetchError);

                showAlert(
                    "Failed to load current pricing.",
                    "error"
                );

                return;
            }

            const oldValues = {};

            (currentPricing || []).forEach(row => {
                oldValues[row.key] = Number(row.value);
            });

            const changes = [];

            if (
                oldValues.court_rate !== undefined &&
                oldValues.court_rate !== courtRate
            ) {
                changes.push(
                    `Court rate changed from ₱${oldValues.court_rate} to ₱${courtRate}.`
                );
            }

            if (
                oldValues.homeowner_rate !== undefined &&
                oldValues.homeowner_rate !== homeownerRate
            ) {
                changes.push(
                    `Homeowner rate changed from ₱${oldValues.homeowner_rate} to ₱${homeownerRate}.`
                );
            }

            if (!changes.length) {
                showAlert(
                    "No pricing changes were made.",
                    "info"
                );

                return;
            }

            btn.disabled = true;
            btn.textContent = "Saving...";

            const now =
                new Date().toISOString();

            const { error } =
                await supabase
                    .from("business_settings")
                    .upsert(
                        [
                            {
                                key: "court_rate",
                                value: String(courtRate),
                                updated_at: now
                            },
                            {
                                key: "homeowner_rate",
                                value: String(homeownerRate),
                                updated_at: now
                            }
                        ],
                        {
                            onConflict: "key"
                        }
                    );

            btn.disabled = false;
            btn.textContent = "Save Pricing";

            if (error) {
                console.error(error);

                showAlert(
                    "Failed to save pricing: " +
                    error.message,
                    "error"
                );

                return;
            }

            for (const change of changes) {
                await saveLog(
                    "SYSTEM",
                    change,
                    "System Admin",
                    "info"
                );
            }

            showAlert(
                "Pricing updated successfully.",
                "success"
            );
        });

    function resetSaveButton() {
        saveUserBtn.disabled = false;
        saveUserBtn.textContent =
            editingUserId
                ? "Save Changes"
                : "Create Account";
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    let currentUser = null;
    async function loadAccountInfo() {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError || !user) {
            showAlert("Failed to load account information.", "error");
            return;
        }

        currentUser = user;

        const { data, error } = await supabase
            .from("profiles")
            .select(`
                full_name,
                username,
                email,
                contact_number
            `)
            .eq("id", user.id)
            .maybeSingle();

        if (error) {
            console.error(error);
            showAlert("Failed to load account information.", "error");
            return;
        }

        if (!data) return;

        document.getElementById("account-full-name").value =
            data.full_name || "";

        document.getElementById("account-username").value =
            data.username || "";

        document.getElementById("account-email").value =
            data.email || user.email || "";

        document.getElementById("account-contact").value =
            data.contact_number || "";
    }

    loadAccountInfo();

    document
        .getElementById("saveAccountBtn")
        ?.addEventListener("click", async () => {

            if (!currentUser) {
                showAlert("Your session has expired.", "error");
                return;
            }

            const btn =
                document.getElementById("saveAccountBtn");

            const fullName =
                document.getElementById("account-full-name")
                    .value.trim();

            const username =
                document.getElementById("account-username")
                    .value.trim();

            const email =
                document.getElementById("account-email")
                    .value.trim();

            const contact =
                document.getElementById("account-contact")
                    .value.trim();

            if (!fullName || !username || !email) {
                showAlert(
                    "Please fill in all required fields.",
                    "warning"
                );
                return;
            }

            if (
                contact &&
                !/^09\d{9}$/.test(contact)
            ) {
                showAlert(
                    "Contact number must be 11 digits and start with 09.",
                    "warning"
                );
                return;
            }

            btn.disabled = true;
            btn.textContent = "Saving...";

            const { data: oldData, error: oldError } =
                await supabase
                    .from("profiles")
                    .select(`
                        full_name,
                        username,
                        email,
                        contact_number
                    `)
                    .eq("id", currentUser.id)
                    .maybeSingle();

            if (oldError) {
                console.error(oldError);
                showAlert(
                    "Failed to load current account information.",
                    "error"
                );

                btn.disabled = false;
                btn.textContent = "Save Changes";
                return;
            }

            const { error } = await supabase
                .from("profiles")
                .update({
                    full_name: fullName,
                    username: username,
                    email: email,
                    contact_number: contact || null
                })
                .eq("id", currentUser.id);

            if (error) {
                console.error(error);

                showAlert(
                    "Failed to update account: " +
                    error.message,
                    "error"
                );

                btn.disabled = false;
                btn.textContent = "Save Changes";
                return;
            }

            if (email !== currentUser.email) {
                const { error: emailError } =
                    await supabase.auth.updateUser({
                        email
                    });

                if (emailError) {
                    console.error(emailError);

                    showAlert(
                        "Profile updated, but email update failed.",
                        "warning"
                    );
                }
            }

            const changes = [];

            if (oldData?.full_name !== fullName) {
                changes.push("name");
            }

            if (oldData?.username !== username) {
                changes.push("username");
            }

            if (oldData?.email !== email) {
                changes.push("email");
            }

            if (
                (oldData?.contact_number || "") !==
                contact
            ) {
                changes.push("contact number");
            }

            if (changes.length) {
                await saveLog(
                    "SETTINGS",
                    `Updated own ${changes.join(", ")}.`,
                    username,
                    "info"
                );
            }

            btn.disabled = false;
            btn.textContent = "Save Changes";

            showAlert(
                "Account information updated successfully.",
                "success"
            );
        });

document
    .getElementById("updatePasswordBtn")
    ?.addEventListener("click", async () => {
        if (!currentUser) {
            showAlert("Your session has expired.", "error");
            return;
        }

        const btn = document.getElementById("updatePasswordBtn");
        const currentPassword = document
            .getElementById("current-password")
            .value;
        const newPassword = document
            .getElementById("new-password")
            .value;
        const confirmPassword = document
            .getElementById("confirm-password")
            .value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            showAlert(
                "Please fill in all password fields.",
                "warning"
            );
            return;
        }

        if (!STRONG_PASSWORD_REGEX.test(newPassword)) {
            showAlert(
                getPasswordRequirementMessage(),
                "warning"
            );
            return;
        }

        if (newPassword !== confirmPassword) {
            showAlert(
                "New passwords do not match.",
                "warning"
            );
            return;
        }

        if (currentPassword === newPassword) {
            showAlert(
                "New password must be different from your current password.",
                "warning"
            );
            return;
        }

        btn.disabled = true;
        btn.textContent = "Updating...";

        const { data: authData, error: authError } =
            await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: currentPassword
            });

        if (authError || !authData?.user) {
            console.error(authError);
            showAlert(
                "Current password is incorrect.",
                "error"
            );
            btn.disabled = false;
            btn.textContent = "Update Password";
            return;
        }

        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (error) {
            console.error(error);
            showAlert(
                "Failed to update password: " + error.message,
                "error"
            );
            btn.disabled = false;
            btn.textContent = "Update Password";
            return;
        }

        await saveLog(
            "SETTINGS",
            "Updated own account password.",
            currentUser.email,
            "warning"
        );

        document.getElementById("current-password").value = "";
        document.getElementById("new-password").value = "";
        document.getElementById("confirm-password").value = "";

        btn.disabled = false;
        btn.textContent = "Update Password";

        showAlert(
            "Password updated successfully.",
            "success"
        );
    });

    const accountContact = document.getElementById("account-contact"); accountContact?.addEventListener("input", () => { accountContact.value = accountContact.value .replace(/\D/g, "") .slice(0, 11); }); document.querySelectorAll(".password-toggle").forEach(button => { button.addEventListener("click", () => { const targetId = button.dataset.target; const input = document.getElementById(targetId); const icon = button.querySelector("i"); if (!input || !icon) return; if (input.type === "password") { input.type = "text"; icon.classList.remove("bx-hide"); icon.classList.add("bx-show"); } else { input.type = "password"; icon.classList.remove("bx-show"); icon.classList.add("bx-hide"); } }); });
});


function showAlert(message, type = "info") {
    document.getElementById("globalToast")?.remove();

    const colors = {
        success: "#16a34a",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6"
    };

    const alert = document.createElement("div");

    alert.id = "globalToast";
    alert.textContent = message;

    alert.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        max-width: 320px;
        padding: 12px 16px;
        color: #fff;
        background: ${colors[type] || colors.info};
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, .15);
        font-size: 14px;
        font-weight: 600;
    `;

    document.body.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 3500);
}