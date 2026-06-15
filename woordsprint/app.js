(() => {
  "use strict";

  const items = window.WOORDSPRINT_ITEMS || [];
  const categories = window.WOORDSPRINT_CATEGORIES || [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const STORAGE_KEY = "woordsprint-progress-v1";

  const modes = [
    { id: "mixed", icon: "Mix", name: "Mélange complet", description: "Tous les types compatibles" },
    { id: "term-answer", icon: "A→", name: "Trouver le synonyme", description: "Le mot est donné" },
    { id: "definition-term", icon: "D→", name: "Trouver le mot", description: "La définition est donnée" },
    { id: "answer-term", icon: "S→", name: "Synonyme inversé", description: "Retrouve le mot d’origine" },
    { id: "write-definition", icon: "Déf", name: "Écrire la définition", description: "Compare toi-même le sens" },
    { id: "missing-letters", icon: "A_ B", name: "Lettres manquantes", description: "Reconstitue l’orthographe" },
    { id: "scramble", icon: "ABC", name: "Mot mélangé", description: "Remets les lettres ou mots en ordre" },
    { id: "preposition", icon: "___", name: "Préposition fixe", description: "aan, op, naar, in…" },
    { id: "belgian", icon: "BE", name: "Variante belge", description: "Du standard vers le belge" },
    { id: "voice", icon: "Son", name: "Écoute et écris", description: "La définition est lue à voix haute" }
  ];

  const defaultStats = {
    answers: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    mistakes: {},
    known: {},
    exams: []
  };

  let stats = loadStats();
  let selectedMode = "mixed";
  let flashDeck = [];
  let flashIndex = 0;
  let flashRevealed = false;
  let touchStartX = 0;
  let practice = null;
  let exam = null;
  let examTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function loadStats() {
    try {
      return { ...defaultStats, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return { ...defaultStats };
    }
  }

  function saveStats() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    renderDashboardStats();
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("nl")
      .replace(/[’‘`]/g, "'")
      .replace(/[^a-z0-9\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shuffle(list) {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const random = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[random]] = [copy[random], copy[index]];
    }
    return copy;
  }

  function answerVariants(text, field = "answer") {
    const raw = String(text).trim();
    const variants = [raw];
    if (!raw.includes("/")) return variants;

    if (field === "answer") {
      return [...new Set([raw, ...raw.split(/\s*\/\s*/).map((part) => part.trim())])];
    }

    if (raw === "Abraham / Sara zien") {
      return [raw, "Abraham zien", "Sara zien"];
    }

    const parts = raw.split(/\s*\/\s*/);
    if (parts.length === 2) {
      const leftWords = parts[0].split(/\s+/);
      const rightWords = parts[1].split(/\s+/);
      variants.push(parts[0]);
      if (rightWords.length === 1 && leftWords.length > 1) {
        variants.push(`${leftWords.slice(0, -1).join(" ")} ${rightWords[0]}`);
      }
    }
    return [...new Set(variants)];
  }

  function isAnswerCorrect(value, expected, field = "answer") {
    const actual = normalize(value);
    if (!actual) return false;
    return answerVariants(expected, field).some((variant) => normalize(variant) === actual);
  }

  function getCategoryItems(categoryId) {
    return categoryId === "all" ? [...items] : items.filter((item) => item.category === categoryId);
  }

  function getEligibleItems(mode, categoryId) {
    let pool = getCategoryItems(categoryId);
    if (mode === "preposition") pool = pool.filter((item) => item.category === "voorzetsels");
    if (mode === "belgian") pool = pool.filter((item) => item.category === "belgisch");
    return pool;
  }

  function weightedShuffle(pool, prioritizeErrors) {
    const expanded = [...pool];
    if (prioritizeErrors) {
      pool.forEach((item) => {
        const misses = Math.min(Number(stats.mistakes[item.id] || 0), 3);
        for (let index = 0; index < misses; index += 1) expanded.push(item);
      });
    }
    const result = [];
    const shuffled = shuffle(expanded);
    shuffled.forEach((item) => {
      if (!result.some((entry) => entry.id === item.id)) result.push(item);
    });
    return result;
  }

  function populateCategorySelect(select, includeAll = true) {
    select.innerHTML = "";
    if (includeAll) select.add(new Option(`Tout le programme (${items.length})`, "all"));
    categories.forEach((category) => {
      const count = items.filter((item) => item.category === category.id).length;
      select.add(new Option(`${category.label} (${count})`, category.id));
    });
  }

  function renderDashboardStats() {
    $("#stat-total").textContent = items.length;
    $("#stat-answers").textContent = stats.answers;
    $("#stat-accuracy").textContent = stats.answers
      ? `${Math.round((stats.correct / stats.answers) * 100)}%`
      : "–";
    $("#stat-streak").textContent = stats.streak;
  }

  function renderCategories() {
    $("#category-count").textContent = `${categories.length} catégories`;
    $("#category-grid").innerHTML = categories.map((category) => {
      const count = items.filter((item) => item.category === category.id).length;
      return `
        <button class="category-button" type="button" data-category="${category.id}">
          <div>
            <strong>${escapeHtml(category.label)}</strong>
            <small>${escapeHtml(category.description)}</small>
          </div>
          <span>${count} éléments</span>
        </button>
      `;
    }).join("");
  }

  function renderModes() {
    $("#mode-grid").innerHTML = modes.map((mode) => `
      <button class="mode-button${mode.id === selectedMode ? " selected" : ""}" type="button" data-mode="${mode.id}">
        <span>${escapeHtml(mode.icon)}</span>
        <div>
          <strong>${escapeHtml(mode.name)}</strong>
          <small>${escapeHtml(mode.description)}</small>
        </div>
      </button>
    `).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function goTo(viewName) {
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
    $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.go === viewName));
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (viewName === "mistakes") renderMistakes();
    if (viewName === "flashcards" && !flashDeck.length) resetFlashDeck();
  }

  function resetFlashDeck() {
    const category = $("#flash-category").value || "all";
    flashDeck = shuffle(getCategoryItems(category));
    flashIndex = 0;
    showFlashcard();
  }

  function getFlashDirection() {
    const selected = $("#flash-direction").value;
    if (selected !== "mixed") return selected;
    return shuffle(["term", "answer", "definition"])[0];
  }

  function showFlashcard() {
    if (!flashDeck.length) return;
    const item = flashDeck[flashIndex % flashDeck.length];
    const direction = getFlashDirection();
    const labels = {
      term: ["Mot ou expression", item.term, item.answer, item.definition],
      answer: ["Synonyme / réponse", item.answer, item.term, item.definition],
      definition: ["Définition", item.definition, item.term, item.answer]
    };
    const [label, front, answer, definition] = labels[direction];
    flashRevealed = false;
    $("#flashcard").classList.remove("revealed", "swipe-left", "swipe-right");
    $("#flash-label").textContent = label;
    $("#flash-front").textContent = front;
    $("#flash-answer").textContent = answer;
    $("#flash-definition").textContent = definition;
    $("#flash-progress-text").textContent = `${flashIndex + 1} / ${flashDeck.length}`;
    $("#flash-progress-bar").style.width = `${((flashIndex + 1) / flashDeck.length) * 100}%`;
  }

  function revealFlashcard() {
    flashRevealed = !flashRevealed;
    $("#flashcard").classList.toggle("revealed", flashRevealed);
    $("#flash-hint").textContent = flashRevealed ? "" : "Appuie pour retourner";
  }

  function rateFlashcard(known) {
    if (!flashDeck.length) return;
    const item = flashDeck[flashIndex];
    if (known) {
      stats.known[item.id] = Number(stats.known[item.id] || 0) + 1;
      if (stats.mistakes[item.id]) stats.mistakes[item.id] = Math.max(0, stats.mistakes[item.id] - 1);
    } else {
      stats.mistakes[item.id] = Number(stats.mistakes[item.id] || 0) + 1;
    }
    saveStats();
    const card = $("#flashcard");
    card.classList.add(known ? "swipe-right" : "swipe-left");
    window.setTimeout(() => {
      flashIndex += 1;
      if (flashIndex >= flashDeck.length) {
        flashDeck = shuffle(flashDeck);
        flashIndex = 0;
      }
      showFlashcard();
    }, 190);
  }

  function chooseMixedMode(item) {
    if (item.category === "voorzetsels" && Math.random() < .55) return "preposition";
    if (item.category === "belgisch" && Math.random() < .55) return "belgian";
    return shuffle(["term-answer", "definition-term", "answer-term", "missing-letters", "scramble"])[0];
  }

  function createQuestion(item, requestedMode, forExam = false) {
    const mode = requestedMode === "mixed" ? chooseMixedMode(item) : requestedMode;
    const category = categoryById.get(item.category);
    const base = {
      item,
      mode,
      type: modes.find((entry) => entry.id === mode)?.name || "Question",
      category: category?.label || "",
      selfGrade: false,
      field: "answer",
      prompt: "",
      instruction: "",
      expected: "",
      context: "",
      clue: "",
      speak: false
    };

    switch (mode) {
      case "definition-term":
        return { ...base, instruction: "Quel mot ou quelle expression correspond à cette définition ?", prompt: item.definition, expected: item.term, field: "term" };
      case "answer-term":
        return { ...base, instruction: "Retrouve le mot ou l’expression d’origine.", prompt: item.answer, expected: item.term, field: "term", context: item.definition };
      case "write-definition":
        return { ...base, instruction: "Explique ce mot en néerlandais avec tes propres mots.", prompt: item.term, expected: item.definition, field: "definition", selfGrade: !forExam };
      case "missing-letters":
        return { ...base, instruction: "Complète le mot ou l’expression à partir de la définition.", prompt: item.definition, expected: item.term, field: "term", clue: hideLetters(item.term) };
      case "scramble":
        return { ...base, instruction: "Remets les éléments dans l’ordre et écris la réponse.", prompt: item.definition, expected: item.term, field: "term", clue: scrambleText(item.term) };
      case "preposition":
        return { ...base, instruction: "Écris uniquement la préposition manquante.", prompt: makePrepositionPrompt(item), expected: item.answer, field: "answer", context: item.definition };
      case "belgian":
        return { ...base, instruction: "Écris l’équivalent en néerlandais de Belgique.", prompt: item.term, expected: item.answer, field: "answer", context: item.definition };
      case "voice":
        return { ...base, instruction: "Écoute la définition, puis écris le mot.", prompt: "Appuie sur « Écouter »", expected: item.term, field: "term", speak: true };
      default:
        return { ...base, instruction: "Écris le synonyme ou la réponse associée.", prompt: item.term, expected: item.answer, field: "answer", context: item.definition };
    }
  }

  function hideLetters(text) {
    let visibleCounter = 0;
    return [...text].map((character) => {
      if (!/[A-Za-zÀ-ÿ]/.test(character)) return character;
      visibleCounter += 1;
      return visibleCounter % 3 === 1 ? character : "_";
    }).join("");
  }

  function scrambleText(text) {
    const words = text.split(/\s+/);
    if (words.length > 2) return shuffle(words).join(" · ");
    return words.map((word) => {
      const characters = [...word];
      if (characters.length < 4) return word;
      let scrambled = shuffle(characters).join("");
      if (scrambled === word) scrambled = [...characters.slice(1), characters[0]].join("");
      return scrambled;
    }).join(" ");
  }

  function makePrepositionPrompt(item) {
    const firstOption = item.answer.split(/\s*\/\s*/)[0];
    const marker = ` ${firstOption}`;
    const index = item.term.lastIndexOf(marker);
    if (index >= 0) return `${item.term.slice(0, index)} ___`;
    return `${item.term} ___`;
  }

  function setSelectedMode(mode) {
    selectedMode = mode;
    $$(".mode-button").forEach((button) => button.classList.toggle("selected", button.dataset.mode === mode));
    if (mode === "preposition") $("#practice-category").value = "voorzetsels";
    if (mode === "belgian") $("#practice-category").value = "belgisch";
  }

  function startPractice(options = {}) {
    const mode = options.mode || selectedMode;
    const category = options.category || $("#practice-category").value;
    const pool = options.items || getEligibleItems(mode, category);
    if (!pool.length) return;
    const requestedLength = options.length || $("#practice-length").value;
    const max = requestedLength === "all" ? pool.length : Number(requestedLength);
    const ordered = options.items ? shuffle(pool) : weightedShuffle(pool, $("#prioritize-errors").checked);
    const queue = ordered.slice(0, Math.min(max, ordered.length));
    practice = { mode, queue, index: 0, correct: 0, wrongIds: [], current: null, answered: false, pendingSelfGrade: false };
    $("#practice-setup").classList.add("hidden");
    $("#practice-summary").classList.add("hidden");
    $("#practice-session").classList.remove("hidden");
    showPracticeQuestion();
  }

  function showPracticeQuestion() {
    if (!practice || practice.index >= practice.queue.length) {
      finishPractice();
      return;
    }
    const item = practice.queue[practice.index];
    practice.current = createQuestion(item, practice.mode);
    practice.answered = false;
    practice.pendingSelfGrade = false;
    const question = practice.current;
    $("#practice-score").textContent = `${practice.correct} correct`;
    $("#practice-counter").textContent = `${practice.index + 1} / ${practice.queue.length}`;
    $("#practice-progress-bar").style.width = `${(practice.index / practice.queue.length) * 100}%`;
    $("#question-type").textContent = question.type;
    $("#question-instruction").textContent = question.instruction;
    $("#question-prompt").textContent = question.prompt;
    $("#question-context").textContent = question.context;
    $("#question-context").classList.toggle("hidden", !question.context);
    $("#letter-clue").textContent = question.clue;
    $("#letter-clue").classList.toggle("hidden", !question.clue);
    $("#speak-question").classList.toggle("hidden", !question.speak);
    $("#answer-form").classList.remove("hidden");
    $("#feedback").className = "feedback hidden";
    $("#self-grade").classList.add("hidden");
    $("#next-question").classList.remove("hidden");
    $("#answer-input").value = "";
    $("#answer-input").focus({ preventScroll: true });
    if (question.speak) speakCurrentQuestion();
  }

  function submitPracticeAnswer(event) {
    event.preventDefault();
    if (!practice || practice.answered) return;
    const value = $("#answer-input").value.trim();
    if (!value) return;
    practice.answered = true;
    $("#answer-form").classList.add("hidden");
    const question = practice.current;
    if (question.selfGrade) {
      practice.pendingSelfGrade = true;
      renderFeedback(null, question, value);
      return;
    }
    const correct = isAnswerCorrect(value, question.expected, question.field);
    recordPracticeResult(correct);
    renderFeedback(correct, question, value);
  }

  function renderFeedback(correct, question, userAnswer) {
    const feedback = $("#feedback");
    feedback.classList.remove("hidden", "correct", "wrong");
    if (correct === null) {
      $("#feedback-heading").textContent = "Compare ta réponse";
      $("#feedback-icon").textContent = "↔";
      $("#self-grade").classList.remove("hidden");
      $("#next-question").classList.add("hidden");
    } else {
      feedback.classList.add(correct ? "correct" : "wrong");
      $("#feedback-heading").textContent = correct ? "Correct" : "À revoir";
      $("#feedback-icon").textContent = correct ? "✓" : "×";
    }
    $("#expected-answer").innerHTML = `<div>${escapeHtml(question.expected)}</div><small>Ta réponse: ${escapeHtml(userAnswer)}</small>`;
    $("#feedback-definition").textContent = question.item.definition;
  }

  function recordPracticeResult(correct) {
    const item = practice.current.item;
    stats.answers += 1;
    if (correct) {
      practice.correct += 1;
      stats.correct += 1;
      stats.streak += 1;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      stats.known[item.id] = Number(stats.known[item.id] || 0) + 1;
      if (stats.mistakes[item.id]) stats.mistakes[item.id] = Math.max(0, stats.mistakes[item.id] - 1);
    } else {
      stats.streak = 0;
      stats.mistakes[item.id] = Number(stats.mistakes[item.id] || 0) + 1;
      if (!practice.wrongIds.includes(item.id)) practice.wrongIds.push(item.id);
    }
    saveStats();
    $("#practice-score").textContent = `${practice.correct} correct`;
  }

  function nextPracticeQuestion() {
    if (!practice?.answered || practice.pendingSelfGrade) return;
    practice.index += 1;
    showPracticeQuestion();
  }

  function finishPractice() {
    if (!practice) return;
    const total = practice.queue.length;
    const percent = total ? Math.round((practice.correct / total) * 100) : 0;
    $("#practice-session").classList.add("hidden");
    $("#practice-summary").classList.remove("hidden");
    $("#summary-percent").textContent = `${percent}%`;
    $("#summary-title").textContent = percent >= 85 ? "Très solide" : percent >= 65 ? "Encore un passage" : "Révise les erreurs maintenant";
    $("#summary-detail").textContent = `${practice.correct} réponses correctes sur ${total}. ${practice.wrongIds.length} élément(s) à retravailler.`;
    $("#retry-mistakes").classList.toggle("hidden", practice.wrongIds.length === 0);
  }

  function quitPractice() {
    practice = null;
    $("#practice-session").classList.add("hidden");
    $("#practice-summary").classList.add("hidden");
    $("#practice-setup").classList.remove("hidden");
  }

  function retryPracticeMistakes() {
    const retryItems = practice?.wrongIds.map((id) => byId.get(id)).filter(Boolean) || [];
    if (retryItems.length) startPractice({ mode: "mixed", items: retryItems, length: "all" });
  }

  function speakCurrentQuestion() {
    const question = practice?.current;
    if (!question || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(question.item.definition);
    utterance.lang = "nl-BE";
    utterance.rate = .88;
    window.speechSynthesis.speak(utterance);
  }

  function startExam() {
    const length = Number($("#exam-length").value);
    const pool = shuffle(getCategoryItems($("#exam-category").value));
    const queue = [];
    while (queue.length < length && pool.length) queue.push(pool[queue.length % pool.length]);
    exam = { queue, index: 0, answers: [], secondsLeft: Math.round(length * 36) };
    $("#exam-setup").classList.add("hidden");
    $("#exam-summary").classList.add("hidden");
    $("#exam-session").classList.remove("hidden");
    showExamQuestion();
    updateExamTimer();
    window.clearInterval(examTimer);
    examTimer = window.setInterval(() => {
      exam.secondsLeft -= 1;
      updateExamTimer();
      if (exam.secondsLeft <= 0) finishExam(true);
    }, 1000);
  }

  function showExamQuestion() {
    if (!exam || exam.index >= exam.queue.length) return finishExam(false);
    const item = exam.queue[exam.index];
    const question = createQuestion(item, chooseMixedMode(item), true);
    exam.current = question;
    $("#exam-counter").textContent = `Question ${exam.index + 1} / ${exam.queue.length}`;
    $("#exam-progress-bar").style.width = `${(exam.index / exam.queue.length) * 100}%`;
    $("#exam-type").textContent = question.type;
    $("#exam-instruction").textContent = question.instruction;
    $("#exam-prompt").textContent = question.clue ? `${question.prompt}\n\n${question.clue}` : question.prompt;
    $("#exam-input").value = "";
  }

  function submitExamAnswer(event) {
    event.preventDefault();
    if (!exam) return;
    const value = $("#exam-input").value.trim();
    if (!value) return;
    const question = exam.current;
    exam.answers.push({ question, value, correct: isAnswerCorrect(value, question.expected, question.field) });
    exam.index += 1;
    showExamQuestion();
  }

  function updateExamTimer() {
    if (!exam) return;
    const minutes = Math.floor(Math.max(0, exam.secondsLeft) / 60);
    const seconds = Math.max(0, exam.secondsLeft) % 60;
    $("#exam-timer").textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function finishExam(timedOut) {
    if (!exam) return;
    window.clearInterval(examTimer);
    while (exam.answers.length < exam.queue.length) {
      const item = exam.queue[exam.answers.length];
      const question = exam.answers.length === exam.index && exam.current ? exam.current : createQuestion(item, "definition-term", true);
      exam.answers.push({ question, value: "", correct: false });
    }
    const correct = exam.answers.filter((answer) => answer.correct).length;
    const total = exam.answers.length;
    const percent = Math.round((correct / total) * 100);
    exam.answers.forEach((answer) => {
      stats.answers += 1;
      if (answer.correct) stats.correct += 1;
      else stats.mistakes[answer.question.item.id] = Number(stats.mistakes[answer.question.item.id] || 0) + 1;
    });
    stats.exams = [...(stats.exams || []), { date: Date.now(), correct, total, percent }].slice(-10);
    saveStats();
    $("#exam-session").classList.add("hidden");
    $("#exam-summary").classList.remove("hidden");
    $("#exam-percent").textContent = `${percent}%`;
    $("#exam-result-title").textContent = percent >= 80 ? "Examen réussi" : "Révision encore nécessaire";
    $("#exam-result-detail").textContent = `${correct}/${total} réponses correctes${timedOut ? " · temps écoulé" : ""}.`;
    $("#exam-review").innerHTML = exam.answers.map((answer) => `<div class="review-item ${answer.correct ? "correct" : "wrong"}"><strong>${answer.correct ? "✓" : "×"} ${escapeHtml(answer.question.prompt)}</strong><span>Ta réponse: ${escapeHtml(answer.value || "—")}</span><small>Attendu: ${escapeHtml(answer.question.expected)}</small></div>`).join("");
  }

  function renderMistakes() {
    const ranked = Object.entries(stats.mistakes).filter(([, count]) => Number(count) > 0).map(([id, count]) => ({ item: byId.get(id), count: Number(count) })).filter((entry) => entry.item).sort((a, b) => b.count - a.count);
    $("#mistake-subtitle").textContent = ranked.length ? `${ranked.length} élément(s), classés du plus difficile au moins difficile.` : "Aucune erreur enregistrée pour le moment.";
    $("#practice-mistakes").classList.toggle("hidden", ranked.length === 0);
    $("#mistake-list").innerHTML = ranked.length ? ranked.map(({ item, count }) => `<article class="mistake-item"><div><strong>${escapeHtml(item.term)}</strong><span>${escapeHtml(item.answer)}</span><small>${escapeHtml(item.definition)}</small></div><span class="mistake-count">${count}</span></article>`).join("") : `<div class="empty-state">Fais une série d’exercices ou un examen. Les réponses ratées apparaîtront ici automatiquement.</div>`;
  }

  function startMistakePractice() {
    const mistakeItems = Object.entries(stats.mistakes).filter(([, count]) => Number(count) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).map(([id]) => byId.get(id)).filter(Boolean);
    if (!mistakeItems.length) return;
    goTo("practice");
    startPractice({ mode: "mixed", items: mistakeItems, length: "all" });
  }

  function updateNetworkStatus() {
    const online = navigator.onLine;
    $("#network-label").textContent = online ? "Prêt hors ligne" : "Mode hors ligne";
    $(".status-dot").style.background = online ? "var(--green)" : "var(--orange)";
  }

  function bindEvents() {
    $$("[data-go]").forEach((button) => button.addEventListener("click", () => goTo(button.dataset.go)));
    $$("[data-open-install]").forEach((button) => button.addEventListener("click", () => $("#install-dialog").showModal()));
    $$("[data-close-install]").forEach((button) => button.addEventListener("click", () => $("#install-dialog").close()));
    $("#category-grid").addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (button) { $("#practice-category").value = button.dataset.category; goTo("practice"); } });
    $("#mode-grid").addEventListener("click", (event) => { const button = event.target.closest("[data-mode]"); if (button) setSelectedMode(button.dataset.mode); });
    $("#flash-category").addEventListener("change", resetFlashDeck);
    $("#flash-direction").addEventListener("change", showFlashcard);
    $("#shuffle-flash").addEventListener("click", resetFlashDeck);
    $("#flashcard").addEventListener("click", revealFlashcard);
    $("#flash-again").addEventListener("click", () => rateFlashcard(false));
    $("#flash-known").addEventListener("click", () => rateFlashcard(true));
    $("#flashcard").addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0].clientX; }, { passive: true });
    $("#flashcard").addEventListener("touchend", (event) => { const distance = event.changedTouches[0].clientX - touchStartX; if (Math.abs(distance) > 75) rateFlashcard(distance > 0); }, { passive: true });
    $("#start-practice").addEventListener("click", () => startPractice());
    $("#answer-form").addEventListener("submit", submitPracticeAnswer);
    $("#next-question").addEventListener("click", nextPracticeQuestion);
    $("#quit-practice").addEventListener("click", quitPractice);
    $("#new-practice").addEventListener("click", quitPractice);
    $("#retry-mistakes").addEventListener("click", retryPracticeMistakes);
    $("#speak-question").addEventListener("click", speakCurrentQuestion);
    $("#start-exam").addEventListener("click", startExam);
    $("#exam-form").addEventListener("submit", submitExamAnswer);
    $("#restart-exam").addEventListener("click", () => { exam = null; $("#exam-summary").classList.add("hidden"); $("#exam-setup").classList.remove("hidden"); });
    $("#practice-mistakes").addEventListener("click", startMistakePractice);
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
  }

  function init() {
    populateCategorySelect($("#flash-category"));
    populateCategorySelect($("#practice-category"));
    populateCategorySelect($("#exam-category"));
    renderCategories();
    renderModes();
    renderDashboardStats();
    renderMistakes();
    bindEvents();
    updateNetworkStatus();
    resetFlashDeck();
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  init();
})();
