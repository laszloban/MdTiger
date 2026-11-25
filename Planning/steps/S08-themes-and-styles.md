# S08 – Themes (light, dark, follow system) and styles

| | |
|---|---|
| **Depends on** | S07 |
| **Requirements** | FR-STYLE-01 (Light / Dark / Follow system), FR-STYLE-02 … FR-STYLE-05, FR-MERMAID-04 |
| **Spike reference** | `spike/frontend/src/styles.css` (structure only) |

## 1. Goal

A polished look in both light and dark, with a three-way theme choice
(**Light, Dark, Follow system**; default Follow system) that switches live,
title bar included; clearly distinct headings; a few built-in rendering
styles; user-defined styles; and font/size/zoom controls. The tiger icon's
orange is the accent color.

## 2. Scope

**In:** color tokens for both themes, theme switching (UI, setting, live OS
following, window title bar, no flash at startup), editor and code
highlighting colors, Mermaid theme, rendering styles, custom user styles,
fonts, content width, zoom.

**Out:** the full settings panel (S09; this step adds the toolbar/menu
controls and settings keys it needs).

## 3. Design and tasks

### 3.1 Tokens (`src/styles/tokens.css`)

- All colors as custom properties on `:root[data-theme="light"]` and
  `:root[data-theme="dark"]`: background, surface, raised surface, border,
  text, muted text, accent, accent text, selection, find-match, current
  match, link, code background, code tokens (keyword, string, number,
  comment, type, function, operator, punctuation, heading markers in
  source), banner, focus ring.
- **Accent:** derived from the icon gradient (dark orange ~`#C4561A` to
  light ~`#F2A541`). Pick an accent that reaches 4.5:1 contrast for text on
  it in both themes (likely a darker orange in light, lighter in dark) and
  note the final values in the implementation notes.
- Body text and muted text meet WCAG AA (4.5:1) on their backgrounds in
  both themes; check with a small script and record the ratios.
- Replace every remaining hard-coded color from earlier steps.

### 3.2 Theme switching (`src/ui/theme.ts`)

- Setting `theme`: `"system"` (default), `"light"`, `"dark"`.
- **Follow system:** `matchMedia("(prefers-color-scheme: dark)")` and its
  `change` event switch live, without reload, while the app is open.
- **Title bar:** call Tauri's window `setTheme(null | "light" | "dark")` so
  the native title bar follows (null = system).
- **Control:** a toolbar button showing the current choice's icon (sun /
  moon / monitor) that opens a small menu with the three options, the
  current one checked. Also in the app menu under *View → Theme*, and as
  palette commands (`theme.light`, `theme.dark`, `theme.system`).
- **No flash at startup:** the window background must match the theme
  before the page paints. Rust reads the `theme` setting at startup (and,
  for `system`, the Windows `AppsUseLightTheme` registry value) and sets
  the window background color before showing it; the front end sets
  `data-theme` before the first paint (inline in `index.html` from a value
  Rust passes, or the first thing in `main.ts`).
- Switching re-renders Mermaid diagrams with `default` or `dark` theme
  (FR-MERMAID-04); code highlighting and the editor switch by CSS only.

### 3.3 Headings (FR-STYLE-02)

H1–H6 clearly different in the rendered view: size scale (e.g. 2.0, 1.6,
1.3, 1.15, 1.0 em, 0.9 em uppercase-small for H6), weight, spacing above
and below, a bottom rule on H1 and H2, accent-tinted H1 in the *Document*
style. In the source editor, heading lines are bold with a slightly larger
size for H1–H3.

### 3.4 Rendering styles (FR-STYLE-03)

`src/styles/render/*.css`, each scoped to `.rendered[data-style="…"]`, each
working in both themes:

| Style | Character |
|---|---|
| `github` (default) | Close to GitHub's Markdown look. |
| `document` | Serif body, wider margins, print-like spacing. Never adds heading numbers. |
| `compact` | Smaller spacing and font, for dense technical documents. |

Picker in the toolbar *View* menu and the palette; setting `style`.

### 3.5 Custom styles (FR-STYLE-04)

- Format: **CSS** (decided by the technology, Q7). Files in
  `%APPDATA%\MdTiger\styles\*.css` (or the profile dir in tests). Each file
  appears in the style picker by file name, after the built-in ones.
- A custom style is loaded after the built-in style it names in a first-line
  comment (`/* base: github */`, default `github`), so it only overrides
  what it changes. It applies only to the rendered content
  (`.rendered` scope); document the available tokens and classes in
  `docs/custom-styles.md` with one example (heading colors, fonts, code
  block look, tables).
- The style is re-read when chosen and when the file changes while active
  (watch the folder).
- Remote `@import` and `url(http…)` in custom CSS are blocked by the CSP
  (NFR-03); local fonts via `local()` work. Note it in the doc.
- Command *Open styles folder*.

### 3.6 Fonts, size, width, zoom (FR-STYLE-05)

- Settings: `font.body`, `font.mono`, `font.size` (px), `content.width`
  (px or `"full"`). Defaults: system UI font (Segoe UI), Cascadia Mono /
  Consolas, 16 px, 820 px.
- Zoom of the content (rendered and source, not the toolbar): Ctrl+wheel,
  Ctrl+Plus, Ctrl+Minus, Ctrl+0. On a Hungarian layout `+` is Shift+3 and
  `0` sits left of `1`, so match the typed character (`+`, `-`, `0`) as
  well as the numpad keys (`NumpadAdd`, `NumpadSubtract`, `Numpad0`); range
  50–300 %; shown briefly in the status bar; stored per app (`zoom`).

## 4. Tests

### 4.1 Unit

- Theme resolution: setting × OS preference → applied theme.
- Contrast script (`tools/contrast.mjs`) passes for both token sets; run it
  in `npm test`.
- Custom style parsing of the `base:` comment.

### 4.2 End to end (`tests/e2e/s08-themes.test.mjs`)

1. Default setting is `system`; with CDP
   `Emulation.setEmulatedMedia({features:[{name:"prefers-color-scheme",value:"dark"}]})`
   the app switches to dark live (`data-theme`, body background), and back
   to light when the emulation changes, without reload.
2. Choose *Light* while the OS is dark → stays light; *Dark* while light →
   dark; the menu shows the checked option and the toolbar icon matches.
3. The choice persists across an app restart.
4. Mermaid diagram re-rendered with dark colors after switching (SVG
   background/text color changes).
5. Styles: switching `github` → `document` → `compact` changes H1 computed
   font size/family; headings H1–H6 have strictly decreasing font sizes in
   every style.
6. Custom style: drop `big-headings.css` into the profile styles folder →
   appears in the picker → choosing it changes H1 color; editing the file
   updates it live.
7. Zoom: Ctrl+Plus three times → content font size larger, toolbar
   unchanged; Ctrl+0 resets.
8. No remaining hard-coded colors: a test scans `src/**/*.css|ts` for hex
   / `rgb(` colors outside `tokens.css` and the render style files.
9. Earlier suites still pass.

### 4.3 Manual

- Switch Windows between light and dark (Settings → Personalisation →
  Colors) while MdTiger is open with *Follow system*: content and title bar
  follow within a second.
- Start in dark mode: no white flash.
- Both themes look good with `showcase.md`, including code, tables,
  Mermaid, banners, dialogs and the outline.

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
