import type {Request, Response} from 'express';
import {describe, expect, it, vi} from 'vitest';

import {factories, getPrismaClient} from '../../../../../test/helpers';
import {Users} from '../Users.js';

function makeReq(projectId: string, body: Record<string, unknown>) {
  return {
    params: {id: projectId},
    body,
  } as unknown as Request;
}

function makeRes(userId: string) {
  const res = {
    locals: {
      auth: {userId},
    },
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };

  return res as unknown as Response & {statusCode: number; body: Record<string, unknown>};
}

describe('Users project ZeptoMail settings', () => {
  const prisma = getPrismaClient();
  const controller = new Users() as unknown as {
    updateProject: (req: Request, res: Response, next: () => void) => Promise<void>;
  };

  it('updates per-project ZeptoMail settings without returning the raw token', async () => {
    const {user, project} = await factories.createUserWithProject(
      {},
      {
        zeptomailSendToken: 'old-token',
        zeptomailAgentAlias: 'old-agent',
        zeptomailSenderAddress: 'old@example.com',
        zeptomailWebhookAuthKey: 'old-webhook-key',
        zeptomailWebhookHeaderKey: 'x-old-header',
        zeptomailWebhookHeaderValue: 'old-header-value',
      },
    );

    const res = makeRes(user.id);

    await controller.updateProject(
      makeReq(project.id, {
        name: 'Updated Project',
        zeptomailSendToken: 'new-token',
        zeptomailAgentAlias: 'new-agent',
        zeptomailSenderAddress: 'sender@example.com',
        zeptomailWebhookAuthKey: 'new-webhook-key',
        zeptomailWebhookHeaderKey: 'x-plunk-webhook-secret',
        zeptomailWebhookHeaderValue: 'new-header-value',
      }),
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Updated Project',
      zeptomailAgentAlias: 'new-agent',
      zeptomailSenderAddress: 'sender@example.com',
      zeptomailWebhookHeaderKey: 'x-plunk-webhook-secret',
      zeptomailSendTokenSet: true,
      zeptomailWebhookAuthKeySet: true,
      zeptomailWebhookHeaderValueSet: true,
    });
    expect(res.body).not.toHaveProperty('zeptomailSendToken');
    expect(res.body).not.toHaveProperty('zeptomailWebhookAuthKey');
    expect(res.body).not.toHaveProperty('zeptomailWebhookHeaderValue');

    const stored = await prisma.project.findUniqueOrThrow({where: {id: project.id}});
    expect(stored.zeptomailSendToken).toBe('new-token');
    expect(stored.zeptomailWebhookAuthKey).toBe('new-webhook-key');
    expect(stored.zeptomailWebhookHeaderKey).toBe('x-plunk-webhook-secret');
    expect(stored.zeptomailWebhookHeaderValue).toBe('new-header-value');
  });

  it('keeps existing secrets when secret fields are blank', async () => {
    const {user, project} = await factories.createUserWithProject(
      {},
      {
        zeptomailSendToken: 'keep-token',
        zeptomailAgentAlias: 'old-agent',
        zeptomailSenderAddress: 'old@example.com',
        zeptomailWebhookAuthKey: 'keep-webhook-key',
        zeptomailWebhookHeaderKey: 'x-keep-header',
        zeptomailWebhookHeaderValue: 'keep-header-value',
      },
    );

    const res = makeRes(user.id);

    await controller.updateProject(
      makeReq(project.id, {
        zeptomailSendToken: '',
        zeptomailAgentAlias: '',
        zeptomailSenderAddress: '',
        zeptomailWebhookAuthKey: '',
        zeptomailWebhookHeaderKey: '',
        zeptomailWebhookHeaderValue: '',
      }),
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      zeptomailAgentAlias: null,
      zeptomailSenderAddress: null,
      zeptomailWebhookHeaderKey: null,
      zeptomailSendTokenSet: true,
      zeptomailWebhookAuthKeySet: true,
      zeptomailWebhookHeaderValueSet: true,
    });
    expect(res.body).not.toHaveProperty('zeptomailSendToken');
    expect(res.body).not.toHaveProperty('zeptomailWebhookAuthKey');
    expect(res.body).not.toHaveProperty('zeptomailWebhookHeaderValue');

    const stored = await prisma.project.findUniqueOrThrow({where: {id: project.id}});
    expect(stored.zeptomailSendToken).toBe('keep-token');
    expect(stored.zeptomailWebhookAuthKey).toBe('keep-webhook-key');
    expect(stored.zeptomailWebhookHeaderValue).toBe('keep-header-value');
  });
});
