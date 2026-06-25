/**
 * ═══════════════════════════════════════════════════════════════
 *  DAYLIK COPYWRITING AGENT — Option B (Two-Pass)
 * ═══════════════════════════════════════════════════════════════
 *
 *  Input:  Phase 2 v3 topic data (JS object) + style packet (.md)
 *  Pass 1: DRAFT — expand beats → full spoken monologue with timing
 *  Pass 2: POLISH — refine punchlines, callbacks, tone, banned phrases
 *  Output: Teleprompter-ready .docx with table (CZAS / TEKST / CUE / TON)
 *
 *  Usage:
 *    node copywriting_agent.js [--style default_daylik]
 *    (default: default_daylik style, always processes ALL topics)
 */

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageBreak, PageNumber, TabStopType, TabStopPosition
} = require("docx");

// ═══ COLOR PALETTE ═══
const C = {
  red: "C5221F", green: "0D652D", blue: "1A73E8", orange: "B06000",
  gray: "5F6368", lightGray: "F1F3F4", lightRed: "FCE8E6",
  lightGreen: "E6F4EA", lightBlue: "D2E3FC", lightOrange: "FEF7E0",
  accent: "EA4335", black: "202124", white: "FFFFFF",
  purple: "9C27B0", deepPurple: "6A1B9A",
  toneJoke: "FFF3E0", tonePause: "E8EAF6", toneAnger: "FFEBEE",
  toneData: "E8F5E9", toneNeutral: "FAFAFA",
};

// Page: 11906 DXA wide, margins 850 each side → content = 10206
const CONTENT_WIDTH = 10206;

