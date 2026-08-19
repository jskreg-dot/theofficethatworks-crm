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

// CORS middleware - Allow all origins for demo
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: false,
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

    // Create tasks table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
                description TEXT,
        assigned_to TEXT,
        due_date TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Tasks table ready');

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

// Delete contact by ID
app.delete('/api/contacts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    await dbRun('DELETE FROM contacts WHERE id = ?', [id]);
    res.json({
      success: true,
      message: 'Contact deleted',
    });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({
      error: 'Failed to delete contact',
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

  // Check rate limit: max 5 submissions per hour per email
  if (!checkSubmissionRateLimit(email, 5)) {
    return res.status(429).json({
      error: 'Too many submissions from this email. Maximum 5 per hour allowed.',
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

    // Send webhook to n8n workflow for Gmail notification
    const n8nWebhookUrl = 'https://mvkjsk-2.app.n8n.cloud/webhook/crm-form-intake';
    const webhookPayload = {
      name: name,
      email: email,
      phone: phone || null,
      message: message || null,
      source: source || 'website',
      submittedAt: new Date().toISOString()
    };

    // Send to n8n asynchronously (don't wait for response)
    fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookPayload)
    }).catch(err => console.error('n8n webhook error:', err));

    res.status(201).json({
      success: true,
      message: 'Form submission received and notification sent',
    });
  } catch (error) {
    console.error('Form submission error:', error);
    res.status(500).json({
      error: 'Failed to process form submission',
    });
  }
});

// Get all form submissions
app.get('/api/form-submission', async (req, res) => {
  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }
    const submissions = await dbAll('SELECT * FROM form_submissions ORDER BY created_at DESC');
    res.json(submissions);
  } catch (error) {
    console.error('Form submissions error:', error);
    res.status(500).json({
      error: 'Failed to fetch form submissions',
    });
  }
});

// Get all tasks
app.get('/api/tasks', async (req, res) => {
  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    const tasks = await dbAll('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(tasks);
  } catch (error) {
    console.error('Tasks error:', error);
    res.status(500).json({
      error: 'Failed to fetch tasks',
    });
  }
});

// Create new task
app.post('/api/tasks', async (req, res) => {
  const { title, description, assigned_to, due_date, priority, status } = req.body;

  if (!title) {
    return res.status(400).json({
      error: 'Title is required',
    });
  }

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    const result = await dbRun(
      'INSERT INTO tasks (title, description, assigned_to, due_date, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',      [title, assigned_to || null, due_date || null, priority || 'medium', status || 'open']
    
          [title, description || null, assigned_to || null, due_date || null, priority || 'medium', status || 'open']);
    res.status(201).json({
      id: result.lastID,
      title,
      assigned_to,
      due_date,
      priority,
      status,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({
      error: 'Failed to create task',
    });
  }
});

// Update task
app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, assigned_to, due_date, priority, status } = req.body;

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    await dbRun(
      'UPDATE tasks SET title = ?, description = ?, assigned_to = ?, due_date = ?, priority = ?, status = ? WHERE id = ?',      [title, assigned_to, due_date, priority, status, id]
      [title, description || null, assigned_to, due_date, priority, status, id]    res.json({
      success: true,
      message: 'Task updated',
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({
      error: 'Failed to update task',
    });
  }
});

// Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    await dbRun('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({
      success: true,
      message: 'Task deleted',
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({
      error: 'Failed to delete task',
    });
  }
});

// Mark task as complete
app.post('/api/tasks/:id/complete', async (req, res) => {
  const { id } = req.params;

  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    await dbRun(
      'UPDATE tasks SET status = ? WHERE id = ?',
      ['completed', id]
    );
    res.json({
      success: true,
      message: 'Task marked as complete',
    });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({
      error: 'Failed to complete task',
    });
  }
});

// Database cleanup endpoint (remove duplicate submissions and contacts)
app.post('/api/cleanup-duplicates', async (req, res) => {
  try {
    if (!dbInitialized) {
      await initializeDatabase();
    }

    // Get all submissions and find ones to delete
    const allSubmissions = await dbAll('SELECT id, email FROM form_submissions ORDER BY id DESC');
    const seenEmails = new Set();
    const idsToKeep = [];

    for (const submission of allSubmissions) {
      if (!seenEmails.has(submission.email)) {
        idsToKeep.push(submission.id);
        seenEmails.add(submission.email);
      }
    }

    let submissionsDeleted = 0;
    if (idsToKeep.length > 0) {
      const placeholders = idsToKeep.map(() => '?').join(',');
      const deleteResult = await dbRun(
        `DELETE FROM form_submissions WHERE id NOT IN (${placeholders})`,
        idsToKeep
      );
      submissionsDeleted = deleteResult.changes;
    }

    // Get all contacts and find ones to delete
    const allContacts = await dbAll('SELECT id, email FROM contacts ORDER BY id DESC');
    const seenContactEmails = new Set();
    const contactIdsToKeep = [];

    for (const contact of allContacts) {
      if (!seenContactEmails.has(contact.email)) {
        contactIdsToKeep.push(contact.id);
        seenContactEmails.add(contact.email);
      }
    }

    let contactsDeleted = 0;
    if (contactIdsToKeep.length > 0) {
      const placeholders = contactIdsToKeep.map(() => '?').join(',');
      const deleteResult = await dbRun(
        `DELETE FROM contacts WHERE id NOT IN (${placeholders})`,
        contactIdsToKeep
      );
      contactsDeleted = deleteResult.changes;
    }

    // Get counts after cleanup
    const submissionsCount = await dbGet('SELECT COUNT(*) as count FROM form_submissions');
    const contactsCount = await dbGet('SELECT COUNT(*) as count FROM contacts');

    res.json({
      success: true,
      message: 'Database cleanup completed',
      deleted: {
        submissions: submissionsDeleted,
        contacts: contactsDeleted
      },
      remaining: {
        submissions: submissionsCount?.count || 0,
        contacts: contactsCount?.count || 0
      }
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      error: 'Failed to cleanup database',
      message: error.message
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
