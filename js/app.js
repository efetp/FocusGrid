// ============================================================
// FocusGrid — Static Version (localStorage)
// ============================================================

const MODES = {
    light: { work: 25, break: 5, color: "#3caed1" },
    deep: { work: 50, break: 10, color: "#e74c3c" },
    custom: { work: 25, break: 5, color: "#a78bfa" },
};

// --- State ---
let currentMode = "light";
let totalSeconds = MODES.light.work * 60;
let remainingSeconds = totalSeconds;
let timerInterval = null;
let isRunning = false;
let isBreak = false;
let selectedTodoId = null;
let customWorkMinutes = 25;
let customBreakMinutes = 5;
let isDraggingSlider = false;
let selectedCategory = "university";
let editingTodoId = null;
let selectedCalendarDate = null;
let activeTab = "current";
let matrixCategory = "university";
let expandedQuadrants = new Set();
let cachedTodos = null; // in-memory cache; null means stale/unloaded
let _todosInflight = null; // dedup concurrent Supabase fetches
let _cacheGeneration = 0; // incremented on optimistic mutations

// --- DOM Elements ---
const timerTime = document.getElementById("timer-time");
const timerLabel = document.getElementById("timer-label");
const progressRing = document.querySelector(".timer-ring-progress");
const btnStart = document.getElementById("btn-start");
const btnPause = document.getElementById("btn-pause");
const btnReset = document.getElementById("btn-reset");
const modeButtons = document.querySelectorAll(".mode-btn");
const todoForm = document.getElementById("todo-form");
const todoList = document.getElementById("todo-list");
const flashOverlay = document.getElementById("flash-overlay");
const currentTaskDiv = document.getElementById("current-task");
const currentTaskName = document.getElementById("current-task-name");
const statPomodoros = document.getElementById("stat-pomodoros");
const statMinutes = document.getElementById("stat-minutes");

const btnAddTask = document.getElementById("btn-add-task");
const btnCloseModal = document.getElementById("btn-close-modal");
const taskModal = document.getElementById("task-modal");
const catButtons = document.querySelectorAll(".cat-btn");
const customCategoryInput = document.getElementById("custom-category");
const courseGroup = document.getElementById("course-group");

const clockTime = document.getElementById("clock-time");
const clockDate = document.getElementById("clock-date");
const clockTimezone = document.getElementById("clock-timezone");
const calMonthYear = document.getElementById("cal-month-year");
const calDays = document.getElementById("cal-days");
const calPrev = document.getElementById("cal-prev");
const calNext = document.getElementById("cal-next");

const btnExport = document.getElementById("btn-export");
const btnImport = document.getElementById("btn-import");
const importFile = document.getElementById("import-file");

const RING_CIRCUMFERENCE = 2 * Math.PI * 90;

// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================

// One-time migration of old localStorage key
if (localStorage.getItem("pomodoro_data") && !localStorage.getItem("focusgrid_data")) {
    localStorage.setItem("focusgrid_data", localStorage.getItem("pomodoro_data"));
    localStorage.removeItem("pomodoro_data");
}

function loadData() {
    const raw = localStorage.getItem("focusgrid_data");
    if (!raw) return { todos: [], sessions: [] };
    try { return JSON.parse(raw); } catch { return { todos: [], sessions: [] }; }
}

function saveData(data) {
    localStorage.setItem("focusgrid_data", JSON.stringify(data));
}

// ============================================================
// COURSE MANAGEMENT
// ============================================================

function loadCourses(category = "university") {
    const key = `focusgrid_courses_${category}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function saveCourses(courses, category = "university") {
    const key = `focusgrid_courses_${category}`;
    localStorage.setItem(key, JSON.stringify(courses));
}

function renderCourseDropdown(category = selectedCategory) {
    const select = document.getElementById("todo-course");
    const currentVal = select.value;
    const courses = loadCourses(category);
    const label = category === "university" ? "course" : "subcategory";
    select.innerHTML = `<option value="">Select ${label}...</option>`;
    courses.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    // Restore previous selection if still valid
    if (courses.includes(currentVal)) select.value = currentVal;
}

function renderCourseList(filter = "") {
    const list = document.getElementById("course-list");
    const courses = loadCourses(selectedCategory);
    const filtered = filter
        ? courses.filter(c => c.toLowerCase().includes(filter.toLowerCase()))
        : courses;
    list.innerHTML = "";
    if (filtered.length === 0) {
        const label = selectedCategory === "university" ? "courses" : "subcategories";
        list.innerHTML = `<li style="color: var(--text-muted); font-weight: 400; justify-content: center;">No ${label} found</li>`;
        return;
    }
    filtered.forEach(c => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${c}</span><button class="course-remove-btn" data-course="${c}">&times;</button>`;
        li.querySelector(".course-remove-btn").addEventListener("click", () => {
            const updated = loadCourses(selectedCategory).filter(x => x !== c);
            saveCourses(updated, selectedCategory);
            renderCourseDropdown(selectedCategory);
            renderCourseList(filter);
        });
        list.appendChild(li);
    });
}

function addCourse(name) {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) return;
    const courses = loadCourses(selectedCategory);
    if (courses.includes(trimmed)) return;
    courses.push(trimmed);
    courses.sort();
    saveCourses(courses, selectedCategory);
    renderCourseDropdown(selectedCategory);
    renderCourseList();
}

// ============================================================
// AUDIO
// ============================================================

let audioContext = null;

function playAlertSound() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const now = audioContext.currentTime;
    function playTone(freq, detune, start, duration) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.type = "triangle";
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
    }
    playTone(523, 0, now, 0.8);
    playTone(659, 3, now + 0.2, 0.6);
    playTone(523, 0, now + 1.4, 0.8);
    playTone(659, 3, now + 1.6, 0.6);
}

// ============================================================
// TIMER
// ============================================================

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

