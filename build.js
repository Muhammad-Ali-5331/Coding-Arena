const fs = require("fs");

fs.mkdirSync("dist", { recursive: true });

// Copy static files as-is
["index.html", "styles.css"].forEach(f =>
  fs.copyFileSync(f, `dist/${f}`)
);

// Inject env vars into app.js
let js = fs.readFileSync("app.js", "utf8");

const replacements = {
  "__FIREBASE_API_KEY__":            process.env.FIREBASE_API_KEY,
  "__FIREBASE_AUTH_DOMAIN__":        process.env.FIREBASE_AUTH_DOMAIN,
  "__FIREBASE_PROJECT_ID__":         process.env.FIREBASE_PROJECT_ID,
  "__FIREBASE_STORAGE_BUCKET__":     process.env.FIREBASE_STORAGE_BUCKET,
  "__FIREBASE_MESSAGING_SENDER_ID__":process.env.FIREBASE_MESSAGING_SENDER_ID,
  "__FIREBASE_APP_ID__":             process.env.FIREBASE_APP_ID,
  "__JUDGE_URL__":                   process.env.JUDGE_URL || "",
};

for (const [placeholder, value] of Object.entries(replacements)) {
  if (!value) {
    console.warn(`⚠️  Missing env var for ${placeholder}`);
  }
  js = js.replaceAll(placeholder, value || "");
}

fs.writeFileSync("dist/app.js", js);
console.log("✅ Build complete — secrets injected");
```

### Step 4 — Create `.gitignore`
```
dist/
node_modules/
.env