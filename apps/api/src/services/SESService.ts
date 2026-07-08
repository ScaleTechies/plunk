import signale from 'signale';

import {
  DASHBOARD_URI,
  EMAIL_DAILY_LIMIT,
  EMAIL_RATE_LIMIT_PER_SECOND,
  ZEPTOMAIL_API_URL,
  ZEPTOMAIL_SEND_TOKEN,
} from '../app/constants.js';
import {prisma} from '../database/prisma.js';

interface SendRawEmailParams {
  from: {
    name: string;
    email: string;
  };
  to: string[] | {name?: string; email: string}[];
  content: {
    subject: string;
    html: string;
  };
  reply?: string;
  headers?: Record<string, string> | null;
  attachments?:
    | {
        filename: string;
        content: string; // Base64 encoded
        contentType: string;
        contentId?: string;
        disposition?: 'attachment' | 'inline';
      }[]
    | null;
  tracking?: boolean;
  clientReference?: string;
  projectId?: string;
}

type ZeptoMailSendConfig = {
  sendToken: string;
  agentAlias?: string | null;
  senderAddress?: string | null;
};

type ZeptoMailResponse = {
  request_id?: string;
  data?: Array<{
    request_id?: string;
    additional_info?: {
      request_id?: string;
      email_reference?: string;
    };
  }>;
  error?: {
    message?: string;
    request_id?: string;
  };
  message?: string;
};

function formatRecipient(recipient: string | {name?: string; email: string}) {
  if (typeof recipient === 'string') {
    return {
      email_address: {
        address: recipient,
      },
    };
  }

  return {
    email_address: {
      address: recipient.email,
      ...(recipient.name ? {name: recipient.name} : {}),
    },
  };
}

function getAuthorizationHeader(sendToken: string) {
  return sendToken.startsWith('Zoho-enczapikey ') ? sendToken : `Zoho-enczapikey ${sendToken}`;
}

async function getProjectSendConfig(projectId?: string): Promise<ZeptoMailSendConfig> {
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: {id: projectId},
      select: {
        zeptomailSendToken: true,
        zeptomailAgentAlias: true,
        zeptomailSenderAddress: true,
      },
    });

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    if (!project.zeptomailSendToken) {
      throw new Error('Project ZeptoMail send token is not configured');
    }

    return {
      sendToken: project.zeptomailSendToken,
      agentAlias: project.zeptomailAgentAlias,
      senderAddress: project.zeptomailSenderAddress,
    };
  }

  if (!ZEPTOMAIL_SEND_TOKEN) {
    throw new Error('ZeptoMail send token is not configured');
  }

  return {
    sendToken: ZEPTOMAIL_SEND_TOKEN,
  };
}

function validateProjectSender(config: ZeptoMailSendConfig, fromEmail: string) {
  if (!config.senderAddress) {
    return;
  }

  if (config.senderAddress.toLowerCase() !== fromEmail.toLowerCase()) {
    throw new Error(`Sender address must match the project's configured ZeptoMail sender (${config.senderAddress})`);
  }
}

function extractMessageId(response: ZeptoMailResponse): string | undefined {
  return (
    response.request_id ||
    response.data?.[0]?.request_id ||
    response.data?.[0]?.additional_info?.email_reference ||
    response.data?.[0]?.additional_info?.request_id ||
    response.error?.request_id
  );
}

function buildMimeHeaders(headers: Record<string, string> | null | undefined, html: string): Record<string, string> {
  const mimeHeaders = headers ? {...headers} : {};
  const containsUnsubscribeLink = /unsubscribe\/([a-f\d-]+)"/.exec(html);

  if (containsUnsubscribeLink?.[1]) {
    const unsubscribeId = containsUnsubscribeLink[1];
    mimeHeaders['List-Unsubscribe'] = `<${DASHBOARD_URI}/unsubscribe/${unsubscribeId}>`;
  }

  return mimeHeaders;
}

/**
 * Send an email via ZeptoMail. The exported name intentionally remains
 * `sendRawEmail` while this private fork migrates away from SES.
 */
export async function sendRawEmail({
  from,
  to,
  content,
  reply,
  headers,
  attachments,
  tracking = true,
  clientReference,
  projectId,
}: SendRawEmailParams): Promise<{messageId: string}> {
  const sendConfig = await getProjectSendConfig(projectId);
  validateProjectSender(sendConfig, from.email);

  const regularAttachments = attachments?.filter(a => (a.disposition ?? 'attachment') === 'attachment') ?? [];
  const inlineImages = attachments?.filter(a => a.disposition === 'inline') ?? [];
  const mimeHeaders = buildMimeHeaders(headers, content.html);

  const payload = {
    from: {
      address: from.email,
      name: from.name,
    },
    to: to.map(formatRecipient),
    ...(reply
      ? {
          reply_to: [
            {
              address: reply,
            },
          ],
        }
      : {}),
    subject: content.subject,
    htmlbody: content.html,
    track_opens: tracking,
    track_clicks: tracking,
    ...(clientReference ? {client_reference: clientReference} : {}),
    ...(Object.keys(mimeHeaders).length > 0 ? {mime_headers: mimeHeaders} : {}),
    ...(regularAttachments.length > 0
      ? {
          attachments: regularAttachments.map(attachment => ({
            name: attachment.filename,
            content: attachment.content,
            mime_type: attachment.contentType,
          })),
        }
      : {}),
    ...(inlineImages.length > 0
      ? {
          inline_images: inlineImages.map(attachment => ({
            name: attachment.filename,
            content: attachment.content,
            mime_type: attachment.contentType,
            cid: attachment.contentId || attachment.filename,
          })),
        }
      : {}),
  };

  const response = await fetch(ZEPTOMAIL_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: getAuthorizationHeader(sendConfig.sendToken),
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let body: ZeptoMailResponse = {};

  if (bodyText) {
    try {
      body = JSON.parse(bodyText) as ZeptoMailResponse;
    } catch {
      body = {message: bodyText};
    }
  }

  if (!response.ok) {
    const message = body.error?.message || body.message || response.statusText || 'ZeptoMail send failed';
    throw new Error(message);
  }

  const messageId = extractMessageId(body);
  if (!messageId) {
    throw new Error('ZeptoMail accepted the email but did not return a request id');
  }

  return {messageId};
}

/**
 * Manual ZeptoMail domain verification: ZeptoMail remains the source of truth.
 * These compatibility exports keep the old DomainService call sites stable.
 */
export const getIdentities = async (domains: string[]): Promise<{domain: string; status: string}[]> => {
  return domains.map(domain => ({domain, status: 'Success'}));
};

export const verifyDomain = async (_domain: string): Promise<string[]> => {
  return [];
};

export const getDomainVerificationAttributes = async (domain: string) => {
  return {
    domain,
    tokens: [],
    status: 'Success',
  };
};

export const disableFeedbackForwarding = async (_domain: string): Promise<void> => {
  return;
};

export const deleteIdentity = async (_domain: string): Promise<void> => {
  return;
};

export const getSendingQuota = async (): Promise<{
  maxSendRate: number;
  max24HourSend: number;
  sentLast24Hours: number;
} | null> => {
  signale.info('[ZEPTOMAIL] Using static sending quota from environment');
  return {
    maxSendRate: EMAIL_RATE_LIMIT_PER_SECOND,
    max24HourSend: EMAIL_DAILY_LIMIT,
    sentLast24Hours: 0,
  };
};
