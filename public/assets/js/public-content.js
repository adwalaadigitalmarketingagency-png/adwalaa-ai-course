(function(){
  'use strict';
  async function loadContent(){
    try {
      const res = await fetch('/api/public/content');
      const data = await res.json();
      if (!data.ok || !data.content) return;
      const content = data.content;
      applyBanner(content);
      applyFaqs(content);
    } catch (e) {}
  }

  function applyBanner(content){
    const existing = document.getElementById('globalAnnouncementBar');
    if (existing) existing.remove();
    const text = !content.acceptingClients
      ? 'Currently not accepting new projects. You can still send your requirement for review.'
      : (content.announcementActive && content.announcementText ? content.announcementText : '');
    if (!text) return;
    const bar = document.createElement('div');
    bar.id = 'globalAnnouncementBar';
    bar.className = 'global-announcement-bar';
    bar.innerHTML = `<div class="container"><strong>Notice:</strong> <span>${escapeHtml(text)}</span></div>`;
    const header = document.getElementById('siteHeader');
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
  }

  function applyFaqs(content){
    if (!Array.isArray(content.faqs) || !content.faqs.length) return;
    const list = document.querySelector('.faq-list');
    if (!list) return;
    list.innerHTML = content.faqs.map(item => `
      <details class="faq-item">
        <summary><span>${escapeHtml(item.question)}</span><span aria-hidden="true" class="faq-icon"></span></summary>
        <div class="faq-answer"><p>${escapeHtml(item.answer)}</p></div>
      </details>
    `).join('');
    const faqItems = list.querySelectorAll('.faq-item');
    faqItems.forEach((item) => {
      item.addEventListener('toggle', () => {
        if (!item.open) return;
        faqItems.forEach((otherItem) => { if (otherItem !== item) otherItem.open = false; });
      });
    });
  }

  function escapeHtml(str){
    return String(str || '').replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadContent);
  else loadContent();
})();
