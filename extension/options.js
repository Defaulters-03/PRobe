document.addEventListener('DOMContentLoaded', () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const apiUrlForm = document.getElementById('apiUrlForm');
  const statusBadge = document.getElementById('statusBadge');
  const formText = apiUrlInput.parentElement.querySelector('.form-text');

  // Load current API URL from storage
  function loadApiUrl() {
    chrome.storage.sync.get(['apiUrl'], (result) => {
      const apiUrl = result.apiUrl || 'http://localhost:4000';
      apiUrlInput.value = apiUrl;

      // Test connection to the API
      testConnection(apiUrl);
    });
  }

  // Test connection to the API
  function testConnection(apiUrl) {
    statusBadge.style.display = 'inline-flex';
    statusBadge.className = 'status-badge';
    statusBadge.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      </svg>
      Testing connection...
    `;

    fetch(`${apiUrl}/health`, {
      method: 'GET',
      timeout: 5000
    })
    .then(response => {
      if (response.ok) {
        statusBadge.className = 'status-badge connected';
        statusBadge.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="8" fill="currentColor"/>
          </svg>
          Connected
        `;
        if (formText) {
          formText.textContent = `The API URL used to analyze GitHub pull requests. This is stored in your browser's sync storage and used by the extension. (Status: Connected)`;
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    })
    .catch(error => {
      statusBadge.className = 'status-badge';
      statusBadge.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 5v14M5 12h14M12 12v6M12 12L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Connection failed
      `;
      if (formText) {
        formText.textContent = `The API URL used to analyze GitHub pull requests. This is stored in your browser's sync storage and used by the extension. (Status: Connection failed - ${error.message})`;
      }
    });
  }

  // Save API URL to storage
  apiUrlForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const apiUrl = apiUrlInput.value.trim();
    if (!apiUrl) return;

    // Basic URL validation
    try {
      new URL(apiUrl);
    } catch (err) {
      apiUrlInput.setCustomValidity('Please enter a valid URL (including http:// or https://)');
      apiUrlInput.reportValidity();
      return;
    }
    apiUrlInput.setCustomValidity('');

    // Save to storage
    chrome.storage.sync.set({ apiUrl }, () => {
      // Show saved feedback
      const originalText = apiUrlForm.querySelector('button').innerHTML;
      apiUrlForm.querySelector('button').innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 12l5 5 10-10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Saved!
      `;
      setTimeout(() => {
        apiUrlForm.querySelector('button').innerHTML = originalText;
      }, 1500);

      // Test connection to the new URL
      testConnection(apiUrl);

      // Notify content scripts to refresh if needed
      chrome.runtime.sendMessage({ type: "API_URL_UPDATED", apiUrl });
    });
  });

  // Initialize
  loadApiUrl();

  // Listen for API URL changes from other tabs/windows
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.apiUrl) {
      apiUrlInput.value = changes.apiUrl.newValue;
      testConnection(changes.apiUrl.newValue);
    }
  });
});