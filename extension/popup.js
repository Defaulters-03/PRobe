document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const prList = document.getElementById('prList');
  const errorMessage = document.getElementById('errorMessage');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const spamCount = document.getElementById('spamCount');
  const lowEffortCount = document.getElementById('lowEffortCount');
  const legitCount = document.getElementById('legitCount');

  // Status elements
  function setStatus(text, isConnected = true) {
    statusText.textContent = text;
    if (isConnected) {
      statusDot.className = 'status-dot';
      statusDot.style.backgroundColor = 'var(--success)';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusDot.style.backgroundColor = 'var(--danger)';
    }
  }

  // Show error
  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
  }

  // Hide error
  function hideError() {
    errorMessage.style.display = 'none';
  }

  // Load API URL from storage
  function getApiUrlFromStorage() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['apiUrl'], (result) => {
        resolve(result.apiUrl || 'http://localhost:4000');
      });
    });
  }

  // Test connection to API
  async function testApiConnection(apiUrl) {
    try {
      const response = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        timeout: 3000
      });
      return response.ok;
    } catch (err) {
      return false;
    }
  }

  // Fetch current PR analysis
  async function fetchCurrentPrAnalysis() {
    hideError();
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.25"/>
        <path d="M12 2v2M12 20v2M6.34 6.34l1.42 1.42M18.24 18.24l1.42 1.42M2 12h2M22 12h2M6.34 17.66l1.42-1.42M18.24 5.76l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Analyzing...
    `;

    try {
      const apiUrl = await getApiUrlFromStorage();

      // Test connection first
      const isConnected = await testApiConnection(apiUrl);
      if (!isConnected) {
        throw new Error('Could not connect to API');
      }

      setStatus('Connected', true);

      // Get active tab (check currentWindow first, then lastFocusedWindow)
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      }

      if (!tab || !tab.url) {
        throw new Error('Unable to read active tab URL. Make sure a web page is open.');
      }

      let currentUrl;
      try {
        currentUrl = new URL(tab.url);
      } catch {
        throw new Error(`Invalid page URL: ${tab.url}`);
      }

      if (!currentUrl.hostname.includes('github.com')) {
        const displayHost = currentUrl.hostname || currentUrl.protocol || 'current page';
        throw new Error(`Currently on ${displayHost}. Please navigate to a GitHub PR page (e.g. github.com/expressjs/express/pull/5800) and click Analyze.`);
      }

      const pathParts = currentUrl.pathname.split('/').filter(part => part.length > 0);
      const reserved = new Set(['settings', 'notifications', 'explore', 'marketplace', 'organizations', 'orgs', 'topics', 'trending', 'features', 'login', 'signup', 'pricing']);

      if (pathParts.length >= 2 && !reserved.has(pathParts[0].toLowerCase())) {
        const owner = pathParts[0];
        const repo = pathParts[1];
        const repoFull = `${owner}/${repo}`;

        // Call the API
        const response = await fetch(`${apiUrl}/api/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repo: repoFull,
            limit: 10,
            page: 1
          })
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();

        // Update UI with results
        updateStats(data.results);
        updatePrList(data.results, repoFull);

      } else {
        throw new Error('Please open a GitHub repository or pull request page (e.g. github.com/expressjs/express/pull/5800)');
      }
    } catch (err) {
      console.error('Error analyzing PR:', err);
      setStatus('Disconnected', false);
      showError(err.message || 'An unknown error occurred');
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
          <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Analyze Current PR
      `;
    }
  }

  // Update stats display
  function updateStats(results) {
    const spam = results.filter(r => r.verdict && r.verdict.label === 'spam').length;
    const lowEffort = results.filter(r => r.verdict && r.verdict.label === 'low_effort').length;
    const legit = results.filter(r => r.verdict && r.verdict.label === 'legit').length;

    spamCount.textContent = spam;
    lowEffortCount.textContent = lowEffort;
    legitCount.textContent = legit;
  }

  // Update PR list display
  function updatePrList(results, repo) {
    prList.innerHTML = '';

    if (results.length === 0) {
      prList.innerHTML = '<div style="text-align: center; color: var(--muted); padding: 16px;">No pull requests found</div>';
      return;
    }

    results.forEach(result => {
      const { pr, verdict, error } = result;

      const prItem = document.createElement('div');
      prItem.className = 'pr-item';

      // Status color
      let statusColor = 'var(--muted)';
      let statusText = 'Unanalyzed';
      if (verdict) {
        if (verdict.label === 'spam') {
          statusColor = 'var(--danger)';
          statusText = 'Spam';
        } else if (verdict.label === 'low_effort') {
          statusColor = 'var(--warning)';
          statusText = 'Low effort';
        } else if (verdict.label === 'legit') {
          statusColor = 'var(--success)';
          statusText = 'Legit';
        }
      }

      prItem.innerHTML = `
        <div class="pr-item-title" title="${pr.title}">${pr.title}</div>
        <div class="pr-item-meta">
          #${pr.number} by @${pr.author} •
          <span style="color: ${statusColor}; font-weight: 500;">${statusText}</span>
        </div>
      `;

      prItem.addEventListener('click', () => {
        window.open(pr.url, '_blank');
      });

      prList.appendChild(prItem);
    });
  }

  // Initialize
  async function initialize() {
    setStatus('Checking connection...', false);

    try {
      const apiUrl = await getApiUrlFromStorage();
      const isConnected = await testApiConnection(apiUrl);

      if (isConnected) {
        setStatus('Connected', true);
        await fetchCurrentPrAnalysis();
      } else {
        setStatus('Disconnected', false);
      }
    } catch (err) {
      setStatus('Disconnected', false);
      showError('Failed to load settings');
    }
  }

  // Event listeners
  analyzeBtn.addEventListener('click', fetchCurrentPrAnalysis);

  // Initialize on load
  initialize();

  // Listen for API URL changes from options page
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.apiUrl) {
      // Auto-refresh if API URL changed
      fetchCurrentPrAnalysis();
    }
  });
});