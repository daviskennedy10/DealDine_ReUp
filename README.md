# 🍔 DealDine — AI-Powered Restaurant Deal Intelligence

**DealDine** is a full-stack application that scans Gmail promotional emails and automatically extracts, structures, and surfaces restaurant deals using AI.

> Instead of manually digging through emails, DealDine turns your inbox into a personalized deal discovery engine.

---

## Why This Exists

Promotional emails are noisy, unstructured, and easy to ignore — but they often contain valuable deals.

DealDine solves this by:

- 📧 Scanning Gmail promotions
- 🤖 Using AI to extract structured deal data
- 🧠 Normalizing messy real-world inputs
- 🎯 Presenting everything in a clean, filterable dashboard

---

## Key Features

### AI-Powered Deal Extraction
- Uses **Google Gemini** to parse real-world promotional emails
- Extracts:
  - restaurant name
  - deal description
  - pricing and savings
  - expiry dates
  - deal types like BOGO, bundles, and fixed-price offers

### Gmail Integration (OAuth)
- Secure Google OAuth flow
- Reads only **promotional emails**
- Automatically fetches relevant restaurant deals

### Intelligent Data Processing
- Normalizes inconsistent AI outputs  
  e.g. `McDonalds` → `McDonald's`
- Handles missing data gracefully with fallback logic
- Filters out junk email assets like tracking pixels and spacer images

### Smart Logo + Image Handling
- Extracts images directly from emails
- Filters invalid or tracking images
- Falls back to known brand logos when needed

### ⚡ Performance Optimizations
- Email-level caching to avoid reprocessing
- Batched AI requests to reduce overload
- Rate-limit handling for Gemini `429` responses
- Incremental scanning so only new emails are processed

###  Clean User Experience
- Filter deals by:
  - expiry
  - savings
  - restaurant
- Track total savings
- View deals in a responsive card-based UI

---

##  Architecture

```text
Frontend (React + CDN)
        ↓
GitHub Pages (Static Hosting)
        ↓
Backend API (Node.js / Express)
        ↓
Gmail API + Gemini API
        ↓
Supabase (PostgreSQL)
```

What your page up and running would look like

                                                          ↓↓↓
<img width="914" height="487" alt="Screenshot 2026-04-06 at 01 58 50" src="https://github.com/user-attachments/assets/c4753cff-c2c4-4db8-8ef1-c4619f78f51b" />

                                                          ↓↓↓

<img width="1197" height="683" alt="Screenshot 2026-04-06 at 01 59 40" src="https://github.com/user-attachments/assets/c21d27b7-c288-46f1-ae3b-01f61341cd26" />

                                                          ↓↓↓
<img width="1168" height="858" alt="Screenshot 2026-04-06 at 01 55 42" src="https://github.com/user-attachments/assets/356ca9c4-79fb-429f-8e0e-5979599961d5" />


