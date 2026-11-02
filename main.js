const { Plugin, MarkdownView, MarkdownRenderChild, Modal, Notice, setIcon, debounce } = require('obsidian');

const FOLDER = 'AP Scripts';
const BOARD = 'AP Scripts/Short-Form Board.md';
const HOME = 'AP Scripts/Home.md'; // pinned to the top of AP Scripts, opens in reading view
// Hidden from the file explorer (they live on Home instead)
const HIDDEN = ['AP Scripts/Home Workbench.base', 'AP Scripts/Home Library.base',
  'AP Scripts/Short-Form Workbench.base', 'AP Scripts/Short-Form Library.base',
  'AP Scripts/Views', BOARD];
const SCRIPT_FOLDERS = ['AP Scripts/Short-Form/', 'AP Scripts/Long-Form/'];
const SF_HOME = 'AP Scripts/Short-Form/Short-Form Home.md'; // pinned to the top of Short-Form
const DASHBOARDS = [HOME, SF_HOME];
// Which scripts each dashboard counts and lists
const SCOPES = { [HOME]: SCRIPT_FOLDERS, [SF_HOME]: ['AP Scripts/Short-Form/'] };
// Folder path -> items pinned to the top of it in the file explorer, in order
const PINS = {
  'AP Scripts': [HOME, 'AP Scripts/Short-Form'],
  'AP Scripts/Short-Form': [SF_HOME],
};
const STAGES = {
  'Ideas': ['Ideas', 'Ideating', 'Not started'],
  'Scripting': ['Scripting', 'In progress'],
  'Ready to film': ['Ready to Film'],
  'Needs edit': ['Filmed: Ready to Edit'],
  'Posted': ['Edited: Ready to Post', 'Ready to Post'],
};


const NEW_SCRIPT_FOLDER = 'AP Scripts/Short-Form';

