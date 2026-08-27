(function initializeOptions() {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const { DEFAULT_SETTINGS, normalizeSettings } = globalThis.YTTagMatcher;
  const form = document.querySelector("#settings-form");
  const tagsInput = document.querySelector("#tags");
  const matchModeInput = document.querySelector("#match-mode");
  const partialMatchInput = document.querySelector("#partial-match");
  const blockDirectInput = document.querySelector("#block-direct");
  const inspectDescriptionsInput = document.querySelector("#inspect-descriptions");
  const saveButton = form.querySelector("button[type='submit']");
  const saveStatus = document.querySelector("#save-status");
  let statusTimer;

  function getSettings() {
    if (globalThis.browser) {
      return extensionApi.storage.local.get(DEFAULT_SETTINGS);
    }

    return new Promise((resolve, reject) => {
      extensionApi.storage.local.get(DEFAULT_SETTINGS, (result) => {
        const error = extensionApi.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result);
      });
    });
  }

  function setSettings(settings) {
    if (globalThis.browser) {
      return extensionApi.storage.local.set(settings);
    }

    return new Promise((resolve, reject) => {
      extensionApi.storage.local.set(settings, () => {
        const error = extensionApi.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function readForm() {
    return normalizeSettings({
      tagsText: tagsInput.value,
      matchMode: matchModeInput.value,
      partialMatch: partialMatchInput.checked,
      blockDirect: blockDirectInput.checked,
      inspectDescriptions: inspectDescriptionsInput.checked
    });
  }

  function writeForm(settings) {
    tagsInput.value = settings.tagsText;
    matchModeInput.value = settings.matchMode;
    partialMatchInput.checked = settings.partialMatch;
    blockDirectInput.checked = settings.blockDirect;
    inspectDescriptionsInput.checked = settings.inspectDescriptions;
  }

  function showStatus(message, isError = false) {
    clearTimeout(statusTimer);
    saveStatus.textContent = message;
    saveStatus.style.color = isError ? "#d93025" : "";
    statusTimer = setTimeout(() => {
      saveStatus.textContent = "";
      saveStatus.style.color = "";
    }, 2500);
  }

  async function load() {
    try {
      writeForm(normalizeSettings(await getSettings()));
    } catch (error) {
      console.error("YouTube Tag Filter could not load settings.", error);
      writeForm(DEFAULT_SETTINGS);
      showStatus("Could not load settings", true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;

    try {
      await setSettings(readForm());
      showStatus("Saved");
    } catch (error) {
      console.error("YouTube Tag Filter could not save settings.", error);
      showStatus("Could not save settings", true);
    } finally {
      saveButton.disabled = false;
    }
  });

  void load();
})();

