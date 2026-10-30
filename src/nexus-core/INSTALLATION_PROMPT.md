# AI Integration Prompt: Install Nexus Core Navigation & Auth

**Copy the prompt below and paste it to the AI assistant in the other project:**

```markdown
Hello! I want to integrate the shared, packaged Nexus Core Navigation, Weather, and Auth module (`nexus-core`) into this project. 

The `nexus-core` directory has been placed in my project's source tree (under `src/nexus-core/`). I need you to perform the following installation and setup steps to activate it:

### Step 1: Copy Static Assets
The user avatar images are packaged in `inputs/nexus-core/assets/users/`. 
Please copy all `.webp` files from `inputs/nexus-core/assets/users/` to the project's public folder at `public/images/users/`.
*If the directories `public/images/users/` do not exist yet, please create them first.*

### Step 2: Set Up Backend API Proxy Routes
The navbar requires local Next.js route handlers to proxy calls to the remote Supabase gateway (bypassing CORS and SSL errors in local dev). The API route templates are stored inside `src/nexus-core/api-routes/`.
Please copy:
1. `inputs/nexus-core/api-routes/navigation/route.js` ➔ `src/app/api/navigation/route.js`
2. `inputs/nexus-core/api-routes/weather/route.js` ➔ `src/app/api/weather/route.js`
3. `inputs/nexus-core/api-routes/sites/route.js` ➔ `src/app/api/sites/route.js`

*Note: Ensure `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` remains set inside these route handlers to allow connections in development namespaces.*

### Step 3: Verify Dependencies
Please verify that the following NPM dependencies are present in `package.json`. If any are missing, let me know or install them:
- `@remixicon/react` (for icons)
- `framer-motion` (for menu animations)
- `next` and `react` / `react-dom`

### Step 4: Import and Mount the Navigation Bar
Now, update the root layout or homepage (e.g. `src/app/layout.js` or `src/app/page.js`) to import and render the new `<NexusNavBar />` component:

```javascript
import { NexusNavBar } from "@/nexus-core"; // or relative import path like "../nexus-core"

// inside your layout/page component:
return (
  <>
    <NexusNavBar />
    {/* rest of page */}
  </>
);
```

### Step 5: Verification
Run a dev server build to ensure that:
1. The CSS styles from `navbar.css` load correctly (font family, colors, and layout are consistent).
2. The user profile and avatar display correctly from local sessions.
3. The weather widget fetches and displays live weather based on the user's base site.
```
