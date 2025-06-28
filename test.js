const express = require('express');
const axios = require('axios');
const qs = require('qs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files (like index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Enable CORS
app.use(cors());

// GET /result?symbol=...
app.get('/result', async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol query parameter is required.' });
  }

  const data = qs.stringify({ symbol });

  const config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://results-api.ekantipur.com/search',
    headers: {
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8,ne;q=0.7',
      'Connection': 'keep-alive',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': 'https://results.ekantipur.com',
      'Referer': 'https://results.ekantipur.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'X-Requested-With': 'XMLHttpRequest',
      'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    },
    data: data
  };

  try {
    const response = await axios.request(config);
    res.json(response.data);
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch result.' });
  }
});

// Fallback to index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