function updateDisplay() {
    timerTime.textContent = formatTime(remainingSeconds);
    timerLabel.textContent = isBreak ? "BREAK" : "WORK";
    const progress = 1 - (remainingSeconds / totalSeconds);
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    progressRing.style.strokeDasharray = RING_CIRCUMFERENCE;
    progressRing.style.strokeDashoffset = offset;
    document.title = `${formatTime(remainingSeconds)} — ${isBreak ? "Break" : "Work"} | FocusGrid`;
    document.body.classList.toggle("on-break", isBreak);
    // Update slider arc to show remaining time
    if (isRunning) {
        updateSliderArc(remainingSeconds / 60);
    }
}

function setMode(mode) {
    if (isRunning) return;
    currentMode = mode;
    const config = MODES[mode];

    // Update mode button highlights
    modeButtons.forEach(btn => btn.classList.remove("active"));
    const modeBtn = document.querySelector(`[data-mode="${mode}"]`);
    if (modeBtn) modeBtn.classList.add("active");

    document.documentElement.style.setProperty("--active-color", config.color);
    progressRing.style.stroke = config.color;
    isBreak = false;

    if (mode === "custom") {
        totalSeconds = customWorkMinutes * 60;
    } else {
        totalSeconds = config.work * 60;
        // Sync custom values to preset for slider display
        customWorkMinutes = config.work;
        customBreakMinutes = config.break;
    }
    remainingSeconds = totalSeconds;
    updateDisplay();
    updateSliderHandle();
    toggleBreakSelector(mode === "custom");
    updateModeInfo();
}

function updateModeInfo() {
    const el = document.getElementById("mode-info");
    if (!el) return;
    const workMin = currentMode === "custom" ? customWorkMinutes : MODES[currentMode].work;
    const breakMin = currentMode === "custom" ? customBreakMinutes : MODES[currentMode].break;
    el.textContent = `${workMin} min work / ${breakMin} min rest`;
}

function startTimer() {
    if (isRunning) return;
    isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;
    modeButtons.forEach(btn => {
        if (!btn.classList.contains("active")) btn.disabled = true;
    });
    // Hide slider handle while running
    const sh = document.getElementById("slider-handle");
    if (sh) sh.style.display = "none";
    // Show arc at full before countdown begins
    updateSliderArc(totalSeconds / 60);
    timerInterval = setInterval(() => {
        remainingSeconds--;
        updateDisplay();
        if (remainingSeconds <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            isRunning = false;
            onTimerComplete();
        }
    }, 1000);
}

function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    btnStart.disabled = false;
    btnPause.disabled = true;
}

function resetTimer() {
    pauseTimer();
    isBreak = false;
    if (currentMode === "custom") {
        totalSeconds = customWorkMinutes * 60;
    } else {
        totalSeconds = MODES[currentMode].work * 60;
    }
    remainingSeconds = totalSeconds;
    updateDisplay();
    modeButtons.forEach(btn => btn.disabled = false);
    btnStart.disabled = false;
    btnPause.disabled = true;
    updateSliderHandle();
}

async function onTimerComplete() {
    playAlertSound();
    flashOverlay.classList.add("active");
    setTimeout(() => flashOverlay.classList.remove("active"), 1500);

    if (!isBreak) {
        // Set up break IMMEDIATELY — before any network calls
        isBreak = true;
        if (currentMode === "custom") {
            totalSeconds = customBreakMinutes * 60;
        } else {
            totalSeconds = MODES[currentMode].break * 60;
        }
        remainingSeconds = totalSeconds;
        updateDisplay();
        setTimeout(() => startTimer(), 2000);

        // Log session in background (non-blocking)
        logSession().catch(e => console.warn("Session log error:", e));
    } else {
        isBreak = false;
        if (currentMode === "custom") {
            totalSeconds = customWorkMinutes * 60;
        } else {
            totalSeconds = MODES[currentMode].work * 60;
        }
        remainingSeconds = totalSeconds;
        updateDisplay();
        modeButtons.forEach(btn => btn.disabled = false);
        btnStart.disabled = false;
        btnPause.disabled = true;
        updateSliderHandle();
    }
}

// ============================================================
// SESSION LOGGING (localStorage)
// ============================================================

async function logSession() {
    const taskName = selectedTodoId
        ? document.querySelector(`[data-id="${selectedTodoId}"] .todo-name`)?.textContent || "Unnamed"
        : "No task selected";

    const session = {
        mode: currentMode,
        task: taskName,
        work_minutes: MODES[currentMode].work,
        completed_at: new Date().toISOString(),
        date: new Date().toISOString().split("T")[0],
    };

    if (currentUser) {
        try {
            await supabaseLogSession(session);
        } catch (e) {
            console.warn("Session log failed:", e);
        }
    } else {
        const data = loadData();
        data.sessions.push(session);
        saveData(data);
    }
    await loadStats();
}

async function loadStats() {
    let sessions;
    if (currentUser) {
        try {
            sessions = await supabaseLoadSessions();
        } catch (e) {
            console.warn("loadStats fetch failed:", e);
            return;
        }
    } else {
        sessions = loadData().sessions;
    }
    const today = new Date().toISOString().split("T")[0];
    const todaySessions = sessions.filter(s => s.date === today);
    const totalMins = todaySessions.reduce((sum, s) => sum + (s.work_minutes || 0), 0);
    const count = todaySessions.length;
    statPomodoros.textContent = `${count} pomodoro${count !== 1 ? "s" : ""}`;
    statMinutes.textContent = `${totalMins} min focused`;
}

// ============================================================
// TASK MODAL
// ============================================================

function openModal() {
    taskModal.classList.remove("hidden");
    document.getElementById("todo-name").focus();
}

function closeModal() {
    taskModal.classList.add("hidden");
    todoForm.reset();
    editingTodoId = null;
    selectedCategory = "university";
    catButtons.forEach(b => b.classList.remove("active"));
    document.querySelector('[data-category="university"]').classList.add("active");
    customCategoryInput.classList.add("hidden");
    courseGroup.classList.remove("hidden");
    document.querySelector('#course-group .form-label').textContent = "Course";
    document.querySelector(".modal-title").textContent = "New Task";
    document.getElementById("btn-submit-todo").textContent = "Add Task";
    setDeadlineValue("");
    closeDatepicker();
}

