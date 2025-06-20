// Handle missing dotenv in production
try {
  require('dotenv').config();
} catch (error) {
  console.log('Dotenv not found, using environment variables directly');
}

const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db');
const apiRoutes = require('./src/routes/api');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Configure middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Welcome route
app.get('/', (req, res) => {
  res.json({
    message: 'Ration Distribution Fraud Reporting API',
    status: 'online'
  });
});

// Use API routes
app.use('/api', apiRoutes);

// Start the server with fallback for port conflicts
const startServer = (port) => {
  try {
    const server = app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
    
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${port} is already in use, trying ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('Server error:', e);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer(PORT);