const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const path = require('path');
const winston = require('winston');
const expressWinston = require('express-winston');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

// Initialize Express app
const app = express();

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Add console logging in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  } : false,
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : true;

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.ip,
});
app.use(limiter);

// Body parser
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Request logging
app.use(expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  msg: 'HTTP {{req.method}} {{req.url}}',
  expressFormat: true,
  colorize: false,
}));

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// Input validation middleware
const validateInput = [
  body('symbol')
    .trim()
    .notEmpty()
    .withMessage('Symbol is required')
    .matches(/^\d{8}[A-Z]?$/)
    .withMessage('Invalid symbol format'),
  body('dob')
    .trim()
    .notEmpty()
    .withMessage('Date of birth is required')
    .matches(/^\d{4}[-./]\d{2}[-./]\d{2}$/)
    .withMessage('Invalid date format (YYYY-MM-DD)'),
];

// Main API endpoint
app.post('/api/see-result', validateInput, async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { symbol, dob } = req.body;

    // Prepare form data
    const params = new URLSearchParams();
    params.append('symbol', symbol);
    params.append('dob', dob);
    params.append('submit', 'Search Result');

    // Configure axios instance
    const axiosInstance = axios.create({
      timeout: parseInt(process.env.REQUEST_TIMEOUT) || 5000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': process.env.USER_AGENT || 'SEE-Result-API/1.0',
      },
    });

    // Send POST request
    const response = await axiosInstance.post(
      process.env.TARGET_URL || 'https://see.ntc.net.np/results/gradesheet',
      params.toString()
    );

    const html = response.data;
    const $ = cheerio.load(html);

    // Parse GPA
    let gpa = null;
    $('b').each((i, el) => {
      const text = $(el).text().trim();
      if (/GRADE POINT AVERAGE/i.test(text)) {
        gpa = text.replace(/GRADE POINT AVERAGE \(GPA\)\s*:\s*/i, '');
      }
    });

    // Parse subjects
    const subjects = [];
    $('table tr').each((i, el) => {
      const tds = $(el).find('td');
      if (tds.length === 6) {
        const cells = tds.map((i, td) => $(td).text().trim()).get();
        subjects.push({
          subject: cells[0].replace(/\s+/g, ' ').trim(),
          creditHours: cells[1],
          grade: cells[2],
          gradePoint: cells[3],
          finalGrade: cells[4],
          remarks: cells[5],
        });
      }
    });

    // Extract symbol and dob
    const infoText = $('.lgfonts').text();
    const symbolMatch = infoText.match(/(\d{8}[A-Z]?)\b/);
    const dobMatch = infoText.match(/DATE OF BIRTH.*?(\d{4}[-./]\d{2}[-./]\d{2})/i);

    return res.json({
      symbol: symbolMatch ? symbolMatch[1] : symbol,
      dob: dobMatch ? dobMatch[1] : dob,
      gpa,
      subjects,
    });

  } catch (error) {
    logger.error('Error in /api/see-result', {
      error: error.message,
      stack: error.stack,
      request: {
        body: req.body,
        ip: req.ip,
      },
    });

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return res.status(504).json({ error: 'Request timeout' });
      }
      return res.status(502).json({ error: 'Failed to fetch data from external server' });
    }

    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    code: 'ROUTE_NOT_FOUND',
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unexpected error', {
    error: err.message,
    stack: err.stack,
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
    },
  });

  res.status(500).json({
    error: 'Internal Server Error',
    code: 'UNEXPECTED_ERROR',
  });
});

// Start server
const PORT = parseInt(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  logger.info(`SEE Result API running on port ${PORT}`, {
    environment: process.env.NODE_ENV,
  });
});

// Graceful shutdown
const gracefulShutdown = () => {
  logger.info('Received shutdown signal. Closing server...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcing shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', {
    error: err.message,
    stack: err.stack,
  });
  gracefulShutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason.message || reason,
    stack: reason.stack,
  });
});
