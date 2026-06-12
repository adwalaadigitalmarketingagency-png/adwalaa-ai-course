"use strict";
const WHATSAPP_NUMBER = "918931074153";
const LOCATION_STORAGE_KEY = "adwalaaSelectedDistrict";

const bodyPage = document.body.dataset.page || "";
document.querySelectorAll("[data-page-link]").forEach((link) => {
  const active = link.dataset.pageLink === bodyPage;
  link.classList.toggle("active", active);
  if (active) link.setAttribute("aria-current", "page");
});

const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");
const closeMenu = () => {
  if (!menuToggle || !mainNav) return;
  mainNav.classList.remove("open");
  document.body.classList.remove("nav-open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation menu");
};
if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const open = mainNav.classList.toggle("open");
    document.body.classList.toggle("nav-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  });
  mainNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
  document.addEventListener("click", (event) => {
    if (!mainNav.classList.contains("open")) return;
    if (!mainNav.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1380) closeMenu();
  });
}

const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("show"); observer.unobserve(entry.target); } });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("show"));
}

function readStoredLocation() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || "null");
    return value && value.state && value.district ? value : null;
  } catch (_) { return null; }
}

function applyStoredLocation() {
  const location = readStoredLocation();
  const stateFields = document.querySelectorAll('#auditState, #contactState, input[name="state"]');
  const districtFields = document.querySelectorAll('#auditDistrict, #contactDistrict, input[name="district"]');
  stateFields.forEach((field) => { if (location && !field.value) field.value = location.state; });
  districtFields.forEach((field) => { if (location && !field.value) field.value = location.district; });
  const note = document.getElementById("selectedLocationNote");
  const label = document.getElementById("auditLocationLabel");
  if (location && note && label) { label.textContent = `${location.district}, ${location.state}`; note.hidden = false; }
}
applyStoredLocation();


function initIndianLocationFormHelpers() {
  const stateInputs = [...document.querySelectorAll('input[name="state"]')];
  const districtInputs = [...document.querySelectorAll('input[name="district"]')];
  if (!stateInputs.length && !districtInputs.length) return;

  const normalise = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const createDatalist = (id) => {
    let list = document.getElementById(id);
    if (!list) {
      list = document.createElement("datalist");
      list.id = id;
      document.body.appendChild(list);
    }
    return list;
  };

  const stateList = createDatalist("indiaStateOptions");
  const districtList = createDatalist("indiaDistrictOptions");
  stateInputs.forEach((input) => input.setAttribute("list", "indiaStateOptions"));
  districtInputs.forEach((input) => input.setAttribute("list", "indiaDistrictOptions"));

  const prepare = (data) => {
    const unique = new Map();
    (Array.isArray(data) ? data : []).forEach((item) => {
      if (!item || !item.state || !item.district) return;
      const state = String(item.state).trim();
      const district = String(item.district).trim();
      unique.set(`${normalise(state)}|${normalise(district)}`, { state, district, stateKey: normalise(state), districtKey: normalise(district) });
    });
    return [...unique.values()].sort((a,b) => a.state.localeCompare(b.state,"en-IN",{sensitivity:"base"}) || a.district.localeCompare(b.district,"en-IN",{sensitivity:"base"}));
  };

  const renderOptions = (element, values) => {
    element.innerHTML = values.map((value) => `<option value="${String(value).replace(/&/g,"&amp;").replace(/"/g,"&quot;")}"></option>`).join("");
  };

  const applyData = (rows) => {
    if (!rows.length) return;
    const states = [...new Set(rows.map((row) => row.state))].sort((a,b) => a.localeCompare(b,"en-IN",{sensitivity:"base"}));
    renderOptions(stateList, states);

    const updateDistrictOptions = () => {
      const selectedState = stateInputs.map((input) => normalise(input.value)).find(Boolean);
      const filtered = selectedState ? rows.filter((row) => row.stateKey === selectedState) : rows;
      const districtLabels = filtered.map((row) => selectedState ? row.district : `${row.district}, ${row.state}`);
      renderOptions(districtList, [...new Set(districtLabels)].slice(0, 784));
    };

    const autoFillStateFromDistrict = (districtInput) => {
      const value = String(districtInput.value || "").split(",")[0].trim();
      if (!value) return;
      const selectedState = stateInputs.map((input) => normalise(input.value)).find(Boolean);
      const exact = rows.filter((row) => row.districtKey === normalise(value));
      const match = selectedState ? exact.find((row) => row.stateKey === selectedState) : (exact.length === 1 ? exact[0] : null);
      if (!match) return;
      stateInputs.forEach((input) => { if (!input.value) input.value = match.state; });
      districtInput.value = match.district;
    };

    stateInputs.forEach((input) => input.addEventListener("input", updateDistrictOptions));
    districtInputs.forEach((input) => input.addEventListener("change", () => autoFillStateFromDistrict(input)));
    districtInputs.forEach((input) => input.addEventListener("blur", () => autoFillStateFromDistrict(input)));
    updateDistrictOptions();
  };

  const fallback = prepare(window.INDIA_DISTRICTS || []);
  if (fallback.length) applyData(fallback);
  fetch("assets/data/india-districts.json", { cache:"no-store" })
    .then((response) => response.ok ? response.json() : [])
    .then((data) => {
      const prepared = prepare(data);
      if (prepared.length) applyData(prepared);
    })
    .catch(() => {});
}
initIndianLocationFormHelpers();

