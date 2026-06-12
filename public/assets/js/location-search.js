"use strict";
(function () {
  const STORAGE_KEY = "adwalaaSelectedDistrict";
  const WA_NUMBER = "918931074153";
  const MAX_RESULTS = 784; // Full India district list. Do not shorten.

  const STATE_ALIASES = {
    "andaman and nicobar islands": ["andaman", "andaman nicobar", "a n islands", "an islands"],
    "andhra pradesh": ["ap", "a p", "andhra"],
    "arunachal pradesh": ["arunachal"],
    "assam": [],
    "bihar": [],
    "chandigarh": [],
    "chhattisgarh": ["cg", "c g", "chattisgarh"],
    "delhi": ["nct delhi", "new delhi", "dl"],
    "goa": [],
    "gujarat": ["gj"],
    "haryana": ["hr"],
    "himachal pradesh": ["hp", "h p", "himachal"],
    "jammu and kashmir": ["jammu kashmir", "j&k", "jk", "j k"],
    "jharkhand": ["jh"],
    "karnataka": ["ka"],
    "kerala": ["kl"],
    "ladakh": [],
    "lakshadweep": [],
    "madhya pradesh": ["mp", "m p", "madhya"],
    "maharashtra": ["mh"],
    "manipur": [],
    "meghalaya": [],
    "mizoram": [],
    "nagaland": [],
    "odisha": ["orissa", "od"],
    "puducherry": ["pondicherry"],
    "punjab": ["pb"],
    "rajasthan": ["rj"],
    "sikkim": [],
    "tamil nadu": ["tn", "t n"],
    "telangana": ["ts", "t s", "tg"],
    "the dadra and nagar haveli and daman and diu": ["dadra and nagar haveli and daman and diu", "dadra", "daman", "diu", "dadra nagar haveli", "dnhdd", "dn h dd"],
    "dadra and nagar haveli and daman and diu": ["the dadra and nagar haveli and daman and diu", "dadra", "daman", "diu", "dadra nagar haveli", "dnhdd", "dn h dd"],
    "tripura": [],
    "uttar pradesh": ["up", "u p", "u.p", "uttar pardesh", "uttarpradesh"],
    "uttarakhand": ["uk", "u k", "uttrakhand"],
    "west bengal": ["wb", "w b", "bengal"]
  };

  let rows = [];
  let states = [];

  function normalise(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uniqueKey(item) {
    return item.stateKey + "|" + item.districtKey;
  }

  function prepare(data) {
    const map = new Map();
    (Array.isArray(data) ? data : []).forEach((item) => {
      const state = String(item && item.state || "").trim();
      const district = String(item && item.district || "").trim();
      if (!state || !district) return;
      const clean = { state, district, stateKey: normalise(state), districtKey: normalise(district) };
      map.set(uniqueKey(clean), clean);
    });
    rows = Array.from(map.values()).sort((a, b) =>
      a.state.localeCompare(b.state, "en-IN", { sensitivity: "base" }) ||
      a.district.localeCompare(b.district, "en-IN", { sensitivity: "base" })
    );
    states = Array.from(new Map(rows.map((row) => [row.stateKey, row.state])).values())
      .sort((a, b) => a.localeCompare(b, "en-IN", { sensitivity: "base" }));
  }

  function tokensForState(state) {
    const key = normalise(state);
    return [key].concat(STATE_ALIASES[key] || []).map(normalise).filter(Boolean);
  }

  function districtScore(row, q) {
    if (row.districtKey === q) return 0;
    if (row.districtKey.startsWith(q)) return 1;
    if (row.districtKey.split(" ").some((word) => word.startsWith(q))) return 2;
    if (row.districtKey.includes(q)) return 3;
    if (row.stateKey === q) return 4;
    if (row.stateKey.startsWith(q)) return 5;
    if (row.stateKey.includes(q)) return 6;
    return 50;
  }

  function stateScore(state, q) {
    let score = 99;
    tokensForState(state).forEach((token) => {
      if (token === q) score = Math.min(score, 0);
      else if (token.startsWith(q)) score = Math.min(score, 1);
      else if (token.includes(q)) score = Math.min(score, 2);
    });
    return score;
  }

  function splitCombinedValue(raw) {
    const parts = String(raw || "").split(",").map((part) => normalise(part)).filter(Boolean);
    if (parts.length >= 2) return { districtKey: parts[0], stateKey: parts.slice(1).join(" ") };
    return null;
  }

  function findMatches(raw) {
    const q = normalise(raw);
    if (!q || !rows.length) return [];

    const combined = splitCombinedValue(raw);
    if (combined) {
      const exactCombined = rows.filter((row) => row.districtKey === combined.districtKey && row.stateKey === combined.stateKey);
      if (exactCombined.length) return exactCombined;
    }

    const byDistrict = rows
      .filter((row) => row.districtKey.includes(q))
      .sort((a, b) => districtScore(a, q) - districtScore(b, q) ||
        a.state.localeCompare(b.state, "en-IN", { sensitivity: "base" }) ||
        a.district.localeCompare(b.district, "en-IN", { sensitivity: "base" }));

    const stateHits = states
      .map((state) => ({ state, score: stateScore(state, q) }))
      .filter((hit) => hit.score < 99)
      .sort((a, b) => a.score - b.score || a.state.localeCompare(b.state, "en-IN", { sensitivity: "base" }));

    const exactState = stateHits.find((hit) => tokensForState(hit.state).some((token) => token === q));
    const strongStates = exactState ? [exactState] : stateHits.filter((hit) => hit.score <= 1);

    const byState = strongStates.flatMap((hit) => rows.filter((row) => row.state === hit.state));

    const merged = new Map();
    byDistrict.concat(byState).forEach((row) => merged.set(uniqueKey(row), row));

    return Array.from(merged.values()).sort((a, b) => {
      if (exactState) {
        const as = a.state === exactState.state ? 0 : 1;
        const bs = b.state === exactState.state ? 0 : 1;
        if (as !== bs) return as - bs;
      }
      return districtScore(a, q) - districtScore(b, q) ||
        a.state.localeCompare(b.state, "en-IN", { sensitivity: "base" }) ||
        a.district.localeCompare(b.district, "en-IN", { sensitivity: "base" });
    }).slice(0, MAX_RESULTS);
  }

  function findExactDistrict(value) {
    const q = normalise(value);
    const combined = splitCombinedValue(value);
    if (combined) {
      return rows.find((row) => row.districtKey === combined.districtKey && row.stateKey === combined.stateKey) || null;
    }
    const districtMatches = rows.filter((row) => row.districtKey === q);
    return districtMatches.length === 1 ? districtMatches[0] : null;
  }

  function findState(value) {
    const q = normalise(value);
    if (!q) return null;
    return states.find((state) => tokensForState(state).some((token) => token === q)) ||
      states.find((state) => tokensForState(state).some((token) => token.startsWith(q))) ||
      null;
  }

  function buildNativeDatalists() {
    let districtList = document.getElementById("indiaDistrictNativeOptions");
    if (!districtList) {
      districtList = document.createElement("datalist");
      districtList.id = "indiaDistrictNativeOptions";
      document.body.appendChild(districtList);
    }
    districtList.innerHTML = rows.map((row) => '<option value="' + esc(row.district + ", " + row.state) + '"></option>').join("");

    let districtOnlyList = document.getElementById("indiaDistrictOnlyOptions");
    if (!districtOnlyList) {
      districtOnlyList = document.createElement("datalist");
      districtOnlyList.id = "indiaDistrictOnlyOptions";
      document.body.appendChild(districtOnlyList);
    }
    const districtOptions = new Map();
    rows.forEach((row) => {
      const label = row.district + (rows.filter((r) => r.districtKey === row.districtKey).length > 1 ? ", " + row.state : "");
      districtOptions.set(row.district + "|" + row.state, label);
    });
    districtOnlyList.innerHTML = Array.from(districtOptions.values()).map((value) => '<option value="' + esc(value) + '"></option>').join("");

    let stateList = document.getElementById("indiaStateNativeOptions");
    if (!stateList) {
      stateList = document.createElement("datalist");
      stateList.id = "indiaStateNativeOptions";
      document.body.appendChild(stateList);
    }
    stateList.innerHTML = states.map((state) => '<option value="' + esc(state) + '"></option>').join("");
  }

  function setSavedLocation(row) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: row.state, district: row.district })); } catch (_) {}
  }

  function initLocationBlock(block) {
    const input = block.querySelector("input[type='search'], input");
    let list = block.querySelector(".district-suggestions");
    const clearButton = block.querySelector("button");
    const card = block.closest(".location-card") || document;
    const result = card.querySelector(".location-result");
    const selectedText = card.querySelector("#selectedLocationText");
    const whatsappLink = card.querySelector("#locationWhatsApp");

    if (!input) return;
    if (!list) {
      list = document.createElement("ul");
      list.className = "district-suggestions";
      list.setAttribute("role", "listbox");
      block.appendChild(list);
    }

    input.setAttribute("list", "indiaDistrictNativeOptions");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-expanded", "false");

    let current = [];
    let active = -1;
    let timer = 0;

    function closeList() {
      list.innerHTML = "";
      list.hidden = true;
      list.style.display = "none";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }

    function showList() {
      list.hidden = false;
      list.removeAttribute("hidden");
      list.style.display = "block";
      input.setAttribute("aria-expanded", "true");
    }

    function select(row, focusButton) {
      input.value = row.district + ", " + row.state;
      if (selectedText) selectedText.textContent = row.district + ", " + row.state;
      if (whatsappLink) {
        const msg = "Hello Adwalaa, I want digital services for my business in " + row.district + ", " + row.state + ".";
        whatsappLink.href = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(msg);
      }
      setSavedLocation(row);
      closeList();
      if (result) {
        result.hidden = false;
        result.removeAttribute("hidden");
      }
      if (focusButton && result) {
        const a = result.querySelector("a");
        if (a) a.focus();
      }
    }

    function render() {
      const value = input.value || "";
      const q = normalise(value);
      if (result) result.hidden = true;
      if (!q) { closeList(); return; }

      current = findMatches(value);
      if (!current.length) {
        list.innerHTML = '<li class="no-result" role="status">District not found. Type official district or State/UT name. Example: Sitapur, Lucknow, UP, Delhi.</li>';
        showList();
        return;
      }

      const exactState = states.find((state) => tokensForState(state).some((token) => token === q));
      const heading = exactState
        ? '<li class="no-result" role="status">Showing all ' + current.length + ' districts of ' + esc(exactState) + '</li>'
        : '<li class="no-result" role="status">Showing ' + current.length + ' matching district record' + (current.length > 1 ? "s" : "") + '</li>';

      list.innerHTML = heading + current.map((row, index) =>
        '<li id="district-option-' + index + '" role="option" aria-selected="false" data-index="' + index + '">' +
          '<span class="district-name">' + esc(row.district) + '</span>' +
          '<span class="state-name">' + esc(row.state) + '</span>' +
        '</li>'
      ).join("");

      active = -1;
      showList();
    }

    function updateActive() {
      const options = Array.from(list.querySelectorAll('[role="option"]'));
      options.forEach((option, index) => {
        const isActive = index === active;
        option.classList.toggle("is-active", isActive);
        option.setAttribute("aria-selected", String(isActive));
      });
      if (active >= 0 && options[active]) {
        input.setAttribute("aria-activedescendant", options[active].id);
        options[active].scrollIntoView({ block: "nearest" });
      }
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(render, 10);
    });

    input.addEventListener("change", function () {
      const exact = findExactDistrict(input.value);
      if (exact) select(exact, false);
      else render();
    });

    input.addEventListener("focus", function () {
      if (input.value.trim()) render();
    });

    input.addEventListener("keydown", function (event) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && list.hidden) render();
      const options = Array.from(list.querySelectorAll('[role="option"]'));
      if (event.key === "ArrowDown") {
        event.preventDefault();
        active = Math.min(active + 1, options.length - 1);
        updateActive();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        active = Math.max(active - 1, 0);
        updateActive();
      } else if (event.key === "Enter" && active >= 0 && current[active]) {
        event.preventDefault();
        select(current[active], true);
      } else if (event.key === "Escape") {
        closeList();
      }
    });

    list.addEventListener("pointerdown", function (event) { event.preventDefault(); });
    list.addEventListener("click", function (event) {
      const option = event.target.closest('[role="option"]');
      if (!option) return;
      const row = current[Number(option.dataset.index)];
      if (row) select(row, false);
    });

    if (clearButton) {
      clearButton.addEventListener("click", function () {
        clearTimeout(timer);
        input.value = "";
        if (result) result.hidden = true;
        closeList();
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        input.focus();
      });
    }

    document.addEventListener("click", function (event) {
      if (!block.contains(event.target)) closeList();
    });

    closeList();
  }

  function initFormDistrictFields() {
    const forms = Array.from(document.querySelectorAll("form"));
    forms.forEach((form) => {
      const districtInput = form.querySelector('input[name="district"], input[id*="District"], input[id*="district"]');
      const stateInput = form.querySelector('input[name="state"], input[id*="State"], input[id*="state"]');
      if (!districtInput && !stateInput) return;

      if (districtInput) {
        districtInput.setAttribute("list", "indiaDistrictNativeOptions");
        districtInput.setAttribute("autocomplete", "off");
        districtInput.placeholder = districtInput.placeholder || "Type district name";
      }

      if (stateInput) {
        stateInput.setAttribute("list", "indiaStateNativeOptions");
        stateInput.setAttribute("autocomplete", "off");
        stateInput.placeholder = stateInput.placeholder || "Type State/UT";
      }

      function applyFromDistrict() {
        if (!districtInput) return;
        const exact = findExactDistrict(districtInput.value);
        if (exact) {
          districtInput.value = exact.district;
          if (stateInput) stateInput.value = exact.state;
          setSavedLocation(exact);
          return;
        }
        const matches = findMatches(districtInput.value);
        if (matches.length === 1) {
          districtInput.value = matches[0].district;
          if (stateInput) stateInput.value = matches[0].state;
          setSavedLocation(matches[0]);
        }
      }

      function applyFromState() {
        if (!stateInput) return;
        const state = findState(stateInput.value);
        if (state) stateInput.value = state;
      }

      if (districtInput) {
        districtInput.addEventListener("change", applyFromDistrict);
        districtInput.addEventListener("blur", applyFromDistrict);
      }
      if (stateInput) {
        stateInput.addEventListener("change", applyFromState);
        stateInput.addEventListener("blur", applyFromState);
      }

      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (saved && saved.district && saved.state) {
          if (districtInput && !districtInput.value) districtInput.value = saved.district;
          if (stateInput && !stateInput.value) stateInput.value = saved.state;
        }
      } catch (_) {}
    });
  }

  function startWithData() {
    prepare(window.INDIA_DISTRICTS || []);
    buildNativeDatalists();
    document.querySelectorAll(".location-search-block").forEach(initLocationBlock);
    initFormDistrictFields();
  }

  function start() {
    startWithData();

    // Optional refresh from JSON when hosted through Node/HTTP. The inline fallback is already the full 784-record data, so file:// also works.
    fetch("assets/data/india-districts.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => {
        if (!Array.isArray(data) || !data.length) return;
        const oldCount = rows.length;
        prepare(data);
        if (rows.length >= oldCount) {
          buildNativeDatalists();
          initFormDistrictFields();
        }
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
