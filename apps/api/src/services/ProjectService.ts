import type {Project} from '@plunk/db';

import {Keys} from './keys.js';
import {wrapRedis} from '../database/redis.js';
import {prisma} from '../database/prisma.js';

export type ProjectResponse = Omit<
  Project,
  'zeptomailSendToken' | 'zeptomailWebhookAuthKey' | 'zeptomailWebhookHeaderValue'
> & {
  zeptomailSendTokenSet: boolean;
  zeptomailWebhookAuthKeySet: boolean;
  zeptomailWebhookHeaderValueSet: boolean;
};

export class ProjectService {
  public static sanitize(project: Project): ProjectResponse {
    const {zeptomailSendToken, zeptomailWebhookAuthKey, zeptomailWebhookHeaderValue, ...safeProject} = project;

    return {
      ...safeProject,
      zeptomailSendTokenSet: Boolean(zeptomailSendToken),
      zeptomailWebhookAuthKeySet: Boolean(zeptomailWebhookAuthKey),
      zeptomailWebhookHeaderValueSet: Boolean(zeptomailWebhookHeaderValue),
    };
  }

  public static async id(id: string) {
    return wrapRedis(Keys.Project.id(id), async () => {
      return prisma.project.findUnique({where: {id}});
    });
  }

  public static async secret(key: string) {
    return wrapRedis(Keys.Project.secret(key), async () => {
      return prisma.project.findUnique({
        where: {
          secret: key,
        },
      });
    });
  }

  public static async public(key: string) {
    return wrapRedis(Keys.Project.public(key), async () => {
      return prisma.project.findUnique({
        where: {
          public: key,
        },
      });
    });
  }
}
