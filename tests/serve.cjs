// Opt-in QA server. Never loaded by npm start and never deploy this harness.
const express = require('express');
const path = require('path');
const app = express();
const root = path.join(__dirname, '..', 'public');
app.get('/emisor', (_, res) => res.sendFile(path.join(root, 'emisor/index.html')));
app.get('/receptor', (_, res) => res.sendFile(path.join(root, 'receptor/index.html')));
app.use('/qa', express.static(__dirname));
app.use(express.static(root));
app.listen(3001, '127.0.0.1', () => console.log('Synthetic-media QA: http://127.0.0.1:3001/qa/'));
