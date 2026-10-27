import * as THREE from 'three';
import { MOBILE, BUILDING } from '../config.js';

const REPOSITORY_URL = 'https://github.com/MaskDMoa/predio';

export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches
    || window.matchMedia('(hover: none)').matches;
}

export function watchTouchMode(callback) {
  const queries = ['(pointer: coarse)', '(hover: none)'].map(query => window.matchMedia(query));
  const notify = () => callback(isTouchDevice());
  queries.forEach(query => query.addEventListener('change', notify));
}

export function setupMobileCamera(camera, controls) {
  const totalHeight = BUILDING.floors * BUILDING.floorHeight;
  const totalWidth = BUILDING.unitsPerFloor * BUILDING.unitWidth;
  const aspect = window.innerWidth / window.innerHeight;
  const fovRad = (camera.fov * Math.PI) / 180;
  const heightDist = (totalHeight * 1.4) / (2 * Math.tan(fovRad / 2));
  const widthDist = (totalWidth * 1.2) / (2 * Math.tan(fovRad / 2) * aspect);
  const dist = Math.max(heightDist, widthDist);
  const targetY = totalHeight * 0.4;

  camera.position.set(0, totalHeight * 0.45, BUILDING.unitDepth / 2 + dist);
  camera.lookAt(0, targetY, 0);
  if (controls) {
    controls.target.set(0, targetY, 0);
    controls.enabled = false;
    controls.update();
  }
}

/** Anima a câmera para o apartamento selecionado em desktop e celular. */
export class MobileZoom {
  constructor(camera, apartments, infoPanel, controls = null) {
    this.camera = camera;
    this.apartments = apartments;
    this.infoPanel = infoPanel;
    this.controls = controls;
    this.zoomed = false;
    this.zoomedKey = null;
    this.animating = false;
    this.transition = null;
    this.savedControlsEnabled = controls?.enabled ?? false;
    this.originalPosition = camera.position.clone();
    this.originalTarget = controls?.target.clone() ?? new THREE.Vector3(0, BUILDING.floors * BUILDING.floorHeight * 0.4, 0);
    this.selectedApartment = null;
  }

  zoomTo(key) {
    const apt = this.apartments.get(key);
    if (!apt) return;

    if (!this.zoomed) {
      this.originalPosition.copy(this.camera.position);
      if (this.controls) this.originalTarget.copy(this.controls.target);
      this.savedControlsEnabled = this.controls?.enabled ?? false;
    }

    this.zoomed = true;
    this.zoomedKey = key;
    this.selectedApartment = apt;
    if (this.controls) this.controls.enabled = false;

    const distance = isTouchDevice() ? 13 : 15;
    const visibleWidth = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect;
    const horizontalOffset = visibleWidth * (isTouchDevice() ? 0.32 : 0.22);
    const lookAt = new THREE.Vector3(apt.x + horizontalOffset, apt.y, 0);
    const position = new THREE.Vector3(lookAt.x, lookAt.y, BUILDING.unitDepth / 2 + distance);
    this.animateTo(position, lookAt);
    this.infoPanel.show(apt, key);
  }

  zoomOut() {
    if (!this.zoomed) return;
    this.zoomed = false;
    this.zoomedKey = null;
    this.selectedApartment = null;
    this.infoPanel.hide();
    this.animateTo(this.originalPosition.clone(), this.originalTarget.clone(), true);
  }

  animateTo(position, target, restoreControls = false) {
    this.transition = {
      elapsed: 0,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.12 : Math.max(0.1, MOBILE.zoomDuration / 1000),
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls?.target.clone() ?? this.getLookAt(),
      toPosition: position,
      toTarget: target,
      restoreControls,
    };
    this.animating = true;
  }

  getLookAt() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    return this.camera.position.clone().add(direction.multiplyScalar(10));
  }

  update(dt) {
    if (this.animating && this.transition) {
      const move = this.transition;
      move.elapsed = Math.min(move.elapsed + Math.max(0, dt), move.duration);
      const progress = move.elapsed / move.duration;
      const eased = easeInOutCubic(progress);
      this.camera.position.lerpVectors(move.fromPosition, move.toPosition, eased);
      const target = new THREE.Vector3().lerpVectors(move.fromTarget, move.toTarget, eased);
      if (this.controls) this.controls.target.copy(target);
      this.camera.lookAt(target);

      if (progress >= 1) {
        this.animating = false;
        this.transition = null;
        if (move.restoreControls && this.controls) {
          this.controls.target.copy(this.originalTarget);
          this.controls.enabled = this.savedControlsEnabled;
          this.controls.update();
        }
      }
    }

    if (this.selectedApartment && this.zoomed) {
      const point = new THREE.Vector3(this.selectedApartment.x, this.selectedApartment.y, BUILDING.unitDepth / 2 + 0.1);
      point.project(this.camera);
      const x = (point.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-point.y * 0.5 + 0.5) * window.innerHeight;
      this.infoPanel.updatePosition(x, y);
    }
  }
}

