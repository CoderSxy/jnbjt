import type { FastifyInstance } from 'fastify';
import type { CityState } from '@jnbjt/contracts';
import { assertCsrf, requireUser } from '../../plugins/auth.js';
import {
  createCity,
  getCity,
  listCities,
  saveCity,
  VersionConflictError,
} from './repository.js';

const defaultState = (): CityState => ({
  prefectLevel: 1,
  unlockedAreas: [],
  inventory: {},
  buildings: [],
  workersAvailable: 0,
});

export async function registerCityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/cities', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return { cities: await listCities(app.db, user.id) };
  });

  app.post('/api/v1/cities', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const body = request.body as {
      cityKey?: string;
      displayName?: string;
      state?: CityState;
    };
    if (!body.cityKey || !body.displayName) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'cityKey/displayName required' } });
    }
    try {
      const city = await createCity(
        app.db,
        user.id,
        body.cityKey,
        body.displayName,
        body.state ?? defaultState(),
      );
      return reply.code(201).send({ city });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique|duplicate/i.test(message)) {
        return reply
          .code(409)
          .send({ error: { code: 'CONFLICT', message: 'city already exists for user' } });
      }
      throw error;
    }
  });

  app.get('/api/v1/cities/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const city = await getCity(app.db, user.id, id);
    if (!city) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'city not found' } });
    }
    return { city };
  });

  app.put('/api/v1/cities/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { expectedVersion?: number; state?: CityState };
    if (body.expectedVersion == null || !body.state) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'expectedVersion and state required' } });
    }
    try {
      const city = await saveCity(app.db, user.id, id, body.expectedVersion, body.state);
      return { city };
    } catch (error) {
      if (error instanceof VersionConflictError) {
        return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'version conflict' } });
      }
      if (error instanceof Error && error.name === 'NotFoundError') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'city not found' } });
      }
      throw error;
    }
  });
}