function setCategory(category) {
    selectedCategory = category;
    catButtons.forEach(b => b.classList.remove("active"));
    document.querySelector(`[data-category="${category}"]`).classList.add("active");

    // Update label based on category
    const courseLabel = document.querySelector('#course-group .form-label');
    if (category === "university") {
        courseLabel.textContent = "Course";
        courseGroup.classList.remove("hidden");
        renderCourseDropdown(category);
    } else if (category === "career" || category === "other") {
        courseLabel.textContent = "Subcategory";
        courseGroup.classList.remove("hidden");
        renderCourseDropdown(category);
    } else {
        courseGroup.classList.add("hidden");
    }

    customCategoryInput.classList.add("hidden");
}

// ============================================================
// TODO LIST (localStorage)
// ============================================================

function calcPomodoros(minutes) {
    return {
        light: Math.ceil(minutes / MODES.light.work),
        deep: Math.ceil(minutes / MODES.deep.work),
        custom: Math.ceil(minutes / (MODES.custom.work || 25)),
    };
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatDeadline(dateStr) {
    if (!dateStr) return "";
    const deadline = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const label = `${months[deadline.getMonth()]} ${deadline.getDate()}`;

    let urgencyClass = "";
    if (diffDays < 0) urgencyClass = "deadline-overdue";
    else if (diffDays <= 1) urgencyClass = "deadline-today";
    else if (diffDays <= 3) urgencyClass = "deadline-soon";

    return { label, urgencyClass };
}

function renderTodo(todo) {
    const minutes = todo.estimated_minutes;
    const pomos = calcPomodoros(minutes);
    const isSelected = todo.id === selectedTodoId;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

    const li = document.createElement("li");
    li.className = "todo-item";
    li.dataset.id = todo.id;

    let tagsHtml = "";
    const cat = todo.category || "university";
    const catLabel = cat === "other" && todo.custom_category ? todo.custom_category : cat;
    tagsHtml += `<span class="tag tag-category">${escapeHtml(catLabel)}</span>`;
    if (todo.course) tagsHtml += `<span class="tag tag-course">${escapeHtml(todo.course)}</span>`;
    if (todo.priority) tagsHtml += `<span class="tag tag-priority-${todo.priority}">${todo.priority}</span>`;
    if (todo.urgency) tagsHtml += `<span class="tag tag-urgency-${todo.urgency}">${todo.urgency}</span>`;

    let deadlineHtml = "";
    if (todo.deadline) {
        const dl = formatDeadline(todo.deadline);
        let overdueHtml = "";
        if (!todo.completed) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = new Date(todo.deadline + "T00:00:00");
            if (deadlineDate < today) {
                overdueHtml = `<span class="deadline-overdue-label">OVERDUE</span>`;
            }
        }
        deadlineHtml = `<div class="todo-deadline ${dl.urgencyClass}"><span class="deadline-label">Due</span><span class="deadline-date">${dl.label}</span>${overdueHtml}</div>`;
    }

    li.innerHTML = `
        <input type="checkbox" ${todo.completed ? "checked" : ""}>
        <div class="todo-info">
            <div class="todo-name ${todo.completed ? "completed" : ""}">${escapeHtml(todo.name)}</div>
            <div class="todo-tags">${tagsHtml}</div>
            <div class="todo-meta">${timeStr} estimated</div>
            <div class="todo-pomodoros">
                <span class="pomo-badge light"><span class="pomo-count">${pomos.light}</span><span class="pomo-label"> light</span></span>
                <span class="pomo-badge deep"><span class="pomo-count">${pomos.deep}</span><span class="pomo-label"> deep</span></span>
            </div>
        </div>
        ${deadlineHtml}
        <div class="todo-actions">
            <button class="todo-action-btn edit-btn" title="Edit task">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2M1 11l.7-2.8L9.2 .7l2 2L3.8 10.3 1 11z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="todo-action-btn select-btn" title="Work on this task">${isSelected ? "Working" : "Select"}</button>
            <button class="todo-action-btn delete-btn" title="Delete task">X</button>
        </div>
    `;

    li.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
        toggleTodo(todo.id, e.target.checked);
    });
    li.querySelector(".edit-btn").addEventListener("click", () => {
        editTodo(todo.id);
    });
    li.querySelector(".select-btn").addEventListener("click", () => {
        selectTodo(todo.id, todo.name);
    });
    li.querySelector(".delete-btn").addEventListener("click", () => {
        deleteTodo(todo.id);
    });
    return li;
}

async function loadTodos(forceRefresh = false) {
    let todos;
    if (cachedTodos !== null && !forceRefresh) {
        todos = cachedTodos;
    } else {
        // Fresh fetch — only path that hits the network
        const genBefore = _cacheGeneration;
        if (currentUser) {
            try {
                if (!_todosInflight) _todosInflight = supabaseLoadTodos();
                todos = await _todosInflight;
            } catch (e) {
                console.warn("loadTodos fetch failed:", e);
                if (forceRefresh && cachedTodos !== null) {
                    todos = cachedTodos; // graceful: use stale data on failure
                } else {
                    return; // don't cache empty, don't clear DOM
                }
            } finally {
                _todosInflight = null;
            }
            // If user mutated cache during fetch, don't clobber their changes
            if (forceRefresh && _cacheGeneration !== genBefore) return;
        } else {
            todos = loadData().todos;
        }
        // Auto-delete completed tasks older than 7 days (only on fresh fetch)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const expired = todos.filter(t => t.completed && t.completed_at && t.completed_at < sevenDaysAgo);
        for (const t of expired) {
            if (currentUser) {
                supabaseDeleteTodo(t.id); // fire-and-forget
            } else {
                const data = loadData();
                data.todos = data.todos.filter(x => x.id !== t.id);
                saveData(data);
            }
        }
        todos = todos.filter(t => !(t.completed && t.completed_at && t.completed_at < sevenDaysAgo));
    }

    cachedTodos = todos;

    // Sort: tasks with deadlines first (nearest to furthest), then tasks without deadlines
    todos.sort((a, b) => {
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
        if (a.deadline && !b.deadline) return -1;
        if (!a.deadline && b.deadline) return 1;
        return 0;
    });
    if (!currentUser) {
        const data = loadData();
        data.todos = todos;
        saveData(data);
    }
    todoList.innerHTML = "";

    // Filter by active tab
    let tabTodos = activeTab === "current"
        ? todos.filter(t => !t.completed)
        : todos.filter(t => t.completed);

    // Filter by calendar date
    const filteredTodos = selectedCalendarDate
        ? tabTodos.filter(t => t.deadline === selectedCalendarDate)
        : tabTodos;

    if (filteredTodos.length === 0) {
        const emptyMsg = document.createElement("li");
        emptyMsg.className = "todo-empty";
        emptyMsg.textContent = activeTab === "current"
            ? "No active tasks"
            : "No completed tasks";
        todoList.appendChild(emptyMsg);
    } else {
        filteredTodos.forEach(todo => todoList.appendChild(renderTodo(todo)));
    }

    // Always update matrix when todos change
    renderMatrix();
}

