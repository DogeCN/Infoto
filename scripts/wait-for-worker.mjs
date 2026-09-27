#!/usr/bin/env node
// Wait for the local Worker to accept TCP connections before starting the frontend.
import net from 'node:net';

const [host = '127.0.0.1', port = '8787', timeout = '60000'] = process.argv.slice(2);
const deadline = Date.now() + Number(timeout);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve true as soon as a TCP connection to the Worker is established. */
function probe() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

while (Date.now() < deadline) {
  if (await probe()) {
    console.log(`worker ready on http://${host}:${port}`);
    process.exit(0);
  }
  await sleep(300);
}

console.error(`timed out after ${timeout}ms waiting for the worker on ${host}:${port}`);
process.exit(1);
