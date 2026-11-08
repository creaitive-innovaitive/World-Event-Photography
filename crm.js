// Customer database panel. Data lives in Supabase (see supabase/customers.sql); money is stored in pence.
const D = { customers: [], events: [], services: [], orders: [], customer_orders: [], payments: [], order_items: [], order_requests: [], feedback: [], photos: [], photo_picks: [] };
let cur = null, loaded = false, editing = null, portalReady = true;

const gbp = p => '£' + ((p || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const byId = (list, id) => D[list].find(r => r.id === id);
const orderCustomers = oid => D.customer_orders.filter(l => l.order_id === oid).sort(a => a.role === 'primary' ? -1 : 1).map(l => byId('customers', l.customer_id)).filter(Boolean);
const paid = oid => D.payments.filter(p => p.order_id === oid).reduce((s, p) => s + p.amount_pence, 0);
const tag = s => `<span class="tag ${['booked','completed','delivered','paid','converted'].includes(s) ? 'confirmed' : s === 'cancelled' ? 'declined' : ''}">${esc(s)}</span>`;
const payState = o => { const p = paid(o.id); return o.status === 'cancelled' ? '' : o.total_pence > 0 && p >= o.total_pence ? 'paid' : p > 0 ? 'part paid' : 'unpaid'; };
const orderLabel = o => `${o.order_ref} · ${orderCustomers(o.id).map(c => c.name).join(', ') || 'no customer'}`;

const ENT = {
  customers: {
    title: 'Customer', order: ['created_at', false],
    fields: [
      { k: 'name', l: 'Name', req: 1 }, { k: 'email', l: 'Email', t: 'email' }, { k: 'phone', l: 'Phone' }, { k: 'company', l: 'Company' },
      { k: 'address', l: 'Address', t: 'textarea' }, { k: 'source', l: 'Source', t: 'select', opts: ['website', 'referral', 'repeat', 'social', 'other'] },
      { k: 'marketing_ok', l: 'OK to send marketing emails', t: 'check' }, { k: 'notes', l: 'Notes', t: 'textarea' }],
    cols: [['Name', c => `<b>${esc(c.name)}</b>${c.company ? `<div class="sub">${esc(c.company)}</div>` : ''}`],
      ['Contact', c => `${esc(c.email || '')}<div class="sub">${esc(c.phone || '')}</div>`],
      ['Orders', c => D.customer_orders.filter(l => l.customer_id === c.id).length, 'num'],
      ['Next event', c => { const e = nextEvent(c); return e ? `${fdate(e.event_date)}<div class="sub">${esc(e.title)}</div>` : ''; }],
      ['Spent', c => gbp(D.customer_orders.filter(l => l.customer_id === c.id && l.role === 'primary').reduce((s, l) => s + paid(l.order_id), 0)), 'num']],
    text: c => [c.name, c.email, c.phone, c.company, c.notes].join(' '),
    stats: rows => [['Customers', rows.length], ['Repeat', rows.filter(c => D.customer_orders.filter(l => l.customer_id === c.id).length > 1).length]],
  },
  orders: {
    title: 'Order', order: ['created_at', false],
    fields: [
      { k: 'customers', l: 'Customers (first is primary; ctrl/cmd-click for more)', t: 'multi', ref: 'customers', lab: c => c.name + (c.email ? ` <${c.email}>` : ''), virtual: 1 },
      { k: 'event_id', l: 'Event (every order belongs to one event)', req: 1, t: 'select', ref: 'events', lab: e => `${e.title}${e.event_date ? ' · ' + fdate(e.event_date) : ''}` },
      { k: 'service_id', l: 'Service', t: 'select', ref: 'services', lab: s => `${s.name} (${gbp(s.price_pence)})` },
      { k: 'status', l: 'Status', t: 'select', opts: ['quote', 'booked', 'completed', 'cancelled'] },
      { k: 'total_pence', l: 'Total (£)', t: 'money' }, { k: 'notes', l: 'Notes', t: 'textarea' }],
    cols: [['Order', o => `<b>${esc(o.order_ref)}</b><div class="sub">${fdate(o.created_at)}</div>`],
      ['Customers', o => esc(orderCustomers(o.id).map(c => c.name).join(', '))],
      ['Event', o => { const e = byId('events', o.event_id); return e ? `${esc(e.title)}<div class="sub">${fdate(e.event_date)}</div>` : ''; }],
      ['Status', o => tag(o.status)], ['Total', o => gbp(o.total_pence), 'num'],
      ['Payment', o => tag(payState(o))], ['Paid', o => gbp(paid(o.id)), 'num'], ['Balance', o => gbp(o.total_pence - paid(o.id)), 'num']],
    text: o => [o.order_ref, o.notes, orderCustomers(o.id).map(c => c.name + (c.email || '')).join(' '), (byId('events', o.event_id) || {}).title].join(' '),
    stats: rows => { const live = rows.filter(o => o.status !== 'cancelled'); return [['Orders', rows.length], ['Booked value', gbp(live.reduce((s, o) => s + o.total_pence, 0))], ['Received', gbp(live.reduce((s, o) => s + paid(o.id), 0))], ['Outstanding', gbp(live.filter(o => o.status !== 'quote').reduce((s, o) => s + o.total_pence - paid(o.id), 0))]]; },
  },
  events: {
    title: 'Event', order: ['event_date', false],
    fields: [{ k: 'title', l: 'Title', req: 1 }, { k: 'event_type', l: 'Type', t: 'select', opts: ['wedding', 'corporate', 'portrait', 'family', 'party', 'other'] },
      { k: 'event_date', l: 'Date (first day)', t: 'date' }, { k: 'end_date', l: 'Last day (multi-day events only)', t: 'date' }, { k: 'start_time', l: 'Start', t: 'time' }, { k: 'end_time', l: 'End', t: 'time' }, { k: 'location', l: 'Location' },
      { k: 'status', l: 'Status', t: 'select', opts: ['scheduled', 'shot', 'delivered', 'cancelled'] }, { k: 'proofs_published', l: 'Proofs visible to customers in their portal', t: 'check' }, { k: 'notes', l: 'Notes', t: 'textarea' }],
    cols: [['Event', e => `<b>${esc(e.title)}</b><div class="sub">${esc(e.event_type || '')}</div>`],
      ['Date', e => `${fdate(e.event_date)}${e.end_date ? ' – ' + fdate(e.end_date) : ''}<div class="sub">${esc((e.start_time || '').slice(0, 5))}${e.end_time ? '–' + e.end_time.slice(0, 5) : ''}</div>`],
      ['Location', e => esc(e.location || '')], ['Status', e => tag(e.status)],
      ['Customers', e => esc(D.orders.filter(o => o.event_id === e.id).flatMap(o => orderCustomers(o.id)).map(c => c.name).join(', '))]],
    text: e => [e.title, e.location, e.event_type, e.notes].join(' '),
    stats: rows => { const t = iso(new Date()); return [['Events', rows.length], ['Upcoming', rows.filter(e => e.event_date >= t && e.status === 'scheduled').length]]; },
  },
  payments: {
    title: 'Payment', order: ['paid_on', false],
    fields: [{ k: 'order_id', l: 'Order', t: 'select', ref: 'orders', lab: orderLabel, req: 1 }, { k: 'amount_pence', l: 'Amount (£, negative for refund)', t: 'money', req: 1 },
      { k: 'method', l: 'Method', t: 'select', opts: ['card', 'bank transfer', 'cash', 'other'] }, { k: 'paid_on', l: 'Date', t: 'date', req: 1 }, { k: 'note', l: 'Note' }],
    cols: [['Date', p => fdate(p.paid_on)], ['Order', p => { const o = byId('orders', p.order_id); return o ? esc(orderLabel(o)) : ''; }],
      ['Method', p => esc(p.method || '')], ['Amount', p => gbp(p.amount_pence), 'num']],
    text: p => [p.note, p.method, (byId('orders', p.order_id) || {}).order_ref].join(' '),
    stats: rows => [['Payments', rows.length], ['Total received', gbp(rows.reduce((s, p) => s + p.amount_pence, 0))]],
  },
  services: {
    title: 'Service', order: ['name', true],
    fields: [{ k: 'name', l: 'Name', req: 1 }, { k: 'description', l: 'Description', t: 'textarea' }, { k: 'price_pence', l: 'Price (£)', t: 'money' }, { k: 'active', l: 'Active', t: 'check' }],
    cols: [['Service', s => `<b>${esc(s.name)}</b><div class="sub">${esc(s.description || '')}</div>`], ['Price', s => gbp(s.price_pence), 'num'], ['Active', s => s.active ? 'Yes' : 'No']],
    text: s => [s.name, s.description].join(' '), stats: () => [],
  },
};

async function loadCrm() {
  const res = await Promise.all(Object.entries(ENT).map(([k, e]) => db.from(k).select('*').order(e.order[0], { ascending: e.order[1] })
    .then(r => [k, r])));
  const [co, oi, rq, fb, ph, pk] = await Promise.all([db.from('customer_orders').select('*'), db.from('order_items').select('*'),
    db.from('order_requests').select('*').order('created_at'), db.from('feedback').select('*'), db.from('photos').select('*').order('created_at'), db.from('photo_picks').select('*')]);
  portalReady = !(rq.error || fb.error || ph.error || pk.error); D.photo_picks = pk.data || [];
  D.order_requests = rq.data || []; D.feedback = fb.data || []; D.photos = ph.data || [];
  for (const [k, r] of res) { if (r.error) { $('#crmTable').innerHTML = `<tbody><tr><td>${esc(r.error.message)}. Has supabase/customers.sql been run?</td></tr></tbody>`; return false; } D[k] = r.data; }
  D.customer_orders = co.data || []; D.order_items = oi.data || [];
  return true;
}
async function openEntity(name) {
  cur = name; $('#crmSearch').value = '';
  if (!loaded) { $('#crmTable').innerHTML = '<tbody><tr><td>Loading…</td></tr></tbody>'; loaded = await loadCrm(); if (!loaded) return; }
  renderCrm();
}
function renderCrm() {
  const e = ENT[cur], q = $('#crmSearch').value.trim().toLowerCase();
  const rows = D[cur].filter(r => !q || e.text(r).toLowerCase().includes(q));
  $('#crmNew').textContent = 'New ' + e.title.toLowerCase();
  $('#crmStats').innerHTML = e.stats(rows).map(([l, v]) => `<div>${l}<b>${v}</b></div>`).join('');
  $('#crmTable').innerHTML = `<thead><tr>${e.cols.map(c => `<th class="${c[2] || ''}">${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r =>
    `<tr data-id="${r.id}">${e.cols.map(c => `<td class="${c[2] || ''}">${c[1](r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${e.cols.length}" class="hint">Nothing here yet.</td></tr>`}</tbody>`;
}
$('#crmSearch').addEventListener('input', () => renderCrm());
$('#crmTable').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-id]'); if (!tr) return; const r = byId(cur, tr.dataset.id); cur === 'customers' ? openProfile(r) : openForm(r); });
$('#crmNew').onclick = () => openForm(null);

function openForm(row, preset = {}) {
  const e = ENT[cur]; editing = row;
  $('#crmDlg').oninput = $('#crmDlg').onclick = null;
  const val = f => row ? (f.k === 'customers' ? orderCustomers(row.id).map(c => c.id) : row[f.k]) : (preset[f.k] ?? (f.t === 'select' && f.opts ? f.opts[0] : f.k === 'active' ? true : f.t === 'date' && f.req ? iso(new Date()) : null));
  const input = f => {
    const v = val(f), n = `name="${f.k}" ${f.req ? 'required' : ''}`;
    if (f.t === 'textarea') return `<textarea ${n} rows="3">${esc(v)}</textarea>`;
    if (f.t === 'check') return `<input type="checkbox" ${n} ${v ? 'checked' : ''}>`;
    if (f.t === 'money') return `<input type="number" step="0.01" ${n} value="${v == null ? '' : v / 100}">`;
    if (f.t === 'multi') return `<select multiple name="${f.k}">${D[f.ref].map(r => `<option value="${r.id}" ${(v || []).includes(r.id) ? 'selected' : ''}>${esc(f.lab(r))}</option>`).join('')}</select>`;
    if (f.t === 'select') {
      const opts = f.ref ? D[f.ref].map(r => [r.id, f.lab(r)]) : f.opts.map(o => [o, o]);
      return `<select ${n}>${f.req && !f.ref ? '' : '<option value="">—</option>'}${opts.map(([id, l]) => `<option value="${esc(id)}" ${v === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    return `<input type="${f.t || 'text'}" ${n} value="${esc(v)}">`;
  };
  $('#crmForm').innerHTML = `<h3>${row ? 'Edit' : 'New'} ${e.title.toLowerCase()}</h3>` + e.fields.map(f =>
    `<label class="fld ${f.t === 'check' ? 'chk' : ''}">${f.t === 'check' ? input(f) + f.l : f.l + input(f)}</label>`).join('') +
    (cur === 'orders' ? orderExtras(row) : '') + (row && RELATED[cur] ? RELATED[cur](row) : '') +
    `<div class="err" id="crmErr"></div><div class="dlg-actions"><button>Save</button><button type="button" class="ghost" id="crmCancel">Cancel</button>${row ? '<button type="button" class="ghost del" id="crmDel">Delete</button>' : ''}</div>`;
  const form = $('#crmForm');
  // picking a service fills an empty/zero total
  if (cur === 'orders') form.service_id.onchange = () => { const s = byId('services', form.service_id.value); if (s && !Number(form.total_pence.value)) form.total_pence.value = s.price_pence / 100; };
  if (cur === 'orders') wireOrder(form, row);
  if (cur === 'events' && row) wirePhotos(row);
  const rn = $('#relNew'); if (rn) rn.onclick = () => { $('#crmDlg').close(); newOrderFor(row); };
  $('#crmCancel').onclick = () => $('#crmDlg').close();
  if (row) $('#crmDel').onclick = async () => {
    if (!confirm(`Delete this ${e.title.toLowerCase()} permanently?${cur === 'customers' || cur === 'orders' ? ' Links to related records are removed too.' : ''}`)) return;
    const { error } = await db.from(cur).delete().eq('id', row.id);
    if (error) return $('#crmErr').textContent = error.code === '23503' ? 'This still has orders linked to it. Delete or move those orders first.' : error.message;
    $('#crmDlg').close(); await reloadCrm();
  };
  $('#crmDlg').showModal();
}
$('#crmForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const e = ENT[cur], fd = new FormData(ev.target), payload = {};
  let links = null;
  for (const f of e.fields) {
    if (f.t === 'multi') { links = fd.getAll(f.k); continue; }
    let v = f.t === 'check' ? fd.has(f.k) : (fd.get(f.k) ?? '').toString().trim();
    if (f.t === 'money') v = v === '' ? 0 : Math.round(parseFloat(v) * 100);
    else if (v === '' && f.t !== 'check') v = null;
    payload[f.k] = v;
  }
  if (cur === 'orders' && $$('.irow').length) payload.total_pence = itemsTotal();
  const q = editing ? db.from(cur).update(payload).eq('id', editing.id) : db.from(cur).insert(payload);
  const { data, error } = await q.select().single();
  if (error) return $('#crmErr').textContent = error.code === '23505' ? 'That email or name already exists.' : error.message;
  if (cur === 'orders') { const err = await saveOrderParts(data.id); if (err) return $('#crmErr').textContent = err; }
  if (links) {
    const del = await db.from('customer_orders').delete().eq('order_id', data.id);
    const ins = links.length ? await db.from('customer_orders').insert(links.map((id, i) => ({ customer_id: id, order_id: data.id, role: i ? 'additional' : 'primary' }))) : {};
    if (del.error || ins.error) return $('#crmErr').textContent = (del.error || ins.error).message;
  }
  $('#crmDlg').close(); await reloadCrm();
});
async function reloadCrm() { loaded = await loadCrm(); if (loaded) renderCrm(); }

// ---- order dialog: line items + payments edited inline ----
const METHODS = ['card', 'bank transfer', 'cash', 'other'];
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const itemsTotal = () => $$('.irow').reduce((t, r) => t + Math.round(num(r.querySelector('.i-price').value) * 100) * Math.max(1, parseInt(r.querySelector('.i-qty').value) || 1), 0);
const itemRow = (i = {}) => `<div class="irow"><select class="i-svc"><option value="">Service…</option>${D.services.filter(x => x.active || x.id === i.service_id).map(x => `<option value="${x.id}" ${x.id === i.service_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
  <input class="i-desc" placeholder="Description" value="${esc(i.description)}"><input class="i-qty" type="number" min="1" value="${i.quantity || 1}" title="Quantity"><input class="i-price" type="number" step="0.01" min="0" placeholder="£ each" value="${i.unit_price_pence == null ? '' : i.unit_price_pence / 100}"><button type="button" class="ghost x" title="Remove">×</button></div>`;
const payRow = (p = {}) => `<div class="prow" data-id="${p.id || ''}"><input class="p-amt" type="number" step="0.01" placeholder="£ (− refund)" value="${p.amount_pence == null ? '' : p.amount_pence / 100}">
  <select class="p-method">${METHODS.map(m => `<option ${m === p.method ? 'selected' : ''}>${m}</option>`).join('')}</select><input class="p-date" type="date" value="${p.paid_on || iso(new Date())}"><input class="p-note" placeholder="Note" value="${esc(p.note)}"><button type="button" class="ghost x" title="Remove">×</button></div>`;
function orderExtras(row) {
  const items = row ? D.order_items.filter(i => i.order_id === row.id) : [], pays = row ? D.payments.filter(p => p.order_id === row.id) : [];
  return `<h4 class="sec">What was ordered</h4><div id="items">${items.map(itemRow).join('')}</div><button type="button" class="ghost" id="addItem">+ Add item</button>
    <h4 class="sec">Payments</h4><div id="pays">${pays.map(payRow).join('')}</div><button type="button" class="ghost" id="addPay">+ Record payment</button><div class="sum" id="sum"></div>`;
}
function wireOrder(form) {
  const sum = () => {
    const has = $$('.irow').length, tot = has ? itemsTotal() : Math.round(num(form.total_pence.value) * 100);
    if (has) form.total_pence.value = tot / 100; form.total_pence.readOnly = !!has;
    const p = $$('.prow').reduce((t, r) => t + Math.round(num(r.querySelector('.p-amt').value) * 100), 0);
    $('#sum').innerHTML = `Total <b>${gbp(tot)}</b> · Paid <b>${gbp(p)}</b> · Balance <b>${gbp(tot - p)}</b>`;
  };
  const dlg = $('#crmDlg');
  dlg.oninput = ev => {
    const r = ev.target.closest('.irow');
    if (r && ev.target.classList.contains('i-svc')) { const sv = byId('services', ev.target.value); if (sv) { r.querySelector('.i-desc').value ||= sv.name; r.querySelector('.i-price').value = sv.price_pence / 100; } }
    sum();
  };
  dlg.onclick = ev => { const x = ev.target.closest('.x'); if (x) { x.parentElement.remove(); sum(); } };
  $('#addItem').onclick = () => { $('#items').insertAdjacentHTML('beforeend', itemRow()); sum(); };
  $('#addPay').onclick = () => { $('#pays').insertAdjacentHTML('beforeend', payRow()); sum(); };
  sum();
}
async function saveOrderParts(oid) {
  const items = $$('.irow').filter(r => r.querySelector('.i-desc').value.trim() || r.querySelector('.i-svc').value).map(r => ({ order_id: oid, service_id: r.querySelector('.i-svc').value || null, description: r.querySelector('.i-desc').value.trim() || r.querySelector('.i-svc').selectedOptions[0].text,
    quantity: Math.max(1, parseInt(r.querySelector('.i-qty').value) || 1), unit_price_pence: Math.round(num(r.querySelector('.i-price').value) * 100) }));
  const d = await db.from('order_items').delete().eq('order_id', oid);
  if (d.error) return d.error.message;
  if (items.length) { const i = await db.from('order_items').insert(items); if (i.error) return i.error.message; }
  const rows = $$('.prow').filter(r => r.querySelector('.p-amt').value !== '').map(r => ({ id: r.dataset.id, order_id: oid, amount_pence: Math.round(num(r.querySelector('.p-amt').value) * 100),
    method: r.querySelector('.p-method').value, paid_on: r.querySelector('.p-date').value || iso(new Date()), note: r.querySelector('.p-note').value.trim() || null })).filter(p => p.amount_pence);
  const keep = rows.filter(p => p.id).map(p => p.id);
  const old = D.payments.filter(p => p.order_id === oid && !keep.includes(p.id)).map(p => p.id);
  if (old.length) { const r = await db.from('payments').delete().in('id', old); if (r.error) return r.error.message; }
  for (const p of rows) {
    const { id, ...rest } = p;
    const r = id ? await db.from('payments').update(rest).eq('id', id) : await db.from('payments').insert(rest);
    if (r.error) return r.error.message;
  }
}

// ---- related records shown at the bottom of customer and event dialogs ----
const orderLines = list => list.length ? `<table class="rel">${list.map(o => `<tr><td>${esc(o.order_ref)}</td><td>${esc((byId('events', o.event_id) || {}).title || '')}</td><td>${tag(o.status)}</td><td class="num">${gbp(o.total_pence)}</td><td class="num">${gbp(paid(o.id))} paid</td></tr>`).join('')}</table>` : '<p class="sub">No orders yet.</p>';
const RELATED = {
  customers: c => { const os = D.customer_orders.filter(l => l.customer_id === c.id).map(l => byId('orders', l.order_id)).filter(Boolean);
    return `<h4 class="sec">Orders</h4>${orderLines(os)}<p class="sub">Lifetime spend ${gbp(os.filter(o => o.status !== 'cancelled').reduce((t, o) => t + paid(o.id), 0))}</p>`; },
  events: e => `<h4 class="sec">Orders for this event</h4>${orderLines(D.orders.filter(o => o.event_id === e.id))}<button type="button" class="ghost" id="relNew">+ New order for this event</button>${eventExtras(e)}`,
};
function newOrderFor(ev) {
  $('[data-tab="crm:orders"]').click();
  openForm(null, { event_id: ev.id, customers: [] });
}

// Enquiry -> customer + event + draft order, then mark the enquiry converted
async function convertEnquiry(enq, btn) {
  if (!enq || !confirm(`Convert ${enq.name}'s enquiry? This creates a customer (if new), an event and a draft order, and marks the enquiry converted.`)) return;
  btn.disabled = true;
  const fail = m => { alert(m); btn.disabled = false; };
  if (!loaded) loaded = await loadCrm();
  if (!loaded) return fail('Customer tables not available. Has supabase/customers.sql been run?');
  let cust = D.customers.find(c => c.email && c.email.toLowerCase() === enq.email.toLowerCase());
  if (!cust) {
    const r = await db.from('customers').insert({ name: enq.name, email: enq.email, source: 'website', enquiry_id: enq.id }).select().single();
    if (r.error) return fail(r.error.message); cust = r.data;
  }
  const ev = await db.from('events').insert({ title: `${enq.type || 'Event'} – ${enq.name}`, event_type: enq.type, event_date: enq.event_date, location: enq.location, notes: enq.message }).select().single();
  if (ev.error) return fail(ev.error.message);
  const or = await db.from('orders').insert({ event_id: ev.data.id, status: 'quote' }).select().single();
  if (or.error) return fail(or.error.message);
  const lk = await db.from('customer_orders').insert({ customer_id: cust.id, order_id: or.data.id, role: 'primary' });
  if (lk.error) return fail(lk.error.message);
  const up = await db.from('enquiries').update({ status: 'converted' }).eq('id', enq.id);
  if (up.error) return fail(up.error.message);
  loaded = false;
  await syncDate(enq.event_date); await loadBlocked(); loadEnquiries();
}
