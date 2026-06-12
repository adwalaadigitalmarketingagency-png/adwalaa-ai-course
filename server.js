const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
try { require('dotenv').config(); } catch (_) {}
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) {}

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'app-data.json');
const SESSION_COOKIE = 'adwalaa_sid';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const DEFAULT_LOCAL_ADMIN_PASS = 'ChangeThisLocalOnly@12345';
const ADMIN_PASS = process.env.ADMIN_PASS || (IS_PRODUCTION ? '' : DEFAULT_LOCAL_ADMIN_PASS);
const ADMIN_PASS_HASH = hashSecret(ADMIN_PASS);
const FORCE_SECURE_COOKIES = String(process.env.FORCE_SECURE_COOKIES || '').toLowerCase() === 'true';
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
const sessions = new Map();
const rateLimitStore = new Map();

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || '';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'adwalaadigitalmarketing@gmail.com';
let mailTransporter = null;

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest();
}

function safeCompareSecret(input, expectedHash) {
  const inputHash = hashSecret(input);
  return inputHash.length === expectedHash.length && crypto.timingSafeEqual(inputHash, expectedHash);
}

function assertProductionConfig() {
  if (!IS_PRODUCTION) return;
  const problems = [];
  if (!process.env.ADMIN_PASS || process.env.ADMIN_PASS.length < 12) problems.push('ADMIN_PASS must be set to a strong value with at least 12 characters.');
  if (process.env.ADMIN_PASS === DEFAULT_LOCAL_ADMIN_PASS) problems.push('ADMIN_PASS cannot use the local fallback password.');
  if (!process.env.ADMIN_USER) problems.push('ADMIN_USER must be set.');
  if (ALLOWED_ORIGINS.length === 0) problems.push('ALLOWED_ORIGINS must include your live https domain.');
  if (problems.length) {
    console.error('Production configuration error:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
}

const DEFAULT_FAQS = [
  { question: 'What digital services does ADWALAA provide?', answer: 'ADWALAA provides website design, Google Business Profile support, local SEO, social media management, Facebook and Instagram advertising, lead generation support, review guidance, WhatsApp Business support and practical AI automation for local businesses.' },
  { question: 'Is the Free Business Audit really free?', answer: 'Yes. The initial business audit is free. It is used to understand your current digital presence, identify important gaps and suggest practical next steps. Paid work starts only after the scope and charges are discussed clearly.' },
  { question: 'Does ADWALAA work only in Lakhimpur Kheri?', answer: 'ADWALAA is based in Lakhimpur Kheri, Uttar Pradesh, and can support eligible businesses in other Indian districts through online communication and remote digital service delivery.' },
  { question: 'Which types of businesses can use these services?', answer: 'The services are suitable for photographers and studios, shops, restaurants and cafes, coaching institutes, YouTube creators, clinics, consultants, service providers, startups and other small local businesses.' },
  { question: 'How much do digital services cost?', answer: 'The cost depends on the selected service, current business position, required features and project scope. A clear quotation is shared after understanding the actual requirement. No price should be assumed before the scope is confirmed.' },
  { question: 'Can ADWALAA guarantee Google ranking, leads or sales?', answer: 'No responsible agency can honestly guarantee a fixed ranking, number of leads or sales. ADWALAA focuses on professional setup, practical strategy, accurate implementation and continuous improvement based on available data.' },
  { question: 'What information is needed to start a project?', answer: 'Usually the basic business name, contact details, location, services, target customers, existing website or Google Business Profile link, brand assets and the main business goal are required. Only relevant information is requested.' },
  { question: 'How can I start or contact ADWALAA?', answer: 'You can select your district, submit the Free Business Audit form or use the WhatsApp button. Share your business requirement clearly, and the next suitable step can then be discussed.' }
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.bat': 'text/plain; charset=utf-8'
};

function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (!value || value.resetAt <= now) rateLimitStore.delete(key);
  }
}
setInterval(cleanupRateLimitStore, 5 * 60 * 1000).unref();

function securityHeaders(extra = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extra
  };
  if (IS_PRODUCTION) {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://*.clarity.ms",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://www.clarity.ms https://*.clarity.ms",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ');
  }
  return headers;
}

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

