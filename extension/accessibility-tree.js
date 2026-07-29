// accessibility-tree.js - DOM-based accessibility tree with ref_N addressing.
// Runs in ISOLATED world (declared in manifest.json content_scripts).
// Exposes globalThis.__qoderAccessibilityTree for cross-script use.
//
// Modeled after QoderWork's accessibility-tree.js:
//   - ref_N addressing with WeakRef<Element> storage
//   - Role inference from HTML tags
//   - Name resolution: aria-label > aria-labelledby > title > placeholder > textContent
//   - Interactive element filtering
//   - Truncation support (max_chars limit)

(function () {
  if (globalThis.__qoderAccessibilityTree) return;

  const elementMap = new Map();
  const elementWeakMap = new WeakMap();
  let counter = 1;

  function getRef(el) {
    const existing = elementWeakMap.get(el);
    if (existing && elementMap.get(existing)?.deref() === el) return existing;
    const ref = `ref_${counter++}`;
    elementMap.set(ref, new WeakRef(el));
    elementWeakMap.set(el, ref);
    return ref;
  }

  function getByRef(ref) {
    return elementMap.get(ref)?.deref() || null;
  }

  function inferRole(el) {
    const attr = el.getAttribute('role');
    if (attr) return attr;

    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'a': return 'link';
      case 'button': return 'button';
      case 'input': {
        const type = (el.type || 'text').toLowerCase();
        switch (type) {
          case 'text': case 'email': case 'password': case 'tel': case 'url': return 'textbox';
          case 'search': return 'searchbox';
          case 'checkbox': return 'checkbox';
          case 'radio': return 'radio';
          case 'range': return 'slider';
          case 'number': return 'spinbutton';
          case 'file': case 'submit': case 'reset': return 'button';
          default: return 'textbox';
        }
      }
      case 'select': return 'combobox';
      case 'textarea': return 'textbox';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'img': return 'image';
      case 'ul': case 'ol': return 'list';
      case 'li': return 'listitem';
      case 'table': return 'table';
      case 'tr': return 'row';
      case 'td': case 'th': return 'cell';
      case 'form': return 'form';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'article': return 'article';
      case 'header': return 'header';
      case 'footer': return 'footer';
      default:
        if (el.onclick || el.onmousedown || el.onmouseup) return 'button';
        return '';
    }
  }

  function getName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const refEl = document.getElementById(labelledBy);
      if (refEl) return refEl.textContent.trim().slice(0, 100);
    }

    const title = el.getAttribute('title');
    if (title) return title.trim();

    if (el.placeholder) return el.placeholder.trim().slice(0, 100);

    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' ||
        ['H1','H2','H3','H4','H5','H6'].includes(tag) ||
        (tag === 'LABEL' && el.control)) {
      return el.textContent.trim().slice(0, 100);
    }

    if (tag === 'IMG') return (el.alt || '').trim().slice(0, 100);

    const role = el.getAttribute('role');
    if (role && ['heading','listitem','article','status','alert','tooltip'].includes(role)) {
      return el.textContent.trim().slice(0, 100);
    }

    return '';
  }

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox',
    'checkbox', 'radio', 'slider', 'spinbutton',
    'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'tab', 'switch',
  ]);

  function isInteractive(el) {
    return INTERACTIVE_ROLES.has(inferRole(el));
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function generate(options = {}) {
    const { filter = 'interactive', maxDepth = 15, maxChars = 50000, refId = null } = options;

    let root = document.body;
    if (refId) {
      root = getByRef(refId);
      if (!root) return { tree: `[Error] Element not found: ${refId}`, elementCount: 0 };
    }

    const lines = [];
    let totalChars = 0;
    let truncated = false;
    let lastRef = null;

    function walk(el, depth) {
      if (truncated || (filter !== 'interactive' && depth > maxDepth)) return;
      if (!isVisible(el)) return;

      const role = inferRole(el);
      if (filter === 'interactive' && !role) {
        for (const child of el.children) walk(child, depth);
        return;
      }
      if (filter !== 'interactive' && !role) {
        for (const child of el.children) walk(child, depth + 1);
        return;
      }

      const ref = getRef(el);
      const name = getName(el);
      const indent = '  '.repeat(Math.min(depth, 10));

      let line = `${indent}[${ref}] ${role}`;
      if (name) line += ` "${name}"`;

      const attrs = [];
      if (el.disabled) attrs.push('disabled');
      if (el.checked !== undefined && el.type !== 'radio') {
        attrs.push(el.checked ? 'checked' : 'unchecked');
      }
      if (el.readOnly) attrs.push('readonly');
      if (el.required) attrs.push('required');
      if (el.tagName === 'SELECT') attrs.push(`options=${el.options.length}`);
      if (attrs.length > 0) line += ` (${attrs.join(', ')})`;

      if (totalChars + line.length > maxChars) {
        truncated = true;
        lines.push(`\n[TRUNCATED: output limit reached at ${ref}. Some elements are not shown.]`);
        lines.push(`[To see more: use ref_id="${lastRef}" to focus on a subtree, or increase max_chars beyond ${maxChars}.]`);
        return;
      }

      lines.push(line);
      totalChars += line.length + 1;
      lastRef = ref;

      for (const child of el.children) walk(child, depth + 1);
    }

    walk(root, 0);

    return {
      tree: (truncated ? '[Warning: output was truncated]\n' : '') + lines.join('\n'),
      elementCount: elementMap.size,
      truncated,
    };
  }

  function getElementCoordinates(ref, options = {}) {
    const el = getByRef(ref);
    if (!el) return null;
    if (options.scrollIntoView) {
      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
    }
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  }

  globalThis.__qoderAccessibilityTree = {
    generate,
    getElementCoordinates,
    getElementByRef: getByRef,
    getRefForElement: getRef,
    elementMap,
    get elementCount() { return elementMap.size; },
  };
})();
