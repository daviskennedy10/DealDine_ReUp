require('dotenv').config();

// DealDine Backend - Production Implementation
// This Node.js/Express backend handles Gmail API, Claude API, image extraction, database, and notifications

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// 1. GMAIL API SETUP
// ============================================

// Configuration
const GMAIL_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback'
};

const oauth2Client = new google.auth.OAuth2(
  GMAIL_CONFIG.clientId,
  GMAIL_CONFIG.clientSecret,
  GMAIL_CONFIG.redirectUri
);

// Generate auth URL for user to grant permissions
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'consent select_account'
  });
  res.json({ authUrl });
});

// Handle OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    // Store tokens in database (associated with user)
    const userEmail = await getUserEmail(oauth2Client);
    console.log('Google account authenticated as:', userEmail);
    await storeUserTokens(userEmail, tokens);
    
    res.redirect(`http://localhost:3000?auth=success&email=${encodeURIComponent(userEmail)}`);
  } catch (error) {
    console.error('Auth error:', error);
    res.redirect('http://localhost:3000?auth=error');
  }
});

// Get user's email address
async function getUserEmail(auth) {
  const oauth2 = google.oauth2({ version: 'v2', auth });
  const { data } = await oauth2.userinfo.get();
  return data.email;
}

// Fetch promotional emails from Gmail
async function fetchPromotionalEmails(auth, maxResults = 50) {
  const gmail = google.gmail({ version: 'v1', auth });
  
  try {
    // Search for promotional emails from restaurant chains
    const restaurants = [
      'mcdonalds', 'subway', 'dominos', 'pizzahut', 'tacobell', 
      'chipotle', 'kfc', 'wendys', 'burgerking', 'starbucks',
      'chickfila', 'arbys', 'panerabread', 'fiveguys', 'shakeshack',
      'innout', 'sonic', 'dairyqueen', 'popeyesm', 'jimmyjohns'
    ];
    
    const query = `category:promotions (${restaurants.map(r => `from:${r}`).join(' OR ')}) newer_than:30d`;
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults
    });
    
    if (!response.data.messages) {
      return [];
    }
    
    // Fetch full message details
    const messages = await Promise.all(
      response.data.messages.map(async (message) => {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        });
        return fullMessage.data;
      })
    );
    
    return messages;
  } catch (error) {
    console.error('Error fetching emails:', error);
    throw error;
  }
}

// ============================================
// 2. GEMINI INTEGRATION - AI DEAL PARSING
// ============================================


