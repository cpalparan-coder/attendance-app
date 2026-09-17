/* ------------------------------------------------------------------
   CONFIG - paste your deployed Apps Script Web App URL here.
   It looks like:
   https://script.google.com/macros/s/AKfycb..../exec
------------------------------------------------------------------- */
const SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

/* ==================================================================
   SHARED HELPERS
================================================================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function formatDisplayTime(hhmm) {
  if (!hhmm) return '-';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

let toastTimer;
function toast(msg, kind) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function setConnected(ok) {
  $('#connDot').classList.toggle('online', ok);
  $('#connLabel').textContent = ok ? 'Connected' : 'Offline / cannot reach server';
}

/* ==================================================================
   CLOCK + DATE
================================================================== */
function tick() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#dateLabel').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
setInterval(tick, 1000);
tick();

/* ==================================================================
   TAB SWITCHING
================================================================== */
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + tab.dataset.tab).classList.add('active');
  });
});

/* ==================================================================
   EMPLOYEE VIEW
================================================================== */
const personnelSelect = $('#personnel');

async function loadPersonnel() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=list`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    personnelSelect.innerHTML = '<option value="">— Select your name —</option>' +
      data.personnel.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    setConnected(true);
  } catch (err) {
    personnelSelect.innerHTML = '<option value="">Could not load list</option>';
    setConnected(false);
  }
}

async function punch(type) {
  const name = personnelSelect.value;
  if (!name) {
    showEmployeeStatus('Please select your name first.', false);
    return;
  }

  $$('.punch-btn').forEach(b => b.disabled = true);
  showEmployeeStatus('Recording…', null);

  try {
    const qs = new URLSearchParams({ action: 'punch', name, type });
    const res = await fetch(`${SCRIPT_URL}?${qs.toString()}`);
    const data = await res.json();

    if (data.ok) {
      showEmployeeStatus(data.message, true);
      toast(data.message, 'ok');
      refreshTodaySummary(name);
    } else {
      showEmployeeStatus(data.error, false);
      toast(data.error, 'err');
    }
  } catch (err) {
    showEmployeeStatus('Network error — check your connection.', false);
  } finally {
    $$('.punch-btn').forEach(b => b.disabled = false);
  }
}

function showEmployeeStatus(msg, ok) {
  const el = $('#status');
  el.textContent = msg;
  el.className = 'status-msg' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}

async function refreshTodaySummary(name) {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=today&name=${encodeURIComponent(name)}`);
    const data = await res.json();
    const box = $('#todaySummary');
    if (data.ok && data.record) {
      const r = data.record;
      box.innerHTML = `
        <div class="row"><span>Time In (AM)</span><span>${formatDisplayTime(r.timeInAM)}</span></div>
        <div class="row"><span>Time Out (AM)</span><span>${formatDisplayTime(r.timeOutAM)}</span></div>
        <div class="row"><span>Time In (PM)</span><span>${formatDisplayTime(r.timeInPM)}</span></div>
        <div class="row"><span>Time Out (PM)</span><span>${formatDisplayTime(r.timeOutPM)}</span></div>
        <div class="row"><span>Status</span><span>${r.status || '-'}</span></div>
      `;
    } else {
      box.innerHTML = '';
    }
  } catch (e) { /* non critical */ }
}

$$('.punch-btn').forEach(btn => btn.addEventListener('click', () => punch(btn.dataset.type)));

personnelSelect.addEventListener('change', () => {
  if (personnelSelect.value) refreshTodaySummary(personnelSelect.value);
  else $('#todaySummary').innerHTML = '';
});

/* ==================================================================
   ADMIN VIEW
================================================================== */
let adminPin = sessionStorage.getItem('attendance_admin_pin') || '';

function showAdminDashboard(show) {
  $('#adminLogin').classList.toggle('hidden', show);
  $('#adminDashboard').classList.toggle('hidden', !show);
}