function formMessage(form) {
  const data = new FormData(form);
  const get = (key) => String(data.get(key) || "").trim();
  const lines = [
    "Hello Adwalaa, I want help for my business.", "",
    `Form Type: ${form.dataset.formType || "Website Enquiry"}`,
    get("name") && `Name: ${get("name")}`,
    get("phone") && `Mobile: ${get("phone")}`,
    get("business") && `Business: ${get("business")}`,
    get("category") && `Category: ${get("category")}`,
    get("service") && `Required Service: ${get("service")}`,
    get("district") && get("state") && `Location: ${get("district")}, ${get("state")}`,
    get("business_link") && `Business Link: ${get("business_link")}`,
    get("message") && `Requirement: ${get("message")}`
  ].filter(Boolean);
  return lines.join("\n");
}

// ============================================================
// EMAILJS — Dual Email System
// Setup guide: email_setup_guide.md artifact dekhein
// Step 6 se keys yahan paste karein:
// ============================================================
const EMAILJS_PUBLIC_KEY  = "PASTE_PUBLIC_KEY_HERE";       // Account > Public Key
const EMAILJS_SERVICE_ID  = "PASTE_SERVICE_ID_HERE";        // Email Services se
const EMAILJS_TEMPLATE_1  = "PASTE_TEMPLATE1_ID_HERE";      // adwalaa_notification
const EMAILJS_TEMPLATE_2  = "PASTE_TEMPLATE2_ID_HERE";      // client_confirmation

// Load EmailJS SDK dynamically
(function loadEmailJS() {
  if (window.emailjs) return;
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
  s.onload = () => { try { emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY }); } catch(_) {} };
  document.head.appendChild(s);
})();

async function sendEmailViaEmailJS(form, formData) {
  const get = (key) => String(formData.get(key) || "").trim();

  // Template parameters
  const params = {
    form_type:     form.dataset.formTitle || form.dataset.formType || "Website Enquiry",
    client_name:   get("name")          || "—",
    client_phone:  get("phone")         || "—",
    client_email:  get("email")         || "—",
    business_name: get("business")      || "—",
    category:      get("category")      || "—",
    location:      (get("district") && get("state")) ? `${get("district")}, ${get("state")}` : "—",
    business_link: get("business_link") || "—",
    requirement:   get("message")       || "—",
    time:          new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  // Check keys are configured
  const keysSet = ![EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_1]
    .some(k => k.startsWith("PASTE_"));
  if (!keysSet) return { ok: false, reason: "keys_not_set" };

  if (!window.emailjs) return { ok: false, reason: "sdk_not_loaded" };

  try {
    // 1. Adwalaa ko notification email
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_1, params);

    // 2. Client ko auto-reply (sirf tab jab email ho)
    if (get("email")) {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_2, params);
    }
    return { ok: true };
  } catch (err) {
    console.warn("EmailJS error:", err);
    return { ok: false, reason: "api_error" };
  }
}

