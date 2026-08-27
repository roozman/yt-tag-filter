# YouTube Tag Filter

A small, dependency-free Chrome and Firefox extension that hides YouTube videos and Shorts unless their metadata matches user-defined tags.

## Features

- Always case-insensitive.
- Selectable **OR** (any tag) or **AND** (every tag) matching.
- Optional partial-text matching; complete words and hashtags are the default.
- Filters Home, Search, Subscriptions, channel grids, related videos, playlists, and Shorts renderers.
- Uses early CSS gating so candidate cards remain hidden until they have been checked.
- Optional blocking and pausing of a non-matching video opened on a watch page.
- Optional full-description inspection with three concurrent requests, a bounded queue, a timeout, and an in-memory cache.
- Stores all settings locally. There is no extension server, account, analytics code, or API key.

## Build and test

Node.js 18 or newer is sufficient; there are no packages to install.

```sh
npm run check
```

This creates two unpacked builds:

- `dist/chrome`
- `dist/firefox`

## Install in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `dist/chrome`.
5. Open the extension from the toolbar, enter tags, choose the options, and save.

## Install temporarily in Firefox

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**.
4. Select `dist/firefox/manifest.json`.
5. Open the extension from the toolbar, enter tags, choose the options, and save.

A permanent public Firefox installation requires Mozilla signing. The generated Firefox build is ready for local testing or submission but is not signed.

## Matching behavior

Tags may be separated by commas or new lines. Matching checks the card's visible title, channel, hashtags, labels, and other visible metadata. When **Inspect full descriptions** is enabled, a watch page is requested only after visible metadata fails; the description is then combined with the visible metadata before applying the AND/OR rule.

With partial matching disabled, `space` matches `#space` and `space news`, but not `spaceship`. With partial matching enabled, `space` also matches `spaceship`.

An empty tag list disables filtering and leaves YouTube unchanged.

## Notes

YouTube is a frequently changing single-page application. The extension observes newly created and recycled video renderers and rechecks them as their metadata changes. If YouTube replaces its renderer element names in a future redesign, the selector list in `src/content.js` and `src/content.css` may stop working.

Full-description inspection deliberately fails closed: if a description cannot be retrieved and the visible metadata does not match, the video stays hidden.
