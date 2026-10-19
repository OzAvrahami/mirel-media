// Production contact transport. Keep the approved visual interactions in app.js.
(() => {
'use strict';
const form=document.getElementById('inquiry-form');
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
 const controls = [...form.querySelectorAll('input, textarea, select, button')];
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
  requestId = null; lastPayload = null;
 } catch (error) {
  const message = ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)
   ? 'We could not confirm your submission. It may have been sent. Please wait before trying again; another submission could send a duplicate.'
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

})();
