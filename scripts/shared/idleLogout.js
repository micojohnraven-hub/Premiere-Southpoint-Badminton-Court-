const KEY = 'sp_last_activity';
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export function initIdleLogout(supabase, {
  timeoutMs = 15 * 60 * 1000,   // 15 min idle 
  warnMs = 60 * 1000,           // warning 1 min 
  redirectTo = '/login.html'   
} = {}) {
  let timer = null;
  let warnEl = null;
  let lastTouch = 0;
  let loggingOut = false;

  const getLast = () => Number(localStorage.getItem(KEY)) || Date.now();

  function touch(force = false) {
    const now = Date.now();
    if (!force && now - lastTouch < 1000) return; 
    lastTouch = now;
    localStorage.setItem(KEY, String(now)); 
    hideWarning();
  }

  function showWarning(secondsLeft) {
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999;';
      warnEl.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:24px 28px;max-width:360px;text-align:center;font-family:sans-serif;">
          <h3 style="margin:0 0 8px;color:#14532d;">Are you still there?</h3>
          <p style="margin:0 0 16px;color:#333;">You will be logged out in <b id="spIdleCount"></b>s due to inactivity.</p>
          <button id="spIdleStay" style="background:linear-gradient(135deg,#166534,#22c55e);color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer;">Stay logged in</button>
        </div>`;
      document.body.appendChild(warnEl);
      warnEl.querySelector('#spIdleStay').addEventListener('click', () => touch(true));
    }
    warnEl.querySelector('#spIdleCount').textContent = secondsLeft;
  }

  function hideWarning() {
    if (warnEl) { warnEl.remove(); warnEl = null; }
  }

  async function logout() {
    if (loggingOut) return;
    loggingOut = true;
    clearInterval(timer);
    hideWarning();
    try { await supabase.auth.signOut(); } catch (e) { console.error('signOut error:', e); }
    localStorage.removeItem(KEY);
    window.location.replace(redirectTo);
  }

  function check() {
    const idle = Date.now() - getLast();
    if (idle >= timeoutMs) return logout();
    if (idle >= timeoutMs - warnMs) {
      showWarning(Math.ceil((timeoutMs - idle) / 1000));
    }
  }

  async function start() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // walang naka-login, skip

    // Kung matagal nang inactive (hal. sinara ang browser), logout agad
    const stored = Number(localStorage.getItem(KEY));
    if (stored && Date.now() - stored >= timeoutMs) {
      return logout();
    }

    touch(true);
    EVENTS.forEach(e => window.addEventListener(e, () => touch(), { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check(); // background tabs kasi throttled ang timers
    });
    timer = setInterval(check, 1000);
  }

  start();
  return { stop: () => clearInterval(timer), logout };
}