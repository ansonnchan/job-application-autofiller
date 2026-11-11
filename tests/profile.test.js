const test = require("node:test");
const assert = require("node:assert/strict");
const profileHelpers = require("../src/core/profile.js");

test("migrates an existing Canadian phone without losing its combined value", () => {
  const profile = profileHelpers.migrateProfile({
    personal: { phone: "+1 604 555 0100" },
    address: {}
  });
  assert.equal(profile.personal.phoneCountry, "Canada");
  assert.equal(profile.personal.phoneNumber, "604 555 0100");
  assert.equal(profile.personal.phone, "+1 604 555 0100");
});

test("infers countries with longer calling codes first", () => {
  const profile = profileHelpers.migrateProfile({
    personal: { phone: "+852 2123 4567" }
  });
  assert.equal(profile.personal.phoneCountry, "Hong Kong");
  assert.equal(profile.personal.phoneCountryCode, "+852");
});

test("combines a selected calling code with a local number", () => {
  assert.equal(profileHelpers.combinePhone("+44", "020 7946 0958"), "+44 020 7946 0958");
});
