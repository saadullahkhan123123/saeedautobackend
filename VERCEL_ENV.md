# Vercel Environment Variables (Backend)

Backend project: **saeedautobackend** (or your Vercel backend project name).

## Root Directory (important)

In **Settings → General**, set **Root Directory** to the folder that contains `api/`, `routes/`, and `models/`.  
If your repo has an `express js` folder with those inside it, set Root Directory to **`express js`**.  
Otherwise the serverless function will crash (cannot find `../routes/...`).

## Where to set env vars

1. Open [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **backend** project (e.g. saeedautobackend)
3. Go to **Settings → Environment Variables**

## Required

| Name       | Value                    | Description                    |
|-----------|---------------------------|--------------------------------|
| `MONGO_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/dbname?retryWrites=true&w=majority` | MongoDB Atlas connection string. Get it from Atlas → Connect → Drivers → Node.js. |

- Replace `user`, `pass`, `cluster`, `dbname` with your real values.
- No spaces; keep it one line.
- Apply to: **Production**, **Preview**, **Development** (all if you use them).

## Optional

| Name           | Value        | Description                                      |
|----------------|--------------|--------------------------------------------------|
| `RESET_SECRET` | e.g. `mySecret123` | Secret for full reset API. If not set, default is `reset123`. |

## After adding

- **Redeploy** the backend: Deployments → … → Redeploy (or push a new commit).
- Then open: `https://saeedautobackend.vercel.app/api/test` – you should get JSON, not Network Error.

## Frontend (inventory app on Vercel)

If the frontend is a **separate** Vercel project, you usually **don’t** need any env vars there: the code uses `https://saeedautobackend.vercel.app` in production.  
If you use a different backend URL, add in the **frontend** project:

| Name            | Value                             |
|-----------------|------------------------------------|
| `VITE_API_URL`  | `https://saeedautobackend.vercel.app` |

Then redeploy the frontend.

---

## If you still see "This Serverless Function has crashed" (500 / FUNCTION_INVOCATION_FAILED)

1. **Root Directory is required**  
   In the **backend** project: **Settings → General → Root Directory** → set to the folder that **contains** the `api` folder (e.g. **`express js`**).  
   Do **not** leave it empty if your backend code lives in a subfolder. Then **Redeploy**.

2. **Deploy from the backend folder (alternative)**  
   From your machine: `cd "express js"` then run `vercel` (or `npx vercel`) and deploy from there. That way the project root is the backend folder.

3. **Check the deployment**  
   The repo layout should look like: `api/index.js`, `routes/`, `models/`, `package.json` all in the same root. If you open the deployment in Vercel, the root should show these.

4. **Current `api/index.js`**  
   It is a minimal handler (no Express) so it can run even if `node_modules` or paths are wrong. After you redeploy, open `https://saeedautobackend.vercel.app/`.  
   - If you get JSON with `"status":"OK"`, the deployment and root are fine; we can switch back to the full Express app.  
   - If it still crashes, the problem is Root Directory or the project not deploying from the backend folder (see steps 1–2).
