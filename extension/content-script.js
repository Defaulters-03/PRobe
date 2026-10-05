// Content script for PRobe extension
// Injects PRobe analysis panel into GitHub PR pages

(function() {
  'use strict';

  // Create a unique ID for our container to avoid conflicts
  const CONTAINER_ID = 'pr0be-extension-container';

  // Check if we're already injected
  if (document.getElementById(CONTAINER_ID)) {
    return;
  }

  // Create container element
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.style.cssText = `
    position: fixed;
    top: 0;
    right: -400px; /* Start hidden */
    width: 380px;
    max-height: 90vh;
    background-color: #0a0a0b;
    color: #e6e6e6;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: right 0.3s ease-out;
    overflow-y: auto;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
  `;

  // Create header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background-color: #11141a;
  `;

  const title = document.createElement('div');
  title.textContent = 'PRobe Analysis';
  title.style.cssText = `
    font-weight: 600;
    font-size: 16px;
    color: #e6e6e6;
  `;

  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  closeButton.style.cssText = `
    background: transparent;
    border: none;
    font-size: 24px;
    color: #8b95a5;
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  `;
  closeButton.onmouseover = () => { closeButton.style.color = '#ffffff'; };
  closeButton.onmouseout = () => { closeButton.style.color = '#8b95a5'; };
  closeButton.onclick = () => { hidePanel(); };

  header.appendChild(title);
  header.appendChild(closeButton);
  container.appendChild(header);

  // Create loading indicator
  const loading = document.createElement('div');
  loading.id = 'pr0be-loading';
  loading.style.cssText = `
    padding: 24px;
    text-align: center;
    color: #8b95a5;
    font-size: 14px;
  `;
  loading.innerHTML = `
    <div style="margin-bottom: 12px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="#8b95a5" stroke-width="2" opacity="0.25"/>
        <path d="M12 2v2M12 20v2M6.34 6.34l1.42 1.42M18.24 18.24l1.42 1.42M2 12h2M22 12h2M6.34 17.66l1.42-1.42M18.24 5.76l1.42-1.42" stroke="#8b95a5" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    Analyzing pull requests...
  `;
  container.appendChild(loading);

  // Create error message container
  const errorContainer = document.createElement('div');
  errorContainer.id = 'pr0be-error';
  errorContainer.style.cssText = `
    display: none;
    padding: 16px;
    background-color: #2d1b1b;
    border: 1px solid #ff5a4f;
    color: #ff5a4f;
    font-size: 14px;
    margin: 0 16px 16px 16px;
    border-radius: 4px;
  `;
  container.appendChild(errorContainer);

  // Create results container
  const resultsContainer = document.createElement('div');
  resultsContainer.id = 'pr0be-results';
  resultsContainer.style.cssText = `
    padding: 16px;
    display: none;
  `;
  container.appendChild(resultsContainer);

  // Floating toggle tab when panel is closed
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'pr0be-toggle-btn';
  toggleBtn.innerHTML = `
    <span style="display: flex; align-items: center; gap: 6px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
        <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span>PRobe</span>
    </span>
  `;
  toggleBtn.style.cssText = `
    position: fixed;
    top: 120px;
    right: 0;
    z-index: 2147483646;
    background: #11141a;
    color: #c8f135;
    border: 1px solid rgba(200, 241, 53, 0.4);
    border-right: none;
    border-radius: 6px 0 0 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: -2px 0 8px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: background 0.15s, color 0.15s;
    display: none;
  `;
  toggleBtn.onmouseover = () => { toggleBtn.style.background = '#1a202c'; };
  toggleBtn.onmouseout = () => { toggleBtn.style.background = '#11141a'; };
  toggleBtn.onclick = () => { showPanel(); };
  document.body.appendChild(toggleBtn);

  // Append container to body
  document.body.appendChild(container);

  // Function to show the panel
  function showPanel() {
    container.style.right = '0';
    toggleBtn.style.display = 'none';

    // Auto-fetch repo from URL
    const repoMatch = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)\/pull/);
    if (repoMatch) {
      const repo = `${repoMatch[1]}/${repoMatch[2]}`;
      fetchAnalysis(repo);
    }
  }

  // Function to hide the panel
  function hidePanel() {
    container.style.right = '-400px';
    toggleBtn.style.display = 'block';
  }

  // Function to fetch analysis from background script
  function fetchAnalysis(repo) {
    // Show loading
    loading.style.display = 'block';
    errorContainer.style.display = 'none';
    resultsContainer.style.display = 'none';
    resultsContainer.innerHTML = '';

    // Get API URL from storage via background script
    chrome.runtime.sendMessage({ type: "GET_API_URL" }, (response) => {
      const apiUrl = (!chrome.runtime.lastError && response && response.apiUrl) || 'http://localhost:4000';

      // Call the PRobe API
      fetch(`${apiUrl}/api/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repo: repo,
          limit: 10,
          page: 1
        })
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        // Hide loading
        loading.style.display = 'none';

        // Show results
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = generateResultsHTML(data);
      })
      .catch(error => {
        // Hide loading
        loading.style.display = 'none';

        // Show error
        errorContainer.textContent = `Error: ${error.message}`;
        errorContainer.style.display = 'block';
      });
    });
  }

  // Function to generate results HTML from API response
  function generateResultsHTML(data) {
    if (!data || !data.results || data.results.length === 0) {
      return `
        <div style="text-align: center; padding: 24px; color: #8b95a5;">
          <div style="margin-bottom: 16px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="#2dd4bf" stroke-width="1.5"/>
              <path d="M9 12l3 3 4-4" stroke="#2dd4bf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          No pull requests found to analyze.
        </div>
      `;
    }

    // Stats
    const spamCount = data.results.filter(r => r.verdict && r.verdict.label === 'spam').length;
    const lowEffortCount = data.results.filter(r => r.verdict && r.verdict.label === 'low_effort').length;
    const legitCount = data.results.filter(r => r.verdict && r.verdict.label === 'legit').length;
    const totalAnalyzed = data.results.length;

    return `
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #6b7280;">
          <div>Analyzed: ${totalAnalyzed}</div>
          <div>Spam: <span style="color: #ff5a4f;">${spamCount}</span></div>
          <div>Low Effort: <span style="color: #ffb224;">${lowEffortCount}</span></div>
          <div>Legit: <span style="color: #2dd4bf;">${legitCount}</span></div>
        </div>
        <div style="height: 4px; background-color: #1a2027; border-radius: 2px; overflow: hidden;">
          <div style="height: 100%; width: ${(legitCount / totalAnalyzed * 100) || 0}%; background-color: #2dd4bf;"></div>
          <div style="height: 100%; width: ${(lowEffortCount / totalAnalyzed * 100) || 0}%; background-color: #ffb224;"></div>
          <div style="height: 100%; width: ${(spamCount / totalAnalyzed * 100) || 0}%; background-color: #ff5a4f;"></div>
        </div>
      </div>

      <div style="max-height: 60vh; overflow-y: auto;">
        ${data.results.map((result, index) => generatePRItemHTML(result, index)).join('')}
      </div>
    `;
  }

  // Function to generate HTML for a single PR item
  function generatePRItemHTML(result, index) {
    const { pr, verdict, error } = result;

    // Status color
    let statusColor = '#8b95a5';
    let statusText = 'Unanalyzed';
    if (verdict) {
      if (verdict.label === 'spam') {
        statusColor = '#ff5a4f';
        statusText = 'Spam';
      } else if (verdict.label === 'low_effort') {
        statusColor = '#ffb224';
        statusText = 'Low effort';
      } else if (verdict.label === 'legit') {
        statusColor = '#2dd4bf';
        statusText = 'Legit';
      }
    }

    // Days old calculation
    const daysOld = pr.authorCreatedAt
      ? `${Math.max(0, Math.floor((Date.now() - new Date(pr.authorCreatedAt).getTime()) / (1000 * 60 * 60 * 24)))}d old`
      : 'new author';

    // Score bar width
    const scoreWidth = verdict && typeof verdict.spam_score === 'number'
      ? Math.min(100, Math.max(0, verdict.spam_score))
      : 0;

    // Score bar color
    let scoreColor = '#6b7280';
    if (verdict) {
      if (verdict.label === 'spam') {
        scoreColor = '#ff5a4f';
      } else if (verdict.label === 'low_effort') {
        scoreColor = '#ffb224';
      } else if (verdict.label === 'legit') {
        scoreColor = '#2dd4bf';
      }
    }

    return `
      <div style="border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; margin-bottom: 12px; overflow: hidden; background-color: #11141a;">
        <div style="display: flex; padding: 12px;">
          <!-- PR Number -->
          <div style="flex: 0 0 40px; font-family: monospace; font-size: 12px; color: #6b7280; display: flex; align-items: center; justify-content: center;">
            #${pr.number}
          </div>

          <!-- PR Info -->
          <div style="flex: 1; min-width: 0; padding-right: 12px;">
            <a href="${pr.url}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: #e6e6e6; font-weight: 500; display: block; margin-bottom: 4px;">
              ${pr.title.length > 50 ? pr.title.substring(0, 47) + '...' : pr.title}
            </a>
            <div style="display: flex; font-size: 11px; color: #8b95a5; flex-wrap: wrap; gap: 8px;">
              <span>@${pr.author}</span>
              <span>${daysOld}</span>
              <span>${pr.changedFiles} file${pr.changedFiles !== 1 ? 's' : ''}</span>
              <span>+${pr.additions}/−${pr.deletions}</span>
            </div>
          </div>

          <!-- Status -->
          <div style="flex: 0 0 80px; text-align: center;">
            <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${statusColor}; margin: 0 auto 4px;"></div>
            <div style="font-size: 11px; font-weight: 500; color: ${statusColor}; text-transform: uppercase; letter-spacing: 0.5px;">
              ${statusText}
            </div>
          </div>

          <!-- Score Bar -->
          <div style="flex: 0 0 120px; display: flex; flex-direction: column;">
            <div style="height: 4px; background-color: #1a2027; border-radius: 2px; overflow: hidden; margin-bottom: 4px;">
              <div style="height: 100%; width: ${scoreWidth}%; background-color: ${scoreColor}; transition: width 0.3s ease;"></div>
            </div>
            <div style="font-family: monospace; font-size: 10px; text-align: right; color: #e6e6e6;">
              ${verdict && typeof verdict.spam_score === 'number' ? verdict.spam_score : '—'}
            </div>
          </div>
        </div>

        <!-- Reasons (if available) -->
        ${verdict && verdict.reasons && verdict.reasons.length > 0 ? `
        <div style="padding: 0 12px 12px 12px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
          <div style="font-size: 10px; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; font-family: monospace;">
            Reasons flagged
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${verdict.reasons.map(reason => `
              <span style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); color: #e6e6e6; font-size: 10px; padding: 2px 6px; border-radius: 3px; font-family: monospace;">
                ${reason}
              </span>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    `;
  }

  // Auto-show panel when on a PR page
  const repoMatch = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)\/pull/);
  if (repoMatch) {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showPanel);
    } else {
      showPanel();
    }
  }

  // Also show panel when navigating via pjax (GitHub's SPA navigation)
  if (window.history && window.history.pushState) {
    const originalPushState = history.pushState;
    history.pushState = function(state) {
      if (typeof history.onpushstate === "function") {
        history.onpushstate({state: state});
      }
      return originalPushState.apply(this, arguments);
    };

    window.addEventListener('popstate', history.onpushstate);
    window.addEventListener('pushstate', history.onpushstate);

    history.onpushstate = function(state) {
      // Check if we're now on a PR page
      const repoMatch = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)\/pull/);
      if (repoMatch) {
        if (!document.getElementById(CONTAINER_ID)) {
          // Re-inject if needed
          const existing = document.getElementById(CONTAINER_ID);
          if (existing) existing.remove();

          // Re-create and show
          const container = document.createElement('div');
          container.id = CONTAINER_ID;
          container.style.cssText = `
            position: fixed;
            top: 0;
            right: -400px;
            width: 380px;
            max-height: 90vh;
            background-color: #0a0a0b;
            color: #e6e6e6;
            box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            transition: right 0.3s ease-out;
            overflow-y: auto;
            border-left: 1px solid rgba(255, 255, 255, 0.1);
          `;

          // Recreate all elements (simplified version)
          const header = document.createElement('div');
          header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            background-color: #11141a;
          `;

          const title = document.createElement('div');
          title.textContent = 'PRobe Analysis';
          title.style.cssText = `
            font-weight: 600;
            font-size: 16px;
            color: #e6e6e6;
          `;

          const closeButton = document.createElement('button');
          closeButton.textContent = '×';
          closeButton.style.cssText = `
            background: transparent;
            border: none;
            font-size: 24px;
            color: #8b95a5;
            cursor: pointer;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
          `;
          closeButton.onmouseover = () => { closeButton.style.color = '#ffffff'; };
          closeButton.onmouseout = () => { closeButton.style.color = '#8b95a5'; };
          closeButton.onclick = () => { hidePanel(); };

          header.appendChild(title);
          header.appendChild(closeButton);
          container.appendChild(header);

          const loading = document.createElement('div');
          loading.id = 'pr0be-loading';
          loading.style.cssText = `
            padding: 24px;
            text-align: center;
            color: #8b95a5;
            font-size: 14px;
          `;
          loading.innerHTML = `
            <div style="margin-bottom: 12px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="#8b95a5" stroke-width="2" opacity="0.25"/>
                <path d="M12 2v2M12 20v2M6.34 6.34l1.42 1.42M18.24 18.24l1.42 1.42M2 12h2M22 12h2M6.34 17.66l1.42-1.42M18.24 5.76l1.42-1.42" stroke="#8b95a5" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </div>
            Analyzing pull requests...
          `;
          container.appendChild(loading);

          const errorContainer = document.createElement('div');
          errorContainer.id = 'pr0be-error';
          errorContainer.style.cssText = `
            display: none;
            padding: 16px;
            background-color: #2d1b1b;
            border: 1px solid #ff5a4f;
            color: #ff5a4f;
            font-size: 14px;
            margin: 0 16px 16px 16px;
            border-radius: 4px;
          `;
          container.appendChild(errorContainer);

          const resultsContainer = document.createElement('div');
          resultsContainer.id = 'pr0be-results';
          resultsContainer.style.cssText = `
            padding: 16px;
            display: none;
          `;
          container.appendChild(resultsContainer);

          document.body.appendChild(container);

          // Show panel and fetch analysis
          showPanel();
          const repo = `${repoMatch[1]}/${repoMatch[2]}`;
          fetchAnalysis(repo);
        }
      }
    };
  }

  // Listen for messages from background (for API URL changes, etc.)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "REFRESH_ANALYSIS") {
      const repoMatch = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)\/pull/);
      if (repoMatch) {
        const repo = `${repoMatch[1]}/${repoMatch[2]}`;
        fetchAnalysis(repo);
      }
    }
  });
})();