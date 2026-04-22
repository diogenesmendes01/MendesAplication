import { logger } from "@/lib/logger";
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  sendEmail(options: EmailOptions): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  async sendEmail(options: EmailOptions): Promise<void> {
    logger.info("========== EMAIL ==========");
    logger.info(`To:      ${options.to}`);
    logger.info(`Subject: ${options.subject}`);
    logger.info(`Body:\n${options.htmlBody}`);
    if (options.attachments?.length) {
      logger.info(
        `Attachments: ${options.attachments.map((a) => a.filename).join(", ")}`
      );
    }
    logger.info("===========================");
  }
}

let provider: EmailProvider = new ConsoleEmailProvider();

export function setEmailProvider(p: EmailProvider) {
  provider = p;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  return provider.sendEmail(options);
}
