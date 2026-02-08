// ============================================================
// Pomodoro Timer — Static Version (localStorage)
// ============================================================

const MODES = {
    light:  { work: 25, break: 5,  color: "#4ecca3" },
    medium: { work: 35, break: 7,  color: "#f0a500" },
    deep:   { work: 50, break: 10, color: "#e74c3c" },
};

// --- State ---
let currentMode = "light";
let totalSeconds = MODES.light.work * 60;
let remainingSeconds = totalSeconds;
let timerInterval = null;
let isRunning = false;
let isBreak = false;
let selectedTodoId = null;
let selectedCategory = "university";
let editingTodoId = null;

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

function loadData() {
    const raw = localStorage.getItem("pomodoro_data");
    if (!raw) return { todos: [], sessions: [] };
    try { return JSON.parse(raw); } catch { return { todos: [], sessions: [] }; }
}

function saveData(data) {
    localStorage.setItem("pomodoro_data", JSON.stringify(data));
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
    function playTone(freq, start, duration) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.3, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + duration);
        osc.start(start);
        osc.stop(start + duration);
    }
    playTone(523, now, 0.3);
    playTone(659, now + 0.15, 0.3);
    playTone(784, now + 0.3, 0.5);
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
    document.title = `${formatTime(remainingSeconds)} — ${isBreak ? "Break" : "Work"} | Pomodoro`;
    document.body.classList.toggle("on-break", isBreak);
}

function setMode(mode) {
    if (isRunning) return;
    currentMode = mode;
    const config = MODES[mode];
    modeButtons.forEach(btn => btn.classList.remove("active"));
    document.querySelector(`[data-mode="${mode}"]`).classList.add("active");
    document.documentElement.style.setProperty("--active-color", config.color);
    progressRing.style.stroke = config.color;
    isBreak = false;
    totalSeconds = config.work * 60;
    remainingSeconds = totalSeconds;
    updateDisplay();
}

function startTimer() {
    if (isRunning) return;
    isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;
    modeButtons.forEach(btn => {
        if (!btn.classList.contains("active")) btn.disabled = true;
    });
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
    totalSeconds = MODES[currentMode].work * 60;
    remainingSeconds = totalSeconds;
    updateDisplay();
    modeButtons.forEach(btn => btn.disabled = false);
    btnStart.disabled = false;
    btnPause.disabled = true;
}

function onTimerComplete() {
    playAlertSound();
    flashOverlay.classList.add("active");
    setTimeout(() => flashOverlay.classList.remove("active"), 1500);

    if (!isBreak) {
        logSession();
        isBreak = true;
        totalSeconds = MODES[currentMode].break * 60;
        remainingSeconds = totalSeconds;
        updateDisplay();
        setTimeout(() => startTimer(), 2000);
    } else {
        isBreak = false;
        totalSeconds = MODES[currentMode].work * 60;
        remainingSeconds = totalSeconds;
        updateDisplay();
        modeButtons.forEach(btn => btn.disabled = false);
        btnStart.disabled = false;
        btnPause.disabled = true;
    }
}

// ============================================================
// SESSION LOGGING (localStorage)
// ============================================================

function logSession() {
    const taskName = selectedTodoId
        ? document.querySelector(`[data-id="${selectedTodoId}"] .todo-name`)?.textContent || "Unnamed"
        : "No task selected";

    const data = loadData();
    data.sessions.push({
        mode: currentMode,
        task: taskName,
        work_minutes: MODES[currentMode].work,
        completed_at: new Date().toISOString(),
        date: new Date().toISOString().split("T")[0],
    });
    saveData(data);
    loadStats();
}

function loadStats() {
    const data = loadData();
    const today = new Date().toISOString().split("T")[0];
    const todaySessions = data.sessions.filter(s => s.date === today);
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
    document.querySelector(".modal-title").textContent = "New Task";
    document.querySelector(".submit-task-btn").textContent = "Add Task";
}

function setCategory(category) {
    selectedCategory = category;
    catButtons.forEach(b => b.classList.remove("active"));
    document.querySelector(`[data-category="${category}"]`).classList.add("active");
    if (category === "university") {
        courseGroup.classList.remove("hidden");
    } else {
        courseGroup.classList.add("hidden");
    }
    if (category === "other") {
        customCategoryInput.classList.remove("hidden");
        customCategoryInput.focus();
    } else {
        customCategoryInput.classList.add("hidden");
    }
}

// ============================================================
// TODO LIST (localStorage)
// ============================================================

