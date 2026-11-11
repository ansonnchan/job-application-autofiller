const DEFAULTS = {
  profile: {
    personal: {},
    address: {},
    links: {},
    education: { degreeAliases: [] },
    experienceContext: "",
    resumeText: ""
  },
  ai: {
    provider: "gemini",
    apiKey: "",
    model: "gemini-3.8-flash",
    endpoint: "https://api.groq.com/openai/v1/chat/completions"
  }
};

chrome.runtime.onInstalled.addListener(async () => {
  // Page content scripts never need direct access to profile data or API keys.
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const stored = await chrome.storage.local.get(["profile", "ai"]);
  await chrome.storage.local.set({
    profile: mergeDeep(DEFAULTS.profile, stored.profile || {}),
    ai: mergeDeep(DEFAULTS.ai, stored.ai || {})
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "KOALIFIED_DRAFT_ANSWER") {
    createDraft(message.payload)
      .then((answer) => sendResponse({ ok: true, answer }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "KOALIFIED_TEST_AI") {
    testProvider()
      .then((answer) => sendResponse({ ok: true, answer }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "autofill-page") return;
  try {
    await autofillActiveTab();
  } catch (error) {
    console.warn("koalified could not autofill the active tab:", error.message);
  }
});

async function autofillActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    throw new Error("Open a regular job application webpage first.");
  }
  const { profile } = await chrome.storage.local.get("profile");
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/core/matcher.js", "src/content.js"]
  });
  return chrome.tabs.sendMessage(tab.id, { type: "KOALIFIED_AUTOFILL", profile });
}

async function testProvider() {
  const { ai } = await chrome.storage.local.get("ai");
  validateAiConfig(ai);
  return callProvider(ai, [
    { role: "system", content: "Follow the user's formatting instruction exactly." },
    { role: "user", content: "Reply with exactly: Connected" }
  ]);
}

async function createDraft(payload = {}) {
  const question = String(payload.question || "").trim();
  if (!question) throw new Error("A question is required.");

  // Profile context leaves the browser only after an explicit draft request.
  const { profile, ai } = await chrome.storage.local.get(["profile", "ai"]);
  validateAiConfig(ai);

  const limit = Number.isFinite(Number(payload.characterLimit))
    ? Math.max(1, Math.min(Number(payload.characterLimit), 10000))
    : null;
  const context = {
    name: [profile?.personal?.firstName, profile?.personal?.lastName].filter(Boolean).join(" "),
    education: profile?.education || {},
    experience: profile?.experienceContext || "",
    resume: profile?.resumeText || "",
    jobDescription: String(payload.jobDescription || "").slice(0, 12000)
  };
  const limitInstruction = limit
    ? `The answer must be at most ${limit} characters, including spaces.`
    : "Keep the answer concise.";
  const messages = [
    {
      role: "system",
      content:
        "Draft a truthful job-application answer using only facts in the supplied candidate context. " +
        "Do not invent employers, dates, skills, achievements, credentials, or motivations. " +
        "If the context is insufficient, say what information is missing. Return only the draft answer."
    },
    {
      role: "user",
      content: `Question:\n${question}\n\nCandidate context:\n${JSON.stringify(context, null, 2)}\n\n${limitInstruction}`
    }
  ];

  const answer = await callProvider(ai, messages);
  return limit ? trimToLimit(answer, limit) : answer.trim();
}

async function callProvider(ai, messages) {
  if (ai.provider === "gemini") return callGemini(ai, messages);
  if (ai.provider === "openai-compatible") return callOpenAiCompatible(ai, messages);
  throw new Error("Unsupported AI provider.");
}

async function callGemini(ai, messages) {
  const model = encodeURIComponent(ai.model);
  const systemMessage = messages.find((message) => message.role === "system")?.content || "";
  const userMessages = messages.filter((message) => message.role !== "system");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": ai.apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemMessage }] },
      contents: userMessages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      }))
    })
  });
  const data = await readJson(response);
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no text.");
  return text;
}

async function callOpenAiCompatible(ai, messages) {
  const response = await fetch(ai.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ai.apiKey}`
    },
    body: JSON.stringify({
      model: ai.model,
      messages,
      temperature: 0.25
    })
  });
  const data = await readJson(response);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("The AI provider returned no text.");
  return text;
}

async function readJson(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The AI provider returned HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new Error(`AI request failed: ${message}`);
  }
  return data;
}

function validateAiConfig(ai) {
  if (!ai?.apiKey) throw new Error("Add an API key in koalified settings first.");
  if (!ai?.model) throw new Error("Choose an AI model in koalified settings.");
  if (ai.provider === "openai-compatible" && !/^https:\/\//i.test(ai.endpoint || "")) {
    throw new Error("The OpenAI-compatible endpoint must use HTTPS.");
  }
}

function trimToLimit(text, limit) {
  const clean = String(text || "").trim();
  if (clean.length <= limit) return clean;
  const slice = clean.slice(0, limit + 1);
  const wordBoundary = slice.lastIndexOf(" ");
  return slice.slice(0, wordBoundary > limit * 0.7 ? wordBoundary : limit).trimEnd();
}

function mergeDeep(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof base[key] === "object") {
      result[key] = mergeDeep(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
