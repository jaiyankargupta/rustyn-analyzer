(function () {
  'use strict';

  const COMPONENT_PREFIX = "groq-complexity";
  const DETAIL_PAGE_RE = /\/problems\/[^/]+\/submissions\/\d+/;

  let injectedButton = null;
  let lastUrl = location.href;

  if (window.__rustynAnalyzerActive) return;
  window.__rustynAnalyzerActive = true;

  function isExtensionAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }

  function makeGuardedObserver(fn) {
    const obs = new MutationObserver((_, self) => {
      if (!isExtensionAlive()) { self.disconnect(); return; }
      try { fn(); } catch (_) { self.disconnect(); }
    });
    return obs;
  }

  const observer = makeGuardedObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigate();
    } else {
      scheduleHook();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let hookTimer = null;
  function scheduleHook() {
    if (hookTimer) return;
    hookTimer = setTimeout(() => {
      hookTimer = null;
      if (!isExtensionAlive()) return;
      try { tryHookButton(); } catch (_) { }
    }, 600);
  }

  function onNavigate() {
    if (!isDetailPage()) {
      removeInjectedButton();
      removeAllCards();
    } else {
      scheduleHook();
    }
  }

  function isDetailPage() {
    return DETAIL_PAGE_RE.test(location.pathname);
  }

  function tryHookButton() {
    if (!isDetailPage()) return;
    if (document.getElementById(`${COMPONENT_PREFIX}-btn`)) return;
    const officialBtn = findOfficialAnalysisButton();
    if (!officialBtn) return;
    hookButton(officialBtn);
    autoLoadCache();
  }

  function autoLoadCache() {
    if (!isExtensionAlive()) return;
    const payload = extractSubmissionData();
    if (!payload.code || !payload.problemTitle) return;

    const cacheKey = `${COMPONENT_PREFIX}-cache-${payload.problemTitle}`;
    try {
      chrome.storage.local.get([cacheKey], (result) => {
        if (!isExtensionAlive()) return;
        const cached = result[cacheKey];
        if (cached && cached.code === payload.code) {
          renderAnalysis(cached.data);
        }
      });
    } catch (_) { }
  }

  function findOfficialAnalysisButton() {
    for (const btn of document.querySelectorAll("button")) {
      const text = (btn.textContent || "").trim();
      if (/^analysis$/i.test(text) && !btn.id.includes(COMPONENT_PREFIX)) return btn;
    }
    return null;
  }

  function hookButton(officialBtn) {
    if (document.getElementById(`${COMPONENT_PREFIX}-btn`)) return;
    const ourBtn = officialBtn.cloneNode(true);
    ourBtn.id = `${COMPONENT_PREFIX}-btn`;
    ourBtn.removeAttribute("onclick");
    ourBtn.removeAttribute("title");
    ourBtn.removeAttribute("data-title");
    ourBtn.removeAttribute("aria-describedby");
    ourBtn.removeAttribute("data-state");
    ourBtn.removeAttribute("aria-haspopup");
    ourBtn.removeAttribute("aria-expanded");
    ourBtn.removeAttribute("aria-controls");

    ourBtn.querySelectorAll("[title]").forEach(el => el.removeAttribute("title"));
    ourBtn.querySelectorAll("[data-title]").forEach(el => el.removeAttribute("data-title"));
    ourBtn.querySelectorAll("[aria-describedby]").forEach(el => el.removeAttribute("aria-describedby"));
    ourBtn.querySelectorAll("[data-state]").forEach(el => el.removeAttribute("data-state"));

    Array.from(ourBtn.attributes).forEach(attr => {
      if (attr.name.startsWith("data-") && attr.name !== "data-original-html" && attr.name !== "data-rustyn-hooked") {
        ourBtn.removeAttribute(attr.name);
      }
    });

    ourBtn.style.marginLeft = "8px";

    const walk = document.createTreeWalker(ourBtn, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    while (textNode = walk.nextNode()) {
      if (/analysis/i.test(textNode.nodeValue)) {
        textNode.nodeValue = textNode.nodeValue.replace(/analysis/i, "Rustyn Analysis");
      }
    }

    ourBtn.dataset.originalHtml = ourBtn.innerHTML;
    ourBtn.dataset.rustynHooked = "true";

    const preventDelegation = (e) => {
      e.stopImmediatePropagation();
      e.stopPropagation();
    };
    [
      "mouseover", "mouseout", "mouseenter", "mouseleave", "mousemove",
      "pointerover", "pointerout", "pointerenter", "pointerleave", "pointermove",
      "focus", "focusin", "focusout", "blur"
    ].forEach(evt => {
      ourBtn.addEventListener(evt, preventDelegation, true);
    });

    ourBtn.addEventListener("click", (e) => {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      triggerAnalysis();
    }, true);

    officialBtn.parentNode.insertBefore(ourBtn, officialBtn.nextSibling);
    injectedButton = ourBtn;
  }

  function removeInjectedButton() {
    const btn = document.getElementById(`${COMPONENT_PREFIX}-btn`);
    if (btn) btn.remove();
    injectedButton = null;
  }

  function extractSubmissionData() {
    const data = { code: "", language: "unknown", problemTitle: "" };
    try {
      const titleMatch = document.title.match(/^(.*?)\s*-\s*LeetCode/i);
      if (titleMatch && titleMatch[1]) {
        data.problemTitle = titleMatch[1].trim();
      } else {
        const parts = location.pathname.split("/");
        const idx = parts.indexOf("problems");
        if (idx !== -1 && parts[idx + 1]) {
          data.problemTitle = parts[idx + 1].split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        }
      }

      const monacoEditor = document.querySelector(".monaco-editor");
      if (monacoEditor) {
        const lines = monacoEditor.querySelectorAll(".view-line");
        if (lines.length > 0) data.code = Array.from(lines).map(l => l.textContent).join("\n").trim();
      }
      if (!data.code) {
        const pre = document.querySelector("pre");
        if (pre) data.code = pre.textContent.trim();
      }

      const langLabel = document.querySelector("[class*='coding_language']");
      if (langLabel) {
        data.language = langLabel.textContent.trim().toLowerCase();
      } else {
        for (const el of document.querySelectorAll("span, div")) {
          const t = (el.textContent || "").trim().toLowerCase();
          if (/^(java|python|c\+\+|javascript|typescript|rust|go|swift|kotlin|c)$/.test(t)) {
            data.language = t;
            break;
          }
        }
      }
    } catch (e) {
      console.warn("[Rustyn] extraction error:", e);
    }
    return data;
  }

  function triggerAnalysis() {
    const btn = document.getElementById(`${COMPONENT_PREFIX}-btn`) || injectedButton;
    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = "Analyzing...";
    btn.classList.add("loading");
    removeAllCards();

    const payload = extractSubmissionData();
    if (!payload.code) {
      showError("Could not extract code. Make sure you're on the submission detail page.");
      resetButton();
      return;
    }
    const cacheKey = `${COMPONENT_PREFIX}-cache-${payload.problemTitle}`;

    try {
      chrome.storage.local.get([cacheKey], (result) => {
        if (!isExtensionAlive()) {
          resetButton();
          return;
        }

        const cached = result[cacheKey];
        if (cached && cached.code === payload.code) {
          renderAnalysis(cached.data);
          resetButton();
          return;
        }

        chrome.runtime.sendMessage({ action: "analyzeComplexity", payload }, (response) => {
          resetButton();
          if (chrome.runtime.lastError) { showError("Extension context lost. Please refresh the page."); return; }
          if (response && response.success) {
            const cacheData = { code: payload.code, data: response.data };
            chrome.storage.local.set({ [cacheKey]: cacheData }, () => {
              if (chrome.runtime.lastError) console.warn("[Rustyn] cache write error:", chrome.runtime.lastError);
            });
            renderAnalysis(response.data);
          } else {
            showError((response && response.error) || "An unexpected error occurred.");
          }
        });
      });
    } catch (err) {
      showError("Extension error: " + err.message);
      resetButton();
    }
  }

  function resetButton() {
    const btn = document.getElementById(`${COMPONENT_PREFIX}-btn`) || injectedButton;
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalHtml || "Analysis";
    btn.classList.remove("loading");
  }

  function findStatsCard() {
    for (const div of document.querySelectorAll("div")) {
      if (div.children.length === 0 && /^runtime$/i.test((div.textContent || "").trim())) {
        let el = div.parentElement;
        let statsGrid = null;
        for (let i = 0; i < 5; i++) {
          if (el && /memory/i.test(el.textContent || "")) {
            statsGrid = el;
            break;
          }
          if (el) el = el.parentElement;
        }
        if (statsGrid) {
          return statsGrid.parentElement;
        }
      }
    }
    return null;
  }

  function insertBeforeStats(el) {
    const statsCard = findStatsCard();
    if (statsCard && statsCard.parentNode) {
      statsCard.parentNode.insertBefore(el, statsCard);
    } else {
      (document.querySelector("main, #app, body") || document.body).appendChild(el);
    }
  }

  function insertAfterStats(el) {
    const statsCard = findStatsCard();
    if (statsCard && statsCard.parentNode) {
      statsCard.parentNode.insertBefore(el, statsCard.nextSibling);
    } else {
      (document.querySelector("main, #app, body") || document.body).appendChild(el);
    }
  }

  function removeAllCards() {
    [`${COMPONENT_PREFIX}-approach`, `${COMPONENT_PREFIX}-efficiency`, `${COMPONENT_PREFIX}-error`]
      .forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  }

  function showError(message) {
    removeAllCards();
    const div = document.createElement("div");
    div.id = `${COMPONENT_PREFIX}-error`;
    div.className = `${COMPONENT_PREFIX}-error-card`;
    div.innerHTML = `<div class="rc-header">Analysis Error</div><p>${message}</p>`;
    insertBeforeStats(div);
  }

  function drawComplexityGraph(notation) {
    const W = 130, H = 90, pad = 14;
    const innerW = W - pad * 2, innerH = H - pad * 2;

    function getY(x) {
      const n = (notation || "").toUpperCase().replace(/\s/g, "");
      if (/O\(1\)/.test(n)) return 0.05;
      if (/O\(LOGN\)/.test(n)) return Math.log(x * 9 + 1) / Math.log(10) * 0.7;
      if (/O\(N\)/.test(n) && !/O\(NLOGN\)|O\(N2\)|O\(N\^2\)/.test(n)) return x * 0.9;
      if (/O\(NLOGN\)/.test(n)) return x * (1 + Math.log(x * 9 + 1) / Math.log(10)) * 0.55;
      if (/O\(N[²2\^]/.test(n)) return Math.pow(x, 2) * 0.95;
      if (/O\(2/.test(n)) return Math.min(Math.pow(2, x * 4) / 16, 1) * 0.95;
      return x * 0.9;
    }

    const steps = 40;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const x = i / steps;
      const y = getY(x);
      const px = pad + x * innerW;
      const py = pad + innerH - y * innerH;
      points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    const polyline = points.join(" ");

    return `<svg xmlns="http://www.w3.org/2000/svg" class="rc-svg-graph" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <line class="graph-axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${pad + innerH}" stroke-width="1"/>
      <line class="graph-axis" x1="${pad}" y1="${pad + innerH}" x2="${pad + innerW}" y2="${pad + innerH}" stroke-width="1"/>
      <polyline class="graph-curve" points="${polyline}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <text class="graph-text" x="${pad + innerW - 2}" y="${pad + 10}" text-anchor="end" font-size="11" font-family="monospace">${notation || ""}</text>
    </svg>`;
  }

  function renderAnalysis(data) {
    removeAllCards();

    const checks = data.checks || { approach: true, efficiency: true, codeStyle: true };
    const approach = data.approach || {};
    const eff = data.efficiency || {};

    const checkMark = (ok) => ok
      ? `<span class="rc-check ok">&#10003;</span>`
      : `<span class="rc-check fail">&#10007;</span>`;

    const approachCard = document.createElement("div");
    approachCard.id = `${COMPONENT_PREFIX}-approach`;
    approachCard.className = `${COMPONENT_PREFIX}-panel`;
    approachCard.innerHTML = `
      <div class="rc-checks-row">
        ${checkMark(checks.approach)} <span>Approach</span>
        ${checkMark(checks.efficiency)} <span>Efficiency</span>
        ${checkMark(checks.codeStyle)} <span>Code Style</span>
      </div>
      ${data.congratulations ? `<p class="rc-congrats">${data.congratulations}</p>` : ""}
      <div class="rc-section-title">
        Approach
      </div>
      <div class="rc-row"><span class="rc-label">Current</span><span class="rc-val">${approach.current || "—"}</span></div>
      <div class="rc-row"><span class="rc-label">Suggested</span><span class="rc-val rc-suggested">${approach.suggested || "—"}</span></div>
      ${approach.keyIdea ? `<div class="rc-row"><span class="rc-label">Key Idea</span><span class="rc-val">${approach.keyIdea}</span></div>` : ""}
      ${approach.consider ? `<div class="rc-row"><span class="rc-label">Consider</span><span class="rc-val rc-italic">${approach.consider}</span></div>` : ""}
    `;
    insertBeforeStats(approachCard);

    const effCard = document.createElement("div");
    effCard.id = `${COMPONENT_PREFIX}-efficiency`;
    effCard.className = `${COMPONENT_PREFIX}-panel`;
    effCard.innerHTML = `
      <div class="rc-eff-body">
        <div class="rc-eff-left">
          <div class="rc-section-title">
            Efficiency
          </div>
          <div class="rc-row"><span class="rc-label">Current complexity</span><span class="rc-val rc-mono">${eff.currentComplexity || "—"}</span></div>
          <div class="rc-row"><span class="rc-label">Suggested complexity</span><span class="rc-val rc-suggested rc-mono">${eff.suggestedComplexity || "—"}</span></div>
          ${eff.suggestions ? `<div class="rc-row"><span class="rc-label">Suggestions</span><span class="rc-val">${eff.suggestions}</span></div>` : ""}
        </div>
        <div class="rc-graph">
          ${drawComplexityGraph(eff.suggestedComplexity)}
        </div>
      </div>
    `;
    insertAfterStats(effCard);

    approachCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  scheduleHook();

})();