document.querySelectorAll("[data-whatsapp-form-disabled]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const formData  = new FormData(form);
    const submitBtn = form.querySelector(".form-submit");
    const origHTML  = submitBtn.innerHTML;
    submitBtn.classList.add("loading");
    submitBtn.innerHTML = "<span>Sending\u2026</span>";

    // 1. Email bhejo silently (Adwalaa + Client)
    const result = await sendEmailViaEmailJS(form, formData);

    // 2. WhatsApp bhi kholo
    const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(formMessage(form))}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");

    // 3. Feedback
    submitBtn.classList.remove("loading");
    submitBtn.innerHTML = origHTML;

    let sentMsg = form.querySelector(".form-sent");
    if (!sentMsg) {
      sentMsg = document.createElement("p");
      sentMsg.className = "form-sent";
      form.appendChild(sentMsg);
    }

    if (result.ok) {
      sentMsg.textContent = "\u2713 Aapki details hamare paas pahunch gayi! Email aur WhatsApp dono se notification bheja gaya.";
    } else if (result.reason === "keys_not_set") {
      sentMsg.textContent = "\u2713 WhatsApp khul gaya! Email system ke liye EmailJS keys setup karein (guide dekhein).";
    } else {
      sentMsg.textContent = "\u2713 WhatsApp khul gaya! Please apna message bhejein.";
    }
    sentMsg.classList.add("show");
    setTimeout(() => sentMsg.classList.remove("show"), 8000);
  });
});




// Keep the FAQ easy to scan by allowing one open answer at a time.
const faqItems = document.querySelectorAll(".faq-item");
faqItems.forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return;
    faqItems.forEach((otherItem) => {
      if (otherItem !== item) otherItem.open = false;
    });
  });
});

// Dynamic Back-To-Top Button Logic
(function initBackToTop() {
  const btn = document.createElement("button");
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "Scroll to top");
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>`;
  document.body.appendChild(btn);

  window.addEventListener("scroll", () => {
    if (window.scrollY > 400) {
      btn.classList.add("show");
    } else {
      btn.classList.remove("show");
    }
  });

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();



function initSoftPressFeedback() {
  const targets = document.querySelectorAll(
    ".btn, .header-cta, .main-nav a, .menu-toggle, .floating-whatsapp, .back-to-top, .contact-methods > a, .contact-static, summary, .text-link"
  );

  targets.forEach((element) => {
    const release = () => element.classList.remove("is-pressed");
    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      element.classList.add("is-pressed");
    });
    ["pointerup", "pointercancel", "mouseleave", "blur"].forEach((eventName) => {
      element.addEventListener(eventName, release);
    });
  });
}

initSoftPressFeedback();


function initDesktopSectionWheelSnap() {
  return;
}

initDesktopSectionWheelSnap();


function initPageTransitions() {
  document.body.classList.add("is-page-entering");
  window.setTimeout(() => document.body.classList.remove("is-page-entering"), 320);

  const samePageLinks = document.querySelectorAll('a[href]');
  samePageLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;
      if (link.target && link.target !== '_self') return;
      if (link.hasAttribute('download')) return;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
      let url;
      try {
        url = new URL(href, window.location.href);
      } catch (_) {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      event.preventDefault();
      document.body.classList.add('is-page-leaving');
      window.setTimeout(() => {
        window.location.href = url.href;
      }, 180);
    });
  });
}

initPageTransitions();