const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getGeminiRetryDelayMs(error, fallbackMs = 60000) {
  const details = error?.errorDetails || [];
  const retryInfo = details.find(
    d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
  );

  const retryDelay = retryInfo?.retryDelay;
  if (!retryDelay) return fallbackMs;

  const seconds = Number(String(retryDelay).replace(/s$/, ''));
  if (!Number.isFinite(seconds)) return fallbackMs;

  return (seconds + 5) * 1000;
}
// Parse email content with Gemini to extract deal information
async function parseEmailWithGemini(emailContent, subject, from) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const prompt = `You are a deal extraction expert. Analyze this promotional email and extract deal information.

EMAIL FROM: ${from}
SUBJECT: ${subject}
CONTENT:
${emailContent}

Extract the following information and respond ONLY with valid JSON (no markdown, no explanation):
{
  "restaurant": "Official restaurant name (e.g., McDonald's, Subway, Chipotle — not variations)",
  "dealDescription": "Clear description of the deal/offer",
  "originalPrice": 15.99,
  "discountedPrice": 7.99,
  "savings": 8.00,
  "expiryDate": "2024-02-20",
  "dealCode": "SAVE50",
  "termsAndConditions": "Brief terms if mentioned",
  "dealType": "BOGO"
}

Use null for any field you cannot find. Return ONLY the JSON object.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return null;
  } catch (error) {
    if (error?.status === 429) {
      throw error;
    }

    console.error('Gemini parsing error:', error);
    return null;
  }
}

// ============================================
// 3. IMAGE EXTRACTION FROM EMAILS
// ============================================

// Extract images from email HTML
function extractImagesFromEmail(emailData) {
  const images = {
    dealImages: [],
    logoImages: []
  };
  
  try {
    // Get email parts
    const parts = getAllParts(emailData.payload);
    
    // Extract HTML content
    let htmlContent = '';
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body.data) {
        htmlContent += Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    
    if (!htmlContent) return images;
    
    // Parse HTML with Cheerio
    const $ = cheerio.load(htmlContent);
    
    // Extract all image URLs
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      const alt = $(elem).attr('alt') || '';
      const width = parseInt($(elem).attr('width')) || 0;
      const height = parseInt($(elem).attr('height')) || 0;
      
      if (src) {
        // Categorize images
        const isLogo = alt.toLowerCase().includes('logo') || 
                       width < 150 || height < 150;
        
        const imageObj = {
          url: src.startsWith('http') ? src : `https:${src}`,
          alt,
          width,
          height
        };
        
        if (isLogo) {
          images.logoImages.push(imageObj);
        } else {
          images.dealImages.push(imageObj);
        }
      }
    });
    
    // Also check for inline attachments
    for (const part of parts) {
      if (part.mimeType && part.mimeType.startsWith('image/') && part.body.attachmentId) {
        // Note: Would need to fetch attachment separately via Gmail API
        images.dealImages.push({
          attachmentId: part.body.attachmentId,
          mimeType: part.mimeType
        });
      }
    }
    
  } catch (error) {
    console.error('Image extraction error:', error);
  }
  
  return images;
}

// Helper to recursively get all email parts
function getAllParts(payload, parts = []) {
  if (payload.parts) {
    payload.parts.forEach(part => getAllParts(part, parts));
  } else {
    parts.push(payload);
  }
  return parts;
}

// Get the best food image from email
function selectBestDealImage(images) {
  if (images.dealImages.length === 0) return null;
  
  // Prefer larger images (likely hero images)
  const sorted = images.dealImages.sort((a, b) => {
    const aSize = (a.width || 0) * (a.height || 0);
    const bSize = (b.width || 0) * (b.height || 0);
    return bSize - aSize;
  });
  
  return sorted[0].url;
}

function normalizeRestaurantName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getCanonicalRestaurantName(name) {
  const key = normalizeRestaurantName(name);

  const mapping = {
    mcdonalds: "McDonald's",
    subway: "Subway",
    chipotle: "Chipotle",
    starbucks: "Starbucks",
    dominos: "Domino's",
    pizzahut: "Pizza Hut",
    tacobell: "Taco Bell",
    kfc: "KFC",
    wendys: "Wendy's",
    chickfila: "Chick-fil-A",
    popeyes: "Popeyes",
    fiveguys: "Five Guys",
    arbys: "Arby's",
    sonic: "Sonic",
    dairyqueen: "Dairy Queen"
  };

  return mapping[key] || name;
}

// Get restaurant logo
function selectBestLogoImage(images, restaurantName) {
  if (images.logoImages.length > 0) {
    return images.logoImages[0].url;
  }

  return getDefaultLogoUrl(restaurantName);
}

function normalizeRestaurantName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getDefaultLogoUrl(restaurantName) {
  const key = normalizeRestaurantName(restaurantName);

  const logos = {
    mcdonalds: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/McDonald%27s_logo.svg/512px-McDonald%27s_logo.svg.png',
    subway: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Subway_2016_logo.svg/512px-Subway_2016_logo.svg.png',
    chipotle: 'https://upload.wikimedia.org/wikipedia/en/thumb/3/3b/Chipotle_Mexican_Grill_logo.svg/512px-Chipotle_Mexican_Grill_logo.svg.png',
    starbucks: 'https://upload.wikimedia.org/wikipedia/en/thumb/7/7c/Starbucks_Coffee_Logo.svg/512px-Starbucks_Coffee_Logo.svg.png',
    dominos: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Dominos_pizza_logo.svg/512px-Dominos_pizza_logo.svg.png',
    pizzahut: 'https://upload.wikimedia.org/wikipedia/en/thumb/d/d2/Pizza_Hut_logo.svg/512px-Pizza_Hut_logo.svg.png',
    tacobell: 'https://upload.wikimedia.org/wikipedia/en/thumb/b/b3/Taco_Bell_2016.svg/512px-Taco_Bell_2016.svg.png',
    kfc: 'https://upload.wikimedia.org/wikipedia/en/thumb/b/bf/KFC_logo.svg/512px-KFC_logo.svg.png',
    wendys: 'https://upload.wikimedia.org/wikipedia/en/thumb/3/32/Wendy%27s_logo_2012.svg/512px-Wendy%27s_logo_2012.svg.png',
    chickfila: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Chick-fil-A_Logo.svg/512px-Chick-fil-A_Logo.svg.png',
    popeyes: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6b/Popeyes_logo.svg/512px-Popeyes_logo.svg.png',
    fiveguys: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Five_Guys_logo.svg/512px-Five_Guys_logo.svg.png',
    arbys: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Arby%27s_logo.svg/512px-Arby%27s_logo.svg.png',
    sonic: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Sonic_Drive-In_logo.svg/512px-Sonic_Drive-In_logo.svg.png',
    dairyqueen: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Dairy_Queen_logo.svg/512px-Dairy_Queen_logo.svg.png'
  };

  return logos[key] || `https://www.google.com/s2/favicons?domain=${key}.com&sz=128`;
}

