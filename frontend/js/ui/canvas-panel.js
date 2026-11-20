/**
 * CanvasPanel — Renders the right-hand Dynamic Page.
 *
 * CUSTOMIZATION GUIDE:
 * Add new visual modes inside `render(payload)` (e.g., 'product_cards', 'booking_form',
 * 'chart', 'map') and trigger them from `backend/live/tools.py` via `emit_canvas(...)`.
 */
export class CanvasPanel {
  constructor(containerEl, badgeEl, resetBtnEl, { onSuggestionClick }) {
    this.container = containerEl;
    this.badgeEl = badgeEl;
    this.resetBtnEl = resetBtnEl;
    this.onSuggestionClick = onSuggestionClick;

    this.resetBtnEl?.addEventListener("click", () => this.renderWelcome());
    this.renderWelcome();
  }

  render(payload) {
    if (!payload || payload.mode === "welcome") {
      this.renderWelcome();
      return;
    }

    switch (payload.mode) {
      case "loading":
        this._renderLoading(payload);
        break;
      case "search":
        this._renderSearch(payload);
        break;
      case "structured":
        this._renderStructured(payload);
        break;
      default:
        this.renderWelcome();
    }
  }

  renderWelcome() {
    this._setHeader("Halaman Utama", false);

    const suggestions = [
      "Cari berita teknologi AI terbaru hari ini",
      "Rekomendasi kafe kerja nyaman di Jakarta Selatan",
      "Buatkan ringkasan ide liburan akhir pekan di Bandung",
      "Bagaimana cuaca di Jakarta hari ini?",
    ];

    this.container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "canvas-welcome";

    const wave = document.createElement("div");
    wave.className = "welcome-greeting-mark";
    wave.textContent = "Halo!";

    const title = document.createElement("h2");
    title.className = "welcome-title";
    title.textContent = "Ada yang bisa saya bantu hari ini?";

    const desc = document.createElement("p");
    desc.className = "welcome-desc";
    desc.textContent =
      "Silakan langsung berbicara dalam Bahasa Indonesia. Anda bisa memotong pembicaraan kapan saja secara natural. Hasil pencarian atau ringkasan diskusi akan otomatis tampil di sini.";

    const suggestionsSection = document.createElement("div");
    suggestionsSection.className = "welcome-suggestions";

    const label = document.createElement("div");
    label.className = "welcome-suggestions__label";
    label.textContent = "Coba tanyakan atau klik topik:";
    suggestionsSection.appendChild(label);

    const grid = document.createElement("div");
    grid.className = "suggestion-grid";

    suggestions.forEach((text) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestion-chip";
      btn.textContent = text;
      btn.addEventListener("click", () => this.onSuggestionClick?.(text));
      grid.appendChild(btn);
    });

    suggestionsSection.appendChild(grid);

