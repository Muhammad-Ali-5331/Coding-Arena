# CodeForge — Elite Programming Challenge Platform

> A full-stack competitive programming platform where hosts create problems and solvers compete — with a real-time judge, split IDE, hidden test cases, and per-user progress tracking.

![CodeForge](https://img.shields.io/badge/CodeForge-Elite%20Programming-4df0c0?style=for-the-badge&labelColor=0b0d17)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-orange?style=for-the-badge&logo=firebase&labelColor=0b0d17)
![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-white?style=for-the-badge&logo=vercel&labelColor=0b0d17)

---

## What is CodeForge?

CodeForge is a self-hosted competitive programming platform built as a single-page web app. It has two roles — **Host** and **Solver** — and every account can switch between them freely.

- **Hosts** create problems with rich descriptions, example test cases, hidden judge tests, topic tags, images, and per-language starter templates
- **Solvers** see all problems posted by all hosts, solve them in a split IDE with syntax highlighting, run samples, submit for judging, and track their history

Everything is real-time via Firebase — a host saving a problem is immediately visible to every solver.

---

## Features

### Auth
- Email + Password sign in / register
- Google Sign-In (one click)
- Persistent sessions — refresh or go back without logging in again
- Role switching — any account can be both a host and a solver

### Host Mode
- Create and edit problems with a full-featured editor
- Rich markdown descriptions with image upload support
- Visible sample test cases + hidden judge test cases (solvers never see these)
- Per-example explanations and expected output
- Topic tags — Arrays, Trees, Graphs, DP, Math, and more
- Per-language starter code templates — Python, JavaScript, Java, C++
- Bundle name and description for organizing your problem set
- Live preview of the solver view before publishing
- Auto-save to Firebase

### Solver Mode
- See all problems from all hosts on the platform
- Split-pane IDE — resizable description panel + code editor
- Syntax-highlighted editor powered by CodeMirror (Python, JS, Java, C++)
- Run Samples — test against visible examples instantly
- Submit — judge runs against all test cases including hidden ones
- Per-test result breakdown — pass/fail, input, expected, actual, time
- Submission history per problem
- Session timer with pause/resume/reset
- Progress bar showing solved / total

### Judge
- **JavaScript** — runs natively in the browser (instant, no server needed)
- **Python / C++ / Java** — sent to our PythonAnywhere Flask server
- Compile errors and runtime errors shown clearly
- Time limit enforcement (5 seconds per test)
- Hidden test results shown without revealing the test input

### Security
- Firebase API keys injected at Vercel build time — never in the GitHub repo
- Judge server protected with a secret token (`X-Judge-Token` header)
- CORS locked to your Vercel domain
- Firestore rules enforce per-user data isolation
- Hosts can only edit their own problems; solvers can only read/write their own submission data

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES Modules), HTML, CSS |
| Code Editor | CodeMirror 5 |
| Auth | Firebase Authentication |
| Database | Cloud Firestore |
| Judge Server | Python / Flask on PythonAnywhere |
| Hosting | Vercel (static + build injection) |
| Build | Node.js `build.js` (secret injection) |

---

## Project Structure

```
CodeForge/
├── index.html          # All screens — auth, host, solver
├── app.js              # All logic (~1300 lines) — auth, Firestore, judge, UI
├── styles.css          # All styles — dark/light theme, responsive
├── server.py           # Local dev server (python server.py)
├── flask_app.py        # Judge server — deploy on PythonAnywhere
├── build.js            # Vercel build script — injects env vars into app.js
├── vercel.json         # Vercel config — buildCommand + outputDirectory
└── .gitignore
```

---

## Local Development

**1. Clone the repo**
```bash
git clone https://github.com/Muhammad-Ali-5331/Coding-Arena.git
cd Coding-Arena
```

**2. Add your Firebase config to `app.js`**

Find the `FIREBASE_CONFIG` block at the top of `app.js` and fill in your real values from Firebase Console → Project Settings → Your Apps:

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc",
};
const JUDGE_URL    = "https://yourusername.pythonanywhere.com";
const JUDGE_SECRET = "your-secret-token";
```

> ⚠️ **Never commit this file with real values.** Keep a separate local copy. Push only the placeholder version.

**3. Run the local server**
```bash
python server.py
# → http://localhost:8000
```

---

## Firebase Setup

### 1. Create a Firebase project
Go to [console.firebase.google.com](https://console.firebase.google.com) → New Project

### 2. Enable Authentication
Firebase Console → Authentication → Sign-in method → Enable:
- **Email/Password**
- **Google**

### 3. Create Firestore Database
Firebase Console → Firestore Database → Create database → Start in production mode

### 4. Set Firestore Security Rules
Firebase Console → Firestore → Rules → Replace with:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /problems/{problemId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.authorUID;
      allow update, delete: if request.auth != null
        && request.auth.uid == resource.data.authorUID;
    }

    match /hosts/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == uid;
      match /data/{doc} {
        allow read, write: if request.auth.uid == uid;
      }
    }

    match /codeforge/{doc} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == uid;
    }

    match /solvers/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
  }
}
```

