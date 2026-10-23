# dsh-bili-config

[简体中文](./README.md) | **English**

> A graphical config panel for [billion-context](https://github.com/ranxianglei/billion-context) (the ACP context-compression engine): tune fold thresholds from the DSH plugin page, watch live compression metrics, and apply presets — instead of hand-reading a 328KB reference doc.

## Why

billion-context is the most-installed context compression plugin in the DSH ecosystem, but its default thresholds are very conservative:

- Growth gate `nudgeGrowthTokens` defaults to **50000** — if a session's per-step compressible mass stays below that, **folding never fires**;
- Pressure line `maxContextLimit` defaults to **75%** — below three quarters of the window, likewise nothing.

So long sessions re-send their entire history on every step (measured: 195 forwards in one session, 3–5 per minute, 1.3–1.9 MiB per request) while the compression engine idles. Fixing this means editing `~/.config/billion-context/billion-context.json` — but the shipped `CONFIGURATION` doc is 328KB. Most users never find the one number that matters.

This plugin turns that into three clicks: **Settings → Plugins → bili fold → pick a preset**.

## Features

- **Three presets** (whitelist keys only; everything else untouched):

| Preset | Changes | For |
| --- | --- | --- |
| Conservative | Pins `reconcile=repair` only | Observers |
| Balanced (recommended) | Growth gate 50000→25000 | Most sessions |
| Aggressive | Growth gate 20000 + 50% pressure line | Very long sessions |

- **Live metrics** (parses the 512KB tail of `bili.log`, refreshes every 5s): context usage %, pending-fold mass, growth, cache-hit rate, fold-drift count, degenerate-fold warnings, folds done + last fold's ratio
- **Per-key fine-tuning** with inline help text
- **Hot-applied writes** — billion-context merges config per request; no restart
- **Automatic backups** on every write (`.bak-<timestamp>`, keeps last 10)
- Ships a `bili_config` tool so the model itself can read the metrics ("why hasn't folding triggered yet?")

## Install

```sh
dsh plugin --profile web add dsh-bili-config
```

On DSH Desktop, install from the in-app **Settings → Plugins** page (the desktop profile is managed by the app).

Requires DSH `0.2.1-rc.2` (declared in `engines.dsh`). Works with any recent billion-context release — it talks to the engine via its config file, not internal APIs.

## Relation to other plugins

- **@indexyz/dsh-autocompact**: manages DSH's *native* compaction (`/compact`, `dsh-compaction` service). This plugin manages *billion-context's* ACP fold — a separate process with a separate config. Like remotes for two different air conditioners in one house: no overlap, safe to install both. The only shared concern is a UI hint: cranking both pipelines too hard loses information.
- **dsh-context-governor**: read-only observation of general context/cost stats; this plugin writes billion-context config specifically. Complementary.

## Built-in plugin conflict detection

The plugin page **automatically checks your profile's installed plugins** against a known-conflict knowledge base. When a conflict is found, the panel shows it at the top, e.g.:

```
Plugin compatibility notes (checked 18 installed plugins)
⚠️ mosaic-memory-compress conflicts with billion-context (CONFLICT): in-place dialogue compression competes with ACP fold…
⚠️ dsh-sieve conflicts with DSH 0.2.1-rc.2 host (INCOMPATIBLE): engines lock the 0.2.1-alpha.1 line; install fails.
```

Levels:
- **CONFLICT**: co-installing breaks each other (e.g. mosaic-memory-compress vs billion-context — two compression engines overwrite each other's fold state)
- **INCOMPATIBLE**: version/engine mismatch, fails to load (e.g. dsh-sieve)
- **overlap**: no crash, but duplicate or idle functionality (e.g. dsh-cost-meter vs whale-widget)

The knowledge base lives in `lib/compatibility.mjs` (`COMPAT`); only evidence-backed entries are included — **unlisted plugins are never guessed as "compatible"**. The model side can query via the `bili_config` tool with `action=compat`.

## Safety design

1. **Key-level merge, never whole-file rewrite** — billion-context shipped three releases in two days (0.1.202→0.1.204); unknown keys in user config pass through untouched.
2. **Whitelist**: only the 17 keys declared in `WHITELIST` (`lib/config.mjs`) may be modified, with type/range validation; invalid requests are rejected atomically and the file is left alone.
3. **Atomic writes**: temp file + `rename`; no half-written files on crash.
4. **Backup rotation**: one backup per write, at most 10 kept.
5. All reads are **local file access**; the engine's admin API (`/__bili__/`) is never touched (it sits behind a trust fence and returns 403 to plain requests anyway).

## Development

```sh
npm run check   # node --check on the three entrypoints
npm test        # offline tests: key merge / unknown-key passthrough / backup pruning / log parsing
```

No build step. No runtime dependencies.

## Known limits

- `nudge idle` lines only appear once the engine has actually evaluated a fold; on a fresh session "pending fold" may read `—`.
- `bili.log` rotates at 10MB; metrics reflect the last 512KB (recent dozens of turns), not all history.
- Preset matching is exact per-key; hand-editing any preset key flips the badge to "(custom)".

## License

MIT