// ═══ STYLE PACKET PARSER ═══
function parseStylePacket(mdContent) {
  const style = {
    name: "Unknown",
    role: "",
    alias: "",
    specialization: "",
    wordsPerMinute: 155,
    segmentTimes: { OPENER: [5, 6], SEGMENT: [4, 5], BONUS: [1.5, 2] },
    pauses: "dramatyczne cisza-przed-punchline",
    tone: "ironia + beka + spokojny-analityk",
    vulgarityLevel: 3,
    humor: ["triady", "callback", "kontrast", "sarkastyczne pytanie retoryczne"],
    politicalStance: "równo obie strony",
    preferredFigures: [],
    bannedPhrases: [],
    sentenceStyle: "",
    dynamics: {
      intro: "",
      escalation: "",
      punchline: "",
      finish: "",
    },
    videoFormat: "80% STUDIO, 20% MASHUP",
    notes: "",
  };

  // Parse name from header
  const nameMatch = mdContent.match(/# Style Packet: (.+)/);
  if (nameMatch) style.name = nameMatch[1].trim();

  // Parse key fields
  const fieldParsers = [
    [/\*\*Rola:\*\*\s*(.+)/, "role"],
    [/\*\*Pseudonim na antenie:\*\*\s*(.+)/, "alias"],
    [/\*\*Specjalizacja tematyczna:\*\*\s*(.+)/, "specialization"],
    [/\*\*Słów na minutę:\*\*\s*(\d+)/, "wordsPerMinute", v => parseInt(v)],
    [/\*\*Poziom wulgarności.*:\*\*\s*(\d)/, "vulgarityLevel", v => parseInt(v)],
    [/\*\*Dominujący ton:\*\*\s*(.+)/, "tone"],
    [/\*\*Stosunek do polityków:\*\*\s*(.+)/, "politicalStance"],
    [/\*\*Ulubione formaty zdań:\*\*\s*(.+)/, "sentenceStyle"],
  ];

  for (const [regex, field, transform] of fieldParsers) {
    const m = mdContent.match(regex);
    if (m) style[field] = transform ? transform(m[1]) : m[1].trim();
  }

  // Parse preferred figures (checked items)
  const figureMatches = mdContent.matchAll(/- \[x\] (.+)/g);
  style.preferredFigures = [...figureMatches].map(m => m[1].trim());

  // Parse banned phrases
  const bannedMatch = mdContent.match(/\*\*Zakazane frazy:\*\*\s*(.+)/);
  if (bannedMatch) {
    style.bannedPhrases = bannedMatch[1]
      .split(/[,"]/)
      .map(s => s.replace(/[""()\-—]/g, "").trim())
      .filter(s => s.length > 2);
  }

  // Parse dynamics
  const dynParsers = [
    [/\*\*Jak zaczyna \(INTRO\):\*\*\s*(.+)/, "intro"],
    [/\*\*Jak buduje napięcie \(ESKALACJA\):\*\*\s*(.+)/, "escalation"],
    [/\*\*Jak punchline:\*\*\s*(.+)/, "punchline"],
    [/\*\*Jak kończy \(FINISZ\):\*\*\s*(.+)/, "finish"],
  ];
  for (const [regex, field] of dynParsers) {
    const m = mdContent.match(regex);
    if (m) style.dynamics[field] = m[1].trim();
  }

  // Parse segment times
  const timeMatch = mdContent.match(/\*\*Preferowany czas segmentu:\*\*\s*(.+)/);
  if (timeMatch) {
    const t = timeMatch[1];
    const opener = t.match(/OPENER\s*([\d.]+)-([\d.]+)/);
    const segment = t.match(/SEGMENT\s*([\d.]+)-([\d.]+)/);
    const bonus = t.match(/BONUS\s*([\d.]+)-([\d.]+)/);
    if (opener) style.segmentTimes.OPENER = [parseFloat(opener[1]), parseFloat(opener[2])];
    if (segment) style.segmentTimes.SEGMENT = [parseFloat(segment[1]), parseFloat(segment[2])];
    if (bonus) style.segmentTimes.BONUS = [parseFloat(bonus[1]), parseFloat(bonus[2])];
  }

  return style;
}


// ═══ PASS 1: DRAFT — Expand beats into full monologue ═══
function draftPass(topic, style) {
  const segments = [];
  const wpm = style.wordsPerMinute;

  for (const beat of topic.beats) {
    // Expand beat content into full spoken text
    let text = beat.content;
    const wordCount = text.split(/\s+/).length;
    const durationSec = Math.round((wordCount / wpm) * 60);

    // Determine tone based on beat type
    let tone = "NEUTRALNY";
    if (beat.beat === "INTRO") tone = "MOCNE OTWARCIE";
    else if (beat.beat === "ESKALACJA") tone = "NAPIĘCIE ↑";
    else if (beat.beat === "ABSURD") tone = "IRONIA / BEKA";
    else if (beat.beat.startsWith("PUNCHLINE")) tone = "PUNCHLINE — pauza przed dropem";
    else if (beat.beat === "FINISZ") tone = "ZAMKNIĘCIE — callback";
    else if (beat.beat === "CALLBACK") tone = "CALLBACK — lekko";

    // Parse cue for video/editor instructions
    let cue = beat.cue || "";

    segments.push({
      beat: beat.beat,
      text,
      cue,
      tone,
      wordCount,
      durationSec,
    });
  }

  return segments;
}


// ═══ PASS 2: POLISH — Refine punchlines, callbacks, tone ═══
function polishPass(segments, topic, style, allTopics) {
  const polished = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = { ...segments[i] };
    let text = seg.text;

    // ── Check 1: Banned phrases ──
    for (const banned of style.bannedPhrases) {
      const lowerBanned = banned.toLowerCase();
      if (text.toLowerCase().includes(lowerBanned)) {
        // Flag it — in production this would be AI-rewritten
        seg.polishNotes = seg.polishNotes || [];
        seg.polishNotes.push(`⚠️ BANNED PHRASE: "${banned}" — wymaga przepisania`);
      }
    }

    // ── Check 2: Sentence rhythm check ──
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / Math.max(sentences.length, 1);

    // Style says "Krótkie. Urwane. Jak cios." — flag overly long sentences
    if (avgWords > 20 && style.sentenceStyle.includes("Krótkie")) {
      seg.polishNotes = seg.polishNotes || [];
      seg.polishNotes.push(`📝 Średnio ${Math.round(avgWords)} słów/zdanie — rozważ skrócenie (styl: "Krótkie. Urwane.")`);
    }

    // ── Check 3: Data density — every punchline should have a number ──
    if (seg.beat.startsWith("PUNCHLINE") || seg.beat === "FINISZ") {
      const hasNumber = /\d/.test(text);
      if (!hasNumber) {
        seg.polishNotes = seg.polishNotes || [];
        seg.polishNotes.push(`📊 Brak danych liczbowych w ${seg.beat} — Daylik DNA: "Każdy punchline powinien mieć liczbę"`);
      }
    }

    // ── Check 4: Callback detection ──
    if (seg.beat === "FINISZ") {
      // Check if finisz references intro
      const introText = segments[0]?.text || "";
      const introWords = new Set(introText.toLowerCase().split(/\s+/).filter(w => w.length > 5));
      const finishWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 5));
      const overlap = [...finishWords].filter(w => introWords.has(w));

      if (overlap.length < 2) {
        seg.polishNotes = seg.polishNotes || [];
        seg.polishNotes.push(`🔄 CALLBACK: Słaby callback do INTRO — rozważ nawiązanie do otwarcia`);
      } else {
        seg.polishNotes = seg.polishNotes || [];
        seg.polishNotes.push(`✅ CALLBACK: Znaleziono nawiązanie do INTRO (${overlap.slice(0, 3).join(", ")})`);
      }
    }

    // ── Check 5: Cross-segment callbacks (Daylik DNA) ──
    if (allTopics && allTopics.length > 1) {
      const currentIdx = allTopics.findIndex(t => t.id === topic.id);
      if (currentIdx > 0 && seg.beat === "FINISZ") {
        // Check if last segment's finisz references ANY previous topic
        const prevTopicTitles = allTopics.slice(0, currentIdx).map(t => t.title.toLowerCase());
        const hasXCallback = prevTopicTitles.some(title => {
          const keywords = title.split(/\s+/).filter(w => w.length > 4);
          return keywords.some(kw => text.toLowerCase().includes(kw));
        });

        if (hasXCallback) {
          seg.polishNotes = seg.polishNotes || [];
          seg.polishNotes.push(`✅ CROSS-CALLBACK: Nawiązanie do wcześniejszego segmentu — DNA Daylika!`);
        }
      }
    }

    // ── Check 6: Punchline pause markers ──
    if (seg.beat.startsWith("PUNCHLINE") && !seg.cue.includes("PAUSE")) {
      seg.polishNotes = seg.polishNotes || [];
      seg.polishNotes.push(`⏸️ Rozważ dodanie [PAUSE 0.5s] przed dropem w CUE`);
    }

    // ── Check 7: "OBIE strony kłamią" motif ──
    if (topic.narrativeTensions) {
      const hasConfront = text.toLowerCase().includes("obie strony") ||
                          text.toLowerCase().includes("prawica mówi") ||
                          text.toLowerCase().includes("lewica mówi");
      if (hasConfront && !seg.confrontsNarratives) {
        seg.confrontsNarratives = true;
      }
    }

    // ── Timing refinement ──
    // Add pause time for beats that need it
    if (seg.beat.startsWith("PUNCHLINE")) {
      seg.durationSec += 2; // 0.5s pause before + 1.5s reaction time
    }
    if (seg.beat === "FINISZ") {
      seg.durationSec += 3; // Longer pause for final callback + audience reaction
    }

    seg.text = text;
    polished.push(seg);
  }

  // ── Global checks ──
  const totalWords = polished.reduce((sum, s) => sum + s.wordCount, 0);
  const totalSec = polished.reduce((sum, s) => sum + s.durationSec, 0);
  const totalMin = totalSec / 60;

  // Check against style time targets
  const timeRange = style.segmentTimes[topic.type] || [4, 5];
  const meta = {
    totalWords,
    totalSec,
    totalMin: Math.round(totalMin * 10) / 10,
    targetMin: timeRange,
    withinTarget: totalMin >= timeRange[0] && totalMin <= timeRange[1],
    narrativeConfrontation: polished.some(s => s.confrontsNarratives),
  };

  if (!meta.withinTarget) {
    if (totalMin < timeRange[0]) {
      meta.timingNote = `⚠️ ZA KRÓTKI: ${meta.totalMin} min (cel: ${timeRange[0]}-${timeRange[1]} min) — rozważ dodanie materiału`;
    } else {
      meta.timingNote = `⚠️ ZA DŁUGI: ${meta.totalMin} min (cel: ${timeRange[0]}-${timeRange[1]} min) — skróć eskalację lub punchline`;
    }
  } else {
    meta.timingNote = `✅ Timing OK: ${meta.totalMin} min (cel: ${timeRange[0]}-${timeRange[1]} min)`;
  }

  if (topic.narrativeTensions && !meta.narrativeConfrontation) {
    meta.narrativeNote = `⚠️ Brak konfrontacji narracji prawica/lewica — sprawdź czy punchline'y używają napięć`;
  }

  return { segments: polished, meta };
}


