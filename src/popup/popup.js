const reviewButton = document.getElementById("review-page");
const settingsButton = document.getElementById("open-settings");
const advancedSettingsButton = document.getElementById("advanced-settings");
const editProfileButton = document.getElementById("edit-profile");
const autofillTab = document.getElementById("autofill-tab");
const profileTab = document.getElementById("profile-tab");
const autofillView = document.getElementById("autofill-view");
const profileView = document.getElementById("profile-view");
const profileForm = document.getElementById("profile-form");
const profileSaveStatus = document.getElementById("profile-save-status");
const phoneCountry = document.getElementById("popup-phone-country");
const locationCountry = document.getElementById("popup-location-country");
const regionOptions = document.getElementById("popup-region-options");
const readyStatus = document.getElementById("ready-status");
const profileSummary = document.getElementById("profile-summary");
const pageTitle = document.getElementById("page-title");
const pageHost = document.getElementById("page-host");
const resumeStatus = document.getElementById("resume-status");
const aiStatus = document.getElementById("ai-status");
const message = document.getElementById("message");
const profileHelpers = globalThis.KoalifiedProfile;

let activeTab = null;
let profile = {};
let aiConfig = {};

populateCountryControls();
initialize();

async function initialize() {
  if (!hasExtensionApis()) {
    renderPreviewState();
    console.warn("koalified popup is running outside a Chrome extension context.");
    return;
  }

  try {
    const stored = await chrome.storage.local.get(["profile", "ai"]);
    profile = profileHelpers.migrateProfile(stored.profile || {});
    aiConfig = stored.ai || {};
    populateProfileForm(profile);
    renderProfile(profile, aiConfig);
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
    const missing = (result.missingProfile || []).map(profileFieldLabel);
    readyStatus.textContent = result.count
      ? `${result.count} field${result.count === 1 ? "" : "s"} ready${missing.length ? ` · add ${missing.join(", ")} to fill more` : " for review"}`
      : missing.length
        ? `Recognized ${missing.join(", ")}, but it is missing from My profile.`
        : "Nothing to review just yet.";
    reviewButton.disabled = result.count === 0;
  } catch (error) {
    console.error("koalified popup initialization failed", error);
    showFriendlyError("This page could not be checked. Try refreshing it once.");
  }
}

settingsButton.addEventListener("click", openAdvancedSettings);
advancedSettingsButton.addEventListener("click", openAdvancedSettings);
autofillTab.addEventListener("click", () => showView("autofill"));
profileTab.addEventListener("click", () => showView("profile"));
editProfileButton.addEventListener("click", () => showView("profile"));
locationCountry.addEventListener("change", updateRegionOptions);

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profile = readProfileForm(profile);
  if (hasExtensionApis()) await chrome.storage.local.set({ profile });
  renderProfile(profile, aiConfig);
  profileSaveStatus.textContent = "Saved locally.";
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

function showView(view) {
  const showProfile = view === "profile";
  autofillView.hidden = showProfile;
  profileView.hidden = !showProfile;
  autofillTab.classList.toggle("active", !showProfile);
  profileTab.classList.toggle("active", showProfile);
  if (showProfile) populateProfileForm(profile);
}

function openAdvancedSettings() {
  if (hasExtensionApis()) chrome.runtime.openOptionsPage();
}

function populateCountryControls() {
  phoneCountry.replaceChildren(...profileHelpers.COUNTRIES.map((item) => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = `${item.name} (${item.dialCode})`;
    return option;
  }));
  locationCountry.replaceChildren(...profileHelpers.COUNTRIES.map((item) => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    return option;
  }));
}

function populateProfileForm(currentProfile) {
  for (const element of profileForm.elements) {
    if (!element.name) continue;
    element.value = getAtPath(currentProfile, element.name.split(".")) ?? "";
  }
  updateRegionOptions();
}

function readProfileForm(currentProfile) {
  const updated = {
    ...currentProfile,
    personal: { ...(currentProfile.personal || {}) },
    address: { ...(currentProfile.address || {}) },
    education: { ...(currentProfile.education || {}) },
    links: { ...(currentProfile.links || {}) }
  };
  for (const element of profileForm.elements) {
    if (!element.name) continue;
    setAtPath(updated, element.name.split("."), element.value.trim());
  }
  const selectedCountry = profileHelpers.getCountry(updated.personal.phoneCountry);
  updated.personal.phoneCountryCode = selectedCountry?.dialCode || "";
  updated.personal.phone = profileHelpers.combinePhone(
    updated.personal.phoneCountryCode,
    updated.personal.phoneNumber
  );
  return updated;
}

function updateRegionOptions() {
  const regions = profileHelpers.getCountry(locationCountry.value)?.regions || [];
  regionOptions.replaceChildren(...regions.map((region) => {
    const option = document.createElement("option");
    option.value = region;
    return option;
  }));
}

function getAtPath(target, path) {
  return path.reduce((current, part) => current?.[part], target);
}

function setAtPath(target, path, value) {
  let current = target;
  path.forEach((part, index) => {
    if (index === path.length - 1) current[part] = value;
    else current = current[part] ||= {};
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
  profile = profileHelpers.migrateProfile({});
  populateProfileForm(profile);
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

function profileFieldLabel(key) {
  const labels = {
    firstName: "first name",
    lastName: "last name",
    preferredName: "preferred name",
    email: "email",
    phone: "phone",
    addressLine1: "street address",
    addressLine2: "address line 2",
    city: "city",
    region: "province/state",
    postalCode: "postal/ZIP code",
    country: "country",
    linkedin: "LinkedIn",
    github: "GitHub",
    portfolio: "portfolio",
    school: "school",
    degree: "degree",
    fieldOfStudy: "field of study",
    educationStartDate: "education start date",
    graduationDate: "graduation date",
    gpa: "GPA"
  };
  return labels[key] || key;
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
