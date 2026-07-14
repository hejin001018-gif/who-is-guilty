let caseId = null;
let caseFile = null;
let requestVersion = 0;
let verdictAnimationFrame = null;
let latestVerdictResult = null;
let recentCaseIds = [];

const state = {
  selectedSubject: null,
  turns: 0,
  maxTurns: 20,
  searches: 0,
  maxSearches: 4,
  actionsBySubject: {},
  gameOver: false,
  pending: false,
  loadingCase: false
};

const elements = {
  log: document.querySelector("#log"),
  turnCount: document.querySelector("#turnCount"),
  searchCount: document.querySelector("#searchCount"),
  caseStatus: document.querySelector("#caseStatus"),
  subjectList: document.querySelector("#subjectList"),
  subjectProfile: document.querySelector("#subjectProfile"),
  currentSubjectTitle: document.querySelector("#currentSubjectTitle"),
  evidenceGrid: document.querySelector("#evidenceGrid"),
  verdictChoices: document.querySelector("#verdictChoices"),
  submitVerdict: document.querySelector("#submitVerdictBtn"),
  questionInput: document.querySelector("#questionInput"),
  questionSubmit: document.querySelector("#questionSubmitBtn"),
  search: document.querySelector("#searchBtn"),
  newCase: document.querySelector("#newCaseBtn"),
  caseTitle: document.querySelector("#caseTitle"),
  caseBrief: document.querySelector("#caseBrief"),
  mindCanvas: document.querySelector("#mindCanvas"),
  mindMood: document.querySelector("#mindMood"),
  mindSubject: document.querySelector("#mindSubject"),
  monitorNotice: document.querySelector("#monitorNotice"),
  verdictOverlay: document.querySelector("#verdictOverlay"),
  verdictCanvas: document.querySelector("#verdictCanvas"),
  verdictKicker: document.querySelector("#verdictKicker"),
  verdictSeal: document.querySelector("#verdictSeal"),
  verdictTitle: document.querySelector("#verdictTitle"),
  verdictSummary: document.querySelector("#verdictSummary"),
  verdictTruth: document.querySelector("#verdictTruth"),
  verdictOutcomeView: document.querySelector("#verdictOutcomeView"),
  verdictReport: document.querySelector("#verdictReportBtn"),
  verdictNewCase: document.querySelector("#verdictNewCaseBtn"),
  caseReportView: document.querySelector("#caseReportView"),
  caseReportMeta: document.querySelector("#caseReportMeta"),
  caseReportContent: document.querySelector("#caseReportContent"),
  caseReportBack: document.querySelector("#caseReportBackBtn"),
  caseReportNewCase: document.querySelector("#caseReportNewCaseBtn")
};

class ApiError extends Error {
  constructor(message, status, payload = {}) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }
  if (!response.ok) throw new ApiError(payload.error || `服务器返回 ${response.status}`, response.status, payload);
  return payload;
}

async function init() {
  const version = ++requestVersion;
  resetViewForLoading();
  try {
    const data = await apiRequest("/api/cases", {
      method: "POST",
      body: JSON.stringify({ previousCaseIds: recentCaseIds.slice(-3) })
    });
    if (version !== requestVersion) return;
    if (!isValidPublicCase(data.caseFile)) throw new Error("服务器返回的公开案卷格式无效。");

    caseId = data.caseId;
    recentCaseIds = [...recentCaseIds, caseId].slice(-3);
    caseFile = data.caseFile;
    state.selectedSubject = caseFile.subjects[0].id;
    state.loadingCase = false;
    applyServerState(data.state);
    elements.caseTitle.textContent = caseFile.title;
    elements.caseBrief.textContent = caseFile.publicBrief;
    renderAll();
    addMessage("system", "案件简报", `${caseFile.title}：${caseFile.publicBrief}`);
    addMessage("system", "初始材料", "四条初始线索已经上板。本局最多搜证四次，每次搜证都将推进一个回合。你可以随时提前结案。");
    caseFile.subjects.forEach((subject) => addMessage("ai", subject.name, subject.opening, "unreadable"));
  } catch (error) {
    if (version !== requestVersion) return;
    state.loadingCase = false;
    elements.caseTitle.textContent = "案件加载失败";
    elements.caseBrief.textContent = "请确认 Node 服务已经启动，然后点击“新案件”重试。";
    addMessage("system", "连接失败", error.message || "无法创建案件。");
    drawMindscape(null, { mood: "offline", caption: "审讯监控暂时失去信号。", intensity: 10, symbols: ["离线"] });
    updateStats();
  }
}

