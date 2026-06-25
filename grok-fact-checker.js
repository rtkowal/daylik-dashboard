#!/usr/bin/env node
/**
 * Grok API Fact-Checker — Studio toTU / Daylik Show
 *
 * Independent step in the Research Agent pipeline.
 * Takes an array of facts (strings), sends them to xAI Grok API,
 * returns each classified as: CONFIRMED / DISPUTED / UNVERIFIED
 * with reasoning and optional source.
 *
 * Usage:
 *   1. As CLI:  node grok-fact-checker.js input.json [output.json]
 *   2. As module: const { checkFacts } = require('./grok-fact-checker');
 *
 * Input JSON format:
 *   {
 *     "topic": "KSeF od 1 kwietnia",
 *     "facts": [
 *       "Od 1 kwietnia 2026 KSeF obowiązkowy dla WSZYSTKICH podatników VAT",
 *       "45% managerów dużych firm oceniło system negatywnie"
 *     ]
 *   }
 *
 * Or array of topics:
 *   [{ topic: "...", facts: [...] }, { topic: "...", facts: [...] }]
 *
 * Output JSON:
 *   [
 *     {
 *       "topic": "KSeF od 1 kwietnia",
 *       "results": [
 *         {
 *           "fact": "Od 1 kwietnia 2026 KSeF obowiązkowy...",
 *           "verdict": "CONFIRMED",
 *           "confidence": 0.95,
 *           "reasoning": "KSeF became mandatory for all VAT taxpayers...",
 *           "source": "https://...",
 *           "flag": null
 *         }
 *       ],
 *       "summary": { "confirmed": 5, "disputed": 1, "unverified": 1 }
 *     }
 *   ]
 *
 * Environment:
 *   GROK_API_KEY  — your xAI API key (required)
 *   GROK_MODEL    — model to use (default: grok-3-fast-beta)
 */

const fs = require("fs");
const path = require("path");

// ── Config ──
const API_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-3-fast-beta"; // fast + cheap; swap to grok-3-beta for higher accuracy
const MAX_FACTS_PER_CALL = 10; // batch to avoid token overflow
const TIMEOUT_MS = 60_000;

// ── System prompt for Grok ──
const SYSTEM_PROMPT = `You are a fact-checker for a Polish Daily Show-style news comedy program called "Daylik Show".
Your job is to verify factual claims that will be used on air.

RULES:
1. For each fact, determine if it is CONFIRMED, DISPUTED, or UNVERIFIED.
   - CONFIRMED: The claim is factually accurate based on your knowledge. You can find supporting evidence.
   - DISPUTED: The claim contains errors, exaggerations, or is contradicted by evidence. Explain what's wrong.
   - UNVERIFIED: You cannot confirm or deny the claim with confidence. It may be too recent or too specific.

2. Be especially careful about:
   - Political roles and titles (who holds what office, when terms ended)
   - Specific statistics and percentages (exact numbers matter)
   - Dates and timelines
   - Legal/regulatory details (what law says vs what commentary says)
   - Attributions (who said what)

3. Provide brief reasoning (1-2 sentences) for each verdict.
4. If you can identify a source, include a URL. Otherwise set source to null.
5. Assign a confidence score from 0.0 to 1.0 for your verdict.
6. If a fact is DISPUTED, include a "correction" field with the corrected version.

IMPORTANT: Facts are in Polish. Respond in Polish for reasoning, but use English for verdict labels.

Respond ONLY with valid JSON array, no markdown, no explanation outside JSON.

Response format:
[
  {
    "fact": "<original fact text>",
    "verdict": "CONFIRMED" | "DISPUTED" | "UNVERIFIED",
    "confidence": 0.0-1.0,
    "reasoning": "<brief explanation in Polish>",
    "source": "<url or null>",
    "correction": "<corrected fact if DISPUTED, else null>"
  }
]`;

