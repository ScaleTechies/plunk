import crypto from 'node:crypto';

import {EmailStatus} from '@plunk/db';
import type {Request, Response} from 'express';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {factories, getPrismaClient} from '../../../../../test/helpers';

vi.mock('../../app/constants.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../app/constants.js')>();
  return {
    ...actual,
    ZEPTOMAIL_WEBHOOK_AUTH_KEY: 'webhook-secret',
    ZEPTOMAIL_WEBHOOK_MAX_AGE_SECONDS: 300,
  };
});

vi.mock('../../services/NtfyService.js', () => ({
  NtfyService: {
    notifyEmailBounce: vi.fn().mockResolvedValue(undefined),
    notifyEmailComplaint: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/SecurityService.js', () => ({
  SecurityService: {
    checkAndEnforceSecurityLimits: vi.fn().mockResolvedValue(undefined),
    verifySnsSignature: vi.fn().mockResolvedValue(true),
  },
}));

import {Webhooks} from '../Webhooks.js';

function signedHeader(payload: string, secret = 'webhook-secret') {
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64');
  return `ts=${timestamp};s=${encodeURIComponent(signature)};s-algorithm=HmacSHA256`;
}

function makeReq(
  payload: Record<string, unknown>,
  projectId: string,
  options: {
    signature?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const body = Buffer.from(JSON.stringify(payload));
  const signature = 'signature' in options ? options.signature : signedHeader(JSON.stringify(payload));
  const headers = options.headers ?? {};

  return {
    params: {projectId},
    body,
    get: (header: string) => {
      if (header.toLowerCase() === 'producer-signature') return signature;
      if (header.toLowerCase() === 'content-type') return 'application/json';
      const headerEntry = Object.entries(headers).find(([key]) => key.toLowerCase() === header.toLowerCase());
      if (headerEntry) return headerEntry[1];
      return undefined;
    },
  } as unknown as Request;
}

function makeRes() {
  const res = {
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

  return res as unknown as Response & {statusCode: number; body: unknown};
}

function zeptoPayload(eventName: string, emailId: string) {
  return {
    event_name: eventName,
    event_message: {
      email_info: {
        client_reference: emailId,
        email_reference: 'zepto-email-ref',
        subject: 'Subject',
      },
      request_id: 'zepto-request-id',
    },
    webhook_request_id: 'webhook-request-id',
  };
}

function zeptoArrayPayload(eventName: string, emailId: string, eventTime = '2026-07-09T17:07:52Z') {
  return {
    event_name: [eventName],
    event_message: [
      {
        email_info: {
          client_reference: emailId,
          email_reference: 'zepto-email-ref',
          subject: 'webhook test email',
          processed_time: '2026-07-09T17:00:00Z',
          object: 'email',
        },
        event_data: [
          {
            details: [
              {
                reason: 'relaying-issues',
                bounced_recipient: 'bouncerecipient@zylker.com',
                time: eventTime,
                diagnostic_message: 'bad-mailbox',
              },
            ],
            object: eventName,
          },
        ],
        request_id: 'zepto-request-id',
      },
    ],
    mailagent_key: 'zepto-agent-key',
    webhook_request_id: 'webhook-request-id',
  };
}

describe('ZeptoMail webhooks', () => {
  const prisma = getPrismaClient();
  const controller = new Webhooks();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a valid delivered event and updates email status', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: project.id});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({success: true});

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.DELIVERED);
    expect(updated?.deliveredAt).not.toBeNull();

    const event = await prisma.event.findFirst({
      where: {emailId: email.id, name: 'email.delivery'},
    });
    expect(event).not.toBeNull();
  });

  it('rejects invalid signatures before mutating email state', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: project.id});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(
      makeReq(payload, project.id, {signature: signedHeader(JSON.stringify(payload), 'wrong-secret')}),
      res,
    );

    expect(res.statusCode).toBe(403);

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.SENT);
    expect(updated?.deliveredAt).toBeNull();
  });

  it('hard bounces unsubscribe contacts', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: project.id, subscribed: true});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Hard Bounce', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(200);

    const updatedEmail = await prisma.email.findUnique({where: {id: email.id}});
    expect(updatedEmail?.status).toBe(EmailStatus.BOUNCED);
    expect(updatedEmail?.bouncedAt).not.toBeNull();

    const updatedContact = await prisma.contact.findUnique({where: {id: contact.id}});
    expect(updatedContact?.subscribed).toBe(false);
  });

  it('soft bounces track an event without unsubscribing contacts', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: project.id, subscribed: true});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Soft Bounce', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(200);

    const updatedEmail = await prisma.email.findUnique({where: {id: email.id}});
    expect(updatedEmail?.status).toBe(EmailStatus.SENT);

    const updatedContact = await prisma.contact.findUnique({where: {id: contact.id}});
    expect(updatedContact?.subscribed).toBe(true);

    const event = await prisma.event.findFirst({
      where: {emailId: email.id, name: 'email.bounce'},
    });
    expect(event).not.toBeNull();
  });

  it('handles ZeptoMail array-form softbounce payloads with provider event timestamps', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: project.id, subscribed: true});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoArrayPayload('softbounce', email.id, '2026-07-09T15:46:30Z');
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(200);

    const updatedEmail = await prisma.email.findUnique({where: {id: email.id}});
    expect(updatedEmail?.status).toBe(EmailStatus.SENT);

    const updatedContact = await prisma.contact.findUnique({where: {id: contact.id}});
    expect(updatedContact?.subscribed).toBe(true);

    const event = await prisma.event.findFirst({
      where: {emailId: email.id, name: 'email.bounce'},
    });
    expect(event?.data).toMatchObject({
      provider: 'zeptomail',
      providerEvent: 'softbounce',
      bounceType: 'soft',
      bouncedAt: '2026-07-09T15:46:30.000Z',
      occurredAt: '2026-07-09T15:46:30.000Z',
      transientBounce: true,
    });
  });

  it('handles ZeptoMail array-form hardbounce payloads and stores provider timestamps', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: project.id, subscribed: true});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoArrayPayload('hardbounce', email.id, '2026-07-09T17:07:52Z');
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(200);

    const updatedEmail = await prisma.email.findUnique({where: {id: email.id}});
    expect(updatedEmail?.status).toBe(EmailStatus.BOUNCED);
    expect(updatedEmail?.bouncedAt?.toISOString()).toBe('2026-07-09T17:07:52.000Z');

    const updatedContact = await prisma.contact.findUnique({where: {id: contact.id}});
    expect(updatedContact?.subscribed).toBe(false);
  });

  it('handles ZeptoMail feedback loop payloads as complaints', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: project.id, subscribed: true});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoArrayPayload('fbl_compliant', email.id, '2026-07-09T17:08:07Z');
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(200);

    const updatedEmail = await prisma.email.findUnique({where: {id: email.id}});
    expect(updatedEmail?.status).toBe(EmailStatus.COMPLAINED);
    expect(updatedEmail?.complainedAt?.toISOString()).toBe('2026-07-09T17:08:07.000Z');

    const updatedContact = await prisma.contact.findUnique({where: {id: contact.id}});
    expect(updatedContact?.subscribed).toBe(false);
  });

  it('rejects project-scoped webhooks without a configured project webhook key', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: null});
    const contact = await factories.createContact({projectId: project.id});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(403);

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.SENT);
    expect(updated?.deliveredAt).toBeNull();
  });

  it('rejects signed project webhooks that reference another project email', async () => {
    const {project} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const {project: otherProject} = await factories.createUserWithProject({}, {zeptomailWebhookAuthKey: 'webhook-secret'});
    const contact = await factories.createContact({projectId: otherProject.id});
    const email = await factories.createEmail(otherProject.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(makeReq(payload, project.id), res);

    expect(res.statusCode).toBe(404);

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.SENT);
    expect(updated?.deliveredAt).toBeNull();
  });

  it('accepts a valid custom authorization header without producer-signature', async () => {
    const {project} = await factories.createUserWithProject(
      {},
      {
        zeptomailWebhookAuthKey: null,
        zeptomailWebhookHeaderKey: 'x-plunk-webhook-secret',
        zeptomailWebhookHeaderValue: 'header-secret',
      },
    );
    const contact = await factories.createContact({projectId: project.id});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(
      makeReq(payload, project.id, {
        signature: undefined,
        headers: {'x-plunk-webhook-secret': 'header-secret'},
      }),
      res,
    );

    expect(res.statusCode).toBe(200);

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.DELIVERED);
    expect(updated?.deliveredAt).not.toBeNull();
  });

  it('rejects webhooks with an invalid custom authorization header', async () => {
    const {project} = await factories.createUserWithProject(
      {},
      {
        zeptomailWebhookAuthKey: null,
        zeptomailWebhookHeaderKey: 'x-plunk-webhook-secret',
        zeptomailWebhookHeaderValue: 'header-secret',
      },
    );
    const contact = await factories.createContact({projectId: project.id});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailProjectWebhook(
      makeReq(payload, project.id, {
        signature: undefined,
        headers: {'x-plunk-webhook-secret': 'wrong-secret'},
      }),
      res,
    );

    expect(res.statusCode).toBe(403);

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.SENT);
    expect(updated?.deliveredAt).toBeNull();
  });
});
