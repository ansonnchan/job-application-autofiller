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
const resumeFileInput = document.getElementById("resume-file");
const resumeFileName = document.getElementById("resume-file-name");
const resumeFileMeta = document.getElementById("resume-file-meta");
const resumeReview = document.getElementById("resume-import-review");
const resumeReviewSummary = document.getElementById("resume-review-summary");
const resumeFacts = document.getElementById("resume-facts");
const resumeText = document.getElementById("resume-text");
const resumeReviewActions = document.getElementById("resume-review-actions");
const resumeImportStatus = document.getElementById("resume-import-status");
const applyResumeImportButton = document.getElementById("apply-resume-import");
const cancelResumeImportButton = document.getElementById("cancel-resume-import");
const removeResumeButton = document.getElementById("remove-resume");
const profileHelpers = globalThis.KoalifiedProfile;
const resumeHelpers = globalThis.KoalifiedResume;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

let pendingResumeImport = null;
let pdfModulePromise = null;

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
  const stored = await chrome.storage.local.get(["profile", "ai", "resumeDocument"]);
  populateCountrySelects();
  const profile = profileHelpers.migrateProfile(stored.profile || {});
  setFormValues({ ...profile, ai: stored.ai || {} });
  renderStoredResume(stored.resumeDocument || null);
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
resumeFileInput.addEventListener("change", handleResumeSelection);
applyResumeImportButton.addEventListener("click", applyResumeImport);
cancelResumeImportButton.addEventListener("click", cancelResumeImport);
removeResumeButton.addEventListener("click", removeStoredResume);

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

async function handleResumeSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  resumeReview.hidden = true;
  resumeReviewActions.hidden = true;
  pendingResumeImport = null;

  try {
    validateResumeFile(file);
    showStatus(resumeImportStatus, "Extracting text locally…", "");
    const extraction = await extractPdfText(file);
    const text = resumeHelpers.cleanExtractedText(extraction.text);
    if (text.length < 80) {
      throw new Error("This PDF has too little selectable text. It may be image-only or scanned.");
    }

    pendingResumeImport = {
      document: {
        name: file.name,
        type: "application/pdf",
        size: file.size,
        dataUrl: await fileToDataUrl(file),
        importedAt: new Date().toISOString()
      },
      facts: resumeHelpers.inferContactFacts(text),
      pages: extraction.pages,
      text
    };
    renderResumeReview(pendingResumeImport);
    showStatus(resumeImportStatus, "Review the extracted text and selected details before applying.", "success");
  } catch (error) {
    resumeFileInput.value = "";
    showStatus(resumeImportStatus, error.message, "error");
  }
}

function validateResumeFile(file) {
  const pdfType = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!pdfType) throw new Error("Choose a PDF résumé.");
  if (file.size > MAX_RESUME_BYTES) throw new Error("Choose a PDF smaller than 5 MB.");
}

async function extractPdfText(file) {
  const pdfjs = await loadPdfModule();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pageText = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageText.push(textItemsToLines(content.items));
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return { pages: pdf.numPages, text: pageText.join("\n\n") };
}

function loadPdfModule() {
  if (!pdfModulePromise) {
    pdfModulePromise = import(chrome.runtime.getURL("vendor/pdfjs/pdf.mjs"))
      .then((pdfjs) => {
        // The API and worker must ship together; both resolve from the installed extension.
        pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
          "vendor/pdfjs/pdf.worker.mjs"
        );
        return pdfjs;
      });
  }
  return pdfModulePromise;
}

