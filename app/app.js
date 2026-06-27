const STORAGE_KEY = "ustc-exam-progress-v1";

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
  typeFilter: "choice",
  module: "",
  branch: "",
  topic: "",
  queue: [],
  index: 0,
  current: null,
  selectedAnswer: null,
  revealed: false,
  sessionCache: {},
  progress: loadProgress(),
};

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function ensureItem(id) {
  if (!state.progress[id]) {
    state.progress[id] = { mastered: false, wrong: false, seen: 0 };
  }
  return state.progress[id];
}

function updateStats() {
  const allIds = getPool().map((item) => item.id);
  const mastered = allIds.filter((id) => state.progress[id]?.mastered).length;
  const wrong = allIds.filter((id) => state.progress[id]?.wrong).length;
  const seen = allIds.filter((id) => state.progress[id]?.seen).length;
  const total = allIds.length;
  const pct = total ? Math.round((mastered / total) * 100) : 0;

  const choiceTotal = state.bank?.meta?.choice_total || 0;
  const choiceAnswered = state.bank?.meta?.choice_answered || 0;

  document.getElementById("stats").innerHTML = `
    <div><strong>${total}</strong> 题可练</div>
    <div>选择题自动判分 <strong>${choiceAnswered}/${choiceTotal}</strong></div>
    <div>已掌握 <strong>${mastered}</strong></div>
    <div>错题 <strong>${wrong}</strong></div>
    <div>已浏览 <strong>${seen}</strong></div>
  `;
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressText").textContent = `掌握进度 ${pct}%（${mastered}/${total}）`;
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
    .filter((q) => (!state.typeFilter || q.type === state.typeFilter))
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

function rebuildQueue() {
  const pool = getPool();
  state.queue = sortPool(pool);
  state.index = 0;
  state.sessionCache = {};
  updateStats();
  updateNavControls();
  showCurrent();
}

function cacheCurrentSession() {
  if (!state.current) return;
  state.sessionCache[state.current.id] = {
    selectedAnswer: state.selectedAnswer,
    revealed: state.revealed,
  };
}

function updateNavControls() {
  const total = state.queue.length;
  const current = total ? state.index + 1 : 0;
  const label = `${current} / ${total}`;
  const labelShort = `${current}/${total}`;
  document.getElementById("navPosition").textContent = label;
  const mobilePos = document.getElementById("navPositionMobile");
  if (mobilePos) mobilePos.textContent = labelShort;
  const prevDisabled = state.index <= 0;
  const nextDisabled = !total;
  ["prevBtn", "prevBtnMobile"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = prevDisabled;
  });
  ["nextBtn", "nextBtnMobile"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = nextDisabled;
  });
}

function goPrev() {
  if (state.index <= 0) return;
  cacheCurrentSession();
  state.index -= 1;
  updateNavControls();
  showCurrent();
}

function goNext() {
  if (!state.queue.length) return;
  cacheCurrentSession();
  if (state.index < state.queue.length - 1) {
    state.index += 1;
    updateNavControls();
    showCurrent();
    return;
  }
  if (state.order === "random") {
    rebuildQueue();
    return;
  }
  state.index = 0;
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
  const cached = state.sessionCache[item.id];
  state.selectedAnswer = cached?.selectedAnswer ?? null;
  state.revealed = cached?.revealed ?? false;

  ensureItem(item.id).seen += 1;
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

  document.getElementById("cardMeta").innerHTML = tags
    .map((t) => (t.startsWith("<span") ? t : `<span class="tag">${escapeHtml(t)}</span>`))
    .join("");

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
    saveProgress();
    updateStats();
    panel.innerHTML += renderExplanation(item);
    typesetPanel(panel);
  } else {
    panel.className = "answer-panel";
    panel.innerHTML = `
      <p>你已选择 <strong>${label}</strong>。</p>
      <p>本题暂未匹配到标准答案。请点击「显示解析」对照原页图片，或切换到「按页刷」查看完整解析。</p>
    `;
  }
}

function revealAnswer() {
  if (!state.current) return;
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
    .filter(([key]) => sections[key])
    .map(
      ([key, label]) => `
        <section class="explain-block">
          <h4>${label}</h4>
          <div class="explain-text">${escapeHtml(sections[key])}</div>
        </section>
      `
    )
    .join("");

  const fallback = !blocks && item.explanation
    ? `<div class="explanation">${escapeHtml(item.explanation)}</div>`
    : "";

  const answerImages = (item.answer_pages || [])
    .map(
      (image, index) => `
        <img src="${assetUrl(image)}" alt="解析原页 ${index + 1}" loading="lazy" />
      `
    )
    .join("");

  const imageBlock = answerImages
    ? `
      <details class="answer-pages" open>
        <summary>解析原页（完整版，含公式与图表）</summary>
        <div class="answer-page-images">${answerImages}</div>
      </details>
    `
    : "";

  return `
    <div class="explanation-wrap">
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
    rebuildQueue();
  });

  function setOrder(order) {
    state.order = order;
    document.querySelectorAll("[data-order]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.order === order);
    });
    rebuildQueue();
  }

  document.querySelectorAll("[data-order]").forEach((btn) => {
    btn.addEventListener("click", () => setOrder(btn.dataset.order));
  });

  document.getElementById("schoolFilter").addEventListener("change", (e) => {
    state.school = e.target.value;
    rebuildQueue();
  });

  document.getElementById("yearFilter").addEventListener("change", (e) => {
    state.year = e.target.value;
    rebuildQueue();
  });

  document.getElementById("sectionFilter").addEventListener("change", (e) => {
    state.section = e.target.value;
    rebuildQueue();
  });

  document.getElementById("typeFilter").addEventListener("change", (e) => {
    state.typeFilter = e.target.value;
    rebuildQueue();
  });

  document.getElementById("moduleFilter").addEventListener("change", (e) => {
    state.module = e.target.value;
    state.branch = "";
    state.topic = "";
    populateKnowledgeFilters();
    rebuildQueue();
  });

  document.getElementById("branchFilter").addEventListener("change", (e) => {
    state.branch = e.target.value;
    state.topic = "";
    populateKnowledgeFilters();
    rebuildQueue();
  });

  document.getElementById("topicFilter").addEventListener("change", (e) => {
    state.topic = e.target.value;
    rebuildQueue();
  });

  document.getElementById("prevBtn").addEventListener("click", goPrev);
  document.getElementById("nextBtn").addEventListener("click", goNext);
  document.getElementById("prevBtnMobile")?.addEventListener("click", goPrev);
  document.getElementById("nextBtnMobile")?.addEventListener("click", goNext);

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
    saveProgress();
    goNext();
  });

  document.getElementById("wrongBtn").addEventListener("click", () => {
    if (!state.current) return;
    const rec = ensureItem(state.current.id);
    rec.wrong = true;
    rec.mastered = false;
    saveProgress();
    goNext();
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
}

async function init() {
  bindEvents();
  try {
    const res = await fetch(assetUrl("questions.json"));
    if (!res.ok) throw new Error("questions.json 未生成");
    state.bank = await res.json();
    populateFilters();
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