---

## Judge Server (PythonAnywhere)

The judge server runs Python and C++ code securely on PythonAnywhere's free tier.

### Setup

**1.** Sign up at [pythonanywhere.com](https://www.pythonanywhere.com)

**2.** Dashboard → Files → Upload `flask_app.py` to your home directory

**3.** Dashboard → Web → Add new web app → Manual configuration → Python 3.10

**4.** Set the source code directory to `/home/YOURUSERNAME`

**5.** Click the WSGI config file link and replace the entire content with:

```python
import sys, os
sys.path.insert(0, '/home/YOURUSERNAME')

os.environ['JUDGE_SECRET']   = 'your-secret-token'
os.environ['ALLOWED_ORIGIN'] = 'https://your-app.vercel.app'

from flask_app import app as application
```

**6.** Back on the Web tab → click **Reload**

**7.** Test it: visit `https://YOURUSERNAME.pythonanywhere.com/ping` — you should see `{"status": "ok"}`

### Supported Languages

| Language | Available | Compiler |
|---|---|---|
| Python | ✅ Free tier | python3 |
| C++ | ✅ Free tier | g++ |
| Java | ❌ Paid tier only | javac |
| JavaScript | ✅ Always (browser) | Native |

---

## Deploying to Vercel

**1.** Make sure `app.js` has placeholders (not real values):
```js
const FIREBASE_CONFIG = {
  apiKey: "__FIREBASE_API_KEY__",
  // ...
};
const JUDGE_URL    = "__JUDGE_URL__";
const JUDGE_SECRET = "__JUDGE_SECRET__";
```

**2.** Push to GitHub

**3.** Go to [vercel.com](https://vercel.com) → Add New Project → Import your repo

**4.** Before deploying, expand **Environment Variables** and add:

| Key | Value |
|---|---|
| `FIREBASE_API_KEY` | From Firebase Console |
| `FIREBASE_AUTH_DOMAIN` | `yourproject.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | `yourproject-id` |
| `FIREBASE_STORAGE_BUCKET` | `yourproject.appspot.com` |
| `FIREBASE_MESSAGING_SENDER_ID` | Numbers only |
| `FIREBASE_APP_ID` | `1:xxx:web:xxx` |
| `JUDGE_URL` | `https://yourusername.pythonanywhere.com` |
| `JUDGE_SECRET` | Your secret token |

**5.** Click **Deploy**

Every future `git push` triggers an automatic redeploy.

---

## How It Works

```
GitHub repo          Vercel build server         Browser
─────────────        ───────────────────         ───────
app.js               node build.js               dist/app.js
(placeholders)  →    reads env vars        →     (real values injected)
                     writes dist/app.js
```

The secret values never exist in the repo — they live only in Vercel's encrypted environment variable store and are injected at build time.

---

## Data Model

```
Firestore
├── /problems/{problemId}      ← all problems, one doc each
│     authorUID, title, desc,
│     tests[], tags[], topic,
│     template, image...
│
├── /hosts/{uid}               ← host's bundle info
│     bundle: { name, desc }
│   └── /data/problems         ← old path (migration source only)
│
├── /users/{uid}               ← role, displayName, email
│
└── /solvers/{uid}             ← subs, solved[]
```

---

## Security Model

| Threat | Protection |
|---|---|
| Unauthorized Firestore writes | Security rules — only authors edit their own problems |
| Solver reading hidden test cases | Hidden tests never sent to browser; judge runs server-side |
| Judge server abuse | `X-Judge-Token` secret header required on every request |
| Cross-origin judge requests | `ALLOWED_ORIGIN` locked to Vercel domain |
| Firebase config in repo | Placeholders in repo; real values injected at Vercel build time |

---

## License

[MIT](https://github.com/Muhammad-Ali-5331/Coding-Arena/blob/main/LICENSE) — free to use, modify, and deploy.

---

*Built with ❤️ — CodeForge is a personal project. If you use it, star the repo!*