    wrapper.appendChild(wave);
    wrapper.appendChild(title);
    wrapper.appendChild(desc);
    wrapper.appendChild(suggestionsSection);
    this.container.appendChild(wrapper);
  }

  _renderLoading(payload) {
    this._setHeader("Pencarian Web", true);
    this.container.innerHTML = "";

    const box = document.createElement("div");
    box.className = "canvas-loading";

    const spinner = document.createElement("div");
    spinner.className = "spinner";

    const title = document.createElement("h3");
    title.textContent = payload.title || "Mencari informasi...";

    const query = document.createElement("p");
    query.className = "canvas-loading__query";
    query.textContent = payload.query ? `“${payload.query}”` : "";

    box.appendChild(spinner);
    box.appendChild(title);
    box.appendChild(query);
    this.container.appendChild(box);
  }

  _renderSearch(payload) {
    this._setHeader("Hasil Pencarian", true);
    this.container.innerHTML = "";

    const view = document.createElement("div");
    view.className = "canvas-document";

    // Header
    const header = document.createElement("div");
    header.className = "canvas-doc__header";

    const title = document.createElement("h2");
    title.className = "canvas-doc__title";
    title.textContent = payload.title || "Hasil Pencarian";
    header.appendChild(title);

    if (Array.isArray(payload.queries) && payload.queries.length > 0) {
      const chips = document.createElement("div");
      chips.className = "query-chips";
      payload.queries.forEach((q) => {
        const chip = document.createElement("span");
        chip.className = "query-chip";
        chip.textContent = q;
        chips.appendChild(chip);
      });
      header.appendChild(chips);
    }

    view.appendChild(header);

    // Summary Card
    const summaryCard = document.createElement("section");
    summaryCard.className = "canvas-card";
    const summaryBody = document.createElement("div");
    summaryBody.className = "canvas-prose";
    this._appendFormattedText(summaryBody, payload.summary || "");
    summaryCard.appendChild(summaryBody);
    view.appendChild(summaryCard);

    // Sources
    if (Array.isArray(payload.sources) && payload.sources.length > 0) {
      const sourcesSection = document.createElement("section");
      sourcesSection.className = "sources-section";

      const sourcesTitle = document.createElement("h3");
      sourcesTitle.className = "sources-section__title";
      sourcesTitle.textContent = `Sumber Referensi (${payload.sources.length})`;
      sourcesSection.appendChild(sourcesTitle);

      const sourcesGrid = document.createElement("div");
      sourcesGrid.className = "sources-grid";

      payload.sources.forEach((src) => {
        const link = document.createElement("a");
        link.className = "source-card";
        link.href = src.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        const domain = document.createElement("span");
        domain.className = "source-card__domain";
        domain.textContent = src.domain || "Web";

        const srcTitle = document.createElement("span");
        srcTitle.className = "source-card__title";
        srcTitle.textContent = src.title || src.url;

        link.appendChild(domain);
        link.appendChild(srcTitle);
        sourcesGrid.appendChild(link);
      });

      sourcesSection.appendChild(sourcesGrid);
      view.appendChild(sourcesSection);
    }

    this.container.appendChild(view);
  }

  _renderStructured(payload) {
    const categoryMap = {
      info: "Ringkasan",
      steps: "Panduan Langkah",
      comparison: "Perbandingan",
      notes: "Catatan Diskusi",
    };
    this._setHeader(categoryMap[payload.category] || "Ringkasan Diskusi", true);
    this.container.innerHTML = "";

    const view = document.createElement("div");
    view.className = "canvas-document";

    const header = document.createElement("div");
    header.className = "canvas-doc__header";

    const title = document.createElement("h2");
    title.className = "canvas-doc__title";
    title.textContent = payload.title || "Ringkasan";
    header.appendChild(title);

    if (payload.subtitle) {
      const subtitle = document.createElement("p");
      subtitle.className = "canvas-doc__subtitle";
      subtitle.textContent = payload.subtitle;
      header.appendChild(subtitle);
    }
    view.appendChild(header);

    if (payload.summary) {
      const summaryCard = document.createElement("section");
      summaryCard.className = "canvas-card";
      const prose = document.createElement("div");
      prose.className = "canvas-prose";
      this._appendFormattedText(prose, payload.summary);
      summaryCard.appendChild(prose);
      view.appendChild(summaryCard);
    }

    if (Array.isArray(payload.items) && payload.items.length > 0) {
      const list = document.createElement("div");
      list.className = "structured-grid";

      payload.items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "structured-item";

        const top = document.createElement("div");
        top.className = "structured-item__top";

        const heading = document.createElement("h4");
        heading.className = "structured-item__heading";
        heading.textContent = item.heading || "";
        top.appendChild(heading);

        if (item.tag) {
          const tag = document.createElement("span");
          tag.className = "structured-item__tag";
          tag.textContent = item.tag;
          top.appendChild(tag);
        }

        const detail = document.createElement("p");
        detail.className = "structured-item__detail";
        detail.textContent = item.detail || "";

        card.appendChild(top);
        card.appendChild(detail);
        list.appendChild(card);
      });

      view.appendChild(list);
    }

    this.container.appendChild(view);
  }

  /**
   * Safely format plain text / lightweight markdown paragraphs and bullet lines without innerHTML XSS.
   */
  _appendFormattedText(parentEl, rawText) {
    const lines = rawText.split(/\r?\n/);
    let currentList = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        currentList = null;
        continue;
      }

      if (/^[-*•]\s+/.test(line)) {
        if (!currentList) {
          currentList = document.createElement("ul");
          parentEl.appendChild(currentList);
        }
        const li = document.createElement("li");
        this._appendInlineBold(li, line.replace(/^[-*•]\s+/, ""));
        currentList.appendChild(li);
      } else {
        currentList = null;
        const p = document.createElement("p");
        this._appendInlineBold(p, line);
        parentEl.appendChild(p);
      }
    }
  }

  _appendInlineBold(el, text) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    parts.forEach((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        el.appendChild(strong);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  _setHeader(label, showReset) {
    if (this.badgeEl) this.badgeEl.textContent = label;
    if (this.resetBtnEl) this.resetBtnEl.hidden = !showReset;
  }
}
