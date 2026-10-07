# Shot Counter – setup

1. Firebase console → Add project → Build → Authentication → Sign-in method → enable **Anonymous**.
2. Build → Firestore Database → Create database (production mode) → Rules tab → paste `firestore.rules` → Publish.
3. Project settings → Your apps → Web (</>) → copy the config into `firebase-config.js`.
4. Netlify → Add new site → Deploy manually → drag in this folder.
5. Firebase → Authentication → Settings → Authorized domains → add your `*.netlify.app` domain.
