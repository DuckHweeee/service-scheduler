// Dev/test-only helpers around the `embedded-postgres` package (there is no Docker on dev machines).
// Never imported by the application runtime.
import { existsSync } from 'node:fs';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

export interface EmbeddedInstance {
  pg: EmbeddedPostgres;
  port: number;
  /** Connection string for the maintenance database `postgres`. */
  adminUrl: string;
  urlFor: (database: string) => string;
  stop: () => Promise<void>;
}

export const USER = 'postgres';
export const PASSWORD = 'postgres';

export const findFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });

export interface StartOptions {
  dataDir: string;
  port: number;
  /** false → data dir is deleted on stop (ephemeral test instances). */
  persistent: boolean;
  quiet?: boolean;
}

export const startEmbedded = async (opts: StartOptions): Promise<EmbeddedInstance> => {
  const quiet = opts.quiet ?? false;
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dataDir,
    port: opts.port,
    user: USER,
    password: PASSWORD,
    persistent: opts.persistent,
    onLog: quiet ? () => {} : (m) => console.log(m),
    onError: quiet ? () => {} : (m) => console.error(m),
  });
  if (!existsSync(`${opts.dataDir}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  const urlFor = (database: string) =>
    `postgres://${USER}:${PASSWORD}@localhost:${opts.port}/${database}`;
  return {
    pg,
    port: opts.port,
    adminUrl: urlFor('postgres'),
    urlFor,
    stop: () => pg.stop(),
  };
};
