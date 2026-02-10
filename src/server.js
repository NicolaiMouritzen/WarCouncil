import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const configPath = path.join(ROOT_DIR, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const councilDir = path.join(ROOT_DIR, "data", "council");
const worldPath = path.join(ROOT_DIR, "data", "world.json");
const threatsPath = path.join(ROOT_DIR, "data", "threats.json");
const armiesPath = path.join(ROOT_DIR, "data", "armies.json");
const statePath = path.join(ROOT_DIR, config.persistence_path);
const runtimeAudioDir = path.join(ROOT_DIR, config.runtime_audio_dir);

if (!fs.existsSync(runtimeAudioDir)) {
  fs.mkdirSync(runtimeAudioDir, { recursive: true });
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));
app.use("/audio", express.static(runtimeAudioDir));

const councilors = fs
  .readdirSync(councilDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(councilDir, file), "utf-8")));

const world = JSON.parse(fs.readFileSync(worldPath, "utf-8"));
const threats = JSON.parse(fs.readFileSync(threatsPath, "utf-8"));
const armies = JSON.parse(fs.readFileSync(armiesPath, "utf-8"));

const defaultState = () => ({
  updatedIndex: 0,
  planText: "",
  lastInput: null,
  drafts: {},
  lastSpoken: {},
  support: {},
  chat: [],
  history: {},
  worldUpdates: []
});

const loadState = () => {
  if (fs.existsSync(statePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      return { ...defaultState(), ...raw };
    } catch (error) {
      console.error("Failed to read state, starting fresh", error);
    }
  }
  return defaultState();
};

let state = loadState();

const saveState = () => {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
};

const bumpUpdatedIndex = () => {
  state.updatedIndex = (state.updatedIndex || 0) + 1;
};

const publicCouncil = () =>
  councilors.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    region: c.region,
    description: c.description,
    public_agenda: c.public_agenda
  }));

const getCouncilor = (id) => councilors.find((c) => c.id === id);

const getSupportIndicator = (councilorId) => {
  const draftSupport = state.drafts[councilorId]?.support;
  if (typeof draftSupport === "number") {
    return draftSupport;
  }
  const spokenSupport = state.lastSpoken[councilorId]?.support;
  if (typeof spokenSupport === "number") {
    return spokenSupport;
  }
  return null;
};

const recordHistory = (councilorId, entry) => {
  if (!state.history[councilorId]) {
    state.history[councilorId] = [];
  }
  state.history[councilorId].unshift(entry);
};

const addChat = (from, targetName, text) => {
  const entry = {
    id: uuidv4(),
    from,
    targetName: targetName || null,
    text,
    ts: new Date().toISOString()
  };
  state.chat.push(entry);
  state.lastInput = entry;
};

const capSpeech = (speech) => {
  const maxWords = config.max_words;
  const maxSentences = config.max_sentences;
  const cleanedSpeech = speech.replace(/;/g, ".").trim();
  const sentenceParts = cleanedSpeech
    .split(/(?<=[.!?])\s+/)
    .filter((part) => part.trim().length > 0)
    .slice(0, maxSentences);
  let truncated = sentenceParts.join(" ");
  if (sentenceParts.length < 2) {
    truncated = `${truncated} I do not know. What is the specific detail you want me to confirm?`;
  }
  const words = truncated.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    truncated = words.slice(0, maxWords).join(" ").trim();
    if (!/[.!?]$/.test(truncated)) {
      truncated += ".";
    }
  }
  return truncated;
};

const buildTranscriptSummary = () => {
  const recent = state.chat.slice(-10);
  if (!recent.length) {
    return "No recent transcript.";
  }
  return recent
    .map((entry) => {
      const target = entry.targetName ? `@${entry.targetName} ` : "";
      return `${entry.from.toUpperCase()}: ${target}${entry.text}`;
    })
    .join("\n");
};