// ═══ DOCX GENERATION ═══
function generateTeleprompterDocx(results, style, outputPath) {
  const children = [];

  // ── Title page ──
  children.push(spacer(400));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: "DAYLIK SHOW", font: "Arial", size: 44, bold: true, color: C.accent })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "TELEPROMPTER SCRIPT", font: "Arial", size: 32, bold: true, color: C.black })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: `Style: ${style.name}`, font: "Arial", size: 22, color: C.purple })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: `WPM: ${style.wordsPerMinute} | Wulgarność: ${style.vulgarityLevel}/5 | Ton: ${style.tone}`, font: "Arial", size: 18, color: C.gray })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: "Wygenerowano przez Copywriting Agent — Studio toTU", font: "Arial", size: 16, color: C.gray, italics: true })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: new Date().toLocaleDateString("pl-PL", { year: "numeric", month: "long", day: "numeric" }), font: "Arial", size: 18, color: C.gray })],
  }));

  // ── Show rundown ──
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ text: "RUNDOWN SHOW", font: "Arial", size: 24, bold: true, color: C.black })],
  }));

  let totalShowSec = 0;
  const rundownRows = [buildRundownHeader()];
  results.forEach((r, i) => {
    totalShowSec += r.meta.totalSec;
    rundownRows.push(buildRundownRow(i + 1, r));
  });

  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: RUNDOWN_COLS,
    rows: rundownRows,
  }));

  children.push(new Paragraph({
    spacing: { before: 120, after: 200 },
    alignment: AlignmentType.RIGHT,
    children: [
      new TextRun({ text: `TOTAL: ${formatTime(totalShowSec)} | ${results.reduce((s, r) => s + r.meta.totalWords, 0)} słów`, bold: true, font: "Arial", size: 18, color: C.accent }),
    ],
  }));

  // ── Each topic's teleprompter script ──
  for (const result of results) {
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // Topic header
    children.push(new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [
        new TextRun({ text: result.topic.type, bold: true, font: "Arial", size: 18, color: result.topic.type === "OPENER" ? C.red : result.topic.type === "BONUS" ? C.blue : C.green }),
        new TextRun({ text: `  [${result.topic.id}]`, font: "Arial", size: 14, color: C.gray }),
      ],
    }));

    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: result.topic.title, bold: true, font: "Arial", size: 26, color: C.black })],
    }));

    // Meta stats bar
    const metaColor = result.meta.withinTarget ? C.green : C.red;
    children.push(new Paragraph({
      spacing: { after: 60 },
      shading: { fill: result.meta.withinTarget ? "E8F5E9" : "FFEBEE", type: ShadingType.CLEAR },
      children: [
        new TextRun({ text: ` ⏱ ${formatTime(result.meta.totalSec)} `, bold: true, font: "Arial", size: 16, color: metaColor }),
        new TextRun({ text: ` | ${result.meta.totalWords} słów `, font: "Arial", size: 16, color: C.gray }),
        new TextRun({ text: ` | Cel: ${result.meta.targetMin[0]}-${result.meta.targetMin[1]} min `, font: "Arial", size: 16, color: C.gray }),
        new TextRun({ text: result.meta.withinTarget ? " ✅" : " ⚠️", font: "Arial", size: 16 }),
      ],
    }));

    children.push(spacer(60));

    // ── Teleprompter table ──
    children.push(new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [new TextRun({ text: "TELEPROMPTER", bold: true, font: "Arial", size: 20, color: C.accent })],
    }));

    children.push(buildTeleprompterTable(result.segments));

    // ── Polish notes (QA feedback) ──
    const allNotes = result.segments.flatMap(s => (s.polishNotes || []).map(n => ({ beat: s.beat, note: n })));
    if (allNotes.length > 0) {
      children.push(spacer(80));
      children.push(new Paragraph({
        spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: "NOTATKI POLISH PASS", bold: true, font: "Arial", size: 18, color: C.purple })],
      }));

      for (const { beat, note } of allNotes) {
        children.push(new Paragraph({
          spacing: { after: 40 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: `[${beat}] `, bold: true, font: "Arial", size: 14, color: C.gray }),
            new TextRun({ text: note, font: "Arial", size: 14, color: C.black }),
          ],
        }));
      }
    }

    // ── Sources for fact-check ──
    if (result.topic.sources && result.topic.sources.length > 0) {
      children.push(spacer(80));
      children.push(new Paragraph({
        spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: "ŹRÓDŁA (do weryfikacji)", bold: true, font: "Arial", size: 16, color: C.deepPurple })],
      }));
      for (const s of result.topic.sources) {
        children.push(new Paragraph({
          spacing: { after: 20 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: s.label + ": ", bold: true, font: "Arial", size: 12, color: C.gray }),
            new TextRun({ text: s.url, font: "Arial", size: 12, color: C.blue }),
          ],
        }));
      }
    }

    // ── Timing note ──
    if (result.meta.timingNote) {
      children.push(spacer(40));
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: result.meta.timingNote, font: "Arial", size: 14, color: result.meta.withinTarget ? C.green : C.red, italics: true })],
      }));
    }
    if (result.meta.narrativeNote) {
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: result.meta.narrativeNote, font: "Arial", size: 14, color: C.orange, italics: true })],
      }));
    }
  }

  // ── Final notes page ──
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text: "NOTATKI DLA PROWADZĄCEGO", bold: true, font: "Arial", size: 24, color: C.black })],
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: `Styl: ${style.name} | ${style.wordsPerMinute} wpm | Wulgarność: ${style.vulgarityLevel}/5`, font: "Arial", size: 18, color: C.gray })],
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "Retoryka: ", bold: true, font: "Arial", size: 18 }),
      new TextRun({ text: style.preferredFigures.join(", "), font: "Arial", size: 18, color: C.gray }),
    ],
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "Zakazane frazy: ", bold: true, font: "Arial", size: 18, color: C.red }),
      new TextRun({ text: style.bannedPhrases.join(", "), font: "Arial", size: 18, color: C.gray }),
    ],
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "Dynamika: ", bold: true, font: "Arial", size: 18 }),
      new TextRun({ text: `INTRO: ${style.dynamics.intro} | PUNCHLINE: ${style.dynamics.punchline} | FINISZ: ${style.dynamics.finish}`, font: "Arial", size: 16, color: C.gray }),
    ],
  }));
  children.push(spacer(80));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({
      text: "⚡ CALLBACK'I MIĘDZY SEGMENTAMI TO DNA DAYLIKA — zawsze szukać połączeń między tematami.",
      bold: true, font: "Arial", size: 18, color: C.purple,
    })],
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({
      text: "📊 Dane liczbowe = broń. Każdy punchline powinien mieć liczbę, procent lub kwotę.",
      bold: true, font: "Arial", size: 18, color: C.blue,
    })],
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({
      text: '🎯 "OBIE strony kłamią" to recurring motif — Daylik jest ponad podziałem.',
      bold: true, font: "Arial", size: 18, color: C.accent,
    })],
  }));

  // ── Build doc ──
  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 850, right: 850, bottom: 850, left: 850 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: `DAYLIK — TELEPROMPTER [${style.name}]`, font: "Arial", size: 14, color: C.gray, italics: true }),
              new TextRun({ text: `\t⏱ Total: ${formatTime(totalShowSec)}`, font: "Arial", size: 14, color: C.gray, italics: true }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Studio toTU — Copywriting Agent v1.0 — Strona ", font: "Arial", size: 12, color: C.gray }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 12, color: C.gray }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return doc;
}


