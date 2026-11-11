const test = require("node:test");
const assert = require("node:assert/strict");
const resume = require("../src/core/resume.js");

test("cleans extracted PDF whitespace without flattening sections", () => {
  const text = resume.cleanExtractedText("Anson Chan   \n\n\nExperience\u0000\n  Engineer  \n");
  assert.equal(text, "Anson Chan\n\nExperience\n  Engineer");
});

test("proposes common contact facts from résumé text", () => {
  const facts = resume.inferContactFacts(`
    Anson Chan
    anson@example.com | +1 604 555 0100
    linkedin.com/in/anson-chan
    github.com/ansonnchan
    https://anson.dev

    Experience
    Software Engineer
  `);
  const values = Object.fromEntries(facts.map((item) => [item.path, item.value]));
  assert.equal(values["personal.firstName"], "Anson");
  assert.equal(values["personal.lastName"], "Chan");
  assert.equal(values["personal.email"], "anson@example.com");
  assert.equal(values["personal.phone"], "+1 604 555 0100");
  assert.equal(values["links.linkedin"], "https://linkedin.com/in/anson-chan");
  assert.equal(values["links.github"], "https://github.com/ansonnchan");
  assert.equal(values["links.portfolio"], "https://anson.dev");
});

test("does not treat section headings as a person's name", () => {
  const facts = resume.inferContactFacts("EDUCATION\nExample University\nada@example.com");
  const values = Object.fromEntries(facts.map((item) => [item.path, item.value]));
  assert.equal(values["personal.firstName"], undefined);
  assert.equal(values["personal.lastName"], undefined);
  assert.equal(values["personal.email"], "ada@example.com");
});