function parseBoard(text) {
  const body = text.split('%% kanban:settings')[0];
  const lanes = {};
  let current = null;
  for (const line of body.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { current = h[1]; lanes[current] = []; continue; }
    if (/^\*\*\*/.test(line)) { current = null; continue; }
    const m = current && line.match(/^- \[[ xX]\]\s+(.*)$/);
    if (!m) continue;
    const raw = m[1];
    const l = raw.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/);
    const label = raw.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/[*_`]/g, '').trim();
    lanes[current].push({ label, link: l ? l[1].trim() : null });
  }
  return lanes;
}

function relTime(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(ms).toLocaleDateString();
}

function statusSlug(st) {
  for (const k in STAGES) if (STAGES[k].includes(st)) return k.toLowerCase().replace(/\s+/g, '-');
  return 'other';
}

class RecentView extends MarkdownRenderChild {
  constructor(el, plugin, count, folders, sourcePath) {
    super(el);
    this.plugin = plugin;
    this.app = plugin.app;
    this.n = count;
    this.folders = folders;
    this.sourcePath = sourcePath;
    this.hoverPopover = null;
    this.refresh = debounce(() => this.render(), 1000, true);
  }
  onload() {
    this.render();
    this.registerEvent(this.app.vault.on('modify', () => this.refresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refresh()));
  }
  render() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      if (!this.folders.some((p) => f.path.startsWith(p))) return false;
      if (/ Board$/.test(f.basename) || DASHBOARDS.includes(f.path)) return false;
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      return ![].concat(fm.tags || []).includes('hub');
    }).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, this.n);
    const el = this.containerEl;
    el.empty();
    el.addClass('ap-recent-panel');
    const head = el.createDiv({ cls: 'ap-lane-head' });
    head.createSpan({ cls: 'ap-lane-pill', text: 'Recently edited' });
    head.createSpan({ cls: 'ap-lane-count', text: String(files.length) });
    const grid = el.createDiv({ cls: 'ap-recent-grid' });
    for (const f of files) {
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      const card = grid.createDiv({ cls: 'ap-card ap-card-rich' });
      card.tabIndex = 0;
      const icon = card.createSpan({ cls: 'ap-card-icon' });
      setIcon(icon, 'file-text');
      const body = card.createDiv({ cls: 'ap-card-body' });
      body.createDiv({ cls: 'ap-card-title', text: f.basename });
      const meta = body.createDiv({ cls: 'ap-card-meta' });
      if (fm.status) meta.createSpan({ cls: 'ap-status ap-status-' + statusSlug(fm.status), text: String(fm.status) });
      meta.createSpan({ cls: 'ap-card-time', text: relTime(f.stat.mtime) });
      const open = () => this.app.workspace.getLeaf('tab').openFile(f);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      card.addEventListener('mouseover', (event) => {
        this.app.workspace.trigger('hover-link', {
          event, source: 'ap-board', hoverParent: this, targetEl: card, linktext: f.path, sourcePath: this.sourcePath,
        });
      });
    }
  }
}

class NewScriptModal extends Modal {
  constructor(app, lane, onSubmit) { super(app); this.lane = lane; this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ap-new-script');
    contentEl.createEl('h3', { text: 'New script in ' + this.lane });
    const input = contentEl.createEl('input', { type: 'text', placeholder: 'Script title' });
    input.style.width = '100%';
    const btn = contentEl.createEl('button', { text: 'Create script', cls: 'mod-cta' });
    btn.style.marginTop = '12px';
    const go = () => { const t = input.value.trim(); if (!t) return; this.close(); this.onSubmit(t); };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => input.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

class BoardView extends MarkdownRenderChild {
  constructor(el, plugin, laneNames) {
    super(el);
    this.plugin = plugin;
    this.app = plugin.app;
    this.laneNames = laneNames;
    this.hoverPopover = null;
  }
  onload() {
    this.render();
    this.registerEvent(this.app.vault.on('modify', (f) => { if (f.path === BOARD) this.render(); }));
  }
  async render() {
    const el = this.containerEl;
    const file = this.app.vault.getAbstractFileByPath(BOARD);
    el.empty();
    el.addClass('ap-board');
    if (!file) { el.setText('Short-Form Board not found. Check that it is still in AP Scripts.'); return; }
    const lanes = parseBoard(await this.app.vault.read(file));
    for (const name of this.laneNames) {
      const items = lanes[name] || [];
      const col = el.createDiv({ cls: 'ap-lane' });
      col.dataset.lane = name;
      const head = col.createDiv({ cls: 'ap-lane-head' });
      head.createSpan({ cls: 'ap-lane-pill', text: name });
      head.createSpan({ cls: 'ap-lane-count', text: String(items.length) });
      const list = col.createDiv({ cls: 'ap-lane-cards' });
      for (const it of items) {
        const card = list.createDiv({ cls: 'ap-card' });
        card.tabIndex = 0;
        const icon = card.createSpan({ cls: 'ap-card-icon' });
        setIcon(icon, 'file-text');
        card.createSpan({ cls: 'ap-card-title', text: it.label });
        const open = () => this.app.workspace.openLinkText(it.link || BOARD, BOARD, 'tab');
        card.addEventListener('click', open);
        if (it.link) {
          card.addEventListener('mouseover', (event) => {
            this.app.workspace.trigger('hover-link', {
              event, source: 'ap-board', hoverParent: this, targetEl: card,
              linktext: it.link, sourcePath: BOARD,
            });
          });
        }
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      }
      const add = col.createDiv({ cls: 'ap-card ap-card-new' });
      add.tabIndex = 0;
      const plus = add.createSpan({ cls: 'ap-card-icon' });
      setIcon(plus, 'plus');
      add.createSpan({ text: 'New script' });
      const ask = () => new NewScriptModal(this.app, name, (t) => this.plugin.createScript(t, name)).open();
      add.addEventListener('click', ask);
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
    }
  }
}

module.exports = class APBoardTweaks extends Plugin {
  onload() {
    // 1) Links clicked inside the Short-Form Board open in a new tab
    this.registerDomEvent(document, 'click', (evt) => {
      const a = evt.target && evt.target.closest && evt.target.closest('a.internal-link');
      if (!a || evt.button !== 0) return;
      const leaf = this.app.workspace.getLeavesOfType('kanban')
        .find((l) => l.view && l.view.containerEl.contains(a));
      if (!leaf || !leaf.view.file || leaf.view.file.path !== BOARD) return;
      const href = a.getAttribute('data-href') || a.getAttribute('href');
      if (!href) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      this.app.workspace.openLinkText(href, BOARD, 'tab');
    }, true);

    // Hover previews on Home board cards, no modifier key needed
    this.registerHoverLinkSource('ap-board', { display: 'AP Home board', defaultMod: false });

    // 1b) ```ap-board``` block: live copy of Short-Form Board lanes
    this.registerMarkdownCodeBlockProcessor('ap-board', (src, el, ctx) => {
      const names = src.split('\n').map((l) => l.trim()).filter(Boolean);
      ctx.addChild(new BoardView(el, this, names.length ? names : ['Ideas', 'Scripting', 'Ready to Film']));
    });

    // 1c) ```ap-recent``` block: last edited scripts as board-style cards
    this.registerMarkdownCodeBlockProcessor('ap-recent', (src, el, ctx) => {
      const n = parseInt(src.trim(), 10) || 10;
      ctx.addChild(new RecentView(el, this, n, SCOPES[ctx.sourcePath] || SCRIPT_FOLDERS, ctx.sourcePath));
    });

    // 2) Live counts on the Home pipeline and browse shelves
    this.registerMarkdownPostProcessor((el, ctx) => {
      const folders = SCOPES[ctx.sourcePath];
      if (!folders) return;
      el.querySelectorAll('.callout[data-callout="ap-pipeline"] a.internal-link').forEach((a) => {
        const stage = a.textContent.trim();
        const statuses = STAGES[stage];
        if (!statuses) return;
        const n = this.count((fm) => statuses.includes(fm.status), folders);
        a.empty();
        a.createSpan({ cls: 'ap-count', text: String(n) });
        a.createSpan({ cls: 'ap-stage', text: stage });
      });
      el.querySelectorAll('.callout[data-callout="ap-shelf"]').forEach((c) => {
        const title = (c.querySelector('.callout-title-inner') || {}).textContent || '';
        let test = null;
        if (/products/i.test(title)) test = (fm, name) => fm.product === name;
        else if (/countries/i.test(title)) test = (fm, name) => [].concat(fm.country || []).includes(name);
        if (!test) return;
        c.querySelectorAll('a.internal-link').forEach((a) => {
          const name = a.textContent.trim();
          const n = this.count((fm) => test(fm, name), folders);
          a.createSpan({ cls: 'ap-shelf-count', text: String(n) });
        });
      });
    });

    // 3) Home opens in reading view so the layout never shows raw markup
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (file && DASHBOARDS.includes(file.path)) setTimeout(() => this.toReading(), 0);
    }));

    // 4) File explorer: hide helpers, pin each dashboard to the top of its folder
    this.app.workspace.onLayoutReady(() => { this.patchExplorer(); this.toReading(); });
  }

  async createScript(title, lane) {
    const clean = title.replace(/[\\/:*?"<>|#^\[\]]/g, '').trim();
    if (!clean) return;
    const path = NEW_SCRIPT_FOLDER + '/' + clean + '.md';
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      new Notice('A script called "' + clean + '" already exists. Opening it.');
    } else {
      file = await this.app.vault.create(path,
        '---\nformat: Short-Form\nstatus: "' + lane + '"\nhas_script: false\ntags:\n  - type/short-form\n---\n\n# ' + clean + '\n\n');
      const board = this.app.vault.getAbstractFileByPath(BOARD);
      if (board) {
        await this.app.vault.process(board, (text) => {
          const lines = text.split('\n');
          const h = lines.findIndex((l) => l.trim() === '## ' + lane);
          if (h < 0) return text;
          let at = h + 1;
          for (let i = h + 1; i < lines.length; i++) {
            if (/^## |^\*\*\*|^%%/.test(lines[i])) break;
            if (/^- \[/.test(lines[i])) at = i + 1;
          }
          if (at === h + 1) { lines.splice(at, 0, '', '- [ ] [[' + clean + ']]'); }
          else lines.splice(at, 0, '- [ ] [[' + clean + ']]');
          return lines.join('\n');
        });
      }
      new Notice('Added "' + clean + '" to ' + lane + '.');
    }
    this.app.workspace.getLeaf('tab').openFile(file);
  }

  count(pred, folders = SCRIPT_FOLDERS) {
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!folders.some((p) => f.path.startsWith(p)) || DASHBOARDS.includes(f.path)) continue;
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (fm && pred(fm)) n++;
    }
    return n;
  }

  toReading() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file || !DASHBOARDS.includes(view.file.path) || view.getMode() === 'preview') return;
    const state = view.leaf.getViewState();
    state.state = Object.assign({}, state.state, { mode: 'preview' });
    view.leaf.setViewState(state);
  }

  patchExplorer() {
    const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (!leaf) return;
    const view = leaf.view;
    const proto = Object.getPrototypeOf(view);
    if (typeof proto.getSortedFolderItems !== 'function') {
      console.warn('AP Board Tweaks: file explorer sort hook not found');
      return;
    }
    const orig = proto.getSortedFolderItems;
    proto.getSortedFolderItems = function (folder, ...args) {
      const items = orig.call(this, folder, ...args);
      const pin = folder && PINS[folder.path];
      if (pin && Array.isArray(items)) {
        const kept = items.filter((it) => !(it && it.file && HIDDEN.includes(it.file.path)));
        for (const p of [...pin].reverse()) {
          const h = kept.findIndex((it) => it && it.file && it.file.path === p);
          if (h > 0) kept.unshift(kept.splice(h, 1)[0]);
        }
        return kept;
      }
      return items;
    };
    this.register(() => { proto.getSortedFolderItems = orig; view.requestSort && view.requestSort(); });
    view.requestSort && view.requestSort();
  }
};