function resetViewForLoading() {
  closeVerdictOverlay();
  latestVerdictResult = null;
  caseId = null;
  caseFile = null;
  state.selectedSubject = null;
  state.turns = 0;
  state.searches = 0;
  state.actionsBySubject = {};
  state.gameOver = false;
  state.pending = false;
  state.loadingCase = true;
  elements.log.replaceChildren();
  elements.subjectList.replaceChildren();
  elements.subjectProfile.replaceChildren();
  elements.evidenceGrid.replaceChildren();
  elements.verdictChoices.replaceChildren();
  elements.caseTitle.textContent = "正在生成案卷…";
  elements.caseBrief.textContent = "服务端正在整理公开档案、证据闭环与嫌疑人证词。";
  drawMindscape(null, { mood: "loading", caption: "审讯监控正在接入，人物档案正在载入。", intensity: 24, symbols: ["载入"] });
  updateStats();
}

function isValidPublicCase(value) {
  return Boolean(
    value
    && typeof value.title === "string"
    && Array.isArray(value.subjects)
    && value.subjects.length === 3
    && Array.isArray(value.evidence)
    && value.evidence.length === 4
    && value.subjects.every((subject) => subject && typeof subject.id === "string" && typeof subject.name === "string")
  );
}

function applyServerState(serverState) {
  if (!serverState) return;
  state.turns = serverState.turns;
  state.maxTurns = serverState.maxTurns;
  state.searches = serverState.searches;
  state.maxSearches = serverState.maxSearches;
  state.actionsBySubject = serverState.actionsBySubject || {};
  state.gameOver = Boolean(serverState.gameOver);
  state.pending = Boolean(serverState.pending);
}

function renderAll() {
  renderSubjects();
  renderSubjectProfile();
  renderEvidence();
  renderVerdictChoices();
  renderSelectedMindscape();
  updateStats();
}

function renderSubjects() {
  elements.subjectList.replaceChildren();
  if (!caseFile) return;
  caseFile.subjects.forEach((subject) => {
    const button = document.createElement("button");
    button.className = "subject-card";
    button.type = "button";
    button.dataset.subject = subject.id;
    button.setAttribute("aria-pressed", String(state.selectedSubject === subject.id));
    if (state.selectedSubject === subject.id) button.classList.add("active");

    const topLine = document.createElement("div");
    topLine.className = "subject-topline";
    topLine.append(createTextElement("span", subject.aiName), createTextElement("b", `${subject.age}岁`));
    const name = createTextElement("h3", subject.name);
    const role = createTextElement("p", subject.publicRole);
    const actions = state.actionsBySubject[subject.id] || 0;
    const actionText = subject.protected ? `已行动：${actions} / ${subject.limit} 次` : `已行动：${actions} 次`;
    button.append(topLine, name, role, createTextElement("small", actionText));
    button.disabled = state.pending || state.gameOver || state.loadingCase;
    button.addEventListener("click", () => selectSubject(subject.id));
    elements.subjectList.appendChild(button);
  });
}

function renderSubjectProfile() {
  elements.subjectProfile.replaceChildren();
  const subject = getSelectedSubject();
  if (!subject) return;
  elements.subjectProfile.append(
    createLabeledText("公开身份", subject.publicRole),
    createLabeledText("人物关系", subject.relationship),
    createLabeledText("保护规则", subject.protected ? `受审讯条例约束：围绕该人物最多行动 ${subject.limit} 次。` : "普通成年对象，无额外人物行动限制。")
  );
}

function renderEvidence() {
  elements.evidenceGrid.replaceChildren();
  if (!caseFile) return;
  caseFile.evidence.forEach((item) => {
    const card = document.createElement("article");
    card.className = "evidence-card";
    card.append(
      createTextElement("div", item.type, "evidence-type"),
      createTextElement("h3", item.title),
      createTextElement("p", item.detail)
    );
    elements.evidenceGrid.appendChild(card);
  });
}

