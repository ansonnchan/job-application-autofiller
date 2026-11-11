const reviewButton = document.getElementById("review-page");
const settingsButtons = [
  document.getElementById("open-settings"),
  document.getElementById("edit-profile"),
  document.getElementById("profile-tab")
];
const readyStatus = document.getElementById("ready-status");
const profileSummary = document.getElementById("profile-summary");
const pageTitle = document.getElementById("page-title");
const pageHost = document.getElementById("page-host");
const resumeStatus = document.getElementById("resume-status");
const aiStatus = document.getElementById("ai-status");
const message = document.getElementById("message");

let activeTab = null;
let profile = {};

initialize();

async function initialize() {
  if (!hasExtensionApis()) {
    renderPreviewState();
    console.warn("koalified popup is running outside a Chrome extension context.");
    return;
  }

  try {
    const stored = await chrome.storage.local.get(["profile", "ai"]);
    profile = stored.profile || {};
    renderProfile(profile, stored.ai || {});
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || !/^https?:/i.test(activeTab.url || "")) {
      renderNoApplication("Open a job application to get started.");
      return;
    }

    const url = new URL(activeTab.url);
    pageTitle.textContent = activeTab.title || "Job application";
    pageHost.textContent = url.hostname.replace(/^www\./, "");
    await injectPageScripts();
    const result = await chrome.tabs.sendMessage(activeTab.id, {
      type: "KOALIFIED_SCAN",
      profile
    });
    if (!result?.ok) throw new Error(result?.error || "Could not scan this page.");
    readyStatus.textContent = result.count
      ? `${result.count} field${result.count === 1 ? "" : "s"} ready for review`
      : "Nothing to review just yet.";
    reviewButton.disabled = result.count === 0;
  } catch (error) {
    console.error("koalified popup initialization failed", error);
    showFriendlyError("This page could not be checked. Try refreshing it once.");
  }
}

settingsButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (hasExtensionApis()) chrome.runtime.openOptionsPage();
  });
});

reviewButton.addEventListener("click", async () => {
  if (!activeTab?.id) return;
  const label = reviewButton.querySelector("span");
  const original = label.textContent;
  reviewButton.disabled = true;
  label.textContent = "Preparing review…";
  message.textContent = "";
  try {
    await injectPageScripts();
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "KOALIFIED_ANALYZE",
      profile
    });
    if (!response?.ok) throw new Error(response?.error || "Review could not be opened.");
    window.close();
  } catch (error) {
    console.error("koalified could not open the review panel", error);
    showFriendlyError("The review could not be opened. Refresh the page and try again.");
    reviewButton.disabled = false;
    label.textContent = original;
  }
});

async function injectPageScripts() {
  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    files: ["src/core/matcher.js", "src/content.js"]
  });
}

function renderProfile(currentProfile, ai) {
  const required = [
    currentProfile?.personal?.firstName && currentProfile?.personal?.lastName,
    currentProfile?.personal?.email,
    currentProfile?.personal?.phone,
    currentProfile?.address?.city && currentProfile?.address?.postalCode,
    currentProfile?.education?.school,
    currentProfile?.education?.fieldOfStudy
  ];
  const missing = required.filter((value) => !value).length;
  profileSummary.textContent = missing ? `${missing} detail${missing === 1 ? "" : "s"} still missing` : "Ready to help";
  resumeStatus.textContent = currentProfile?.resumeText?.trim()
    ? "Résumé context ready"
    : "Résumé context not added";
  aiStatus.textContent = ai?.apiKey
    ? `${ai.provider === "gemini" ? "Gemini" : "Groq / compatible"} connected`
    : "AI is optional · not configured";
}

function renderNoApplication(text) {
  pageTitle.textContent = "No application detected";
  pageHost.textContent = text;
  readyStatus.textContent = "Nothing to review just yet.";
  reviewButton.disabled = true;
}

function renderPreviewState() {
  pageTitle.textContent = "Current application";
  pageHost.textContent = "Open a job application to get started.";
  readyStatus.textContent = "Nothing to review just yet.";
  profileSummary.textContent = "Set up your local profile";
  resumeStatus.textContent = "Résumé context not added";
  aiStatus.textContent = "AI is optional · not configured";
  reviewButton.disabled = true;
}

function showFriendlyError(text) {
  message.textContent = text;
  reviewButton.disabled = true;
}

function hasExtensionApis() {
  // Static previews get a friendly state instead of exposing Chrome API errors.
  return Boolean(
    globalThis.chrome?.storage?.local &&
    chrome.tabs?.query &&
    chrome.scripting?.executeScript &&
    chrome.runtime?.sendMessage
  );
}
