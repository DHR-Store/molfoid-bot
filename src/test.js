// test.js
const { searchMusic } = require('./utils/music');

(async () => {
  const song = await searchMusic('Heer Raanjhana');
  console.log(JSON.stringify(song, null, 2));
})();