async function addTodo(formData) {
    const totalMins = (formData.hours * 60) + formData.minutes;
    if (totalMins <= 0) return;

    const todo = {
        id: Date.now(),
        name: formData.name,
        estimated_minutes: totalMins,
        category: formData.category,
        custom_category: formData.customCategory,
        course: formData.course,
        priority: formData.priority,
        urgency: formData.urgency,
        deadline: formData.deadline,
        completed: false,
        created_at: new Date().toISOString(),
    };

    if (currentUser) {
        if (cachedTodos) {
            // Fast path: cache ready — optimistic push, render instantly
            cachedTodos.push(todo);
            _cacheGeneration++;
            supabaseAddTodo(todo).catch(() => { cachedTodos = null; loadTodos(); });
        } else {
            // Slow path: cache not ready (init still loading) — must await write
            await supabaseAddTodo(todo);
            cachedTodos = null; // force fresh fetch
        }
    } else {
        const data = loadData();
        data.todos.push(todo);
        saveData(data);
        if (cachedTodos) cachedTodos.push(todo);
    }
    await loadTodos();
    await renderCalendar();
}

async function editTodo(id) {
    let todo;
    if (currentUser) {
        const todos = cachedTodos ?? await supabaseLoadTodos();
        todo = todos.find(t => t.id === id);
    } else {
        const data = loadData();
        todo = data.todos.find(t => t.id === id);
    }
    if (!todo) return;

    editingTodoId = id;

    // Open modal and pre-fill with existing values
    openModal();
    document.querySelector(".modal-title").textContent = "Edit Task";
    document.getElementById("btn-submit-todo").textContent = "Confirm";

    document.getElementById("todo-name").value = todo.name;
    const hrs = Math.floor(todo.estimated_minutes / 60);
    const mins = todo.estimated_minutes % 60;
    document.getElementById("todo-hours").value = hrs;
    document.getElementById("todo-minutes").value = mins;

    // Set category
    setCategory(todo.category || "university");
    if (todo.category === "other" && todo.custom_category) {
        customCategoryInput.value = todo.custom_category;
    }

    // Set course
    if (todo.course) {
        document.getElementById("todo-course").value = todo.course;
    }

    // Set priority and urgency
    document.getElementById("todo-priority").value = todo.priority || "low";
    document.getElementById("todo-urgency").value = todo.urgency || "flexible";

    // Set deadline
    setDeadlineValue(todo.deadline || "");
}

async function updateTodo(id, formData) {
    const totalMins = (formData.hours * 60) + formData.minutes;
    if (totalMins <= 0) return;

    const updates = {
        name: formData.name,
        estimated_minutes: totalMins,
        category: formData.category,
        custom_category: formData.customCategory,
        course: formData.course,
        priority: formData.priority,
        urgency: formData.urgency,
        deadline: formData.deadline,
    };

    if (currentUser) {
        if (cachedTodos) {
            const cached = cachedTodos.find(t => t.id === id);
            if (cached) Object.assign(cached, updates);
            _cacheGeneration++;
            supabaseUpdateTodo(id, updates).catch(() => { cachedTodos = null; loadTodos(); });
        } else {
            await supabaseUpdateTodo(id, updates);
            cachedTodos = null;
        }
    } else {
        const data = loadData();
        const todo = data.todos.find(t => t.id === id);
        if (!todo) return;
        Object.assign(todo, updates);
        saveData(data);
        if (cachedTodos) {
            const cached = cachedTodos.find(t => t.id === id);
            if (cached) Object.assign(cached, updates);
        }
    }
    await loadTodos();
    await renderCalendar();
}

