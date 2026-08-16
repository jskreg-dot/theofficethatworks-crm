import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// SQLite database path (file-based, persists data)
const dbPath = path.join(__dirname, 'crm_database.db');

// CORS middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://lively-pony-51b622.netlify.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database error:', err.message);
  } else {
    console.log('✓ Connected to SQLite database');
  }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Flag to track if database is initialized
let dbInitialized = false;

// Promisify database operations
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Initialize database tables (non-blocking)
async function initializeDatabase() {
  try {
    console.log('Attempting to initialize database tables...');

    // Create contacts table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Contacts table ready');

    // Create form_submissions table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS form_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        message TEXT,
        source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Form submissions table ready');

    // Create leads table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        company TEXT,
        status TEXT DEFAULT 'new',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Leads table ready');

    dbInitialized = true;
    console.log('✓ Database initialization completed successfully');
  } catch (error) {
    console.warn('⚠ Database initialization warning:', error.message);
    console.warn('Server will continue running, but database operations may fail');
    // Don't set dbInitialized = true so we can retry later
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: dbInitialized ? 'connected' : 'initializing'
  });
});

// Dashboard metrics endpoint
app.get('/api/dashboard', async (req, res) => {
  try {
    // Try to initialize if not already done
    if (!dbInitialized) {
      await initializeDatabase();
    }

    const contactsResult = await dbGet('SELECT COUNT(*) as count FROM contacts');
    const leadsResult = await dbGet('SELECT COUNT(*) as count FROM leads');
    const submissionsResult = await dbGet('SELECT COUNT(*) as count FROM form_submissions');

    res.json({
      totalContacts: contactsResult?.count || 0,
      totalLeads: leadsResult?.count || 0,
      totalSubmissions: submissionsResult?.count || 0,
    });
  } catch (error) {
    console.error('Dashboard error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch dashboard data',
      message: error.message
    });
  }
});

// Get all contacts
app.get('/api/contacts', async (req, res) => {
  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    const contacts = await dbAll('SELECT * FROM contacts ORDER BY created_at DESC');
    res.json(contacts);
  } catch (error) {
    console.error('Contacts error:', error);
    res.status(500).json({
      error: 'Failed to fetch contacts',
    });
  }
});

// Get all leads
app.get('/api/leads', async (req, res) => {
  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    const leads = await dbAll('SELECT * FROM leads ORDER BY created_at DESC');
    res.json(leads);
  } catch (error) {
    console.error('Leads error:', error);
    res.status(500).json({
      error: 'Failed to fetch leads',
    });
  }
});

// Create new contact from form submission
app.post('/api/contacts', async (req, res) => {
  const { name, email, phone, company } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Name and email are required',
    });
  }

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    await dbRun(
      'INSERT INTO contacts (name, email, phone, company, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [name, email, phone || null, company || null]
    );
    res.status(201).json({
      success: true,
      message: 'Contact created',
    });
  } catch (error) {
    console.error('Create contact error:', error);
    res.status(500).json({
      error: 'Failed to create contact',
    });
  }
});

// Create new lead
app.post('/api/leads', async (req, res) => {
  const { name, email, phone, company, status } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Name and email are required',
    });
  }

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    await dbRun(
      'INSERT INTO leads (name, email, phone, company, status, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [name, email, phone || null, company || null, status || 'new']
    );
    res.status(201).json({
      success: true,
      message: 'Lead created',
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({
      error: 'Failed to create lead',
    });
  }
});

// Store form submission
app.post('/api/form-submission', async (req, res) => {
  const { name, email, phone, message, source } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Name and email are required',
    });
  }

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    // Insert form submission
    await dbRun(
      'INSERT INTO form_submissions (name, email, phone, message, source, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [name, email, phone || null, message || null, source || 'website']
    );

    // Also create as contact
    await dbRun(
      'INSERT INTO contacts (name, email, phone, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [name, email, phone || null]
    );

    res.status(201).json({
      success: true,
      message: 'Form submission received',
    });
  } catch (error) {
    console.error('Form submission error:', error);
    res.status(500).json({
      error: 'Failed to process form submission',
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
  });
});

// Start server immediately (don't block on database initialization)
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: SQLite (${dbPath})`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'https://lively-pony-51b622.netlify.app'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Try to initialize database in the background
  console.log('Initializing database tables...');
  initializeDatabase();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nClosing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('✓ Database connection closed');
    }
    process.exit(0);
  });
});
// Force rebuild
