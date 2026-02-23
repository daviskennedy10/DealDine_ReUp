# 🍔 DealDine - Quick Start

Welcome to DealDine! This guide will get you up and running in **15 minutes**.

## 📦 What You Got

1. **dealdine-production.html** - Frontend app (React)
2. **dealdine-backend.js** - Backend API (Node.js/Express)
3. **package.json** - Dependencies
4. **.env.template** - Environment variables template
5. **SETUP_GUIDE.md** - Detailed production setup guide

## ⚡ Quick Start (5 Steps)

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Set Up Environment Variables

```bash
cp .env.template .env
```

Edit `.env` and add your credentials (see SETUP_GUIDE.md for how to get them):
- Google OAuth credentials
- Anthropic API key
- Supabase credentials
- Gmail for notifications

### Step 3: Set Up Database

1. Create a Supabase project at https://supabase.com
2. Run the SQL in SETUP_GUIDE.md (section 3.2) to create tables
3. Add Supabase URL and key to `.env`

### Step 4: Start the Backend

```bash
npm run dev
```

Backend will run on http://localhost:3001

### Step 5: Open the Frontend

Open `dealdine-production.html` in your browser or serve it:

```bash
# Option 1: Open directly
open dealdine-production.html

# Option 2: Use a local server
npx http-server -p 3000
# Then visit http://localhost:3000
```

## 🎯 First Use

1. Click "Connect Gmail" in the app
2. Authorize DealDine to read your promotional emails
3. Click "Scan for New Deals"
4. Watch as AI finds and extracts all your restaurant deals!

## 📚 Next Steps

- Read **SETUP_GUIDE.md** for detailed configuration
- Configure notifications for expiring deals
- Customize restaurant preferences
- Deploy to production (Railway, Vercel, etc.)

## 🐛 Troubleshooting

**Backend won't start?**
- Check that all environment variables are set
- Make sure Node.js 16+ is installed

**Gmail connection fails?**
- Verify OAuth credentials are correct
- Check that redirect URI matches in Google Cloud Console

**No deals found?**
- Make sure you have promotional emails from restaurants
- Check that Gmail API is enabled
- Try manually triggering a scan

**Anthropic API errors?**
- Verify API key is correct
- Check you have sufficient credits
- Ensure you're using claude-sonnet-4-20250514 model

## 💡 Pro Tips

1. **Demo Mode**: The frontend works with mock data if backend isn't connected
2. **Testing**: Use `/api/notifications/check` endpoint to manually test notifications
3. **Monitoring**: Check backend logs for email parsing results
4. **Optimization**: Cache Claude API results to reduce costs

## 📧 Need Help?

Check the full **SETUP_GUIDE.md** for:
- Detailed setup instructions for each service
- Database schema and migrations
- Image extraction configuration
- Notification setup
- Deployment guides
- Security best practices

---

**Happy deal hunting! 🎉**
