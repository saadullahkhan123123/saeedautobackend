# Vercel Environment Variables (Backend)

Backend project: **saeedautobackend** (or your Vercel backend project name).

## Where to set

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