async function toggleTodo(id, completed) {
    const completedAt = completed ? new Date().toISOString() : null;

    if (completed) {
        // Add fade-out animation
        const item = document.querySelector(`[data-id="${id}"]`);
        if (item) {
            item.style.transition = "opacity 0.4s ease, transform 0.4s ease";
            item.style.opacity = "0";
            item.style.transform = "scale(0.95)";
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    }

    // Optimistic: update cache immediately
    if (cachedTodos) {
        const cached = cachedTodos.find(t => t.id === id);
        if (cached) { cached.completed = completed; cached.completed_at = completedAt; }
        _cacheGeneration++;
    }

    if (currentUser) {
        if (cachedTodos) {
            supabaseToggleTodo(id, completed, completedAt).catch(() => { cachedTodos = null; loadTodos(); });
        } else {
            await supabaseToggleTodo(id, completed, completedAt);
            cachedTodos = null;
        }
    } else {
        const data = loadData();
        const todo = data.todos.find(t => t.id === id);
        if (todo) {
            todo.completed = completed;
            todo.completed_at = completedAt;
            saveData(data);
        }
    }

    await loadTodos();
}

async function deleteTodo(id) {
    // Optimistic: remove from cache immediately
    if (cachedTodos) {
        cachedTodos = cachedTodos.filter(t => t.id !== id);
        _cacheGeneration++;
    }

    if (currentUser) {
        if (cachedTodos) {
            supabaseDeleteTodo(id).catch(() => { cachedTodos = null; loadTodos(); });
        } else {
            await supabaseDeleteTodo(id);
            cachedTodos = null;
        }
    } else {
        const data = loadData();
        data.todos = data.todos.filter(t => t.id !== id);
        saveData(data);
    }
    if (selectedTodoId === id) {
        selectedTodoId = null;
        currentTaskDiv.classList.add("hidden");
    }
    await loadTodos();
    await renderCalendar();
}

function selectTodo(id, name) {
    // Flip the previously-selected task's button back to "Select"
    if (selectedTodoId && selectedTodoId !== id) {
        const prev = todoList.querySelector(`[data-id="${selectedTodoId}"] .select-btn`);
        if (prev) prev.textContent = "Select";
    }
    selectedTodoId = id;
    currentTaskName.textContent = name;
    currentTaskDiv.classList.remove("hidden");
    // Mark the newly-selected task's button as "Working"
    const curr = todoList.querySelector(`[data-id="${id}"] .select-btn`);
    if (curr) curr.textContent = "Working";
}

// ============================================================
// EXPORT / IMPORT
// ============================================================

async function exportData() {
    let data;
    if (currentUser) {
        const todos = await supabaseLoadTodos();
        const sessions = await supabaseLoadSessions();
        data = { todos, sessions };
    } else {
        data = loadData();
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `focusgrid-data-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.todos && data.sessions) {
                if (currentUser) {
                    for (const todo of data.todos) {
                        todo.user_id = currentUser.id;
                        await supabaseAddTodo(todo);
                    }
                    for (const session of data.sessions) {
                        await supabaseLogSession(session);
                    }
                } else {
                    saveData(data);
                }
                await loadTodos();
                await loadStats();
            }
        } catch {
            alert("Invalid file format. Please select a valid FocusGrid export file.");
        }
    };
    reader.readAsText(file);
}

// ============================================================
// CLOCK & CALENDAR
// ============================================================

function updateClock() {
    const now = new Date();
    clockTime.textContent = now.toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    clockDate.textContent = now.toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = now.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();
    clockTimezone.textContent = `${tz} (${offset})`;
}

let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();

function getDeadlineDates() {
    const source = cachedTodos ?? loadData().todos;
    const dates = new Set();
    source.forEach(t => { if (t.deadline && !t.completed) dates.add(t.deadline); });
    return dates;
}

async function renderCalendar() {
    const months = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    calMonthYear.textContent = `${months[calendarMonth]} ${calendarYear}`;

    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrev = new Date(calendarYear, calendarMonth, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getMonth() === calendarMonth && today.getFullYear() === calendarYear;
    const deadlineDates = getDeadlineDates();

    let html = "";
    for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="cal-day other-month">${daysInPrev - i}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = isCurrentMonth && d === today.getDate();
        const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const hasDeadline = deadlineDates.has(dateStr);
        const isSelected = selectedCalendarDate === dateStr;
        let cls = "cal-day cal-day-interactive";
        if (isToday) cls += " today";
        if (hasDeadline) cls += " has-deadline";
        if (isSelected) cls += " selected";
        html += `<div class="${cls}" data-date="${dateStr}">${d}</div>`;
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
        html += `<div class="cal-day other-month">${i}</div>`;
    }
    calDays.innerHTML = html;

    // Add click listeners to interactive days
    calDays.querySelectorAll(".cal-day-interactive").forEach(dayEl => {
        dayEl.addEventListener("click", async () => {
            const date = dayEl.dataset.date;
            if (selectedCalendarDate === date) {
                selectedCalendarDate = null;
            } else {
                selectedCalendarDate = date;
            }
            await renderCalendar();
            await loadTodos();
        });
    });

    // Update filter info
    const filterInfo = document.getElementById("cal-filter-info");
    if (selectedCalendarDate) {
        const d = new Date(selectedCalendarDate + "T00:00:00");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        filterInfo.innerHTML = `Showing tasks due <strong>${monthNames[d.getMonth()]} ${d.getDate()}</strong> <button id="cal-clear-filter" class="cal-clear-btn">&times;</button>`;
        filterInfo.classList.remove("hidden");
        document.getElementById("cal-clear-filter").addEventListener("click", async () => {
            selectedCalendarDate = null;
            await renderCalendar();
            await loadTodos();
        });
    } else {
        filterInfo.classList.add("hidden");
    }
}

// ============================================================
// EISENHOWER MATRIX
// ============================================================

function renderMatrix() {
    if (cachedTodos === null) return; // no data yet — keep current display
    const todos = cachedTodos;

    // Filter: only active tasks from selected category
    const activeTasks = todos.filter(t =>
        !t.completed &&
        t.category === matrixCategory
    );

    // Group into quadrants
    const quadrants = {
        do: [],        // high + critical
        schedule: [],  // high + flexible
        delegate: [],  // low + critical
        delete: []     // low + flexible
    };

    activeTasks.forEach(task => {
        const importance = task.priority || "low";
        const urgency = task.urgency || "flexible";

        if (importance === "high" && urgency === "critical") {
            quadrants.do.push(task);
        } else if (importance === "high" && urgency === "flexible") {
            quadrants.schedule.push(task);
        } else if (importance === "low" && urgency === "critical") {
            quadrants.delegate.push(task);
        } else {
            quadrants.delete.push(task);
        }
    });

    // Render each quadrant
    Object.keys(quadrants).forEach(quadrantName => {
        renderQuadrant(quadrantName, quadrants[quadrantName]);
    });
}

function renderQuadrant(quadrantName, tasks) {
    const container = document.getElementById(`quadrant-${quadrantName}`);
    const expandBtn = container.parentElement.querySelector(".quadrant-expand");
    const isExpanded = expandedQuadrants.has(quadrantName);

    container.innerHTML = "";

    if (tasks.length === 0) {
        container.innerHTML = '<li style="color: var(--text-muted); font-size: 0.72rem; opacity: 0.5;">No tasks</li>';
        expandBtn.classList.add("hidden");
        return;
    }

    tasks.forEach((task, index) => {
        const chip = document.createElement("li");
        chip.className = "matrix-task-chip";
        if (index >= 6 && !isExpanded) {
            chip.classList.add("hidden-overflow");
        }

        chip.innerHTML = `<span class="task-chip-name">${escapeHtml(task.name)}</span>`;

        // Click to edit task
        chip.addEventListener("click", () => editTodo(task.id));

        container.appendChild(chip);
    });

    // Show/hide expand button
    if (tasks.length > 6) {
        expandBtn.classList.remove("hidden");
        expandBtn.textContent = isExpanded
            ? "Show less"
            : `+${tasks.length - 6} more`;
    } else {
        expandBtn.classList.add("hidden");
    }
}

// ============================================================
// CUSTOM DATE PICKER (for deadline field)
// ============================================================

let dpMonth = new Date().getMonth();
let dpYear = new Date().getFullYear();
const dpTrigger = document.getElementById("datepicker-trigger");
const dpDropdown = document.getElementById("datepicker-dropdown");
const dpDisplay = document.getElementById("datepicker-display");
const dpDays = document.getElementById("dp-days");
const dpMonthYear = document.getElementById("dp-month-year");
const dpPrev = document.getElementById("dp-prev");
const dpNext = document.getElementById("dp-next");
const dpClear = document.getElementById("dp-clear");
const deadlineInput = document.getElementById("todo-deadline");

function openDatepicker() {
    // If there's already a value, navigate to that month
    if (deadlineInput.value) {
        const d = new Date(deadlineInput.value + "T00:00:00");
        dpMonth = d.getMonth();
        dpYear = d.getFullYear();
    }
    renderDatepicker();
    dpDropdown.classList.remove("hidden");
}

function closeDatepicker() {
    dpDropdown.classList.add("hidden");
}

function setDeadlineValue(dateStr) {
    deadlineInput.value = dateStr;
    if (dateStr) {
        const d = new Date(dateStr + "T00:00:00");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        dpDisplay.textContent = `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
        dpDisplay.classList.add("has-value");
    } else {
        dpDisplay.textContent = "No deadline set";
        dpDisplay.classList.remove("has-value");
    }
}

function renderDatepicker() {
    const months = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    dpMonthYear.textContent = `${months[dpMonth]} ${dpYear}`;

    const firstDay = new Date(dpYear, dpMonth, 1).getDay();
    const daysInMonth = new Date(dpYear, dpMonth + 1, 0).getDate();
    const daysInPrev = new Date(dpYear, dpMonth, 0).getDate();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const selectedVal = deadlineInput.value;

    let html = "";
    for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="dp-day other-month">${daysInPrev - i}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${dpYear}-${String(dpMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        let cls = "dp-day";
        if (dateStr === todayStr) cls += " today";
        if (dateStr === selectedVal) cls += " selected";
        html += `<div class="${cls}" data-date="${dateStr}">${d}</div>`;
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
        html += `<div class="dp-day other-month">${i}</div>`;
    }
    dpDays.innerHTML = html;

    dpDays.querySelectorAll(".dp-day:not(.other-month)").forEach(dayEl => {
        dayEl.addEventListener("click", () => {
            setDeadlineValue(dayEl.dataset.date);
            closeDatepicker();
        });
    });
}

dpTrigger.addEventListener("click", () => {
    dpDropdown.classList.contains("hidden") ? openDatepicker() : closeDatepicker();
});

dpPrev.addEventListener("click", () => {
    dpMonth--;
    if (dpMonth < 0) { dpMonth = 11; dpYear--; }
    renderDatepicker();
});

dpNext.addEventListener("click", () => {
    dpMonth++;
    if (dpMonth > 11) { dpMonth = 0; dpYear++; }
    renderDatepicker();
});

dpClear.addEventListener("click", () => {
    setDeadlineValue("");
    closeDatepicker();
});

// Close datepicker when clicking outside
document.addEventListener("click", (e) => {
    if (!dpDropdown.classList.contains("hidden") && !e.target.closest(".datepicker-wrapper")) {
        closeDatepicker();
    }
});

// ============================================================
// EVENT LISTENERS
// ============================================================

btnStart.addEventListener("click", startTimer);
btnPause.addEventListener("click", pauseTimer);
btnReset.addEventListener("click", resetTimer);
modeButtons.forEach(btn => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

// ============================================================
// CIRCULAR SLIDER
// ============================================================

const sliderHandle = document.getElementById("slider-handle");
const sliderRing = document.querySelector(".slider-interaction-ring");
const ringContainer = document.querySelector(".timer-ring-container");
const breakSelector = document.getElementById("break-selector");

function angleToDuration(angleDeg) {
    // Map 0-360 degrees to 5-60 min (12 steps of 5 min)
    // 0 deg is top (12 o'clock)
    let norm = ((angleDeg % 360) + 360) % 360;
    let minutes = Math.round(norm / 360 * 12) * 5;
    if (minutes === 0) minutes = 60; // full circle = 60
    return Math.max(5, Math.min(60, minutes));
}

function durationToAngle(minutes) {
    // Map 5-60 min to 0-360 deg (clockwise from top)
    return ((minutes % 60) / 60) * 360;
}

function updateSliderHandle() {
    if (!sliderHandle || !ringContainer) return;
    const workMin = currentMode === "custom" ? customWorkMinutes : MODES[currentMode].work;
    const angleDeg = durationToAngle(workMin);
    const angleRad = (angleDeg - 90) * (Math.PI / 180); // -90 to start from top
    const containerRect = ringContainer.getBoundingClientRect();
    const cx = containerRect.width / 2;
    const cy = containerRect.height / 2;
    const ringRadius = cx * (90 / 100); // r=90 in viewBox 200
    const x = cx + ringRadius * Math.cos(angleRad);
    const y = cy + ringRadius * Math.sin(angleRad);
    sliderHandle.style.left = `${x}px`;
    sliderHandle.style.top = `${y}px`;
    sliderHandle.style.display = isRunning ? "none" : "block";
    updateSliderArc(workMin);
}

function updateSliderArc(minutes) {
    const arc = document.querySelector(".slider-arc");
    if (!arc) return;
    const circumference = 2 * Math.PI * 90;
    // fraction of 60 minutes
    const fraction = minutes / 60;
    const dashLen = circumference * fraction;
    arc.style.strokeDasharray = `${dashLen} ${circumference}`;
    arc.style.stroke = currentMode === "custom" ? MODES.custom.color : MODES[currentMode].color;
}

function getAngleFromEvent(e, container) {
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    let angle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
    angle = (angle + 90 + 360) % 360; // Normalize so 0 deg = top
    return angle;
}

function onSliderDrag(e) {
    if (!isDraggingSlider || isRunning) return;
    e.preventDefault();
    const angle = getAngleFromEvent(e, ringContainer);
    const newMinutes = angleToDuration(angle);
    customWorkMinutes = newMinutes;

    // Switch to custom mode
    if (currentMode !== "custom") {
        currentMode = "custom";
        MODES.custom.work = customWorkMinutes;
        modeButtons.forEach(btn => btn.classList.remove("active"));
        document.documentElement.style.setProperty("--active-color", MODES.custom.color);
        progressRing.style.stroke = MODES.custom.color;
        toggleBreakSelector(true);
    }
    MODES.custom.work = customWorkMinutes;
    totalSeconds = customWorkMinutes * 60;
    remainingSeconds = totalSeconds;
    isBreak = false;
    updateDisplay();
    updateSliderHandle();
    updateModeInfo();
}

function onSliderEnd() {
    if (isDraggingSlider) {
        isDraggingSlider = false;
        document.body.style.cursor = "";
        if (sliderRing) sliderRing.style.cursor = "grab";
    }
}

// Mouse events
if (sliderRing) {
    sliderRing.addEventListener("mousedown", (e) => {
        if (isRunning) return;
        isDraggingSlider = true;
        document.body.style.cursor = "grabbing";
        sliderRing.style.cursor = "grabbing";
        onSliderDrag(e);
    });
}
if (sliderHandle) {
    sliderHandle.addEventListener("mousedown", (e) => {
        if (isRunning) return;
        isDraggingSlider = true;
        document.body.style.cursor = "grabbing";
        e.preventDefault();
    });
}
document.addEventListener("mousemove", onSliderDrag);
document.addEventListener("mouseup", onSliderEnd);

// Touch events
if (sliderRing) {
    sliderRing.addEventListener("touchstart", (e) => {
        if (isRunning) return;
        isDraggingSlider = true;
        onSliderDrag(e);
    }, { passive: false });
}
if (sliderHandle) {
    sliderHandle.addEventListener("touchstart", (e) => {
        if (isRunning) return;
        isDraggingSlider = true;
        e.preventDefault();
    }, { passive: false });
}
document.addEventListener("touchmove", onSliderDrag, { passive: false });
document.addEventListener("touchend", onSliderEnd);

// ============================================================
// BREAK SELECTOR
// ============================================================

function toggleBreakSelector(show) {
    if (breakSelector) {
        breakSelector.classList.toggle("hidden", !show);
    }
}

document.querySelectorAll(".break-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        customBreakMinutes = parseInt(btn.dataset.break, 10);
        MODES.custom.break = customBreakMinutes;
        document.querySelectorAll(".break-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        updateModeInfo();
    });
});

// Position slider handle on load and resize
window.addEventListener("resize", updateSliderHandle);
setTimeout(updateSliderHandle, 100);

btnAddTask.addEventListener("click", () => {
    taskModal.classList.contains("hidden") ? openModal() : closeModal();
});
btnCloseModal.addEventListener("click", closeModal);

catButtons.forEach(btn => {
    btn.addEventListener("click", () => setCategory(btn.dataset.category));
});

// Course management
const btnManageCourses = document.getElementById("btn-manage-courses");
const courseManager = document.getElementById("course-manager");
const btnAddCourse = document.getElementById("btn-add-course");
const newCourseInput = document.getElementById("new-course-input");
const courseSearch = document.getElementById("course-search");

btnManageCourses.addEventListener("click", () => {
    courseManager.classList.toggle("hidden");
    if (!courseManager.classList.contains("hidden")) {
        courseSearch.value = "";
        // Update placeholder based on category
        const placeholder = selectedCategory === "university" ? "e.g. MATH 323" : "e.g. Job Search";
        newCourseInput.placeholder = placeholder;
        courseSearch.placeholder = selectedCategory === "university" ? "Search courses..." : "Search subcategories...";
        renderCourseList();
        newCourseInput.focus();
    }
});

btnAddCourse.addEventListener("click", () => {
    addCourse(newCourseInput.value);
    newCourseInput.value = "";
    newCourseInput.focus();
});

newCourseInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        addCourse(newCourseInput.value);
        newCourseInput.value = "";
    }
});

