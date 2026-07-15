document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("api-key");
  const modelSelect = document.getElementById("model-select");
  const saveButton = document.getElementById("save-btn");
  const testButton = document.getElementById("test-btn");
  const statusMessage = document.getElementById("status-message");

  // Load existing configuration
  chrome.storage.local.get(["groqApiKey", "groqModel"], (result) => {
    if (result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
    }
    if (result.groqModel) {
      modelSelect.value = result.groqModel;
    }
  });

  // Save Settings handler
  saveButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
      showStatus("Please enter a Groq API Key.", "error");
      return;
    }

    chrome.storage.local.set(
      {
        groqApiKey: apiKey,
        groqModel: model
      },
      () => {
        showStatus("Settings saved successfully.", "success");
      }
    );
  });

  // Test Connection handler
  testButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
      showStatus("Please enter an API Key to test.", "error");
      return;
    }

    showStatus("Testing API connection...", "info");
    testButton.disabled = true;

    // Send connection test to background script
    chrome.runtime.sendMessage(
      {
        action: "testConnection",
        apiKey: apiKey,
        model: model
      },
      (response) => {
        testButton.disabled = false;
        if (response && response.success) {
          showStatus("Connection successful. API key is valid.", "success");
        } else {
          const errMsg = response && response.error ? response.error : "Connection failed.";
          showStatus(errMsg, "error");
        }
      }
    );
  });

  function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-message ${type}`;
    statusMessage.classList.remove("hidden");
  }
});
