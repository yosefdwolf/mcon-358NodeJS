// server.js
//
// Express + Pug version of the "Chore Wars" site's page routing. Each menu
// link (Home, My Dashboard, Leaderboard, Wall of Shame, Contact Us) is its
// own Express route. Every route renders views/layout.pug, which holds the
// shared page shell and navigation menu, and fills in the "content" block
// with a page-specific template plus that page's data - mirroring the
// content of the PHP project's index.php, dashboard.php, leaderboard.php,
// wallofshame.php, and contactus.php pages.

require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');

const app = express();

// Same Gmail account as the PHP project's mail_config.php - used by the
// /contact page to actually send the submitted message.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USERNAME,
        pass: process.env.GMAIL_PASSWORD,
    },
});

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

// Same MySQL database as the PHP project (see Website/chorewars/config.php).
// Credentials come from .env (not committed) - used by the /chores
// data entry + data display page.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Sample data standing in for what the PHP site pulls from MySQL
// (see Website/chorewars/seed.sql).
const rankings = [
    { username: 'priya', total_points: 45 },
    { username: 'sam', total_points: 30 },
    { username: 'jordan', total_points: 20 },
    { username: 'alex', total_points: 10 },
].sort((a, b) => b.total_points - a.total_points);

const shameList = [
    { chore_name: 'Wipe Counters', username: 'sam', due_date: '2026-08-02', status: 'pending' },
    { chore_name: 'Sort Recycling', username: 'jordan', due_date: '2026-08-01', status: 'pending' },
    { chore_name: 'Scrub Shower', username: 'priya', due_date: '2026-07-31', status: 'skipped' },
];

const myChores = [
    { chore: 'Wash Dishes', category: 'Kitchen', dueDate: '2026-08-03', status: 'pending' },
    { chore: 'Wipe Counters', category: 'Kitchen', dueDate: '2026-08-02', status: 'pending' },
    { chore: 'Take Out Trash', category: 'Trash', dueDate: '2026-08-04', status: 'completed' },
];

app.get('/debug/netcheck', (req, res) => {
    const net = require('net');
    const targets = [
        ['smtp.gmail.com', 465],
        ['smtp.gmail.com', 587],
        ['smtp.gmail.com', 25],
        ['smtp.sendgrid.net', 587],
        ['smtp.sendgrid.net', 2525],
    ];
    const results = {};
    let remaining = targets.length;
    targets.forEach(([host, port]) => {
        const key = `${host}:${port}`;
        const start = Date.now();
        const socket = net.createConnection({ host, port, timeout: 6000 });
        const finish = (status) => {
            results[key] = { status, ms: Date.now() - start };
            socket.destroy();
            remaining -= 1;
            if (remaining === 0) res.json(results);
        };
        socket.on('connect', () => finish('OPEN'));
        socket.on('timeout', () => finish('TIMEOUT'));
        socket.on('error', (err) => finish('ERROR:' + err.code));
    });
});

app.get(['/', '/home'], (req, res) => {
    res.render('home', {
        title: 'Home',
        checklist: [
            { chore: 'Take out trash', roommate: 'Sam', done: true },
            { chore: 'Clean bathroom', roommate: 'Priya', done: false },
            { chore: 'Wash dishes', roommate: 'Jordan', done: true },
            { chore: 'Vacuum common area', roommate: 'Alex', done: false },
        ],
        cards: [
            { title: 'Daily Checklist', description: 'See exactly which chores are due to you today and check them off.' },
            { title: 'Leaderboard', description: 'Every completed chore earns points toward the household rankings.' },
            { title: 'Wall of Shame', description: 'Skipped or overdue chores get called out here.' },
        ],
    });
});

app.get('/dashboard', (req, res) => {
    res.render('dashboard', {
        title: 'My Dashboard',
        username: 'sam',
        totalPoints: 30,
        myChores: myChores,
    });
});

app.get('/leaderboard', (req, res) => {
    res.render('leaderboard', {
        title: 'Leaderboard',
        rankings: rankings,
    });
});

app.get('/wallofshame', (req, res) => {
    res.render('wallofshame', {
        title: 'Wall of Shame',
        shameList: shameList,
    });
});

// Data display + data entry page, backed by the real MySQL Chores /
// ChoreCategories tables (same database as the PHP project).
app.get('/chores', (req, res) => {
    const sql = `
        SELECT c.chore_id, c.name, c.frequency, c.point_value, cc.category_name
        FROM Chores c
        LEFT JOIN ChoreCategories cc ON c.category_id = cc.category_id
        ORDER BY c.chore_id`;

    pool.query(sql, (err, chores) => {
        if (err) {
            res.status(500).send('Database error: ' + err.message);
            return;
        }
        pool.query('SELECT category_id, category_name FROM ChoreCategories ORDER BY category_name', (err2, categories) => {
            if (err2) {
                res.status(500).send('Database error: ' + err2.message);
                return;
            }
            res.render('chores', {
                title: 'Manage Chores',
                chores: chores,
                categories: categories,
            });
        });
    });
});

app.post('/chores', (req, res) => {
    const name = (req.body.name || '').trim();
    const category_id = parseInt(req.body.category_id, 10) || null;
    const frequency = (req.body.frequency || 'Daily').trim();
    const point_value = parseInt(req.body.point_value, 10) || 10;

    if (!name) {
        res.status(400).send('Chore name is required.');
        return;
    }

    pool.query(
        'INSERT INTO Chores (name, category_id, frequency, point_value) VALUES (?, ?, ?, ?)',
        [name, category_id, frequency, point_value],
        (err) => {
            if (err) {
                res.status(500).send('Database error: ' + err.message);
                return;
            }
            res.redirect('/chores');
        }
    );
});

app.get('/contact', (req, res) => {
    res.render('contact', {
        title: 'Contact Us',
        errors: [],
        old: {},
    });
});

app.post('/contact', (req, res) => {
    const { name, email, subject, message } = req.body;
    const errors = [];
    if (!name) errors.push('Name is required.');
    if (!email) errors.push('Email is required.');
    if (!subject) errors.push('Subject is required.');
    if (!message) errors.push('Message is required.');

    if (errors.length) {
        res.render('contact', {
            title: 'Contact Us',
            errors: errors,
            old: { name, email, subject, message },
        });
        return;
    }

    transporter.sendMail({
        from: process.env.GMAIL_USERNAME,
        to: process.env.SITE_ADMIN_EMAIL,
        replyTo: email,
        subject: `Chore Wars Contact Form: ${subject}`,
        text: `From: ${name} (${email})\nSubject: ${subject}\n\n${message}`,
        html: `<p><strong>From:</strong> ${name} (${email})</p><p><strong>Subject:</strong> ${subject}</p><p><strong>Message:</strong></p><p>${message}</p>`,
    }, (err) => {
        if (err) {
            res.render('contact', {
                title: 'Contact Us',
                errors: [`Sorry, the message couldn't be sent right now. (${err.message})`],
                old: { name, email, subject, message },
            });
            return;
        }
        res.render('confirmation', {
            title: 'Confirmation',
            name: name,
            email: email,
        });
    });
});

app.use((req, res) => {
    res.status(404).send("Sorry, can't find that!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Express running -> http://localhost:${PORT}/`);
});