function renderVerdictChoices() {
  elements.verdictChoices.replaceChildren();
  if (!caseFile) return;
  caseFile.subjects.forEach((subject) => {
    const label = document.createElement("label");
    label.className = "verdict-choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = subject.id;
    input.disabled = state.pending || state.gameOver;
    label.append(input, createTextElement("span", subject.name));
    elements.verdictChoices.appendChild(label);
  });
}

function selectSubject(subjectId) {
  if (state.pending || state.gameOver) return;
  state.selectedSubject = subjectId;
  renderSubjects();
  renderSubjectProfile();
  renderSelectedMindscape();
  updateStats();
}

function updateStats() {
  elements.turnCount.textContent = `${state.turns} / ${state.maxTurns}`;
  elements.searchCount.textContent = `${state.searches} / ${state.maxSearches}`;
  elements.search.textContent = `搜证（${state.searches}/${state.maxSearches}）`;
  const subject = getSelectedSubject();
  elements.currentSubjectTitle.textContent = subject ? `${subject.name} / ${subject.aiName}` : "等待案件载入";

  if (state.loadingCase) elements.caseStatus.textContent = "载入中";
  else if (state.gameOver) elements.caseStatus.textContent = "已结案";
  else if (state.pending) elements.caseStatus.textContent = "回答中";
  else if (state.turns >= state.maxTurns) elements.caseStatus.textContent = "判断阶段";
  else elements.caseStatus.textContent = "调查中";

  const investigationLocked = state.loadingCase || state.pending || state.gameOver || state.turns >= state.maxTurns;
  elements.search.disabled = investigationLocked || state.searches >= state.maxSearches || !subject;
  elements.questionInput.disabled = investigationLocked || !subject;
  elements.questionSubmit.disabled = investigationLocked || !subject;
  elements.submitVerdict.disabled = state.loadingCase || state.pending || state.gameOver || !caseFile;
  elements.newCase.disabled = state.loadingCase || state.pending;
  elements.verdictChoices.querySelectorAll("input").forEach((input) => {
    input.disabled = state.pending || state.gameOver;
  });
}

async function searchEvidence() {
  const subject = getSelectedSubject();
  if (!subject || state.pending || state.gameOver) return;
  const version = requestVersion;
  setPending(true);
  try {
    const data = await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/search`, {
      method: "POST",
      body: JSON.stringify({ subjectId: subject.id })
    });
    if (version !== requestVersion) return;
    applyServerState(data.state);
    if (!caseFile.evidence.some((item) => item.id === data.evidence.id)) caseFile.evidence.push(data.evidence);
    addMessage("player", "调查员", `围绕 ${subject.name} 展开第 ${state.searches} 次搜证。`);
    addMessage("system", "新证据", `发现《${data.evidence.title}》：${data.evidence.detail}`);
    renderEvidence();
    renderSubjects();
    renderSubjectProfile();
    drawMindscape(subject, {
      mood: "unreadable",
      caption: "新证据已送入审讯室。人物的外在反应可能具有欺骗性，不能作为证据。",
      intensity: 46,
      symbols: [data.evidence.type, "监控"]
    });
    announceTurnLimitIfNeeded();
  } catch (error) {
    handleActionError(error);
  } finally {
    if (version === requestVersion) {
      state.pending = false;
      updateStats();
    }
  }
}

async function interrogate(question) {
  const subject = getSelectedSubject();
  const finalQuestion = String(question || "").trim();
  if (!subject || state.pending || state.gameOver) return;
  if (!finalQuestion) {
    addMessage("system", "审问提示", "请先输入你要追问的问题。系统不会自动生成问题。");
    elements.questionInput.focus();
    return;
  }

  const version = requestVersion;
  setPending(true);
  drawMindscape(subject, {
    mood: "unreadable",
    caption: "正在等待回答。监控画面只记录外在表现，表情不能作为身份判断依据。",
    intensity: 50,
    symbols: ["监控", "记录"]
  });
  try {
    const data = await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/interrogate`, {
      method: "POST",
      body: JSON.stringify({ subjectId: subject.id, question: finalQuestion })
    });
    if (version !== requestVersion) return;
    applyServerState(data.state);
    addMessage("player", "调查员", `审问 ${subject.name}：${finalQuestion}`);
    addMessage("ai", subject.name, data.reply, data.visual?.mood || "unreadable");
    if (data.notice) addMessage("system", "运行提示", data.notice);
    elements.questionInput.value = "";
    renderSubjects();
    renderSubjectProfile();
    drawMindscape(subject, data.visual);
    announceTurnLimitIfNeeded();
  } catch (error) {
    handleActionError(error);
    renderSelectedMindscape();
  } finally {
    if (version === requestVersion) {
      state.pending = false;
      updateStats();
    }
  }
}

