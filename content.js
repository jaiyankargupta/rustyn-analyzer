(function () {
  'use strict';

  const COMPONENT_PREFIX = "groq-complexity";
  const DETAIL_PAGE_RE = /\/problems\/[^/]+\/submissions\/\d+/;

  let lastUrl = location.href;
  let injectedButton = null;
  let extractionRetries = 0;
  const MAX_RETRIES = 15;

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
    extractionRetries = 0;
    if (!isDetailPage()) {
      removeInjectedButton();
      removeAllCards();
    } else {
      scheduleHook();
    }
  }

  function isDetailPage() {
    const isSubUrl = DETAIL_PAGE_RE.test(location.pathname);
    const hasAnalysisBtn = !!findOfficialAnalysisButton();
    return isSubUrl || hasAnalysisBtn;
  }

  function tryHookButton() {
    if (!isDetailPage()) return;

    if (document.getElementById(`${COMPONENT_PREFIX}-btn`)) {
      const approachCard = document.getElementById(`${COMPONENT_PREFIX}-approach`);
      const effCard = document.getElementById(`${COMPONENT_PREFIX}-efficiency`);
      if (!approachCard || !effCard) {
        autoLoadOrTrigger();
      }
      return;
    }

    const officialBtn = findOfficialAnalysisButton();
    const payload = extractSubmissionData(officialBtn);

    if (!officialBtn || !payload.code || !payload.problemTitle) {
      if (extractionRetries < MAX_RETRIES) {
        extractionRetries++;
        scheduleHook();
      }
      return;
    }

    hookButton(officialBtn);
    autoLoadOrTrigger(payload);
  }

  function findOfficialAnalysisButton() {
    for (const btn of document.querySelectorAll("button")) {
      const text = (btn.textContent || "").trim();
      if (/^analysis$/i.test(text)) {
        return btn;
      }
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
        textNode.nodeValue = textNode.nodeValue.replace(/analysis/i, "Rustyn Analyzer");
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
      manualTrigger();
    }, true);

    officialBtn.parentNode.insertBefore(ourBtn, officialBtn.nextSibling);
    injectedButton = ourBtn;
  }

  function removeInjectedButton() {
    const btn = document.getElementById(`${COMPONENT_PREFIX}-btn`);
    if (btn) btn.remove();
    injectedButton = null;
  }

  function resetButton() {
    const btn = document.getElementById(`${COMPONENT_PREFIX}-btn`) || injectedButton;
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("loading");
      if (btn.dataset.originalHtml) {
        btn.innerHTML = btn.dataset.originalHtml;
      }
    }
  }

  function autoLoadOrTrigger(payload) {
    if (!isExtensionAlive()) return;
    if (!payload) {
      payload = extractSubmissionData();
    }
    if (!payload.code || !payload.problemTitle) return;

    lastAnalyzedUrl = location.href;

    const cacheKey = `${COMPONENT_PREFIX}-cache-${payload.problemTitle}`;
    try {
      chrome.storage.local.get([cacheKey], (result) => {
        if (!isExtensionAlive()) return;
        const cached = result[cacheKey];
        if (cached && cached.code === payload.code) {
          renderAnalysis(cached.data);
        } else {
          triggerAnalysis(payload);
        }
      });
    } catch (_) {
      triggerAnalysis(payload);
    }
  }

  function manualTrigger() {
    if (!isExtensionAlive()) {
      showError("Extension context was lost due to a reload. Please refresh the page.");
      return;
    }
    const payload = extractSubmissionData();
    if (!payload.code) {
      showError("Could not extract code. Make sure you're on the submission detail page.");
      return;
    }
    triggerAnalysis(payload);
  }

  function extractSubmissionData(officialBtn) {
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

      const activeBtn = officialBtn || findOfficialAnalysisButton();
      let codeContainer = null;
      let codeType = "";

      if (activeBtn) {
        let parent = activeBtn.parentElement;
        while (parent && parent !== document.body) {
          const monaco = parent.querySelector(".monaco-editor");
          if (monaco) {
            codeContainer = monaco;
            codeType = "monaco";
            break;
          }
          const pre = parent.querySelector("pre");
          if (pre) {
            codeContainer = pre;
            codeType = "pre";
            break;
          }
          const codeEl = parent.querySelector("code");
          if (codeEl) {
            codeContainer = codeEl;
            codeType = "code";
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (!codeContainer) {
        const monacoEditors = document.querySelectorAll(".monaco-editor");
        if (monacoEditors.length > 0) {
          let found = false;
          for (let i = monacoEditors.length - 1; i >= 0; i--) {
            const editor = monacoEditors[i];
            const lines = editor.querySelectorAll(".view-line");
            if (lines.length > 0) {
              codeContainer = editor;
              codeType = "monaco";
              found = true;
              break;
            }
          }
          if (!found) {
            codeContainer = monacoEditors[0];
            codeType = "monaco";
          }
        }
      }

      if (!codeContainer) {
        const pre = document.querySelector("pre");
        if (pre) {
          codeContainer = pre;
          codeType = "pre";
        }
      }

      if (!codeContainer) {
        const codeEl = document.querySelector("code");
        if (codeEl) {
          codeContainer = codeEl;
          codeType = "code";
        }
      }

      if (codeContainer) {
        if (codeType === "monaco") {
          const lines = codeContainer.querySelectorAll(".view-line");
          if (lines.length > 0) {
            data.code = Array.from(lines).map(l => l.textContent).join("\n").trim();
          }
        } else {
          data.code = codeContainer.textContent.trim();
        }
      }
    } catch (_) { }
    return data;
  }

  function triggerAnalysis(payload) {
    if (!isExtensionAlive()) {
      showError("Extension context was lost due to a reload. Please refresh the page.");
      resetButton();
      return;
    }

    const btn = document.getElementById(`${COMPONENT_PREFIX}-btn`) || injectedButton;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = "Analyzing...";
      btn.classList.add("loading");
    }

    removeAllCards();
    showLoadingPlaceholder();

    const cacheKey = `${COMPONENT_PREFIX}-cache-${payload.problemTitle}`;
    try {
      chrome.runtime.sendMessage({ action: "analyzeComplexity", payload }, (response) => {
        resetButton();
        if (chrome.runtime.lastError) { showError("Extension context lost. Please refresh the page."); return; }
        if (response && response.success) {
          const cacheData = { code: payload.code, data: response.data };
          chrome.storage.local.set({ [cacheKey]: cacheData }, () => {
            if (chrome.runtime.lastError) { }
          });
          renderAnalysis(response.data);
        } else {
          showError((response && response.error) || "An unexpected error occurred.");
        }
      });
    } catch (_) {
      resetButton();
      showError("Extension error.");
    }
  }

  function findStatsCardWithinDetail() {
    const officialBtn = findOfficialAnalysisButton();
    if (!officialBtn) return null;

    let parent = officialBtn.parentElement;
    while (parent) {
      const txt = parent.textContent || "";
      if (/runtime/i.test(txt) && /memory/i.test(txt) && /beats/i.test(txt)) {
        for (const el of parent.querySelectorAll("div, span, p")) {
          if (/^runtime$/i.test((el.textContent || "").trim())) {
            let elStatsGrid = el.parentElement;
            while (elStatsGrid && elStatsGrid !== parent) {
              const innerTxt = elStatsGrid.textContent || "";
              if (/memory/i.test(innerTxt) && /beats/i.test(innerTxt)) {
                if (elStatsGrid.parentElement) {
                  return elStatsGrid.parentElement;
                }
                return elStatsGrid;
              }
              elStatsGrid = elStatsGrid.parentElement;
            }
          }
        }
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function insertBeforeStats(el) {
    const statsCard = findStatsCardWithinDetail();
    if (statsCard && statsCard.parentNode) {
      statsCard.parentNode.insertBefore(el, statsCard);
    } else {
      (document.querySelector("main, #app, body") || document.body).appendChild(el);
    }
  }

  function insertAfterStats(el) {
    const statsCard = findStatsCardWithinDetail();
    if (statsCard && statsCard.parentNode) {
      statsCard.parentNode.insertBefore(el, statsCard.nextSibling);
    } else {
      (document.querySelector("main, #app, body") || document.body).appendChild(el);
    }
  }

  function removeAllCards() {
    [`${COMPONENT_PREFIX}-approach`, `${COMPONENT_PREFIX}-efficiency`, `${COMPONENT_PREFIX}-error`, `${COMPONENT_PREFIX}-loading`]
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

  function showLoadingPlaceholder() {
    const div = document.createElement("div");
    div.id = `${COMPONENT_PREFIX}-loading`;
    div.className = `${COMPONENT_PREFIX}-panel rc-loading-panel`;
    div.innerHTML = `<div class="rc-loading-text">Analyzing complexity...</div>`;
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

  let lastAnalysisData = null;
  let activeTab = "time";

  function updateEfficiencyCard() {
    const effCard = document.getElementById(`${COMPONENT_PREFIX}-efficiency`);
    if (!effCard || !lastAnalysisData) return;

    let currentComplexity = "—";
    let suggestedComplexity = "—";
    let suggestions = "";

    if (activeTab === "time") {
      const timeEff = lastAnalysisData.timeComplexity || {};
      currentComplexity = timeEff.current || lastAnalysisData.efficiency?.currentComplexity || "—";
      suggestedComplexity = timeEff.suggested || lastAnalysisData.efficiency?.suggestedComplexity || "—";
      suggestions = timeEff.suggestions || lastAnalysisData.efficiency?.suggestions || "";
    } else {
      const spaceEff = lastAnalysisData.spaceComplexity || {};
      currentComplexity = spaceEff.current || "—";
      suggestedComplexity = spaceEff.suggested || "—";
      suggestions = spaceEff.suggestions || "";
    }

    const labelPrefix = activeTab === "time" ? "time" : "space";
    const sectionTitle = activeTab === "time" ? "Efficiency (Runtime)" : "Efficiency (Memory)";

    const effBody = effCard.querySelector(".rc-eff-body");
    if (effBody) {
      effBody.innerHTML = `
        <div class="rc-eff-left">
          <div class="rc-section-title">
            ${sectionTitle}
          </div>
          <div class="rc-row"><span class="rc-label">Current ${labelPrefix} complexity</span><span class="rc-val rc-mono">${currentComplexity}</span></div>
          <div class="rc-row"><span class="rc-label">Suggested ${labelPrefix} complexity</span><span class="rc-val rc-suggested rc-mono">${suggestedComplexity}</span></div>
          ${suggestions ? `<div class="rc-row"><span class="rc-label">Suggestions</span><span class="rc-val">${suggestions}</span></div>` : ""}
        </div>
        <div class="rc-graph">
          ${drawComplexityGraph(suggestedComplexity)}
        </div>
      `;
    }
  }

  function hookStatsTabs(statsCard, onSwitchTab) {
    if (!statsCard) return;
    if (statsCard.dataset.rustynListenerAttached) return;
    statsCard.dataset.rustynListenerAttached = "true";

    statsCard.addEventListener("click", (e) => {
      let curr = e.target;
      while (curr && curr !== statsCard) {
        const text = curr.textContent || "";
        const hasRuntime = /runtime/i.test(text);
        const hasMemory = /memory/i.test(text);
        if (hasRuntime && !hasMemory) {
          onSwitchTab("time");
          break;
        }
        if (hasMemory && !hasRuntime) {
          onSwitchTab("space");
          break;
        }
        curr = curr.parentElement;
      }
    });
  }

  function renderAnalysis(data) {
    removeAllCards();
    lastAnalysisData = data;
    activeTab = "time";

    const checks = data.checks || { approach: true, efficiency: true, codeStyle: true };
    const approach = data.approach || {};

    const checkMark = (ok) => ok
      ? `<span class="rc-check ok">&#10003;</span>`
      : `<span class="rc-check fail">&#10007;</span>`;

    const approachCard = document.createElement("div");
    approachCard.id = `${COMPONENT_PREFIX}-approach`;
    approachCard.className = `${COMPONENT_PREFIX}-panel`;

    const hasIssues = !checks.approach || !checks.efficiency || !checks.codeStyle;
    const issueHtml = (hasIssues && data.issueReason) 
      ? `<div class="rc-issue-reason-box"><span class="rc-issue-label">Code Issue Reason:</span><span class="rc-issue-val">${data.issueReason}</span></div>`
      : "";

    approachCard.innerHTML = `
      <div class="rc-checks-row">
        ${checkMark(checks.approach)} <span>Approach</span>
        ${checkMark(checks.efficiency)} <span>Efficiency</span>
        ${checkMark(checks.codeStyle)} <span>Code Style</span>
      </div>
      ${data.congratulations ? `<p class="rc-congrats">${data.congratulations}</p>` : ""}
      ${issueHtml}
      <div class="rc-section-title">
        Approach
      </div>
      <div class="rc-row"><span class="rc-label">Current</span><span class="rc-val">${approach.current || "—"}</span></div>
      <div class="rc-row"><span class="rc-label">Suggested</span><span class="rc-val rc-suggested">${approach.suggested || "—"}</span></div>
      ${approach.keyIdea ? `<div class="rc-row"><span class="rc-label">Key Idea</span><span class="rc-val">${approach.keyIdea}</span></div>` : ""}
      ${approach.alternatives ? `<div class="rc-row"><span class="rc-label">Alternatives</span><span class="rc-val">${approach.alternatives}</span></div>` : ""}
      ${approach.consider ? `<div class="rc-row"><span class="rc-label">Consider</span><span class="rc-val rc-italic">${approach.consider}</span></div>` : ""}
    `;
    insertBeforeStats(approachCard);

    const effCard = document.createElement("div");
    effCard.id = `${COMPONENT_PREFIX}-efficiency`;
    effCard.className = `${COMPONENT_PREFIX}-panel`;
    effCard.innerHTML = `<div class="rc-eff-body"></div>`;
    insertAfterStats(effCard);

    updateEfficiencyCard();

    const statsCard = findStatsCardWithinDetail();
    if (statsCard) {
      hookStatsTabs(statsCard, (tab) => {
        if (activeTab !== tab) {
          activeTab = tab;
          updateEfficiencyCard();
        }
      });
    }

    approachCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  scheduleHook();

})();