function send(res, status, payload, headers = {}) {
  const isString = typeof payload === 'string';
  const body = isString ? payload : JSON.stringify(payload);
  const base = securityHeaders({
    'Content-Type': isString ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8'
  });
  if (base['Content-Type'].startsWith('application/json')) {
    base['Cache-Control'] = 'no-store';
  }
  res.writeHead(status, { ...base, ...headers });
  res.end(body);
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      contacts: [],
      audits: [],
      clients: [],
      content: {
        acceptingClients: true,
        announcementActive: false,
        announcementText: 'Free business audit available for local businesses.',
        faqs: DEFAULT_FAQS
      }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const db = JSON.parse(raw);
    db.contacts ||= [];
    db.audits ||= [];
    db.clients ||= [];
    db.content ||= { acceptingClients: true, announcementActive: false, announcementText: '', faqs: DEFAULT_FAQS };
    db.content.faqs ||= DEFAULT_FAQS;
    return db;
  } catch {
    return { contacts: [], audits: [], clients: [], content: { acceptingClients: true, announcementActive: false, announcementText: '', faqs: DEFAULT_FAQS } };
  }
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function parseBody(req, res) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        send(res, 413, { ok: false, error: 'Payload too large' });
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('application/x-www-form-urlencoded')) {
          return resolve(Object.fromEntries(new URLSearchParams(data)));
        }
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map(v => v.trim()).filter(Boolean).map(v => {
      const i = v.indexOf('=');
      return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
    })
  );
}

function sanitizeText(value, max = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'id') { return prefix + '_' + crypto.randomBytes(6).toString('hex'); }

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return FORCE_SECURE_COOKIES || proto === 'https' || !!req.socket.encrypted;
}

