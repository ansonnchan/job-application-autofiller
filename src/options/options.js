const form = document.getElementById("settings-form");
const providerSelect = document.getElementById("provider");
const modelInput = document.getElementById("model");
const endpointInput = document.getElementById("endpoint");
const saveStatus = document.getElementById("save-status");
const testStatus = document.getElementById("test-status");
const testButton = document.getElementById("test-ai");
const phoneCountry = document.getElementById("phone-country");
const locationCountry = document.getElementById("location-country");
const regionOptions = document.getElementById("region-options");
const profileHelpers = globalThis.KoalifiedProfile;

const PROVIDER_DEFAULTS = {
  gemini: {
    model: "gemini-3.8-flash",
    endpoint: "https://api.groq.com/openai/v1/chat/completions"
  },
  "openai-compatible": {
    model: "openai/gpt-oss-20b",
    endpoint: "https://api.groq.com/openai/v1/chat/completions"
  }
};

initialize();

async function initialize() {
  const stored = await chrome.storage.local.get(["profile", "ai"]);
  populateCountrySelects();
  const profile = profileHelpers.migrateProfile(stored.profile || {});
  setFormValues({ ...profile, ai: stored.ai || {} });
  updateRegionOptions();
  updateProviderFields(false);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings();
  showStatus(saveStatus, "Profile saved locally.", "success");
});

providerSelect.addEventListener("change", () => updateProviderFields(true));
locationCountry.addEventListener("change", updateRegionOptions);

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  showStatus(testStatus, "Saving and contacting provider…", "");
  try {
    await saveSettings();
    await ensureEndpointPermission();
    const response = await chrome.runtime.sendMessage({ type: "KOALIFIED_TEST_AI" });
    if (!response?.ok) throw new Error(response?.error || "Provider test failed.");
    showStatus(testStatus, `Connected successfully: ${response.answer}`, "success");
  } catch (error) {
    showStatus(testStatus, error.message, "error");
  } finally {
    testButton.disabled = false;
  }
});

async function ensureEndpointPermission() {
  if (providerSelect.value !== "openai-compatible") return;
  let origin;
  try {
    origin = `${new URL(endpointInput.value).origin}/*`;
  } catch {
    throw new Error("Enter a valid HTTPS provider endpoint.");
  }
  if (!origin.startsWith("https://")) {
    throw new Error("The provider endpoint must use HTTPS.");
  }
  const permission = { origins: [origin] };
  // Custom providers receive access only to their own origin after a user gesture.
  if (await chrome.permissions.contains(permission)) return;
  const granted = await chrome.permissions.request(permission);
  if (!granted) throw new Error("Provider access was not granted.");
}

function updateProviderFields(resetDefaults) {
  const provider = providerSelect.value;
  const compatible = provider === "openai-compatible";
  document.querySelectorAll(".compatible-only").forEach((element) => {
    element.hidden = !compatible;
  });
  if (resetDefaults) {
    modelInput.value = PROVIDER_DEFAULTS[provider].model;
    endpointInput.value = PROVIDER_DEFAULTS[provider].endpoint;
  }
}

async function saveSettings() {
  const data = getFormValues();
  const selectedPhoneCountry = profileHelpers.getCountry(data.profile.personal.phoneCountry);
  data.profile.personal.phoneCountryCode = selectedPhoneCountry?.dialCode || "";
  data.profile.personal.phone = profileHelpers.combinePhone(
    data.profile.personal.phoneCountryCode,
    data.profile.personal.phoneNumber
  );
  await chrome.storage.local.set({ profile: data.profile, ai: data.ai });
}

function populateCountrySelects() {
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

function updateRegionOptions() {
  const regions = profileHelpers.getCountry(locationCountry.value)?.regions || [];
  regionOptions.replaceChildren(...regions.map((region) => {
    const option = document.createElement("option");
    option.value = region;
    return option;
  }));
}

function getFormValues() {
  const values = {
    profile: { personal: {}, address: {}, links: {}, education: {} },
    ai: {}
  };
  for (const element of form.elements) {
    if (!element.name) continue;
    let value = element.value.trim();
    if (element.name === "education.degreeAliases") {
      value = value.split(",").map((item) => item.trim()).filter(Boolean);
    }
    const root = element.name.startsWith("ai.") ? values.ai : values.profile;
    const path = element.name.startsWith("ai.")
      ? element.name.slice(3).split(".")
      : element.name.split(".");
    setAtPath(root, path, value);
  }
  return values;
}

function setFormValues(values) {
  for (const element of form.elements) {
    if (!element.name) continue;
    const value = getAtPath(values, element.name.split("."));
    element.value = Array.isArray(value) ? value.join(", ") : value ?? "";
  }
}

function setAtPath(target, path, value) {
  let current = target;
  path.forEach((part, index) => {
    if (index === path.length - 1) current[part] = value;
    else current = current[part] ||= {};
  });
}

function getAtPath(target, path) {
  return path.reduce((current, part) => current?.[part], target);
}

function showStatus(element, text, className) {
  element.textContent = text;
  element.className = className;
}
