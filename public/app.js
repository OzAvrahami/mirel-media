const menuButton = document.querySelector('.menu-toggle');
const mobileMenu = document.getElementById('mobile-menu');
function closeMenu(){menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','Open navigation');mobileMenu.hidden=true;}
menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')==='true';menuButton.setAttribute('aria-expanded',String(!open));menuButton.setAttribute('aria-label',open?'Open navigation':'Close navigation');mobileMenu.hidden=open;});
mobileMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!mobileMenu.hidden){closeMenu();menuButton.focus();}});
window.matchMedia('(min-width:761px)').addEventListener('change',e=>{if(e.matches)closeMenu();});
const serviceContent={
 media:{kicker:'REACH WITH PURPOSE',title:'Put your message where it matters.',copy:'Bring audience, creative and channel planning together around one clear business objective. Build a campaign with a reason behind every click.',tags:['Campaign planning','Creative direction','Ongoing optimization']},
 leads:{kicker:'TURN INTEREST INTO OPPORTUNITY',title:'Find people ready for a conversation.',copy:'Start with your ideal customer and the type of inquiry your team can use. Explore lead acquisition, campaign targeting and a handoff that fits your sales process.',tags:['Audience definition','Lead acquisition','Sales handoff']},
 partnerships:{kicker:'TRAFFIC MEETS OPPORTUNITY',title:'Find the right partnership.',copy:'Start with the advertiser’s goals and the publisher’s audience. Discuss traffic sources, campaign requirements and how a potential partnership could work.',tags:['Traffic sources','Campaign alignment','Partnership scope']}
};
document.querySelectorAll('.service').forEach(button=>button.addEventListener('click',()=>{
 document.querySelectorAll('.service').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
 const data=serviceContent[button.dataset.service];
 document.getElementById('detail-kicker').textContent=data.kicker;
 document.getElementById('detail-title').textContent=data.title;
 document.getElementById('detail-copy').textContent=data.copy;
 document.getElementById('detail-tags').replaceChildren(...data.tags.map(text=>{const el=document.createElement('span');el.textContent=text;return el;}));
 if(window.matchMedia('(max-width:760px)').matches)document.getElementById('service-detail').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'center'});
}));
const form=document.getElementById('enquiry-form');
const submitButton = document.getElementById('send-inquiry');
const formStatus = document.getElementById('form-status');
let sending = false;
let requestId = null;
let lastPayload = null;
function showFormStatus(message, kind = '') {
 formStatus.textContent = message;
 formStatus.dataset.kind = kind;
}
async function loadContactConfig() {
 try {
  const response = await fetch('/api/contact/config', { signal: AbortSignal.timeout(8000) });
  const config = response.ok ? await response.json() : null;
  if (!config?.enabled) throw new Error();
  submitButton.disabled = false;
  submitButton.firstChild.textContent = 'Send inquiry ';
 } catch {
  submitButton.disabled = true;
  submitButton.firstChild.textContent = 'Form unavailable ';
  showFormStatus('The contact form is temporarily unavailable. Please try again later.', 'error');
 }
}
loadContactConfig();
form.addEventListener('submit', async event => {
 event.preventDefault();
 if (sending || submitButton.disabled) return;
 const name = form.elements.namedItem('name');
 const goal = form.elements.namedItem('goal');
 name.setCustomValidity(name.value.trim() ? '' : 'Please enter your name.');
 goal.setCustomValidity(goal.value.trim() ? '' : 'Please tell us a little about your goal.');
 if (!form.reportValidity()) return;
 const data = Object.fromEntries(new FormData(form));
 for (const key of Object.keys(data)) data[key] = data[key].trim();
 const payload = JSON.stringify(data);
 if (payload !== lastPayload) { requestId = crypto.randomUUID(); lastPayload = payload; }
 data.request_id = requestId;
 const controls = [...form.querySelectorAll('input, textarea, button')];
 const disabledState = controls.map(control => control.disabled);
 sending = true;
 form.setAttribute('aria-busy', 'true');
 controls.forEach(control => { control.disabled = true; });
 submitButton.firstChild.textContent = 'Sending… ';
 showFormStatus('Submitting your inquiry…');
 try {
  const response = await fetch('/api/contact', {
   method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify(data), signal: AbortSignal.timeout(20000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'We could not submit your inquiry. Please try again.');
  showFormStatus('Thanks — your inquiry has been submitted. We’ll be in touch.', 'success');
  form.reset();
  updateRolePrompt(form.elements.namedItem('partner_role').value);
  requestId = null; lastPayload = null;
 } catch (error) {
  const message = ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)
   ? 'We could not confirm your submission. Check your connection and try again.'
   : error.message;
  showFormStatus(message, 'error');
 } finally {
  sending = false;
  form.removeAttribute('aria-busy');
  controls.forEach((control, i) => { control.disabled = disabledState[i]; });
  submitButton.firstChild.textContent = 'Send inquiry ';
  formStatus.focus({ preventScroll: true });
 }
});
form.addEventListener('input', event => {
 if (event.target.setCustomValidity) event.target.setCustomValidity('');
});

// Two inquiry paths, with accessible tabs and no invented network or account access.
const partnerTabs = [...document.querySelectorAll('.partner-tab')];
function selectPartner(type) {
 if(!['advertiser','publisher'].includes(type)) return;
 partnerTabs.forEach(tab => {
  const selected = tab.dataset.partner === type;
  tab.classList.toggle('active', selected);
  tab.setAttribute('aria-selected', String(selected));
  tab.tabIndex = selected ? 0 : -1;
 });
 document.querySelectorAll('.partner-panel').forEach(panel => {panel.hidden = panel.id !== 'panel-' + type;});
}
partnerTabs.forEach((tab,index) => {
 tab.addEventListener('click', () => selectPartner(tab.dataset.partner));
 tab.addEventListener('keydown', event => {
  let next;
  if(event.key === 'ArrowRight') next = (index + 1) % partnerTabs.length;
  else if(event.key === 'ArrowLeft') next = (index - 1 + partnerTabs.length) % partnerTabs.length;
  else if(event.key === 'Home') next = 0;
  else if(event.key === 'End') next = partnerTabs.length - 1;
  else return;
  event.preventDefault();
  selectPartner(partnerTabs[next].dataset.partner);
  partnerTabs[next].focus();
 });
});
document.querySelectorAll('[data-partner-link]').forEach(link => link.addEventListener('click', () => selectPartner(link.dataset.partnerLink)));
const roleInputs = [...form.querySelectorAll('input[name="partner_role"]')];
const goalLabel = document.getElementById('goal-label');
const goalPrompts = {
 Advertiser:{label:'Tell us about your campaign',placeholder:'Your offer, target audience and the leads you’re looking for…'},
 Publisher:{label:'Tell us about your traffic',placeholder:'Your channels, audience, markets and the campaigns you’d like to explore…'},
 Other:{label:'Tell us about the opportunity',placeholder:'What would you like to explore with mirel-media?'}
};
function updateRolePrompt(role) {
 const prompt = goalPrompts[role] || goalPrompts.Other;
 goalLabel.textContent = prompt.label;
 form.elements.goal.placeholder = prompt.placeholder;
}
roleInputs.forEach(input => input.addEventListener('change', () => updateRolePrompt(input.value)));
document.querySelectorAll('[data-partner-enquiry]').forEach(link => link.addEventListener('click', () => {
 const publisher = link.dataset.partnerEnquiry === 'publisher';
 const role = publisher ? 'Publisher' : 'Advertiser';
 roleInputs.forEach(input => {input.checked = input.value === role;});
 const interest = publisher ? 'Traffic partnerships' : 'Lead generation';
 form.querySelectorAll('input[name="interest"]').forEach(input => {input.checked = input.value === interest;});
 updateRolePrompt(role);
}));

// The journey changes only on request. No simulated live metrics or lead notifications.
const journeyButtons = [...document.querySelectorAll('.journey-step')];
const journeyCanvas = document.getElementById('journey-canvas');
journeyButtons.forEach(button => button.addEventListener('click', () => {
 const stage = button.dataset.stage;
 journeyButtons.forEach(item => {
  const active = item === button;
  item.classList.toggle('active', active);
  item.setAttribute('aria-pressed', String(active));
 });
 journeyCanvas.dataset.stage = stage;
 document.querySelectorAll('.journey-scene').forEach(scene => {scene.hidden = scene.id !== 'scene-' + stage;});
 document.querySelectorAll('.stage-dots i').forEach((dot, index) => dot.classList.toggle('active', index === Number(stage) - 1));
 if(window.matchMedia('(max-width:760px)').matches)journeyCanvas.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'center'});
}));

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const motionButton = document.querySelector('.motion-toggle');
const heroVisual = document.getElementById('hero-visual');
let manualPause = false;
let revealObserver;
try { manualPause = (localStorage.getItem('mirel-media-motion-paused') ?? localStorage.getItem('mirelads-motion-paused') ?? localStorage.getItem('lior-motion-paused')) === 'true'; } catch {}
function motionPaused() { return manualPause || reducedMotion.matches; }
function revealAll() {
 document.querySelectorAll('.reveal').forEach(el => {el.classList.remove('awaiting-reveal');el.classList.add('is-visible');});
 if(revealObserver) revealObserver.disconnect();
}
function syncMotion() {
 const paused = motionPaused();
 document.documentElement.classList.toggle('motion-paused', paused);
 motionButton.setAttribute('aria-pressed', String(paused));
 motionButton.setAttribute('aria-label', paused ? 'Resume decorative animations' : 'Pause decorative animations');
 motionButton.querySelector('.motion-label').textContent = paused ? 'Resume motion' : 'Pause motion';
 motionButton.querySelector('.motion-icon').textContent = paused ? '▷' : 'Ⅱ';
 if(paused) {heroVisual.style.setProperty('--mx', '0px');heroVisual.style.setProperty('--my', '0px');revealAll();}
}
motionButton.addEventListener('click', () => {
 manualPause = !manualPause;
 try { localStorage.setItem('mirel-media-motion-paused', String(manualPause)); } catch {}
 syncMotion();
});
reducedMotion.addEventListener('change', syncMotion);
syncMotion();

