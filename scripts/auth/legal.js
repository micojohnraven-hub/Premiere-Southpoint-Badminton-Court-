document.addEventListener("DOMContentLoaded", () => {
    const agreeCheckbox = document.getElementById('agreeTerms');
    const googleBtn = document.getElementById('googleLoginBtn');
    const termsWrapper = document.getElementById('termsWrapperLogin');
    const roleRadios = document.querySelectorAll('input[name="role"]');
    const registerLink = document.getElementById("registerLink");

    function syncGoogleBtn() {
        const isAgreed = agreeCheckbox ? agreeCheckbox.checked : false;

        if (registerLink) {
            registerLink.style.display = "block";
        }

        if (googleBtn) {
            if (isAgreed) {
                googleBtn.disabled = false;
                googleBtn.classList.remove('disabled');
                googleBtn.setAttribute("aria-disabled", "false");
            } else {
                googleBtn.disabled = true;
                googleBtn.classList.add('disabled');
                googleBtn.setAttribute("aria-disabled", "true");
            }
        }
    }

    if (agreeCheckbox) {
        agreeCheckbox.addEventListener('change', syncGoogleBtn);
        syncGoogleBtn();
    }

    roleRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selectedRole = document.querySelector('input[name="role"]:checked')?.value;
            const showTerms = selectedRole === 'player';
            if (termsWrapper) {
                termsWrapper.style.display = showTerms ? 'block' : 'none';
            }
            if (!showTerms && agreeCheckbox) {
                agreeCheckbox.checked = false;
                syncGoogleBtn();
            }
        });
    });

    if (googleBtn && termsWrapper) {
        googleBtn.addEventListener('click', (e) => {
            if (agreeCheckbox && !agreeCheckbox.checked) {
                e.preventDefault();
                termsWrapper.classList.add('shake');
                setTimeout(() => termsWrapper.classList.remove('shake'), 450);
            }
        });
    }
});