courseSearch.addEventListener("input", (e) => {
    renderCourseList(e.target.value);
});

// Task tab switching
document.querySelectorAll(".task-tab").forEach(tab => {
    tab.addEventListener("click", async () => {
        activeTab = tab.dataset.tab;
        document.querySelectorAll(".task-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        await loadTodos();
    });
});

// Matrix category switching
document.querySelectorAll(".matrix-cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        matrixCategory = btn.dataset.category;
        document.querySelectorAll(".matrix-cat-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderMatrix();
    });
});

// Quadrant expand/collapse
document.querySelectorAll(".quadrant-expand").forEach(btn => {
    btn.addEventListener("click", () => {
        const quadrantName = btn.dataset.quadrant;
        const container = document.getElementById(`quadrant-${quadrantName}`);

        if (expandedQuadrants.has(quadrantName)) {
            expandedQuadrants.delete(quadrantName);
            container.classList.remove("expanded");
        } else {
            expandedQuadrants.add(quadrantName);
            container.classList.add("expanded");
        }

        renderMatrix();
    });
});

// Custom duration arrow buttons
document.querySelectorAll(".duration-arrow").forEach(btn => {
    btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        const step = parseInt(btn.dataset.step);
        const min = parseInt(input.min);
        const max = parseInt(input.max);
        let val = parseInt(input.value) || 0;

        if (btn.classList.contains("duration-up")) {
            if (step === 5) {
                val = Math.min(max, Math.ceil((val + 1) / 5) * 5);
            } else {
                val = Math.min(max, val + step);
            }
        } else {
            if (step === 5) {
                val = Math.max(min, Math.floor((val - 1) / 5) * 5);
            } else {
                val = Math.max(min, val - step);
            }
        }
        input.value = val;
    });
});

