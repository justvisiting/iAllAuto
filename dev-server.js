const http = require('http');
const fs = require('fs');
const path = require('path');

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.ttf': 'font/ttf',
    '.json': 'application/json'
};

const server = http.createServer((req, res) => {
    console.log(`Request: ${req.url}`);
    
    // Map URLs to file paths
    const urlToPath = {
        '/': '/src/webview/dev.html',
        '/script.js': '/out/webview/script.js',
        '/styles.css': '/src/webview/styles.css',
        '/assets/codicon.css': '/src/webview/assets/codicon.css',
        '/assets/codicon.ttf': '/src/webview/assets/codicon.ttf'
    };

    const filePath = urlToPath[req.url] || req.url;
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath);

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
        console.error(`File not found: ${fullPath}`);
        res.writeHead(404);
        res.end('Not Found');
        return;
    }

    // Set content type
    res.setHeader('Content-Type', mimeTypes[ext] || 'text/plain');

    // Read and serve file
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            console.error(`Error reading file: ${err}`);
            res.writeHead(500);
            res.end('Internal Server Error');
            return;
        }
        res.writeHead(200);
        res.end(data);
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Development server running at http://localhost:${PORT}`);
});
