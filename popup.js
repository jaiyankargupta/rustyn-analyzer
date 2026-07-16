document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("api-key");
  const modelSelect = document.getElementById("model-select");
  const saveButton = document.getElementById("save-btn");
  const testButton = document.getElementById("test-btn");
  const statusMessage = document.getElementById("status-message");
  const editButton = document.getElementById("edit-btn");

  const pencilIconHtml = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  `;

  const saveIconHtml = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  `;

  function setEditMode(isEditing) {
    if (isEditing) {
      apiKeyInput.readOnly = false;
      apiKeyInput.focus();
      editButton.innerHTML = saveIconHtml;
      editButton.title = "Save API Key";
    } else {
      apiKeyInput.readOnly = true;
      editButton.innerHTML = pencilIconHtml;
      editButton.title = "Edit API Key";
    }
  }

  // Load existing configuration
  chrome.storage.local.get(["groqApiKey", "groqModel"], (result) => {
    if (result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
      setEditMode(false);
    } else {
      setEditMode(true);
    }
    if (result.groqModel) {
      modelSelect.value = result.groqModel;
    }
  });

  // Edit toggle handler
  editButton.addEventListener("click", () => {
    const isReadOnly = apiKeyInput.readOnly;
    if (isReadOnly) {
      setEditMode(true);
    } else {
      saveSettings();
    }
  });

  function saveSettings() {
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
        setEditMode(false);
      }
    );
  }

  // Save Settings handler
  saveButton.addEventListener("click", () => {
    saveSettings();
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