const toolDefinitions = [
  {
    type: "function",
    name: "get_travel_time",
    description: "Return additive travel days between locations using the world graph.",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string" },
        destination: { type: "string" }
      },
      required: ["origin", "destination"]
    }
  },
  {
    type: "function",
    name: "get_threat_future",
    description: "Return future stage summary for a threat in months without intervention.",
    parameters: {
      type: "object",
      properties: {
        threatId: { type: "string" },
        months: { type: "number" }
      },
      required: ["threatId", "months"]
    }
  },
  {
    type: "function",
    name: "get_armies",
    description: "Return the list of army assets.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "get_council_public",
    description: "Return the council roster with public agendas and descriptions.",
    parameters: {
      type: "object",
      properties: {}
    }
  }
];

const resolveLocationOffset = (locationName) => {
  const city = world.cities.find((c) => c.name === locationName);
  if (city) {
    return { base: city.name, offset: 0 };
  }
  const town = world.towns.find((t) => t.name === locationName);
  if (town) {
    return { base: town.nearest_city, offset: town.days_to_city };
  }
  const hamlet = world.hamlets.find((h) => h.name === locationName);
  if (hamlet) {
    const townRef = world.towns.find((t) => t.name === hamlet.nearest_town);
    if (!townRef) {
      return null;
    }
    return { base: townRef.nearest_city, offset: hamlet.days_to_town + townRef.days_to_city };
  }
  const notable = world.notable_locations.find((n) => n.name === locationName);
  if (notable) {
    if (notable.nearest_city) {
      return { base: notable.nearest_city, offset: notable.days_to_city };
    }
    if (notable.nearest_town) {
      const townRef = world.towns.find((t) => t.name === notable.nearest_town);
      if (!townRef) {
        return null;
      }
      return { base: townRef.nearest_city, offset: notable.days_to_town + townRef.days_to_city };
    }
  }
  return null;
};

const buildGraph = () => {
  const graph = new Map();
  world.cities.forEach((city) => {
    graph.set(city.name, new Map());
  });
  world.routes.forEach((route) => {
    if (!graph.has(route.from) || !graph.has(route.to)) {
      return;
    }
    graph.get(route.from).set(route.to, route.days);
    graph.get(route.to).set(route.from, route.days);
  });
  return graph;
};

const shortestPathDays = (origin, destination) => {
  const graph = buildGraph();
  if (!graph.has(origin) || !graph.has(destination)) {
    return null;
  }
  const distances = new Map();
  const visited = new Set();
  graph.forEach((_value, key) => {
    distances.set(key, Number.POSITIVE_INFINITY);
  });
  distances.set(origin, 0);

  while (visited.size < graph.size) {
    let current = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    distances.forEach((distance, node) => {
      if (!visited.has(node) && distance < currentDistance) {
        currentDistance = distance;
        current = node;
      }
    });
    if (current === null) {
      break;
    }
    if (current === destination) {
      return currentDistance;
    }
    visited.add(current);
    graph.get(current).forEach((weight, neighbor) => {
      if (visited.has(neighbor)) {
        return;
      }
      const candidate = currentDistance + weight;
      if (candidate < distances.get(neighbor)) {
        distances.set(neighbor, candidate);
      }
    });
  }
  return null;
};

const runTool = async (name, args) => {
  if (name === "get_travel_time") {
    const originInfo = resolveLocationOffset(args.origin);
    const destInfo = resolveLocationOffset(args.destination);
    if (!originInfo || !destInfo) {
      return { error: "Unknown origin or destination." };
    }
    const routeDays = shortestPathDays(originInfo.base, destInfo.base);
    if (routeDays === null) {
      return { error: "No known route between locations." };
    }
    return {
      origin: args.origin,
      destination: args.destination,
      days: originInfo.offset + routeDays + destInfo.offset
    };
  }
  if (name === "get_threat_future") {
    const threat = threats.threats.find((t) => t.id === args.threatId);
    if (!threat) {
      return { error: "Unknown threat." };
    }
    const months = Math.max(0, Number(args.months) || 0);
    const index = Math.min(threat.event_chain.length - 1, Math.floor(months / 2));
    return {
      threatId: threat.id,
      months,
      summary: threat.event_chain[index]
    };
  }
  if (name === "get_armies") {
    return armies.armies;
  }
  if (name === "get_council_public") {
    return publicCouncil();
  }
  return { error: "Unknown tool." };
};