// ============================================
// 4. DATABASE SETUP (SUPABASE)
// ============================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Database Schema:
/*
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  gmail_tokens JSONB,
  notification_preferences JSONB DEFAULT '{"email": true, "expiringSoon": true}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL,
  restaurant TEXT NOT NULL,
  deal_description TEXT NOT NULL,
  original_price DECIMAL(10,2),
  discounted_price DECIMAL(10,2),
  savings DECIMAL(10,2) NOT NULL,
  expiry_date DATE,
  deal_code TEXT,
  terms_and_conditions TEXT,
  deal_type TEXT,
  image_url TEXT,
  logo_url TEXT,
  is_active BOOLEAN DEFAULT true,
  is_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_restaurant_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  restaurant TEXT NOT NULL,
  is_selected BOOLEAN DEFAULT true,
  UNIQUE(user_id, restaurant)
);

CREATE INDEX idx_deals_user_id ON deals(user_id);
CREATE INDEX idx_deals_expiry ON deals(expiry_date);
CREATE INDEX idx_deals_active ON deals(is_active);
*/

// Store user tokens
async function storeUserTokens(email, tokens) {
  const { data, error } = await supabase
    .from('users')
    .upsert({
      email,
      gmail_tokens: tokens
    }, {
      onConflict: 'email'
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// Get user by email
async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// Save deal to database
async function saveDeal(userId, dealData) {
  const { data, error } = await supabase
    .from('deals')
    .insert({
      user_id: userId,
      email_id: dealData.emailId,
      restaurant: dealData.restaurant,
      deal_description: dealData.dealDescription,
      original_price: dealData.originalPrice,
      discounted_price: dealData.discountedPrice,
      savings: Number(dealData.savings ?? 0),
      expiry_date: dealData.expiryDate,
      deal_code: dealData.dealCode,
      terms_and_conditions: dealData.termsAndConditions,
      deal_type: dealData.dealType,
      image_url: dealData.imageUrl,
      logo_url: dealData.logoUrl,
      is_active: true
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// Get all active deals for user
async function getUserDeals(userId, filters = {}) {
  let query = supabase
    .from('deals')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('expiry_date', { ascending: true, nullsLast: true });
  
  // Apply filters
  if (filters.restaurant) {
    query = query.eq('restaurant', filters.restaurant);
  }
  
  if (filters.minSavings) {
    query = query.gte('savings', filters.minSavings);
  }
  
  if (filters.expiringSoon) {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    query = query.lte('expiry_date', threeDaysFromNow.toISOString());
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data;
}

async function getProcessedEmailIds(userId) {
  const { data, error } = await supabase
    .from('deals')
    .select('email_id')
    .eq('user_id', userId);

  if (error) throw error;

  return new Set((data || []).map(row => row.email_id));
}

// Mark deal as inactive (used)
async function markDealAsUsed(dealId) {
  const { error } = await supabase
    .from('deals')
    .update({ is_active: false })
    .eq('id', dealId);
  
  if (error) throw error;
}

// Get restaurant preferences
async function getRestaurantPreferences(userId) {
  const { data, error } = await supabase
    .from('user_restaurant_preferences')
    .select('*')
    .eq('user_id', userId);
  
  if (error) throw error;
  return data;
}

// Update restaurant preference
async function updateRestaurantPreference(userId, restaurant, isSelected) {
  const { error } = await supabase
    .from('user_restaurant_preferences')
    .upsert({
      user_id: userId,
      restaurant,
      is_selected: isSelected
    }, {
      onConflict: 'user_id,restaurant'
    });
  
  if (error) throw error;
}

// ============================================
// 5. NOTIFICATIONS
// ============================================

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NOTIFICATION_EMAIL,
    pass: process.env.NOTIFICATION_EMAIL_PASSWORD
  }
});

// Send expiring deals notification
async function sendExpiringDealsNotification(userEmail, expiringDeals) {
  const dealsList = expiringDeals
    .map(deal => `
      <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #FF6B35;">
        <h3 style="margin: 0 0 10px 0; color: #FF6B35;">${deal.restaurant}</h3>
        <p style="margin: 0 0 5px 0;"><strong>${deal.deal_description}</strong></p>
        <p style="margin: 0; color: #666;">
          💰 Save $${deal.savings.toFixed(2)} | 
          ⏰ Expires: ${new Date(deal.expiry_date).toLocaleDateString()}
        </p>
      </div>
    `)
    .join('');
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 30px 0; background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%); color: white; border-radius: 10px 10px 0 0; }
        .logo { font-size: 2.5rem; font-weight: bold; margin: 0; }
        .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo">🍔 DealDine</h1>
          <p style="margin: 10px 0 0 0;">Deals Expiring Soon!</p>
        </div>
        <div class="content">
          <p>Hey there! 👋</p>
          <p>You have <strong>${expiringDeals.length}</strong> restaurant deal${expiringDeals.length > 1 ? 's' : ''} expiring in the next 3 days:</p>
          ${dealsList}
          <p style="margin-top: 30px;">Don't miss out on these savings! 🎉</p>
          <p style="text-align: center; margin-top: 30px;">
            <a href="http://localhost:3000" style="display: inline-block; padding: 12px 30px; background: #FF6B35; color: white; text-decoration: none; border-radius: 25px; font-weight: bold;">
              View All Deals
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  await transporter.sendMail({
    from: `"DealDine" <${process.env.NOTIFICATION_EMAIL}>`,
    to: userEmail,
    subject: `⏰ ${expiringDeals.length} Deal${expiringDeals.length > 1 ? 's' : ''} Expiring Soon!`,
    html: htmlContent
  });
}

// Check for expiring deals and send notifications (run as cron job)
async function checkAndNotifyExpiringDeals() {
  try {
    // Get all users with notification preferences enabled
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, notification_preferences');
    
    if (usersError) throw usersError;
    
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    
    for (const user of users) {
      if (!user.notification_preferences?.expiringSoon) continue;
      
      // Get expiring deals that haven't been notified
      const { data: expiringDeals, error: dealsError } = await supabase
        .from('deals')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('is_notified', false)
        .lte('expiry_date', threeDaysFromNow.toISOString())
        .not('expiry_date', 'is', null);
      
      if (dealsError) throw dealsError;
      
      if (expiringDeals.length > 0) {
        // Send notification
        await sendExpiringDealsNotification(user.email, expiringDeals);
        
        // Mark deals as notified
        const dealIds = expiringDeals.map(d => d.id);
        await supabase
          .from('deals')
          .update({ is_notified: true })
          .in('id', dealIds);
        
        console.log(`Sent notification to ${user.email} for ${expiringDeals.length} deals`);
      }
    }
  } catch (error) {
    console.error('Notification check error:', error);
  }
}

// ============================================
// API ENDPOINTS
// ============================================

// Scan emails and process deals
app.post('/api/scan-deals', async (req, res) => {
  try {
    const { userEmail } = req.body;
    
    // Get user from database
    const user = await getUserByEmail(userEmail);
    if (!user || !user.gmail_tokens) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Set up OAuth client with stored tokens
    oauth2Client.setCredentials(user.gmail_tokens);
    
    // Fetch emails
    const emails = await fetchPromotionalEmails(oauth2Client, 6);
    console.log(`Found ${emails.length} promotional emails`);
    
    const processedDeals = [];
    const BATCH_SIZE = 2;
    const REQUEST_DELAY_MS = 15000;
    const BATCH_PAUSE_MS = 60000;

    let rateLimited = false;
    let retryAfterMs = 0;

    const processedEmailIds = await getProcessedEmailIds(user.id);
    console.log(`Already processed ${processedEmailIds.size} emails for this user`);
    
    // Process each email
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);

      for (const email of batch) {
        if (processedEmailIds.has(email.id)) {
          console.log(`Skipping already processed email: ${email.id}`);
          continue;
        }
        try {
          const parts = getAllParts(email.payload);
          let emailContent = '';

          for (const part of parts) {
            if (part.mimeType === 'text/plain' && part.body.data) {
              emailContent += Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }

          if (!emailContent) continue;

          const canonicalRestaurant = getCanonicalRestaurantName(dealInfo.restaurant);

          const headers = email.payload.headers;
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const from = headers.find(h => h.name === 'From')?.value || '';

          const dealInfo = await parseEmailWithGemini(emailContent, subject, from);
          if (!dealInfo) continue;

          const originalPrice =
            dealInfo.originalPrice != null ? Number(dealInfo.originalPrice) : null;

          const discountedPrice =
            dealInfo.discountedPrice != null ? Number(dealInfo.discountedPrice) : null;

          const computedSavings =
            dealInfo.savings != null
              ? Number(dealInfo.savings)
              : originalPrice != null && discountedPrice != null
                ? Number((originalPrice - discountedPrice).toFixed(2))
                : 0;

          const images = extractImagesFromEmail(email);
          const imageUrl = selectBestDealImage(images);
          const logoUrl = selectBestLogoImage(images, dealInfo.restaurant);

          const savedDeal = await saveDeal(user.id, {
            emailId: email.id,
            restaurant: canonicalRestaurant,
            dealDescription: dealInfo.dealDescription,
            originalPrice,
            discountedPrice,
            savings: Number(dealData.savings ?? 0),
            expiryDate: dealInfo.expiryDate,
            dealCode: dealInfo.dealCode,
            termsAndConditions: dealInfo.termsAndConditions,
            dealType: dealInfo.dealType,
            imageUrl,
            logoUrl
          });

          processedDeals.push(savedDeal);
          processedEmailIds.add(email.id);

          // Slow down between Gemini requests
          await sleep(REQUEST_DELAY_MS);
        } catch (error) {
          if (error?.status === 429) {
            rateLimited = true;
            retryAfterMs = getGeminiRetryDelayMs(error);
            console.warn(
              `Gemini rate limit hit. Pausing for ${Math.ceil(retryAfterMs / 1000)}s.`
            );
            break;
          }

          console.error('Error processing email:', error);
          continue;
        }
      }

      if (rateLimited) break;

      // Pause between batches
      if (i + BATCH_SIZE < emails.length) {
        await sleep(BATCH_PAUSE_MS);
      }
    }

    res.json({
      success: true,
      dealsProcessed: processedDeals.length,
      deals: processedDeals,
      rateLimited,
      retryAfterMs,
      message: rateLimited
        ? `Scan paused because Gemini hit its rate limit. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`
        : 'Scan complete'
    });
  } catch (error) {
    console.error('Scan deals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's deals
app.get('/api/deals/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const filters = req.query;
    
    const user = await getUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const deals = await getUserDeals(user.id, filters);
    res.json({ deals });
    
  } catch (error) {
    console.error('Get deals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark deal as used
app.post('/api/deals/:dealId/use', async (req, res) => {
  try {
    const { dealId } = req.params;
    await markDealAsUsed(dealId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update restaurant preferences
app.post('/api/preferences/restaurants', async (req, res) => {
  try {
    const { userEmail, restaurant, isSelected } = req.body;
    
    const user = await getUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await updateRestaurantPreference(user.id, restaurant, isSelected);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get restaurant preferences
app.get('/api/preferences/restaurants/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    
    const user = await getUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const preferences = await getRestaurantPreferences(user.id);
    res.json({ preferences });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for notification check (in production, run as cron job)
app.post('/api/notifications/check', async (req, res) => {
  try {
    await checkAndNotifyExpiringDeals();
    res.json({ success: true, message: 'Notification check completed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'dealdine-backend' });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🍔 DealDine backend running on port ${PORT}`);
  console.log(`📧 Auth URL: http://localhost:${PORT}/auth/google`);
});

module.exports = app;
