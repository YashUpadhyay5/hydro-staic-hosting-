const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const urlFile = path.join(__dirname, 'public-tunnel-url.txt');
const exe = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';

const proc = spawn(exe, ['tunnel', '--url', 'http://127.0.0.1:5173'], {
  windowsHide: true
});

proc.stderr.on('data', (data) => {
  const text = data.toString();
  process.stderr.write(text);
  const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
  if (match) {
    const url = match[0];
    fs.writeFileSync(urlFile, url, 'utf8');
    console.log('\n========================================');
    console.log('[PUBLIC CLOUDFLARE TUNNEL LIVE]');
    console.log(url);
    console.log('========================================\n');
  }
});

proc.stdout.on('data', (data) => {
  process.stdout.write(data);
});

proc.on('close', (code) => {
  console.log(`Cloudflared process exited with code ${code}`);
});
