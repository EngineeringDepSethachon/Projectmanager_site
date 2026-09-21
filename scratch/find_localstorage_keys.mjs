import fs from 'fs';

const files = ['js/app_foreman.js', 'js/app_pm.js', 'js/app_weekly.js', 'js/gas_service.js'];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  console.log('=== ' + file + ' ===');
  lines.forEach((line, idx) => {
    if (line.includes('localStorage')) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  });
});
