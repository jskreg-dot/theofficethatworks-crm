// Simple Node.js Backend for OfficeGenie CRM
// Connects React frontend to Namecheap SQL database
// Deploy to: Heroku, Railway, Render, or local

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'crm_database',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Dashboard endpoint - used by React frontend
app.get('/api/dashboard', async (req, res) => {
  try {
    const scenario = req.query.scenario || 'real_estate';

    const connection = await pool.getConnection();

    // Get all contacts
    const [contacts] = await connection.execute(
      'SELECT * FROM leads WHERE status = "contact"'
    );

    // Get all leads
    const [leads] = await connection.execute(
      'SELECT * FROM leads WHERE status = "lead"'
    );

    connection.release();

    // Calculate metrics
    const totalContacts = contacts.length;
    const totalLeads = leads.length;
    const conversionRate = totalContacts > 0
      ? ((totalLeads / (totalContacts + totalLeads)) * 100).toFixed(1)
      : 0;

    res.json({
      scenario,
      metrics: {
        totalContacts,
        totalLeads,
        conversionRate: `${conversionRate}%`,
        avgTimeToLead: '3.2 days'
      },
      contacts,
      leads
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get all contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'SELECT * FROM leads WHERE status = "contact"'
    );
    connection.release();
    res.json(rows);
  } catch (error) {
    console.error('Contacts error:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Get single contact
app.get('/api/contacts/:id', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'SELECT * FROM leads WHERE id = ?',
      [req.params.id]
    );
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Contact error:', error);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// Convert contact to lead
app.post('/api/contacts/:id/convert', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.execute(
      'UPDATE leads SET status = "lead" WHERE id = ?',
      [req.params.id]
    );
    connection.release();

    res.json({ success: true, message: 'Contact converted to lead' });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Failed to convert contact' });
  }
});

// Create new contact/lead
app.post('/api/leads', async (req, res) => {
  try {
    const {
      fullName,
      email,
      businessName,
      phone,
      industry,
      automationType,
      timeDrain,
      status = 'contact'
    } = req.body;

    const connection = await pool.getConnection();
    const result = await connection.execute(
      `INSERT INTO leads
       (fullName, email, businessName, phone, industry, automationType, timeDrain, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [fullName, email, businessName, phone, industry, automationType, timeDrain, status]
    );
    connection.release();

    res.status(201).json({
      success: true,
      id: result[0].insertId
    });
  } catch (error) {
    console.error('Create error:', error);
    res.status(400).json({ error: 'Failed to create lead' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Start server
app.listen(PORT, () => {
  console.log(`OfficeGenie CRM Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
