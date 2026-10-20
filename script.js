const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

window.addEventListener('load', () => setTimeout(() => $('#loader').classList.add('done'), 900));
$('#yr').textContent = new Date().getFullYear();

// nav
const nav = $('#nav'), burger = $('#burger'), menu = $('#menu');
burger.onclick = () => {
  const open = menu.classList.toggle('open');
  burger.setAttribute('aria-expanded', open);
};
menu.onclick = e => { if (e.target.tagName === 'A') { menu.classList.remove('open'); burger.setAttribute('aria-expanded', false); } };

// reveal on scroll
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: .12 });
$$('.reveal').forEach((el, i) => { el.style.transitionDelay = (i % 4) * 90 + 'ms'; io.observe(el); });

// parallax + nav state + horizontal scroll
const para = $$('[data-parallax]');
const hs = $('#hscroll'), track = $('#hsTrack');
let ticking = false;
function frame() {
  const y = scrollY, vh = innerHeight;
  nav.classList.toggle('solid', y > 60);
  if (!still) para.forEach(el => {
    const r = el.parentElement.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) return;
    el.style.transform = `translate3d(0,${(-r.top * el.dataset.parallax).toFixed(1)}px,0)`;
  });
  if (innerWidth > 900 && hs) {
    const r = hs.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / (r.height - vh)));
    track.style.transform = `translate3d(${-p * (track.scrollWidth - innerWidth)}px,0,0)`;
  }
  ticking = false;
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
addEventListener('resize', frame);
frame();

// lightbox
const lb = $('#lb'), lbImg = $('img', lb), imgs = $$('#gallery img');
let idx = 0;
const show = i => { idx = (i + imgs.length) % imgs.length; lbImg.src = imgs[idx].src; lbImg.alt = imgs[idx].alt; };
imgs.forEach((im, i) => im.parentElement.addEventListener('click', () => { show(i); lb.hidden = false; document.body.style.overflow = 'hidden'; }));
const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
$('.lb-close').onclick = close;
$('.prev').onclick = () => show(idx - 1);
$('.next').onclick = () => show(idx + 1);
lb.addEventListener('click', e => { if (e.target === lb) close(); });
addEventListener('keydown', e => {
  if (lb.hidden) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') show(idx - 1);
  if (e.key === 'ArrowRight') show(idx + 1);
});

// currency switch (rates are rough guides; update as needed)
const rates = { GBP: [1, '£'], EUR: [1.17, '€'], USD: [1.3, '$'] };
$$('.cur button').forEach(b => b.onclick = () => {
  $$('.cur button').forEach(x => x.classList.toggle('on', x === b));
  const [r, sym] = rates[b.dataset.cur];
  $$('[data-gbp]').forEach(el => {
    let v = el.dataset.gbp * r;
    v = r > 100 ? Math.round(v / 100000) * 100000 : r > 10 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10;
    el.textContent = sym + v.toLocaleString('en-GB');
  });
});

// booking calendar: click a date to request it
(() => {
  let BOOKED = []; // filled from Supabase blocked_dates
  const el = $('#cal'), note = $('#calNote'), field = $('#dateField');
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let view = new Date(today.getFullYear(), today.getMonth(), 1), sel = '';
  function render() {
    const first = (view.getDay() + 6) % 7, days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const atMin = view <= new Date(today.getFullYear(), today.getMonth(), 1);
    let h = `<div class="cal-head"><button type="button" data-d="-1" aria-label="Previous month" ${atMin ? 'disabled' : ''}>‹</button><b>${view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><button type="button" data-d="1" aria-label="Next month">›</button></div><div class="cal-grid">`;
    h += ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<span>${d}</span>`).join('') + '<i></i>'.repeat(first);
    for (let n = 1; n <= days; n++) {
      const d = new Date(view.getFullYear(), view.getMonth(), n), k = iso(d), off = d < today || BOOKED.includes(k);
      h += `<button type="button" data-date="${k}" class="${k === sel ? 'sel ' : ''}${+d === +today ? 'today ' : ''}${BOOKED.includes(k) ? 'booked' : ''}" ${off ? 'disabled' : ''} aria-label="${d.toDateString()}">${n}</button>`;
    }
    el.innerHTML = h + '</div>';
  }
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.d) { view.setMonth(view.getMonth() + +b.dataset.d); render(); return; }
    sel = b.dataset.date; field.value = sel; render();
    note.textContent = 'Requesting ' + new Date(sel).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '. Fill in the form to send.';
    $('#form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#form [name=name]').focus({ preventScroll: true });
  });
  render();
  const { supabaseUrl: U, supabaseKey: K } = window.WEP;
  fetch(`${U}/rest/v1/blocked_dates?select=event_date`, { headers: { apikey: K, Authorization: 'Bearer ' + K } })
    .then(r => r.ok ? r.json() : [])
    .then(rows => { BOOKED = rows.map(r => r.event_date); render(); })
    .catch(() => {});
})();

// enquiry form: save to Supabase and, when configured, forward to Formspree
$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, msg = $('#formMsg'), btn = $('button[type=submit]', f);
  const { supabaseUrl: U, supabaseKey: K, formspree } = window.WEP;
  const d = Object.fromEntries(new FormData(f));
  const row = { name: d.name, email: d.email, type: d.type, event_date: d.date || null, location: d.location || null, message: d.message || null };
  btn.disabled = true; msg.textContent = 'Sending…';
  try {
    const saved = await fetch(`${U}/rest/v1/enquiries`, {
      method: 'POST',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    let mailed = false;
    if (formspree) {
      const r = await fetch(formspree, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(d) });
      mailed = r.ok;
    }
    if (!saved.ok && !mailed) throw new Error('failed');
    f.reset(); msg.textContent = 'Thanks, enquiry received. I will reply within a day.';
  } catch {
    msg.textContent = 'Something went wrong. Please email hello@worldeventphotography.com instead.';
  }
  btn.disabled = false;
});
