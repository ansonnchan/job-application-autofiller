const test = require("node:test");
const assert = require("node:assert/strict");
const matcher = require("../src/core/matcher.js");

const profile = {
  personal: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  address: { city: "Vancouver", region: "British Columbia" },
  education: {
    school: "Example University",
    degree: "Computer Engineering",
    degreeAliases: ["Engineering"],
    graduationDate: "2027-05"
  }
};

test("classifies common label variants", () => {
  assert.equal(matcher.classifyField("Given name (required)").key, "firstName");
  assert.equal(matcher.classifyField("Expected Graduation Date").key, "graduationDate");
  assert.equal(matcher.classifyField("LinkedIn profile URL").key, "linkedin");
});

test("does not classify submission or sensitive controls", () => {
  assert.equal(matcher.classifyField("Submit application"), null);
  assert.equal(matcher.classifyField("Account password"), null);
  assert.equal(matcher.classifyField("Social Security Number"), null);
});

test("does not confuse generic employment dates with education dates", () => {
  assert.equal(matcher.classifyField("Employment start date"), null);
  assert.equal(matcher.classifyField("Employment end date"), null);
});

test("gets nested profile values", () => {
  assert.equal(matcher.getProfileValue(profile, "firstName"), "Ada");
  assert.equal(matcher.getProfileValue(profile, "school"), "Example University");
});

test("formats month and date values", () => {
  assert.equal(matcher.formatForInput("2027-05", "month"), "2027-05");
  assert.equal(matcher.formatForInput("2027-05", "date"), "2027-05-01");
  assert.equal(matcher.formatForInput("2027-05", "text", "MM/YYYY"), "05/2027");
  assert.equal(matcher.formatForInput("2027-05-19", "text", "MM/DD/YYYY"), "05/19/2027");
});

test("uses a configured degree fallback for selects", () => {
  const proposal = matcher.propose(
    {
      label: "Degree",
      type: "select-one",
      tagName: "select",
      options: [
        { value: "arts", label: "Arts" },
        { value: "eng", label: "Engineering" }
      ]
    },
    profile
  );
  assert.equal(proposal.value, "eng");
  assert.equal(proposal.displayValue, "Engineering");
});

test("returns no proposal when profile data is absent", () => {
  const proposal = matcher.propose(
    { label: "Phone number", type: "tel", tagName: "input" },
    profile
  );
  assert.equal(proposal, null);
});

test("never proposes deterministic values for open answers or choice controls", () => {
  assert.equal(
    matcher.propose(
      { label: "Tell us about your university program", type: "textarea", tagName: "textarea" },
      profile
    ),
    null
  );
  assert.equal(
    matcher.propose(
      { label: "Email", type: "checkbox", tagName: "input" },
      profile
    ),
    null
  );
});

test("allows read-only custom comboboxes to be matched for click interaction", () => {
  const proposal = matcher.propose(
    {
      label: "Degree",
      type: "text",
      tagName: "input",
      role: "combobox",
      readOnly: true
    },
    profile
  );
  assert.equal(proposal.value, "Computer Engineering");
});