// ── Core: call Grok API ──
async function callGrok(facts, apiKey, model) {
  const userMessage = `Zweryfikuj następujące fakty:\n\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;

  const body = {
    model: model || DEFAULT_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1, // low temp for factual accuracy
    response_format: { type: "json_object" },
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Grok API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error("Empty response from Grok API");

  // Parse JSON — Grok wraps in { "facts": [...] } or { "results": [...] } or direct array
  let parsed = JSON.parse(content);
  if (parsed.facts && Array.isArray(parsed.facts)) parsed = parsed.facts;
  else if (parsed.results && Array.isArray(parsed.results)) parsed = parsed.results;
  else if (parsed.data && Array.isArray(parsed.data)) parsed = parsed.data;
  else if (!Array.isArray(parsed)) {
    // Try to find any array value in the object
    const arrKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
    parsed = arrKey ? parsed[arrKey] : [parsed];
  }

  return parsed;
}

// ── Batch facts into groups of MAX_FACTS_PER_CALL ──
function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ── Main export: check all facts for one or more topics ──
async function checkFacts(input, options = {}) {
  const apiKey = options.apiKey || process.env.GROK_API_KEY;
  if (!apiKey) throw new Error("GROK_API_KEY required. Set env var or pass options.apiKey");

  const model = options.model || process.env.GROK_MODEL || DEFAULT_MODEL;
  const topics = Array.isArray(input) ? input : [input];
  const results = [];

  for (const topic of topics) {
    const { topic: topicName, facts } = topic;
    if (!facts || facts.length === 0) {
      results.push({ topic: topicName, results: [], summary: { confirmed: 0, disputed: 0, unverified: 0 } });
      continue;
    }

    console.log(`\n🔍 Checking ${facts.length} facts for: ${topicName}`);

    const batches = chunk(facts, MAX_FACTS_PER_CALL);
    let allResults = [];

    for (let i = 0; i < batches.length; i++) {
      if (batches.length > 1) console.log(`  Batch ${i + 1}/${batches.length}...`);
      const batchResults = await callGrok(batches[i], apiKey, model);
      allResults = allResults.concat(batchResults);
    }

    // Normalize and add flags
    const normalizedResults = allResults.map((r) => {
      const verdict = (r.verdict || "UNVERIFIED").toUpperCase();
      const correction = (r.correction && r.correction !== "N/A" && r.correction !== "null") ? r.correction : null;
      return {
        fact: r.fact,
        verdict,
        confidence: r.confidence ?? 0.5,
        reasoning: r.reasoning || "",
        source: (r.source && !r.source.startsWith("Lack of") && r.source !== "null") ? r.source : null,
        correction,
        flag: verdict === "DISPUTED" ? "⚠️ WYMAGA KOREKTY" : verdict === "UNVERIFIED" ? "❓ NIEZWERYFIKOWANY" : null,
      };
    });

    const summary = {
      confirmed: normalizedResults.filter((r) => r.verdict === "CONFIRMED").length,
      disputed: normalizedResults.filter((r) => r.verdict === "DISPUTED").length,
      unverified: normalizedResults.filter((r) => r.verdict === "UNVERIFIED").length,
    };

    // Print summary
    console.log(`  ✅ ${summary.confirmed} confirmed  ⚠️ ${summary.disputed} disputed  ❓ ${summary.unverified} unverified`);

    if (summary.disputed > 0) {
      console.log("\n  🚨 DISPUTED FACTS:");
      normalizedResults.filter((r) => r.verdict === "DISPUTED").forEach((r) => {
        console.log(`     ❌ "${r.fact}"`);
        console.log(`        → ${r.reasoning}`);
        if (r.correction) console.log(`        ✏️  ${r.correction}`);
      });
    }

    results.push({ topic: topicName, results: normalizedResults, summary });
  }

  return results;
}

// ── Pipeline integration: extract facts from Phase 2 topics array ──
function extractFactsFromTopics(topics) {
  return topics.map((t) => ({
    topic: t.title || t.topic || "Unknown",
    facts: t.facts || [],
  }));
}

// ── Pretty print for terminal ──
function printReport(results) {
  console.log("\n" + "═".repeat(70));
  console.log("  GROK FACT-CHECK REPORT — DAYLIK SHOW");
  console.log("═".repeat(70));

  let totalC = 0, totalD = 0, totalU = 0;

  for (const topic of results) {
    console.log(`\n📋 ${topic.topic}`);
    console.log("─".repeat(60));

    for (const r of topic.results) {
      const icon = r.verdict === "CONFIRMED" ? "✅" : r.verdict === "DISPUTED" ? "❌" : "❓";
      const conf = `[${(r.confidence * 100).toFixed(0)}%]`;
      console.log(`  ${icon} ${conf} ${r.fact}`);
      if (r.verdict !== "CONFIRMED") {
        console.log(`     → ${r.reasoning}`);
        if (r.correction) console.log(`     ✏️  Korekta: ${r.correction}`);
      }
    }

    console.log(`\n  Podsumowanie: ✅ ${topic.summary.confirmed} | ⚠️ ${topic.summary.disputed} | ❓ ${topic.summary.unverified}`);
    totalC += topic.summary.confirmed;
    totalD += topic.summary.disputed;
    totalU += topic.summary.unverified;
  }

  console.log("\n" + "═".repeat(70));
  console.log(`  TOTAL: ✅ ${totalC} confirmed | ⚠️ ${totalD} disputed | ❓ ${totalU} unverified`);
  console.log("═".repeat(70) + "\n");
}

// ── CLI ──
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Grok Fact-Checker — Daylik Show Research Agent Pipeline

Usage:
  node grok-fact-checker.js <input.json> [output.json]
  node grok-fact-checker.js --demo  (runs with sample data, needs GROK_API_KEY)

Input format:
  { "topic": "...", "facts": ["...", "..."] }
  or array of such objects

Env:
  GROK_API_KEY  — xAI API key (required)
  GROK_MODEL    — model override (default: ${DEFAULT_MODEL})
`);
    process.exit(0);
  }

  // Demo mode — use sample facts from current week
  if (args.includes("--demo")) {
    const demoInput = [
      {
        topic: "KSeF od 1 kwietnia — miliony firm wchodzą w system, który nie działa",
        facts: [
          "Od 1 kwietnia 2026 KSeF obowiązkowy dla WSZYSTKICH podatników VAT (mikro, małe, średnie firmy)",
          "45% managerów dużych firm (faza 1) oceniło system negatywnie — systemy logowania padały",
          "RPO uznał KSeF za 'narzędzie totalnej inwigilacji' przedsiębiorców",
          "MF: 'okres łaski' — bez kar do końca 2026",
          "Start 1 kwietnia = Prima Aprilis",
        ],
      },
      {
        topic: "Polska dzietność — 1.13 najniższa w historii",
        facts: [
          "Współczynnik dzietności 1.13 — najniższy w historii Polski",
          "W 2024 urodziło się 250 tys. dzieci — mniej niż w czasie II wojny światowej",
          "Koszmarne Studio to kanał o demografii prowadzony przez emerytowanego profesora",
        ],
      },
    ];

    console.log("🎭 DEMO MODE — checking sample facts from Daylik Week 3-9 April\n");
    const results = await checkFacts(demoInput);
    printReport(results);

    const outPath = args[1] || "fact-check-demo-output.json";
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`📄 Saved to ${outPath}`);
    return;
  }

  // Standard mode: read input file
  const inputPath = args[0];
  if (!inputPath) {
    console.error("❌ Provide input JSON path. Use --help for usage.");
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(inputPath), "utf8");
  let input = JSON.parse(raw);

  // If input is Phase 2 topics array (has beats/angle), extract facts
  if (Array.isArray(input) && input[0]?.beats) {
    input = extractFactsFromTopics(input);
  }

  const results = await checkFacts(input);
  printReport(results);

  const outPath = args[1] || inputPath.replace(".json", "-checked.json");
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(results, null, 2), "utf8");
  console.log(`📄 Results saved to ${outPath}`);
}

// ── Exports ──
module.exports = { checkFacts, extractFactsFromTopics, printReport, SYSTEM_PROMPT };

// Run CLI if called directly
if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });
}
