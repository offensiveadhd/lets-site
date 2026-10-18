# lets-site

The public website for [lets](https://github.com/offensiveadhd/lets): talk to
Claude through windows, not just text.

Published with GitHub Pages as a project site at
**https://lets.offensiveadhd.com/**.

Plain HTML, one CSS file and a few ES modules. No build step, no bundler, no
CDN, no web fonts from the network, no analytics.

## What is here

```
index.html            landing page: the engine first (hero with Doto, what the engine does),
                      graph + cocode as the two showcase uniques, install prompt, screenshots
uniques.html          graph + cocode + den + mors + pulse with their install lines, defaults vs the store, proposed next
playground.html       the real lets shell on an offline loopback: moods, reactions, chat
404.html              self-contained (inline CSS), works at any depth
docs/                 index, getting-started, companion, uniques, graph, den, cocode, mors, protocol, architecture
css/site.css          the only stylesheet (deep-violet theme variables from lets/sdk/lets-shell.css)
js/site.js            nav toggles, copy buttons, the hero orb, anchors
js/playground.js      mounts the shell with a stub transport
sdk/                  vendored copies of lets/sdk/lets-client.js, lets-shell.js, lets-shell.css
assets/               logo, graph + den + cocode + mors + pulse icons, screenshots
.nojekyll             tells Pages to serve files as-is (no Jekyll)
```

## Preview locally

From this folder:

```bash
python -m http.server 8765
# or
npx serve -l 8765 .
```

Then open http://127.0.0.1:8765/. Pages use ES modules, so open them through a
server, not straight from disk (`file://`).

## Rules for editing

- **Every path is relative** (`./x`, `../x`), never root-absolute (`/x`): the
  site lives under `/lets-site/` on Pages. Check before pushing:

  ```bash
  grep -rnE '(href|src)="/|url\(/' .
  ```

  It must print nothing.
- Theme colours come from the `:root` block of `lets/sdk/lets-shell.css`.
  Keep body text at 4.5:1 contrast or better, respect
  `prefers-reduced-motion`, keep everything keyboard-reachable, give images
  alt text, and check 375 px width (no horizontal scroll).
- Claims stay honest: only what the lets repos and the current release do.
  Features that land with a release are marked "new in 0.4.0".

## Updating the vendored SDK

The playground runs the real shell. When `lets/sdk` changes, copy the three
files over:

```bash
cp ../lets/sdk/lets-client.js ../lets/sdk/lets-shell.js ../lets/sdk/lets-shell.css sdk/
```

The playground links `./sdk/lets-shell.css` itself, so the shell never tries
to inject its default root-absolute `/sdk/lets-shell.css`, and it never calls
`lets.open()`, so nothing is fetched. Reaction buttons light up automatically
once the vendored shell has `shell.entity.react` (lets 0.4.0).

## Publishing

GitHub Pages, "Deploy from a branch": branch `main`, folder `/ (root)`.
Pages serves `index.html` at the root and `404.html` for missing paths.
`.nojekyll` keeps Pages from running Jekyll.

## License

MIT © offensiveadhd