function calcPomodoros(minutes) {
    return {
        light: Math.ceil(minutes / MODES.light.work),
        medium: Math.ceil(minutes / MODES.medium.work),
        deep: Math.ceil(minutes / MODES.deep.work),
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
        deadlineHtml = `<div class="todo-deadline ${dl.urgencyClass}"><span class="deadline-label">Due</span><span class="deadline-date">${dl.label}</span></div>`;
    }

    li.innerHTML = `
        <input type="checkbox" ${todo.completed ? "checked" : ""}>
        <div class="todo-info">
            <div class="todo-name ${todo.completed ? "completed" : ""}">${escapeHtml(todo.name)}</div>
            <div class="todo-tags">${tagsHtml}</div>
            <div class="todo-meta">${timeStr} estimated</div>
            <div class="todo-pomodoros">
                <span class="pomo-badge light"><span class="pomo-count">${pomos.light}</span><span class="pomo-label"> light</span></span>
                <span class="pomo-badge medium"><span class="pomo-count">${pomos.medium}</span><span class="pomo-label"> med</span></span>
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

function loadTodos() {
    const data = loadData();
    todoList.innerHTML = "";
    data.todos.forEach(todo => todoList.appendChild(renderTodo(todo)));
}

function addTodo(formData) {
    const totalMins = (formData.hours * 60) + formData.minutes;
    if (totalMins <= 0) return;

    const data = loadData();
    data.todos.push({
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
    });
    saveData(data);
    loadTodos();
}

function editTodo(id) {
    const data = loadData();
    const todo = data.todos.find(t => t.id === id);
    if (!todo) return;

    editingTodoId = id;

    // Open modal and pre-fill with existing values
    openModal();
    document.querySelector(".modal-title").textContent = "Edit Task";
    document.querySelector(".submit-task-btn").textContent = "Save Changes";

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
    document.getElementById("todo-priority").value = todo.priority || "medium";
    document.getElementById("todo-urgency").value = todo.urgency || "upcoming";

    // Set deadline
    document.getElementById("todo-deadline").value = todo.deadline || "";
}

function updateTodo(id, formData) {
    const totalMins = (formData.hours * 60) + formData.minutes;
    if (totalMins <= 0) return;

    const data = loadData();
    const todo = data.todos.find(t => t.id === id);
    if (!todo) return;

    todo.name = formData.name;
    todo.estimated_minutes = totalMins;
    todo.category = formData.category;
    todo.custom_category = formData.customCategory;
    todo.course = formData.course;
    todo.priority = formData.priority;
    todo.urgency = formData.urgency;
    todo.deadline = formData.deadline;

    saveData(data);
    loadTodos();
}

function toggleTodo(id, completed) {
    const data = loadData();
    const todo = data.todos.find(t => t.id === id);
    if (todo) { todo.completed = completed; saveData(data); }
    loadTodos();
}

function deleteTodo(id) {
    const data = loadData();
    data.todos = data.todos.filter(t => t.id !== id);
    saveData(data);
    if (selectedTodoId === id) {
        selectedTodoId = null;
        currentTaskDiv.classList.add("hidden");
    }
    loadTodos();
}

function selectTodo(id, name) {
    selectedTodoId = id;
    currentTaskName.textContent = name;
    currentTaskDiv.classList.remove("hidden");
    loadTodos();
}

// ============================================================
// EXPORT / IMPORT
// ============================================================

function exportData() {
    const data = loadData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pomodoro-data-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.todos && data.sessions) {
                saveData(data);
                loadTodos();
                loadStats();
            }
        } catch {
            alert("Invalid file format. Please select a valid Pomodoro export file.");
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

function renderCalendar() {
    const months = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
    calMonthYear.textContent = `${months[calendarMonth]} ${calendarYear}`;

    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrev = new Date(calendarYear, calendarMonth, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getMonth() === calendarMonth && today.getFullYear() === calendarYear;

    let html = "";
    for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="cal-day other-month">${daysInPrev - i}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = isCurrentMonth && d === today.getDate();
        html += `<div class="cal-day${isToday ? " today" : ""}">${d}</div>`;
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
        html += `<div class="cal-day other-month">${i}</div>`;
    }
    calDays.innerHTML = html;
}

// ============================================================
// EVENT LISTENERS
// ============================================================

btnStart.addEventListener("click", startTimer);
btnPause.addEventListener("click", pauseTimer);
btnReset.addEventListener("click", resetTimer);
modeButtons.forEach(btn => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

btnAddTask.addEventListener("click", () => {
    taskModal.classList.contains("hidden") ? openModal() : closeModal();
});
btnCloseModal.addEventListener("click", closeModal);

catButtons.forEach(btn => {
    btn.addEventListener("click", () => setCategory(btn.dataset.category));
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

todoForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("todo-name").value.trim();
    const hours = parseInt(document.getElementById("todo-hours").value) || 0;
    const mins = parseInt(document.getElementById("todo-minutes").value) || 0;
    const course = selectedCategory === "university" ? document.getElementById("todo-course").value : "";
    const priority = document.getElementById("todo-priority").value;
    const urgency = document.getElementById("todo-urgency").value;
    const customCategory = selectedCategory === "other" ? customCategoryInput.value.trim() : "";
    const deadline = document.getElementById("todo-deadline").value;

    if (name && (hours > 0 || mins > 0)) {
        const formData = { name, hours, minutes: mins, category: selectedCategory, customCategory, course, priority, urgency, deadline };
        if (editingTodoId) {
            updateTodo(editingTodoId, formData);
        } else {
            addTodo(formData);
        }
        closeModal();
    }
});

calPrev.addEventListener("click", () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar();
});

calNext.addEventListener("click", () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar();
});

btnExport.addEventListener("click", exportData);
btnImport.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", (e) => {
    if (e.target.files[0]) {
        importData(e.target.files[0]);
        e.target.value = "";
    }
});

// ============================================================
// INIT
// ============================================================

updateDisplay();
loadTodos();
loadStats();
updateClock();
setInterval(updateClock, 1000);
renderCalendar();
