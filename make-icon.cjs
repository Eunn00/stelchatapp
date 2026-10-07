const sharp = require('sharp');
const path = require('node:path');

sharp(path.join(__dirname, 'assets', 'favicon.svg'))
  .resize(512, 512)
  .png()
  .toFile(path.join(__dirname, 'assets', 'icon.png'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