const runCouncilorResponse = async (councilor) => {
  const lastInput = state.lastInput
    ? `${state.lastInput.from.toUpperCase()} ${state.lastInput.targetName ? `@${state.lastInput.targetName}` : ""}: ${state.lastInput.text}`
    : "No recent input.";
  const planText = state.planText || "No plan submitted.";
  const transcript = buildTranscriptSummary();
  const threatSummary = threats.threats
    .map((t) => `- ${t.name}: ${t.description} Facts: ${t.known_facts.join(" ")}`)
    .join("\n");
  const armiesSummary = armies.armies
    .map((a) => `${a.name} at ${a.location} (inf ${a.infantry}, cav ${a.cavalry}, missile ${a.missile}) abilities: ${a.abilities.join(", ")}`)
    .join("\n");
  const worldUpdates = state.worldUpdates.length ? state.worldUpdates.join("\n") : "No recent world updates.";

  const systemPrompt = `You are ${councilor.name}, ${councilor.title} of ${councilor.region}.\nCouncil purpose: advise the Imperial War Council.\nVoice style: ${councilor.voice_style}.\nPublic agenda: ${councilor.public_agenda}.\nPrivate agenda (hidden from UI): ${councilor.private_agenda}.\nRules: Do not invent facts. If you lack data, say "I do not know" and ask one specific question.\nDo not use bullet lists or semicolons. Speak in 2-5 sentences and never exceed the max sentences.\nOnly output valid JSON.`;

  const userPrompt = `Return STRICT JSON with keys: support and speech.\nSupport is integer 0-10 only if a plan exists, else null.\nSpeech must be 2-5 sentences, no bullet lists, no semicolons.\nMax sentences: ${config.max_sentences}. Max words: ${config.max_words}.\n\nContext:\nLast input: ${lastInput}\nCurrent plan: ${planText}\nWorld updates: ${worldUpdates}\nThreats:\n${threatSummary}\nArmies:\n${armiesSummary}\nRecent transcript:\n${transcript}`;

  const messages = [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: userPrompt
    }
  ];

  let response = await openai.responses.create({
    model: config.models.councilor,
    input: messages,
    tools: toolDefinitions
  });

  const toolOutputItems = [];
  while (response.output && response.output.some((item) => item.type === "function_call")) {
    const functionCalls = response.output.filter((item) => item.type === "function_call");
    const outputs = await Promise.all(
      functionCalls.map(async (call) => {
        const args = call.arguments ? JSON.parse(call.arguments) : {};
        const result = await runTool(call.name, args);
        return {
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        };
      })
    );
    toolOutputItems.push(...outputs);
    messages.push(...response.output);
    messages.push(...outputs);
    response = await openai.responses.create({
      model: config.models.councilor,
      input: messages,
      tools: toolDefinitions
    });
  }

  const text = response.output_text || "";
  let parsed = null;
  try {
    parsed = JSON.parse(text.trim());
  } catch (error) {
    parsed = { support: null, speech: "I do not know. What is the specific plan you want me to evaluate?" };
  }

  if (state.planText?.trim()) {
    if (typeof parsed.support !== "number") {
      parsed.support = null;
    }
  } else {
    parsed.support = null;
  }

  parsed.speech = capSpeech(parsed.speech || "I do not know. What is the specific plan you want me to evaluate?");

  return parsed;
};

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

app.get("/api/state", (_req, res) => {
  const council = publicCouncil().map((c) => ({
    ...c,
    support: getSupportIndicator(c.id),
    draft: state.drafts[c.id] || null,
    lastSpoken: state.lastSpoken[c.id] || null
  }));
  res.json({
    updatedIndex: state.updatedIndex || 0,
    council,
    planText: state.planText,
    lastInput: state.lastInput,
    chatCount: state.chat.length
  });
});

app.get("/api/updated", (_req, res) => {
  res.json({ updatedIndex: state.updatedIndex || 0 });
});

app.get("/api/council", (_req, res) => {
  res.json({ council: publicCouncil() });
});

