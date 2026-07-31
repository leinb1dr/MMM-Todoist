# AGENTS.md

## Cursor Cloud specific instructions

This is **MMM-Todoist**, a MagicMirror² module (not a standalone app). It requires a running MagicMirror² instance as its host.

### Architecture

- `node_helper.js` — Backend Node.js helper that fetches tasks from the Todoist Sync API v1 using `axios`, converts markdown content via `showdown`.
- `MMM-Todoist.js` — Frontend browser module registered with `Module.register()`. Renders tasks as styled HTML.
- `MMM-Todoist.css` — Styling.
- `translations/` — i18n strings (en, de, nb, fr, cs).

### Dependencies

- Runtime: `axios`, `showdown` (installed via `npm install` in `/workspace`).
- No dev dependencies, no test framework, no linter, no build step in this repo.

### Running in development

MagicMirror² is installed at `/opt/MagicMirror`. The module is symlinked into it:

```
ln -sf /workspace /opt/MagicMirror/modules/MMM-Todoist
```

A config is placed at `/opt/MagicMirror/config/config.js` that loads MMM-Todoist.

To start the MagicMirror² server (server-only, no Electron):

```bash
cd /opt/MagicMirror && node serveronly
```

The UI is served on `http://localhost:8080`. The module's node_helper will attempt to contact the Todoist API. Without a valid `accessToken` in the config, a 401 error is expected and properly handled.

### Key gotchas

- **Node.js >= 22 required**: MagicMirror² v2.36+ needs Node.js 22+. Node 20 will fail `npm install` with `EBADENGINE`.
- **Module symlink**: The module must exist at `/opt/MagicMirror/modules/MMM-Todoist` (symlink to `/workspace`).
- **No tests or lint in this repo**: There are no test scripts, linting configs, or CI configuration in the module itself. Validation is done through MagicMirror²'s config check (`cd /opt/MagicMirror && npm run config:check`) and manual browser testing.
- **Todoist API token**: A real token is needed to see actual tasks. Without one, the module shows "Loading..." and the server logs a 401 error. This is expected behavior for development without credentials.
- **Manual verification with real Todoist data**: Changes that mutate Todoist tasks (for example completing, uncompleting, or recurring-task behavior) must be manually verified against a real Todoist account and valid `accessToken`. Mock API checks can validate request shapes, but they are not sufficient as final acceptance evidence for these flows.
- **Batched task updates**: Completing/uncompleting is optimistic in the UI and debounced (`batchUpdateDelay`, default 30s) into a single Sync API `commands` batch, then a refresh. Tapping again before the timer fires undoes or adjusts the pending batch.
