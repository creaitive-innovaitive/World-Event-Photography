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
const rates = { GBP: [1, '£'], USD: [1.3, '$'], THB: [46, '฿'], VND: [33000, '₫'] };
$$('.cur button').forEach(b => b.onclick = () => {
  $$('.cur button').forEach(x => x.classList.toggle('on', x === b));
  const [r, sym] = rates[b.dataset.cur];
  $$('[data-gbp]').forEach(el => {
    let v = el.dataset.gbp * r;
    v = r > 100 ? Math.round(v / 100000) * 100000 : r > 10 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10;
    el.textContent = sym + v.toLocaleString('en-GB');
  });
});
