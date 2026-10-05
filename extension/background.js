// Background service worker for PRobe extension
// Handles messaging between content script and popup/options

chrome.runtime.onInstalled.addListener(() => {
  console.log("PRobe extension installed");

  // Set default API URL if not already set
  chrome.storage.sync.get(["apiUrl"], (result) => {
    if (!result.apiUrl) {
      chrome.storage.sync.set({ apiUrl: "http://localhost:4000" }, () => {
        console.log("Default API URL set to http://localhost:4000");
      });
    }
  });
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_API_URL") {
    chrome.storage.sync.get(["apiUrl"], (result) => {
      sendResponse({ apiUrl: result.apiUrl || "http://localhost:4000" });
    });
    return true; // Keep message channel open for async response
  }

  if (request.type === "SET_API_URL") {
    chrome.storage.sync.set({ apiUrl: request.apiUrl }, () => {
      sendResponse({ success: true });
    });
    return true; // Keep message channel open for async response
  }

  return false;
});