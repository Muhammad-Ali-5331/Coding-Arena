// ── Accounts permitted to use Host mode ──
const ALLOWED_HOST_UIDS = new Set([
  "i7NvuygvZOYyWcWpSaLm6uiNMzM2",
   "cvmuwQveDwdeezzeXZsiuhP2Zuk2"
]);

// ============================================================
// FIREBASE CONFIG — paste your own values from Firebase Console
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "__FIREBASE_API_KEY__",
  authDomain:        "__FIREBASE_AUTH_DOMAIN__",
  projectId:         "__FIREBASE_PROJECT_ID__",
  storageBucket:     "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId:             "__FIREBASE_APP_ID__",
};

// ── Firebase runtime refs ──
let _db   = null;
let _auth = null;
let _fbReady   = false;
let _authReady = false;
let _currentUser = null;
let _userRole    = null;

// ============================================================
// FIREBASE INIT
// ============================================================
async function initFirebase() {
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs }
      = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const {
      getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
      signOut, GoogleAuthProvider, signInWithPopup, updateProfile, onAuthStateChanged
    } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");

    const app  = initializeApp(FIREBASE_CONFIG);
    _db   = getFirestore(app);
    _auth = getAuth(app);
    _fbReady   = true;
    _authReady = true;

    window._fs = { doc, getDoc, setDoc, deleteDoc, collection, getDocs, db: _db };
    window._fa = {
      auth: _auth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
      signOut, GoogleAuthProvider, signInWithPopup, updateProfile, onAuthStateChanged
    };
    return true;
  } catch (e) {
    console.warn("Firebase init failed", e);
    return false;
  }
}

// ── Firestore helpers ──
// ============================================================
// FIRESTORE STRUCTURE
//
//   /problems/{problemId}   — one doc per problem, has authorUID field
//   /hosts/{uid}            — { bundle: {name,desc} } per host
//   /users/{uid}            — { role, displayName, email }
//   /solvers/{uid}          — { subs, solved }
//
// Solver view : reads ALL /problems docs  (sees everyone's problems)
// Host view   : reads only problems where authorUID == their UID
// ============================================================

