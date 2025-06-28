const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(helmet()); // Security headers

// Enable CORS - allow all origins (modify origin as needed)
app.use(cors({
  origin: '*', // Replace '*' with your domain in production for better security
}));

// Rate limiter - limit each IP to 60 requests per 10 minutes
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Body parser with limit
app.use(express.json({ limit: '10kb' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Main POST endpoint
app.post('/api/see-result', async (req, res) => {
  try {
    const { symbol, dob } = req.body;

    if (!symbol || !dob) {
      return res.status(400).json({ error: 'symbol and dob are required' });
    }

    // Prepare form data
    const params = new URLSearchParams();
    params.append('symbol', symbol);
    params.append('dob', dob);
    params.append('submit', 'Search Result');

    // Send POST request
    const response = await axios.post(
      'https://see.ntc.net.np/results/gradesheet',
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Accept self-signed certs
      }
    );

    const html = response.data;
    const $ = cheerio.load(html);

    // Parse GPA (look for b tag text starting with "GRADE POINT AVERAGE")
    let gpa = null;
    $('b').each((i, el) => {
      const text = $(el).text().trim();
      if (/GRADE POINT AVERAGE/i.test(text)) {
        gpa = text.replace(/GRADE POINT AVERAGE \(GPA\)\s*:\s*/i, '');
      }
    });

    // Parse subjects (rows with exactly 6 td cells)
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

    // Extract symbol and dob from page info section
    const infoText = $('.lgfonts').text();
    const symbolMatch = infoText.match(/(\d{8}[A-Z]?)\b/);
    const dobMatch = infoText.match(/DATE OF BIRTH.*?(\d{4}[-./]\d{2}[-./]\d{2})/i);
    const symbolExtracted = symbolMatch ? symbolMatch[1] : null;
    const dobExtracted = dobMatch ? dobMatch[1] : null;

    return res.json({
      symbol: symbolExtracted || symbol,
      dob: dobExtracted || dob,
      gpa,
      subjects
    });

  } catch (error) {
    console.error('Error in /api/see-result:', error);
    return res.status(500).json({
      error: 'Something went wrong.',
      message: error.message,
    });
  }
});

// 404 handler for other routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Global error handler (fallback)
app.use((err, req, res, next) => {
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SEE Result API running on port ${PORT}`);
});
