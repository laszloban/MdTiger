// Mermaid is loaded only when a document contains a mermaid block, so it
// never affects startup for documents without diagrams (NFR-01).

type MermaidApi = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidApi> | null = null;
let counter = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      m.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
      return m.default;
    });
  }
  return mermaidPromise;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block[data-state="pending"]'));
  if (!blocks.length) return;
  const mermaid = await loadMermaid();
  for (const block of blocks) {
    block.dataset.state = "rendering";
    const source = block.querySelector("code")?.textContent ?? "";
    block.dataset.source = source;
    const tools = `<div class="mermaid-tools"><button type="button" class="mermaid-toggle" tabindex="-1">Source</button><button type="button" class="copy-btn" tabindex="-1" title="Copy Mermaid source">Copy</button></div>`;
    try {
      const { svg } = await mermaid.render(`mmd-${++counter}`, source);
      block.innerHTML = `${tools}<div class="mermaid-svg">${svg}</div><div class="code-block mermaid-source" hidden><pre><code>${esc(source)}</code></pre></div>`;
      block.dataset.state = "done";
    } catch (e) {
      // FR-MERMAID-02: show the error and the source; the rest keeps rendering.
      const msg = e instanceof Error ? e.message : String(e);
      block.innerHTML = `${tools}<div class="mermaid-error">Mermaid error: ${esc(msg)}</div><div class="code-block mermaid-source"><pre><code>${esc(source)}</code></pre></div>`;
      block.dataset.state = "error";
      // mermaid.render can leave an error SVG in <body>; remove it.
      document.querySelectorAll(`#dmmd-${counter}, #mmd-${counter}`).forEach((n) => n.remove());
    }
  }
}
