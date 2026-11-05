import { readFileSync, writeFileSync } from 'node:fs';
if (readFileSync('licenses/bcryptjs.txt', 'utf8') !== readFileSync('node_modules/bcryptjs/LICENSE', 'utf8')) throw Error('Runtime license changed; review notices');
writeFileSync('demo/LICENSE.txt', readFileSync('LICENSE'));
writeFileSync('demo/THIRD_PARTY_NOTICES.txt', readFileSync('THIRD_PARTY_NOTICES.md', 'utf8') + '\n' + readFileSync('licenses/bcryptjs.txt', 'utf8'));
