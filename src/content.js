(function initializeContentFilter() {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const matcherApi = globalThis.YTTagMatcher;

  if (!extensionApi?.storage?.local || !matcherApi) {
    document.documentElement?.setAttribute("data-yt-tag-filter-ready", "true");
    return;
  }

  const CARD_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-reel-video-renderer",
    "ytd-rich-grid-slim-media",
    "ytd-watch-card-compact-video-renderer",
    "yt-lockup-view-model",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
    "ytm-rich-item-renderer",
    "ytm-reel-item-renderer",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2"
  ];
  const CARD_SELECTOR = CARD_SELECTORS.join(",");
  const MEDIA_ANCHOR_SELECTOR = [
    "a#thumbnail[href]",
    "a#video-title[href]",
    "a.ytd-thumbnail[href]",
    "a[href^='/watch']",
    "a[href^='/shorts/']",
    "a[href^='/live/']",
    "a[href*='youtube.com/watch']",
    "a[href*='youtube.com/shorts/']"
  ].join(",");
  const METADATA_SELECTOR = [
    "#video-title",
    "#channel-name",
    "ytd-channel-name",
    "#metadata-line",
    "a[href^='/hashtag/']",
    "a[href^='/@']",
    "a[href^='/channel/']",
    ".yt-lockup-metadata-view-model__title",
    ".yt-content-metadata-view-model-wiz__metadata-text"
  ].join(",");
  const DESCRIPTION_CONCURRENCY = 3;
  const DESCRIPTION_CACHE_LIMIT = 300;
  const DESCRIPTION_QUEUE_LIMIT = 250;
  const roots = document.documentElement;
  const queuedCards = new Set();
  const cardRecords = new WeakMap();
  const descriptionCache = new Map();
  const descriptionQueue = [];

  let settings = matcherApi.normalizeSettings(matcherApi.DEFAULT_SETTINGS);
  let matcher = matcherApi.createMatcher(settings);
  let settingsVersion = 0;
  let descriptionRequestsInFlight = 0;
  let cardFrame = 0;
  let statusTimer = 0;
  let currentTimer = 0;
  let currentEvaluationToken = 0;
  let currentPendingKey = "";
  let currentPendingStartedAt = 0;
  let lastUrl = location.href;

  function storageGet(defaults) {
    if (globalThis.browser) {
      return extensionApi.storage.local.get(defaults);
    }

    return new Promise((resolve, reject) => {
      extensionApi.storage.local.get(defaults, (result) => {
        const error = extensionApi.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result);
      });
    });
  }

  function openOptions() {
    try {
      const result = extensionApi.runtime.openOptionsPage();
      if (result?.catch) {
        result.catch(() => undefined);
      }
    } catch (error) {
      console.warn("YouTube Tag Filter could not open its settings.", error);
    }
  }

  function extractVideoId(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value, location.href);
      if (url.hostname === "youtu.be") {
        return url.pathname.split("/").filter(Boolean)[0] ?? "";
      }

      if (url.pathname === "/watch") {
        return url.searchParams.get("v") ?? "";
      }

      const routeMatch = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/u);
      return routeMatch?.[1] ?? "";
    } catch (_error) {
      return "";
    }
  }

  function mediaAnchorFor(card) {
    if (card.matches("a[href]") && extractVideoId(card.getAttribute("href"))) {
      return card;
    }

    for (const anchor of card.querySelectorAll(MEDIA_ANCHOR_SELECTOR)) {
      if (extractVideoId(anchor.getAttribute("href"))) {
        return anchor;
      }
    }

    return null;
  }

  function collectNodeText(node, pieces) {
    const text = node.textContent?.trim();
    const title = node.getAttribute?.("title")?.trim();
    const label = node.getAttribute?.("aria-label")?.trim();

    if (text) {
      pieces.add(text);
    }
    if (title) {
      pieces.add(title);
    }
    if (label) {
      pieces.add(label);
    }
  }

  function cardMetadata(card) {
    const anchor = mediaAnchorFor(card);
    let videoId = extractVideoId(anchor?.getAttribute("href"));

    if (!videoId) {
      videoId = card.getAttribute("video-id") ?? card.getAttribute("data-video-id") ?? "";
    }

    if (!videoId && card.matches("ytd-reel-video-renderer[is-active]")) {
      videoId = extractVideoId(location.href);
    }

    const pieces = new Set();
    collectNodeText(card, pieces);

    if (anchor) {
      collectNodeText(anchor, pieces);
    }

    for (const node of card.querySelectorAll(METADATA_SELECTOR)) {
      collectNodeText(node, pieces);
    }

    return {
      videoId,
      text: [...pieces].join("\n")
    };
  }

  function setCardState(card, state) {
    if (!card.isConnected) {
      return;
    }

    card.setAttribute("data-yt-tag-filter-state", state);

    if (state === "blocked") {
      for (const media of card.querySelectorAll("video, audio")) {
        media.pause?.();
      }
    }

    scheduleStatusUpdate();
  }

  function queueCard(card) {
    if (!(card instanceof Element) || !card.matches(CARD_SELECTOR)) {
      return;
    }

    queuedCards.add(card);
    if (!cardFrame) {
      cardFrame = requestAnimationFrame(flushCards);
    }
  }

  function queueCardsWithin(node) {
    let element = node;
    if (node.nodeType === Node.TEXT_NODE) {
      element = node.parentElement;
    }

    if (!(element instanceof Element)) {
      return;
    }

    if (element.matches(CARD_SELECTOR)) {
      queueCard(element);
    }

    const closestCard = element.closest(CARD_SELECTOR);
    if (closestCard) {
      queueCard(closestCard);
    }

    for (const card of element.querySelectorAll(CARD_SELECTOR)) {
      queueCard(card);
    }
  }

  function queueClosestCard(node) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof Element)) {
      return;
    }

    if (element.matches(CARD_SELECTOR)) {
      queueCard(element);
      return;
    }

    const closestCard = element.closest(CARD_SELECTOR);
    if (closestCard) {
      queueCard(closestCard);
    }
  }

  function flushCards() {
    cardFrame = 0;
    const cards = [...queuedCards];
    queuedCards.clear();

    for (const card of cards) {
      if (card.isConnected) {
        void processCard(card);
      }
    }
  }

  async function processCard(card) {
    const ancestorCard = card.parentElement?.closest(CARD_SELECTOR);
    if (ancestorCard) {
      setCardState(card, "passthrough");
      queueCard(ancestorCard);
      return;
    }

    if (matcher.tags.length === 0) {
      setCardState(card, "passthrough");
      return;
    }

    const metadata = cardMetadata(card);
    if (!metadata.videoId) {
      setCardState(card, "passthrough");
      return;
    }

    const normalizedText = matcherApi.normalizeText(metadata.text).slice(0, 5000);
    const fingerprint = `${settingsVersion}|${metadata.videoId}|${normalizedText}`;
    const previous = cardRecords.get(card);
    if (previous?.fingerprint === fingerprint) {
      return;
    }

    const revision = (previous?.revision ?? 0) + 1;
    cardRecords.set(card, { fingerprint, revision });

    if (matcher.test(metadata.text)) {
      setCardState(card, "allowed");
      return;
    }

    if (!settings.inspectDescriptions) {
      setCardState(card, "blocked");
      return;
    }

    setCardState(card, "pending");
    const description = await descriptionFor(metadata.videoId);
    const current = cardRecords.get(card);

    if (!card.isConnected || current?.revision !== revision || current.fingerprint !== fingerprint) {
      return;
    }

    setCardState(card, matcher.test(`${metadata.text}\n${description}`) ? "allowed" : "blocked");
  }

  function extractDescription(html) {
    const match = html.match(/"shortDescription"\s*:\s*"((?:\\.|[^"\\])*)"/u);
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`);
      } catch (_error) {
        // Fall through to the page's description meta tag.
      }
    }

    try {
      const page = new DOMParser().parseFromString(html, "text/html");
      return page.querySelector("meta[name='description']")?.content ?? "";
    } catch (_error) {
      return "";
    }
  }

  async function fetchDescription(videoId) {
    const target = new URL("/watch", location.origin);
    target.searchParams.set("v", videoId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(target, {
        credentials: "include",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`YouTube returned ${response.status}`);
      }

      return extractDescription(await response.text());
    } catch (error) {
      console.debug("YouTube Tag Filter could not inspect a description.", error);
      return "";
    } finally {
      clearTimeout(timeout);
    }
  }

  function pumpDescriptionQueue() {
    while (descriptionRequestsInFlight < DESCRIPTION_CONCURRENCY && descriptionQueue.length > 0) {
      const job = descriptionQueue.shift();
      descriptionRequestsInFlight += 1;

      void fetchDescription(job.videoId)
        .then(job.resolve)
        .finally(() => {
          descriptionRequestsInFlight -= 1;
          pumpDescriptionQueue();
        });
    }
  }

  function descriptionFor(videoId) {
    if (descriptionCache.has(videoId)) {
      return descriptionCache.get(videoId);
    }

    if (descriptionCache.size >= DESCRIPTION_CACHE_LIMIT) {
      const oldestKey = descriptionCache.keys().next().value;
      descriptionCache.delete(oldestKey);
    }

    if (descriptionQueue.length >= DESCRIPTION_QUEUE_LIMIT) {
      return Promise.resolve("");
    }

    const request = new Promise((resolve) => {
      descriptionQueue.push({ videoId, resolve });
      pumpDescriptionQueue();
    });
    descriptionCache.set(videoId, request);
    return request;
  }

  function topLevelCards() {
    return [...document.querySelectorAll(CARD_SELECTOR)].filter(
      (card) => !card.parentElement?.closest(CARD_SELECTOR)
    );
  }

  function ensureStatusPanel() {
    let panel = document.querySelector("#yt-tag-filter-status");
    if (panel || !document.body) {
      return panel;
    }

    panel = document.createElement("div");
    panel.id = "yt-tag-filter-status";
    panel.hidden = true;

    const message = document.createElement("span");
    message.textContent = "No videos on this page match your tags.";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Edit tags";
    button.addEventListener("click", openOptions);

    panel.append(message, button);
    document.body.append(panel);
    return panel;
  }

  function scheduleStatusUpdate() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(updateStatus, 120);
  }

  function updateStatus() {
    const panel = ensureStatusPanel();
    if (!panel) {
      return;
    }

    if (matcher.tags.length === 0 || location.pathname === "/watch") {
      panel.hidden = true;
      return;
    }

    let allowed = 0;
    let blocked = 0;
    let pending = 0;

    for (const card of topLevelCards()) {
      const state = card.getAttribute("data-yt-tag-filter-state");
      if (state === "allowed") {
        allowed += 1;
      } else if (state === "blocked") {
        blocked += 1;
      } else if (state === "pending" || !state) {
        pending += 1;
      }
    }

    panel.hidden = allowed > 0 || blocked === 0 || pending > 0;
  }

  function directRouteVideoId() {
    if (location.pathname === "/watch" || location.pathname.startsWith("/shorts/")) {
      return extractVideoId(location.href);
    }
    return "";
  }

  function currentMetadata(videoId) {
    const pieces = new Set();
    const pageVideoId = document.querySelector("meta[itemprop='videoId']")?.content ?? "";
    const watchElement = document.querySelector("ytd-watch-flexy");
    const watchVideoId = watchElement?.getAttribute("video-id") ?? "";
    const activeShort = document.querySelector("ytd-reel-video-renderer[is-active]");
    const ready = pageVideoId === videoId || watchVideoId === videoId || Boolean(activeShort);

    const title = document.title.replace(/\s+-\s+YouTube\s*$/u, "").trim();
    if (title) {
      pieces.add(title);
    }

    for (const selector of [
      "meta[name='title']",
      "meta[property='og:title']",
      "meta[name='description']",
      "ytd-watch-metadata h1",
      "#owner #channel-name",
      "#owner ytd-channel-name",
      "ytd-reel-video-renderer[is-active]"
    ]) {
      const node = document.querySelector(selector);
      const content = node?.getAttribute?.("content")?.trim();
      if (content) {
        pieces.add(content);
      }
      if (node) {
        collectNodeText(node, pieces);
      }
    }

    return {
      ready,
      text: [...pieces].join("\n")
    };
  }

  function ensureBlockedOverlay() {
    let overlay = document.querySelector("#yt-tag-filter-blocked-overlay");
    if (overlay || !document.body) {
      return overlay;
    }

    overlay = document.createElement("section");
    overlay.id = "yt-tag-filter-blocked-overlay";
    overlay.hidden = true;

    const heading = document.createElement("strong");
    heading.textContent = "Video blocked by your tag filter";

    const message = document.createElement("p");
    message.textContent = "This video's available metadata does not match the tags in your settings.";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Edit settings";
    button.addEventListener("click", openOptions);

    overlay.append(heading, message, button);
    document.body.append(overlay);
    return overlay;
  }

  function pausePageMedia() {
    for (const media of document.querySelectorAll("video, audio")) {
      media.pause?.();
    }
  }

  function setCurrentState(state) {
    roots.setAttribute("data-yt-tag-current-state", state);
    const overlay = ensureBlockedOverlay();
    if (overlay) {
      overlay.hidden = state !== "blocked";
    }

    if (state === "blocked") {
      pausePageMedia();
    }
  }

  function scheduleCurrentEvaluation(delay = 80) {
    clearTimeout(currentTimer);
    currentTimer = setTimeout(() => void evaluateCurrentPage(), delay);
  }

  async function evaluateCurrentPage() {
    const evaluationToken = ++currentEvaluationToken;
    const videoId = directRouteVideoId();

    if (!videoId || matcher.tags.length === 0 || !settings.blockDirect) {
      currentPendingKey = "";
      setCurrentState("allowed");
      return;
    }

    const pendingKey = `${settingsVersion}|${videoId}`;
    if (pendingKey !== currentPendingKey) {
      currentPendingKey = pendingKey;
      currentPendingStartedAt = Date.now();
    }

    setCurrentState("pending");
    const metadata = currentMetadata(videoId);

    if (!metadata.ready) {
      if (Date.now() - currentPendingStartedAt < 3000) {
        scheduleCurrentEvaluation(200);
        return;
      }

      setCurrentState("blocked");
      return;
    }

    if (matcher.test(metadata.text)) {
      setCurrentState("allowed");
      return;
    }

    if (!settings.inspectDescriptions) {
      setCurrentState("blocked");
      return;
    }

    const description = await descriptionFor(videoId);
    if (evaluationToken !== currentEvaluationToken || directRouteVideoId() !== videoId) {
      return;
    }

    setCurrentState(matcher.test(`${metadata.text}\n${description}`) ? "allowed" : "blocked");
  }

  function resetCards() {
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      card.removeAttribute("data-yt-tag-filter-state");
      queueCard(card);
    }
  }

  function applySettings(rawSettings) {
    settings = matcherApi.normalizeSettings(rawSettings);
    matcher = matcherApi.createMatcher(settings);
    settingsVersion += 1;
    roots.setAttribute("data-yt-tag-filter-active", String(matcher.tags.length > 0));
    resetCards();
    scheduleCurrentEvaluation(0);
    scheduleStatusUpdate();
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    const nextSettings = { ...settings };
    let relevantChange = false;

    for (const key of Object.keys(matcherApi.DEFAULT_SETTINGS)) {
      if (Object.hasOwn(changes, key)) {
        nextSettings[key] = changes[key].newValue;
        relevantChange = true;
      }
    }

    if (relevantChange) {
      applySettings(nextSettings);
    }
  }

  const observer = new MutationObserver((mutations) => {
    let affectsCurrentVideo = false;

    for (const mutation of mutations) {
      const targetElement = mutation.target.nodeType === Node.TEXT_NODE
        ? mutation.target.parentElement
        : mutation.target;

      if (targetElement?.closest?.("#yt-tag-filter-status, #yt-tag-filter-blocked-overlay")) {
        continue;
      }

      queueClosestCard(mutation.target);
      for (const addedNode of mutation.addedNodes) {
        queueCardsWithin(addedNode);
      }
      affectsCurrentVideo = true;
    }

    if (affectsCurrentVideo && settings.blockDirect) {
      scheduleCurrentEvaluation();
    }
  });

  function handleNavigation() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      currentPendingKey = "";
    }
    resetCards();
    scheduleCurrentEvaluation(0);
    scheduleStatusUpdate();
  }

  async function start() {
    observer.observe(roots, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "href", "title", "video-id", "is-active"]
    });

    document.addEventListener("yt-navigate-start", () => {
      if (settings.blockDirect && directRouteVideoId()) {
        setCurrentState("pending");
      }
    });
    document.addEventListener("yt-navigate-finish", handleNavigation);
    window.addEventListener("popstate", handleNavigation);
    document.addEventListener(
      "play",
      (event) => {
        if (roots.getAttribute("data-yt-tag-current-state") === "blocked") {
          event.target.pause?.();
        }
      },
      true
    );
    extensionApi.storage.onChanged.addListener(handleStorageChange);

    try {
      applySettings(await storageGet(matcherApi.DEFAULT_SETTINGS));
    } catch (error) {
      console.error("YouTube Tag Filter could not load settings.", error);
      applySettings(matcherApi.DEFAULT_SETTINGS);
    } finally {
      roots.setAttribute("data-yt-tag-filter-ready", "true");
      queueCardsWithin(document.body ?? roots);
      scheduleCurrentEvaluation(0);
    }
  }

  void start();
})();
