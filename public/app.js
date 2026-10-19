(() => {
  'use strict';
  const body = document.body;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');
  const motionButton = document.querySelector('.motion-control');
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-toggle');
  const mobileNav = document.querySelector('.mobile-nav');
  const hero = document.querySelector('.hero');
  const stage = document.querySelector('.hero-stage');
  const progress = document.querySelector('.reading-progress');
  const statement = document.querySelector('.statement-band');
  const statementInner = document.querySelector('.statement-inner');
  let manuallyPaused = false;
  try { manuallyPaused = localStorage.getItem('mirel-direction-motion') === 'paused'; } catch {}
  let heroVisible = true;
  let animationFrame = 0;
  let lastDraw = 0;
  let canvasTime = 0;
  let width = 0, height = 0;
  const canvas = document.querySelector('#current-canvas');
  const ctx = canvas.getContext('2d');
  const motionAllowed = () => !manuallyPaused && !reducedMotion.matches && !document.hidden;

  function updateMotion() {
    const paused = manuallyPaused || reducedMotion.matches;
    body.classList.toggle('paused', paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', reducedMotion.matches ? 'Reduced motion is enabled in your device settings' : paused ? 'Resume decorative motion' : 'Pause decorative motion');
    motionButton.querySelector('.motion-label').textContent = reducedMotion.matches ? 'Reduced motion' : paused ? 'Resume motion' : 'Pause motion';
    motionButton.querySelector('.motion-icon').textContent = paused ? '▷' : 'Ⅱ';
    stage.style.setProperty('--mx', '0px');
    stage.style.setProperty('--my', '0px');
    if (motionAllowed() && heroVisible) startCanvas();
    else { cancelAnimationFrame(animationFrame); animationFrame = 0; }
    updateScroll();
  }

  motionButton.addEventListener('click', () => {
    if (reducedMotion.matches) return;
    manuallyPaused = !manuallyPaused;
    try { localStorage.setItem('mirel-direction-motion', manuallyPaused ? 'paused' : 'playing'); } catch {}
    updateMotion();
  });
  reducedMotion.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', () => {
    body.classList.toggle('page-hidden', document.hidden);
    updateMotion();
  });

  function closeMenu(returnFocus = false) {
    mobileNav.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    if (returnFocus) menuButton.focus();
  }
  menuButton.addEventListener('click', () => {
    const opening = mobileNav.hidden;
    mobileNav.hidden = !opening;
    menuButton.setAttribute('aria-expanded', String(opening));
    menuButton.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
    if (opening) mobileNav.querySelector('a').focus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !mobileNav.hidden) closeMenu(true);
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target) && !mobileNav.hidden) closeMenu();
  });

  const form = document.querySelector('#inquiry-form');
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', () => {
      closeMenu();
      const role = link.dataset.role;
      if (role) {
        const field = [...form.querySelectorAll('input[name="partner_role"]')].find(input => input.value === role);
        if (field) field.checked = true;
      }
      if (role || link.dataset.interest) {
        form.elements.interest.value = link.dataset.interest || (role === 'Publisher' ? 'Traffic partnerships' : 'Lead generation');
      }
    });
  });

  const creative = document.querySelector('.media-creative');
  const creativeCopy = ['MAKE<br>THEM<br><em>LOOK.</em>', 'GOOD.<br>BOLD.<br><em>SEEN.</em>', 'YOUR<br>NEXT<br><em>MOVE.</em>'];
  document.querySelector('.creative-switch').addEventListener('click', () => {
    const state = (Number(creative.dataset.creative) + 1) % 3;
    creative.dataset.creative = String(state);
    creative.querySelector('.ad-word').innerHTML = creativeCopy[state];
    const switcher = creative.querySelector('.creative-switch');
    switcher.setAttribute('aria-label', `Change the illustrative creative. Variation ${state + 1} of 3.`);
  });

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: .08, rootMargin: '0px 0px -35px 0px' });
    document.querySelectorAll('.reveal').forEach(element => revealObserver.observe(element));
    const activityObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        entry.target.classList.toggle('offscreen', !entry.isIntersecting);
        if (entry.target === hero) {
          heroVisible = entry.isIntersecting;
          updateMotion();
        }
      });
    }, { rootMargin: '100px 0px' });
    document.querySelectorAll('.hero,.marquee,.creative,.perspective,.contact').forEach(element => activityObserver.observe(element));
    body.classList.add('js');
  }
  document.addEventListener('focusin', event => {
    const parent = event.target.closest('.reveal');
    if (parent) parent.classList.add('in-view');
  });

  let scrollQueued = false;
  function updateScroll() {
    const y = window.scrollY;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    progress.style.transform = `scaleX(${Math.min(1, y / maxScroll)})`;
    header.classList.toggle('scrolled', y > 100);
    if (motionAllowed()) {
      const rect = statement.getBoundingClientRect();
      const amount = Math.max(0, Math.min(1, (window.innerHeight - rect.top) / (window.innerHeight + rect.height)));
      const travel = Math.max(0, statementInner.scrollWidth - window.innerWidth + 20);
      statementInner.style.setProperty('--band-x', `${-travel * amount}px`);
    } else statementInner.style.setProperty('--band-x', '0px');
    scrollQueued = false;
  }
  window.addEventListener('scroll', () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateScroll); }
  }, { passive: true });

  hero.addEventListener('pointermove', event => {
    if (!motionAllowed() || !finePointer.matches || innerWidth < 801) return;
    const rect = hero.getBoundingClientRect();
    stage.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width - .5) * 28}px`);
    stage.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height - .5) * 20}px`);
  }, { passive: true });
  hero.addEventListener('pointerleave', () => {
    stage.style.setProperty('--mx', '0px'); stage.style.setProperty('--my', '0px');
  });

  function sizeCanvas() {
    width = hero.clientWidth; height = hero.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    if (ctx) { ctx.setTransform(ratio, 0, 0, ratio, 0, 0); drawCurrent(canvasTime); }
    if (innerWidth > 800) closeMenu();
    updateScroll();
  }
  function drawCurrent(time) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const center = width * .78;
    const radius = Math.max(170, width * .29);
    for (let i = 0; i < 21; i++) {
      const shift = i * 13;
      const sway = Math.sin(time * .00022 + i * .085) * 32;
      ctx.beginPath();
      ctx.moveTo(center - radius + shift * .15, height * .1);
      ctx.bezierCurveTo(center - radius - 120 + sway, height * .55, center + radius + 30 + sway, height * .18 + shift, center + radius - shift, height * .95);
      ctx.strokeStyle = `rgba(75,91,181,${.035 + (i % 4) * .012})`;
      ctx.lineWidth = i % 5 === 0 ? 1 : .6;
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const p = ((time * .000026 + i / 8) % 1);
      const x = center + Math.sin(p * Math.PI * 2 + i) * radius * .8;
      const y = p * height;
      ctx.fillStyle = `rgba(119,85,180,${Math.sin(p * Math.PI) * .35})`;
      ctx.beginPath(); ctx.arc(x, y, i % 2 ? 1.2 : 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  function animateCanvas(time) {
    if (!motionAllowed() || !heroVisible) { animationFrame = 0; return; }
    if (time - lastDraw > 32) {
      canvasTime += Math.min(time - lastDraw, 50);
      lastDraw = time; drawCurrent(canvasTime);
    }
    animationFrame = requestAnimationFrame(animateCanvas);
  }
  function startCanvas() {
    if (!animationFrame && ctx) { lastDraw = performance.now(); animationFrame = requestAnimationFrame(animateCanvas); }
  }
  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { sizeCanvas(); resizeQueued = false; });
  }, { passive: true });
  window.addEventListener('load', sizeCanvas, { once: true });
  document.fonts?.ready.then(sizeCanvas);
  sizeCanvas(); updateMotion();
})();