// ═══ TABLE BUILDERS ═══

// Rundown column widths: total = 10206
const RUNDOWN_COLS = [600, 1200, 5706, 1200, 800, 700];

function buildRundownHeader() {
  const b = { style: BorderStyle.SINGLE, size: 1, color: "DADCE0" };
  const borders = { top: b, bottom: b, left: b, right: b };
  const m = { top: 60, bottom: 60, left: 100, right: 100 };
  const fill = "202124";

  return new TableRow({
    children: [
      tableCell("#", { borders, m, fill, width: RUNDOWN_COLS[0], bold: true, color: C.white, size: 14 }),
      tableCell("TYP", { borders, m, fill, width: RUNDOWN_COLS[1], bold: true, color: C.white, size: 14 }),
      tableCell("TEMAT", { borders, m, fill, width: RUNDOWN_COLS[2], bold: true, color: C.white, size: 14 }),
      tableCell("CZAS", { borders, m, fill, width: RUNDOWN_COLS[3], bold: true, color: C.white, size: 14 }),
      tableCell("SŁOWA", { borders, m, fill, width: RUNDOWN_COLS[4], bold: true, color: C.white, size: 14 }),
      tableCell("STATUS", { borders, m, fill, width: RUNDOWN_COLS[5], bold: true, color: C.white, size: 14 }),
    ],
  });
}

