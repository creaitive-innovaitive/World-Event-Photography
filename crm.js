// Customer database panel. Data lives in Supabase (see supabase/customers.sql); money is stored in pence.
const D = { customers: [], events: [], services: [], orders: [], customer_orders: [], payments: [] };
let cur = null, loaded = false, editing = null;

const gbp = p => '£' + ((p || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const byId = (list, id) => D[list].find(r => r.id === id);
const orderCustomers = oid => D.customer_orders.filter(l => l.order_id === oid).sort(a => a.role === 'primary' ? -1 : 1).map(l => byId('customers', l.customer_id)).filter(Boolean);
const paid = oid => D.payments.filter(p => p.order_id === oid).reduce((s, p) => s + p.amount_pence, 0);
const tag = s => `<span class="tag ${s === 'booked' || s === 'completed' || s === 'delivered' ? 'confirmed' : s === 'cancelled' ? 'declined' : ''}">${esc(s)}</span>`;
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
      ['Spent', c => gbp(D.customer_orders.filter(l => l.customer_id === c.id && l.role === 'primary').reduce((s, l) => s + paid(l.order_id), 0)), 'num']],
    text: c => [c.name, c.email, c.phone, c.company, c.notes].join(' '),
    stats: rows => [['Customers', rows.length], ['Repeat', rows.filter(c => D.customer_orders.filter(l => l.customer_id === c.id).length > 1).length]],
  },
  orders: {
    title: 'Order', order: ['created_at', false],
    fields: [
      { k: 'customers', l: 'Customers (first is primary; ctrl/cmd-click for more)', t: 'multi', ref: 'customers', lab: c => c.name + (c.email ? ` <${c.email}>` : ''), virtual: 1 },
      { k: 'event_id', l: 'Event', t: 'select', ref: 'events', lab: e => `${e.title}${e.event_date ? ' · ' + fdate(e.event_date) : ''}` },
      { k: 'service_id', l: 'Service', t: 'select', ref: 'services', lab: s => `${s.name} (${gbp(s.price_pence)})` },
      { k: 'status', l: 'Status', t: 'select', opts: ['quote', 'booked', 'completed', 'cancelled'] },
      { k: 'total_pence', l: 'Total (£)', t: 'money' }, { k: 'notes', l: 'Notes', t: 'textarea' }],
    cols: [['Order', o => `<b>${esc(o.order_ref)}</b><div class="sub">${fdate(o.created_at)}</div>`],
      ['Customers', o => esc(orderCustomers(o.id).map(c => c.name).join(', '))],
      ['Event', o => { const e = byId('events', o.event_id); return e ? `${esc(e.title)}<div class="sub">${fdate(e.event_date)}</div>` : ''; }],
      ['Status', o => tag(o.status)], ['Total', o => gbp(o.total_pence), 'num'],
      ['Paid', o => gbp(paid(o.id)), 'num'], ['Balance', o => gbp(o.total_pence - paid(o.id)), 'num']],
    text: o => [o.order_ref, o.notes, orderCustomers(o.id).map(c => c.name + (c.email || '')).join(' '), (byId('events', o.event_id) || {}).title].join(' '),
    stats: rows => { const live = rows.filter(o => o.status !== 'cancelled'); return [['Orders', rows.length], ['Booked value', gbp(live.reduce((s, o) => s + o.total_pence, 0))], ['Received', gbp(live.reduce((s, o) => s + paid(o.id), 0))], ['Outstanding', gbp(live.filter(o => o.status !== 'quote').reduce((s, o) => s + o.total_pence - paid(o.id), 0))]]; },
  },
  events: {
    title: 'Event', order: ['event_date', false],
    fields: [{ k: 'title', l: 'Title', req: 1 }, { k: 'event_type', l: 'Type', t: 'select', opts: ['wedding', 'corporate', 'portrait', 'family', 'party', 'other'] },
      { k: 'event_date', l: 'Date', t: 'date' }, { k: 'start_time', l: 'Start', t: 'time' }, { k: 'end_time', l: 'End', t: 'time' }, { k: 'location', l: 'Location' },
      { k: 'status', l: 'Status', t: 'select', opts: ['scheduled', 'shot', 'delivered', 'cancelled'] }, { k: 'notes', l: 'Notes', t: 'textarea' }],
    cols: [['Event', e => `<b>${esc(e.title)}</b><div class="sub">${esc(e.event_type || '')}</div>`],
      ['Date', e => `${fdate(e.event_date)}<div class="sub">${esc((e.start_time || '').slice(0, 5))}${e.end_time ? '–' + e.end_time.slice(0, 5) : ''}</div>`],
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
  const co = await db.from('customer_orders').select('*');
  for (const [k, r] of res) { if (r.error) { $('#crmTable').innerHTML = `<tbody><tr><td>${esc(r.error.message)}. Has supabase/customers.sql been run?</td></tr></tbody>`; return false; } D[k] = r.data; }
  D.customer_orders = co.data || [];
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
$('#crmTable').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-id]'); if (tr) openForm(byId(cur, tr.dataset.id)); });
$('#crmNew').onclick = () => openForm(null);

function openForm(row, preset = {}) {
  const e = ENT[cur]; editing = row;
  const val = f => row ? (f.k === 'customers' ? orderCustomers(row.id).map(c => c.id) : row[f.k]) : (preset[f.k] ?? (f.t === 'select' && f.opts ? f.opts[0] : f.k === 'active' ? true : f.t === 'date' && f.req ? iso(new Date()) : null));
  const input = f => {
    const v = val(f), n = `name="${f.k}" ${f.req ? 'required' : ''}`;
    if (f.t === 'textarea') return `<textarea ${n} rows="3">${esc(v)}</textarea>`;
    if (f.t === 'check') return `<input type="checkbox" ${n} ${v ? 'checked' : ''}>`;
    if (f.t === 'money') return `<input type="number" step="0.01" ${n} value="${v == null ? '' : v / 100}">`;
    if (f.t === 'multi') return `<select multiple name="${f.k}">${D[f.ref].map(r => `<option value="${r.id}" ${(v || []).includes(r.id) ? 'selected' : ''}>${esc(f.lab(r))}</option>`).join('')}</select>`;
    if (f.t === 'select') {
      const opts = f.ref ? D[f.ref].map(r => [r.id, f.lab(r)]) : f.opts.map(o => [o, o]);
      return `<select ${n}>${f.req ? '' : '<option value="">—</option>'}${opts.map(([id, l]) => `<option value="${esc(id)}" ${v === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    return `<input type="${f.t || 'text'}" ${n} value="${esc(v)}">`;
  };
  $('#crmForm').innerHTML = `<h3>${row ? 'Edit' : 'New'} ${e.title.toLowerCase()}</h3>` + e.fields.map(f =>
    `<label class="fld ${f.t === 'check' ? 'chk' : ''}">${f.t === 'check' ? input(f) + f.l : f.l + input(f)}</label>`).join('') +
    `<div class="err" id="crmErr"></div><div class="dlg-actions"><button>Save</button><button type="button" class="ghost" id="crmCancel">Cancel</button>${row ? '<button type="button" class="ghost del" id="crmDel">Delete</button>' : ''}</div>`;
  const form = $('#crmForm');
  // picking a service fills an empty/zero total
  if (cur === 'orders') form.service_id.onchange = () => { const s = byId('services', form.service_id.value); if (s && !Number(form.total_pence.value)) form.total_pence.value = s.price_pence / 100; };
  $('#crmCancel').onclick = () => $('#crmDlg').close();
  if (row) $('#crmDel').onclick = async () => {
    if (!confirm(`Delete this ${e.title.toLowerCase()} permanently?${cur === 'customers' || cur === 'orders' ? ' Links to related records are removed too.' : ''}`)) return;
    const { error } = await db.from(cur).delete().eq('id', row.id);
    if (error) return $('#crmErr').textContent = error.message;
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
  const q = editing ? db.from(cur).update(payload).eq('id', editing.id) : db.from(cur).insert(payload);
  const { data, error } = await q.select().single();
  if (error) return $('#crmErr').textContent = error.code === '23505' ? 'That email or name already exists.' : error.message;
  if (links) {
    const del = await db.from('customer_orders').delete().eq('order_id', data.id);
    const ins = links.length ? await db.from('customer_orders').insert(links.map((id, i) => ({ customer_id: id, order_id: data.id, role: i ? 'additional' : 'primary' }))) : {};
    if (del.error || ins.error) return $('#crmErr').textContent = (del.error || ins.error).message;
  }
  $('#crmDlg').close(); await reloadCrm();
});
async function reloadCrm() { loaded = await loadCrm(); if (loaded) renderCrm(); }

// Enquiries tab: turn an enquiry into a customer record (reuses an existing one with the same email)
async function makeCustomer(enq, btn) {
  if (!enq) return;
  const { data: existing } = await db.from('customers').select('id').ilike('email', enq.email.replace(/[%_\\]/g, '\\$&')).limit(1);
  if (existing && existing.length) { btn.textContent = 'Already a customer'; btn.disabled = true; return; }
  const { error } = await db.from('customers').insert({ name: enq.name, email: enq.email, source: 'website', enquiry_id: enq.id,
    notes: [enq.type, enq.event_date, enq.location].filter(Boolean).join(' · ') || null });
  if (error) return alert(error.message);
  loaded = false; btn.textContent = 'Added ✓'; btn.disabled = true;
}