// Safety net: block native submit if Enter is pressed in a form field
todoForm.addEventListener("submit", (e) => e.preventDefault());

document.getElementById("btn-submit-todo").addEventListener("click", async () => {
    const name = document.getElementById("todo-name").value.trim();
    const hours = parseInt(document.getElementById("todo-hours").value) || 0;
    const mins = parseInt(document.getElementById("todo-minutes").value) || 0;
    const course = !courseGroup.classList.contains("hidden") ? document.getElementById("todo-course").value : "";
    const priority = document.getElementById("todo-priority").value;
    const urgency = document.getElementById("todo-urgency").value;
    const customCategory = "";
    const deadline = document.getElementById("todo-deadline").value;

    if (name && (hours > 0 || mins > 0)) {
        const formData = { name, hours, minutes: mins, category: selectedCategory, customCategory, course, priority, urgency, deadline };
        const wasEditing = editingTodoId;
        closeModal(); // close immediately for instant feedback
        if (wasEditing) {
            await updateTodo(wasEditing, formData);
        } else {
            await addTodo(formData);
        }
    }
});

calPrev.addEventListener("click", async () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    await renderCalendar();
});

calNext.addEventListener("click", async () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    await renderCalendar();
});

btnExport.addEventListener("click", () => exportData());
btnImport.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", (e) => {
    if (e.target.files[0]) {
        importData(e.target.files[0]);
        e.target.value = "";
    }
});