function buildRundownRow(num, result) {
  const b = { style: BorderStyle.SINGLE, size: 1, color: "DADCE0" };
  const borders = { top: b, bottom: b, left: b, right: b };
  const m = { top: 60, bottom: 60, left: 100, right: 100 };
  const typeColor = { "OPENER": C.lightRed, "SEGMENT": C.lightGray, "BONUS": C.lightBlue };
  const fill = typeColor[result.topic.type] || C.white;
  const status = result.meta.withinTarget ? "✅ OK" : "⚠️";

  return new TableRow({
    children: [
      tableCell(`${num}`, { borders, m, fill, width: RUNDOWN_COLS[0], size: 16 }),
      tableCell(result.topic.type, { borders, m, fill, width: RUNDOWN_COLS[1], bold: true, size: 14, color: result.topic.type === "OPENER" ? C.red : C.black }),
      tableCell(result.topic.title, { borders, m, fill, width: RUNDOWN_COLS[2], size: 16 }),
      tableCell(formatTime(result.meta.totalSec), { borders, m, fill, width: RUNDOWN_COLS[3], bold: true, size: 16, color: result.meta.withinTarget ? C.green : C.red }),
      tableCell(`${result.meta.totalWords}`, { borders, m, fill, width: RUNDOWN_COLS[4], size: 16, color: C.gray }),
      tableCell(status, { borders, m, fill, width: RUNDOWN_COLS[5], size: 14 }),
    ],
  });
}

