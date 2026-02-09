const {
  apiGet,
  apiPost,
  supportDotClass,
  createModal,
  addHoverExpand
} = window.WarCouncil;

const councilGrid = document.getElementById("councilGrid");
const planInput = document.getElementById("planInput");
const gmInput = document.getElementById("gmInput");
const publishPlan = document.getElementById("publishPlan");
const sendInput = document.getElementById("sendInput");
const generateCouncil = document.getElementById("generateCouncil");
const resetSession = document.getElementById("resetSession");

const modal = createModal();
let councilData = [];
let planDirty = false;

const renderCouncil = () => {
  councilGrid.innerHTML = "";
  councilData.forEach((councilor) => {
    const card = document.createElement("div");
    card.className = "council-card";

    const header = document.createElement("div");
    header.className = "card-header";
    const title = document.createElement("div");
    title.innerHTML = `<div class="card-title">${councilor.name}</div><div class="card-subtitle">${councilor.title} · ${councilor.region}</div>`;
    const support = document.createElement("div");
    support.className = "support";
    const supportValue = typeof councilor.support === "number" ? councilor.support : "—";
    support.innerHTML = `<span class="support-dot ${supportDotClass(councilor.support)}"></span><span>${supportValue}</span>`;
    header.appendChild(title);
    header.appendChild(support);

    const draft = document.createElement("div");
    draft.className = "draft";
    draft.textContent = councilor.draft?.speech || "No draft yet.";
    addHoverExpand(draft);

    const meta = document.createElement("div");
    meta.className = "badge";
    meta.textContent = councilor.draft?.ts ? `Drafted ${new Date(councilor.draft.ts).toLocaleTimeString()}` : "Awaiting draft";

    const actions = document.createElement("div");
    actions.className = "actions";

    const commitBtn = document.createElement("button");
    commitBtn.className = "secondary";
    commitBtn.textContent = "Commit";
    commitBtn.addEventListener("click", async () => {
      try {
        await apiPost("/api/commit", { councilorId: councilor.id });
        await refreshState();
      } catch (error) {
        alert(error.message);
      }
    });

    const speakBtn = document.createElement("button");
    speakBtn.textContent = "Speak";
    speakBtn.addEventListener("click", async () => {
      try {
        const speakRes = await apiPost("/api/speak", { councilorId: councilor.id });
        const ttsRes = await apiPost("/api/tts", { councilorId: councilor.id, text: speakRes.text });
        const audio = new Audio(ttsRes.url);
        await audio.play();
        await refreshState();
      } catch (error) {
        alert(error.message);
      }
    });

    const historyBtn = document.createElement("button");
    historyBtn.className = "secondary";
    historyBtn.textContent = "History";
    historyBtn.addEventListener("click", async () => {
      try {
        const historyRes = await apiGet(`/api/history?councilorId=${councilor.id}`);
        const content = document.createElement("div");
        const heading = document.createElement("h3");
        heading.textContent = `${councilor.name} history`;
        content.appendChild(heading);
        historyRes.history.forEach((entry) => {
          const item = document.createElement("div");
          item.className = "history-entry";
          item.innerHTML = `<strong>${entry.type.toUpperCase()}</strong> · ${new Date(entry.ts).toLocaleString()}<br/>${entry.speech}`;
          content.appendChild(item);
        });
        modal.open(content);
      } catch (error) {
        alert(error.message);
      }
    });

    actions.appendChild(commitBtn);
    actions.appendChild(speakBtn);
    actions.appendChild(historyBtn);

    card.appendChild(header);
    card.appendChild(draft);
    card.appendChild(meta);
    card.appendChild(actions);
    councilGrid.appendChild(card);
  });
};

const refreshState = async () => {
  const state = await apiGet("/api/state");
  councilData = state.council;
  if (!planDirty) {
    planInput.value = state.planText || "";
  }
  renderCouncil();
};

publishPlan.addEventListener("click", async () => {
  planDirty = false;
  try {
    await apiPost("/api/plan", { from: "gm", text: planInput.value });
    await refreshState();
  } catch (error) {
    alert(error.message);
  }
});

planInput.addEventListener("input", () => {
  planDirty = true;
});

sendInput.addEventListener("click", async () => {
  try {
    await apiPost("/api/input", { from: "gm", text: gmInput.value });
    gmInput.value = "";
  } catch (error) {
    alert(error.message);
  }
});

generateCouncil.addEventListener("click", async () => {
  const targets = [...councilData];
  targets.forEach(async (councilor) => {
    try {
      await apiPost("/api/response", { councilorId: councilor.id });
      await refreshState();
    } catch (error) {
      console.error(error);
    }
  });
});

resetSession.addEventListener("click", async () => {
  if (!confirm("Reset the session?")) {
    return;
  }
  try {
    await apiPost("/api/reset", {});
    planDirty = false;
    planInput.value = "";
    gmInput.value = "";
    await refreshState();
  } catch (error) {
    alert(error.message);
  }
});

refreshState().catch((error) => console.error(error));
