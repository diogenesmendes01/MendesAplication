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
    console.log("========== EMAIL ==========");
    console.log(`To:      ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body:\n${options.htmlBody}`);
    if (options.attachments?.length) {
      console.log(
        `Attachments: ${options.attachments.map((a) => a.filename).join(", ")}`
      );
    }
    console.log("===========================");
  }
}

let provider: EmailProvider = new ConsoleEmailProvider();

export function setEmailProvider(p: EmailProvider) {
  provider = p;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  return provider.sendEmail(options);
}
