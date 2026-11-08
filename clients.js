// Admin: upcoming events list, customer profile, special requests, and watermarked proof uploads.
// Runs after crm.js and shares its globals (D, byId, openForm, reloadCrm...). Needs supabase/portal.sql.
const today = () => iso(new Date());
const local = d => new Date(d + 'T00:00');
const lastDay = e => e.end_date || e.event_date;
const span = e => e.event_date ? fdate(e.event_date) + (e.end_date && e.end_date !== e.event_date ? ' – ' + fdate(e.end_date) : '') : 'No date';
const hhmm = t => (t || '').slice(0, 5);
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const KINDS = { shot: 'Shot / moment', timing: 'Timing', people: 'People', location: 'Location', other: 'Other' };
const jump = (ent, row) => { $(`[data-tab="crm:${ent}"]`).click(); openForm(row); };
const needPortal = () => portalReady ? '' : '<p class="err">Requests, feedback and proofs need supabase/portal.sql run in Supabase first.</p>';

const customerOrders = cid => D.customer_orders.filter(l => l.customer_id === cid).map(l => byId('orders', l.order_id)).filter(Boolean);
const eventOrders = eid => D.orders.filter(o => o.event_id === eid && o.status !== 'cancelled');
function nextEvent(c) {
  const t = today();
  return customerOrders(c.id).filter(o => o.status !== 'cancelled').map(o => byId('events', o.event_id))
    .filter(e => e && e.status !== 'cancelled' && e.event_date && lastDay(e) >= t).sort((a, b) => a.event_date.localeCompare(b.event_date))[0];
}
function eventDays(e) {
  if (!e || !e.event_date) return [];
  const out = []; let d = local(e.event_date); const end = local(lastDay(e));
  while (d <= end && out.length < 14) { out.push(iso(d)); d.setDate(d.getDate() + 1); }
  return out;
}

