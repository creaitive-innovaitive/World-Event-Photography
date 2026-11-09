const { supabaseUrl, supabaseKey } = window.WEP;
const db = supabase.createClient(supabaseUrl, supabaseKey);
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let enquiries = [], blocked = new Set(), filter = 'all';

// Password sign-in. Passwords can only be set from a session that came in via an emailed link (so the email is proven),
// and sign-up is not offered, so nobody can claim someone else's email.
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#email').value.trim(), pw = $('#pw').value;
  if (!pw) return sendLink(email);
  $('#loginMsg').textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email, password: pw });
  $('#loginMsg').textContent = error ? 'Sign-in failed: ' + (error.message === 'Invalid login credentials' ? 'wrong email or password. First time, or forgotten it? Use the email link, then set a password.' : error.message) : '';
});
$('#linkBtn').onclick = () => { const em = $('#email'); em.reportValidity() && sendLink(em.value.trim()); };
async function sendLink(email) {
  const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  $('#loginMsg').textContent = error ? 'Could not send link: ' + error.message : 'Check your email for the sign-in link.';
}
$('#pwBtn').onclick = () => { $('#pwNew').value = ''; $('#pwErr').textContent = ''; $('#pwUser').value = $('#who').textContent; $('#pwDlg').showModal(); };
$('#pwCancel').onclick = () => $('#pwDlg').close();
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { error } = await db.auth.updateUser({ password: $('#pwNew').value });
  if (error) return $('#pwErr').textContent = error.message;
  $('#pwDlg').close(); alert('Password saved. You can now sign in with your email and password.');
});
$('#out').onclick = async () => { await db.auth.signOut(); location.reload(); };

async function start() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return;
  const { data: ok, error } = await db.rpc('wep_is_admin');
  if (!ok) {
    await db.auth.signOut();
    $('#loginMsg').textContent = error ? 'Admin check failed: ' + error.message + ' (has supabase/schema.sql been run?)' : `${session.user.email} is not in the wep_admins table.`;
    return;
  }
  $('#login').hidden = true; $('#app').hidden = false; $('#who').textContent = session.user.email;
  await Promise.all([loadEnquiries(), loadBlocked()]);
}
db.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN' && $('#app').hidden) start(); });
start();

$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  const t = b.dataset.tab;
  $('#enq').hidden = t !== 'enq'; $('#up').hidden = t !== 'up'; $('#blk').hidden = t !== 'blk'; $('#crm').hidden = !t.startsWith('crm:');
  if (t === 'up') openUpcoming();
  if (t.startsWith('crm:')) openEntity(t.slice(4));
});
$$('#enq .filters button').forEach(b => b.onclick = () => {
  filter = b.dataset.f; $$('#enq .filters button').forEach(x => x.classList.toggle('on', x === b)); renderEnq();
});

async function loadEnquiries() {
  const { data, error } = await db.from('enquiries').select('*').order('created_at', { ascending: false });
  if (error) { $('#list').textContent = error.message; return; }
  enquiries = data; renderEnq();
}
function renderEnq() {
  const rows = enquiries.filter(e => filter === 'all' || e.status === filter);
  $('#list').innerHTML = rows.length ? rows.map(e => `
    <article class="enq">
      <div class="enq-top"><b>${esc(e.name)}</b><span class="tag ${e.status}">${e.status}</span></div>
      <div class="meta">${esc(e.type || '')} · ${e.event_date ? new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'no date'} · ${esc(e.location || 'no location')}<br>${esc(e.email)} · received ${new Date(e.created_at).toLocaleString('en-GB')}</div>
      ${e.message ? `<p>${esc(e.message)}</p>` : ''}
      <div class="row-actions">
        <button data-id="${e.id}" data-s="confirmed">Confirm</button><button data-id="${e.id}" data-s="declined">Decline</button><button data-id="${e.id}" data-s="new">Reset</button>
        <a href="mailto:${esc(e.email)}?subject=Your%20photography%20enquiry">Reply</a>
        ${e.status !== 'converted' ? `<button data-cust="${e.id}">Convert to customer</button>` : ''}
        <button data-del="${e.id}">Delete</button>
      </div>
    </article>`).join('') : '<p class="hint">Nothing here yet.</p>';
}
// Confirmed enquiries auto-block their date (note = 'enquiry'). Manual blocks have no note
// and are never freed by an enquiry changing.
async function syncDate(date) {
  if (!date) return;
  const { data } = await db.from('enquiries').select('id').eq('event_date', date).in('status', ['confirmed', 'converted']).limit(1);
  if (data && data.length) await db.from('blocked_dates').upsert({ event_date: date, note: 'enquiry' }, { onConflict: 'event_date', ignoreDuplicates: true });
  else await db.from('blocked_dates').delete().eq('event_date', date).eq('note', 'enquiry');
}
$('#list').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.id || b.dataset.del || b.dataset.cust, row = enquiries.find(x => x.id === id);
  if (b.dataset.cust) return convertEnquiry(row, b);
  if (b.dataset.s) await db.from('enquiries').update({ status: b.dataset.s }).eq('id', id);
  else if (b.dataset.del) { if (!confirm('Delete this enquiry permanently?')) return; await db.from('enquiries').delete().eq('id', id); }
  else return;
  await syncDate(row && row.event_date);
  await loadBlocked(); loadEnquiries();
});

async function loadBlocked() {
  const { data } = await db.from('blocked_dates').select('event_date').order('event_date');
  blocked = new Set((data || []).map(r => r.event_date)); renderBlocked(); if (enquiries.length) renderEnq();
}
function renderBlocked() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let h = '';
  for (let m = 0; m < 12; m++) {
    const v = new Date(today.getFullYear(), today.getMonth() + m, 1), first = (v.getDay() + 6) % 7, n = new Date(v.getFullYear(), v.getMonth() + 1, 0).getDate();
    h += `<div class="am"><h4>${v.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h4><div class="ag">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}${'<i></i>'.repeat(first)}`;
    for (let d = 1; d <= n; d++) {
      const dt = new Date(v.getFullYear(), v.getMonth(), d), k = iso(dt);
      h += `<button data-d="${k}" class="${blocked.has(k) ? 'blk' : ''}" ${dt < today ? 'disabled' : ''}>${d}</button>`;
    }
    h += '</div></div>';
  }
  $('#acal').innerHTML = h;
  $('#blocked').innerHTML = [...blocked].sort().map(k => `<li><span>${new Date(k).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span></li>`).join('') || '<li class="hint">None blocked.</li>';
}
$('#acal').addEventListener('click', async e => {
  const b = e.target.closest('button[data-d]'); if (!b || b.disabled) return;
  const k = b.dataset.d;
  const r = blocked.has(k) ? await db.from('blocked_dates').delete().eq('event_date', k) : await db.from('blocked_dates').upsert({ event_date: k });
  if (r.error) return alert(r.error.message);
  loadBlocked();
});
