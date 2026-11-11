(function initializeResumeHelpers(root, factory) {
  const api = factory();
  root.KoalifiedResume = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createResumeHelpers() {
  "use strict";

  const SECTION_HEADINGS = new Set([
    "education", "experience", "work experience", "projects", "skills", "certifications"
  ]);

  function cleanExtractedText(text) {
    return String(text || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function inferContactFacts(text) {
    const clean = cleanExtractedText(text);
    if (!clean) return [];

    const facts = [];
    const email = clean.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
    const phone = clean.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/)?.[0];
    const urls = [...new Set([
      ...[...clean.matchAll(/(?:https?:\/\/|www\.)[^\s<>()[\]{}]+/gi)].map((match) => match[0]),
      ...[...clean.matchAll(/\b(?:linkedin\.com\/in\/[A-Z0-9_-]+|github\.com\/[A-Z0-9_.-]+)/gi)].map((match) => match[0])
    ].map((url) => url.replace(/[.,;:!?]+$/, "")))];
    const name = inferName(clean);

    if (name) {
      facts.push(fact("personal.firstName", "First name", name.firstName, "Likely résumé header"));
      facts.push(fact("personal.lastName", "Last name", name.lastName, "Likely résumé header"));
    }
    if (email) facts.push(fact("personal.email", "Email", email, "Email address"));
    if (phone) facts.push(fact("personal.phone", "Phone", phone, "Phone number"));

    const linkedin = urls.find((url) => /(^|\.)linkedin\.com\//i.test(stripProtocol(url)));
    const github = urls.find((url) => /(^|\.)github\.com\//i.test(stripProtocol(url)));
    const portfolio = urls.find((url) => url !== linkedin && url !== github);
    if (linkedin) facts.push(fact("links.linkedin", "LinkedIn", ensureProtocol(linkedin), "LinkedIn URL"));
    if (github) facts.push(fact("links.github", "GitHub", ensureProtocol(github), "GitHub URL"));
    if (portfolio) facts.push(fact("links.portfolio", "Portfolio", ensureProtocol(portfolio), "Other URL"));

    return facts;
  }

  function inferName(text) {
    const line = text.split("\n").map((value) => value.trim()).find(Boolean) || "";
    const normalized = line.toLowerCase().replace(/[^a-z ]/g, "").trim();
    if (!normalized || SECTION_HEADINGS.has(normalized) || line.length > 70 || /[@:/\d|•]/.test(line)) {
      return null;
    }
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) return null;
    if (!parts.every((part) => /^[A-Za-zÀ-ÖØ-öø-ÿ.'’-]+$/.test(part))) return null;
    return { firstName: parts[0], lastName: parts[parts.length - 1] };
  }

  function fact(path, label, value, reason) {
    return { path, label, value: String(value || "").trim(), reason };
  }

  function stripProtocol(url) {
    return String(url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }

  function ensureProtocol(url) {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  return { cleanExtractedText, inferContactFacts };
});
