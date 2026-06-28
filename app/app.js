const STORAGE_KEY = "ustc-exam-progress-v1";
const SESSION_KEY = "ustc-exam-session-v1";

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = (window.APP_CONFIG?.dataBase || "../data").replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}

const state = {
  bank: null,
  mode: "question",
  order: "sequential",
  school: "",
  year: "",
  section: "",
  typeFilter: "choice_gradable",
  module: "",
  branch: "",
  topic: "",
  queue: [],
  index: 0,
  current: null,
  selectedAnswer: null,
  revealed: false,
  progress: loadProgress(),
};

function storageGet(key) {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    /* ignore */
  }
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadProgress() {
  try {
    return JSON.parse(storageGet(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveProgress() {
  storageSet(STORAGE_KEY, JSON.stringify(state.progress));
}

function loadSession() {
  try {
    return JSON.parse(storageGet(SESSION_KEY) || "{}");
  } catch {
    return {};
  }
}

function getResumeSnapshot() {
  return {
    mode: state.mode,
    order: state.order,
    school: state.school,
    year: state.year,
    section: state.section,
    typeFilter: state.typeFilter,
    module: state.module,
    branch: state.branch,
    topic: state.topic,
    currentId: state.current?.id ?? state.queue[state.index]?.id ?? null,
    index: state.index,
    savedAt: Date.now(),
  };
}

function saveSession() {
  storageSet(SESSION_KEY, JSON.stringify(getResumeSnapshot()));
  saveResumePointer();
}

function saveResumePointer() {
  const snapshot = getResumeSnapshot();
  if (!snapshot.currentId) return;
  state.progress.__meta__ = snapshot;
  storageSet(STORAGE_KEY, JSON.stringify(state.progress));
}

function applySession(session) {
  const meta = state.progress.__meta__ || {};
  const data = { ...meta, ...(session || {}) };
  if (!Object.keys(data).length) return;

  if (data.mode) state.mode = data.mode;
  if (data.order) state.order = data.order;
  if (data.school !== undefined) state.school = data.school;
  if (data.year !== undefined) state.year = data.year;
  if (data.section !== undefined) state.section = data.section;
  if (data.typeFilter !== undefined) state.typeFilter = data.typeFilter;
  if (data.module !== undefined) state.module = data.module;
  if (data.branch !== undefined) state.branch = data.branch;
  if (data.topic !== undefined) state.topic = data.topic;

  if (data.sessionCache) {
    Object.entries(data.sessionCache).forEach(([id, entry]) => {
      const rec = ensureItem(id);
      if (entry.selectedAnswer) rec.selectedAnswer = entry.selectedAnswer;
      if (entry.revealed) rec.revealed = true;
      if (entry.selectedAnswer || entry.revealed) rec.lastAt = rec.lastAt || Date.now();
    });
    saveProgress();
  }

  state.restoreId = data.currentId || null;
  if (typeof data.index === "number" && data.index >= 0) {
    state.restoreIndex = data.index;
  }
}

function ensureItem(id) {
  if (!state.progress[id]) {
    state.progress[id] = {
      mastered: false,
      wrong: false,
      seen: 0,
      selectedAnswer: null,
      revealed: false,
      lastAt: null,
    };
  }
  return state.progress[id];
}

function hasAttempt(rec) {
  return Boolean(
    rec && (rec.selectedAnswer || rec.revealed || rec.mastered || rec.wrong)
  );
}

function findResumeIndex(queue) {
  const firstNew = queue.findIndex((item) => !hasAttempt(state.progress[item.id]));
  if (firstNew >= 0) return firstNew;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (hasAttempt(state.progress[queue[i].id])) return i;
  }
  return 0;
}

function findLastWorkedId(queue) {
  let bestId = null;
  let bestAt = -1;
  queue.forEach((item) => {
    const rec = state.progress[item.id];
    if (rec?.lastAt > bestAt) {
      bestAt = rec.lastAt;
      bestId = item.id;
    }
  });
  return bestId;
}

function restoreFiltersForQuestion(id) {
  if (!state.bank || !id || id === "__meta__") return false;

  if (id.startsWith("page-")) {
    const pageNum = Number(id.replace("page-", ""));
    const page = (state.bank.pages || []).find((p) => p.page === pageNum);
    if (!page) return false;
    state.mode = "page";
    state.school = page.school_id || "";
    state.year = page.year || "";
    state.section = "";
    state.typeFilter = "";
    state.module = "";
    state.branch = "";
    state.topic = "";
    return true;
  }

  const q = state.bank.questions.find((item) => item.id === id);
  if (!q) return false;

  state.mode = "question";
  state.school = q.school_id || "";
  state.year = q.year || "";
  state.section = q.section || "";
  if (q.type === "choice" && q.answer) {
    state.typeFilter = "choice_gradable";
  } else if (q.type === "choice") {
    state.typeFilter = "choice";
  } else {
    state.typeFilter = "";
  }
  state.module = "";
  state.branch = "";
  state.topic = "";
  return true;
}

function getResumeCandidates(queue = state.queue) {
  const session = loadSession();
  return [
    state.restoreId,
    session.currentId,
    state.progress.__meta__?.currentId,
    findLastWorkedId(queue),
  ].filter((id, index, list) => id && list.indexOf(id) === index);
}

function resolveResumePosition(queue, { resetPosition = false } = {}) {
  if (resetPosition || !queue.length) {
    return { index: findResumeIndex(queue), filtersChanged: false };
  }

  for (const id of getResumeCandidates(queue)) {
    let idx = queue.findIndex((item) => item.id === id);
    if (idx >= 0) return { index: idx, filtersChanged: false };

    if (restoreFiltersForQuestion(id)) {
      const widenedQueue = sortPool(getPool());
      idx = widenedQueue.findIndex((item) => item.id === id);
      if (idx >= 0) {
        state.queue = widenedQueue;
        return { index: idx, filtersChanged: true };
      }
    }
  }

  if (
    typeof state.restoreIndex === "number"
    && state.restoreIndex >= 0
    && state.restoreIndex < queue.length
  ) {
    return { index: state.restoreIndex, filtersChanged: false };
  }

  return { index: findResumeIndex(queue), filtersChanged: false };
}

function persistAnswerState(id = state.current?.id) {
  if (!id) return;
  const rec = ensureItem(id);
  rec.selectedAnswer = state.selectedAnswer;
  rec.revealed = state.revealed;
  rec.lastAt = Date.now();
  saveProgress();
  renderHistoryPanel();
}

function formatWhen(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function attemptStatus(rec, item) {
  if (rec.mastered) return { label: "会了", className: "ok" };
  if (rec.wrong) {
    if (item?.answer && rec.selectedAnswer) {
      return rec.selectedAnswer === item.answer
        ? { label: "会了", className: "ok" }
        : { label: "错题", className: "bad" };
    }
    return { label: "不会", className: "bad" };
  }
  if (rec.selectedAnswer && item?.answer) {
    return rec.selectedAnswer === item.answer
      ? { label: "答对", className: "ok" }
      : { label: "答错", className: "bad" };
  }
  if (rec.selectedAnswer) return { label: `选了 ${rec.selectedAnswer}`, className: "seen" };
  if (rec.revealed) return { label: "看过解析", className: "seen" };
  return { label: "已浏览", className: "seen" };
}

function renderPreviousAttempt(rec, item) {
  if (!hasAttempt(rec)) return "";
  const parts = [];
  if (rec.selectedAnswer) {
    const verdict = item.answer
      ? rec.selectedAnswer === item.answer
        ? "正确"
        : "错误"
      : "已选";
    parts.push(`上次作答 <strong>${rec.selectedAnswer}</strong>（${verdict}）`);
  } else if (rec.mastered) {
    parts.push("上次标记为<strong>会了</strong>");
  } else if (rec.wrong) {
    parts.push("上次标记为<strong>不会</strong>");
  } else if (rec.revealed) {
    parts.push("上次<strong>看过解析</strong>");
  }
  if (rec.lastAt) parts.push(formatWhen(rec.lastAt));
  return `<div class="prev-attempt">${parts.join(" · ")}</div>`;
}

function updateStats() {
  const allIds = getPool().map((item) => item.id);
  const mastered = allIds.filter((id) => state.progress[id]?.mastered).length;
  const wrong = allIds.filter((id) => state.progress[id]?.wrong).length;
  const seen = allIds.filter((id) => state.progress[id]?.seen).length;
  const answered = allIds.filter((id) => hasAttempt(state.progress[id])).length;
  const total = allIds.length;
  const pct = total ? Math.round((mastered / total) * 100) : 0;

  const choiceTotal = state.bank?.meta?.choice_total || 0;
  const choiceAnswered = state.bank?.meta?.choice_answered || 0;

  document.getElementById("stats").innerHTML = `
    <div><strong>${total}</strong> 题可练</div>
    <div>选择题自动判分 <strong>${choiceAnswered}/${choiceTotal}</strong></div>
    <div>已掌握 <strong>${mastered}</strong></div>
    <div>错题 <strong>${wrong}</strong></div>
    <div>已作答 <strong>${answered}</strong></div>
    <div>已浏览 <strong>${seen}</strong></div>
  `;
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressText").textContent = `掌握进度 ${pct}%（${mastered}/${total}）`;
  renderHistoryPanel();
}

function getPool() {
  if (!state.bank) return [];

  if (state.mode === "page") {
    return state.bank.pages
      .filter((p) => (!state.school || p.school_id === state.school))
      .filter((p) => (!state.year || p.year === state.year))
      .filter((p) => (!state.section || p.section === state.section))
      .map((p) => ({
        id: `page-${p.page}`,
        kind: "page",
        page: p.page,
        year: p.year,
        section: p.section,
        image: assetUrl(p.image),
        text: p.preview || "",
      }));
  }

  let questions = state.bank.questions.map((q) => ({ ...q, kind: "question", id: q.id }));

  if (state.mode === "wrong") {
    questions = questions.filter((q) => state.progress[q.id]?.wrong);
  }

  return questions
    .filter((q) => (!state.school || q.school_id === state.school))
    .filter((q) => (!state.year || q.year === state.year))
    .filter((q) => (!state.section || q.section === state.section))
    .filter((q) => {
      if (!state.typeFilter) return true;
      if (state.typeFilter === "choice_gradable") {
        return q.type === "choice" && !!q.answer;
      }
      return q.type === state.typeFilter;
    })
    .filter((q) => (!state.module || (q.module || q.topic_category) === state.module))
    .filter((q) => (!state.branch || q.branch === state.branch))
    .filter((q) => (!state.topic || q.topic === state.topic));
}

function sortPool(pool) {
  if (state.order === "random") {
    return shuffle([...pool]);
  }

  const byYearNumber = (a, b) => {
    const yearA = a.year || "";
    const yearB = b.year || "";
    if (yearA !== yearB) return yearA.localeCompare(yearB);
    return (a.number || 0) - (b.number || 0);
  };

  const moduleOrder = ["货币金融", "国际金融", "公司理财", "投资学", "未归类"];

  if (state.order === "topic") {
    return [...pool].sort((a, b) => {
      const modA = a.module || a.topic_category || "未归类";
      const modB = b.module || b.topic_category || "未归类";
      const modIdxA = moduleOrder.indexOf(modA);
      const modIdxB = moduleOrder.indexOf(modB);
      if (modIdxA !== modIdxB) return (modIdxA < 0 ? 99 : modIdxA) - (modIdxB < 0 ? 99 : modIdxB);
      const brA = a.branch || "";
      const brB = b.branch || "";
      if (brA !== brB) return brA.localeCompare(brB, "zh");
      const topicA = a.topic || "";
      const topicB = b.topic || "";
      if (topicA !== topicB) return topicA.localeCompare(topicB, "zh");
      return byYearNumber(a, b);
    });
  }

  return [...pool].sort(byYearNumber);
}

function rebuildQueue({ resetPosition = false } = {}) {
  if (resetPosition) {
    state.restoreId = null;
    state.restoreIndex = null;
  }

  const pool = getPool();
  state.queue = sortPool(pool);
  const resume = resolveResumePosition(state.queue, { resetPosition });
  state.index = resume.index;
  state.restoreId = null;
  state.restoreIndex = null;
  if (resume.filtersChanged) {
    populateFilters();
    syncFilterUI();
  }

  saveSession();
  updateStats();
  updateNavControls();
  showCurrent();
}

function touchCurrentItem() {
  persistAnswerState();
  saveSession();
}

function getMapCellStatus(item, index) {
  if (index === state.index) return "current";
  const rec = state.progress[item.id];
  if (!rec || !hasAttempt(rec)) return "todo";
  if (rec.wrong) return "wrong";
  return "done";
}

function getMapCounts() {
  let done = 0;
  let wrong = 0;
  let todo = 0;
  state.queue.forEach((item, index) => {
    const status = getMapCellStatus(item, index);
    if (status === "done") done += 1;
    else if (status === "wrong") wrong += 1;
    else if (status === "todo") todo += 1;
  });
  return { done, wrong, todo, total: state.queue.length };
}

const MAP_STATUS_LABELS = {
  todo: "未做",
  done: "已做",
  wrong: "错题",
  current: "当前",
};

function renderQuestionPicker() {
  const select = document.getElementById("questionPicker");
  const pickerTotal = document.getElementById("pickerTotal");
  if (!select) return;

  const total = state.queue.length;
  if (pickerTotal) pickerTotal.textContent = `/ ${total}`;

  if (!total) {
    select.innerHTML = "<option value=\"\">无题目</option>";
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = state.queue
    .map((item, index) => {
      const status = getMapCellStatus(item, index);
      const selected = index === state.index ? "selected" : "";
      return `<option value="${index}" ${selected}>${index + 1} · ${MAP_STATUS_LABELS[status]}</option>`;
    })
    .join("");
}

function renderQuestionMap() {
  const grid = document.getElementById("mapGrid");
  const jumpInput = document.getElementById("jumpInput");
  const queueBadge = document.getElementById("queueBadge");
  if (!grid) return;

  const total = state.queue.length;
  const current = total ? state.index + 1 : 0;
  const counts = getMapCounts();

  if (queueBadge) {
    queueBadge.textContent = total
      ? `第 ${current} 题 / 共 ${total} 题（已做 ${counts.done} · 未做 ${counts.todo}）`
      : "当前筛选下暂无题目";
  }
  if (jumpInput) {
    jumpInput.max = String(total || 1);
    jumpInput.placeholder = total ? `1-${total}` : "题号";
  }

  renderQuestionPicker();

  if (!total) {
    grid.innerHTML = `<p class="map-empty">当前筛选下没有题目</p>`;
    return;
  }

  grid.innerHTML = state.queue
    .map((item, index) => {
      const num = index + 1;
      const status = getMapCellStatus(item, index);
      const title = [
        `第 ${num} 题`,
        item.school_name,
        item.year ? `${item.year}年` : "",
        item.kind === "page" ? `第 ${item.page} 页` : `原卷第 ${item.number} 题`,
        status === "todo" ? "未做" : status === "wrong" ? "错题" : status === "done" ? "已做" : "当前",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<button type="button" class="map-cell ${status}" data-index="${index}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${num}</button>`;
    })
    .join("");

  const active = grid.querySelector(".map-cell.current");
  if (active) {
    active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function updateNavControls() {
  const total = state.queue.length;
  const current = total ? state.index + 1 : 0;
  const label = `${current} / ${total}`;
  const labelShort = `${current}/${total}`;
  const navPosition = document.getElementById("navPosition");
  if (navPosition) navPosition.textContent = label;
  const mobilePos = document.getElementById("navPositionMobile");
  if (mobilePos) mobilePos.textContent = labelShort;
  const prevDisabled = state.index <= 0;
  const nextDisabled = !total;
  ["prevBtn", "prevBtnMobile", "prevBtnInline"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = prevDisabled;
  });
  ["nextBtn", "nextBtnMobile", "nextBtnInline"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = nextDisabled;
  });
  renderQuestionMap();
}

function goToIndex(index) {
  if (index < 0 || index >= state.queue.length) return;
  touchCurrentItem();
  state.index = index;
  saveSession();
  updateNavControls();
  showCurrent();
}

function goToNumber(num) {
  const parsed = Number.parseInt(String(num), 10);
  if (!Number.isFinite(parsed)) return;
  goToIndex(parsed - 1);
}

function scrollToQuestionNav() {
  document.getElementById("questionPicker")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function goPrev() {
  if (state.index <= 0) return;
  touchCurrentItem();
  state.index -= 1;
  saveSession();
  updateNavControls();
  showCurrent();
}

function goNext() {
  if (!state.queue.length) return;
  touchCurrentItem();
  if (state.index < state.queue.length - 1) {
    state.index += 1;
    saveSession();
    updateNavControls();
    showCurrent();
    return;
  }
  if (state.order === "random") {
    rebuildQueue({ resetPosition: true });
    return;
  }
  state.index = 0;
  saveSession();
  updateNavControls();
  showCurrent();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showCurrent() {
  const answerPanel = document.getElementById("answerPanel");
  answerPanel.classList.add("hidden");
  answerPanel.textContent = "";

  if (!state.queue.length) {
    document.getElementById("cardMeta").innerHTML = "";
    document.getElementById("cardBody").innerHTML = "<p>当前筛选下没有题目。请调整年份/题型/知识点，或先完成 OCR 提取。</p>";
    state.current = null;
    updateNavControls();
    return;
  }

  if (state.index >= state.queue.length) {
    if (state.order === "random") {
      rebuildQueue();
      return;
    }
    state.index = 0;
  }

  state.current = state.queue[state.index];
  const item = state.current;
  const rec = ensureItem(item.id);
  state.selectedAnswer = rec.selectedAnswer ?? null;
  state.revealed = Boolean(rec.revealed);

  rec.seen += 1;
  saveProgress();
  updateStats();
  updateNavControls();

  const tags = [
    item.school_name ? `<span class="tag school-tag">${escapeHtml(item.school_name)}</span>` : null,
    (item.module || item.topic_category)
      ? `<span class="tag module-tag">${escapeHtml(item.module || item.topic_category)}</span>`
      : null,
    item.branch ? `<span class="tag branch-tag">${escapeHtml(item.branch)}</span>` : null,
    item.topic ? `<span class="tag topic-name">${escapeHtml(item.topic)}</span>` : null,
    item.year ? `${item.year}年` : null,
    item.section || null,
    item.kind === "page" ? `第 ${item.page} 页` : `第 ${item.number} 题`,
    item.type && item.type !== "unknown" ? typeLabel(item.type) : null,
  ].filter(Boolean);

  document.getElementById("cardMeta").innerHTML = [
    tags.map((t) => (t.startsWith("<span") ? t : `<span class="tag">${escapeHtml(t)}</span>`)).join(""),
    renderPreviousAttempt(rec, item),
  ].join("");

  if (item.kind === "page") {
    document.getElementById("cardBody").innerHTML = `
      <p>${escapeHtml(item.text || "（该页为图片题目，下方为原页内容）")}</p>
      <img src="${item.image}" alt="page ${item.page}" />
    `;
  } else {
    const hasOptions = (item.options || []).length > 0;
    const options = (item.options || [])
      .map(
        (opt) => `
          <button type="button" class="option" data-label="${opt.label}" aria-label="选项 ${opt.label}">
            <span class="option-label">${opt.label}</span>
            <span class="option-text">${escapeHtml(opt.text)}</span>
          </button>
        `
      )
      .join("");
    const subs = (item.sub_questions || [])
      .map((sub) => `<div class="sub-question">（${sub.number}）${escapeHtml(sub.text)}</div>`)
      .join("");

    const showImage = item.type !== "choice";
    document.getElementById("cardBody").innerHTML = `
      <div class="stem">${escapeHtml(item.stem || "")}</div>
      ${hasOptions ? `<p class="option-hint">点击选项作答</p>` : `<p class="option-hint muted">主观题请自行作答，再点「显示解析」对照原页</p>`}
      ${options ? `<div class="options" id="options">${options}</div>` : ""}
      ${subs ? `<div class="sub-questions">${subs}</div>` : ""}
      ${item.image ? `
        <details class="source-image" ${showImage ? "open" : ""}>
          <summary>查看原页图片</summary>
          <img src="${assetUrl(item.image)}" alt="source page" />
        </details>
      ` : ""}
    `;
  }

  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([document.getElementById("cardBody")]);
  }

  if (state.revealed) {
    if (state.selectedAnswer && item.kind === "question" && (item.options || []).length) {
      highlightAnswerState();
      const panel = document.getElementById("answerPanel");
      panel.classList.remove("hidden");
      if (item.answer) {
        const isCorrect = state.selectedAnswer === item.answer;
        panel.className = isCorrect ? "answer-panel correct-panel" : "answer-panel wrong-panel";
        panel.innerHTML = isCorrect
          ? `<strong>回答正确！</strong> 正确答案：<strong>${item.answer}</strong>`
          : `<strong>回答错误。</strong> 你选了 ${state.selectedAnswer}，正确答案：<strong>${item.answer}</strong>`;
        panel.innerHTML += renderExplanation(item);
        typesetPanel(panel);
      } else {
        revealAnswer();
      }
    } else {
      revealAnswer();
    }
  }

  saveSession();
}

function selectOption(label) {
  const item = state.current;
  if (!item || item.kind !== "question" || !(item.options || []).length) return;

  state.selectedAnswer = label;
  state.revealed = true;

  const buttons = document.querySelectorAll("#options .option");
  buttons.forEach((btn) => {
    btn.classList.remove("selected", "correct", "wrong");
    btn.disabled = true;
    const optionLabel = btn.dataset.label;
    if (optionLabel === label) {
      btn.classList.add("selected");
    }
    if (item.answer) {
      if (optionLabel === item.answer) {
        btn.classList.add("correct");
      } else if (optionLabel === label && label !== item.answer) {
        btn.classList.add("wrong");
      }
    }
  });

  const panel = document.getElementById("answerPanel");
  panel.classList.remove("hidden");

  if (item.answer) {
    const isCorrect = label === item.answer;
    const rec = ensureItem(item.id);
    if (isCorrect) {
      rec.mastered = true;
      rec.wrong = false;
      panel.className = "answer-panel correct-panel";
      panel.innerHTML = `<strong>回答正确！</strong> 正确答案：<strong>${item.answer}</strong>`;
    } else {
      rec.mastered = false;
      rec.wrong = true;
      panel.className = "answer-panel wrong-panel";
      panel.innerHTML = `<strong>回答错误。</strong> 你选了 ${label}，正确答案：<strong>${item.answer}</strong>`;
    }
    rec.selectedAnswer = label;
    rec.revealed = true;
    rec.lastAt = Date.now();
    saveProgress();
    updateStats();
    renderQuestionMap();
    panel.innerHTML += renderExplanation(item);
    typesetPanel(panel);
  } else {
    const rec = ensureItem(item.id);
    rec.selectedAnswer = label;
    rec.revealed = true;
    rec.lastAt = Date.now();
    saveProgress();
    updateStats();
    renderQuestionMap();
    panel.className = "answer-panel";
    panel.innerHTML = `
      <p>你已选择 <strong>${label}</strong>。</p>
      <p>本题暂无标准答案（原卷未附答案或未识别到）。可点「显示解析」看题目，或切到「全部选择题」继续练。</p>
    `;
  }
  saveSession();
}

function revealAnswer() {
  if (!state.current) return;
  state.revealed = true;
  const rec = ensureItem(state.current.id);
  rec.revealed = true;
  rec.lastAt = Date.now();
  saveProgress();
  updateStats();
  renderQuestionMap();
  saveSession();
  const panel = document.getElementById("answerPanel");
  panel.classList.remove("hidden");

  if (state.current.kind === "page") {
    panel.className = "answer-panel";
    panel.textContent = "提示：这是按页练习模式。原书该页通常包含题目与完整解析，请对照图片阅读。";
    return;
  }

  const item = state.current;
  panel.className = "answer-panel";

  if (item.answer) {
    panel.innerHTML = `<p>正确答案：<strong>${item.answer}</strong></p>`;
    panel.innerHTML += renderExplanation(item);
    typesetPanel(panel);
    if (state.selectedAnswer) {
      highlightAnswerState();
    }
    return;
  }

  panel.innerHTML = `
    <p>本题暂无结构化答案。请对照下方原页图片查看完整解析。</p>
    ${state.selectedAnswer ? `<p>你已选择：<strong>${state.selectedAnswer}</strong></p>` : ""}
  `;
}

function highlightAnswerState() {
  const item = state.current;
  if (!item?.answer) return;

  document.querySelectorAll("#options .option").forEach((btn) => {
    btn.classList.remove("selected", "correct", "wrong");
    btn.disabled = true;
    const optionLabel = btn.dataset.label;
    if (optionLabel === state.selectedAnswer) btn.classList.add("selected");
    if (optionLabel === item.answer) btn.classList.add("correct");
    if (state.selectedAnswer && optionLabel === state.selectedAnswer && state.selectedAnswer !== item.answer) {
      btn.classList.add("wrong");
    }
  });
}

function typesetPanel(panel) {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([panel]);
  }
}

function formatPlainExplanation(text) {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function uniqueImages(paths) {
  const seen = new Set();
  return (paths || []).filter((path) => {
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function renderPageImages(images, title) {
  if (!images.length) return "";
  const tags = images
    .map(
      (image, index) => `
        <figure class="page-figure">
          <img src="${assetUrl(image)}" alt="${title} ${index + 1}" loading="lazy" />
          <figcaption>${title} ${images.length > 1 ? index + 1 : ""}</figcaption>
        </figure>
      `
    )
    .join("");

  return `
    <section class="page-gallery">
      <h4>${title}</h4>
      <div class="answer-page-images">${tags}</div>
    </section>
  `;
}

function renderExplanation(item) {
  const sections = item.explanation_sections || {};
  const labels = {
    source: "知识来源",
    analysis: "答案解析",
    options: "选项辨析",
    extension: "知识延伸",
    method: "学习方法",
    extra: "补充说明",
  };

  const blocks = Object.entries(labels)
    .filter(([key]) => sections[key] && String(sections[key]).trim())
    .map(
      ([key, label]) => `
        <section class="explain-block">
          <h4>${label}</h4>
          <div class="explain-text">${formatPlainExplanation(String(sections[key]))}</div>
        </section>
      `
    )
    .join("");

  const fallback = !blocks && item.explanation
    ? `<section class="explain-block"><h4>详细解析</h4><div class="explain-text">${formatPlainExplanation(item.explanation)}</div></section>`
    : "";

  const answerImages = uniqueImages(item.answer_pages || []);
  const questionImage = item.image && !answerImages.includes(item.image) ? [item.image] : [];
  const hasText = Boolean(blocks || fallback);
  const imageBlock = [
    renderPageImages(answerImages, "官方解析原页"),
    !answerImages.length ? renderPageImages(questionImage, "题目原页") : "",
  ].join("");

  const meta = [item.school_name, item.year ? `${item.year}年` : "", item.number ? `第${item.number}题` : ""]
    .filter(Boolean)
    .join(" · ");

  const hint = !hasText && imageBlock
    ? `<p class="explain-hint">文字解析未识别完整，请直接对照下方原页阅读（含公式、图表与完整推导）。</p>`
    : !hasText
      ? `<p class="explain-hint">本题暂无文字解析，建议切换到「按页刷」查看完整原卷。</p>`
      : imageBlock
        ? `<p class="explain-hint">下方附有解析原页，可对照公式与图表。</p>`
        : "";

  return `
    <div class="explanation-wrap">
      ${meta ? `<p class="explain-meta">${escapeHtml(meta)}</p>` : ""}
      ${hint}
      ${blocks || fallback}
      ${imageBlock}
    </div>
  `;
}

function typeLabel(type) {
  const labels = {
    choice: "选择题",
    definition: "名词解释",
    short_answer: "简答题",
    calculation: "计算题",
    essay: "论述题",
  };
  return labels[type] || type;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function resetSelect(selectId, placeholder) {
  const select = document.getElementById(selectId);
  select.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  select.appendChild(opt);
  return select;
}

function populateSelect(selectId, items, formatter, placeholder) {
  const select = resetSelect(selectId, placeholder);
  items.forEach((item) => {
    const opt = document.createElement("option");
    const formatted = formatter(item);
    opt.value = formatted.value;
    opt.textContent = formatted.label;
    select.appendChild(opt);
  });
  return select;
}

function getKnowledgeTree() {
  if (state.bank.meta?.knowledge_tree?.length) {
    return state.bank.meta.knowledge_tree;
  }
  const tree = {};
  state.bank.questions.forEach((q) => {
    const mod = q.module || q.topic_category;
    if (!mod) return;
    if (!tree[mod]) tree[mod] = { module: mod, count: 0, branches: {} };
    tree[mod].count += 1;
    const branch = q.branch || "其他";
    if (!tree[mod].branches[branch]) {
      tree[mod].branches[branch] = { name: branch, count: 0, topics: {} };
    }
    tree[mod].branches[branch].count += 1;
    if (q.topic) {
      tree[mod].branches[branch].topics[q.topic] = (tree[mod].branches[branch].topics[q.topic] || 0) + 1;
    }
  });
  return Object.values(tree).map((mod) => ({
    module: mod.module,
    count: mod.count,
    branches: Object.values(mod.branches).map((branch) => ({
      name: branch.name,
      count: branch.count,
      topics: Object.entries(branch.topics)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh")),
    })),
  }));
}

function populateKnowledgeFilters() {
  const tree = getKnowledgeTree();
  const modules = tree.map((item) => ({ name: item.module, count: item.count }));

  populateSelect("moduleFilter", modules, (item) => ({
    value: item.name,
    label: `${item.name}（${item.count}）`,
  }), "全部模块");

  const moduleNode = tree.find((item) => item.module === state.module);
  const branches = moduleNode ? moduleNode.branches : tree.flatMap((item) => item.branches);
  const branchMap = new Map();
  branches.forEach((branch) => {
    branchMap.set(branch.name, (branchMap.get(branch.name) || 0) + branch.count);
  });
  const branchItems = [...branchMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));

  populateSelect("branchFilter", branchItems, (item) => ({
    value: item.name,
    label: `${item.name}（${item.count}）`,
  }), "全部分支");

  let topics = [];
  if (state.module && state.branch) {
    const node = tree.find((item) => item.module === state.module);
    topics = node?.branches.find((branch) => branch.name === state.branch)?.topics || [];
  } else if (state.module) {
    const node = tree.find((item) => item.module === state.module);
    const topicMap = new Map();
    (node?.branches || []).forEach((branch) => {
      branch.topics.forEach((topic) => {
        topicMap.set(topic.name, (topicMap.get(topic.name) || 0) + topic.count);
      });
    });
    topics = [...topicMap.entries()].map(([name, count]) => ({ name, count }));
  } else if (state.branch) {
    const topicMap = new Map();
    tree.forEach((mod) => {
      mod.branches
        .filter((branch) => branch.name === state.branch)
        .forEach((branch) => {
          branch.topics.forEach((topic) => {
            topicMap.set(topic.name, (topicMap.get(topic.name) || 0) + topic.count);
          });
        });
    });
    topics = [...topicMap.entries()].map(([name, count]) => ({ name, count }));
  } else {
    const topicMap = new Map();
    tree.forEach((mod) => {
      mod.branches.forEach((branch) => {
        branch.topics.forEach((topic) => {
          topicMap.set(topic.name, (topicMap.get(topic.name) || 0) + topic.count);
        });
      });
    });
    topics = [...topicMap.entries()].map(([name, count]) => ({ name, count }));
  }
  topics.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));

  populateSelect("topicFilter", topics, (item) => ({
    value: item.name,
    label: `${item.name}（${item.count}）`,
  }), "全部知识点");

  document.getElementById("moduleFilter").value = state.module;
  document.getElementById("branchFilter").value = state.branch;
  document.getElementById("topicFilter").value = state.topic;
}

function getHistoryItems(limit = 80) {
  if (!state.bank) return [];

  const questionMap = new Map(state.bank.questions.map((q) => [q.id, q]));
  const pageMap = new Map(
    (state.bank.pages || []).map((p) => [
      `page-${p.page}`,
      {
        id: `page-${p.page}`,
        kind: "page",
        school_name: p.school_name,
        year: p.year,
        number: p.page,
        stem: p.preview || `第 ${p.page} 页`,
      },
    ])
  );

  return Object.entries(state.progress)
    .filter(([id]) => id !== "__meta__")
    .filter(([, rec]) => hasAttempt(rec))
    .map(([id, rec]) => {
      const item = questionMap.get(id) || pageMap.get(id);
      if (!item) return null;
      const status = attemptStatus(rec, item);
      return {
        id,
        item,
        rec,
        status,
        sortAt: rec.lastAt || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, limit);
}

function renderHistoryPanel() {
  const listEl = document.getElementById("historyList");
  const countEl = document.getElementById("historyCount");
  const hintEl = document.getElementById("historyHint");
  if (!listEl) return;

  const items = getHistoryItems();
  if (countEl) countEl.textContent = `${items.length} 条`;
  if (hintEl) {
    hintEl.textContent = items.length
      ? "点击记录可回看你的作答与解析"
      : "还没有做题记录，做完题后会自动出现在这里";
  }

  if (!items.length) {
    listEl.innerHTML = `<p class="history-empty">暂无记录</p>`;
    return;
  }

  listEl.innerHTML = items
    .map(({ id, item, rec, status }) => {
      const title = [
        item.school_name,
        item.year ? `${item.year}年` : "",
        item.kind === "page" ? `第 ${item.number} 页` : `第 ${item.number} 题`,
      ]
        .filter(Boolean)
        .join(" · ");
      const detail = rec.selectedAnswer
        ? `你的选择：${rec.selectedAnswer}${item.answer ? ` · 正确答案：${item.answer}` : ""}`
        : rec.mastered
          ? "标记为会了"
          : rec.wrong
            ? "标记为不会"
            : "看过解析";
      const stem = (item.stem || "").replace(/\s+/g, " ").slice(0, 72);
      const active = state.current?.id === id ? " active" : "";
      return `
        <button type="button" class="history-item${active}" data-history-id="${id}">
          <div class="history-item-top">
            <span class="history-title">${escapeHtml(title)}</span>
            <span class="history-badge ${status.className}">${escapeHtml(status.label)}</span>
          </div>
          ${stem ? `<p class="history-stem">${escapeHtml(stem)}${item.stem && item.stem.length > 72 ? "…" : ""}</p>` : ""}
          <p class="history-detail">${escapeHtml(detail)}${rec.lastAt ? ` · ${formatWhen(rec.lastAt)}` : ""}</p>
        </button>
      `;
    })
    .join("");
}

function jumpToQuestion(id) {
  if (!state.bank || !id) return;

  if (id.startsWith("page-")) {
    state.mode = "page";
  } else {
    state.mode = "question";
  }

  document.querySelectorAll("#modeButtons .btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  });

  let pool = getPool();
  let queue = sortPool(pool);
  let idx = queue.findIndex((item) => item.id === id);

  if (idx < 0 && !id.startsWith("page-")) {
    const q = state.bank.questions.find((item) => item.id === id);
    if (q) {
      state.school = q.school_id || "";
      state.year = q.year || "";
      state.section = "";
      state.typeFilter = "";
      state.module = "";
      state.branch = "";
      state.topic = "";
      populateFilters();
      syncFilterUI();
      pool = getPool();
      queue = sortPool(pool);
      idx = queue.findIndex((item) => item.id === id);
    }
  }

  state.queue = queue;
  state.index = idx >= 0 ? idx : findResumeIndex(queue);
  saveSession();
  updateStats();
  updateNavControls();
  showCurrent();
  document.getElementById("card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncFilterUI() {
  document.querySelectorAll("#modeButtons .btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  });
  document.querySelectorAll("[data-order]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.order === state.order);
  });
  document.getElementById("schoolFilter").value = state.school;
  document.getElementById("yearFilter").value = state.year;
  document.getElementById("sectionFilter").value = state.section;
  document.getElementById("typeFilter").value = state.typeFilter;
  document.getElementById("moduleFilter").value = state.module;
  document.getElementById("branchFilter").value = state.branch;
  document.getElementById("topicFilter").value = state.topic;
}

function populateFilters() {
  const years = state.bank.meta.years || [];
  const sections = [...new Set([
    ...state.bank.questions.map((q) => q.section).filter(Boolean),
    ...state.bank.pages.map((p) => p.section).filter(Boolean),
  ])];

  const schools = state.bank.meta.schools || [];
  populateSelect("schoolFilter", schools, (item) => ({
    value: item.id,
    label: `${item.short || item.name}（${item.count}）`,
  }), "全部院校");
  populateSelect("yearFilter", years, (year) => ({ value: year, label: `${year}年` }), "全部年份");
  populateSelect("sectionFilter", sections, (section) => ({ value: section, label: section }), "全部板块");
  populateKnowledgeFilters();
}

function bindEvents() {
  document.getElementById("cardBody").addEventListener("click", (e) => {
    const btn = e.target.closest("button.option");
    if (!btn || btn.disabled) return;
    selectOption(btn.dataset.label);
  });

  document.getElementById("modeButtons").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    document.querySelectorAll("#modeButtons .btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    rebuildQueue({ resetPosition: true });
  });

  function setOrder(order) {
    state.order = order;
    document.querySelectorAll("[data-order]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.order === order);
    });
    rebuildQueue({ resetPosition: true });
  }

  document.querySelectorAll("[data-order]").forEach((btn) => {
    btn.addEventListener("click", () => setOrder(btn.dataset.order));
  });

  document.getElementById("schoolFilter").addEventListener("change", (e) => {
    state.school = e.target.value;
    rebuildQueue({ resetPosition: true });
  });

  document.getElementById("yearFilter").addEventListener("change", (e) => {
    state.year = e.target.value;
    rebuildQueue({ resetPosition: true });
  });

  document.getElementById("sectionFilter").addEventListener("change", (e) => {
    state.section = e.target.value;
    rebuildQueue({ resetPosition: true });
  });

  document.getElementById("typeFilter").addEventListener("change", (e) => {
    state.typeFilter = e.target.value;
    rebuildQueue({ resetPosition: true });
  });

  document.getElementById("moduleFilter").addEventListener("change", (e) => {
    state.module = e.target.value;
    state.branch = "";
    state.topic = "";
    populateKnowledgeFilters();
    rebuildQueue({ resetPosition: true });
  });

  document.getElementById("branchFilter").addEventListener("change", (e) => {
    state.branch = e.target.value;
    state.topic = "";
    populateKnowledgeFilters();
    rebuildQueue({ resetPosition: true });
  });

  document.getElementById("topicFilter").addEventListener("change", (e) => {
    state.topic = e.target.value;
    rebuildQueue({ resetPosition: true });
  });

  document.getElementById("prevBtn").addEventListener("click", goPrev);
  document.getElementById("nextBtn").addEventListener("click", goNext);
  document.getElementById("prevBtnMobile")?.addEventListener("click", goPrev);
  document.getElementById("nextBtnMobile")?.addEventListener("click", goNext);
  document.getElementById("prevBtnInline")?.addEventListener("click", goPrev);
  document.getElementById("nextBtnInline")?.addEventListener("click", goNext);
  document.getElementById("questionPicker")?.addEventListener("change", (e) => {
    goToIndex(Number(e.target.value));
  });

  document.getElementById("filterToggle")?.addEventListener("click", () => {
    const panel = document.getElementById("controls");
    const btn = document.getElementById("filterToggle");
    const collapsed = panel.classList.toggle("collapsed");
    btn.classList.toggle("open", !collapsed);
    btn.setAttribute("aria-expanded", String(!collapsed));
  });

  document.getElementById("masteredBtn").addEventListener("click", () => {
    if (!state.current) return;
    const rec = ensureItem(state.current.id);
    rec.mastered = true;
    rec.wrong = false;
    rec.lastAt = Date.now();
    saveProgress();
    updateStats();
    renderQuestionMap();
    goNext();
  });

  document.getElementById("wrongBtn").addEventListener("click", () => {
    if (!state.current) return;
    const rec = ensureItem(state.current.id);
    rec.wrong = true;
    rec.mastered = false;
    rec.lastAt = Date.now();
    saveProgress();
    updateStats();
    renderQuestionMap();
    goNext();
  });

  document.getElementById("historyList")?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-history-id]");
    if (!row) return;
    jumpToQuestion(row.dataset.historyId);
  });

  document.getElementById("mapGrid")?.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-index]");
    if (!cell) return;
    goToIndex(Number(cell.dataset.index));
  });

  document.getElementById("mapJumpForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("jumpInput");
    goToNumber(input?.value);
    if (input) input.value = "";
  });

  ["navPosition", "navPositionMobile"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", scrollToQuestionNav);
  });

  document.getElementById("revealBtn").addEventListener("click", revealAnswer);

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  });

  const flushResumeState = () => saveSession();
  window.addEventListener("pagehide", flushResumeState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushResumeState();
  });
}

async function init() {
  applySession(loadSession());
  bindEvents();
  try {
    const res = await fetch(assetUrl("questions.json"));
    if (!res.ok) throw new Error("questions.json 未生成");
    state.bank = await res.json();
    populateFilters();
    syncFilterUI();
    rebuildQueue();
  } catch (err) {
    document.getElementById("cardBody").innerHTML = `
      <p>题库数据还没准备好。</p>
      <p>请先在项目目录运行：</p>
      <pre>python extract_ocr.py
python parse_questions.py
python serve.py</pre>
      <p>${escapeHtml(String(err))}</p>
    `;
  }
}

init();