(function () {
  'use strict';

  const COMPONENT_PREFIX = "groq-complexity";
  const DETAIL_PAGE_RE = /\/problems\/[^/]+\/submissions\/\d+/;

  let lastUrl = location.href;
  let injectedButton = null;
  let extractionRetries = 0;
  const MAX_RETRIES = 15;
  let lastStatusText = "";

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
    const currentStatus = extractSubmissionStatus();
    if (currentStatus !== lastStatusText) {
      lastStatusText = currentStatus;
      extractionRetries = 0;
    }

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
    const hasAnchorBtn = !!findAnchorButton();
    return isSubUrl || hasAnchorBtn;
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

    const anchorBtn = findAnchorButton();
    const payload = extractSubmissionData(anchorBtn);

    if (!anchorBtn || !payload.code || !payload.problemTitle) {
      if (extractionRetries < MAX_RETRIES) {
        extractionRetries++;
        scheduleHook();
      }
      return;
    }

    hookButton(anchorBtn);
    autoLoadOrTrigger(payload);
  }

  function findAnchorButton() {
    for (const btn of document.querySelectorAll("button")) {
      const text = (btn.textContent || "").trim();
      if (/^analysis$/i.test(text)) {
        return btn;
      }
    }
    for (const btn of document.querySelectorAll("button")) {
      const text = (btn.textContent || "").trim();
      if (/^solution$/i.test(text)) {
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
      } else if (/solution/i.test(textNode.nodeValue)) {
        textNode.nodeValue = textNode.nodeValue.replace(/solution/i, "Rustyn Analyzer");
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
        if (cached && cached.code === payload.code && cached.status === payload.status) {
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

  function extractSubmissionStatus() {
    const statuses = [
      "Wrong Answer", "Time Limit Exceeded", "Runtime Error",
      "Compile Error", "Memory Limit Exceeded", "Output Limit Exceeded",
      "Accepted"
    ];
    for (const status of statuses) {
      const elements = document.querySelectorAll("div, span, h1, h2, h3, p, a");
      for (const el of elements) {
        if (el.textContent) {
          const txt = el.textContent.trim().toLowerCase();
          if (txt === status.toLowerCase()) {
            return status;
          }
        }
      }
    }
    for (const status of statuses) {
      const elements = document.querySelectorAll("div, span, h1, h2, h3, p, a");
      for (const el of elements) {
        if (el.textContent && el.textContent.includes(status)) {
          return status;
        }
      }
    }
    return "Accepted";
  }

  function extractSubmissionData(officialBtn) {
    const data = { code: "", language: "unknown", problemTitle: "", status: "Accepted" };
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

      data.status = extractSubmissionStatus();

      const activeBtn = officialBtn || findAnchorButton();
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
          response.data.status = payload.status;
          const cacheData = { code: payload.code, status: payload.status, data: response.data };
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
    const anchorBtn = findAnchorButton();
    if (!anchorBtn) return null;

    let parent = anchorBtn.parentElement;
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

  function findExpectedCard() {
    const elements = document.querySelectorAll("div, span, p, h1, h2, h3");
    for (const el of elements) {
      if (el.textContent && el.textContent.trim() === "Expected") {
        let curr = el;
        while (curr && curr.parentElement) {
          if (curr.parentElement.querySelector(".monaco-editor") || curr.parentElement.querySelector("pre") || curr.parentElement.textContent.includes("Input")) {
            return curr;
          }
          curr = curr.parentElement;
        }
      }
    }
    return null;
  }

  function findInsertionAnchor() {
    const statsCard = findStatsCardWithinDetail();
    if (statsCard) {
      return { element: statsCard, position: "stats" };
    }

    const expectedCard = findExpectedCard();
    if (expectedCard) {
      return { element: expectedCard, position: "after" };
    }

    const anchorBtn = findAnchorButton();
    if (anchorBtn) {
      let parent = anchorBtn.parentElement;
      while (parent && parent !== document.body) {
        const monaco = parent.querySelector(".monaco-editor");
        if (monaco) return { element: monaco, position: "before" };
        const pre = parent.querySelector("pre");
        if (pre) return { element: pre, position: "before" };
        const codeEl = parent.querySelector("code");
        if (codeEl) return { element: codeEl, position: "before" };
        parent = parent.parentElement;
      }
    }
    return null;
  }

  function insertBeforeStats(el) {
    const anchor = findInsertionAnchor();
    if (anchor && anchor.element && anchor.element.parentNode) {
      if (anchor.position === "after") {
        anchor.element.parentNode.insertBefore(el, anchor.element.nextSibling);
      } else {
        anchor.element.parentNode.insertBefore(el, anchor.element);
      }
    } else {
      (document.querySelector("main, #app, body") || document.body).appendChild(el);
    }
  }

  function insertAfterStats(el) {
    const anchor = findInsertionAnchor();
    if (anchor && anchor.element && anchor.element.parentNode) {
      if (anchor.position === "stats" || anchor.position === "after") {
        anchor.element.parentNode.insertBefore(el, anchor.element.nextSibling);
      } else {
        anchor.element.parentNode.insertBefore(el, anchor.element.nextSibling);
      }
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

    const statsCard = findStatsCardWithinDetail();
    const tabHtml = statsCard ? "" : `
      <div class="rc-tab-container">
        <button class="rc-tab-btn ${activeTab === 'time' ? 'active' : ''}" id="${COMPONENT_PREFIX}-tab-time">Runtime</button>
        <button class="rc-tab-btn ${activeTab === 'space' ? 'active' : ''}" id="${COMPONENT_PREFIX}-tab-space">Memory</button>
      </div>
    `;

    const effBody = effCard.querySelector(".rc-eff-body");
    if (effBody) {
      effBody.innerHTML = `
        <div style="width: 100%;">
          ${tabHtml}
          <div style="display: flex; align-items: flex-start; gap: 16px;">
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
          </div>
        </div>
      `;

      if (!statsCard) {
        const timeBtn = document.getElementById(`${COMPONENT_PREFIX}-tab-time`);
        const spaceBtn = document.getElementById(`${COMPONENT_PREFIX}-tab-space`);
        if (timeBtn && spaceBtn) {
          timeBtn.addEventListener("click", () => {
            if (activeTab !== "time") {
              activeTab = "time";
              updateEfficiencyCard();
            }
          });
          spaceBtn.addEventListener("click", () => {
            if (activeTab !== "space") {
              activeTab = "space";
              updateEfficiencyCard();
            }
          });
        }
      }
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

    const isAccepted = (data.status === "Accepted");
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
      ? `<div class="rc-issue-reason-box">
           <div class="rc-issue-title-row">
             <span class="rc-issue-label">Code Issue Reason:</span>
           </div>
           <div class="rc-issue-val">${data.issueReason}</div>
         </div>`
      : "";

    if (isAccepted) {
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
    } else {
      // Failed submission: only show congratulations feedback and the Code Issue Reason box
      const issueHtmlFailed = data.issueReason
        ? `<div class="rc-issue-reason-box">
             <div class="rc-issue-title-row">
               <span class="rc-issue-label">Logical Flaw Identified:</span>
             </div>
             <div class="rc-issue-val">${data.issueReason}</div>
           </div>`
        : "";

      approachCard.innerHTML = `
        <div class="rc-failed-header">
          <svg class="rc-failed-svg" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
          <span>Feedback & Correction Hints</span>
        </div>
        ${data.congratulations ? `<p class="rc-failed-intro">${data.congratulations}</p>` : ""}
        ${issueHtmlFailed}
      `;
    }
    insertBeforeStats(approachCard);

    if (isAccepted) {
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
    }

    approachCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  scheduleHook();

})();
