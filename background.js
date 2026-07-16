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
Analyze the submitted code for the given problem and the provided Submission Status.
Respond ONLY with a JSON object in exactly this structure, no markdown, no extra text:
{
  "checks": {
    "approach": true,
    "efficiency": true,
    "codeStyle": true
  },
  "congratulations": "One short sentence of encouragement or high-level feedback (praising if Accepted, or guiding if failed).",
  "issueReason": "If the submission status is not 'Accepted' or if any checks are false, explain the specific logic error, efficiency issue, or style violation in 2-3 lines to help the user debug. Do NOT provide direct code solutions, but guide them conceptually. If everything is optimal and Accepted, leave this empty (or null).",
  "approach": {
    "current": "Name of the data structure or algorithm the user used (e.g. Hash Table, Two Pointers)",
    "suggested": "Name of the optimal approach (e.g. Hash Table)",
    "keyIdea": "One sentence describing the core idea of the optimal approach.",
    "consider": "One thought-provoking follow-up question or edge case to check to help them fix their issue.",
    "alternatives": "A brief suggestion comparing their code structure with an alternative (e.g., using STL, recursion vs iteration, or a hint on how to fix the logic conceptually without giving code)."
  },
  "timeComplexity": {
    "current": "O(N)",
    "suggested": "O(N)",
    "suggestions": "One sentence analyzing the time complexity relative to the error (especially if Time Limit Exceeded)."
  },
  "spaceComplexity": {
    "current": "O(N)",
    "suggested": "O(1)",
    "suggestions": "One sentence analyzing the space complexity."
  },
  "isOptimal": true
}
All complexity values must use Big-O notation like O(1), O(N), O(N log N), O(N²), O(2^N).
If the submission status is not 'Accepted', set the corresponding check (approach or efficiency) to false so the user knows where the flaw lies.
CRITICAL: If the Submission Status is NOT "Accepted" (e.g. "Wrong Answer", "Time Limit Exceeded", etc.), you MUST set at least one of checks.approach or checks.efficiency to false. You MUST explain the failure in the "issueReason" field (2-3 lines). In the "congratulations" field, do NOT say the code is correct; instead, write a supportive sentence urging the user to fix the bug.
Do NOT output full correct code solutions. Focus on explaining the concepts and pointing out the logical flaws so the user can understand and improve their own code.`;

    const userPrompt = `Problem: ${payload.problemTitle}
Language: ${payload.language}
Submission Status: ${payload.status || "Accepted"}

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
