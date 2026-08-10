# Deploy Backend to Render.com

## Quick Deploy (Easiest - 2 minutes)

1. **Go to https://render.com** and sign up (free)

2. **Click "New +" → "Web Service"**

3. **Choose "Deploy from GitHub"** (or paste this repo URL):
   - If GitHub: Connect repo and select this backend folder
   - If Manual: Use the following settings

4. **Configure the Web Service:**
   - **Name:** arigroup-api
   - **Environment:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Free

5. **Add Environment Variables:**
   ```
   SUPABASE_URL=your-supabase-url
   SUPABASE_SERVICE_KEY=your-service-key
   SECRET_KEY=your-secret-key
   ENVIRONMENT=production
   ```

6. **Click "Create Web Service"** and wait 2-3 minutes

7. **You'll get a URL like:** `https://arigroup-api.onrender.com`

## Update Frontend

Once deployed, update the frontend `.env`:
```
REACT_APP_API_URL=https://arigroup-api.onrender.com
```

Then redeploy frontend to arigroup.space.

## Custom Domain (Optional)

In Render dashboard → Settings → Custom Domain:
- Add: `api.arigroup.space`
- Update Fasthosts DNS CNAME to point to Render

---

**Need help?** I can create the git repo and provide deploy instructions!
