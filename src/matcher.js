(function initializeMatcher(globalScope) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    tagsText: "",
    matchMode: "or",
    partialMatch: false,
    blockDirect: false,
    inspectDescriptions: false
  });

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/gu, " ")
      .trim();
  }

  function parseTags(value) {
    const uniqueTags = new Set();

    for (const rawTag of String(value ?? "").split(/[\n,]+/u)) {
      const tag = normalizeText(rawTag);
      if (tag) {
        uniqueTags.add(tag);
      }
    }

    return [...uniqueTags];
  }

  function normalizeSettings(value = {}) {
    return {
      tagsText: typeof value.tagsText === "string" ? value.tagsText : DEFAULT_SETTINGS.tagsText,
      matchMode: value.matchMode === "and" ? "and" : "or",
      partialMatch: value.partialMatch === true,
      blockDirect: value.blockDirect === true,
      inspectDescriptions: value.inspectDescriptions === true
    };
  }

  function escapeRegularExpression(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }

  function wholeTermPattern(tag) {
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${escapeRegularExpression(tag)}(?=$|[^\\p{L}\\p{N}_])`,
      "u"
    );
  }

  function createMatcher(rawSettings = {}) {
    const settings = normalizeSettings(rawSettings);
    const tags = parseTags(settings.tagsText);
    const exactPatterns = settings.partialMatch ? [] : tags.map(wholeTermPattern);

    function tagMatches(text, tagIndex) {
      if (settings.partialMatch) {
        return text.includes(tags[tagIndex]);
      }

      return exactPatterns[tagIndex].test(text);
    }

    function test(value) {
      if (tags.length === 0) {
        return true;
      }

      const text = normalizeText(value);
      if (!text) {
        return false;
      }

      if (settings.matchMode === "and") {
        return tags.every((_tag, index) => tagMatches(text, index));
      }

      return tags.some((_tag, index) => tagMatches(text, index));
    }

    function matchingTags(value) {
      const text = normalizeText(value);
      return tags.filter((_tag, index) => tagMatches(text, index));
    }

    return Object.freeze({
      settings,
      tags,
      test,
      matchingTags
    });
  }

  const matcherApi = Object.freeze({
    DEFAULT_SETTINGS,
    createMatcher,
    normalizeSettings,
    normalizeText,
    parseTags
  });

  globalScope.YTTagMatcher = matcherApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = matcherApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