function tooMany(req, key, limit, windowMs, res) {
  const ip = getClientIp(req);
  const mapKey = `${key}:${ip}`;
  const now = Date.now();
  const current = rateLimitStore.get(mapKey);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(mapKey, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  if (current.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    send(res, 429, { ok: false, error: 'Too many requests. Please try again later.' }, { 'Retry-After': String(retryAfter) });
    return true;
  }
  return false;
}

function originAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  const currentOrigin = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
  if (origin === currentOrigin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return false;
}

function rejectIfBadOrigin(req, res) {
  if (!originAllowed(req)) {
    send(res, 403, { ok: false, error: 'Origin not allowed' });
    return true;
  }
  return false;
}

function getSession(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...session };
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    send(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
  return session;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidPhone(value) {
  return /^[0-9 +()\-]{10,18}$/.test(String(value || '').trim());
}

function isValidUrlMaybe(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  try {
    const u = new URL(v);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

function validateLead(lead, type) {
  if (!lead.name || lead.name.length < 2) return 'Valid name is required';
  if (!isValidPhone(lead.phone)) return 'Valid phone number is required';
  if (!isValidEmail(lead.email)) return 'Valid email address is required';
  if (!lead.category) return 'Business category is required';
  if (!lead.message || lead.message.length < 5) return 'Please enter your requirement clearly';
  if (type === 'audit' && !lead.business) return 'Business name is required';
  if (!isValidUrlMaybe(lead.businessLink)) return 'Business link must start with http:// or https://';
  return '';
}

function buildLead(type, body) {
  return {
    id: genId(type),
    type,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: 'new',
    leadSource: sanitizeText(body.leadSource, 120) || 'website',
    name: sanitizeText(body.name, 120),
    phone: sanitizeText(body.phone, 40),
    email: sanitizeText(body.email, 160),
    business: sanitizeText(body.business, 160),
    category: sanitizeText(body.category, 160),
    state: sanitizeText(body.state, 120),
    district: sanitizeText(body.district, 120),
    service: sanitizeText(body.service, 160),
    businessLink: sanitizeText(body.businessLink || body.business_link, 400),
    message: sanitizeText(body.message, 3000),
    notes: sanitizeText(body.notes, 3000),
    followUpDate: sanitizeText(body.followUpDate, 50),
    page: sanitizeText(body.page, 120)
  };
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function canSendMail() {
  return !!(nodemailer && SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && MAIL_FROM);
}

function getTransporter() {
  if (!canSendMail()) return null;
  if (mailTransporter) return mailTransporter;
  mailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return mailTransporter;
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function leadSummaryRows(lead) {
  return [
    ['Name', lead.name],
    ['Phone', lead.phone],
    ['Email', lead.email],
    ['Business', lead.business],
    ['Category', lead.category],
    ['Service', lead.service],
    ['State', lead.state],
    ['District', lead.district],
    ['Business Link', lead.businessLink],
    ['Message', lead.message],
    ['Page', lead.page],
    ['Created At', lead.createdAt]
  ].filter(([, v]) => String(v || '').trim());
}

function buildOwnerMail(lead) {
  const subject = `New ${lead.type === 'audit' ? 'Free Audit' : 'Contact'} Form Submission - ${lead.name || 'Website Lead'}`;
  const plain = ['A new website form has been submitted.', '', ...leadSummaryRows(lead).map(([k, v]) => `${k}: ${v}`)].join('\n');
  const htmlRows = leadSummaryRows(lead).map(([k, v]) => `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">${esc(k)}</td><td style="padding:8px;border:1px solid #ddd;">${esc(v)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;"><h2 style="margin:0 0 12px;">New website form submission</h2><table style="border-collapse:collapse;width:100%;max-width:700px;">${htmlRows}</table></div>`;
  return { subject, plain, html };
}

function buildClientMail(lead) {
  const business = lead.business || 'your business';
  const location = [lead.district, lead.state].filter(Boolean).join(', ');
  const subject = 'Thank you for contacting ADWALAA AI & DIGITAL SOLUTIONS';
  const plain = [
    `Hello ${lead.name || 'there'},`,
    '',
    'Thank you for submitting your request to ADWALAA AI & DIGITAL SOLUTIONS.',
    'We have received your details successfully.',
    '',
    `Business: ${business}`,
    location ? `Location: ${location}` : '',
    lead.service ? `Requested Service: ${lead.service}` : '',
    '',
    'Our team will review your requirement and contact you as appropriate.',
    'For urgent discussion, you may also reply on WhatsApp or call +91 89310 74153.',
    '',
    'Regards,',
    'ADWALAA AI & DIGITAL SOLUTIONS',
    'Email: adwalaadigitalmarketing@gmail.com',
    'Phone: +91 89310 74153'
  ].filter(Boolean).join('\n');
  const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:700px;">
    <h2 style="margin:0 0 12px;color:#111;">Thank you for contacting ADWALAA AI & DIGITAL SOLUTIONS</h2>
    <p>Hello <strong>${esc(lead.name || 'there')}</strong>,</p>
    <p>We have received your form submission successfully.</p>
    <div style="background:#f7f7f7;border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0 0 8px;"><strong>Business:</strong> ${esc(business)}</p>
      ${location ? `<p style="margin:0 0 8px;"><strong>Location:</strong> ${esc(location)}</p>` : ''}
      ${lead.service ? `<p style="margin:0;"><strong>Requested service:</strong> ${esc(lead.service)}</p>` : ''}
    </div>
    <p>Our team will review your requirement and contact you as appropriate.</p>
    <p>For urgent discussion, you may also connect on WhatsApp or call <strong>+91 89310 74153</strong>.</p>
    <p style="margin-top:24px;">Regards,<br><strong>ADWALAA AI & DIGITAL SOLUTIONS</strong><br>Email: adwalaadigitalmarketing@gmail.com</p>
  </div>`;
  return { subject, plain, html };
}

async function sendLeadEmails(lead) {
  const result = { configured: canSendMail(), ownerSent: false, clientSent: false, skipped: [], errors: [] };
  const transporter = getTransporter();
  if (!transporter) {
    result.skipped.push('smtp_not_configured');
    return result;
  }
  try {
    const ownerMail = buildOwnerMail(lead);
    await transporter.sendMail({
      from: MAIL_FROM,
      to: OWNER_EMAIL,
      replyTo: isValidEmail(lead.email) ? lead.email : undefined,
      subject: ownerMail.subject,
      text: ownerMail.plain,
      html: ownerMail.html
    });
    result.ownerSent = true;
  } catch (error) {
    result.errors.push('owner_mail_failed');
    console.error('Owner email failed:', error && error.message ? error.message : error);
  }
  if (isValidEmail(lead.email)) {
    try {
      const clientMail = buildClientMail(lead);
      await transporter.sendMail({ from: MAIL_FROM, to: lead.email, subject: clientMail.subject, text: clientMail.plain, html: clientMail.html });
      result.clientSent = true;
    } catch (error) {
      result.errors.push('client_mail_failed');
      console.error('Client email failed:', error && error.message ? error.message : error);
    }
  } else {
    result.skipped.push('client_email_missing_or_invalid');
  }
  return result;
}

function isPublicStaticPath(relativePath) {
  const clean = String(relativePath || '').replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  if (!clean || clean === '.') return false;

  // Never expose hidden files, server source, environment files, CRM data or internal reports.
  if (parts.some(part => part.startsWith('.'))) return false;
  if (clean === 'server.js' || clean === 'package.json' || clean === 'package-lock.json') return false;
  if (clean.startsWith('data/')) return false;

  const allowedRootFiles = new Set([
    'index.html',
    'about.html',
    'admin-login.html',
    'admin.html',
    'ai-automation.html',
    'contact.html',
    'free-audit.html',
    'industries.html',
    'location.html',
    'privacy-policy.html',
    'process.html',
    'services.html',
    'robots.txt',
    'sitemap.xml'
  ]);
  if (allowedRootFiles.has(clean)) return true;
  if (clean.startsWith('assets/')) return true;
  if (clean.endsWith('.bat') || clean.endsWith('.py') || clean.endsWith('.txt')) return false;
  return false;
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  try {
    filePath = decodeURIComponent(filePath.split('?')[0]);
  } catch (_) {
    return send(res, 400, 'Bad request');
  }
  const fullPath = path.normalize(path.join(PUBLIC_ROOT, filePath));
  const relativePath = path.relative(PUBLIC_ROOT, fullPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return send(res, 403, 'Forbidden');
  if (!isPublicStaticPath(relativePath)) return send(res, 404, 'Not found');
  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(fullPath).toLowerCase();
    const extraHeaders = {};
    if (filePath.endsWith('admin.html') || filePath.endsWith('admin-login.html')) {
      extraHeaders['Cache-Control'] = 'no-store';
    }
    res.writeHead(200, securityHeaders({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...extraHeaders
    }));
    fs.createReadStream(fullPath).pipe(res);
  });
}

function activityFromDb(db) {
  const items = [
    ...db.contacts.map(c => ({ type: 'contact', title: `${c.name || 'Unknown'} — Contact${c.service ? ` (${c.service})` : ''}`, subtitle: [c.district, c.state].filter(Boolean).join(', '), createdAt: c.createdAt, color: 'blue' })),
    ...db.audits.map(a => ({ type: 'audit', title: `${a.name || 'Unknown'} — Audit`, subtitle: [a.business, a.district].filter(Boolean).join(' · '), createdAt: a.createdAt, color: 'gold' })),
    ...db.clients.map(c => ({ type: 'client', title: `${c.name || 'Unknown'} — Client`, subtitle: [c.business, c.status].filter(Boolean).join(' · '), createdAt: c.createdAt || c.updatedAt, color: 'green' }))
  ];
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
}

function handleApi(req, res, urlObj) {
  const pathname = urlObj.pathname;
  if (req.method === 'POST' && rejectIfBadOrigin(req, res)) return;

  if (pathname === '/api/health' && req.method === 'GET') {
    return send(res, 200, { ok: true, status: 'up', emailConfigured: canSendMail(), nodeEnv: NODE_ENV });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (tooMany(req, 'login', 10, 15 * 60 * 1000, res)) return;
    return parseBody(req, res).then(body => {
      const user = sanitizeText(body.username, 80);
      const pass = sanitizeText(body.password, 120);
      if (!ADMIN_PASS || user !== ADMIN_USER || !safeCompareSecret(pass, ADMIN_PASS_HASH)) {
        return send(res, 401, { ok: false, error: 'Invalid username or password' });
      }
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.set(sid, { username: ADMIN_USER, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
      const cookieParts = [
        `${SESSION_COOKIE}=${sid}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${60 * 60 * 12}`
      ];
      if (isHttps(req)) cookieParts.push('Secure');
      send(res, 200, { ok: true, username: ADMIN_USER }, {
        'Set-Cookie': cookieParts.join('; ')
      });
    }).catch(() => send(res, 400, { ok: false, error: 'Bad request' }));
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const sid = parseCookies(req)[SESSION_COOKIE];
    if (sid) sessions.delete(sid);
    const cookieParts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
    if (isHttps(req)) cookieParts.push('Secure');
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieParts.join('; ') });
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const session = getSession(req);
    return send(res, session ? 200 : 401, session ? { ok: true, username: session.username } : { ok: false });
  }

  if (pathname === '/api/public/content' && req.method === 'GET') {
    const db = readDb();
    return send(res, 200, { ok: true, content: db.content });
  }

  if (pathname === '/api/contact' && req.method === 'POST') {
    if (tooMany(req, 'contact', 8, 15 * 60 * 1000, res)) return;
    return parseBody(req, res).then(async body => {
      const db = readDb();
      const lead = buildLead('contact', body);
      const error = validateLead(lead, 'contact');
      if (error) return send(res, 400, { ok: false, error });
      db.contacts.unshift(lead);
      writeDb(db);
      const email = await sendLeadEmails(lead);
      send(res, 201, { ok: true, item: lead, email });
    }).catch((error) => {
      console.error('Contact submit error:', error && error.message ? error.message : error);
      send(res, 400, { ok: false, error: 'Bad request' });
    });
  }

  if (pathname === '/api/audit' && req.method === 'POST') {
    if (tooMany(req, 'audit', 8, 15 * 60 * 1000, res)) return;
    return parseBody(req, res).then(async body => {
      const db = readDb();
      const lead = buildLead('audit', body);
      const error = validateLead(lead, 'audit');
      if (error) return send(res, 400, { ok: false, error });
      db.audits.unshift(lead);
      writeDb(db);
      const email = await sendLeadEmails(lead);
      send(res, 201, { ok: true, item: lead, email });
    }).catch((error) => {
      console.error('Audit submit error:', error && error.message ? error.message : error);
      send(res, 400, { ok: false, error: 'Bad request' });
    });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (tooMany(req, 'admin', 120, 15 * 60 * 1000, res)) return;
    if (!requireAuth(req, res)) return;
    const db = readDb();
    if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
      return send(res, 200, { ok: true, stats: { contacts: db.contacts.filter(x => x.status === 'new').length, audits: db.audits.filter(x => x.status === 'new').length, clients: db.clients.filter(x => x.status === 'active').length, totalLeads: db.contacts.length + db.audits.length }, activity: activityFromDb(db) });
    }
    if (pathname === '/api/admin/contacts' && req.method === 'GET') return send(res, 200, { ok: true, items: db.contacts });
    if (pathname === '/api/admin/audits' && req.method === 'GET') return send(res, 200, { ok: true, items: db.audits });
    if (pathname === '/api/admin/clients' && req.method === 'GET') return send(res, 200, { ok: true, items: db.clients });
    if (pathname === '/api/admin/content' && req.method === 'GET') return send(res, 200, { ok: true, content: db.content });
    if (pathname === '/api/admin/content' && req.method === 'POST') {
      return parseBody(req, res).then(body => {
        db.content = {
          acceptingClients: !!body.acceptingClients,
          announcementActive: !!body.announcementActive,
          announcementText: sanitizeText(body.announcementText, 500),
          faqs: Array.isArray(body.faqs) ? body.faqs.map(f => ({ question: sanitizeText(f.question, 300), answer: sanitizeText(f.answer, 1000) })).filter(f => f.question && f.answer) : DEFAULT_FAQS
        };
        writeDb(db);
        send(res, 200, { ok: true, content: db.content });
      }).catch(() => send(res, 400, { ok: false, error: 'Bad request' }));
    }
    if (pathname === '/api/admin/import/contacts' && req.method === 'POST') {
      return parseBody(req, res).then(body => {
        const records = Array.isArray(body.records) ? body.records : [];
        let imported = 0;
        const existingPhones = new Set(db.contacts.map(x => x.phone));
        for (const r of records) {
          const lead = buildLead('contact', r);
          if (!lead.name) continue;
          if (lead.phone && existingPhones.has(lead.phone)) continue;
          if (lead.phone) existingPhones.add(lead.phone);
          db.contacts.unshift(lead);
          imported++;
        }
        writeDb(db);
        send(res, 200, { ok: true, imported });
      }).catch(() => send(res, 400, { ok: false, error: 'Bad request' }));
    }
    if (pathname === '/api/admin/import/audits' && req.method === 'POST') {
      return parseBody(req, res).then(body => {
        const records = Array.isArray(body.records) ? body.records : [];
        let imported = 0;
        const existingPhones = new Set(db.audits.map(x => x.phone));
        for (const r of records) {
          const lead = buildLead('audit', r);
          if (!lead.name) continue;
          if (lead.phone && existingPhones.has(lead.phone)) continue;
          if (lead.phone) existingPhones.add(lead.phone);
          db.audits.unshift(lead);
          imported++;
        }
        writeDb(db);
        send(res, 200, { ok: true, imported });
      }).catch(() => send(res, 400, { ok: false, error: 'Bad request' }));
    }
    if (pathname === '/api/admin/import/clients' && req.method === 'POST') {
      return parseBody(req, res).then(body => {
        const records = Array.isArray(body.records) ? body.records : [];
        let imported = 0;
        const existingPhones = new Set(db.clients.map(x => x.phone));
        for (const r of records) {
          const c = { id: genId('client'), createdAt: nowIso(), updatedAt: nowIso(), name: sanitizeText(r.name, 120), business: sanitizeText(r.business, 160), phone: sanitizeText(r.phone, 40), email: sanitizeText(r.email, 160), service: sanitizeText(r.service, 160), startDate: sanitizeText(r.startDate, 50), status: sanitizeText(r.status, 60) || 'active', notes: sanitizeText(r.notes, 1000) };
          if (!c.name) continue;
          if (c.phone && existingPhones.has(c.phone)) continue;
          if (c.phone) existingPhones.add(c.phone);
          db.clients.unshift(c);
          imported++;
        }
        writeDb(db);
        send(res, 200, { ok: true, imported });
      }).catch(() => send(res, 400, { ok: false, error: 'Bad request' }));
    }
    const m = pathname.match(/^\/api\/admin\/(contacts|audits|clients)\/([^/]+)$/);
    if (m) {
      const [, kind, id] = m;
      const key = kind;
      const arr = db[key];
      const idx = arr.findIndex(x => x.id === id);
      if (idx === -1) return send(res, 404, { ok: false, error: 'Not found' });
      if (req.method === 'PATCH' || req.method === 'PUT') {
        return parseBody(req, res).then(body => {
          if (key === 'clients') {
            arr[idx] = { ...arr[idx], name: sanitizeText(body.name, 120) || arr[idx].name, business: sanitizeText(body.business, 160), phone: sanitizeText(body.phone, 40), email: sanitizeText(body.email, 160), service: sanitizeText(body.service, 160), startDate: sanitizeText(body.startDate, 50), status: sanitizeText(body.status, 60) || arr[idx].status, notes: sanitizeText(body.notes, 1000), updatedAt: nowIso() };
          } else {
            arr[idx] = { ...arr[idx], status: sanitizeText(body.status, 60) || arr[idx].status, notes: sanitizeText(body.notes, 1000), followUpDate: sanitizeText(body.followUpDate, 50), leadSource: sanitizeText(body.leadSource, 120) || arr[idx].leadSource, updatedAt: nowIso() };
          }
          writeDb(db);
          send(res, 200, { ok: true, item: arr[idx] });
        }).catch(() => send(res, 400, { ok: false, error: 'Bad request' }));
      }
      if (req.method === 'DELETE') {
        arr.splice(idx, 1);
        writeDb(db);
        return send(res, 200, { ok: true });
      }
    }
    if (pathname === '/api/admin/clients' && req.method === 'POST') {
      return parseBody(req, res).then(body => {
        const c = { id: genId('client'), createdAt: nowIso(), updatedAt: nowIso(), name: sanitizeText(body.name, 120), business: sanitizeText(body.business, 160), phone: sanitizeText(body.phone, 40), email: sanitizeText(body.email, 160), service: sanitizeText(body.service, 160), startDate: sanitizeText(body.startDate, 50), status: sanitizeText(body.status, 60) || 'active', notes: sanitizeText(body.notes, 1000) };
        if (!c.name) return send(res, 400, { ok: false, error: 'Client name required' });
        db.clients.unshift(c);
        writeDb(db);
        send(res, 201, { ok: true, item: c });
      }).catch(() => send(res, 400, { ok: false, error: 'Bad request' }));
    }
  }

  send(res, 404, { ok: false, error: 'Not found' });
}

function requestHandler(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (isApiPath(urlObj.pathname)) return handleApi(req, res, urlObj);
  serveStatic(req, res, urlObj.pathname);
}

function startServer() {
  assertProductionConfig();
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    ensureDataFile();
    if (!IS_PRODUCTION && ADMIN_PASS === DEFAULT_LOCAL_ADMIN_PASS) {
      console.warn('Local fallback admin password is active. Set ADMIN_PASS in .env before any live use.');
    }
    if (!canSendMail()) {
      console.warn('Email not configured yet. Leads will save, but automatic emails will not send until SMTP variables are added.');
    }
    console.log(`ADWALAA server running at http://localhost:${PORT}`);
    console.log('Admin login URL: /admin-login.html');
  });
  return server;
}

module.exports = {
  requestHandler,
  handleApi,
  serveStatic,
  isApiPath,
  assertProductionConfig,
  ensureDataFile,
  canSendMail,
  PORT,
  IS_PRODUCTION,
  ADMIN_PASS,
  DEFAULT_LOCAL_ADMIN_PASS
};

if (require.main === module) {
  startServer();
}