if('IntersectionObserver' in window && !motionPaused()) {
 revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
   if(entry.isIntersecting) {entry.target.classList.add('is-visible');revealObserver.unobserve(entry.target);}
  });
 }, {threshold:0.12, rootMargin:'0px 0px -15px 0px'});
 document.querySelectorAll('.reveal').forEach(el => {el.classList.add('awaiting-reveal');revealObserver.observe(el);});
 // Keep keyboard navigation visible even before a scroll reveal fires.
 document.addEventListener('focusin', event => {
  const parent = event.target.closest('.reveal');
  if(parent) {parent.classList.add('is-visible');revealObserver.unobserve(parent);}
 });
}

let pointerFrame = 0;
heroVisual.addEventListener('pointermove', event => {
 if(motionPaused() || !finePointer.matches || event.pointerType === 'touch') return;
 const bounds = heroVisual.getBoundingClientRect();
 const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 17;
 const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 13;
 cancelAnimationFrame(pointerFrame);
 pointerFrame = requestAnimationFrame(() => {
  if(motionPaused()) return;
  heroVisual.style.setProperty('--mx', x.toFixed(2) + 'px');
  heroVisual.style.setProperty('--my', y.toFixed(2) + 'px');
 });
});
heroVisual.addEventListener('pointerleave', () => {
 cancelAnimationFrame(pointerFrame);
 heroVisual.style.setProperty('--mx', '0px');heroVisual.style.setProperty('--my', '0px');
});
let scrollPending = false;
const header = document.querySelector('.header');
const progress = document.querySelector('.scroll-progress');
function updateScroll() {
 const distance = document.documentElement.scrollHeight - window.innerHeight;
 const amount = distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0;
 progress.style.transform = 'scaleX(' + amount + ')';
 header.classList.toggle('scrolled', window.scrollY > 25);
 scrollPending = false;
}
window.addEventListener('scroll', () => {if(!scrollPending) {scrollPending = true;requestAnimationFrame(updateScroll);}}, {passive:true});
window.addEventListener('resize', updateScroll, {passive:true});
updateScroll();