// ---- upcoming events ----
let upMode = 'next';
$$('#up .filters button').forEach(b => b.onclick = () => { upMode = b.dataset.uf; $$('#up .filters button').forEach(x => x.classList.toggle('on', x === b)); renderUpcoming(); });
async function openUpcoming() {
  if (!loaded) {
    $('#upList').innerHTML = '<p class="hint">Loading…</p>';
    loaded = await loadCrm();
    if (!loaded) return $('#upList').innerHTML = '<p class="hint">Customer tables not available. Has supabase/customers.sql been run?</p>';
  }
  renderUpcoming();
}
function renderUpcoming() {
  const t = today(), now = local(t);
  const rows = D.events.filter(e => e.status !== 'cancelled' && (upMode === 'next' ? !e.event_date || lastDay(e) >= t : e.event_date && lastDay(e) < t))
    .sort((a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999') || (a.start_time || '').localeCompare(b.start_time || ''));
  if (upMode === 'past') rows.reverse();
  let html = '', month = null;
  for (const e of rows) {
    const key = e.event_date ? e.event_date.slice(0, 7) : 'none';
    if (key !== month) { month = key; html += `<h3 class="up-month">${key === 'none' ? 'No date set' : local(key + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>`; }
    const ords = eventOrders(e.id), custs = [...new Set(ords.flatMap(o => orderCustomers(o.id)).map(c => c.name))];
    const due = ords.filter(o => o.status !== 'quote').reduce((s, o) => s + o.total_pence - paid(o.id), 0);
    const reqs = D.order_requests.filter(r => ords.some(o => o.id === r.order_id)), open = reqs.filter(r => r.status === 'open').length;
    const ph = D.photos.filter(p => p.event_id === e.id).length;
    const days = e.event_date ? Math.round((local(e.event_date) - now) / 864e5) : null;
    const when = days === null ? '' : days < 0 && lastDay(e) >= t ? 'Under way' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 1 ? `In ${days} days` : '';
    const d = e.event_date && local(e.event_date);
    html += `<article class="up ${days === 0 ? 'now' : ''}" data-id="${e.id}">
      <div class="up-date">${d ? `<b>${d.getDate()}</b><span>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>` : '<b>–</b>'}</div>
      <div class="up-main"><b>${esc(e.title)}</b>${e.event_type ? ` <span class="sub">${esc(e.event_type)}</span>` : ''}
        <div class="sub">${[span(e), hhmm(e.start_time) && hhmm(e.start_time) + (e.end_time ? '–' + hhmm(e.end_time) : ''), e.location].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="sub">${custs.length ? esc(custs.join(', ')) : 'No customer linked'}</div>
        <div class="chips">${ords.map(o => tag(o.status)).join('')}${due > 0 ? `<span class="tag">${gbp(due)} due</span>` : ''}${open ? `<span class="tag">${open} open request${open > 1 ? 's' : ''}</span>` : reqs.length ? `<span class="tag confirmed">${reqs.length} request${reqs.length > 1 ? 's' : ''} handled</span>` : ''}${ph ? `<span class="tag ${e.proofs_published ? 'confirmed' : ''}">${ph} proof${ph > 1 ? 's' : ''} ${e.proofs_published ? 'live' : 'hidden'}</span>` : ''}</div></div>
      <div class="up-when">${when}</div></article>`;
  }
  $('#upList').innerHTML = (portalReady ? '' : needPortal()) + (html || `<p class="hint">No ${upMode === 'next' ? 'upcoming' : 'past'} events.</p>`);
}
$('#upList').addEventListener('click', ev => { const a = ev.target.closest('.up'); if (a) jump('events', byId('events', a.dataset.id)); });

// ---- customer profile ----
let profId = null;
const afterChange = async () => { await reloadCrm(); renderProfile(); };
function openProfile(c) { profId = c.id; renderProfile(); $('#profDlg').showModal(); }
function renderProfile() {
  const c = byId('customers', profId); if (!c) return $('#profDlg').close();
  const ords = customerOrders(c.id).sort((a, b) => ((byId('events', b.event_id) || {}).event_date || '9999').localeCompare((byId('events', a.event_id) || {}).event_date || '9999'));
  const live = ords.filter(o => o.status !== 'cancelled'), fbs = D.feedback.filter(f => f.customer_id === c.id);
  const out = live.filter(o => o.status !== 'quote').reduce((s, o) => s + o.total_pence - paid(o.id), 0);
  $('#profBody').innerHTML = `
    <div class="ph"><div><h3>${esc(c.name)}</h3><div class="sub">${esc(c.company || '')}</div></div>
      <div class="ph-act"><button class="ghost" data-edit>Edit details</button><button class="ghost" data-close>Close</button></div></div>
    <p class="meta">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : 'No email (cannot use the portal)'}${c.phone ? ' · ' + esc(c.phone) : ''}${c.address ? '<br>' + esc(c.address) : ''}<br>Source: ${esc(c.source || '–')} · Marketing ${c.marketing_ok ? 'OK' : 'not OK'} · Customer since ${fdate(c.created_at)}</p>
    <div class="stats"><div>Orders<b>${ords.length}</b></div><div>Paid<b>${gbp(live.reduce((s, o) => s + paid(o.id), 0))}</b></div><div>Outstanding<b>${gbp(out)}</b></div><div>Rating<b>${fbs.length ? (fbs.reduce((s, f) => s + f.rating, 0) / fbs.length).toFixed(1) + ' ★' : '–'}</b></div></div>
    ${c.notes ? `<h4 class="sec">Internal notes</h4><p class="note">${esc(c.notes)}</p>` : ''}${needPortal()}
    <h4 class="sec">Orders, requests and feedback</h4>${ords.map(o => orderBlock(o, c)).join('') || '<p class="sub">No orders yet.</p>'}`;
}
function orderBlock(o, c) {
  const e = byId('events', o.event_id) || {}, items = D.order_items.filter(i => i.order_id === o.id), reqs = D.order_requests.filter(r => r.order_id === o.id);
  const fb = D.feedback.find(f => f.order_id === o.id && f.customer_id === c.id), ph = D.photos.filter(p => p.event_id === e.id).length, days = eventDays(e);
  return `<section class="po" data-oid="${o.id}">
    <div class="po-h"><b>${esc(o.order_ref)}</b>${tag(o.status)}${tag(payState(o))}<span class="sp"></span><button class="ghost sm" data-oo="${o.id}">Open order</button></div>
    <div class="po-ev"><a href="#" data-oe="${e.id}">${esc(e.title || 'No event')}</a><div class="sub">${[span(e), hhmm(e.start_time) && hhmm(e.start_time) + (e.end_time ? '–' + hhmm(e.end_time) : ''), e.location].filter(Boolean).map(esc).join(' · ')}</div></div>
    ${items.length ? `<table class="rel">${items.map(i => `<tr><td>${esc(i.description)}</td><td class="num">${i.quantity} × ${gbp(i.unit_price_pence)}</td></tr>`).join('')}</table>` : ''}
    <div class="sub">Total ${gbp(o.total_pence)} · Paid ${gbp(paid(o.id))} · Balance ${gbp(o.total_pence - paid(o.id))}</div>
    <h5>Special requests</h5>
    ${reqs.map(r => `<div class="rq ${r.status}"><div class="rq-top"><span>${r.day ? fdate(r.day) : 'Whole event'}</span><span class="kind">${KINDS[r.kind] || r.kind}</span>${r.author === 'admin' ? '<span class="kind">added by you</span>' : ''}<span class="sp"></span>
      <select data-rs="${r.id}">${['open', 'noted', 'done'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="ghost x" data-rdel="${r.id}" title="Delete">×</button></div><p>${esc(r.body)}</p></div>`).join('') || '<p class="sub">None yet.</p>'}
    ${portalReady ? `<div class="rqadd"><select class="r-day"><option value="">Whole event</option>${days.map(d => `<option value="${d}">${fdate(d)}</option>`).join('')}</select>
      <select class="r-kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <input class="r-body" placeholder="Add a request or note on their behalf"><button class="ghost sm" data-radd="${o.id}">Add</button></div>` : ''}
    <h5>Feedback</h5>${fb ? `<div class="fb"><span class="star">${stars(fb.rating)}</span>${fb.public_ok ? ' <span class="tag confirmed">OK to quote</span>' : ''}${fb.comment ? `<p>${esc(fb.comment)}</p>` : ''}</div>` : '<p class="sub">No feedback yet.</p>'}
    <h5>Proofs</h5><p class="sub">${ph} photo${ph === 1 ? '' : 's'} · ${e.proofs_published ? 'visible to customer' : 'hidden'} <a href="#" data-oe="${e.id}">Manage photos</a></p>
  </section>`;
}
$('#profBody').addEventListener('click', async ev => {
  const t = ev.target.closest('[data-edit],[data-close],[data-oo],[data-oe],[data-rdel],[data-radd]'); if (!t) return;
  ev.preventDefault();
  if ('close' in t.dataset) return $('#profDlg').close();
  if ('edit' in t.dataset) { const c = byId('customers', profId); $('#profDlg').close(); return jump('customers', c); }
  if (t.dataset.oo) { $('#profDlg').close(); return jump('orders', byId('orders', t.dataset.oo)); }
  if (t.dataset.oe) { $('#profDlg').close(); return jump('events', byId('events', t.dataset.oe)); }
  if (t.dataset.rdel) {
    if (!confirm('Delete this request?')) return;
    const { error } = await db.from('order_requests').delete().eq('id', t.dataset.rdel); if (error) return alert(error.message);
    return afterChange();
  }
  if (t.dataset.radd) {
    const box = t.closest('.rqadd'), body = box.querySelector('.r-body').value.trim(); if (!body) return;
    const { error } = await db.from('order_requests').insert({ order_id: t.dataset.radd, customer_id: profId, author: 'admin', day: box.querySelector('.r-day').value || null, kind: box.querySelector('.r-kind').value, body });
    if (error) return alert(error.message);
    afterChange();
  }
});
$('#profBody').addEventListener('change', async ev => {
  const s = ev.target.closest('[data-rs]'); if (!s) return;
  const { error } = await db.from('order_requests').update({ status: s.value }).eq('id', s.dataset.rs);
  if (error) return alert(error.message);
  afterChange();
});

// ---- event dialog: all requests for the day, plus proof photos ----
function eventExtras(e) {
  const ords = eventOrders(e.id), reqs = D.order_requests.filter(r => ords.some(o => o.id === r.order_id)).sort((a, b) => (a.day || '').localeCompare(b.day || ''));
  return `<h4 class="sec">Special requests for this event</h4>${needPortal()}
    ${reqs.map(r => { const o = byId('orders', r.order_id); return `<div class="rq ${r.status}"><div class="rq-top"><span>${r.day ? fdate(r.day) : 'Whole event'}</span><span class="kind">${KINDS[r.kind] || r.kind}</span><span class="kind">${esc(orderCustomers(o.id).map(c => c.name).join(', '))}</span><span class="sp"></span>${tag(r.status)}</div><p>${esc(r.body)}</p></div>`; }).join('') || '<p class="sub">None.</p>'}
    <h4 class="sec">Proof photos</h4>
    <p class="sub">Each upload makes a watermarked 1600px copy for customers and keeps the original private. Customers see them once "Proofs visible" is ticked and saved.</p>
    <input type="file" id="phFile" accept="image/*" multiple><div class="sub" id="phStatus"></div><div class="pgrid" id="phGrid"></div>`;
}
async function wirePhotos(e) {
  const grid = $('#phGrid'), file = $('#phFile'); if (!grid) return;
  const photos = D.photos.filter(p => p.event_id === e.id);
  if (photos.length) {
    const { data } = await db.storage.from('proofs').createSignedUrls(photos.map(p => p.preview_path), 3600);
    if (!grid.isConnected) return;
    const url = Object.fromEntries((data || []).map(d => [d.path, d.signedUrl]));
    grid.innerHTML = photos.map(p => `<figure><img src="${esc(url[p.preview_path] || '')}" alt="" loading="lazy" title="${esc(p.filename || '')}"><button type="button" class="pdel" data-pdel="${p.id}" title="Delete photo">×</button></figure>`).join('');
  } else grid.innerHTML = '';
  grid.onclick = async ev => {
    const b = ev.target.closest('[data-pdel]'); if (!b || !confirm('Delete this photo and its original?')) return;
    const p = byId('photos', b.dataset.pdel);
    await db.storage.from('proofs').remove([p.preview_path]); await db.storage.from('originals').remove([p.original_path]);
    const { error } = await db.from('photos').delete().eq('id', p.id); if (error) return alert(error.message);
    await reloadCrm(); wirePhotos(e);
  };
  file.onchange = async () => {
    const files = [...file.files], st = $('#phStatus'), fails = []; let ok = 0;
    for (const [i, f] of files.entries()) {
      st.textContent = `Uploading ${i + 1} of ${files.length}…`;
      try { await uploadPhoto(e, f); ok++; } catch (err) { fails.push(`${f.name}: ${err.message || err}`); }
    }
    file.value = ''; st.textContent = `${ok} uploaded.` + (fails.length ? ' Failed: ' + fails.join('; ') : '');
    if (ok) { await reloadCrm(); wirePhotos(e); }
  };
}
async function uploadPhoto(e, file) {
  const id = crypto.randomUUID(), { blob, w, h } = await makeProof(file);
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const op = `${e.id}/${id}.${ext}`, pp = `${e.id}/${id}.jpg`, undo = async () => { await db.storage.from('originals').remove([op]); await db.storage.from('proofs').remove([pp]); };
  let r = await db.storage.from('originals').upload(op, file, { contentType: file.type || 'image/jpeg' }); if (r.error) throw r.error;
  r = await db.storage.from('proofs').upload(pp, blob, { contentType: 'image/jpeg' }); if (r.error) { await undo(); throw r.error; }
  r = await db.from('photos').insert({ id, event_id: e.id, filename: file.name, original_path: op, preview_path: pp, width: w, height: h });
  if (r.error) { await undo(); throw r.error; }
}
// The watermark is burned into the pixels before upload, so customers never receive a clean copy.
async function makeProof(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('cannot read this image (HEIC? export it as JPEG first)'); }
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, w, h); bmp.close();
  const text = 'WORLD EVENT PHOTOGRAPHY · PROOF', fs = Math.max(16, Math.round(Math.min(w, h) / 15));
  g.font = `600 ${fs}px Inter, system-ui, sans-serif`; g.textBaseline = 'middle'; g.lineWidth = Math.max(1, fs / 14);
  g.fillStyle = 'rgba(255,255,255,.36)'; g.strokeStyle = 'rgba(0,0,0,.3)';
  const gx = g.measureText(text).width + fs * 2, gy = fs * 3.4, big = Math.hypot(w, h);
  g.translate(w / 2, h / 2); g.rotate(-Math.PI / 7);
  for (let y = -big / 2, row = 0; y <= big / 2; y += gy, row++) for (let x = -big / 2 - (row % 2 ? gx / 2 : 0); x <= big / 2; x += gx) { g.strokeText(text, x, y); g.fillText(text, x, y); }
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.72));
  if (!blob) throw new Error('could not encode preview');
  return { blob, w, h };
}
