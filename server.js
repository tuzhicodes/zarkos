// server.js - STANDALONE DASHBOARD SERVER
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'zarkos-secret-key-' + Math.random();

// ========== BOT API CONFIG ==========
const BOT_API = {
    url: process.env.BOT_API_URL || 'http://fi6.bot-hosting.net:22280',
    key: process.env.BOT_API_KEY || 'your-api-key'
};

// ========== BOT CONFIG ==========
const BOT_CONFIG = {
    name: "ZarKos Ultimate",
    logoUrl: process.env.DASHBOARD_LOGO_URL || "https://i.imgur.com/AfFp7pu.png",
    themeColor: "#FFC107",
    supportUrl: process.env.SUPPORT_SERVER || "https://discord.gg/mnbQFftqby",
    inviteUrl: process.env.BOT_INVITE_URL,
    privacyUrl: process.env.PRIVACY_POLICY_URL || "/privacy",
    termsUrl: process.env.TERMS_OF_SERVICE_URL || "/terms",
    clientId: process.env.CLIENT_ID
};

// ========== EXPRESS APP ==========
const app = express();

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== CORS (Allow bot API) ==========
app.use(cors({
    origin: [BOT_API.url, 'http://localhost:22280'],
    credentials: true
}));

// ========== SESSION ==========
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'zarkos.sid',
    rolling: true,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/'
    }
}));

// ========== PASSPORT ==========
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());

// ========== VIEW ENGINE ==========
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========== HELPERS ==========
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/');
}

// API Helper
async function callBotAPI(endpoint, method = 'GET', data = null) {
    try {
        const config = {
            method,
            url: `${BOT_API.url}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${BOT_API.key}`,
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.data = data;
        }

        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error(`API Error [${endpoint}]:`, error.message);
        throw error;
    }
}

// ========== ROUTES ==========

// 1. Landing Page
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');
    }
    res.render('login', {
        user: null,
        botConfig: BOT_CONFIG
    });
});

// 2. Auth Routes
app.get('/auth/login', passport.authenticate('discord'));

app.get('/auth/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/');
    });
});

// 3. Server Selector
app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        // Get user's guilds from Discord profile
        const userGuilds = req.user.guilds || [];
        
        // Filter guilds where user has manage server permission
        const managedGuilds = userGuilds.filter(g => 
            (BigInt(g.permissions) & 0x20n) === 0x20n
        );

        // Get bot's guilds from API
        let botGuilds = [];
        try {
            const botData = await callBotAPI('/api/bot/guilds');
            botGuilds = botData.guilds || [];
        } catch (error) {
            console.error('Failed to fetch bot guilds:', error.message);
        }

        // Map guilds with bot status
        const guilds = managedGuilds.map(g => ({
            id: g.id,
            name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
            botInGuild: botGuilds.includes(g.id)
        }));

        res.render('selector', {
            user: req.user,
            guilds,
            botConfig: BOT_CONFIG,
            page: 'selector'
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Error loading dashboard');
    }
});

// 4. Server Dashboard
app.get('/dashboard/:guildId', isAuthenticated, async (req, res) => {
    try {
        const guildId = req.params.guildId;

        // Verify user has access to this guild
        const userGuild = (req.user.guilds || []).find(g => g.id === guildId);
        if (!userGuild) {
            return res.status(403).send('Access denied');
        }

        // Get guild data from bot API
        const guildData = await callBotAPI(`/api/guilds/${guildId}/info`);

        res.render('dashboard', {
            user: req.user,
            guild: guildData,
            botConfig: BOT_CONFIG,
            page: 'overview'
        });
    } catch (error) {
        console.error('Guild dashboard error:', error);
        res.status(500).send('Error loading guild dashboard');
    }
});

// 5. AI Chat Page
app.get('/dashboard/:guildId/aichat', isAuthenticated, async (req, res) => {
    try {
        const guildId = req.params.guildId;

        const userGuild = (req.user.guilds || []).find(g => g.id === guildId);
        if (!userGuild) {
            return res.status(403).send('Access denied');
        }

        const guildData = await callBotAPI(`/api/guilds/${guildId}/info`);

        res.render('aichat', {
            user: req.user,
            guild: guildData,
            botConfig: BOT_CONFIG,
            page: 'aichat',
            ownerID: process.env.BOT_OWNER_ID
        });
    } catch (error) {
        console.error('AI Chat page error:', error);
        res.status(500).send('Error loading AI Chat page');
    }
});

// 6. Suggestions Page
app.get('/dashboard/:guildId/suggestions', isAuthenticated, async (req, res) => {
    try {
        const guildId = req.params.guildId;

        const userGuild = (req.user.guilds || []).find(g => g.id === guildId);
        if (!userGuild) {
            return res.status(403).send('Access denied');
        }

        const guildData = await callBotAPI(`/api/guilds/${guildId}/info`);

        res.render('suggestions', {
            user: req.user,
            guild: guildData,
            botConfig: BOT_CONFIG,
            page: 'suggestions'
        });
    } catch (error) {
        console.error('Suggestions page error:', error);
        res.status(500).send('Error loading Suggestions page');
    }
});

// ========== API PROXY ENDPOINTS ==========

// Get channels
app.get('/api/guilds/:guildId/channels', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI(`/api/guilds/${req.params.guildId}/channels`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

// Get AI config
app.get('/api/aichat/config/:guildId', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI(`/api/aichat/config/${req.params.guildId}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

// Save AI config
app.post('/api/aichat/save', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI('/api/aichat/save', 'POST', req.body);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save config' });
    }
});

// Reset AI memory
app.post('/api/aichat/reset-memory', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI('/api/aichat/reset-memory', 'POST', req.body);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset memory' });
    }
});

// Get analytics
app.get('/api/analytics', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI('/api/analytics');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Get suggestions config
app.get('/api/suggestions/config/:guildId', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI(`/api/suggestions/config/${req.params.guildId}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

// Get suggestions stats
app.get('/api/suggestions/stats/:guildId', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI(`/api/suggestions/stats/${req.params.guildId}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Setup suggestions
app.post('/api/suggestions/setup', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI('/api/suggestions/setup', 'POST', req.body);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to setup suggestions' });
    }
});

// Toggle suggestions
app.post('/api/suggestions/toggle', isAuthenticated, async (req, res) => {
    try {
        const data = await callBotAPI('/api/suggestions/toggle', 'POST', req.body);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle suggestions' });
    }
});

// ========== PRIVACY & TERMS ==========
app.get('/privacy', (req, res) => {
    res.render('pt/pp', {
        botConfig: BOT_CONFIG,
        user: req.user || null
    });
});

app.get('/terms', (req, res) => {
    res.render('pt/tos', {
        botConfig: BOT_CONFIG,
        user: req.user || null
    });
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
    res.status(404).render('404', {
        user: req.user || null,
        botConfig: BOT_CONFIG
    });
});

// ========== ERROR HANDLER ==========
app.use((err, req, res, next) => {
    console.error('Dashboard Error:', err);

    if (err.name === 'TokenError' || err.name === 'InternalOAuthError') {
        if (req.session) {
            req.session.destroy(() => {
                res.redirect('/auth/login');
            });
        } else {
            res.redirect('/auth/login');
        }
        return;
    }

    res.status(500).send('Internal Server Error');
});

// ========== START SERVER ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`🌐 Production: ${process.env.DASHBOARD_URL}`);
    console.log(`🤖 Bot API: ${BOT_API.url}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
