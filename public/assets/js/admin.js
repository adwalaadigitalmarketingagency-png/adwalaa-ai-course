(function(){
  'use strict';

  const state = {
    contacts: [],
    audits: [],
    clients: [],
    content: { acceptingClients:true, announcementActive:false, announcementText:'', faqs:[] },
    currentPanel: 'dashboard',
    viewContext: null,
    editingClientId: null,
    importContext: null,
    importRecords: []
  };

  const bodyPage = document.body.dataset.page || '';

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function esc(str){
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
  }

  function formatDate(value){
    if (!value) return '—';
    try { return new Intl.DateTimeFormat('en-IN',{ day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true }).format(new Date(value)); }
    catch { return value; }
  }

  function timeAgo(value){
    if (!value) return '';
    const diff = Date.now() - new Date(value).getTime();
    const mins = Math.max(0, Math.floor(diff/60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins/60); if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs/24); return `${days}d ago`;
  }

  function badgeClass(status){
    const map = { 'new':'badge-new','read':'badge-read','replied':'badge-replied','in-progress':'badge-progress','done':'badge-done','active':'badge-active','on-hold':'badge-hold','closed':'badge-closed' };
    return map[status] || 'badge-read';
  }

  function toast(message, type='success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-icon">${type === 'error' ? '✕' : '✓'}</div><span>${esc(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, 2800);
  }

  function qs(sel){ return document.querySelector(sel); }

  function initLoginPage(){
    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('loginError');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.classList.remove('show');
      const username = document.getElementById('loginUser').value.trim();
      const password = document.getElementById('loginPass').value;
      const btn = form.querySelector('.login-btn');
      const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Signing in…';
      try {
        await api('/api/auth/login', { method:'POST', body: JSON.stringify({ username, password }) });
        window.location.href = 'admin.html';
      } catch (error) {
        errorEl.textContent = error.message || 'Login failed';
        errorEl.classList.add('show');
        btn.disabled = false; btn.innerHTML = old;
      }
    });
  }

  async function ensureAdminAuth(){
    try { await api('/api/auth/me'); }
    catch { window.location.replace('admin-login.html'); return false; }
    return true;
  }

  function bindAdminChrome(){
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    qs('#topbarMenuBtn')?.addEventListener('click', ()=>{ sidebar.classList.add('open'); overlay.classList.add('open'); });
    overlay?.addEventListener('click', ()=>{ sidebar.classList.remove('open'); overlay.classList.remove('open'); });
    qs('#logoutBtn')?.addEventListener('click', async ()=>{ try { await api('/api/auth/logout', { method:'POST' }); } catch {} window.location.replace('admin-login.html'); });
    document.querySelectorAll('.nav-item[data-panel]').forEach(btn => btn.addEventListener('click', ()=> showPanel(btn.dataset.panel)));
    setInterval(()=>{ const el = qs('#topbarTime'); if (el) el.textContent = new Date().toLocaleTimeString('en-IN'); }, 1000);
  }

  async function loadAll(){
    const [dashboard, contacts, audits, clients, content] = await Promise.all([
      api('/api/admin/dashboard'),
      api('/api/admin/contacts'),
      api('/api/admin/audits'),
      api('/api/admin/clients'),
      api('/api/admin/content')
    ]);
    state.contacts = contacts.items || [];
    state.audits = audits.items || [];
    state.clients = clients.items || [];
    state.content = content.content || state.content;
    renderDashboard(dashboard);
    renderContacts();
    renderAudits();
    renderClients();
    renderContent();
    updateBadges();
  }

  function showPanel(panel){
    state.currentPanel = panel;
    document.querySelectorAll('.admin-panel').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.nav-item[data-panel]').forEach(x=>x.classList.remove('active'));
    qs('#panel-' + panel)?.classList.add('active');
    document.querySelector(`.nav-item[data-panel="${panel}"]`)?.classList.add('active');
    const title = {dashboard:'Dashboard',contacts:'Contact Submissions',audits:'Free Audit Requests',clients:'Clients List',content:'Content Manager'}[panel] || 'Dashboard';
    qs('#topbarTitle').textContent = title;
    document.getElementById('adminSidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
  }

  function updateBadges(){
    const contactsNew = state.contacts.filter(x=>x.status==='new').length;
    const auditsNew = state.audits.filter(x=>x.status==='new').length;
    const total = contactsNew + auditsNew;
    const set = (id, val) => { const el=qs('#'+id); if (!el) return; el.textContent = val; el.style.display = val ? '' : 'none'; };
    set('badge-contacts', contactsNew); set('badge-audits', auditsNew); set('badge-dash', total);
  }

  function renderDashboard(data){
    const stats = data?.stats || { contacts:state.contacts.filter(x=>x.status==='new').length, audits:state.audits.filter(x=>x.status==='new').length, clients:state.clients.filter(x=>x.status==='active').length, totalLeads:state.contacts.length+state.audits.length };
    qs('#stat-contacts').textContent = stats.contacts;
    qs('#stat-audits').textContent = stats.audits;
    qs('#stat-clients').textContent = stats.clients;
    qs('#stat-total-leads').textContent = stats.totalLeads;
    const activity = data?.activity || [];
    const feed = qs('#activityFeed');
    if (!activity.length) { feed.innerHTML = '<div class="empty-state"><p>No activity yet.</p></div>'; return; }
    feed.innerHTML = activity.map(item => `
      <div class="activity-item">
        <span class="activity-dot ${item.color || 'blue'}"></span>
        <div>
          <strong>${esc(item.title)}</strong>
          <div class="td-sub">${esc(timeAgo(item.createdAt))}${item.subtitle ? ' · ' + esc(item.subtitle) : ''}</div>
        </div>
      </div>
    `).join('');
  }

  function renderContacts(){
    const search = (qs('#contactSearch')?.value || '').toLowerCase().trim();
    const filter = qs('#contactFilter')?.value || 'all';
    let items = state.contacts.slice();
    if (filter !== 'all') items = items.filter(x=>x.status===filter);
    if (search) items = items.filter(x => [x.name,x.phone,x.business,x.category,x.service,x.district].join(' ').toLowerCase().includes(search));
    qs('#contactsCount').textContent = `${items.length} record(s)`;
    const tbody = qs('#contactsTableBody');
    if (!items.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>No contact submissions yet.</p></div></td></tr>`; return; }
    tbody.innerHTML = items.map(item => `
      <tr class="${item.status==='new'?'unread':''}">
        <td><div class="td-name">${esc(item.name)}</div><div class="td-sub">${esc(item.phone)}</div></td>
        <td>${esc(item.business || '—')}</td>
        <td>${esc(item.service || '—')}</td>
        <td>${esc([item.district,item.state].filter(Boolean).join(', ') || '—')}</td>
        <td><span class="badge ${badgeClass(item.status)}">${esc(item.status)}</span></td>
        <td>${esc(formatDate(item.createdAt))}</td>
        <td><div class="btn-group">
          <button class="btn-action" data-view-contact="${item.id}">View</button>
          <button class="btn-action success" data-status-contact="${item.id}" data-next="replied">Reply</button>
          <button class="btn-action danger" data-del-contact="${item.id}">Delete</button>
        </div></td>
      </tr>
    `).join('');
  }

  function renderAudits(){
    const search = (qs('#auditSearch')?.value || '').toLowerCase().trim();
    const filter = qs('#auditFilter')?.value || 'all';
    let items = state.audits.slice();
    if (filter !== 'all') items = items.filter(x=>x.status===filter);
    if (search) items = items.filter(x => [x.name,x.business,x.phone,x.email,x.category,x.district].join(' ').toLowerCase().includes(search));
    qs('#auditsCount').textContent = `${items.length} record(s)`;
    const tbody = qs('#auditsTableBody');
    if (!items.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>No audit requests yet.</p></div></td></tr>`; return; }
    tbody.innerHTML = items.map(item => `
      <tr class="${item.status==='new'?'unread':''}">
        <td><div class="td-name">${esc(item.name)}</div><div class="td-sub">${esc(item.email || '—')}</div></td>
        <td>${esc(item.business || '—')}</td>
        <td>${esc(item.phone || '—')}</td>
        <td>${esc([item.district,item.state].filter(Boolean).join(', ') || '—')}</td>
        <td><span class="badge ${badgeClass(item.status)}">${esc(item.status)}</span></td>
        <td>${esc(formatDate(item.createdAt))}</td>
        <td><div class="btn-group">
          <button class="btn-action" data-view-audit="${item.id}">View</button>
          <button class="btn-action success" data-status-audit="${item.id}" data-next="done">Done</button>
          <button class="btn-action danger" data-del-audit="${item.id}">Delete</button>
        </div></td>
      </tr>
    `).join('');
  }

  function renderClients(){
    const search = (qs('#clientSearch')?.value || '').toLowerCase().trim();
    const filter = qs('#clientFilter')?.value || 'all';
    let items = state.clients.slice();
    if (filter !== 'all') items = items.filter(x=>x.status===filter);
    if (search) items = items.filter(x => [x.name,x.business,x.phone,x.email,x.service].join(' ').toLowerCase().includes(search));
    qs('#clientsCount').textContent = `${items.length} record(s)`;
    const tbody = qs('#clientsTableBody');
    if (!items.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>No clients added yet.</p></div></td></tr>`; return; }
    tbody.innerHTML = items.map(item => `
      <tr>
        <td><div class="td-name">${esc(item.name)}</div><div class="td-sub">${esc(item.phone || '—')}</div></td>
        <td>${esc(item.business || '—')}</td>
        <td>${esc(item.service || '—')}</td>
        <td>${esc(item.startDate || '—')}</td>
        <td><span class="badge ${badgeClass(item.status)}">${esc(item.status)}</span></td>
        <td>${esc(item.notes || '—')}</td>
        <td><div class="btn-group">
          <button class="btn-action" data-edit-client="${item.id}">Edit</button>
          ${item.phone ? `<a class="btn-action success" href="https://wa.me/${encodeURIComponent(item.phone.replace(/\D/g,''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn-action danger" data-del-client="${item.id}">Delete</button>
        </div></td>
      </tr>
    `).join('');
  }

  function renderContent(){
    qs('#toggleAccepting').checked = !!state.content.acceptingClients;
    qs('#toggleAnnouncement').checked = !!state.content.announcementActive;
    qs('#announcementText').value = state.content.announcementText || '';
    qs('#announcementPreview').textContent = state.content.announcementText || 'Preview will appear here…';
    const box = qs('#faqEditorList');
    const faqs = state.content.faqs || [];
    box.innerHTML = faqs.map((faq, idx) => `
      <div class="faq-editor-item" data-faq-row="${idx}">
        <div class="admin-form-group"><label>Question</label><input type="text" data-faq-question value="${esc(faq.question)}"></div>
        <div class="admin-form-group"><label>Answer</label><textarea rows="3" data-faq-answer>${esc(faq.answer)}</textarea></div>
        <div class="btn-group"><button class="btn-action danger" data-del-faq="${idx}">Delete FAQ</button></div>
      </div>
    `).join('');
  }

  function openModal(id){ qs('#'+id).classList.add('open'); }
  function closeModal(modal){ modal.classList.remove('open'); }

  function buildDetailFields(item, type){
    const serviceLabel = type === 'audit' ? 'Business Link' : 'Service';
    const serviceValue = type === 'audit' ? item.businessLink : item.service;
    return `
      <div class="detail-grid">
        <div class="detail-field"><strong>Name</strong><p>${esc(item.name || '—')}</p></div>
        <div class="detail-field"><strong>Phone</strong><p>${esc(item.phone || '—')}</p></div>
        <div class="detail-field"><strong>Email</strong><p>${esc(item.email || '—')}</p></div>
        <div class="detail-field"><strong>Business</strong><p>${esc(item.business || '—')}</p></div>
        <div class="detail-field"><strong>Category</strong><p>${esc(item.category || '—')}</p></div>
        <div class="detail-field"><strong>Location</strong><p>${esc([item.district,item.state].filter(Boolean).join(', ') || '—')}</p></div>
        <div class="detail-field"><strong>${esc(serviceLabel)}</strong><p>${esc(serviceValue || '—')}</p></div>
        <div class="detail-field"><strong>Lead Source</strong><input id="viewLeadSource" type="text" value="${esc(item.leadSource || 'website')}"></div>
        <div class="detail-field"><strong>Status</strong>
          <select id="viewStatus">
            ${['new','read','replied','in-progress','done'].map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="detail-field"><strong>Follow-up Date</strong><input id="viewFollowUpDate" type="date" value="${esc((item.followUpDate || '').slice(0,10))}"></div>
        <div class="detail-field detail-field-full"><strong>Message</strong><p>${esc(item.message || '—')}</p></div>
        <div class="detail-field detail-field-full"><strong>Notes</strong><textarea id="viewNotes" rows="4">${esc(item.notes || '')}</textarea></div>
      </div>
    `;
  }

  function openView(type, id){
    const item = (type === 'contact' ? state.contacts : state.audits).find(x=>x.id===id); if (!item) return;
    state.viewContext = { type, id };
    qs('#viewModalTitle').textContent = type === 'contact' ? 'Contact Submission Details' : 'Audit Request Details';
    qs('#viewModalBody').innerHTML = buildDetailFields(item, type);
    const waBtn = qs('#viewModalWABtn');
    waBtn.style.display = item.phone ? '' : 'none';
    if (item.phone) {
      const msg = encodeURIComponent(`Hello ${item.name || ''}, this is ADWALAA regarding your ${type === 'contact' ? 'contact enquiry' : 'free audit request'}.`);
      waBtn.href = `https://wa.me/${item.phone.replace(/\D/g,'')}?text=${msg}`;
    }
    openModal('viewModal');
  }

  async function saveViewModal(){
    if (!state.viewContext) return;
    const payload = { status: qs('#viewStatus').value, leadSource: qs('#viewLeadSource').value, followUpDate: qs('#viewFollowUpDate').value, notes: qs('#viewNotes').value };
    const type = state.viewContext.type === 'contact' ? 'contacts' : 'audits';
    const res = await api(`/api/admin/${type}/${state.viewContext.id}`, { method:'PATCH', body: JSON.stringify(payload) });
    if (type === 'contacts') state.contacts = state.contacts.map(x=>x.id===res.item.id?res.item:x); else state.audits = state.audits.map(x=>x.id===res.item.id?res.item:x);
    renderContacts(); renderAudits(); updateBadges(); renderDashboard(); toast('Saved successfully'); closeModal(qs('#viewModal'));
  }

  function openClientModal(id){
    const item = id ? state.clients.find(x=>x.id===id) : null;
    state.editingClientId = id || null;
    qs('#clientModalTitle').textContent = item ? 'Edit Client' : 'Add New Client';
    qs('#clientName').value = item?.name || '';
    qs('#clientBusiness').value = item?.business || '';
    qs('#clientPhone').value = item?.phone || '';
    qs('#clientEmail').value = item?.email || '';
    qs('#clientService').value = item?.service || '';
    qs('#clientStart').value = item?.startDate || '';
    qs('#clientStatus').value = item?.status || 'active';
    qs('#clientNotes').value = item?.notes || '';
    openModal('clientModal');
  }

  async function saveClient(){
    const payload = { name:qs('#clientName').value, business:qs('#clientBusiness').value, phone:qs('#clientPhone').value, email:qs('#clientEmail').value, service:qs('#clientService').value, startDate:qs('#clientStart').value, status:qs('#clientStatus').value, notes:qs('#clientNotes').value };
    let res;
    if (state.editingClientId) res = await api(`/api/admin/clients/${state.editingClientId}`, { method:'PUT', body: JSON.stringify(payload) });
    else res = await api('/api/admin/clients', { method:'POST', body: JSON.stringify(payload) });
    if (state.editingClientId) state.clients = state.clients.map(x=>x.id===res.item.id?res.item:x); else state.clients.unshift(res.item);
    renderClients(); renderDashboard(); toast(state.editingClientId ? 'Client updated' : 'Client added'); closeModal(qs('#clientModal'));
  }

  async function deleteRecord(kind, id){
    if (!confirm('Delete this record?')) return;
    await api(`/api/admin/${kind}/${id}`, { method:'DELETE' });
    state[kind] = state[kind].filter(x=>x.id!==id);
    if (kind==='contacts') renderContacts(); else if (kind==='audits') renderAudits(); else renderClients();
    updateBadges(); renderDashboard(); toast('Deleted');
  }

  function exportCsv(filename, rows){
    if (!rows.length) { toast('Nothing to export', 'error'); return; }
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(',')].concat(rows.map(row => headers.map(h => {
      const s = String(row[h] ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    }).join(','))).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  }

  function parseCsv(text){
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map(line => {
      const cols = splitCsvLine(line); const obj = {};
      headers.forEach((h,i)=> obj[h.trim()] = cols[i] || '');
      return obj;
    });
  }
  function splitCsvLine(line){
    const out=[]; let cur=''; let q=false;
    for (let i=0;i<line.length;i++) { const ch=line[i];
      if (q) { if (ch==='"' && line[i+1]==='"') { cur+='"'; i++; } else if (ch==='"') q=false; else cur+=ch; }
      else { if (ch===',') { out.push(cur); cur=''; } else if (ch==='"') q=true; else cur+=ch; }
    } out.push(cur); return out;
  }

  function openImport(kind, records){
    state.importContext = kind; state.importRecords = records;
    qs('#importModalTitle').textContent = `Import ${kind[0].toUpperCase()+kind.slice(1)} CSV Preview`;
    const stats = qs('#importStats');
    stats.innerHTML = `<span class="badge badge-read">Rows: ${records.length}</span>`;
    const head = qs('#importPreviewHead'); const body = qs('#importPreviewBody');
    const headers = records.length ? Object.keys(records[0]) : [];
    head.innerHTML = `<tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>`;
    body.innerHTML = records.slice(0,10).map(row=>`<tr>${headers.map(h=>`<td>${esc(row[h])}</td>`).join('')}</tr>`).join('');
    openModal('importModal');
  }

  async function confirmImport(){
    if (!state.importContext) return;
    const res = await api(`/api/admin/import/${state.importContext}`, { method:'POST', body: JSON.stringify({ records: state.importRecords }) });
    toast(`${res.imported} record(s) imported`);
    closeModal(qs('#importModal'));
    await loadAll();
  }

  async function saveContent(){
    const faqs = Array.from(document.querySelectorAll('#faqEditorList .faq-editor-item')).map(row => ({ question: row.querySelector('[data-faq-question]').value.trim(), answer: row.querySelector('[data-faq-answer]').value.trim() })).filter(x=>x.question&&x.answer);
    const payload = { acceptingClients: qs('#toggleAccepting').checked, announcementActive: qs('#toggleAnnouncement').checked, announcementText: qs('#announcementText').value.trim(), faqs };
    const res = await api('/api/admin/content', { method:'POST', body: JSON.stringify(payload) });
    state.content = res.content; renderContent(); toast('Content saved');
  }

  function bindEvents(){
    qs('#contactSearch')?.addEventListener('input', renderContacts); qs('#contactFilter')?.addEventListener('change', renderContacts);
    qs('#auditSearch')?.addEventListener('input', renderAudits); qs('#auditFilter')?.addEventListener('change', renderAudits);
    qs('#clientSearch')?.addEventListener('input', renderClients); qs('#clientFilter')?.addEventListener('change', renderClients);
    qs('#saveContentBtn')?.addEventListener('click', saveContent);
    qs('#announcementText')?.addEventListener('input', ()=> qs('#announcementPreview').textContent = qs('#announcementText').value || 'Preview will appear here…');
    qs('#addFaqBtn')?.addEventListener('click', ()=>{ state.content.faqs.push({question:'',answer:''}); renderContent(); });
    qs('#saveClientBtn')?.addEventListener('click', saveClient);
    qs('#addClientBtn')?.addEventListener('click', ()=>openClientModal());
    qs('#viewModalSaveBtn')?.addEventListener('click', saveViewModal);
    qs('#confirmImportBtn')?.addEventListener('click', confirmImport);
    document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', ()=>closeModal(btn.closest('.modal-overlay'))));
    document.body.addEventListener('click', async (event) => {
      const el = event.target.closest('[data-view-contact],[data-view-audit],[data-del-contact],[data-del-audit],[data-status-contact],[data-status-audit],[data-edit-client],[data-del-client],[data-del-faq]');
      if (!el) return;
      if (el.dataset.viewContact) return openView('contact', el.dataset.viewContact);
      if (el.dataset.viewAudit) return openView('audit', el.dataset.viewAudit);
      if (el.dataset.delContact) return deleteRecord('contacts', el.dataset.delContact);
      if (el.dataset.delAudit) return deleteRecord('audits', el.dataset.delAudit);
      if (el.dataset.statusContact) { await api(`/api/admin/contacts/${el.dataset.statusContact}`, { method:'PATCH', body: JSON.stringify({ status: el.dataset.next }) }); await loadAll(); toast('Contact updated'); return; }
      if (el.dataset.statusAudit) { await api(`/api/admin/audits/${el.dataset.statusAudit}`, { method:'PATCH', body: JSON.stringify({ status: el.dataset.next }) }); await loadAll(); toast('Audit updated'); return; }
      if (el.dataset.editClient) return openClientModal(el.dataset.editClient);
      if (el.dataset.delClient) return deleteRecord('clients', el.dataset.delClient);
      if (el.dataset.delFaq !== undefined) { state.content.faqs.splice(Number(el.dataset.delFaq),1); renderContent(); return; }
    });

    const importerConfigs = [
      ['contacts', '#importContactsBtn', '#importContactsFile', state.contacts],
      ['audits', '#importAuditsBtn', '#importAuditsFile', state.audits],
      ['clients', '#importClientsBtn', '#importClientsFile', state.clients]
    ];
    importerConfigs.forEach(([kind, btnSel, fileSel]) => {
      qs(btnSel)?.addEventListener('click', ()=>qs(fileSel).click());
      qs(fileSel)?.addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const text = await file.text(); const records = parseCsv(text);
        openImport(kind, records);
        e.target.value = '';
      });
    });

    qs('#exportContacts')?.addEventListener('click', ()=> exportCsv('contacts.csv', state.contacts));
    qs('#exportAudits')?.addEventListener('click', ()=> exportCsv('audits.csv', state.audits));
    qs('#exportClientsBtn')?.addEventListener('click', ()=> exportCsv('clients.csv', state.clients));
  }

  async function initAdminPage(){
    if (!await ensureAdminAuth()) return;
    bindAdminChrome(); bindEvents(); await loadAll();
  }

  if (bodyPage === 'login') initLoginPage();
  if (bodyPage === 'admin') initAdminPage();

  window.adminApp = { closeModal };
})();