function textItemsToLines(items) {
  const lines = [];
  let line = "";
  for (const item of items || []) {
    const value = String(item.str || "").trim();
    if (value) line += `${line ? " " : ""}${value}`;
    if (item.hasEOL && line) {
      lines.push(line);
      line = "";
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function renderResumeReview(resumeImport) {
  const currentProfile = getFormValues().profile;
  resumeFacts.replaceChildren();
  for (const [index, item] of resumeImport.facts.entries()) {
    const row = document.createElement("label");
    row.className = "resume-fact";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.factIndex = String(index);
    checkbox.checked = !getAtPath(currentProfile, item.path.split("."));
    const copy = document.createElement("span");
    copy.className = "resume-fact-copy";
    const label = document.createElement("strong");
    label.textContent = item.label;
    const value = document.createElement("span");
    value.textContent = item.value;
    const reason = document.createElement("small");
    reason.textContent = checkbox.checked ? item.reason : "Existing profile value kept by default";
    copy.append(label, value, reason);
    row.append(checkbox, copy);
    resumeFacts.append(row);
  }
  if (!resumeImport.facts.length) {
    const empty = document.createElement("p");
    empty.className = "privacy-note";
    empty.textContent = "No contact details were confidently detected; you can still import the résumé text.";
    resumeFacts.append(empty);
  }
  resumeText.value = resumeImport.text;
  resumeReviewSummary.textContent = `${resumeImport.pages} page${resumeImport.pages === 1 ? "" : "s"} · ${resumeImport.facts.length} contact detail${resumeImport.facts.length === 1 ? "" : "s"} detected`;
  resumeReview.hidden = false;
  resumeReviewActions.hidden = false;
}

async function applyResumeImport() {
  if (!pendingResumeImport) return;
  const values = getFormValues();
  for (const checkbox of resumeFacts.querySelectorAll("input[type='checkbox']:checked")) {
    const item = pendingResumeImport.facts[Number(checkbox.dataset.factIndex)];
    if (!item) continue;
    if (item.path === "personal.phone") {
      applyImportedPhone(values.profile, item.value);
    } else {
      setAtPath(values.profile, item.path.split("."), item.value);
    }
  }
  values.profile.resumeText = resumeText.value.trim();
  const migratedProfile = profileHelpers.migrateProfile(values.profile);
  setFormValues({ ...migratedProfile, ai: values.ai });

  await chrome.storage.local.set({ resumeDocument: pendingResumeImport.document });
  await saveSettings();
  renderStoredResume(pendingResumeImport.document);
  cancelResumeImport();
  showStatus(resumeImportStatus, "Résumé PDF and reviewed profile details saved locally.", "success");
}

function cancelResumeImport() {
  pendingResumeImport = null;
  resumeReview.hidden = true;
  resumeReviewActions.hidden = true;
  resumeFacts.replaceChildren();
  resumeFileInput.value = "";
}

async function removeStoredResume() {
  if (!window.confirm("Remove the stored résumé PDF? Extracted profile text will stay until you edit or clear it.")) {
    return;
  }
  await chrome.storage.local.remove("resumeDocument");
  renderStoredResume(null);
  showStatus(resumeImportStatus, "Stored PDF removed. Extracted text was kept.", "success");
}

function renderStoredResume(documentRecord) {
  const stored = Boolean(documentRecord?.dataUrl);
  resumeFileName.textContent = stored ? documentRecord.name : "No PDF stored";
  resumeFileMeta.textContent = stored
    ? `${formatBytes(documentRecord.size)} · saved ${new Date(documentRecord.importedAt).toLocaleDateString()}`
    : "PDF only · 5 MB maximum";
  removeResumeButton.hidden = !stored;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(new Error("The PDF could not be read.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function applyImportedPhone(profile, phone) {
  const normalized = String(phone || "").trim();
  const configuredCountry = profileHelpers.getCountry(profile.personal.phoneCountry);
  const country = normalized.startsWith(configuredCountry?.dialCode || "__missing__")
    ? configuredCountry
    : [...profileHelpers.COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((item) => normalized.startsWith(item.dialCode));
  if (country) {
    profile.personal.phoneCountry = country.name;
    profile.personal.phoneCountryCode = country.dialCode;
    profile.personal.phoneNumber = normalized.slice(country.dialCode.length).trim();
  } else {
    profile.personal.phoneNumber = normalized;
  }
}

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