$('#pinSubmit').addEventListener('click', async () => {
  const pin = $('#pinInput').value.trim();
  if (!pin) return;
  $('#pinError').textContent = '';
  const ok = await loadAdminDay(pin, $('#dateInput').value || todayISO());
  if (ok) {
    adminPin = pin;
    sessionStorage.setItem('attendance_admin_pin', pin);
    showAdminDashboard(true);
  } else {
    $('#pinError').textContent = 'Incorrect PIN. Try again.';
  }
});

$('#pinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#pinSubmit').click();
});

$('#lockBtn').addEventListener('click', () => {
  adminPin = '';
  sessionStorage.removeItem('attendance_admin_pin');
  $('#pinInput').value = '';
  showAdminDashboard(false);
});

$('#dateInput').addEventListener('change', () => {
  if (adminPin) loadAdminDay(adminPin, $('#dateInput').value);
});

async function loadAdminDay(pin, date) {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=day&pin=${encodeURIComponent(pin)}&date=${encodeURIComponent(date)}`);
    const data = await res.json();
    if (!data.ok) return false;
    renderAdminTable(data.records, date);
    return true;
  } catch (err) {
    toast('Could not reach server.', 'err');
    return false;
  }
}

function renderAdminTable(records, date) {
  $('#dateInput').value = date;

  let complete = 0, incomplete = 0, absent = 0;
  records.forEach(r => {
    if (r.status === 'Complete') complete++;
    else if (r.status === 'Incomplete') incomplete++;
    else absent++;
  });

  $('#adminStats').innerHTML = `
    <span class="pill green">${complete} complete</span>
    <span class="pill amber">${incomplete} incomplete</span>
    <span class="pill red">${absent} absent</span>
  `;

  const tbody = $('#adminTableBody');
  tbody.innerHTML = records.map((r, i) => `
    <tr data-name="${escapeHtml(r.name)}">
      <td class="name-cell">${escapeHtml(r.name)}</td>
      <td><input type="time" data-field="timeInAM" value="${r.timeInAM || ''}"></td>
      <td><input type="time" data-field="timeOutAM" value="${r.timeOutAM || ''}"></td>
      <td><input type="time" data-field="timeInPM" value="${r.timeInPM || ''}"></td>
      <td><input type="time" data-field="timeOutPM" value="${r.timeOutPM || ''}"></td>
      <td><span class="status-badge ${r.status}">${r.status}</span></td>
      <td><button class="row-save-btn" data-idx="${i}">Save</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.row-save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveAdminRow(btn));
  });
}

async function saveAdminRow(btn) {
  const tr = btn.closest('tr');
  const name = tr.dataset.name;
  const date = $('#dateInput').value;
  const fields = {};
  tr.querySelectorAll('input[data-field]').forEach(inp => {
    fields[inp.dataset.field] = inp.value; // '' clears that punch
  });

  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    const qs = new URLSearchParams({
      action: 'adminSave',
      pin: adminPin,
      date,
      name,
      editor: 'HR Admin',
      ...fields
    });
    const res = await fetch(`${SCRIPT_URL}?${qs.toString()}`);
    const data = await res.json();

    if (data.ok) {
      btn.textContent = 'Saved ✓';
      btn.classList.add('saved');
      toast(`${name}'s record updated.`, 'ok');
      // update the status badge in place
      if (data.record) {
        const badge = tr.querySelector('.status-badge');
        badge.className = 'status-badge ' + data.record.status;
        badge.textContent = data.record.status;
      }
      setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('saved'); }, 1800);
    } else {
      btn.textContent = 'Save';
      toast(data.error || 'Could not save.', 'err');
    }
  } catch (err) {
    btn.textContent = 'Save';
    toast('Network error — could not save.', 'err');
  } finally {
    btn.disabled = false;
  }
}

/* Restore admin session automatically if PIN already unlocked this tab session */
async function tryRestoreAdminSession() {
  if (!adminPin) return;
  $('#dateInput').value = todayISO();
  const ok = await loadAdminDay(adminPin, todayISO());
  if (ok) showAdminDashboard(true);
  else { adminPin = ''; sessionStorage.removeItem('attendance_admin_pin'); }
}

/* ==================================================================
   INIT
================================================================== */
$('#dateInput').value = todayISO();
loadPersonnel();
tryRestoreAdminSession();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