/** Painel lateral com as instruções do apartamento ou o perfil Markdown do morador. */
export class MobileNameOverlay {
  constructor(container, onClose = () => {}) {
    this.onClose = onClose;
    this.requestId = 0;
    this.el = document.createElement('aside');
    this.el.className = 'apartment-info-panel';
    this.el.setAttribute('aria-label', 'Informações do apartamento');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <button class="apartment-info-close" type="button" aria-label="Fechar informações">×</button>
      <div class="apartment-info-content"></div>
    `;
    this.content = this.el.querySelector('.apartment-info-content');
    this.el.querySelector('.apartment-info-close').addEventListener('click', () => this.onClose());
    container.appendChild(this.el);
    this.addStyles();
  }

  addStyles() {
    if (document.getElementById('apartment-info-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'apartment-info-panel-styles';
    style.textContent = `
      .apartment-info-panel{position:fixed;z-index:650;top:50%;right:clamp(12px,4vw,56px);width:clamp(330px,48vw,620px);max-width:calc(100vw - 24px);max-height:min(82vh,760px);overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(235,240,255,.42) transparent;padding:32px 28px 26px;color:#f4f4ff;background:rgba(5,5,16,.94);border:1px solid rgba(255,255,255,.5);box-shadow:0 0 36px rgba(0,0,0,.45),0 0 24px rgba(255,255,255,.08);backdrop-filter:blur(12px);transform:translate(24px,-50%);opacity:0;pointer-events:none;transition:opacity .28s ease,transform .28s ease;font:300 14px/1.65 Inter,system-ui,sans-serif}
      .apartment-info-panel::-webkit-scrollbar{width:8px;height:8px}.apartment-info-panel::-webkit-scrollbar-track{background:transparent}.apartment-info-panel::-webkit-scrollbar-thumb{background:rgba(235,240,255,.34);border:2px solid transparent;border-radius:999px;background-clip:padding-box}.apartment-info-panel::-webkit-scrollbar-thumb:hover{background:rgba(235,240,255,.55);background-clip:padding-box}
      .apartment-info-panel.visible{opacity:1;transform:translate(0,-50%);pointer-events:auto}
      .apartment-info-panel h2{font-size:clamp(18px,2vw,26px);font-weight:300;line-height:1.2;margin:8px 0 12px;overflow-wrap:anywhere}
      .apartment-info-panel h3{font-size:15px;font-weight:400;margin:22px 0 6px}
      .apartment-info-panel p{margin:8px 0;color:rgba(244,244,255,.8)}
      .apartment-info-panel a{color:#fff;text-decoration:underline;text-underline-offset:3px}
      .apartment-info-panel .apartment-number{letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:rgba(244,244,255,.65)}
      .apartment-info-close{position:sticky;float:right;top:0;margin:-20px -16px 4px 8px;border:0;background:transparent;color:#fff;font-size:28px;font-weight:200;line-height:1;cursor:pointer}
      .apartment-info-panel ol{padding-left:20px;color:rgba(244,244,255,.82)}
      .apartment-info-panel li{padding:2px 0}
      .apartment-info-panel .repo-link{display:inline-block;margin-top:8px;padding:8px 12px;border:1px solid rgba(255,255,255,.38);text-decoration:none}
      .profile-form{display:flex;gap:6px;margin:8px 0 12px}
      .profile-form input{min-width:0;flex:1;padding:8px 9px;color:white;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.28);font:inherit}
      .profile-form button{padding:7px 9px;color:white;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);font:inherit;cursor:pointer}
      .profile-readme{font-size:12px;overflow-wrap:anywhere}
      .profile-readme h1,.profile-readme h2,.profile-readme h3{margin:16px 0 7px;font-weight:400}
      .profile-readme img{max-width:100%;height:auto}.profile-readme table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.profile-readme th,.profile-readme td{padding:4px 7px;border:1px solid rgba(255,255,255,.2)}.profile-readme pre{white-space:pre-wrap;padding:8px;background:rgba(255,255,255,.06);overflow-wrap:anywhere}
      .profile-readme code{font-family:ui-monospace,monospace;background:rgba(255,255,255,.08);padding:1px 3px}
      @media(max-width:700px){.apartment-info-panel{right:8px;width:clamp(240px,62vw,420px);min-width:0;max-width:calc(100vw - 16px);max-height:76vh;padding:26px 12px 16px;font-size:11px;line-height:1.5}.apartment-info-panel h2{font-size:17px}.apartment-info-panel h3{font-size:12px;margin-top:14px}.apartment-info-close{margin:-17px -7px 2px 4px;font-size:24px}.apartment-info-panel .repo-link{padding:6px 7px}.profile-form{flex-direction:column}.profile-form button{align-self:flex-start}}
      @media(prefers-reduced-motion:reduce){.apartment-info-panel{transition:none}}
    `;
    document.head.appendChild(style);
  }

  show(apt, key) {
    this.requestId++;
    this.el.style.borderColor = apt.lit && validColor(apt.color) ? apt.color : 'rgba(255,255,255,.55)';
    const apartmentNumber = `${apt.floor}${String(apt.position).padStart(2, '0')}`;
    this.el.setAttribute('aria-hidden', 'false');
    this.el.classList.add('visible');

    if (apt.lit && apt.morador) {
      this.content.innerHTML = `
        <div class="apartment-number">Apartamento ${apartmentNumber}</div>
        <h2>${escapeHtml(apt.morador.nome)}</h2>
        <p>Este apartamento já tem morador.</p>
        <h3>Seu perfil do GitHub</h3>
        <p>Informe seu usuário para mostrar aqui o README do repositório de perfil.</p>
        <form class="profile-form">
          <input name="github-user" autocomplete="url" aria-label="Usuário do GitHub" placeholder="usuário do GitHub">
          <button type="submit">Carregar perfil</button>
        </form>
        <div class="profile-readme" aria-live="polite"></div>
      `;
      const form = this.content.querySelector('.profile-form');
      form.addEventListener('submit', event => {
        event.preventDefault();
        const username = form.elements['github-user'].value.trim().replace(/^@/, '');
        this.loadProfile(username, form.nextElementSibling);
      });
    } else {
      this.content.innerHTML = `
        <div class="apartment-number">Apartamento ${apartmentNumber}</div>
        <h2>Este apartamento está vazio</h2>
        <p>Adicione seu apartamento ao projeto e abra um Pull Request para entrar no prédio.</p>
        <ol>
          <li>Faça um fork do repositório e crie uma branch.</li>
          <li>Crie <code>apartamentos/seu-nome/seu-nome.json</code>.</li>
          <li>Informe <code>nome</code>, este número (<code>${apartmentNumber}</code>) e uma cor <code>corLuz</code> em hexadecimal.</li>
          <li>Envie a branch e abra um Pull Request para revisão.</li>
        </ol>
        <a class="repo-link" href="${REPOSITORY_URL}/pulls" target="_blank" rel="noopener noreferrer">Abrir Pull Request no GitHub</a>
        <p><a href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">Ver repositório e instruções</a></p>
      `;
    }
  }

  async loadProfile(username, output) {
    const requestId = ++this.requestId;
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
      output.textContent = 'Digite um nome de usuário válido do GitHub.';
      return;
    }
    output.textContent = 'Carregando README do perfil…';
    for (const branch of ['main', 'master']) {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(username)}/${encodeURIComponent(username)}/${branch}/README.md`);
        if (!response.ok) continue;
        const markdown = await response.text();
        if (requestId !== this.requestId || !this.el.classList.contains('visible')) return;
        output.innerHTML = sanitizeProfileHtml(renderMarkdown(markdown), `https://raw.githubusercontent.com/${username}/${username}/${branch}/`);
        attachImageFallbacks(output);
        return;
      } catch {
        // Tenta a branch principal alternativa; a falha final é mostrada abaixo.
      }
    }
    if (requestId === this.requestId) {
      output.textContent = 'Não encontrei um README.md público neste perfil. Confira o usuário e tente novamente.';
    }
  }

  updatePosition() {}

  hide() {
    this.requestId++;
    this.el.classList.remove('visible');
    this.el.setAttribute('aria-hidden', 'true');
  }

  dispose() {
    this.requestId++;
    this.el.remove();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function validColor(value) {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value);
}

