/* ------------------------------------------------------------------
   CONFIG - paste your deployed Apps Script Web App URL here.
   It looks like:
   https://script.google.com/macros/s/AKfycb..../exec
------------------------------------------------------------------- */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyrJcxY2lB5llWpVhVFfaiywkuBgjZUrQoD0Hmvw15fw8zx5A36_MJPhDrjCmgnBspQtA/exec';

/* ==================================================================
   TRANSPORT: JSONP
   ------------------------------------------------------------------
   Google Apps Script Web App responses do not include an
   Access-Control-Allow-Origin header, so a plain fetch() from a
   different domain (this PWA) gets blocked by the browser's CORS
   policy, even though the URL works fine when opened directly.
   Loading the response via a <script> tag instead of fetch() sidesteps
   CORS entirely (script tags aren't subject to it), as long as the
   server wraps its JSON in a callback function call. Code.gs already
   supports this via the `callback` parameter.
================================================================== */
let jsonpCounter = 0;

function jsonp(params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = '__attendance_cb_' + (jsonpCounter++) + '_' + Date.now();
    const qs = new URLSearchParams({ ...params, callback: callbackName });
    const script = document.createElement('script');

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Request timed out'));
    }, timeoutMs);

    window[callbackName] = (data) => {
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.src = `${SCRIPT_URL}?${qs.toString()}`;
    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Network error'));
    };

    document.head.appendChild(script);
  });
}

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
let staffPin = sessionStorage.getItem('attendance_staff_pin') || '';

function showEmployeeDashboard(show) {
  $('#staffLogin').classList.toggle('hidden', show);
  $('#employeeDashboard').classList.toggle('hidden', !show);
}

$('#staffPinSubmit').addEventListener('click', async () => {
  const pin = $('#staffPinInput').value.trim();
  if (!pin) return;
  $('#staffPinError').textContent = '';
  $('#staffPinSubmit').disabled = true;
  const ok = await loadPersonnel(pin);
  $('#staffPinSubmit').disabled = false;
  if (ok) {
    staffPin = pin;
    sessionStorage.setItem('attendance_staff_pin', pin);
    showEmployeeDashboard(true);
  } else {
    $('#staffPinError').textContent = 'Incorrect PIN. Try again.';
  }
});

$('#staffPinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#staffPinSubmit').click();
});

async function loadPersonnel(pin) {
  try {
    const data = await jsonp({ action: 'list', pin });
    if (!data.ok) {
      setConnected(true); // server reachable, just a bad/missing pin
      return false;
    }
    personnelSelect.innerHTML = '<option value="">— Select your name —</option>' +
      data.personnel.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    setConnected(true);
    return true;
  } catch (err) {
    setConnected(false);
    return false;
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
    const data = await jsonp({ action: 'punch', name, type, pin: staffPin });

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
    const data = await jsonp({ action: 'today', name, pin: staffPin });
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

/* Restore staff session automatically if PIN already unlocked this tab session */
async function tryRestoreStaffSession() {
  if (!staffPin) return;
  const ok = await loadPersonnel(staffPin);
  if (ok) showEmployeeDashboard(true);
  else { staffPin = ''; sessionStorage.removeItem('attendance_staff_pin'); }
}

/* ==================================================================
   ADMIN VIEW
================================================================== */
let adminPin = sessionStorage.getItem('attendance_admin_pin') || '';
let lastLoadedRecords = [];

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

$('#nameFilter').addEventListener('input', () => {
  const q = $('#nameFilter').value.trim().toLowerCase();
  $$('#adminTableBody tr').forEach(tr => {
    const name = (tr.dataset.name || '').toLowerCase();
    tr.style.display = !q || name.includes(q) ? '' : 'none';
  });
});

async function loadAdminDay(pin, date) {
  try {
    const data = await jsonp({ action: 'day', pin, date });
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
  lastLoadedRecords = records; // keep for "Export this day" without a second request

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
    const data = await jsonp({
      action: 'adminSave',
      pin: adminPin,
      date,
      name,
      editor: 'HR Admin',
      ...fields
    });

    if (data.ok) {
      btn.textContent = 'Saved ✓';
      btn.classList.add('saved');
      toast(`${name}'s record updated.`, 'ok');
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
   EXCEL / CSV EXPORT
   ------------------------------------------------------------------
   Excel opens CSV files natively, so a plain CSV (built entirely in
   the browser, no extra library) is the simplest reliable way to get
   attendance data into a spreadsheet someone can open in Excel.
================================================================== */
function toCsv(rows) {
  const header = ['Date', 'Name', 'Time In (AM)', 'Time Out (AM)', 'Time In (PM)', 'Time Out (PM)', 'Status', 'Last Edited By'];
  const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(csvEscape).join(',')];
  rows.forEach(r => {
    lines.push([
      r.date, r.name,
      formatDisplayTime(r.timeInAM), formatDisplayTime(r.timeOutAM),
      formatDisplayTime(r.timeInPM), formatDisplayTime(r.timeOutPM),
      r.status, r.editedBy || ''
    ].map(csvEscape).join(','));
  });
  return lines.join('\r\n');
}

function downloadCsv(filename, csvString) {
  // Prefix with a UTF-8 BOM so Excel renders special characters correctly
  const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('#exportDayBtn').addEventListener('click', () => {
  if (!lastLoadedRecords.length) {
    toast('Nothing loaded to export yet.', 'err');
    return;
  }
  const date = $('#dateInput').value || todayISO();
  downloadCsv(`attendance_${date}.csv`, toCsv(lastLoadedRecords));
});

$('#exportAllBtn').addEventListener('click', async () => {
  const btn = $('#exportAllBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Preparing…';
  try {
    const data = await jsonp({ action: 'exportAll', pin: adminPin });
    if (data.ok) {
      downloadCsv(`attendance_full_history_${todayISO()}.csv`, toCsv(data.records));
      toast('Full history exported.', 'ok');
    } else {
      toast(data.error || 'Could not export.', 'err');
    }
  } catch (err) {
    toast('Network error — could not export.', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

/* Lightweight reachability check, independent of any PIN, so the
   connection indicator in the footer works even before someone logs in */
async function checkConnection() {
  try {
    await jsonp({ action: 'list', pin: '__probe__' }); // any response (even "Invalid PIN") proves the server is reachable
    setConnected(true);
  } catch (e) {
    setConnected(false);
  }
}

/* ==================================================================
   INIT
================================================================== */
$('#dateInput').value = todayISO();
checkConnection();
tryRestoreStaffSession();
tryRestoreAdminSession();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
