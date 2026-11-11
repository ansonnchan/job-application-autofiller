(function initializeProfileHelpers(root, factory) {
  const api = factory();
  root.KoalifiedProfile = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createProfileHelpers() {
  "use strict";

  const COUNTRIES = [
    country("Canada", "+1", ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Nova Scotia", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Northwest Territories", "Nunavut", "Yukon"]),
    country("United States", "+1", ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia"]),
    country("Australia", "+61"),
    country("Brazil", "+55"),
    country("China", "+86"),
    country("France", "+33"),
    country("Germany", "+49"),
    country("Hong Kong", "+852"),
    country("India", "+91"),
    country("Ireland", "+353"),
    country("Japan", "+81"),
    country("Mexico", "+52"),
    country("Netherlands", "+31"),
    country("New Zealand", "+64"),
    country("Philippines", "+63"),
    country("Singapore", "+65"),
    country("South Korea", "+82"),
    country("United Kingdom", "+44")
  ];

  function country(name, dialCode, regions = []) {
    return { name, dialCode, regions };
  }

  function getCountry(name) {
    return COUNTRIES.find((item) => item.name === name) || null;
  }

  function combinePhone(dialCode, phoneNumber) {
    const number = String(phoneNumber || "").trim();
    if (!number) return "";
    if (number.startsWith("+")) return number;
    return `${dialCode || ""} ${number}`.trim();
  }

  function migrateProfile(profile = {}) {
    const personal = { ...(profile.personal || {}) };
    const existingPhone = String(personal.phone || "").trim();
    const selectedCountry = getCountry(personal.phoneCountry) || inferCountry(existingPhone) || COUNTRIES[0];
    const phoneNumber = personal.phoneNumber || stripDialCode(existingPhone, selectedCountry.dialCode);

    // Preserve the legacy combined phone value while adding structured fields.
    return {
      ...profile,
      personal: {
        ...personal,
        phoneCountry: selectedCountry.name,
        phoneCountryCode: selectedCountry.dialCode,
        phoneNumber,
        phone: combinePhone(selectedCountry.dialCode, phoneNumber)
      },
      address: {
        ...(profile.address || {}),
        country: profile.address?.country || "Canada"
      }
    };
  }

  function inferCountry(phone) {
    if (!phone.startsWith("+")) return null;
    return [...COUNTRIES]
      .sort((a, b) => b.dialCode.length - a.dialCode.length)
      .find((item) => phone.startsWith(item.dialCode)) || null;
  }

  function stripDialCode(phone, dialCode) {
    const raw = String(phone || "").trim();
    if (!raw) return "";
    return raw.startsWith(dialCode) ? raw.slice(dialCode.length).trim() : raw;
  }

  return { COUNTRIES, combinePhone, getCountry, migrateProfile };
});