function renderInline(markdown) {
  const tags = [];
  const entities = [];
  const protectedMarkdown = markdown
    .replace(/<\/?[a-z][^>]*>/gi, tag => `\uE000${tags.push(tag) - 1}\uE001`)
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|copy|reg|trade|#\d+|#x[\da-f]+);/gi, entity => `\uE100${entities.push(entity) - 1}\uE101`);

  let html = escapeHtml(protectedMarkdown);
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\uE000(\d+)\uE001/g, (_, index) => tags[Number(index)]);
  html = html.replace(/\uE100(\d+)\uE101/g, (_, index) => entities[Number(index)]);
  return html;
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = false;
  let code = false;
  let codeLines = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) blocks.push('</ul>');
    list = false;
  };
  const tableCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (/^\s*```/.test(line)) {
      flushParagraph(); closeList();
      if (code) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
      }
      code = !code;
      continue;
    }
    if (code) { codeLines.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) { flushParagraph(); closeList(); blocks.push('<hr>'); continue; }

    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[lineIndex + 1] ?? '')) {
      flushParagraph(); closeList();
      const headers = tableCells(line);
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim() && lines[lineIndex].includes('|')) {
        rows.push(tableCells(lines[lineIndex]));
        lineIndex++;
      }
      lineIndex--;
      const head = headers.map(cell => `<th>${renderInline(cell)}</th>`).join('');
      const body = rows.map(row => `<tr>${headers.map((_, index) => `<td>${renderInline(row[index] ?? '')}</td>`).join('')}</tr>`).join('');
      blocks.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = heading[1].length; blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`); continue; }
    const item = line.match(/^\s*[-*+]\s+(.+)$/);
    if (item) { flushParagraph(); if (!list) { blocks.push('<ul>'); list = true; } blocks.push(`<li>${renderInline(item[1].replace(/^\[[ xX]\]\s+/, ''))}</li>`); continue; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushParagraph(); closeList(); blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`); continue; }
    closeList(); paragraph.push(line);
  }
  flushParagraph(); closeList();
  if (code) blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return blocks.join('');
}

function sanitizeProfileHtml(html, baseUrl) {
  const allowedTags = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CENTER', 'CODE', 'DEL', 'DETAILS', 'DIV', 'EM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'KBD', 'LI', 'OL',
    'P', 'PRE', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUMMARY', 'SUP',
    'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL', 'VAR'
  ]);
  const allowedAttributes = new Set([
    'alt', 'align', 'colspan', 'height', 'href', 'loading', 'open', 'rel', 'rowspan',
    'src', 'target', 'title', 'width'
  ]);
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'MATH', 'LINK', 'META', 'BASE']);

  const cleanNode = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      if (blockedTags.has(tag)) { child.remove(); continue; }
      if (!allowedTags.has(tag)) {
        cleanNode(child);
        child.replaceWith(...child.childNodes);
        continue;
      }

      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || !allowedAttributes.has(name)) {
          child.removeAttribute(attribute.name);
          continue;
        }
        if (name === 'href' || name === 'src') {
          try {
            const url = new URL(attribute.value, baseUrl);
            const protocols = name === 'href' ? ['https:', 'http:', 'mailto:'] : ['https:', 'http:'];
            if (!protocols.includes(url.protocol) || (name === 'src' && url.protocol !== 'https:')) {
              child.removeAttribute(attribute.name);
            } else {
              child.setAttribute(attribute.name, url.href);
            }
          } catch {
            child.removeAttribute(attribute.name);
          }
        } else if ((name === 'width' || name === 'height') && !/^\d{1,4}%?$/.test(attribute.value)) {
          child.removeAttribute(attribute.name);
        } else if ((name === 'colspan' || name === 'rowspan') && !/^\d{1,2}$/.test(attribute.value)) {
          child.removeAttribute(attribute.name);
        } else if (name === 'align' && !/^(left|center|right)$/i.test(attribute.value)) {
          child.removeAttribute(attribute.name);
        }
      }

      if (tag === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (tag === 'IMG') {
        child.setAttribute('loading', 'lazy');
        child.setAttribute('referrerpolicy', 'no-referrer');
      }
      cleanNode(child);
    }
  };

  cleanNode(documentNode.body);
  return documentNode.body.innerHTML;
}

function attachImageFallbacks(container) {
  container.querySelectorAll('img').forEach(image => {
    image.addEventListener('error', () => {
      const link = document.createElement('a');
      link.href = image.currentSrc || image.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = image.alt ? `Imagem indispon\u00EDvel: ${image.alt}` : 'Abrir imagem do perfil';
      image.replaceWith(link);
    }, { once: true });
  });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}