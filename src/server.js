require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const hrRoutes = require('./routes/hr');
const nrmRoutes = require('./routes/nrm');
const maintenanceRoutes = require('./routes/maintenance');
const adminRoutes = require('./routes/admin');
const settingsRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const usersRoutes = require('./routes/users');

const { errorHandler } = require('./middleware/errorHandler');
const { initSocket } = require('./utils/socket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
console.log('--- STARTING AMPHENOL API ---');
console.log(`Port: ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV}`);

// Initialize Socket.IO
initSocket(server);

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests, please try again later' }
}));

// Static files (uploads)
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/hr', hrRoutes);
app.use('/api/v1/nrm', nrmRoutes);
app.use('/api/v1/maintenance', maintenanceRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/users', usersRoutes);

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ success: true, message: 'Amphenol Platform API is running', timestamp: new Date() });
});

// Error handler
app.use(errorHandler);

server.listen(PORT, () => {
  console.log(`Amphenol Platform API running on port ${PORT}`);
});

module.exports = { app, server };
