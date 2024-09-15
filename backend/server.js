const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// MySQL connection
const db = mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'AngularDB',
    port: '3307'

});

db.connect((err) => {
    if (err) {
        console.error('Database connection error:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

// User login route
app.post('/login', (req, res) => {
    const { email, password } = req.body;
  
    // Check if user exists
    const sql = 'SELECT * FROM users WHERE username = ?';
    db.query(sql, [email], (err, result) => {
      if (err) return res.status(500).json({ error: 'Server error' });
  
      if (result.length === 0) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
  
      // **No password encryption check here - Security Risk**
      const user = result[0];
  
      // Compare the password (plain text comparison - not recommended)
      if (password !== user.password) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
  
      // Generate a token
      const token = jwt.sign({ id: user.id, email: user.email }, 'your_jwt_secret', { expiresIn: '1h' });
      res.json({ token });
    });
  });

// Start the server
app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
