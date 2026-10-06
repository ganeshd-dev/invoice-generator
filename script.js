"use strict";

/*
 * Quotation & Invoice Maker.
 *
 * One layout function turns the form into a list of drawing operations per
 * page (text, boxes, the logo). The same operations are drawn twice: onto
 * <canvas> for the live preview, and into a jsPDF document for the download,
 * so the preview always matches the PDF.
 *
 * Page geometry follows the reference quotation: US Letter, 612 × 792 pt,
 * Helvetica 9 pt body text.
 */
(function () {
  if (!window.jspdf) {
    document.getElementById("status").textContent =
      "Couldn’t load the PDF library. Check your internet connection and reload the page.";
    return;
  }
  const { jsPDF } = window.jspdf;

  const STORE_KEY = "quotation-maker:v1";

  // ---------- Page geometry (points) ----------
  const PAGE_W = 612;
  const PAGE_H = 792;
  const BORDER = { x: 24, y: 24, w: 564, h: 744 };
  const TEXT_X = 78; // WORK / TO / opening paragraph
  const TABLE = { left: 72, c1: 124, c2: 462, right: 544 };
  const BODY = 9; // font size
  const LEAD = 11.5; // line spacing for body text
  const BOTTOM = 738; // last usable baseline before the border
  const CONT_TOP = 60; // where content starts on page 2+
  const GREY = "#7f7f7f";
  const BLACK = "#000000";
  const LOGO_H = 70;
  // Line widths that wrap the sample text exactly where the reference PDF does.
  const DESC_W = 300;
  const INTRO_W = 440;

  // ---------- Default wording ----------
  const DEFAULTS = {
    name: "Ganesh Desai",
    phone: "9834548895",
    payee: "Ganesh Desai",
    gstin: "",
    logo: "",
    logoAsLetter: true,
    gstType: "cgst-sgst",
    nextInvoice: "INV-001",
    introQ:
      "We thank you very much for your enquiry and shall be pleased. If our quotation finds you kind approval, your order will receive our prompt and careful attention.",
    introI:
      "Thank you for giving us the opportunity to work with you. Please find below the invoice for the work completed.",
    termsQ: [
      "All rates include labour charges and painting materials.",
      "GST will be charged additionally at 18%, if a GST invoice is required.",
      "Scaffolding charges, if required, will be billed separately.",
      "An advance payment of 50% of the total quotation amount is required before commencement of work.",
      "Payments should be made as per the agreed schedule and within the specified timeline.",
    ].join("\n"),
    termsI: [
      "All rates include labour charges and painting materials.",
      "Please make the payment within 7 days of the invoice date.",
      "Kindly mention the invoice number when making the payment.",
    ].join("\n"),
  };

  // The reference quotation, shown when the page opens.
  const SAMPLE = {
    work: "Quotation for Painting",
    toName: "Ashiyana apartment",
    toAddress: "Munjaba Vasti, Dhanori,\nPune, Maharashtra 411015",
    items: [
      {
        heading: "External:",
        text: "Washing + Crack filling + 1 Coat Normal Primer(Without warranty) + 2 Coat ACE Paint + Staircase & Lobby Putty 2 Coat OBD Paint",
        amount: 240000,
      },
      {
        heading: "External:",
        text: "Washing + Crack filling + 1 Coat Normal Primer(Without warranty) + 2 Coat Apex Paint + Staircase & Lobby Putty 2 Coat OBD Paint",
        amount: 265000,
      },
      {
        heading: "External:",
        text: "Washing + Crack filling + 1 Coat Damp Prime(5 year warranty) + 2 Coat Apex Paint + Staircase & Lobby Putty 2 Coat OBD Paint",
        amount: 320000,
      },
      {
        heading: "External:",
        text: "Washing + Crack filling + 1 Coat Damp Prime(5 year warranty) + 2 Coat Ultima Paint + Staircase & Lobby Putty 2 Coat OBD Paint",
        amount: 380000,
      },
      { heading: "", text: "Oil Paint (Window grill & Staircase railing only)", amount: 35000 },
    ],
  };

  // Details about you are remembered; details about the customer never are.
  const REMEMBERED = ["name", "phone", "payee", "gstin", "logo", "logoAsLetter", "gstType", "nextInvoice", "introQ", "introI", "termsQ", "termsI"];

  // ---------- State ----------
  const saved = readStore();
  const s = {
    ...DEFAULTS,
    ...saved,
    mode: "quotation",
    invoiceNo: (saved && saved.nextInvoice) || DEFAULTS.nextInvoice,
    date: todayISO(),
    work: SAMPLE.work,
    toName: SAMPLE.toName,
    toAddress: SAMPLE.toAddress,
    toGstin: "",
    items: SAMPLE.items.map((it) => ({ ...it })),
    showTotal: false,
    gst: false,
    remember: true,
  };

  let logoImg = null; // HTMLImageElement for the canvas preview
  let logoAspect = 1;

  // ---------- Helpers ----------
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** "2026-06-17" → "17-06-2026" */
  function displayDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
  }

  /** 240000 → "2,40,000"; paise only when there are any. */
  function inr(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return Number.isInteger(v)
      ? v.toLocaleString("en-IN")
      : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** "INV-009" → "INV-010", keeping zero padding. */
  function nextNumber(n) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(n || "");
    if (!m) return n;
    return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, "0") + m[3];
  }

  function fileName() {
    const base = (s.toName || "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/[\s.,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return `${base || (s.mode === "invoice" ? "Invoice" : "Quotation")}.pdf`;
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || null;
    } catch {
      return null;
    }
  }

  function writeStore() {
    try {
      if (!s.remember) {
        localStorage.removeItem(STORE_KEY);
        return;
      }
      const data = {};
      for (const k of REMEMBERED) data[k] = s[k];
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be full or blocked (private mode); remembering is only a convenience.
    }
  }

  // ---------- Text measuring and wrapping ----------
  const meter = new jsPDF({ unit: "pt", format: "letter" });

  function width(text, style, size) {
    meter.setFont("helvetica", style);
    meter.setFontSize(size);
    return meter.getTextWidth(text);
  }

  /**
   * Wrap styled runs ([{t, style}]) to maxW. Returns lines, each a list of
   * runs. A "\n" in the text forces a new line.
   */
  function wrap(runs, size, maxW) {
    const tokens = [];
    for (const r of runs) {
      String(r.t || "")
        .split("\n")
        .forEach((part, i) => {
          if (i > 0) tokens.push({ br: true });
          for (const w of part.split(/(\s+)/)) if (w) tokens.push({ t: w, style: r.style });
        });
    }

    const lines = [[]];
    let lineW = 0;
    const cur = () => lines[lines.length - 1];
    const push = (t, style) => {
      const line = cur();
      const last = line[line.length - 1];
      if (last && last.style === style) last.t += t;
      else line.push({ t, style });
      lineW += width(t, style, size);
    };
    const newLine = () => {
      const line = cur();
      const last = line[line.length - 1];
      if (last) last.t = last.t.replace(/\s+$/, "");
      lines.push([]);
      lineW = 0;
    };

    for (const tok of tokens) {
      if (tok.br) {
        newLine();
        continue;
      }
      const space = /^\s+$/.test(tok.t);
      if (space) {
        if (lineW > 0) push(" ", tok.style);
        continue;
      }
      const w = width(tok.t, tok.style, size);
      if (lineW > 0 && lineW + w > maxW) newLine();
      if (w <= maxW) {
        push(tok.t, tok.style);
        continue;
      }
      // A single word longer than the line: break it by characters.
      for (const ch of tok.t) {
        if (lineW > 0 && lineW + width(ch, tok.style, size) > maxW) newLine();
        push(ch, tok.style);
      }
    }
    const last = cur()[cur().length - 1];
    if (last) last.t = last.t.replace(/\s+$/, "");
    return lines;
  }

  const lineWidth = (line, size) => line.reduce((sum, r) => sum + width(r.t, r.style, size), 0);

  // ---------- Layout ----------
  function layout() {
    const pages = [];
    let ops;

    const newPage = () => {
      ops = [];
      pages.push(ops);
      ops.push({ t: "rect", ...BORDER, stroke: BLACK, lw: 1 });
    };
    const text = (x, y, str, style = "normal", size = BODY, color = BLACK) => {
      if (str) ops.push({ t: "text", x, y, s: str, style, size, color });
    };
    const runs = (x, y, line, size = BODY) => {
      let cx = x;
      for (const r of line) {
        text(cx, y, r.t, r.style, size);
        cx += width(r.t, r.style, size);
      }
    };
    const box = (x, y, w, h, fill) => ops.push({ t: "rect", x, y, w, h, stroke: BLACK, lw: 0.9, fill });

    newPage();
    const isInvoice = s.mode === "invoice";
    const docWord = isInvoice ? "invoice" : "quotation";

    // Header: logo + name + phone, centred as one block.
    const name = (s.name || "").trim();
    const hasLogo = !!(s.logo && logoImg);
    const asLetter = hasLogo && s.logoAsLetter && name.length > 1;
    const shownName = asLetter ? name.slice(1) : name;
    const phone = s.phone ? `Phone: ${s.phone.trim()}` : "";
    const nameW = shownName ? width(shownName, "bold", 28) : 0;
    const phoneW = phone ? width(phone, "italic", 16) : 0;
    const logoW = hasLogo ? Math.min(LOGO_H * logoAspect, 180) : 0;
    const logoH = hasLogo ? logoW / logoAspect : 0;
    const gap = hasLogo ? (asLetter ? 1 : 12) : 0;
    const blockW = Math.max(nameW, phoneW);
    const x0 = (PAGE_W - (logoW + gap + blockW)) / 2;
    const top = 97;
    if (hasLogo) ops.push({ t: "img", x: x0, y: top + (LOGO_H - logoH) / 2, w: logoW, h: logoH });
    const bx = x0 + logoW + gap;
    const nameX = asLetter ? bx : bx + (blockW - nameW) / 2;
    text(nameX, top + 37, shownName, "bold", 28);
    if (phone) text(nameX + (nameW - phoneW) / 2, top + 61, phone, "italic", 16, GREY);

    let shift = 0;
    if (s.gst && s.gstin.trim()) {
      const g = `GSTIN: ${s.gstin.trim().toUpperCase()}`;
      text(nameX + (nameW - width(g, "normal", 10)) / 2, top + 78, g, "normal", 10, GREY);
      shift = 10;
    }

    // Title
    const title = isInvoice ? "INVOICE" : "QUOTATION";
    text((PAGE_W - width(title, "bold", 18)) / 2, 205 + shift, title, "bold", 18, GREY);

    // WORK (left) and number/date (right)
    const y0 = 234 + shift;
    const rightLabel = (y, label, value) => {
      const vw = width(value, "normal", BODY);
      const lw = width(label, "bold", BODY);
      text(TABLE.right - vw - lw, y, label, "bold");
      text(TABLE.right - vw, y, value);
    };
    if (isInvoice && s.invoiceNo.trim()) rightLabel(y0, "INVOICE NO: ", s.invoiceNo.trim());
    rightLabel(y0 + 11, "DATE: ", displayDate(s.date));

    let y = y0;
    if (s.work.trim()) {
      text(TEXT_X, y0, "WORK:", "bold");
      const lines = wrap([{ t: s.work.trim(), style: "normal" }], BODY, 290);
      lines.forEach((ln, i) => runs(TEXT_X, y0 + 11 + i * LEAD, ln));
      y = y0 + 11 + (lines.length - 1) * LEAD;
    } else {
      y = y0 + 11;
    }

    // TO
    const toLines = [];
    const toName = s.toName.trim();
    const address = s.toAddress.trim();
    if (toName) toLines.push(address && !/[,.]$/.test(toName) ? `${toName},` : toName);
    if (address) toLines.push(address);
    if (s.gst && s.toGstin.trim()) toLines.push(`GSTIN: ${s.toGstin.trim().toUpperCase()}`);
    if (toLines.length) {
      const yTo = y + 31;
      text(TEXT_X, yTo, "TO:", "bold");
      const lines = wrap([{ t: toLines.join("\n"), style: "normal" }], BODY, 300);
      lines.forEach((ln, i) => runs(TEXT_X, yTo + 11 + i * LEAD, ln));
      y = yTo + 11 + (lines.length - 1) * LEAD;
    }

    // Opening paragraph
    const intro = (isInvoice ? s.introI : s.introQ).trim();
    if (intro) {
      const yP = y + 25;
      const lines = wrap([{ t: intro, style: "normal" }], BODY, INTRO_W);
      lines.forEach((ln, i) => runs(TEXT_X, yP + i * LEAD, ln));
      y = yP + (lines.length - 1) * LEAD;
    }

    // Table
    const tableHeader = (ty) => {
      box(TABLE.left, ty, TABLE.c1 - TABLE.left, 31, "#f2f2f2");
      box(TABLE.c1, ty, TABLE.c2 - TABLE.c1, 31, "#f2f2f2");
      box(TABLE.c2, ty, TABLE.right - TABLE.c2, 31, "#f2f2f2");
      const centre = (a, b, label) => text(a + (b - a - width(label, "bold", BODY)) / 2, ty + 19, label, "bold");
      centre(TABLE.left, TABLE.c1, "SR. NO.");
      centre(TABLE.c1, TABLE.c2, "DESCRIPTION");
      centre(TABLE.c2, TABLE.right, "AMOUNT");
      return ty + 31;
    };

    let ty = tableHeader(y + 14);
    const items = s.items.filter((it) => it.heading.trim() || it.text.trim() || Number(it.amount));
    items.forEach((it, i) => {
      const parts = [];
      if (it.heading.trim()) parts.push({ t: `${it.heading.trim()} `, style: "bold" });
      if (it.text.trim()) parts.push({ t: it.text.trim(), style: "normal" });
      const lines = wrap(parts, BODY, DESC_W);
      const h = Math.max(30, 13 + (lines.length - 1) * 11.7 + 13.5);
      if (ty + h > BOTTOM) {
        newPage();
        ty = tableHeader(CONT_TOP);
      }
      box(TABLE.left, ty, TABLE.c1 - TABLE.left, h);
      box(TABLE.c1, ty, TABLE.c2 - TABLE.c1, h);
      box(TABLE.c2, ty, TABLE.right - TABLE.c2, h);
      const sr = `${i + 1}.`;
      text(TABLE.left + (TABLE.c1 - TABLE.left - width(sr, "normal", BODY)) / 2, ty + 13, sr);
      lines.forEach((ln, j) => runs(TABLE.c1 + 10, ty + 13 + j * 11.7, ln));
      const amt = it.amount === "" || it.amount == null ? "" : inr(it.amount);
      text(TABLE.c2 + (TABLE.right - TABLE.c2 - width(amt, "normal", BODY)) / 2, ty + 13, amt);
      ty += h;
    });

    // Totals
    const total = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    const totalRows = [];
    if (isInvoice || s.showTotal || s.gst) {
      if (s.gst) {
        totalRows.push(["SUB TOTAL", total, false]);
        let tax = 0;
        if (s.gstType === "igst") {
          const igst = Math.round(total * 18) / 100;
          totalRows.push(["IGST @ 18%", igst, false]);
          tax = igst;
        } else {
          const half = Math.round(total * 9) / 100;
          totalRows.push(["CGST @ 9%", half, false], ["SGST @ 9%", half, false]);
          tax = half * 2;
        }
        totalRows.push(["GRAND TOTAL", total + tax, true]);
      } else {
        totalRows.push(["TOTAL", total, true]);
      }
    }
    for (const [label, value, strong] of totalRows) {
      const h = 24;
      if (ty + h > BOTTOM) {
        newPage();
        ty = CONT_TOP;
      }
      box(TABLE.left, ty, TABLE.c2 - TABLE.left, h);
      box(TABLE.c2, ty, TABLE.right - TABLE.c2, h);
      const st = strong ? "bold" : "normal";
      text(TABLE.c2 - 10 - width(label, st, BODY), ty + 15.5, label, st);
      const v = inr(value);
      text(TABLE.c2 + (TABLE.right - TABLE.c2 - width(v, st, BODY)) / 2, ty + 15.5, v, st);
      ty += h;
    }
    y = ty;

    // Terms & Conditions
    const terms = (isInvoice ? s.termsI : s.termsQ)
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length) {
      const wrapped = terms.map((t) => wrap([{ t, style: "normal" }], BODY, TABLE.right - 108));
      const need = 12 + wrapped.reduce((n, l) => n + l.length, 0) * 12;
      let yT = y + 32;
      if (yT + need > BOTTOM) {
        newPage();
        yT = CONT_TOP;
      }
      text(TABLE.left, yT, "Terms & Conditions", "bold");
      let ly = yT;
      for (const lines of wrapped) {
        ly += 12;
        text(90, ly, "•");
        lines.forEach((ln, j) => runs(108, ly + j * 12, ln));
        ly += (lines.length - 1) * 12;
      }
      y = ly;
    }

    // Payment Details
    const payee = s.payee.trim();
    const contact = `For any questions or clarifications regarding this ${docWord}, please feel free to contact us.`;
    const payLines = payee
      ? wrap(
          [
            { t: "Please make all payments in favor of ", style: "normal" },
            { t: payee, style: "bold" },
            { t: ".", style: "normal" },
          ],
          BODY,
          TABLE.right - TABLE.left
        )
      : [];
    const contactLines = wrap([{ t: contact, style: "normal" }], BODY, TABLE.right - TABLE.left);
    let yPay = y + 23;
    if (yPay + 12 * (payLines.length + contactLines.length) > BOTTOM) {
      newPage();
      yPay = CONT_TOP;
    }
    text(TABLE.left, yPay, "Payment Details", "bold");
    let py = yPay + 11;
    for (const ln of [...payLines, ...contactLines]) {
      runs(TABLE.left, py, ln);
      py += 12;
    }

    return pages;
  }

  // ---------- Drawing ----------
  function drawCanvas(canvas, ops) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || PAGE_W;
    const scale = (cssW / PAGE_W) * dpr;
    canvas.width = Math.round(PAGE_W * scale);
    canvas.height = Math.round(PAGE_H * scale);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    for (const o of ops) {
      if (o.t === "rect") {
        if (o.fill) {
          ctx.fillStyle = o.fill;
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
        ctx.lineWidth = o.lw;
        ctx.strokeStyle = o.stroke;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
      } else if (o.t === "text") {
        const bold = o.style.includes("bold") ? "bold " : "";
        const italic = o.style.includes("italic") ? "italic " : "";
        ctx.font = `${italic}${bold}${o.size}px Helvetica, Arial, sans-serif`;
        ctx.fillStyle = o.color;
        ctx.fillText(o.s, o.x, o.y);
      } else if (o.t === "img" && logoImg) {
        ctx.drawImage(logoImg, o.x, o.y, o.w, o.h);
      }
    }
  }

  function buildPdf(pages) {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    doc.setProperties({ title: fileName().replace(/\.pdf$/, ""), author: s.name, creator: "Quotation & Invoice Maker" });
    pages.forEach((ops, i) => {
      if (i > 0) doc.addPage("letter");
      for (const o of ops) {
        if (o.t === "rect") {
          doc.setLineWidth(o.lw);
          doc.setDrawColor(o.stroke);
          if (o.fill) {
            doc.setFillColor(o.fill);
            doc.rect(o.x, o.y, o.w, o.h, "FD");
          } else {
            doc.rect(o.x, o.y, o.w, o.h, "S");
          }
        } else if (o.t === "text") {
          doc.setFont("helvetica", o.style);
          doc.setFontSize(o.size);
          doc.setTextColor(o.color);
          doc.text(o.s, o.x, o.y);
        } else if (o.t === "img") {
          doc.addImage(s.logo, "PNG", o.x, o.y, o.w, o.h, "logo", "FAST");
        }
      }
    });
    return doc;
  }

  // ---------- Preview ----------
  const pagesEl = document.getElementById("pages");
  let pending = false;
  function render() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const pages = layout();
      while (pagesEl.children.length < pages.length) pagesEl.appendChild(document.createElement("canvas"));
      while (pagesEl.children.length > pages.length) pagesEl.lastChild.remove();
      pages.forEach((ops, i) => drawCanvas(pagesEl.children[i], ops));
    });
  }
  window.addEventListener("resize", render);

  // ---------- Form wiring ----------
  const $ = (id) => document.getElementById(id);
  const fields = ["invoiceNo", "date", "work", "name", "phone", "gstin", "toName", "toAddress", "toGstin", "payee"];
  const checks = ["logoAsLetter", "showTotal", "gst", "remember"];

  function syncBodyClasses() {
    document.body.classList.toggle("is-invoice", s.mode === "invoice");
    document.body.classList.toggle("has-gst", s.gst);
  }

  function fillForm() {
    for (const f of fields) $(f).value = s[f] || "";
    for (const c of checks) $(c).checked = !!s[c];
    $("gstType").value = s.gstType;
    document.querySelector(`input[name="mode"][value="${s.mode}"]`).checked = true;
    $("intro").value = s.mode === "invoice" ? s.introI : s.introQ;
    $("terms").value = s.mode === "invoice" ? s.termsI : s.termsQ;
    updateLetterHint();
    syncBodyClasses();
    renderItems();
  }

  function updateLetterHint() {
    const name = (s.name || "").trim();
    const label = $("logoAsLetter").parentElement;
    label.lastChild.textContent = name.length > 1
      ? ` The logo is the first letter of my name (prints “${name.slice(1)}” next to it)`
      : " The logo is the first letter of my name";
  }

  const itemsEl = $("items");
  const tpl = $("itemTpl");
  function renderItems() {
    itemsEl.textContent = "";
    s.items.forEach((it, i) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.i = i;
      node.querySelector(".item-no").textContent = `Item ${i + 1}`;
      for (const input of node.querySelectorAll("[data-k]")) {
        const k = input.dataset.k;
        input.value = it[k] === 0 || it[k] ? it[k] : "";
      }
      node.querySelector('[data-act="remove"]').disabled = s.items.length === 1;
      itemsEl.appendChild(node);
    });
  }

  $("form").addEventListener("input", (e) => {
    const el = e.target;
    const item = el.closest(".item");
    if (item) {
      const it = s.items[Number(item.dataset.i)];
      it[el.dataset.k] = el.dataset.k === "amount" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    } else if (fields.includes(el.id)) {
      s[el.id] = el.value;
      if (el.id === "name") updateLetterHint();
      if (el.id === "invoiceNo") s.nextInvoice = el.value;
    } else if (el.id === "intro") {
      s[s.mode === "invoice" ? "introI" : "introQ"] = el.value;
    } else if (el.id === "terms") {
      s[s.mode === "invoice" ? "termsI" : "termsQ"] = el.value;
    } else if (el.id === "gstType") {
      s.gstType = el.value;
    }
    writeStore();
    render();
  });

  $("form").addEventListener("change", (e) => {
    const el = e.target;
    if (el.name === "mode") {
      s.mode = el.value;
      $("intro").value = s.mode === "invoice" ? s.introI : s.introQ;
      $("terms").value = s.mode === "invoice" ? s.termsI : s.termsQ;
      if (s.mode === "invoice" && s.work === SAMPLE.work) {
        s.work = "Painting work";
        $("work").value = s.work;
      } else if (s.mode === "quotation" && s.work === "Painting work") {
        s.work = SAMPLE.work;
        $("work").value = s.work;
      }
    } else if (checks.includes(el.id)) {
      s[el.id] = el.checked;
    } else if (el.id === "gstType") {
      s.gstType = el.value;
    }
    syncBodyClasses();
    writeStore();
    render();
  });

  itemsEl.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-act="remove"]');
    if (!btn) return;
    const i = Number(btn.closest(".item").dataset.i);
    s.items.splice(i, 1);
    renderItems();
    render();
  });

  $("addItem").addEventListener("click", () => {
    s.items.push({ heading: "", text: "", amount: "" });
    renderItems();
    itemsEl.lastElementChild.querySelector('[data-k="text"]').focus();
    render();
  });

  // ---------- Logo ----------
  function setLogo(dataUrl) {
    s.logo = dataUrl;
    $("logoPreview").hidden = !dataUrl;
    $("logoRemove").hidden = !dataUrl;
    $("logoPick").firstChild.textContent = dataUrl ? "Change logo" : "Upload logo";
    if (!dataUrl) {
      logoImg = null;
      render();
      return;
    }
    $("logoPreview").src = dataUrl;
    const img = new Image();
    img.onload = () => {
      logoImg = img;
      logoAspect = img.naturalWidth / img.naturalHeight || 1;
      render();
    };
    img.src = dataUrl;
  }

  /**
   * Crop the white or transparent margin around a logo (so every logo prints
   * at the same visible size), then shrink it so the PDF stays small and the
   * logo fits in this browser's storage.
   */
  function prepareLogo(img) {
    const first = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const src = document.createElement("canvas");
    src.width = Math.max(1, Math.round(img.naturalWidth * first));
    src.height = Math.max(1, Math.round(img.naturalHeight * first));
    const sctx = src.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, src.width, src.height);

    const { data, width: w, height: h } = sctx.getImageData(0, 0, src.width, src.height);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const blank = data[i + 3] < 16 || (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240);
        if (blank) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; } // all blank: keep as is
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;

    const scale = Math.min(1, 360 / ch, 720 / cw);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cw * scale));
    out.height = Math.max(1, Math.round(ch * scale));
    out.getContext("2d").drawImage(src, x0, y0, cw, ch, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  $("logo").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const status = $("status");
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setLogo(prepareLogo(img));
        writeStore();
        status.classList.remove("error");
        status.textContent = "";
      };
      img.onerror = () => {
        status.classList.add("error");
        status.textContent = "That image couldn’t be read. Try a PNG or JPG file.";
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

  $("logoRemove").addEventListener("click", () => {
    setLogo("");
    writeStore();
  });

  // ---------- Download ----------
  $("download").addEventListener("click", () => {
    const btn = $("download");
    const status = $("status");
    btn.disabled = true;
    try {
      const name = fileName();
      buildPdf(layout()).save(name);
      status.classList.remove("error");
      status.textContent = `Saved as “${name}”.`;
      if (s.mode === "invoice" && s.invoiceNo.trim()) {
        // The next invoice gets the next number; this one keeps its number on screen.
        s.nextInvoice = nextNumber(s.invoiceNo.trim());
        writeStore();
      }
    } catch (err) {
      console.error(err);
      status.classList.add("error");
      status.textContent = "Couldn’t create the PDF. Please try again.";
    } finally {
      btn.disabled = false;
    }
  });

  $("reset").addEventListener("click", () => {
    s.date = todayISO();
    s.work = s.mode === "invoice" ? "Painting work" : SAMPLE.work;
    s.toName = "";
    s.toAddress = "";
    s.toGstin = "";
    s.items = [{ heading: "", text: "", amount: "" }];
    if (s.mode === "invoice") s.invoiceNo = s.nextInvoice || s.invoiceNo;
    $("status").textContent = "";
    fillForm();
    render();
    $("toName").focus();
  });

  // ---------- Start ----------
  fillForm();
  setLogo(s.logo || "");
  render();
})();
