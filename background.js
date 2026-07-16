const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "testConnection") {
      handleTestConnection(request.apiKey, request.model, sendResponse);
      return true;
    } else if (request.action === "analyzeComplexity") {
      handleAnalyzeComplexity(request.payload, sendResponse);
      return true;
    }
  });
}

async function handleTestConnection(apiKey, model, sendResponse) {
  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "Respond only with the word OK." },
          { role: "user", content: "Hello" }
        ],
        max_tokens: 5
      })
    });

    if (response.ok) {
      sendResponse({ success: true });
    } else {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error && errorData.error.message
        ? errorData.error.message
        : `HTTP error ${response.status}`;
      sendResponse({ success: false, error: errorMessage });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleAnalyzeComplexity(payload, sendResponse) {
  try {
    const credentials = await new Promise((resolve) => {
      chrome.storage.local.get(["groqApiKey", "groqModel"], (result) => {
        resolve(result);
      });
    });

    if (!credentials.groqApiKey) {
      sendResponse({ success: false, error: "Missing Groq API Key. Configure the extension via the popup." });
      return;
    }

    const apiKey = credentials.groqApiKey;
    const model = credentials.groqModel || "llama-3.1-8b-instant";

    const systemPrompt = `You are an expert algorithms and code analysis engine replicating LeetCode's premium Analysis feature.
Analyze the submitted code for the given problem and respond ONLY with a JSON object in exactly this structure, no markdown, no extra text:
{
  "checks": {
    "approach": true,
    "efficiency": true,
    "codeStyle": true
  },
  "congratulations": "One short sentence praising or advising the user.",
  "issueReason": "If any of checks.approach, checks.efficiency, or checks.codeStyle is false, explain the specific issues/flaws in 2-3 lines. If all checks are true, leave this field empty (or null).",
  "approach": {
    "current": "Name of the data structure or algorithm the user used (e.g. Hash Table, Two Pointers)",
    "suggested": "Name of the optimal approach (e.g. Hash Table)",
    "keyIdea": "One sentence describing the core idea of the optimal approach.",
    "consider": "One thought-provoking follow-up question to deepen understanding.",
    "alternatives": "A brief suggestion comparing the current implementation style/syntax with an alternative way (e.g., raw loop vs. STL/built-in functions, recursion vs. iteration, or language-specific idioms like std::max_element)."
  },
  "timeComplexity": {
    "current": "O(N)",
    "suggested": "O(N)",
    "suggestions": "One sentence: either praise if optimal, or a concrete tip to improve time efficiency."
  },
  "spaceComplexity": {
    "current": "O(N)",
    "suggested": "O(1)",
    "suggestions": "One sentence: either praise if optimal, or a concrete tip to improve space efficiency."
  },
  "isOptimal": true
}
All complexity values must use Big-O notation like O(1), O(N), O(N log N), O(N²), O(2^N).
Set checks.approach/efficiency/codeStyle to false only when there is a clear flaw in that area.`;

    const userPrompt = `Problem: ${payload.problemTitle}
Language: ${payload.language}

Submitted Code:
\`\`\`
${payload.code}
\`\`\``;

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error && errorData.error.message
        ? errorData.error.message
        : `HTTP error ${response.status} `;
      sendResponse({ success: false, error: errorMessage });
      return;
    }

    const data = await response.json();
    const resultText = data.choices[0].message.content;
    const analysis = JSON.parse(resultText);

    sendResponse({ success: true, data: analysis });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
