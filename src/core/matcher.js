(function initializeMatcher(root, factory) {
  const api = factory();
  root.KoalifiedMatcher = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createMatcher() {
  "use strict";

  // Keep profile matching deterministic; AI is reserved for open-ended answers.
  const RULES = [
    rule("firstName", ["first name", "given name", "forename"], 1),
    rule("lastName", ["last name", "family name", "surname"], 1),
    rule("preferredName", ["preferred name", "chosen name", "nickname"], 0.98),
    rule("email", ["email address", "email", "e-mail"], 1),
    rule("phone", ["phone number", "mobile number", "telephone", "phone", "mobile"], 0.98),
    rule("addressLine1", ["address line 1", "street address", "home address", "address"], 0.92),
    rule("addressLine2", ["address line 2", "apartment", "apt", "unit", "suite"], 0.97),
    rule("city", ["city", "town"], 0.96),
    rule("region", ["state province", "state/province", "province", "state", "region"], 0.93),
    rule("postalCode", ["postal code", "zip code", "zip", "postcode"], 0.98),
    rule("country", ["country of residence", "country"], 0.96),
    rule("linkedin", ["linkedin profile", "linkedin url", "linkedin"], 1),
    rule("github", ["github profile", "github url", "github"], 1),
    rule("portfolio", ["portfolio website", "personal website", "portfolio url", "portfolio", "website"], 0.93),
    rule("school", ["school name", "university name", "institution name", "college", "university", "school", "institution"], 0.94),
    rule("degree", ["degree type", "degree"], 0.96),
    rule("fieldOfStudy", ["field of study", "area of study", "major", "program"], 0.96),
    rule("educationStartDate", ["education start date", "school start date", "degree start date"], 0.9),
    rule("graduationDate", ["expected graduation date", "graduation date", "degree date", "education completion date", "school end date"], 0.9),
    rule("gpa", ["grade point average", "cumulative gpa", "gpa"], 0.98)
  ];

  const UNSAFE_PATTERNS = [
    /password|passcode|verification|one[ -]?time|\botp\b/i,
    /social security|\bssn\b|national id|credit card|bank account/i,
    /captcha/i,
    /submit|create account|sign up|register|continue|next/i
  ];

  function rule(key, aliases, confidence) {
    return { key, aliases, confidence };
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/https?:\/\//g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function classifyField(label) {
    const normalizedLabel = normalize(label);
    if (!normalizedLabel || UNSAFE_PATTERNS.some((pattern) => pattern.test(normalizedLabel))) {
      return null;
    }

    let best = null;
    for (const candidate of RULES) {
      for (const alias of candidate.aliases) {
        const normalizedAlias = normalize(alias);
        const exact = normalizedLabel === normalizedAlias;
        const contained = normalizedLabel.includes(normalizedAlias);
        if (!exact && !contained) continue;

        const specificity = normalizedAlias.length / Math.max(normalizedLabel.length, 1);
        const score = candidate.confidence * (exact ? 1 : 0.88 + specificity * 0.1);
        if (!best || score > best.score || (score === best.score && normalizedAlias.length > best.alias.length)) {
          best = { key: candidate.key, confidence: Math.min(score, 1), alias: normalizedAlias };
        }
      }
    }

    return best ? { key: best.key, confidence: Number(best.confidence.toFixed(2)) } : null;
  }

  function getProfileValue(profile, key) {
    const paths = {
      firstName: ["personal", "firstName"],
      lastName: ["personal", "lastName"],
      preferredName: ["personal", "preferredName"],
      email: ["personal", "email"],
      phone: ["personal", "phone"],
      addressLine1: ["address", "line1"],
      addressLine2: ["address", "line2"],
      city: ["address", "city"],
      region: ["address", "region"],
      postalCode: ["address", "postalCode"],
      country: ["address", "country"],
      linkedin: ["links", "linkedin"],
      github: ["links", "github"],
      portfolio: ["links", "portfolio"],
      school: ["education", "school"],
      degree: ["education", "degree"],
      fieldOfStudy: ["education", "fieldOfStudy"],
      educationStartDate: ["education", "startDate"],
      graduationDate: ["education", "graduationDate"],
      gpa: ["education", "gpa"]
    };
    return (paths[key] || []).reduce(
      (current, part) => (current && current[part] != null ? current[part] : ""),
      profile || {}
    );
  }

  function formatForInput(value, inputType, hint = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (inputType === "month") return raw.slice(0, 7);
    if (inputType === "date") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
    }
    const normalizedHint = normalize(hint);
    const match = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (match && /mm dd yyyy|month day year/.test(normalizedHint)) {
      return `${match[2]}/${match[3] || "01"}/${match[1]}`;
    }
    if (match && /mm yyyy|month year/.test(normalizedHint)) {
      return `${match[2]}/${match[1]}`;
    }
    return raw;
  }

  function chooseOption(options, value, aliases = []) {
    const desired = [value, ...aliases].map(normalize).filter(Boolean);
    if (!desired.length) return null;

    const normalizedOptions = (options || []).map((option) => ({
      ...option,
      normalized: normalize(option.label || option.text || option.value)
    }));

    for (const target of desired) {
      const exact = normalizedOptions.find((option) => option.normalized === target);
      if (exact) return exact;
    }

    for (const target of desired) {
      const contained = normalizedOptions.find(
        (option) => option.normalized.includes(target) || target.includes(option.normalized)
      );
      if (contained) return contained;
    }

    const compactDesired = desired.map(compact);
    return normalizedOptions.find((option) => compactDesired.includes(compact(option.normalized))) || null;
  }

  function propose(field, profile) {
    if (!field || field.disabled || (field.readOnly && field.role !== "combobox")) return null;
    if (field.tagName === "textarea") return null;
    if (["hidden", "password", "file", "submit", "button", "reset", "image", "checkbox", "radio"].includes(field.type)) return null;

    const classification = classifyField(field.label);
    if (!classification) return null;

    const rawValue = getProfileValue(profile, classification.key);
    if (rawValue == null || String(rawValue).trim() === "") return null;

    if (field.tagName === "select") {
      const aliases = classification.key === "degree" ? profile?.education?.degreeAliases || [] : [];
      const option = chooseOption(field.options, rawValue, aliases);
      if (!option) return null;
      return { ...classification, value: option.value, displayValue: option.label || option.text || option.value };
    }

    const value = formatForInput(rawValue, field.type, `${field.placeholder || ""} ${field.label || ""}`);
    if (!value) return null;
    return { ...classification, value, displayValue: value };
  }

  return {
    RULES,
    chooseOption,
    classifyField,
    formatForInput,
    getProfileValue,
    normalize,
    propose
  };
});
