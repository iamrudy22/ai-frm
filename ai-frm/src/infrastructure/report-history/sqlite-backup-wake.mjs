import { backup } from 'node:sqlite';

/** Keep the loop active until Node 26.8.2 delivers the backup completion reaction.
 * https://github.com/nodejs/node/pull/65666 fixes the upstream callback-scope bug.
 * @param {import('node:sqlite').DatabaseSync} source
 * @param {string} destination
 */
export async function backupWithWake(source, destination) {
  const wake = setInterval(() => {}, 20);
  try {
    await backup(source, destination);
  } finally {
    clearInterval(wake);
  }
}
