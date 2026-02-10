const {
  apiGet,
  apiPost,
  parseTarget,
  supportDotClass,
  supportTooltip,
  addHoverExpand
} = window.WarCouncil;

const councilGrid = document.getElementById("councilGrid");
const planInput = document.getElementById("planInput");
const statementInput = document.getElementById("statementInput");
const publishPlan = document.getElementById("publishPlan");
const sendStatement = document.getElementById("sendStatement");

let councilData = [];
let planDirty = false;
let lastUpdatedIndex = null;

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
    support.title = supportTooltip(councilor.support);
    support.innerHTML = `<span class="support-dot ${supportDotClass(councilor.support)}"></span><span>${supportValue}</span>`;
    header.appendChild(title);
    header.appendChild(support);

    const spoken = document.createElement("div");
    spoken.className = "draft";
    spoken.textContent = councilor.lastSpoken?.speech || "No statement yet.";
    addHoverExpand(spoken);

    const meta = document.createElement("div");
    meta.className = "badge";
    meta.textContent = councilor.lastSpoken?.ts ? `Spoken ${new Date(councilor.lastSpoken.ts).toLocaleTimeString()}` : "Awaiting statement";

    card.appendChild(header);
    card.appendChild(spoken);
    card.appendChild(meta);
    councilGrid.appendChild(card);
  });
};

const refreshState = async () => {
  const state = await apiGet("/api/state");
  lastUpdatedIndex = state.updatedIndex;
  councilData = state.council;
  if (!planDirty && document.activeElement !== planInput) {
    planInput.value = state.planText || "";
  }
  renderCouncil();
};

const refreshIfUpdated = async () => {
  const { updatedIndex } = await apiGet("/api/updated");
  if (updatedIndex !== lastUpdatedIndex) {
    await refreshState();
  }
};

publishPlan.addEventListener("click", async () => {
  planDirty = false;
  try {
    await apiPost("/api/plan", { from: "players", text: planInput.value });
    await refreshState();
  } catch (error) {
    alert(error.message);
  }
});

planInput.addEventListener("input", () => {
  planDirty = true;
});

const submitStatement = async () => {
  try {
    const parsed = parseTarget(statementInput.value, councilData);
    await apiPost("/api/input", {
      from: "players",
      targetName: parsed.targetName,
      text: parsed.text
    });
    statementInput.value = "";
  } catch (error) {
    alert(error.message);
  }
};

sendStatement.addEventListener("click", submitStatement);

statementInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitStatement();
  }
});

planInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    publishPlan.click();
  }
});

setInterval(() => {
  refreshIfUpdated().catch((error) => console.error(error));
}, 1000);
refreshState().catch((error) => console.error(error));
