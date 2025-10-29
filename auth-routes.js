const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

// Secret key - in production, use environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_that_should_be_very_long_and_complex';

// Mock user database - replace with your actual database
const users = [
  {
    id: '1',
    email: 'brook@ralphagency.com',
    password: bcrypt.hashSync('innovationRules2024!', 10),
    role: 'admin'
  }
];

// Login Route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ message: 'Authentication failed' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Authentication failed' });
    }

    // Create JWT Token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      }, 
      JWT_SECRET, 
      { expiresIn: '2h' }
    );

    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        role: user.role 
      } 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(403).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

// Protected Route Example
router.get('/protected', verifyToken, (req, res) => {
  res.json({ 
    message: 'Access granted to protected resource', 
    user: req.user 
  });
});

module.exports = { router, verifyToken };
