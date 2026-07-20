import net from 'node:net';

export function selectAvailablePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not select a localhost port'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function waitForSpawnedServer(child, expectedUrl, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onData = (chunk) => {
      output = `${output}${String(chunk)}`.slice(-4096);
      if (output.includes(expectedUrl)) finish(resolve);
    };
    const onError = (error) =>
      finish(
        reject,
        new Error(
          `QA server failed before announcing ${expectedUrl}: ${error}`,
        ),
      );
    const onExit = (code, signal) =>
      finish(
        reject,
        new Error(
          `QA server exited before announcing ${expectedUrl} (code ${String(code)}, signal ${String(signal)})`,
        ),
      );
    const timeout = setTimeout(
      () =>
        finish(
          reject,
          new Error(
            `Timed out waiting for QA server to announce ${expectedUrl}`,
          ),
        ),
      timeoutMs,
    );

    child.stdout?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}
