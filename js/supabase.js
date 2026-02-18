// ============================================================
// FocusGrid — Supabase Integration Layer
// ============================================================

// TODO: Replace these with your Supabase project credentials
const SUPABASE_URL = "https://aueslcxutfsvzekiaznc.supabase.co";
// Paste the "anon public" key from Supabase > Settings > API (starts with eyJ...)
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZXNsY3h1dGZzdnpla2lhem5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjAwMjUsImV4cCI6MjA4NjIzNjAyNX0.VZXangJXNHeu4IOXtJm1o9mWyNQOGGrPyGEPSUeryTs";

let sb = null;
let currentUser = null;

if (window.supabase) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.warn("Supabase CDN not loaded — running in offline/localStorage mode");
}

// ============================================================
// AUTH FUNCTIONS
// ============================================================

async function signInWithGoogle() {
    if (!sb) {
        console.warn("Supabase not initialized - running in offline mode");
        alert("Sign in is not available in offline mode. Please check your internet connection.");
        return;
    }
    const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) console.warn("Google sign-in error:", error.message);
}

async function signInWithEmail(email, password) {
    if (!sb) {
        throw new Error("Supabase not initialized - running in offline mode");
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
}

async function signUpWithEmail(email, password) {
    if (!sb) {
        throw new Error("Supabase not initialized - running in offline mode");
    }
    // Validate password strength before sending to Supabase
    const pwError = validatePassword(password);
    if (pwError) throw new Error(pwError);

    const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
    // Return data so caller can detect email confirmation requirement
    return data;
}

function validatePassword(password) {
    if (password.length < 8) return "Password must be at least 8 characters long.";
    if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
    if (!/[a-zA-Z]/.test(password)) return "Password must contain at least one letter.";
    return null;
}

let _authBusy = false;

async function signOut() {
    _authBusy = true;
    currentUser = null;
    updateAuthUI(false);
    if (!sb) {
        _authBusy = false;
        return;
    }
    try {
        const { error } = await sb.auth.signOut();
        if (error) console.warn("Sign-out error:", error.message);
    } catch (err) {
        console.warn("Sign-out exception:", err);
    }
    _authBusy = false;
}

// ============================================================
// DATABASE OPERATIONS
// ============================================================

async function supabaseLoadTodos() {
    if (!currentUser) { console.warn("No user logged in"); return []; }
    let { data, error } = await sb.from("todos").select("*").eq("user_id", currentUser.id).order("id", { ascending: true });
    if (error) {
        // Token may have expired — refresh session and retry once
        await sb.auth.refreshSession();
        const retry = await sb.from("todos").select("*").eq("user_id", currentUser.id).order("id", { ascending: true });
        data = retry.data;
        error = retry.error;
        if (error) { console.warn("Load todos error:", error.message); return []; }
    }
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
        completed_at: row.completed_at || null,
        created_at: row.created_at
    }));
}

async function supabaseAddTodo(todo) {
    const payload = {
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
    };
    let { error } = await sb.from("todos").insert(payload);
    if (error) {
        await sb.auth.refreshSession();
        const retry = await sb.from("todos").insert(payload);
        if (retry.error) console.warn("Add todo error:", retry.error.message);
    }
}

async function supabaseUpdateTodo(id, updates) {
    let { error } = await sb.from("todos").update(updates).eq("id", id);
    if (error) {
        await sb.auth.refreshSession();
        const retry = await sb.from("todos").update(updates).eq("id", id);
        if (retry.error) console.warn("Update todo error:", retry.error.message);
    }
}

async function supabaseDeleteTodo(id) {
    let { error } = await sb.from("todos").delete().eq("id", id);
    if (error) {
        await sb.auth.refreshSession();
        const retry = await sb.from("todos").delete().eq("id", id);
        if (retry.error) console.warn("Delete todo error:", retry.error.message);
    }
}

async function supabaseToggleTodo(id, completed, completedAt) {
    const payload = { completed, completed_at: completedAt };
    let { error } = await sb.from("todos").update(payload).eq("id", id);
    if (error) {
        await sb.auth.refreshSession();
        const retry = await sb.from("todos").update(payload).eq("id", id);
        if (retry.error) console.warn("Toggle todo error:", retry.error.message);
    }
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
    if (!currentUser) { console.warn("No user logged in"); return []; }
    let { data, error } = await sb.from("sessions").select("*").eq("user_id", currentUser.id);
    if (error) {
        await sb.auth.refreshSession();
        const retry = await sb.from("sessions").select("*").eq("user_id", currentUser.id);
        data = retry.data;
        error = retry.error;
        if (error) { console.warn("Load sessions error:", error.message); return []; }
    }
    return data;
}

async function supabaseGetDeadlineDates() {
    if (!currentUser) { console.warn("No user logged in"); return []; }
    const { data, error } = await sb.from("todos")
        .select("deadline")
        .neq("deadline", "")
        .eq("completed", false)
        .eq("user_id", currentUser.id);
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

// Flag to prevent auth listener from racing with app init
let _appInitialized = false;

if (sb) sb.auth.onAuthStateChange(async (event, session) => {
    if (_authBusy) return; // skip if sign-out is in progress

    if (session?.user) {
        currentUser = session.user;
        updateAuthUI(true);
        if (_appInitialized) {
            cachedTodos = null; // force fresh fetch (prevent stale cache)
            await migrateLocalStorageToSupabase(currentUser.id);
            if (typeof loadTodos === "function") await loadTodos();
            if (typeof loadStats === "function") await loadStats();
            if (typeof renderCalendar === "function") await renderCalendar();
        }
    } else if (event === "SIGNED_OUT") {
        // Only clear user on explicit sign-out, not transient auth events
        currentUser = null;
        updateAuthUI(false);
        if (_appInitialized) {
            if (typeof loadTodos === "function") await loadTodos();
            if (typeof loadStats === "function") await loadStats();
            if (typeof renderCalendar === "function") await renderCalendar();
        }
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
        if (userEmail) userEmail.textContent = currentUser?.email || "User";
    } else {
        authBar.classList.remove("hidden");
        userBar.classList.add("hidden");
    }
}
