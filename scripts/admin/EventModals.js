function openModal() {
    document.getElementById("createModal").style.display = "flex";
}

function closeModal() {
    document.getElementById("createModal").style.display = "none";
}

// Tab Switching 
function openTab(evt, tabName) {
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.querySelectorAll(".tab-link").forEach(l => l.classList.remove("active"));
    document.getElementById(tabName).classList.add("active");
    evt.currentTarget.classList.add("active");
}

// Remove Tournament 
function openRemoveConfirm() {
    const modal = document.getElementById("confirmModal");
    document.getElementById("confirmTitle").textContent = "Remove Tournament?";
    document.getElementById("confirmMessage").textContent = "This will permanently delete the current bracket and scores. This action cannot be undone.";
    modal.style.display = "flex";
    
    document.getElementById("confirmBtn").onclick = () => {
        localStorage.removeItem("currentTournament");
        location.reload();
    };
}

function openFinishConfirm() {
    const modal = document.getElementById("confirmModal");
    document.getElementById("confirmTitle").textContent = "Finish Tournament?";
    document.getElementById("confirmMessage").textContent = "This will lock all scores and announce the official winner to the dashboard.";
    modal.style.display = "flex";

    document.getElementById("confirmBtn").onclick = () => {
        alert("Tournament Finished! Winner has been announced.");
        closeConfirm();
    };
}

function closeConfirm() {
    document.getElementById("confirmModal").style.display = "none";
}


window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        closeModal();
        closeConfirm();
    }
};