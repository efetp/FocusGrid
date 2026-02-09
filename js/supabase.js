// ============================================================
// FocusGrid — Supabase Integration Layer
// ============================================================

// TODO: Replace these with your Supabase project credentials
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;

// ============================================================
// AUTH FUNCTIONS
// ============================================================

async function signInWithGoogle() {
    const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) console.warn("Google sign-in error:", error.message);
}

async function signInWithEmail(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
}

async function signUpWithEmail(email, password) {
    const { error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
}

async function signOut() {
    const { error } = await sb.auth.signOut();
    if (error) console.warn("Sign-out error:", error.message);
    currentUser = null;
}

// ============================================================
// DATABASE OPERATIONS
// ============================================================

async function supabaseLoadTodos() {
    const { data, error } = await sb.from("todos").select("*").order("id", { ascending: true });
    if (error) { console.warn("Load todos error:", error.message); return []; }
    return data.map(row => ({
        id: row.id,
        name: row.name,
        estimated_minutes: row.estimated_minutes,
        category: row.category,
        custom_category: row.custom_category,
        course: row.course,
        priority: row.priority,
        urgency: row.urgency,
        deadline: row.deadline || "",
        completed: row.completed,
        created_at: row.created_at
    }));
}

async function supabaseAddTodo(todo) {
    const { error } = await sb.from("todos").insert({
        id: todo.id,
        user_id: currentUser.id,
        name: todo.name,
        estimated_minutes: todo.estimated_minutes,
        category: todo.category,
        custom_category: todo.custom_category || "",
        course: todo.course || "",
        priority: todo.priority,
        urgency: todo.urgency,
        deadline: todo.deadline || "",
        completed: todo.completed || false,
        created_at: todo.created_at || new Date().toISOString()
    });
    if (error) console.warn("Add todo error:", error.message);
}

async function supabaseUpdateTodo(id, updates) {
    const { error } = await sb.from("todos").update(updates).eq("id", id);
    if (error) console.warn("Update todo error:", error.message);
}

async function supabaseDeleteTodo(id) {
    const { error } = await sb.from("todos").delete().eq("id", id);
    if (error) console.warn("Delete todo error:", error.message);
}

async function supabaseToggleTodo(id, completed) {
    const { error } = await sb.from("todos").update({ completed }).eq("id", id);
    if (error) console.warn("Toggle todo error:", error.message);
}

async function supabaseLogSession(session) {
    const { error } = await sb.from("sessions").insert({
        user_id: currentUser.id,
        mode: session.mode,
        task: session.task,
        work_minutes: session.work_minutes,
        completed_at: session.completed_at,
        date: session.date
    });
    if (error) console.warn("Log session error:", error.message);
}

async function supabaseLoadSessions() {
    const { data, error } = await sb.from("sessions").select("*");
    if (error) { console.warn("Load sessions error:", error.message); return []; }
    return data;
}

async function supabaseGetDeadlineDates() {
    const { data, error } = await sb.from("todos")
        .select("deadline")
        .neq("deadline", "")
        .eq("completed", false);
    if (error) { console.warn("Get deadlines error:", error.message); return []; }
    return data.map(r => r.deadline);
}

// ============================================================
// MIGRATION: localStorage → Supabase
// ============================================================

async function migrateLocalStorageToSupabase(userId) {
    const flag = "focusgrid_migrated_" + userId;
    if (localStorage.getItem(flag)) return;

    const raw = localStorage.getItem("focusgrid_data");
    if (!raw) { localStorage.setItem(flag, "1"); return; }

    let local;
    try { local = JSON.parse(raw); } catch { localStorage.setItem(flag, "1"); return; }

    // Migrate todos
    if (local.todos && local.todos.length > 0) {
        const rows = local.todos.map(t => ({
            id: t.id,
            user_id: userId,
            name: t.name,
            estimated_minutes: t.estimated_minutes,
            category: t.category || "university",
            custom_category: t.custom_category || "",
            course: t.course || "",
            priority: t.priority || "medium",
            urgency: t.urgency || "upcoming",
            deadline: t.deadline || "",
            completed: t.completed || false,
            created_at: t.created_at || new Date().toISOString()
        }));
        const { error } = await sb.from("todos").upsert(rows, { onConflict: "id" });
        if (error) console.warn("Migration todos error:", error.message);
    }

    // Migrate sessions
    if (local.sessions && local.sessions.length > 0) {
        const rows = local.sessions.map(s => ({
            user_id: userId,
            mode: s.mode,
            task: s.task,
            work_minutes: s.work_minutes,
            completed_at: s.completed_at,
            date: s.date
        }));
        const { error } = await sb.from("sessions").insert(rows);
        if (error) console.warn("Migration sessions error:", error.message);
    }

    localStorage.setItem(flag, "1");
}

// ============================================================
// AUTH STATE LISTENER
// ============================================================

sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
        currentUser = session.user;
        updateAuthUI(true);
        await migrateLocalStorageToSupabase(currentUser.id);
        // Re-render with Supabase data
        if (typeof loadTodos === "function") await loadTodos();
        if (typeof loadStats === "function") await loadStats();
        if (typeof renderCalendar === "function") await renderCalendar();
    } else {
        currentUser = null;
        updateAuthUI(false);
        if (typeof loadTodos === "function") await loadTodos();
        if (typeof loadStats === "function") await loadStats();
        if (typeof renderCalendar === "function") await renderCalendar();
    }
});

function updateAuthUI(loggedIn) {
    const authBar = document.getElementById("auth-bar");
    const userBar = document.getElementById("user-bar");
    if (!authBar || !userBar) return;

    if (loggedIn) {
        authBar.classList.add("hidden");
        userBar.classList.remove("hidden");
        const userEmail = document.getElementById("user-email");
        if (userEmail) userEmail.textContent = currentUser.email || "User";
    } else {
        authBar.classList.remove("hidden");
        userBar.classList.add("hidden");
    }
}