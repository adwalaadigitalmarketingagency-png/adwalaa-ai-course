/**
 * ADWALAA real backend form capture
 * Saves to server-side storage and then opens WhatsApp.
 */
(function(){
  'use strict';
  const WHATSAPP_NUMBER = '918931074153';

  function text(v){ return String(v || '').trim(); }

  function buildWhatsAppMessage(formData, formType){
    const lines = [
      'Hello Adwalaa, I want help for my business.',
      '',
      'Form Type: ' + (formType || 'Website Enquiry'),
      text(formData.get('name')) && 'Name: ' + text(formData.get('name')),
      text(formData.get('phone')) && 'Mobile: ' + text(formData.get('phone')),
      text(formData.get('email')) && 'Email: ' + text(formData.get('email')),
      text(formData.get('business')) && 'Business: ' + text(formData.get('business')),
      text(formData.get('category')) && 'Category: ' + text(formData.get('category')),
      text(formData.get('service')) && 'Required Service: ' + text(formData.get('service')),
      text(formData.get('district')) && text(formData.get('state')) && 'Location: ' + text(formData.get('district')) + ', ' + text(formData.get('state')),
      text(formData.get('business_link')) && 'Business Link: ' + text(formData.get('business_link')),
      text(formData.get('message')) && 'Requirement: ' + text(formData.get('message'))
    ].filter(Boolean);
    return lines.join('\n');
  }

  async function postLead(url, payload){
    const response = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    return response.json().catch(()=>({ok:false,error:'Invalid server response'}));
  }

  function showMessage(form, message, ok){
    let sentMsg = form.querySelector('.form-sent');
    if (!sentMsg) {
      sentMsg = document.createElement('p');
      sentMsg.className = 'form-sent';
      form.appendChild(sentMsg);
    }
    sentMsg.textContent = message;
    sentMsg.classList.add('show');
    if (!ok) sentMsg.style.color = '#ffb4b4';
    setTimeout(() => sentMsg.classList.remove('show'), 8000);
  }

  function attach(form, type){
    form.addEventListener('submit', async function(event){
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const formData = new FormData(form);
      const payload = {
        name: text(formData.get('name')),
        phone: text(formData.get('phone')),
        email: text(formData.get('email')),
        business: text(formData.get('business')),
        category: text(formData.get('category')),
        state: text(formData.get('state')),
        district: text(formData.get('district')),
        service: text(formData.get('service')),
        business_link: text(formData.get('business_link')),
        message: text(formData.get('message')),
        leadSource: 'website',
        page: location.pathname.split('/').pop() || 'index.html'
      };
      const submitBtn = form.querySelector('.form-submit');
      const old = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span>Saving…</span>'; }
      let ok = false;
      try {
        const result = await postLead(type === 'audit' ? '/api/audit' : '/api/contact', payload);
        ok = !!result.ok;
        window.__adwalaaLastLeadResult = result;
      } catch (error) {
        ok = false;
      }
      const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(buildWhatsAppMessage(formData, form.dataset.formType || 'Website Enquiry'))}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = old; }
      if (ok) {
        const leadResult = window.__adwalaaLastLeadResult || {};
        const email = leadResult.email || {};
        let message = '✓ Details saved successfully. WhatsApp opened for direct discussion.';
        if (email.clientSent) message = '✓ Details saved successfully. Client confirmation email and WhatsApp both have been triggered.';
        else if (email.configured && !email.clientSent) message = '✓ Details saved successfully. WhatsApp opened, but client email could not be sent.';
        else if (!email.configured) message = '✓ Details saved successfully. WhatsApp opened. Email system is not configured yet.';
        showMessage(form, message, true);
        form.reset();
      } else {
        showMessage(form, '✓ WhatsApp opened. Server save did not complete, so please send your message there.', false);
      }
    }, true);
  }

  function init(){
    const contactForm = document.getElementById('contactForm');
    const auditForm = document.getElementById('auditForm');
    if (contactForm) attach(contactForm, 'contact');
    if (auditForm) attach(auditForm, 'audit');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