async function fbGetAllProblems() {
  if (!_fbReady) return [];
  try {
    const { collection, getDocs, db } = window._fs;
    const snap = await getDocs(collection(db, "problems"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn("fbGetAllProblems failed", e); return []; }
}

async function fbSaveProblem(problem) {
  if (!_fbReady) return false;
  try {
    const { doc, setDoc, db } = window._fs;
    await setDoc(doc(db, "problems", problem.id), problem);
    return true;
  } catch (e) { console.warn("fbSaveProblem failed", e); return false; }
}

async function fbDeleteProblem(problemId) {
  if (!_fbReady) return;
  try {
    const { doc, deleteDoc, db } = window._fs;
    await deleteDoc(doc(db, "problems", problemId));
  } catch (e) { console.warn("fbDeleteProblem failed", e); }
}

async function fbSaveHostBundle(uid, bundle) {
  if (!_fbReady) return;
  try {
    const { doc, setDoc, db } = window._fs;
    await setDoc(doc(db, "hosts", uid), { bundle }, { merge: true });
  } catch (e) { console.warn("fbSaveHostBundle failed", e); }
}

async function fbLoadHostBundle(uid) {
  if (!_fbReady) return null;
  try {
    const { doc, getDoc, db } = window._fs;
    const snap = await getDoc(doc(db, "hosts", uid));
    return snap.exists() ? snap.data().bundle || null : null;
  } catch (e) { return null; }
}

async function fbSaveUser(uid, data) {
  if (!_fbReady) return;
  try {
    const { doc, setDoc, db } = window._fs;
    await setDoc(doc(db, "users", uid), data, { merge: true });
  } catch (e) { console.warn("fbSaveUser failed", e); }
}

async function fbLoadUser(uid) {
  if (!_fbReady) return null;
  try {
    const { doc, getDoc, db } = window._fs;
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

async function fbSaveSolverData(uid, subs, solved) {
  if (!_fbReady) return;
  try {
    const { doc, setDoc, db } = window._fs;
    await setDoc(doc(db, "solvers", uid), {
      subs, solved: [...solved],
    }, { merge: true });
  } catch (e) { console.warn("fbSaveSolverData failed", e); }
}

async function fbLoadSolverData(uid) {
  if (!_fbReady) return null;
  try {
    const { doc, getDoc, db } = window._fs;
    const snap = await getDoc(doc(db, "solvers", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

// ── One-time migration: move old /hosts/{uid}/data/problems → flat /problems/ ──
async function migrateOldData(hostUID) {
  if (!_fbReady) return;
  try {
    const { doc, getDoc, collection, getDocs, db } = window._fs;
    // Check if this host already has problems in the new structure
    const all = await fbGetAllProblems();
    if (all.some(p => p.authorUID === hostUID)) return; // already migrated

    // Try old per-host path
    const oldSnap = await getDoc(doc(db, "hosts", hostUID, "data", "problems"));
    if (oldSnap.exists()) {
      const list = oldSnap.data()?.list || [];
      for (const p of list) {
        await fbSaveProblem({ ...p, authorUID: hostUID });
      }
      if (list.length) toast(`Migrated ${list.length} problem(s) to your account ✓`, "ok");
    }
    // Try old shared /codeforge/problems path
    const sharedSnap = await getDoc(doc(db, "codeforge", "problems"));
    if (sharedSnap.exists()) {
      const list = sharedSnap.data()?.list || [];
      for (const p of list) {
        if (!all.find(x => x.id === p.id)) {
          await fbSaveProblem({ ...p, authorUID: hostUID });
        }
      }
      if (list.length) toast(`Migrated ${list.length} shared problem(s) ✓`, "ok");
    }
  } catch (e) { console.warn("Migration skipped:", e); }
}

// ============================================================
// CONSTANTS
// ============================================================
const TOPICS = [
  { id: "arrays",     name: "Arrays & Strings",    icon: "[ ]" },
  { id: "linkedlist", name: "Linked Lists",         icon: "-->" },
  { id: "trees",      name: "Trees",                icon: "T"   },
  { id: "graphs",     name: "Graphs",               icon: "G"   },
  { id: "dp",         name: "Dynamic Programming",  icon: "DP"  },
  { id: "sorting",    name: "Sorting & Searching",  icon: "↑↓"  },
  { id: "math",       name: "Math & Number Theory", icon: "Σ"   },
  { id: "stack",      name: "Stack & Queue",        icon: "S/Q" },
  { id: "greedy",     name: "Greedy",               icon: "Gd"  },
  { id: "other",      name: "Other",                icon: "*"   },
];
const LM = {
  python: "python", javascript: "javascript",
  java: "text/x-java", cpp: "text/x-c++src",
};
const LL = {
  python: "Python 3", javascript: "JavaScript", java: "Java", cpp: "C++",
};

// ============================================================
// STATE
// ============================================================
let S = {
  bundle:   { name: "My Challenge Bundle", desc: "" },
  problems: [],   // ALL problems (solver) or MY problems (host)
  editId:   null,
  activeId: null,
  subs:     {},
  solved:   new Set(),
  timerStart: null,
  timerInt:   null,
};
let hEd = null, sEd = null, cTL = "python", col = {};

// ============================================================
// DATA LOAD / SAVE
// ============================================================

// Solver: loads ALL problems from /problems/
// Host:   loads only problems where authorUID == their UID
async function loadProblems() {
  const all = await fbGetAllProblems();
  if (_userRole === "host") {
    S.problems = all.filter(p => p.authorUID === _currentUser.uid);
    // Load this host's bundle info
    const b = await fbLoadHostBundle(_currentUser.uid);
    if (b) S.bundle = b;
  } else {
    // Solvers see every published problem from all hosts
    S.problems = all;
  }
}

// Host saves: each problem is saved individually with authorUID stamp
async function saveProblems() {
  if (_userRole !== "host" || !_currentUser) return;
  // Stamp every problem with this host's UID before saving
  for (const p of S.problems) {
    p.authorUID = _currentUser.uid;
    await fbSaveProblem(p);
  }
  await fbSaveHostBundle(_currentUser.uid, S.bundle);
}

async function loadSolverData() {
  if (!_currentUser) return;
  const d = await fbLoadSolverData(_currentUser.uid);
  if (d) {
    S.subs   = d.subs  || {};
    S.solved = new Set(d.solved || []);
  }
}

async function saveSolverData() {
  if (!_currentUser) return;
  await fbSaveSolverData(_currentUser.uid, S.subs, S.solved);
}


// ============================================================
// AUTH FLOW
// ============================================================
function showAuthScreen(type) {
  document.getElementById("authTitle").textContent =
    type === "register" ? "Create Account" : "Sign In";
  document.getElementById("authNameRow").style.display =
    type === "register" ? "block" : "none";
  document.getElementById("authSubtitle").textContent =
    type === "register"
      ? "Choose your role after creating your account."
      : "Welcome back to CodeForge.";
  document.getElementById("authSwitchBtn").textContent =
    type === "register" ? "Already have an account? Sign in" : "No account? Register";
  document.getElementById("authSwitchBtn").onclick =
    () => showAuthScreen(type === "register" ? "login" : "register");
  document.getElementById("authSubmitBtn").textContent =
    type === "register" ? "Create Account" : "Sign In";
  document.getElementById("authSubmitBtn").onclick =
    () => handleEmailAuth(type);
  document.getElementById("authErr").textContent = "";
  document.getElementById("authEmail").value = "";
  document.getElementById("authPassword").value = "";
  const nameEl = document.getElementById("authName");
  if (nameEl) nameEl.value = "";
  ss("authScreen");
}

async function handleEmailAuth(type) {
  const email    = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const nameEl   = document.getElementById("authName");
  const name     = nameEl ? nameEl.value.trim() : "";
  const errEl    = document.getElementById("authErr");

  if (!email || !password) { errEl.textContent = "Email and password required."; return; }
  if (type === "register" && !name) { errEl.textContent = "Display name required."; return; }
  if (type === "register" && password.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }

  const btn = document.getElementById("authSubmitBtn");
  btn.disabled = true; btn.textContent = "Please wait...";
  errEl.textContent = "";

  try {
    const { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } = window._fa;
    if (type === "register") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await afterAuthSuccess(cred.user, true);
    } else {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await afterAuthSuccess(cred.user, false);
    }
  } catch (e) {
    errEl.textContent = friendlyAuthError(e.code);
    btn.disabled = false;
    btn.textContent = type === "register" ? "Create Account" : "Sign In";
  }
}

async function handleGoogleAuth() {
  const errEl = document.getElementById("authErr");
  errEl.textContent = "";
  try {
    const { auth, GoogleAuthProvider, signInWithPopup } = window._fa;
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const existing = await fbLoadUser(cred.user.uid);
    await afterAuthSuccess(cred.user, !existing);
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user")
      errEl.textContent = friendlyAuthError(e.code);
  }
}

async function afterAuthSuccess(user, isNewUser) {
  _currentUser = user;
  if (isNewUser) {
    showRolePicker(user);
  } else {
    const profile = await fbLoadUser(user.uid);
    if (profile?.role) {
      await enterApp(user, profile.role);
    } else {
      showRolePicker(user);
    }
  }
}

async function showRolePicker(user) {
  // New users are auto-assigned solver role.
  // They can switch to host via the ⇄ Switch Role button in the topbar.
  await fbSaveUser(user.uid, {
    displayName: user.displayName || user.email,
    email: user.email,
    role: "solver",
    createdAt: new Date().toISOString(),
  });
  await enterApp(user, "solver");
}

async function pickRole(role) {
  if (!_currentUser) return;
  const btnId = role === "host" ? "pickHostBtn" : "pickSolverBtn";
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = "Setting up..."; }

  await fbSaveUser(_currentUser.uid, {
    displayName: _currentUser.displayName || _currentUser.email,
    email: _currentUser.email,
    role,
    createdAt: new Date().toISOString(),
  });
  await enterApp(_currentUser, role);
}

async function enterApp(user, role) {
  _userRole    = role;
  _currentUser = user;

  if (role === "host") {
    await migrateOldData(user.uid); // one-time, no-op after first run
    await loadProblems();           // loads only THIS host's problems
    document.getElementById("hbn").textContent = S.bundle.name;
    document.getElementById("hostUserName").textContent = user.displayName || user.email;
    ss("hs");
    initHost();
  } else {
    await loadSolverData();
    await loadProblems();           // loads ALL problems from all hosts
    document.getElementById("solverUserName").textContent = user.displayName || user.email;
    ss("ss");
    initSolver();
  }
}

async function switchRole() {
  const newRole = _userRole === "host" ? "solver" : "host";
  const confirmed = confirm(
    `Switch to ${newRole.toUpperCase()} mode?\n\n` +
    (newRole === "host"
      ? "You'll see only the problems you've created."
      : "You'll see all problems from all hosts.")
  );
  if (!confirmed) return;
  await fbSaveUser(_currentUser.uid, { role: newRole });
  _userRole = newRole;
  S.editId = null; S.activeId = null;
  if (newRole === "solver") { S.subs = {}; S.solved = new Set(); }
  await enterApp(_currentUser, newRole);
  toast(`Switched to ${newRole} mode`, "ok");
}

async function logout() {
  if (S.timerInt) clearInterval(S.timerInt);
  S.timerStart = null;
  if (_authReady) { try { await window._fa.signOut(window._fa.auth); } catch (e) {} }
  _currentUser = null; _userRole = null;
  S = { bundle: S.bundle, problems: [], editId: null, activeId: null, subs: {}, solved: new Set(), timerStart: null, timerInt: null, connectedHostUID: null };
  // Clear auth form
  const e = document.getElementById("authEmail");
  const p = document.getElementById("authPassword");
  const err = document.getElementById("authErr");
  if (e) e.value = ""; if (p) p.value = ""; if (err) err.textContent = "";
  showAuthScreen("login");
}

function friendlyAuthError(code) {
  const map = {
    "auth/email-already-in-use":   "Email already in use. Sign in instead.",
    "auth/invalid-email":          "Invalid email address.",
    "auth/weak-password":          "Password is too weak (min 6 chars).",
    "auth/user-not-found":         "No account found with this email.",
    "auth/wrong-password":         "Incorrect password.",
    "auth/invalid-credential":     "Incorrect email or password.",
    "auth/too-many-requests":      "Too many attempts. Try again later.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/popup-blocked":          "Popup was blocked. Allow popups for this site.",
  };
  return map[code] || ("Auth error: " + code);
}

// ============================================================
// HOST LOGIC
// ============================================================
function initHost() { renderHSB(); }

function renderHSB() {
  const el  = document.getElementById("hpl");
  const cnt = document.getElementById("pct");
  if (cnt) cnt.textContent = S.problems.length;
  if (!S.problems.length) {
    el.innerHTML = '<div class="ep"><div class="epi"></div><div class="ept">No problems yet.<br>Create your first one!</div></div>';
    return;
  }
  const bt = {};
  S.problems.forEach((p) => { const t = p.topic || "other"; if (!bt[t]) bt[t] = []; bt[t].push(p); });
  let h = "";
  TOPICS.forEach((tp) => {
    const ps = bt[tp.id];
    if (!ps?.length) return;
    h += `<div class="tg"><div class="tgh" onclick="tcol('${tp.id}')"><span>${tp.icon}</span><span>${tp.name}</span><span class="tgc">${ps.length}</span><span class="tga">${col[tp.id] ? "▲" : "▼"}</span></div>`;
    if (!col[tp.id]) {
      h += '<div class="tgi">';
      ps.forEach((p) => {
        const hasAll = p.title && p.tests?.length;
        h += `<div class="pi ${S.editId === p.id ? "act" : ""}" onclick="editP('${p.id}')">
  <div class="pii"><span class="dc dc${(p.diff||"easy")[0]}">${cap(p.diff||"easy")}</span><span class="pit">${esc(p.title)||"Untitled"}</span></div>
  <div class="pis"><span style="font-size:10px;color:var(--t3);font-family:var(--mono)">${p.tests?.length||0} tests</span>${hasAll?"":"<span style='font-size:10px;color:var(--coral);margin-left:6px'>⚠</span>"}</div>
</div>`;
      });
      h += "</div>";
    }
    h += "</div>";
  });
  el.innerHTML = h;
}
function tcol(k) { col[k] = !col[k]; renderHSB(); }

function newProb() {
  const id = "p" + Date.now();
  S.problems.push({
    id, title: "", diff: "easy", topic: "arrays", tags: [],
    desc: "", inputFmt: "", outputFmt: "", constraints: "",
    templates: { python: dtpl("python"), javascript: dtpl("javascript"), java: dtpl("java"), cpp: dtpl("cpp") },
    tests: [], image: null, timeLimit: 2, memLimit: 256,
  });
  S.editId = id;
  saveProblems(); renderHSB();
  renderEd(S.problems.find((p) => p.id === id));
}
function editP(id) {
  const p = S.problems.find((x) => x.id === id);
  if (!p) return;
  S.editId = id; renderHSB(); renderEd(p);
}

function renderEd(p) {
  const m = document.getElementById("hm");
  m.innerHTML = `<div style="max-width:860px;margin:0 auto">
  <div class="fc"><div class="fct">Problem Info</div>
    <div class="fr">
<div class="fg" style="margin:0"><label class="fl">Title *</label><input type="text" class="fi" id="ft" value="${esc(p.title)}" placeholder="e.g., Count Leaf Nodes" oninput="aS()"></div>
<div class="fg" style="margin:0"><label class="fl">Difficulty</label><select class="fsel" id="fd" onchange="aS()"><option value="easy" ${p.diff==="easy"?"selected":""}>🟢 Easy</option><option value="medium" ${p.diff==="medium"?"selected":""}>🟡 Medium</option><option value="hard" ${p.diff==="hard"?"selected":""}>🔴 Hard</option></select></div>
    </div>
    <div class="fr">
<div class="fg" style="margin:0"><label class="fl">Topic / Section</label><select class="fsel" id="ftop" onchange="aS()">${TOPICS.map((t)=>`<option value="${t.id}" ${p.topic===t.id?"selected":""}>${t.icon} ${t.name}</option>`).join("")}</select></div>
<div class="fg" style="margin:0"><label class="fl">Tags (Enter)</label><div class="tw" id="tw">${p.tags.map(mtp).join("")}<input class="tri" id="ti" placeholder="Array, Hash Map..." onkeydown="otk(event)"></div></div>
    </div>
    <div class="fr">
<div class="fg" style="margin:0"><label class="fl">Time Limit (sec)</label><input type="number" class="fi" id="ftl" value="${p.timeLimit}" min="1" max="30" oninput="aS()"></div>
<div class="fg" style="margin:0"><label class="fl">Memory Limit (MB)</label><input type="number" class="fi" id="fml" value="${p.memLimit}" min="64" max="1024" oninput="aS()"></div>
    </div>
  </div>
  <div class="fc"><div class="fct">Problem Description</div>
    <div class="fg"><label class="fl">Problem Statement <span style="color:var(--t3)">(Markdown)</span></label><textarea class="fta" id="fdesc" rows="9" placeholder="Describe the problem..." oninput="aS()">${esc(p.desc)}</textarea></div>
    <div class="fr">
<div class="fg" style="margin:0"><label class="fl">Input Format</label><textarea class="fta fma" id="fif" rows="4" placeholder="Describe the input..." oninput="aS()">${esc(p.inputFmt)}</textarea></div>
<div class="fg" style="margin:0"><label class="fl">Output Format</label><textarea class="fta fma" id="fof" rows="4" placeholder="Describe the output..." oninput="aS()">${esc(p.outputFmt)}</textarea></div>
    </div>
    <div class="fg"><label class="fl">Constraints</label><textarea class="fta fma" id="fco" rows="3" placeholder="1 ≤ n ≤ 10^5" oninput="aS()">${esc(p.constraints)}</textarea></div>
  </div>
  <div class="fc"><div class="fct">Illustration (Optional)</div>
    <div class="id" onclick="document.getElementById('ifi').click()" id="idz"><span class="idi"></span><p>Click to upload an image</p><small>PNG, JPG — max 5MB</small>${p.image?`<img src="${p.image}" class="iprev" id="ipv">`:'<div id="ipv"></div>'}</div>
    <input type="file" id="ifi" accept="image/*" style="display:none" onchange="oiu(event)">
    ${p.image?`<button class="btn bgh bsm" style="margin-top:8px" onclick="rmi()">Remove Image</button>`:""}
  </div>
  <div class="fc"><div class="fct">Starter Code Templates</div>
    <p style="font-size:13px;color:var(--t2);margin-bottom:14px">Pre-loaded in solver's editor.</p>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap" id="ltbs">${["python","javascript","java","cpp"].map((l)=>`<button class="ltb" id="ltb_${l}" onclick="swTpl('${l}')">${LL[l]}</button>`).join("")}</div>
    <div class="ew"><div class="etb"><span id="tll">Python 3</span></div><div id="hed"></div></div>
  </div>
  <div class="fc"><div class="fct">Test Cases</div>
    <div id="tcl"></div>
    <div class="atr">
<button class="btn bgh bsm" onclick="addT(false)">＋ Sample Test</button>
<button class="btn bgh bsm" style="color:var(--violet);border-color:rgba(167,139,250,.3)" onclick="addT(true)">Hidden Test</button>
    </div>
  </div>
  <div class="fa">
    <button class="btn bd bsm" onclick="delP('${p.id}')">Delete</button>
    <div style="flex:1"></div>
    <button class="btn bgh" onclick="prevP('${p.id}')">Preview as Solver</button>
    <button class="btn bn" onclick="saveP()">Save</button>
  </div>
  </div>`;

  if (hEd) { try { hEd.toTextArea(); } catch (e) {} hEd = null; }
  const ta = document.createElement("textarea");
  document.getElementById("hed").appendChild(ta);
  hEd = CodeMirror.fromTextArea(ta, {
    mode: "python", theme: "dracula", lineNumbers: true,
    autoCloseBrackets: true, matchBrackets: true,
    indentUnit: 4, tabSize: 4, styleActiveLine: true,
  });
  hEd.setValue(p.templates.python || "# Write your solution here\n");
  hEd.on("change", aS);
  swTpl("python");
  renderTCL(p.tests);
}

function swTpl(l) {
  if (!hEd) return;
  const p = S.problems.find((x) => x.id === S.editId);
  if (p) p.templates[cTL] = hEd.getValue();
  cTL = l;
  hEd.setOption("mode", LM[l] || "python");
  hEd.setValue(p ? p.templates[l] || dtpl(l) : dtpl(l));
  document.getElementById("tll").textContent = LL[l];
  document.querySelectorAll(".ltb").forEach((b) => b.classList.remove("act"));
  const btn = document.getElementById("ltb_" + l);
  if (btn) btn.classList.add("act");
}

function dtpl(l) {
  const t = {
    python: ["import sys","input = sys.stdin.readline","","def solve():","    n = int(input())","    # Write your solution here","    pass","","solve()"].join("\n"),
    javascript: ['const lines = require("fs").readFileSync("/dev/stdin","utf8").trim().split("\\n");','let idx = 0;','const readline = () => lines[idx++];','','function solve() {',"    const n = parseInt(readline());","    // Write your solution here","}","","solve();"].join("\n"),
    java: ["import java.util.*;","import java.io.*;","","public class Solution {","    static BufferedReader br = new BufferedReader(new InputStreamReader(System.in));","    static StringTokenizer st;","","    static int nextInt() throws IOException {","        while (st == null || !st.hasMoreTokens()) st = new StringTokenizer(br.readLine());","        return Integer.parseInt(st.nextToken());","    }","","    public static void main(String[] args) throws IOException {","        int n = nextInt();","        // Write your solution here","    }","}"].join("\n"),
    cpp: ["#include <bits/stdc++.h>","using namespace std;","","int main() {","    ios::sync_with_stdio(false);","    cin.tie(NULL);","    int n; cin >> n;","    // Write your solution here","    return 0;","}"].join("\n"),
  };
  return t[l] || "";
}

function renderTCL(tests) {
  const el = document.getElementById("tcl");
  if (!el) return;
  if (!tests.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--t3);margin-bottom:12px">No test cases yet.</p>';
    return;
  }
  el.innerHTML = tests.map((tc, i) => `
    <div class="tcc"><div class="tch2">
<span class="tcl2">Test ${i+1}</span>
<div class="tchr">
  ${tc.hidden?'<span class="hp">HIDDEN</span>':'<span class="sp">SAMPLE</span>'}
  <button class="btn bgh bxs" onclick="tth('${tc.id}')">${tc.hidden?"Make Sample":"Make Hidden"}</button>
  <button class="btn bd bxs" onclick="rtc('${tc.id}')">✕</button>
</div>
    </div>
    <div class="tcb">
<div class="tcf"><label>Input</label><textarea id="tci_${tc.id}" onchange="stc('${tc.id}')">${esc(tc.input)}</textarea></div>
<div class="tcf"><label>Expected Output</label><textarea id="tco_${tc.id}" onchange="stc('${tc.id}')">${esc(tc.output)}</textarea></div>
    </div>
    <div class="tce">
<label>Explanation <span style="color:var(--t3)">(shown in Examples tab)</span></label>
<textarea id="tce_${tc.id}" placeholder="Explain step-by-step..." onchange="stc('${tc.id}')">${esc(tc.explanation||"")}</textarea>
    </div></div>
  `).join("");
}

function addT(hidden) {
  const p = S.problems.find((x) => x.id === S.editId);
  if (!p) return;
  p.tests.push({ id: "t" + Date.now(), input: "", output: "", explanation: "", hidden });
  saveProblems(); renderTCL(p.tests); renderHSB();
}
function rtc(id) {
  const p = S.problems.find((x) => x.id === S.editId);
  if (!p) return;
  p.tests = p.tests.filter((t) => t.id !== id);
  saveProblems(); renderTCL(p.tests);
}
function stc(id) {
  const p = S.problems.find((x) => x.id === S.editId);
  if (!p) return;
  const tc = p.tests.find((t) => t.id === id);
  if (!tc) return;
  const i = document.getElementById("tci_"+id), o = document.getElementById("tco_"+id), e = document.getElementById("tce_"+id);
  if (i) tc.input = i.value; if (o) tc.output = o.value; if (e) tc.explanation = e.value;
  saveProblems();
}
function tth(id) {
  const p = S.problems.find((x) => x.id === S.editId);
  if (!p) return;
  const tc = p.tests.find((t) => t.id === id);
  if (tc) { tc.hidden = !tc.hidden; saveProblems(); renderTCL(p.tests); renderHSB(); }
}
function otk(e) {
  const inp = document.getElementById("ti");
  if (e.key === "Enter" && inp.value.trim()) {
    const p = S.problems.find((x) => x.id === S.editId);
    if (!p) return;
    if (!p.tags.includes(inp.value.trim())) p.tags.push(inp.value.trim());
    inp.value = ""; rbtw(p); saveProblems(); e.preventDefault();
  } else if (e.key === "Backspace" && !inp.value) {
    const p = S.problems.find((x) => x.id === S.editId);
    if (p && p.tags.length) { p.tags.pop(); rbtw(p); saveProblems(); }
  }
}
function removeTag(tag) {
  const p = S.problems.find((x) => x.id === S.editId);
  if (!p) return;
  p.tags = p.tags.filter((t) => t !== tag); rbtw(p); saveProblems();
}
function rbtw(p) {
  const w = document.getElementById("tw");
  if (!w) return;
  w.innerHTML = p.tags.map(mtp).join("") + '<input class="tri" id="ti" placeholder="Add tag..." onkeydown="otk(event)">';
  document.getElementById("ti").focus();
}
function mtp(t) { return `<span class="tp2">${esc(t)}<button class="tpr" onclick="removeTag('${esc(t)}')">×</button></span>`; }
function oiu(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 5*1024*1024) { toast("Image too large","er"); return; }
  const r = new FileReader();
  r.onload = (ev) => {
    const p = S.problems.find((x) => x.id === S.editId);
    if (p) { p.image = ev.target.result; saveProblems(); }
    const pv = document.getElementById("ipv");
    if (pv) pv.outerHTML = `<img src="${ev.target.result}" class="iprev" id="ipv">`;
    toast("Image uploaded!","ok");
  };
  r.readAsDataURL(f);
}
function rmi() {
  const p = S.problems.find((x) => x.id === S.editId);
  if (p) { p.image = null; saveProblems(); renderEd(p); }
}

let ast = null;
function aS() { clearTimeout(ast); ast = setTimeout(sS, 700); }
function sS() {
  const p = S.problems.find((x) => x.id === S.editId);
  if (!p) return;
  p.title       = document.getElementById("ft")?.value    || "";
  p.diff        = document.getElementById("fd")?.value    || "easy";
  p.topic       = document.getElementById("ftop")?.value  || "other";
  p.desc        = document.getElementById("fdesc")?.value || "";
  p.inputFmt    = document.getElementById("fif")?.value   || "";
  p.outputFmt   = document.getElementById("fof")?.value   || "";
  p.constraints = document.getElementById("fco")?.value   || "";
  p.timeLimit   = parseInt(document.getElementById("ftl")?.value) || 2;
  p.memLimit    = parseInt(document.getElementById("fml")?.value) || 256;
  if (hEd) p.templates[cTL] = hEd.getValue();
  p.tests.forEach((tc) => {
    const i = document.getElementById("tci_"+tc.id), o = document.getElementById("tco_"+tc.id), e = document.getElementById("tce_"+tc.id);
    if (i) tc.input = i.value; if (o) tc.output = o.value; if (e) tc.explanation = e.value;
  });
  saveProblems(); renderHSB();
}
function saveP() { sS(); toast("Problem saved to Firebase!","ok"); }
function delP(id) {
  if (!confirm("Delete this problem?")) return;
  S.problems = S.problems.filter((p) => p.id !== id);
  S.editId = null;
  fbDeleteProblem(id); // remove from Firestore immediately
  saveProblems(); renderHSB();
  document.getElementById("hm").innerHTML =
    '<div style="text-align:center;padding:80px;color:var(--t3)"><div style="font-size:48px;margin-bottom:16px">🗑️</div><p>Problem deleted.</p></div>';
  toast("Deleted","in");
}
function prevP(id) {
  sS(); toast("Opening solver preview...","in");
  setTimeout(() => {
    _userRole = "preview";
    document.getElementById("solverUserName").textContent = "(Host Preview)";
    ss("ss"); initSolver();
    setTimeout(() => openSolve(id), 300);
  }, 600);
}
function saveBundleInfo() {
  S.bundle.name = document.getElementById("bni").value || "My Bundle";
  S.bundle.desc = document.getElementById("bdi").value;
  document.getElementById("hbn").textContent = S.bundle.name;
  cm("bmo"); saveProblems(); toast("Bundle saved!","ok");
}
function om2() {
  document.getElementById("bni").value = S.bundle.name;
  document.getElementById("bdi").value = S.bundle.desc;
  om("bmo");
}

// ============================================================
// SOLVER LOGIC
// ============================================================
function initSolver() {
  document.getElementById("sbt").textContent = S.bundle.name;
  renderSSB(); startTimer();
  const ind = document.getElementById("apiInd");
  if (ind) {
    ind.textContent  = _fbReady ? "DB: ON" : "DB: OFF";
    ind.style.color  = _fbReady ? "var(--green)" : "var(--t3)";
    ind.style.borderColor = _fbReady ? "rgba(74,222,128,.3)" : "var(--ln)";
    ind.title = _fbReady ? "Firebase connected" : "Running offline";
  }
}

let timerPaused = false, timerElapsed = 0, timerPauseStart = null;
function startTimer() {
  if (S.timerInt) clearInterval(S.timerInt);
  timerPaused = false; timerElapsed = 0;
  S.timerStart = Date.now(); updateTimerBtn();
  S.timerInt = setInterval(tickTimer, 500);
}
function tickTimer() {
  if (timerPaused) return;
  const e = Math.floor((Date.now() - S.timerStart + timerElapsed) / 1000);
  const h = String(Math.floor(e / 3600)).padStart(2,"0");
  const m = String(Math.floor((e % 3600) / 60)).padStart(2,"0");
  const s = String(e % 60).padStart(2,"0");
  const el = document.getElementById("td");
  if (el) el.textContent = `${h}:${m}:${s}`;
}
function toggleTimer() {
  timerPaused = !timerPaused;
  if (timerPaused) { timerPauseStart = Date.now(); }
  else { if (timerPauseStart) timerElapsed -= Date.now() - timerPauseStart; timerPauseStart = null; }
  updateTimerBtn();
}
function resetTimer() {
  timerPaused = false; timerElapsed = 0; timerPauseStart = null;
  S.timerStart = Date.now();
  const el = document.getElementById("td");
  if (el) el.textContent = "00:00:00";
  updateTimerBtn();
}
function updateTimerBtn() {
  const b = document.getElementById("timerToggle");
  if (b) b.textContent = timerPaused ? "▶" : "⏸";
}

function renderSSB() {
  const solved = S.solved.size, total = S.problems.length;
  const sp = document.getElementById("sp");
  if (sp) sp.style.width = total ? `${(solved/total)*100}%` : "0%";
  const sl = document.getElementById("spl2");
  if (sl) sl.textContent = `${solved} / ${total} solved`;
  const el = document.getElementById("splist");
  if (!el) return;
  if (!S.problems.length) {
    el.innerHTML = '<div style="padding:30px 16px;text-align:center;color:var(--t3);font-size:13px">No problems yet.</div>';
    return;
  }
  const bt = {};
  S.problems.forEach((p) => { const t = p.topic||"other"; if (!bt[t]) bt[t]=[]; bt[t].push(p); });
  let h = "";
  TOPICS.forEach((tp) => {
    const ps = bt[tp.id]; if (!ps?.length) return;
    h += `<div class="sth">${tp.name}<span>${ps.length}</span></div>`;
    ps.forEach((p) => {
      const idx = S.problems.indexOf(p);
      const sb = S.subs[p.id] || [];
      let dot = "sin";
      if (S.solved.has(p.id)) dot = "sis";
      else if (sb.length) dot = "sip";
      h += `<div class="spi ${S.activeId===p.id?"act":""}" onclick="openSolve('${p.id}')">
  <div class="spr1"><span class="si2 ${dot}"></span><span class="dc dc${(p.diff||"easy")[0]}">${cap(p.diff||"easy")}</span><span class="spt">${esc(p.title)||"Untitled"}</span></div>
  <div class="spr2"><span class="spn">#${idx+1}</span>${sb.length?`<span style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-left:auto">${sb.length} sub${sb.length>1?"s":""}</span>`:""}</div>
</div>`;
    });
  });
  el.innerHTML = h;
}

function openSolve(id) {
  const p = S.problems.find((x) => x.id === id);
  if (!p) return;
  S.activeId = id; renderSSB();
  document.getElementById("sph").style.display = "none";
  document.getElementById("svp").style.display = "flex";
  buildD(p); buildEx(p); buildHist(p);
  document.getElementById("or1").innerHTML = '<p style="color:var(--t3);font-size:13px;font-family:var(--mono)">Run your code to see results...</p>';
  document.getElementById("cout").textContent = "// Console output appears here...";
  const lang = document.getElementById("ls2").value;
  const area = document.getElementById("cea");
  if (sEd) { try { sEd.toTextArea(); } catch (e) {} sEd = null; }
  area.innerHTML = "";
  const ta = document.createElement("textarea");
  area.appendChild(ta);
  sEd = CodeMirror.fromTextArea(ta, {
    mode: LM[lang]||"python", theme: "dracula", lineNumbers: true,
    autoCloseBrackets: true, matchBrackets: true,
    indentUnit: 4, tabSize: 4, styleActiveLine: true,
    extraKeys: {
      "Ctrl-Enter":       () => runSamples(),
      "Ctrl-Shift-Enter": () => submitCode(),
      Tab:          (cm2) => cm2.execCommand("indentMore"),
      "Shift-Tab":  (cm2) => cm2.execCommand("indentLess"),
      "Ctrl-/":     (cm2) => cm2.execCommand("toggleComment"),
    },
  });
  sEd.setValue(p.templates[lang] || dtpl(lang));
  setTimeout(() => sEd.refresh(), 50);
  sdtab(document.querySelector(".pt"), "td1");
  sotab(document.querySelector(".ot"), "or1");
}

function buildD(p) {
  const ti = TOPICS.find((t) => t.id === p.topic) || TOPICS[TOPICS.length-1];
  const idx = S.problems.indexOf(p);
  const dh = p.desc
    ? (typeof marked !== "undefined" ? marked.parse(p.desc) : p.desc.replace(/\n/g,"<br>"))
    : '<p style="color:var(--t3)">No description yet.</p>';
  document.getElementById("td1").innerHTML = `
    <div class="ph">
<div class="phn">Problem #${idx+1}</div>
<h2>${esc(p.title)||"Untitled"}</h2>
<div class="pmr">
  <span class="dc dc${(p.diff||"easy")[0]}" style="font-size:12px;padding:3px 10px">${cap(p.diff||"easy")}</span>
  <span class="mc">Time: ${p.timeLimit}s</span><span class="mc">Mem: ${p.memLimit}MB</span>
  <span class="tpc">${ti.name}</span>
  ${(p.tags||[]).map((t)=>`<span class="mc">${esc(t)}</span>`).join("")}
</div>
    </div>
    <div class="pb">
${dh}
${p.image?`<img src="${p.image}" class="pimg">`:""}
${p.inputFmt?`<h4>Input Format</h4><pre>${esc(p.inputFmt)}</pre>`:""}
${p.outputFmt?`<h4>Output Format</h4><pre>${esc(p.outputFmt)}</pre>`:""}
${p.constraints?`<h4>Constraints</h4><pre>${esc(p.constraints)}</pre>`:""}
    </div>`;
}
function buildEx(p) {
  const samples = p.tests.filter((t) => !t.hidden);
  const el = document.getElementById("td2");
  if (!samples.length) { el.innerHTML = '<p style="color:var(--t3);font-size:13px">No sample test cases provided.</p>'; return; }
  el.innerHTML = samples.map((tc,i) => `
    <div class="eb"><div class="en">Example ${i+1}</div>
<div class="eio">
  <div class="ebox"><div class="ebl">Input</div><pre class="ebpre">${esc(tc.input)||"—"}</pre></div>
  <div class="ebox"><div class="ebl">Output</div><pre class="ebpre" style="color:var(--green)">${esc(tc.output)||"—"}</pre></div>
</div>
${tc.explanation?`<div class="eex"><div class="eel">Explanation</div><pre class="eet" id="expl_${i}"></pre></div>`:""}
    </div>`).join("");
  samples.forEach((tc,i) => { if (tc.explanation) { const el2 = document.getElementById("expl_"+i); if (el2) el2.textContent = tc.explanation; } });
}
function buildHist(p) {
  const sb = (S.subs[p.id]||[]).slice().reverse();
  if (!sb.length) { document.getElementById("td3").innerHTML = '<p style="color:var(--t3);font-size:13px">No submissions yet.</p>'; return; }
  document.getElementById("td3").innerHTML =
    `<h4 style="font-size:12px;color:var(--t2);margin-bottom:12px;font-family:var(--mono);letter-spacing:1px">SUBMISSION HISTORY</h4>
  ${sb.map((s)=>`<div class="shi"><span class="sv ${s.passed===s.total?"ac":"wa"}">${s.passed===s.total?"Accepted":"Wrong Answer"}</span><span class="sm2">${s.passed}/${s.total} · ${LL[s.lang]||s.lang}</span><span class="sm2">${s.time}</span><span class="sp2">${Math.round((s.passed/s.total)*100)}%</span></div>`).join("")}`;
}

function onLC() {
  if (!S.activeId || !sEd) return;
  const p = S.problems.find((x) => x.id === S.activeId);
  if (!p) return;
  const l = document.getElementById("ls2").value;
  sEd.setOption("mode", LM[l]||"python");
  sEd.setValue(p.templates[l] || dtpl(l));
}
function resetEd() {
  if (!confirm("Reset code to template?")) return;
  if (!S.activeId || !sEd) return;
  const p = S.problems.find((x) => x.id === S.activeId);
  const l = document.getElementById("ls2").value;
  sEd.setValue(p ? p.templates[l] || dtpl(l) : dtpl(l));
}
function runSamples() {
  const p = S.problems.find((x) => x.id === S.activeId);
  if (!p) return;
  const tests = p.tests.filter((t) => !t.hidden);
  if (!tests.length) { toast("No sample test cases to run","in"); return; }
  run(tests, false);
}
function submitCode() {
  const p = S.problems.find((x) => x.id === S.activeId);
  if (!p) return;
  if (!p.tests.length) { toast("No test cases to judge against","in"); return; }
  run(p.tests, true);
}

// ============================================================
// JUDGE ENGINE
// ============================================================
async function run(tests, isSubmit) {
  if (!sEd) return;
  const code = sEd.getValue().trim();
  if (!code) { toast("Write some code first!","er"); return; }
  const lang = document.getElementById("ls2").value;

  const rb = document.getElementById("rb");
  const sb = document.getElementById("sub");
  if (rb) rb.disabled = true;
  if (sb) { sb.disabled = true; sb.classList.add("loading"); }

  sotab(document.querySelector(".ot"), "or1");
  const results = [];

  for (let i = 0; i < tests.length; i++) {
    const tc  = tests[i];
    const pct = Math.round((i / tests.length) * 100);
    const msg = lang !== "javascript" ? ` (executing on judge server...)` : `...`;
    document.getElementById("or1").innerHTML = `
<div class="ri2"><div class="spin"></div>Running test ${i+1} of ${tests.length}${msg}</div>
<div style="height:4px;background:var(--ln);border-radius:2px;margin-bottom:16px;overflow:hidden">
  <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--neon),var(--violet));border-radius:2px;transition:width .4s ease"></div>
</div>
${results.map((r) => trRow(r, isSubmit)).join("")}`;
    await new Promise((r) => setTimeout(r, 0));

    const result = await judgeSingle(code, lang, tc.input, tc.output, i+1, tc.hidden && isSubmit);
    results.push(result);
  }

  const passed = results.filter((r) => r.pass).length;
  const total  = results.length;
  const ac     = passed === total;

  const visibleResults = results.filter((r) => !r.hidden);
  const hiddenCount    = results.filter((r) => r.hidden).length;
  const consoleLines   = visibleResults.map((r) =>
    `=== Test ${r.tcIndex} [${r.pass?"PASS":"FAIL"}] ===\nInput:\n${r.input}\nExpected:\n${r.expected}\nGot:\n${r.actual}\nTime: ${r.ms}ms`
  );
  if (hiddenCount > 0)
    consoleLines.push(`\n--- ${hiddenCount} hidden test${hiddenCount>1?"s":""}: details not shown ---`);
  document.getElementById("cout").textContent = consoleLines.join("\n\n");

  document.getElementById("or1").innerHTML = `
    <div class="vb ${ac?"vac":"vwa"}">
${ac ? "ALL TESTS PASSED — ACCEPTED" : `${passed}/${total} TESTS PASSED — WRONG ANSWER`}
    </div>
    <div class="rs">${isSubmit?"Submission":"Sample Run"} · ${passed}/${total} passed · ${Math.round((passed/total)*100)}% · ${LL[lang]}</div>
    ${results.map((r) => trRow(r, isSubmit)).join("")}`;

  if (isSubmit) {
    if (!S.subs[S.activeId]) S.subs[S.activeId] = [];
    S.subs[S.activeId].push({ passed, total, time: new Date().toLocaleTimeString(), lang });
    if (ac) S.solved.add(S.activeId);
    await saveSolverData();
    renderSSB();
    buildHist(S.problems.find((x) => x.id === S.activeId));
  }

  if (rb) rb.disabled = false;
  if (sb) { sb.disabled = false; sb.classList.remove("loading"); }
}

function trRow(r, isSubmit) {
  const hid = r.hidden;
  return `<div class="trr ${r.pass?"trp":"trf"}" style="animation-delay:${r.tcIndex*0.05}s">
    <span class="tric">${r.pass?"✓":"✗"}</span>
    <div class="trb">
<div class="trt">Test ${r.tcIndex}${hid?" [H]":""} — ${r.pass?"PASSED":"FAILED"}</div>
${!hid
  ? `<div class="trg">
  <span class="trk">Input:</span><span class="trv">${esc(String(r.input||"").substring(0,300))}</span>
  <span class="trk">Expected:</span><span class="trv g">${esc(String(r.expected||"").substring(0,300))}</span>
  ${!r.pass?`<span class="trk">Got:</span><span class="trv b">${esc(String(r.actual||"(empty)").substring(0,300))}</span>`:""}
</div>`
  : `<div style="font-size:11px;color:var(--t3);font-family:var(--mono)">Hidden test — details not shown</div>`}
    </div>
    <span class="trtm">${r.ms}ms</span>
  </div>`;
}

async function judgeSingle(code, lang, inputData, expectedOutput, idx, hidden) {
  const t0 = performance.now();
  let stdout = "";
  try {
    const res = await runCode(code, lang, inputData);
    stdout = res.error ? (res.msg || "[Execution error]") : res.stdout;
  } catch (err) {
    stdout = "Runtime Error: " + err.message;
  }
  const ms   = Math.round(performance.now() - t0);
  const pass = norm(stdout) === norm(expectedOutput);
  return { pass, input: inputData, expected: expectedOutput, actual: stdout, ms, hidden, tcIndex: idx };
}

// ============================================================
// CODE EXECUTION
// JavaScript  → runs natively in the browser (no server needed)
// Python/Java/C++ → sent to your PythonAnywhere Flask server
//
// ============================================================
const JUDGE_URL    = "__JUDGE_URL__";    // injected by build.js
const JUDGE_SECRET = "__JUDGE_SECRET__"; // injected by build.js

async function runCode(code, lang, inputData) {
  if (lang === "javascript") {
    try { return { stdout: runJS(code, inputData) }; }
    catch (e) { return { error: true, msg: "Runtime Error: " + e.message }; }
  }

  if (!JUDGE_URL) {
    return { error: true, msg: `[Judge server not configured. Set JUDGE_URL in app.js to your PythonAnywhere URL to run ${lang} code.]` };
  }

  try {
    const resp = await fetch(JUDGE_URL + "/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Judge-Token": JUDGE_SECRET },
      body: JSON.stringify({ language: lang, code, stdin: inputData }),
    });

    if (!resp.ok) {
      let detail = "";
      try { const e = await resp.json(); detail = e.error || ""; } catch (_) {}
      return { error: true, msg: `Server error ${resp.status}${detail ? ": " + detail : ""}` };
    }

    const data = await resp.json();
    // data: { stdout, stderr, exit_code, compile_error }
    if (data.compile_error)
      return { error: true, msg: "Compile Error:\n" + data.compile_error };
    if (data.exit_code !== 0 && !data.stdout && data.stderr)
      return { error: true, msg: "Runtime Error:\n" + data.stderr };
    return { stdout: (data.stdout || "").trimEnd() };

  } catch (e) {
    return { error: true, msg: "[Cannot reach judge server — is your PythonAnywhere app running? Check JUDGE_URL in app.js]" };
  }
}

// ── JavaScript native runner ──
function runJS(code, inputData) {
  const lines = inputData.split("\n");
  let patched = code
    .replace(/require\s*\(\s*['"]fs['"]\s*\)\s*\.readFileSync\s*\([^)]+\)\s*\.trim\s*\(\s*\)\s*\.split\s*\(\s*['"][\\n'"]+\s*\)/g, `(${JSON.stringify(lines)})`)
    .replace(/require\s*\(\s*['"]fs['"]\s*\)\s*\.readFileSync\s*\([^)]+\)/g, `(${JSON.stringify(inputData)})`)
    .replace(/const readline\s*=\s*\(\)\s*=>\s*lines\[idx\+\+\]/g, `const readline = () => _CF_LINES[_CF_IDX++]`)
    .replace(/\bprocess\.stdout\.write\b/g, "_CF_OUT.push")
    .replace(/\bprocess\.exit\b/g, "(()=>{})")
    .replace(/\brequire\b/g, "(()=>({}))");
  const fn = new Function("_CF_LINES","_CF_IDX_REF","_CF_OUT","console",`
    let _CF_IDX = 0; const lines = _CF_LINES; let idx = 0;
    const readline = () => _CF_LINES[_CF_IDX++] || '';
    const input = () => _CF_LINES[_CF_IDX++] || '';
    ${patched}
  `);
  const capturedLog = [];
  const fakeConsole = {
    log:  (...args) => capturedLog.push(args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")),
    error: () => {}, warn: () => {},
    info: (...args) => capturedLog.push(args.map(String).join(" ")),
  };
  fn(lines, { v: 0 }, capturedLog, fakeConsole);
  return capturedLog.join("\n");
}

function norm(s) {
  return String(s||"").trim()
    .replace(/\r\n/g,"\n").replace(/\r/g,"\n")
    .replace(/[ \t]+$/gm,"").replace(/\n{3,}/g,"\n\n").replace(/\n+$/,"");
}

// ============================================================
// UI HELPERS
// ============================================================
function sdtab(el, id) {
  if (!el) return;
  document.querySelectorAll(".pt").forEach((t) => t.classList.remove("act"));
  el.classList.add("act");
  ["td1","td2","td3"].forEach((i) => { const e = document.getElementById(i); if (e) e.style.display = i===id?"block":"none"; });
}
function sotab(el, id) {
  if (!el) return;
  document.querySelectorAll(".ot").forEach((t) => t.classList.remove("act"));
  el.classList.add("act");
  ["or1","oc1"].forEach((i) => { const e = document.getElementById(i); if (e) e.style.display = i===id?"block":"none"; });
}
function toast(msg, type) {
  const el = document.createElement("div");
  const cls = type==="ok"?"tok":type==="er"?"ter":"tin";
  const icon = type==="ok"?"✓":type==="er"?"✕":"ℹ";
  el.className = `toast ${cls}`;
  el.innerHTML = `<span>${icon}</span>${msg}`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s,transform .3s";
    el.style.opacity = "0"; el.style.transform = "translateX(20px)";
    setTimeout(() => el.remove(), 300);
  }, 3200);
}
function esc(s) {
  if (!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function cap(s) { return s ? s[0].toUpperCase()+s.slice(1) : ""; }
function ss(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(id); if (el) el.classList.add("active");
}
function om(id) { const el = document.getElementById(id); if (el) el.classList.add("open"); }
function cm(id) { const el = document.getElementById(id); if (el) el.classList.remove("open"); }

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    document.querySelectorAll(".mo.open").forEach((m) => m.classList.remove("open"));
});

// ============================================================
// THEME
// ============================================================
let isLight = false;
function toggleTheme() {
  isLight = !isLight;
  document.body.classList.toggle("light", isLight);
  ["themeBtn","themeBtn2"].forEach((id) => { const b = document.getElementById(id); if (b) b.textContent = isLight?"◑":"◐"; });
  if (hEd) hEd.setOption("theme","dracula");
  if (sEd) sEd.setOption("theme","dracula");
}

// ============================================================
// DRAG RESIZE — horizontal split
// ============================================================
(function () {
  let dragging = false, startX = 0, startW = 0;
  document.addEventListener("mousedown", (e) => {
    const d = e.target.closest("#splitDivider");
    if (!d) return;
    dragging = true; startX = e.clientX;
    startW = document.getElementById("descPane")?.offsetWidth || 0;
    d.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const pane = document.getElementById("descPane");
    const container = document.getElementById("splitView");
    if (!pane || !container) return;
    const newW = Math.max(200, Math.min(container.offsetWidth-300, startW+(e.clientX-startX)));
    pane.style.width = newW+"px";
    const cp = document.getElementById("codePane"); if (cp) cp.style.flex = "1";
    if (sEd) sEd.refresh();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    const d = document.getElementById("splitDivider"); if (d) d.classList.remove("dragging");
    document.body.style.cursor = ""; document.body.style.userSelect = "";
    if (sEd) setTimeout(() => sEd.refresh(), 50);
  });
})();

// ============================================================
// DRAG RESIZE — output panel height
// ============================================================
(function () {
  let dragging = false, startY = 0, startH = 0;
  document.addEventListener("mousedown", (e) => {
    const d = e.target.closest("#outResizeHandle");
    if (!d) return;
    dragging = true; startY = e.clientY;
    startH = document.getElementById("outPanel")?.offsetHeight || 268;
    document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const panel = document.getElementById("outPanel"); if (!panel) return;
    panel.style.height = Math.max(80, Math.min(600, startH+(startY-e.clientY)))+"px";
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false; document.body.style.cursor = ""; document.body.style.userSelect = "";
    if (sEd) setTimeout(() => sEd.refresh(), 50);
  });
})();

// ============================================================
// INIT — restore session automatically on page load/refresh
// ============================================================
(async () => {
  // Loading overlay
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:var(--bg0);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:16px";
  ov.innerHTML = `<div style="width:36px;height:36px;border:3px solid var(--ln2);border-top-color:var(--neon);border-radius:50%;animation:sp .6s linear infinite"></div><div style="font-family:var(--mono);font-size:12px;color:var(--t3);letter-spacing:2px">CONNECTING...</div>`;
  document.body.appendChild(ov);

  const ok = await initFirebase();

  if (!ok) {
    ov.remove();
    toast("Firebase not configured — check your config", "er");
    showAuthScreen("login");
    return;
  }

  // Firebase Auth persists the session in localStorage automatically.
  // onAuthStateChanged fires once immediately with the current user (or null).
  // We wait for that single fire to decide whether to restore the session
  // or show the landing page — this is what fixes the back-button logout.
  await new Promise((resolve) => {
    const { onAuthStateChanged, auth } = window._fa;
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub(); // only need the first event
      if (user) {
        // User is still signed in — restore their session silently
        const profile = await fbLoadUser(user.uid);
        if (profile?.role) {
          _currentUser = user;
          ov.remove();
          await enterApp(user, profile.role);
        } else {
          // Authenticated but no role yet (incomplete registration)
          ov.remove();
          showRolePicker(user);
        }
      } else {
        // No active session — show auth page
        ov.remove();
        showAuthScreen("login");
      }
      resolve();
    });
  });
})();

// ============================================================
// WINDOW EXPORTS (required for type="module" + inline onclick)
// ============================================================
Object.assign(window, {
  showAuthScreen, handleEmailAuth, handleGoogleAuth, pickRole,
  logout, switchRole,
  om, cm, om2,
  newProb, editP, saveP, delP, prevP,
  tcol, swTpl, addT, rtc, stc, tth,
  otk, removeTag, oiu, rmi,
  aS, sS, saveBundleInfo,
  openSolve,
  onLC, resetEd, runSamples, submitCode,
  sdtab, sotab, toggleTheme, toggleTimer, resetTimer,
});