// Teleprompter column widths: total = 10206
const TELE_COLS = [900, 1300, 5706, 2300];

function buildTeleprompterTable(segments) {
  const b = { style: BorderStyle.SINGLE, size: 1, color: "DADCE0" };
  const borders = { top: b, bottom: b, left: b, right: b };
  const m = { top: 80, bottom: 80, left: 100, right: 100 };

  const header = new TableRow({
    children: [
      tableCell("CZAS", { borders, m, fill: "202124", width: TELE_COLS[0], bold: true, color: C.white, size: 14 }),
      tableCell("BEAT", { borders, m, fill: "202124", width: TELE_COLS[1], bold: true, color: C.white, size: 14 }),
      tableCell("TEKST MONOLOGU", { borders, m, fill: "202124", width: TELE_COLS[2], bold: true, color: C.white, size: 14 }),
      tableCell("CUE / TON", { borders, m, fill: "202124", width: TELE_COLS[3], bold: true, color: C.white, size: 14 }),
    ],
  });

  let cumSec = 0;
  const rows = [header];

  for (const seg of segments) {
    const beatFills = {
      "INTRO": C.lightGray,
      "ESKALACJA": C.lightOrange,
      "ABSURD": C.lightRed,
      "PUNCHLINE 1": C.lightGreen,
      "PUNCHLINE 2": C.lightGreen,
      "PUNCHLINE 3": C.lightGreen,
      "FINISZ": C.lightBlue,
      "CALLBACK": C.lightBlue,
    };

    const fill = beatFills[seg.beat] || C.white;
    const timeStr = `${formatTime(cumSec)}\n(${seg.durationSec}s)`;

    rows.push(new TableRow({
      children: [
        // CZAS column
        new TableCell({
          borders, width: { size: TELE_COLS[0], type: WidthType.DXA },
          shading: { fill, type: ShadingType.CLEAR },
          margins: m,
          children: [
            new Paragraph({ children: [new TextRun({ text: formatTime(cumSec), bold: true, font: "Arial", size: 14, color: C.black })] }),
            new Paragraph({ children: [new TextRun({ text: `(${seg.durationSec}s)`, font: "Arial", size: 12, color: C.gray })] }),
          ],
        }),
        // BEAT column
        tableCell(seg.beat, { borders, m, fill, width: TELE_COLS[1], bold: true, size: 16, color: C.black }),
        // TEKST column — large, readable for teleprompter
        new TableCell({
          borders, width: { size: TELE_COLS[2], type: WidthType.DXA },
          shading: { fill, type: ShadingType.CLEAR },
          margins: m,
          children: [new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: seg.text, font: "Arial", size: 22, color: C.black })],
          })],
        }),
        // CUE + TON column
        new TableCell({
          borders, width: { size: TELE_COLS[3], type: WidthType.DXA },
          shading: { fill, type: ShadingType.CLEAR },
          margins: m,
          children: [
            new Paragraph({ children: [new TextRun({ text: seg.cue, font: "Arial", size: 13, color: C.blue, italics: true })] }),
            new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `🎭 ${seg.tone}`, font: "Arial", size: 12, color: C.purple })] }),
          ],
        }),
      ],
    }));

    cumSec += seg.durationSec;
  }

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: TELE_COLS,
    rows,
  });
}