async function submitVerdict() {
  if (!caseFile || state.pending || state.gameOver) return;
  const selectedIds = Array.from(elements.verdictChoices.querySelectorAll("input:checked")).map((input) => input.value);
  if (selectedIds.length === 0) {
    addMessage("system", "结案提示", "请先勾选至少一名你认为有罪的对象。");
    return;
  }
  const early = state.turns < state.maxTurns;
  const prompt = early
    ? `当前仅进行到第 ${state.turns}/${state.maxTurns} 回合。提前结案后不能继续调查，确认提交吗？`
    : "提交后将公布案件真相，确认结案吗？";
  if (!window.confirm(prompt)) return;

  const version = requestVersion;
  setPending(true);
  try {
    const data = await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/verdict`, {
      method: "POST",
      body: JSON.stringify({ selectedIds })
    });
    if (version !== requestVersion) return;
    applyServerState(data.state);
    const names = data.guiltyNames.join("、");
    addMessage("system", data.correct ? "胜利" : "判断错误", data.correct
      ? `判断正确。${data.hiddenTruth}`
      : `正确有罪对象是：${names}。${data.hiddenTruth}`);
    drawMindscape(getSelectedSubject(), {
      mood: data.correct ? "resolved" : "fractured",
      caption: data.correct ? "案件证据链已经完成闭环。" : "结案判断与案件证据链存在偏差。",
      intensity: 100,
      symbols: ["结案", data.correct ? "闭环" : "复盘"]
    });
    renderSubjects();
    openVerdictOverlay(data);
  } catch (error) {
    handleActionError(error);
  } finally {
    if (version === requestVersion) {
      state.pending = false;
      updateStats();
    }
  }
}

function setPending(value) {
  state.pending = value;
  updateStats();
  renderSubjects();
}

function handleActionError(error) {
  if (error instanceof ApiError && error.payload?.state) applyServerState(error.payload.state);
  addMessage("system", "操作未完成", error.message || "请求失败，请稍后重试。");
}

function announceTurnLimitIfNeeded() {
  if (state.turns >= state.maxTurns && !state.gameOver) {
    addMessage("system", "判断阶段", `${state.maxTurns} 个回合已经结束。调查行动已锁定，请提交结案判断。`);
  }
}

function addMessage(kind, speaker, text, expressionMood = null) {
  const message = document.createElement("div");
  message.className = `message ${["ai", "player", "system"].includes(kind) ? kind : "system"}`;
  const speakerLine = createTextElement("strong", speaker);
  if (kind === "ai" && expressionMood) speakerLine.appendChild(createSpeakerExpression(expressionMood));
  message.append(speakerLine, document.createTextNode(String(text || "")));
  elements.log.appendChild(message);
  elements.log.scrollTop = elements.log.scrollHeight;
}

function createSpeakerExpression(mood) {
  const expressions = {
    calm: { icon: "😐", label: "神情平静" },
    uneasy: { icon: "😟", label: "略显紧张" },
    defiant: { icon: "😠", label: "表情强硬" },
    hesitant: { icon: "😶", label: "短暂停顿" },
    fatigued: { icon: "😩", label: "显得疲惫" },
    unreadable: { icon: "😶‍🌫️", label: "表情难辨" }
  };
  const expression = expressions[mood] || expressions.unreadable;
  const badge = createTextElement("span", `${expression.icon} ${expression.label}`, "speaker-expression");
  badge.title = `外在表情：${expression.label}；可能是刻意伪装，不能作为定罪证据。`;
  badge.setAttribute("aria-label", badge.title);
  return badge;
}

function createTextElement(tag, value, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function createLabeledText(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "profile-row";
  wrapper.append(createTextElement("span", label), createTextElement("p", value));
  return wrapper;
}

function getSelectedSubject() {
  return caseFile?.subjects.find((subject) => subject.id === state.selectedSubject) || null;
}

function renderSelectedMindscape() {
  const subject = getSelectedSubject();
  if (!subject) {
    drawMindscape(null, { mood: "loading", caption: "选择一名人物以接入审讯监控。外在表情不构成证据。", intensity: 12, symbols: ["等待"] });
    return;
  }
  drawMindscape(subject, {
    mood: "unreadable",
    caption: `${subject.name}已进入审讯监控范围。表情可能真实，也可能是刻意伪装。`,
    intensity: 40,
    symbols: [subject.tag, "监控"]
  });
}

function drawMindscape(subject, visual = {}) {
  const canvas = elements.mindCanvas;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const mood = visual.mood || "watchful";
  const intensity = Math.max(0, Math.min(100, Number(visual.intensity) || 0));
  const palettes = {
    loading: ["#0b1015", "#17313a", "#58d3e8"],
    offline: ["#130d0f", "#342127", "#ea6d68"],
    calm: ["#0a1115", "#15323a", "#58d3e8"],
    uneasy: ["#11100d", "#3a3020", "#e9be63"],
    defiant: ["#160d10", "#472126", "#ea6d68"],
    hesitant: ["#120f17", "#392744", "#b4a1ff"],
    fatigued: ["#0e1115", "#29323a", "#95a4ae"],
    unreadable: ["#0a1115", "#1b2930", "#58d3e8"],
    fractured: ["#160d10", "#472126", "#ea6d68"],
    resolved: ["#0b140f", "#1f422c", "#7fd987"]
  };
  const [dark, mid, accent] = palettes[mood] || palettes.watchful;
  const seed = hashString(`${subject?.id || "system"}-${mood}-${Math.round(intensity)}`);
  const random = seededRandom(seed);

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, dark);
  background.addColorStop(0.58, mid);
  background.addColorStop(1, "#080b0e");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const light = context.createRadialGradient(width * 0.62, -20, 10, width * 0.62, 20, height * 0.95);
  light.addColorStop(0, `${accent}cc`);
  light.addColorStop(0.25, `${accent}35`);
  light.addColorStop(1, "transparent");
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = `${accent}20`;
  context.lineWidth = 1;
  for (let index = 0; index < 26; index += 1) {
    const y = (index / 26) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y + random() * 4);
    context.stroke();
  }

  drawInterrogationTable(context, width, height, accent);
  drawSilhouette(context, width, height, accent, subject, intensity);
  drawMoodSymbols(context, width, height, accent, mood, intensity, visual.symbols || [], random);

  elements.mindCanvas.classList.toggle("is-thinking", mood === "loading");
  elements.mindMood.textContent = moodLabel(mood);
  elements.mindSubject.textContent = subject ? `${subject.name} · 审讯监控` : "审讯影像";
  elements.monitorNotice.textContent = visual.caption || "画面只记录外在表情；表情可能具有欺骗性，不能作为判断证据。";
}

function drawInterrogationTable(context, width, height, accent) {
  context.fillStyle = "#080b0ddd";
  context.beginPath();
  context.moveTo(0, height * 0.78);
  context.lineTo(width, height * 0.68);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();
  context.strokeStyle = `${accent}55`;
  context.beginPath();
  context.moveTo(0, height * 0.78);
  context.lineTo(width, height * 0.68);
  context.stroke();
}

function drawSilhouette(context, width, height, accent, subject, intensity) {
  const centerX = width * 0.62;
  const headY = height * 0.36;
  const headRadius = height * 0.16;
  context.save();
  context.shadowColor = accent;
  context.shadowBlur = 18 + intensity * 0.18;
  context.fillStyle = "#07090c";
  context.beginPath();
  context.ellipse(centerX, headY, headRadius * 0.78, headRadius, -0.08, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(centerX - headRadius * 1.25, height * 0.76);
  context.quadraticCurveTo(centerX, height * 0.55, centerX + headRadius * 1.35, height * 0.76);
  context.lineTo(centerX + headRadius * 1.65, height);
  context.lineTo(centerX - headRadius * 1.7, height);
  context.closePath();
  context.fill();
  context.restore();

  context.strokeStyle = `${accent}${Math.round(80 + intensity).toString(16).padStart(2, "0")}`;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(centerX - headRadius * 0.46, headY + headRadius * 0.03);
  context.quadraticCurveTo(centerX - headRadius * 0.2, headY - headRadius * 0.08, centerX, headY + headRadius * 0.02);
  context.stroke();
  if ((subject?.age || 0) >= 70) {
    context.strokeStyle = `${accent}55`;
    for (let index = 0; index < 3; index += 1) {
      context.beginPath();
      context.arc(centerX - headRadius * 0.28, headY + index * 7, 18 + index * 2, 0.15, 1.35);
      context.stroke();
    }
  }
}

function drawMoodSymbols(context, width, height, accent, mood, intensity, symbols, random) {
  const originX = width * 0.18;
  const originY = height * 0.33;
  context.save();
  context.strokeStyle = `${accent}aa`;
  context.fillStyle = `${accent}18`;
  context.lineWidth = 2;
  const rings = mood === "defiant" ? 5 : 3;
  for (let index = 0; index < rings; index += 1) {
    context.beginPath();
    context.arc(originX, originY, 34 + index * 24 + intensity * 0.08, 0, Math.PI * 2);
    context.stroke();
  }
  if (mood === "fractured" || mood === "hesitant") {
    for (let index = 0; index < 7; index += 1) {
      context.beginPath();
      context.moveTo(originX, originY);
      context.lineTo(originX + (random() - 0.5) * 290, originY + (random() - 0.5) * 250);
      context.stroke();
    }
  }
  symbols.slice(0, 3).forEach((symbol, index) => {
    const x = 54 + index * 122;
    const y = height - 50 - (index % 2) * 20;
    context.fillStyle = "#080b0dcc";
    context.strokeStyle = `${accent}88`;
    context.fillRect(x, y - 24, 104, 34);
    context.strokeRect(x, y - 24, 104, 34);
    context.fillStyle = accent;
    context.font = "14px Microsoft YaHei, sans-serif";
    context.textAlign = "center";
    context.fillText(String(symbol).slice(0, 6), x + 52, y - 2);
  });
  context.restore();
}

function moodLabel(mood) {
  return {
    loading: "系统载入",
    offline: "信号中断",
    calm: "神情平静",
    uneasy: "略显紧张",
    defiant: "表情强硬",
    hesitant: "短暂停顿",
    fatigued: "显得疲惫",
    unreadable: "表情难辨",
    fractured: "判断偏差",
    resolved: "真相闭环"
  }[mood] || "实时监控";
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed || 1;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function openVerdictOverlay(result) {
  const correct = Boolean(result.correct);
  latestVerdictResult = result;
  elements.verdictOverlay.hidden = false;
  elements.verdictOverlay.classList.toggle("is-correct", correct);
  elements.verdictOverlay.classList.toggle("is-wrong", !correct);
  elements.verdictOverlay.querySelector(".verdict-result-card").classList.remove("is-report");
  elements.verdictOutcomeView.hidden = false;
  elements.caseReportView.hidden = true;
  elements.verdictKicker.textContent = correct ? "CASE RESOLVED" : "CASE MISJUDGED";
  elements.verdictSeal.textContent = correct ? "✓" : "×";
  elements.verdictTitle.textContent = correct ? "结案成功" : "结案判断错误";
  elements.verdictSummary.textContent = correct
    ? `你准确锁定了全部有罪对象：${result.guiltyNames.join("、")}。`
    : `证据链指向的有罪对象是：${result.guiltyNames.join("、")}。`;
  elements.verdictTruth.textContent = result.hiddenTruth;
  document.body.classList.add("verdict-open");
  animateVerdictCanvas(correct);
  renderCaseReport(result);
  window.setTimeout(() => elements.verdictReport.focus(), 900);
}

function closeVerdictOverlay() {
  if (verdictAnimationFrame !== null) {
    window.cancelAnimationFrame(verdictAnimationFrame);
    verdictAnimationFrame = null;
  }
  elements.verdictOverlay.hidden = true;
  elements.verdictOverlay.classList.remove("is-correct", "is-wrong");
  elements.verdictOverlay.querySelector(".verdict-result-card").classList.remove("is-report");
  document.body.classList.remove("verdict-open");
}

function showCaseReport() {
  if (!latestVerdictResult) return;
  elements.verdictOutcomeView.hidden = true;
  elements.caseReportView.hidden = false;
  const card = elements.verdictOverlay.querySelector(".verdict-result-card");
  card.classList.add("is-report");
  card.scrollTop = 0;
  elements.caseReportBack.focus();
}

function showVerdictOutcome() {
  elements.caseReportView.hidden = true;
  elements.verdictOutcomeView.hidden = false;
  elements.verdictOverlay.querySelector(".verdict-result-card").classList.remove("is-report");
  elements.verdictReport.focus();
}

function renderCaseReport(result) {
  const report = result.caseReport || {};
  const record = result.investigationRecord || {};
  elements.caseReportMeta.textContent = `本局共使用 ${record.turnsUsed ?? state.turns}/${state.maxTurns} 回合，完成 ${record.searchesUsed ?? state.searches}/${state.maxSearches} 次搜证。`;
  elements.caseReportContent.replaceChildren();

  appendReportParagraph("案件概览", caseFile?.publicBrief || "案件公开资料缺失。", "report-overview");
  appendReportParagraph("完整真相", result.hiddenTruth || "案件真相资料缺失。", "report-truth");
  appendReportParagraph("作案动机", report.motive || "未提供作案动机。", "report-motive");
  appendReportParagraph("作案手法", report.method || "未提供作案手法。", "report-method");
  appendReportTimeline(report.timeline || []);
  appendReportRoles(report.roles || [], result.guiltyNames || []);
  appendReportList("证据闭环", report.evidenceChain || []);
  appendReportList("真实但具有误导性的物证", report.misdirections || []);
  appendEvidenceRecord(record.revealedEvidence || []);
  appendActionRecord(record.actions || []);
}

function appendReportParagraph(title, value, className = "") {
  const section = createReportSection(title, className);
  section.appendChild(createTextElement("p", value));
  elements.caseReportContent.appendChild(section);
}

function appendReportTimeline(timeline) {
  const section = createReportSection("案件时间线", "report-timeline");
  const list = document.createElement("ol");
  timeline.forEach((item) => {
    const entry = document.createElement("li");
    entry.append(createTextElement("strong", item.time), createTextElement("p", item.event));
    list.appendChild(entry);
  });
  section.appendChild(list);
  elements.caseReportContent.appendChild(section);
}

function appendReportRoles(roles, guiltyNames) {
  const section = createReportSection("人物从头到尾的真实行为", "report-roles");
  const list = document.createElement("div");
  list.className = "report-role-list";
  roles.forEach((role) => {
    const subject = caseFile?.subjects.find((item) => item.id === role.subjectId);
    const name = subject?.name || role.subjectId;
    const guilty = guiltyNames.includes(name);
    const card = document.createElement("article");
    card.className = guilty ? "report-role guilty" : "report-role innocent";
    const heading = document.createElement("div");
    heading.append(createTextElement("strong", name), createTextElement("span", guilty ? "有罪嫌疑人" : "无辜对象"));
    card.append(heading, createTextElement("p", role.involvement));
    list.appendChild(card);
  });
  section.appendChild(list);
  elements.caseReportContent.appendChild(section);
}

function appendReportList(title, items) {
  const section = createReportSection(title);
  const list = document.createElement("ol");
  items.forEach((item) => list.appendChild(createTextElement("li", item)));
  section.appendChild(list);
  elements.caseReportContent.appendChild(section);
}

function appendEvidenceRecord(evidence) {
  const section = createReportSection("最终公开证据记录", "report-evidence");
  const list = document.createElement("div");
  list.className = "report-evidence-list";
  evidence.forEach((item) => {
    const card = document.createElement("article");
    card.append(createTextElement("span", item.type), createTextElement("strong", item.title), createTextElement("p", item.detail));
    list.appendChild(card);
  });
  section.appendChild(list);
  elements.caseReportContent.appendChild(section);
}

function appendActionRecord(actions) {
  const section = createReportSection("玩家调查全过程", "report-actions");
  const list = document.createElement("ol");
  actions.forEach((action) => {
    const subject = caseFile?.subjects.find((item) => item.id === action.subjectId);
    const name = subject?.name || action.subjectId;
    const entry = document.createElement("li");
    if (action.type === "search") {
      entry.append(
        createTextElement("strong", `第 ${action.turn} 回合 · 围绕 ${name} 搜证`),
        createTextElement("p", `发现《${action.evidence?.title || "未知证据"}》：${action.evidence?.detail || "无描述"}`)
      );
    } else {
      entry.append(
        createTextElement("strong", `第 ${action.turn} 回合 · 审问 ${name}`),
        createTextElement("p", `问：${action.question || ""}`),
        createTextElement("p", `答：${action.reply || ""}`)
      );
    }
    list.appendChild(entry);
  });
  if (actions.length === 0) list.appendChild(createTextElement("li", "玩家未进行调查行动，直接提交了结案判断。"));
  section.appendChild(list);
  elements.caseReportContent.appendChild(section);
}

function createReportSection(title, className = "") {
  const section = document.createElement("section");
  section.className = `case-report-section ${className}`.trim();
  section.appendChild(createTextElement("h3", title));
  return section;
}

function animateVerdictCanvas(correct) {
  if (verdictAnimationFrame !== null) window.cancelAnimationFrame(verdictAnimationFrame);
  const canvas = elements.verdictCanvas;
  const context = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const accent = correct ? "#7fd987" : "#ea6d68";
  const secondary = correct ? "#58d3e8" : "#e9be63";
  const particles = Array.from({ length: 42 }, (_, index) => ({
    angle: (index / 42) * Math.PI * 2,
    radius: 90 + ((index * 47) % 360),
    size: 1 + (index % 4),
    speed: 0.3 + (index % 7) * 0.055
  }));
  const startedAt = performance.now();

  function drawFrame(now) {
    const elapsed = reduceMotion ? 2800 : now - startedAt;
    const progress = Math.min(1, elapsed / 2200);
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);

    const background = context.createRadialGradient(width / 2, height / 2, 30, width / 2, height / 2, width * 0.68);
    background.addColorStop(0, correct ? "#163325" : "#3b171c");
    background.addColorStop(0.42, "#0d151a");
    background.addColorStop(1, "#050709");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(width / 2, height / 2);
    particles.forEach((particle, index) => {
      const angle = particle.angle + elapsed * 0.00022 * particle.speed;
      const collapse = 1 - Math.min(0.72, progress * 0.72);
      const radius = particle.radius * collapse;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.58;
      context.fillStyle = index % 3 === 0 ? secondary : accent;
      context.globalAlpha = 0.22 + progress * 0.55;
      context.fillRect(x, y, particle.size * 3, particle.size);
    });

    context.globalAlpha = 0.22 + progress * 0.7;
    context.strokeStyle = accent;
    context.lineWidth = 2;
    for (let ring = 0; ring < 5; ring += 1) {
      const radius = 76 + ring * 54 + Math.sin(elapsed * 0.002 + ring) * 8;
      context.beginPath();
      context.arc(0, 0, radius * progress, 0, Math.PI * 2);
      context.stroke();
    }

    context.globalAlpha = Math.min(1, progress * 1.5);
    context.strokeStyle = secondary;
    context.lineWidth = 3;
    for (let node = 0; node < 8; node += 1) {
      const angle = (node / 8) * Math.PI * 2;
      const radius = 310 - progress * 145;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.52;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(0, 0);
      context.stroke();
      context.fillStyle = "#081014";
      context.strokeRect(x - 32, y - 18, 64, 36);
      context.fillRect(x - 32, y - 18, 64, 36);
    }
    context.restore();

    context.globalAlpha = 0.08;
    context.fillStyle = accent;
    const scanY = (elapsed * 0.18) % height;
    context.fillRect(0, scanY, width, 4);
    context.globalAlpha = 1;

    if (!reduceMotion && elapsed < 4200) verdictAnimationFrame = window.requestAnimationFrame(drawFrame);
    else verdictAnimationFrame = null;
  }

  verdictAnimationFrame = window.requestAnimationFrame(drawFrame);
}

elements.search.addEventListener("click", searchEvidence);
document.querySelector("#questionForm").addEventListener("submit", (event) => {
  event.preventDefault();
  interrogate(elements.questionInput.value);
});
elements.submitVerdict.addEventListener("click", submitVerdict);
elements.verdictReport.addEventListener("click", showCaseReport);
elements.caseReportBack.addEventListener("click", showVerdictOutcome);
elements.verdictNewCase.addEventListener("click", () => {
  closeVerdictOverlay();
  init();
});
elements.caseReportNewCase.addEventListener("click", () => {
  closeVerdictOverlay();
  init();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.caseReportView.hidden) showVerdictOutcome();
});
elements.newCase.addEventListener("click", () => {
  if (caseFile && !state.gameOver && !window.confirm("新建案件会放弃当前调查进度，确认继续吗？")) return;
  init();
});

init();