app.get("/api/world", (_req, res) => {
  res.json(world);
});

app.get("/api/threats", (_req, res) => {
  res.json(threats);
});

app.get("/api/armies", (_req, res) => {
  res.json(armies);
});

app.get("/api/history", (req, res) => {
  const councilorId = req.query.councilorId;
  if (!councilorId) {
    res.status(400).json({ error: "councilorId required" });
    return;
  }
  res.json({ history: state.history[councilorId] || [] });
});

app.get("/api/chat", (_req, res) => {
  res.json({ chat: state.chat });
});

app.post("/api/reset", (_req, res) => {
  state = defaultState();
  bumpUpdatedIndex();
  saveState();
  res.json({ ok: true });
});

app.post("/api/input", (req, res) => {
  const { from, targetName, text } = req.body || {};
  if (!from || !text) {
    res.status(400).json({ error: "from and text required" });
    return;
  }
  addChat(from, targetName, text);
  bumpUpdatedIndex();
  saveState();
  res.json({ ok: true });
});

app.post("/api/plan", (req, res) => {
  const { from, text } = req.body || {};
  if (!from) {
    res.status(400).json({ error: "from required" });
    return;
  }
  state.planText = text || "";
  state.lastInput = {
    id: uuidv4(),
    from,
    targetName: null,
    text: text || "",
    ts: new Date().toISOString()
  };
  bumpUpdatedIndex();
  saveState();
  res.json({ ok: true });
});

app.post("/api/response", async (req, res) => {
  const { councilorId } = req.body || {};
  const councilor = getCouncilor(councilorId);
  if (!councilor) {
    res.status(404).json({ error: "Councilor not found" });
    return;
  }
  try {
    const result = await runCouncilorResponse(councilor);
    const draft = { ...result, ts: new Date().toISOString() };
    state.drafts[councilorId] = draft;
    recordHistory(councilorId, { type: "draft", ...draft });
    bumpUpdatedIndex();
    saveState();
    res.json({ draft });
  } catch (error) {
    console.error("Councilor response error", error);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

app.post("/api/commit", (req, res) => {
  const { councilorId } = req.body || {};
  const draft = state.drafts[councilorId];
  if (!draft) {
    res.status(400).json({ error: "No draft to commit" });
    return;
  }
  const committed = { ...draft, ts: new Date().toISOString() };
  state.lastSpoken[councilorId] = committed;
  state.support[councilorId] = committed.support;
  recordHistory(councilorId, { type: "commit", ...committed });
  bumpUpdatedIndex();
  saveState();
  res.json({ committed });
});

app.post("/api/speak", async (req, res) => {
  const { councilorId } = req.body || {};
  const draft = state.drafts[councilorId];
  if (!draft) {
    res.status(400).json({ error: "No draft to speak" });
    return;
  }
  const committed = { ...draft, ts: new Date().toISOString() };
  state.lastSpoken[councilorId] = committed;
  state.support[councilorId] = committed.support;
  recordHistory(councilorId, { type: "commit", ...committed });
  bumpUpdatedIndex();
  saveState();
  res.json({ text: committed.speech });
});

app.post("/api/tts", async (req, res) => {
  const { councilorId, text } = req.body || {};
  if (!text) {
    res.status(400).json({ error: "text required" });
    return;
  }
  const voice = config.tts_voices[councilorId] || "alloy";
  try {
    const audio = await openai.audio.speech.create({
      model: config.models.tts,
      voice,
      input: text,
      speed: 1.2,
      format: "mp3"
    });
    const buffer = Buffer.from(await audio.arrayBuffer());
    const filename = `${councilorId}-${Date.now()}.mp3`;
    const filePath = path.join(runtimeAudioDir, filename);
    fs.writeFileSync(filePath, buffer);
    res.json({ url: `/audio/${filename}` });
  } catch (error) {
    console.error("TTS error", error);
    res.status(500).json({ error: "TTS failed" });
  }
});

app.get("/gm", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "public", "gm.html"));
});

app.get("/player", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "public", "player.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`War Council running on http://localhost:${port}`);
});
