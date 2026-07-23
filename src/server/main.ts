import { ProjectSession } from './session.js';
import { buildApp } from './app.js';

const port = Number(process.env.VIBEBOARD_PORT ?? 4610);
const session = new ProjectSession();
const app = buildApp(session);

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => app.log.info(`VibeBoard server listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
