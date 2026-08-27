const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SETTINGS,
  createMatcher,
  normalizeSettings,
  parseTags
} = require("../src/matcher.js");

test("parses comma- and newline-separated tags without duplicates", () => {
  assert.deepEqual(parseTags("Science, music\nSCIENCE\n space exploration "), [
    "science",
    "music",
    "space exploration"
  ]);
});

test("matching is always case-insensitive", () => {
  const matcher = createMatcher({ tagsText: "ScIeNcE" });
  assert.equal(matcher.test("A new SCIENCE documentary"), true);
});

test("complete matching does not accept partial words by default", () => {
  const matcher = createMatcher({ tagsText: "sci" });
  assert.equal(matcher.test("A science documentary"), false);
  assert.equal(matcher.test("A sci fi documentary"), true);
});

test("partial matching can be enabled", () => {
  const matcher = createMatcher({ tagsText: "sci", partialMatch: true });
  assert.equal(matcher.test("A science documentary"), true);
});

test("OR mode accepts any configured tag", () => {
  const matcher = createMatcher({ tagsText: "science\nmusic", matchMode: "or" });
  assert.equal(matcher.test("Live classical music"), true);
  assert.equal(matcher.test("Football highlights"), false);
});

test("AND mode requires every configured tag across the available metadata", () => {
  const matcher = createMatcher({ tagsText: "science\ndocumentary", matchMode: "and" });
  assert.equal(matcher.test("Science Weekly\nA long documentary"), true);
  assert.equal(matcher.test("Science Weekly\nA short interview"), false);
});

test("plain tags match visible hashtags as complete terms", () => {
  const matcher = createMatcher({ tagsText: "space" });
  assert.equal(matcher.test("Launch day #space"), true);
  assert.equal(matcher.test("A #spaceship tour"), false);
});

test("matching supports non-Latin complete words", () => {
  const matcher = createMatcher({ tagsText: "علم" });
  assert.equal(matcher.test("یک مستند علم جدید"), true);
  assert.equal(matcher.test("یک مستند علمی جدید"), false);
});

test("empty tags disable filtering", () => {
  const matcher = createMatcher({ tagsText: "  \n," });
  assert.equal(matcher.test("Anything at all"), true);
});

test("invalid setting values safely fall back to defaults", () => {
  assert.deepEqual(normalizeSettings({ matchMode: "unexpected", partialMatch: "yes" }), {
    ...DEFAULT_SETTINGS
  });
});