// ═══ UTILITIES ═══

function tableCell(text, opts = {}) {
  const { borders, m, fill, width, bold, color, size } = opts;
  return new TableCell({
    borders,
    width: { size: width || 1000, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: m,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: !!bold, font: "Arial", size: size || 16, color: color || C.black })],
    })],
  });
}

function formatTime(totalSec) {
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function spacer(pts = 120) {
  return new Paragraph({ spacing: { before: pts, after: pts }, children: [] });
}


// ═══ TOPIC DATA LOADER ═══
// Loads topics from phase2_v3_topics.json (exported from Phase 2 v3 generator).
// In production, this would parse the Phase 2 .docx directly.
function loadTopics(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Topics JSON not found: ${jsonPath}`);
  }
  return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
}


// ═══ MAIN ═══
async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let styleName = "default_daylik";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--style" && args[i + 1]) styleName = args[++i];
  }

  // Load style packet
  const styleDir = path.join(__dirname, "styles");
  const stylePath = path.join(styleDir, `${styleName}.md`);
  if (!fs.existsSync(stylePath)) {
    console.error(`❌ Style packet not found: ${stylePath}`);
    process.exit(1);
  }
  const styleContent = fs.readFileSync(stylePath, "utf-8");
  const style = parseStylePacket(styleContent);
  console.log(`✅ Loaded style: ${style.name} (${style.wordsPerMinute} wpm, vulgarity ${style.vulgarityLevel}/5)`);

  // Load topics from Phase 2 v3 generator
  // Load topics from JSON
  const topicsPath = path.join(__dirname, "phase2_v3_topics.json");
  let topics;
  try {
    topics = loadTopics(topicsPath);
    console.log(`✅ Loaded ${topics.length} topics from phase2_v3_topics.json`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  // ══ PASS 1: DRAFT ══
  console.log("\n═══ PASS 1: DRAFT ═══");
  const draftResults = topics.map(topic => {
    const segments = draftPass(topic, style);
    const totalWords = segments.reduce((s, seg) => s + seg.wordCount, 0);
    const totalSec = segments.reduce((s, seg) => s + seg.durationSec, 0);
    console.log(`  📝 ${topic.id}: ${topic.title.substring(0, 50)}... → ${totalWords} słów, ${formatTime(totalSec)}`);
    return { topic, segments };
  });

  // ══ PASS 2: POLISH ══
  console.log("\n═══ PASS 2: POLISH ═══");
  const allTopics = topics; // For cross-segment callback detection
  const polishedResults = draftResults.map(({ topic, segments }) => {
    const { segments: polished, meta } = polishPass(segments, topic, style, allTopics);
    const noteCount = polished.reduce((s, seg) => s + (seg.polishNotes?.length || 0), 0);
    console.log(`  🔧 ${topic.id}: ${meta.timingNote} | ${noteCount} notes`);
    if (meta.narrativeNote) console.log(`     ${meta.narrativeNote}`);
    return { topic, segments: polished, meta };
  });

  // ══ GENERATE DOCX ══
  console.log("\n═══ GENERATING DOCX ═══");
  const outputFileName = `Daylik_Teleprompter_${styleName}.docx`;
  const outputDir = path.resolve(__dirname, "..");
  const outputPath = path.join(outputDir, outputFileName);

  const doc = generateTeleprompterDocx(polishedResults, style, outputPath);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  const sizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`\n✅ Output: ${outputPath}`);
  console.log(`   Size: ${sizeKB} KB`);
  console.log(`   Topics: ${polishedResults.length}`);
  console.log(`   Total show time: ${formatTime(polishedResults.reduce((s, r) => s + r.meta.totalSec, 0))}`);

  // ── Summary ──
  console.log("\n═══ SUMMARY ═══");
  for (const r of polishedResults) {
    const icon = r.meta.withinTarget ? "✅" : "⚠️";
    console.log(`  ${icon} ${r.topic.type} ${r.topic.id}: ${r.meta.totalMin} min (${r.meta.totalWords} words) — ${r.topic.title.substring(0, 40)}...`);
  }
}

main().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