// ============================================================
// AUTH MODAL HANDLERS
// ============================================================

const authModal = document.getElementById("auth-modal");
const btnSignIn = document.getElementById("btn-sign-in");
const btnCloseAuth = document.getElementById("btn-close-auth");
const btnSignOut = document.getElementById("btn-sign-out");
const btnGoogleSignin = document.getElementById("btn-google-signin");
const authForm = document.getElementById("auth-form");
const btnAuthToggle = document.getElementById("btn-auth-toggle");
const authError = document.getElementById("auth-error");
let authIsSignUp = false;

if (btnSignIn) btnSignIn.addEventListener("click", () => {
    authModal.classList.remove("hidden");
});

if (btnCloseAuth) btnCloseAuth.addEventListener("click", () => {
    authModal.classList.add("hidden");
    authError.classList.add("hidden");
});

if (btnSignOut) btnSignOut.addEventListener("click", async () => {
    await signOut();
    await loadTodos();
    await loadStats();
    await renderCalendar();
});

if (btnGoogleSignin) btnGoogleSignin.addEventListener("click", () => {
    signInWithGoogle();
});

if (btnAuthToggle) btnAuthToggle.addEventListener("click", () => {
    authIsSignUp = !authIsSignUp;
    document.getElementById("auth-modal-title").textContent = authIsSignUp ? "Sign Up" : "Sign In";
    document.getElementById("auth-submit-btn").textContent = authIsSignUp ? "Sign Up" : "Sign In";
    document.getElementById("auth-toggle-text").textContent = authIsSignUp ? "Already have an account?" : "Don't have an account?";
    btnAuthToggle.textContent = authIsSignUp ? "Sign In" : "Sign Up";
    authError.classList.add("hidden");
});

if (authForm) authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    authError.classList.add("hidden");
    const authSuccess = document.getElementById("auth-success");
    if (authSuccess) authSuccess.classList.add("hidden");

    try {
        if (authIsSignUp) {
            // Validate password client-side first
            const pwError = validatePassword(password);
            if (pwError) throw new Error(pwError);

            const data = await signUpWithEmail(email, password);
            // If email confirmation is required, show a success message
            if (data?.user && !data.session) {
                if (authSuccess) {
                    authSuccess.textContent = "Account created! Check your email to confirm before signing in.";
                    authSuccess.classList.remove("hidden");
                }
                authForm.reset();
                return; // Don't close modal — let them read the message
            }
        } else {
            await signInWithEmail(email, password);
        }
        authModal.classList.add("hidden");
        authForm.reset();
        if (authSuccess) authSuccess.classList.add("hidden");
    } catch (err) {
        authError.textContent = err.message;
        authError.classList.remove("hidden");
    }
});

// ============================================================
// INIT
// ============================================================

(async () => {
    updateDisplay();
    renderCourseDropdown();

    // Check for existing Supabase session before loading data
    if (typeof sb !== "undefined" && sb) {
        try {
            const { data: { session } } = await sb.auth.getSession();
            if (session?.user) {
                currentUser = session.user;
                updateAuthUI(true);
                await migrateLocalStorageToSupabase(currentUser.id);
            }
        } catch (err) {
            console.warn("Session check error:", err);
        }
    }

    // Start clock immediately (never blocks)
    updateClock();
    setInterval(updateClock, 1000);

    // Load todos and stats in parallel — cuts init time in half
    await Promise.all([
        loadTodos().catch(err => console.warn("Failed to load todos:", err)),
        loadStats().catch(err => console.warn("Failed to load stats:", err)),
    ]);

    // Calendar + matrix use cachedTodos so they must run after loadTodos
    renderCalendar();
    renderMatrix();

    // Signal that init is done — auth listener can now handle changes
    _appInitialized = true;
})();

// When tab regains focus, background-refresh while keeping stale cache usable.
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && _appInitialized) {
        if (currentUser) {
            loadTodos(true).catch(e => console.warn("Visibility refresh:", e));
        }
    }
});

