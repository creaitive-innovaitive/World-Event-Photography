// Customer portal. Data comes from the portal_data() RPC (customer-safe columns only); see supabase/portal.sql.
const { supabaseUrl, supabaseKey } = window.WEP;
const db = supabase.createClient(supabaseUrl, supabaseKey);
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const local = d => new Date(d + 'T00:00');
const fdate = d => local(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const gbp = p => '£' + ((p || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = t => (t || '').slice(0, 5);
const last = e => e.end_date || e.event_date;
const KINDS = { shot: 'Shot / moment', timing: 'Timing', people: 'People', location: 'Location', other: 'Other' };
const REQ_STATE = { open: 'Sent', noted: 'Noted', done: 'Done' };
const ORDER_STATE = { quote: 'Quote', booked: 'Booked', completed: 'Completed', cancelled: 'Cancelled' };
let P = null, editReq = null, urls = {}, lbSet = [], lbAt = 0, picks = new Set();

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
  $('#login').hidden = true; $('#app').hidden = false; $('#who').textContent = session.user.email;
  await load();
}
db.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN' && $('#app').hidden) start(); });
start();

async function load() {
  const { data, error } = await db.rpc('portal_data');
  if (error) { $('#bookings').innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
  P = data; picks = new Set(data ? data.picks : []); render();
}
function render() {
  if (!P) {
    $('#bookings').innerHTML = `<p class="hint">There are no bookings under ${esc($('#who').textContent)}. If you booked with a different email, sign out and sign in with that one, or <a href="index.html#contact" style="color:var(--gold)">get in touch</a>.</p>`;
    $('#profile').innerHTML = ''; return;
  }
  const t = iso(new Date()), done = o => o.event.event_date && last(o.event) < t;
  const up = P.orders.filter(o => !done(o)).sort((a, b) => (a.event.event_date || '9999').localeCompare(b.event.event_date || '9999'));
  const past = P.orders.filter(done).sort((a, b) => b.event.event_date.localeCompare(a.event.event_date));
  $('#bookings').innerHTML = `<p class="hint">Hi ${esc(P.customer.name.split(' ')[0])}. This is where you can see your bookings, tell me what matters on the day, and look at your photos.</p>` +
    (up.length ? `<h2 class="grp">Upcoming</h2>${up.map(booking).join('')}` : '') + (past.length ? `<h2 class="grp">Past</h2>${past.map(booking).join('')}` : '') +
    (P.orders.length ? '<p class="hint">To change a date or cancel, please <a href="index.html#contact" style="color:var(--gold)">get in touch</a>.</p>' : '<p class="hint">No bookings yet.</p>');
  renderProfile(); fillPhotos();
}

function booking(o) {
  const e = o.event, t = iso(new Date()), isPast = e.event_date && last(e) < t, started = e.event_date && e.event_date <= t;
  const cancelled = o.status === 'cancelled', canAsk = !cancelled && !isPast && o.status !== 'completed';
  const days = !e.event_date ? [] : (() => { const out = []; let d = local(e.event_date); const end = local(last(e)); while (d <= end && out.length < 14) { out.push(iso(d)); d.setDate(d.getDate() + 1); } return out; })();
  const dayOpts = (sel = '') => `<option value="">Whole event</option>${days.map(d => `<option value="${d}" ${d === sel ? 'selected' : ''}>${fdate(d)}</option>`).join('')}`;
  const kindOpts = (sel = 'other') => Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
  const when = e.event_date ? fdate(e.event_date) + (e.end_date && e.end_date !== e.event_date ? ' – ' + fdate(e.end_date) : '') : 'Date to be confirmed';
  const daysTo = e.event_date && !isPast ? Math.round((local(e.event_date) - local(t)) / 864e5) : null;
  const fb = o.feedback;
  return `<article class="bk" data-oid="${o.id}">
    <div class="bk-h"><div><h3>${esc(e.title)}</h3><div class="meta">${[when, hhmm(e.start_time) && hhmm(e.start_time) + (e.end_time ? '–' + hhmm(e.end_time) : ''), e.location].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="bk-tags"><span class="tag ${o.status === 'cancelled' ? 'declined' : o.status === 'quote' ? '' : 'confirmed'}">${ORDER_STATE[o.status]}</span>${daysTo === null ? '' : `<span class="tag">${daysTo === 0 ? 'Today' : daysTo === 1 ? 'Tomorrow' : daysTo > 0 ? `In ${daysTo} days` : 'Under way'}</span>`}</div></div>

    <h4>Your order · ${esc(o.order_ref)}</h4>
    ${o.items.length ? `<table class="rel">${o.items.map(i => `<tr><td>${esc(i.description)}</td><td class="num">${i.quantity} × ${gbp(i.unit_price_pence)}</td></tr>`).join('')}</table>` : ''}
    <div class="tot">Total <b>${gbp(o.total_pence)}</b> · Paid <b>${gbp(o.paid_pence)}</b> · ${o.total_pence - o.paid_pence > 0 && o.status !== 'quote' && !cancelled ? `<span class="due">Balance <b>${gbp(o.total_pence - o.paid_pence)}</b></span>` : 'Balance <b>' + gbp(Math.max(0, o.total_pence - o.paid_pence)) + '</b>'}</div>

    <h4>Special requests</h4>
    ${o.requests.length ? o.requests.map(r => editReq === r.id ? `<div class="rqform" data-rid="${r.id}"><select class="r-day">${dayOpts(r.day || '')}</select><select class="r-kind">${kindOpts(r.kind)}</select><div></div><textarea class="r-body" maxlength="2000">${esc(r.body)}</textarea>
        <div class="acts"><button data-rsave="${r.id}">Save</button> <button class="ghost" data-rcancel>Cancel</button></div></div>` :
      `<div class="rq ${r.status}"><div class="rq-top"><span>${r.day ? fdate(r.day) : 'Whole event'}</span><span class="kind">${KINDS[r.kind] || r.kind}</span>${r.author === 'admin' ? '<span class="kind">from your photographer</span>' : ''}<span class="sp"></span><span class="tag ${r.status === 'open' ? '' : 'confirmed'}">${REQ_STATE[r.status]}</span></div><p>${esc(r.body)}</p>
      ${r.author === 'customer' && r.status === 'open' ? `<div class="acts"><button class="ghost" data-redit="${r.id}">Edit</button><button class="ghost" data-rdel="${r.id}">Delete</button></div>` : ''}</div>`).join('') : '<p class="sub">Nothing yet.</p>'}
    ${canAsk ? `<div class="rqform" data-new="${o.id}"><select class="r-day">${dayOpts()}</select><select class="r-kind">${kindOpts()}</select><div></div>
      <textarea class="r-body" maxlength="2000" placeholder="Must-have shots, timings, people to include, anything I should know…"></textarea><button data-radd="${o.id}">Add request</button></div>` : '<p class="sub">Requests are closed for this booking.</p>'}

    ${o.photos.length ? `<h4>Your photos</h4><p class="gal-note">Proofs from the day: low resolution and watermarked. Final images are delivered without the watermark.</p>
      <div class="gal" data-ev="${e.id}">${o.photos.map((p, i) => `<div class="tile"><button data-photo="${i}" data-path="${esc(p.preview_path)}" data-id="${p.id}" aria-label="Open photo ${i + 1}"><img alt="" draggable="false" loading="lazy" ${urls[p.preview_path] ? `src="${esc(urls[p.preview_path])}"` : ''}></button><button class="heart ${picks.has(p.id) ? 'on' : ''}" data-pick="${p.id}" aria-label="Favourite">♥</button></div>`).join('')}</div>
      <p class="gal-note pickcount" data-ev="${e.id}">${pickText(o.photos)}</p>` : ''}

    <h4>Feedback</h4>
    ${cancelled || !started || o.status === 'quote' ? '<p class="sub">You can leave feedback once the event has taken place.</p>' : `<div class="fbform" data-fb="${o.id}" data-rate="${fb ? fb.rating : 0}">
      <div class="rating">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" class="${fb && n <= fb.rating ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <textarea class="f-body" maxlength="3000" placeholder="How did it go? What could be better?">${esc(fb ? fb.comment : '')}</textarea>
      <label><input type="checkbox" class="f-pub" ${fb && fb.public_ok ? 'checked' : ''}> You may quote this on the website</label>
      <button data-fbsave="${o.id}">${fb ? 'Update feedback' : 'Send feedback'}</button> <span class="ok"></span></div>`}
  </article>`;
}

$('#bookings').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const d = b.dataset, form = b.closest('.rqform,.fbform');
  if (d.pick) return togglePick(d.pick);
  if (d.photo !== undefined) return openLightbox(b.closest('.gal'), +d.photo);
  if (d.star) { form.dataset.rate = d.star; form.querySelectorAll('[data-star]').forEach(s => s.classList.toggle('on', +s.dataset.star <= +d.star)); return; }
  if (d.redit) { editReq = d.redit; return render(); }
  if (d.rcancel !== undefined) { editReq = null; return render(); }
  let r = null;
  if (d.radd || d.rsave) {
    const body = form.querySelector('.r-body').value.trim(); if (!body) return;
    const row = { day: form.querySelector('.r-day').value || null, kind: form.querySelector('.r-kind').value, body };
    b.disabled = true;
    r = d.radd ? await db.from('order_requests').insert({ ...row, order_id: d.radd, customer_id: P.customer.id }) : await db.from('order_requests').update(row).eq('id', d.rsave);
    editReq = null;
  } else if (d.rdel) {
    if (!confirm('Delete this request?')) return;
    r = await db.from('order_requests').delete().eq('id', d.rdel);
  } else if (d.fbsave) {
    const rating = +form.dataset.rate; if (!rating) return form.querySelector('.ok').textContent = 'Pick a star rating first.';
    b.disabled = true;
    r = await db.from('feedback').upsert({ order_id: d.fbsave, customer_id: P.customer.id, rating, comment: form.querySelector('.f-body').value.trim() || null, public_ok: form.querySelector('.f-pub').checked }, { onConflict: 'order_id,customer_id' });
    if (!r.error) { await load(); const ok = $(`[data-fb="${d.fbsave}"] .ok`); if (ok) ok.textContent = 'Thank you, saved.'; return; }
  } else return;
  if (r.error) { b.disabled = false; return alert('Could not save: ' + r.error.message); }
  load();
});

function renderProfile() {
  const c = P.customer;
  $('#profile').innerHTML = `<h3>Your details</h3><form id="profForm">
    <label class="fld">Email (to change this, get in touch)<input value="${esc(c.email)}" disabled></label>
    <label class="fld">Name<input name="name" required maxlength="200" value="${esc(c.name)}"></label>
    <label class="fld">Phone<input name="phone" maxlength="50" value="${esc(c.phone)}"></label>
    <label class="fld">Address<textarea name="address" rows="3" maxlength="500">${esc(c.address)}</textarea></label>
    <label class="fld chk"><input type="checkbox" name="marketing" ${c.marketing_ok ? 'checked' : ''}>OK to send me occasional news and offers</label>
    <div><button>Save details</button> <span class="ok" id="profOk"></span></div></form>`;
  $('#profForm').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target;
    const { error } = await db.rpc('portal_update_profile', { p_name: f.name.value, p_phone: f.phone.value, p_address: f.address.value, p_marketing: f.marketing.checked });
    if (error) return alert('Could not save: ' + error.message);
    await load(); $('#profOk').textContent = 'Saved.';
  };
}

const pickText = photos => { const n = photos.filter(p => picks.has(p.id)).length; return n ? `${n} favourite${n > 1 ? 's' : ''} picked. Tap ♥ on any photo to add or change one.` : 'Tap ♥ on the photos you like most, to help choose prints and the final edit.'; };
async function togglePick(id) {
  const on = !picks.has(id);
  const { error } = on ? await db.from('photo_picks').insert({ photo_id: id, customer_id: P.customer.id }) : await db.from('photo_picks').delete().eq('photo_id', id).eq('customer_id', P.customer.id);
  if (error) return alert('Could not save: ' + error.message);
  on ? picks.add(id) : picks.delete(id);
  $$(`[data-pick="${id}"]`).forEach(h => h.classList.toggle('on', on));
  $$('.pickcount').forEach(el => { const o = P.orders.find(x => x.event.id === el.dataset.ev); if (o) el.textContent = pickText(o.photos); });
  if (lb.open && lbSet[lbAt].id === id) showLb();
}

// Proofs are private; signed URLs expire after an hour.
async function fillPhotos() {
  const paths = [...new Set($$('.gal [data-photo]').map(b => b.dataset.path))].filter(p => !urls[p]);
  if (paths.length) {
    const { data } = await db.storage.from('proofs').createSignedUrls(paths, 3600);
    (data || []).forEach(d => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
  }
  $$('.gal [data-photo]').forEach(b => { const i = b.querySelector('img'); if (urls[b.dataset.path] && !i.src) i.src = urls[b.dataset.path]; });
}

// Deterrents only (no right-click, no drag, a shield over the image). The real protection is that the file
// customers can reach is already watermarked and small; originals are in a bucket they cannot read.
const lb = $('#lb');
function openLightbox(gal, i) { lbSet = [...gal.querySelectorAll('[data-photo]')].map(b => ({ path: b.dataset.path, id: b.dataset.id })); lbAt = i; showLb(); lb.showModal(); }
function showLb() { $('#lbImg').src = urls[lbSet[lbAt].path] || ''; $('#lbCount').textContent = `${lbAt + 1} / ${lbSet.length}`; $('#lbHeart').classList.toggle('on', picks.has(lbSet[lbAt].id)); }
const step = n => { lbAt = (lbAt + n + lbSet.length) % lbSet.length; showLb(); };
$('#lbPrev').onclick = () => step(-1); $('#lbNext').onclick = () => step(1); $('#lbHeart').onclick = () => togglePick(lbSet[lbAt].id);
$('#lbClose').onclick = () => lb.close();
lb.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });
document.addEventListener('contextmenu', e => { if (e.target.closest('.gal, .lb')) e.preventDefault(); });
document.addEventListener('dragstart', e => { if (e.target.closest('.gal, .lb')) e.preventDefault(); });
